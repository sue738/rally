'use strict';
const { t: tr } = require('./i18n.js');
/**
 * changes.js — what a session changed, for review: each file it wrote (lib/made.js)
 * with git's diff against the last commit, or on a branch against its merge-base.
 * Read-only. The diff is about the file, not the session: others may have touched it.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');
const View = require('./view.js');
const { SAFE_GIT } = require('./git.js');

const MAX_FILES = 80;
const MAX_DIFF = 200 * 1024;

// null: git failed (not a repository, too big, too slow); '' is an empty answer
function git(dir, args) {
  try { return execFileSync('git', [...SAFE_GIT, ...args], { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
}

/** Lines added and removed, counted inside the hunks only: a "+++x" line of content counts. */
function count(diff) {
  let a = 0, d = 0, inHunk = false;
  for (const l of String(diff || '').split('\n')) {
    if (l.startsWith('@@')) { inHunk = true; continue; }
    if (l.startsWith('diff --git ')) { inHunk = false; continue; }
    if (!inHunk) continue;
    if (l[0] === '+') a++; else if (l[0] === '-') d++;
  }
  return { added: a, removed: d };
}

/** The nearest directory that still exists, for a file that no longer does. */
function existingDir(p) {
  let d = path.dirname(p);
  while (d && d !== path.dirname(d)) { try { if (fs.statSync(d).isDirectory()) return d; } catch (e) { /* up */ } d = path.dirname(d); }
  return null;
}

/** @returns {{files: {path, root, branch, git, untracked, committed, deleted, ignored, secret, outside, error, diff, added, removed}[], roots}} */
function of(paths) {
  const out = [], roots = new Map(), seen = new Set();
  const home = (() => { try { return fs.realpathSync(Env.get('FILES_ROOT') || Paths.home()); } catch (e) { return Paths.home(); } })();
  for (const p of [...new Set(paths)].slice(0, MAX_FILES)) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    let real = null, gonePath = null;
    try { real = fs.realpathSync(p); } catch (e) {
      // gone: resolve what still exists above it, so /var and /private/var agree
      const d = existingDir(p);
      try { gonePath = d ? fs.realpathSync(d) + p.slice(d.length) : p; } catch (x) { gonePath = p; }
    }
    // one file under two names (a symlink) is one file
    const k = real || gonePath;
    if (seen.has(k)) continue;
    seen.add(k);
    const outside = !((real || gonePath) === home || (real || gonePath).startsWith(home + path.sep));
    // said, not hidden: a change the review cannot show is still a change
    if (outside) { out.push({ path: p, outside: true, diff: '', added: 0, removed: 0 }); continue; }
    if (View.SECRET.test((real || gonePath).slice(home.length))) { out.push({ path: p, secret: true, diff: '', added: 0, removed: 0 }); continue; }
    const gone = !real;
    const dir = gone ? existingDir(p) : path.dirname(real);
    const root = dir ? (git(dir, ['rev-parse', '--show-toplevel']) || '').trim() : '';
    if (!root) { out.push({ path: p, git: false, deleted: gone, diff: '', added: 0, removed: 0 }); continue; }
    if (!roots.has(root)) roots.set(root, rootOf(root));
    const rev = roots.get(root).rev || 'HEAD';
    const target = real || gonePath;
    const tracked = git(root, ['ls-files', '--error-unmatch', '--', target]) !== null;
    if (!tracked) {
      if (gone) { out.push({ path: p, root, git: true, deleted: true, diff: '', added: 0, removed: 0 }); continue; }
      // ignored by git (.env, build output): named, not shown
      if (git(root, ['check-ignore', '-q', '--', target]) !== null) { out.push({ path: p, root, git: true, ignored: true, diff: '', added: 0, removed: 0 }); continue; }
      // a new file: all of it is the change
      const v = View.read(p);
      const lines = String(v.text || '').replace(/\n$/, '').split('\n');
      const diff = v.kind === 'text' || v.kind === 'md' ? lines.map((l) => '+' + l).join('\n') : '';
      out.push({ path: p, root, git: true, untracked: true, diff: diff.slice(0, MAX_DIFF), added: v.text ? lines.length : 0, removed: 0 });
      continue;
    }
    const diff = git(root, ['diff', rev, '--no-color', '--no-ext-diff', '--', target]);
    // git failed (too big, too slow): say so — an empty answer would read as "committed"
    if (diff === null) { out.push({ path: p, root, git: true, error: tr('差分が大きすぎるか、時間内に取れませんでした'), diff: '', added: 0, removed: 0 }); continue; }
    // no diff: committed since (or never changed); still listed, the review is of the session
    out.push({ path: p, root, git: true, deleted: gone, committed: !diff && rev === 'HEAD', diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF, ...count(diff) });
  }
  return { files: out, roots: [...roots.values()].map(({ rev, ...r }) => r) };
}

/**
 * A repository and what its diffs are taken against: HEAD on the base branch, else the
 * merge-base (a session that commits as it goes would otherwise leave nothing to review).
 */
function rootOf(root) {
  const branch = (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
  if (!branch || branch === 'HEAD') return { root, branch };
  const base = require('./pr.js').baseOf(root);
  if (!base || base.replace(/^origin\//, '') === branch) return { root, branch };
  const mb = (git(root, ['merge-base', base, 'HEAD']) || '').trim();
  return mb ? { root, branch, since: base, rev: mb } : { root, branch };
}

module.exports = { of, count };
