#!/usr/bin/env python3
"""rename.py NEW_NAME [--drop-old] — change the product's name everywhere, in one pass.

  scripts/rename.py Ika            the display name is Ika; the command, the data directory (~/.ika),
                                   the variable prefix (IKA_), the bundle id (dev.sue738.ika), the app
                                   (Ika.app), the pty host (ika-ptyd) and the paths are derived from it

The current name is read from lib/names.js (NAMES[0] and DISPLAY). Every tracked text file gets the
lower-case, Capitalised and UPPER-CASE forms of it replaced (whole words only: a neighbouring letter
or digit stops a match, so IKA_HOME, Ika.app and IkaSelftest match and "ikari" does not), and the
paths that carry it are moved (app/Sources/<Name>, bin/<name>.js, ...).

What stays readable under the old name is data, not a list of exceptions: a line tagged `rename:keep`
(in lib/names.js, app/Sources/*/Names.swift, Casks/*.rb) is written twice, converted first and then as
it was without the tag, so the old name becomes the next entry of NAMES and everything that reads old
directories, variables, sockets, message lines and launchd labels walks the list. package.json's bin
keeps the old command as another name for the new one. --drop-old is for a name that never shipped:
it is not kept.

Nothing is staged or committed; run the tests, then `git add` what changed. Run it from the repository
(or a copy of it: test/rename-check.js does that with another name and runs the tests there).
"""
import json
import os
import re
import subprocess
import sys

TAG = 'rename:keep'


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    drop_old = '--drop-old' in argv
    if len(args) != 1 or not re.fullmatch(r'[A-Za-z][A-Za-z0-9]*', args[0]):
        sys.exit('usage: rename.py NEW_NAME [--drop-old]   (letters and digits, starting with a letter)')
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    names = open('lib/names.js', encoding='utf-8').read()
    m = re.search(r"'([a-z0-9]+)',\s*//\s*" + TAG, names)
    d = re.search(r"const DISPLAY = '([A-Za-z0-9]+)'", names)
    if not m or not d:
        sys.exit('lib/names.js: cannot find the current name (the NAMES line tagged %s, and DISPLAY)' % TAG)
    old_l, old_d = m.group(1), d.group(1)
    new_d = args[0]
    new_l = new_d.lower()
    if old_l == new_l and old_d == new_d:
        sys.exit('already named %s' % new_d)
    subs = [
        (re.compile(r'(?<![A-Za-z0-9])' + re.escape(old_l.upper()) + r'(?![A-Za-z0-9])'), new_d.upper()),
        (re.compile(r'(?<![A-Za-z0-9])' + re.escape(old_d) + r'(?![a-z0-9])'), new_d),
        (re.compile(r'(?<![A-Za-z0-9])' + re.escape(old_l) + r'(?![A-Za-z0-9])'), new_l),
    ]

    def conv(s):
        for rx, to in subs:
            s = rx.sub(to, s)
        return s

    def has_old(s):
        return any(rx.search(s) for rx, _ in subs)

    tag_rx = re.compile(r'[ \t]*(//|#)[ \t]*' + TAG + r'[ \t]*$')
    files = subprocess.check_output(['git', 'ls-files', '-z'], text=True).split('\0')
    changed = []
    for path in filter(None, files):
        if path.startswith('lib/ui/vendor/') or path == 'scripts/rename.py' or not os.path.isfile(path):
            continue
        try:
            text = open(path, encoding='utf-8').read()
        except UnicodeDecodeError:
            continue
        out = []
        for line in text.split('\n'):
            if TAG in line and has_old(line):
                out.append(conv(line))
                if not drop_old:
                    out.append(tag_rx.sub('', line))
            else:
                out.append(conv(line))
        new_text = '\n'.join(out)
        new_path = conv(path)
        if new_text == text and new_path == path:
            continue
        if new_path != path:
            os.makedirs(os.path.dirname(new_path) or '.', exist_ok=True)
        mode = os.stat(path).st_mode
        with open(new_path, 'w', encoding='utf-8') as f:
            f.write(new_text)
        os.chmod(new_path, mode)
        if new_path != path:
            os.remove(path)
            try:
                os.removedirs(os.path.dirname(path))
            except OSError:
                pass
        changed.append((path, new_path))

    # package.json (and the lock file's root entry): the old command stays as another name for the new file
    for pj, keys in (('package.json', ()), ('package-lock.json', ('packages', ''))):
        if not os.path.exists(pj):
            continue
        j = json.load(open(pj, encoding='utf-8'))
        node = j
        for k in keys:
            node = node[k]
        bin_ = node.get('bin')
        if isinstance(bin_, dict) and not drop_old:
            target = bin_.get(new_l) or 'bin/%s.js' % new_l
            node['bin'] = {new_l: target, **{k: v for k, v in bin_.items() if k != new_l}}
            node['bin'].setdefault(old_l, target)
        with open(pj, 'w', encoding='utf-8') as f:
            json.dump(j, f, indent=2)
            f.write('\n')
    print('renamed %s (%s) → %s (%s); %d files touched%s' % (old_d, old_l, new_d, new_l, len(changed), ', old name dropped' if drop_old else ', old name kept as a legacy name'))


if __name__ == '__main__':
    main(sys.argv)
