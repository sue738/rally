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
  try { return require('./git.js').exec(dir, args, { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }); }
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

/** The folder the review may read under: home (RALLY_FILES_ROOT in tests). */
function homeDir() { try { return fs.realpathSync(Env.get('FILES_ROOT') || Paths.home()); } catch (e) { return Paths.home(); } }

/**
 * Where a path really is, and whether the review may show it: not outside home, not a key or credential.
 * A file that is gone resolves through what still exists above it, so /var and /private/var agree.
 */
function screen(p, home = homeDir()) {
  let real = null, gonePath = null;
  try { real = fs.realpathSync(p); } catch (e) {
    const d = existingDir(p);
    try { gonePath = d ? fs.realpathSync(d) + p.slice(d.length) : p; } catch (x) { gonePath = p; }
  }
  const k = real || gonePath;
  const outside = !(k === home || k.startsWith(home + path.sep));
  return { real, gonePath, outside, secret: !outside && View.SECRET.test(k.slice(home.length)) };
}

/** The repository a path is in ('' outside one) and whether git ignores it there (named, not shown: build output, tokens). */
function placeOf(p) {
  let real = null; try { real = fs.realpathSync(p); } catch (e) { /* gone */ }
  const dir = real ? path.dirname(real) : existingDir(p);
  const root = dir ? (git(dir, ['rev-parse', '--show-toplevel']) || '').trim() : '';
  if (!root) return { root: '', ignored: false };
  return { root, ignored: git(root, ['check-ignore', '-q', '--', real || p]) !== null };
}

/**
 * Two texts' diff, by git outside any repository (no repository's config runs). null for a side means the file was
 * not there: the diff is then all added or all removed. Returns null when git fails, '' when they are the same.
 */
function textDiff(before, after) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rally-diff-'));
  try {
    const side = (name, text) => { if (text == null) return '/dev/null'; fs.writeFileSync(path.join(dir, name), text, { mode: 0o600 }); return name; };
    const a = side('a', before), b = side('b', after);
    const args = [...SAFE_GIT, 'diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--', a, b];
    try { return execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }); }
    // --no-index answers 1 when the files differ
    catch (e) { return e && e.status === 1 && typeof e.stdout === 'string' ? e.stdout : null; }
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ } }
}

/**
 * Each file's path inside its repository (rel), from where it really is: a project reached through a symlink
 * (/var → /private/var, a linked ~/src) has a root that its path as written does not start with, and the
 * viewer showed the whole path for every file.
 */
function withRel(files, home = homeDir()) {
  for (const f of files) {
    if (!f.root) continue;
    const s = screen(f.path, home), k = s.real || s.gonePath;
    if (k && k.startsWith(f.root + path.sep)) f.rel = k.slice(f.root.length + 1);
  }
  return files;
}

/** @returns {{files: {path, root, rel, branch, git, untracked, committed, deleted, ignored, secret, outside, error, diff, added, removed}[], roots}} */
function of(paths) {
  const out = [], roots = new Map(), seen = new Set();
  const home = homeDir();
  for (const p of [...new Set(paths)].slice(0, MAX_FILES)) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    const { real, gonePath, outside, secret } = screen(p, home);
    // one file under two names (a symlink) is one file
    const k = real || gonePath;
    if (seen.has(k)) continue;
    seen.add(k);
    // said, not hidden: a change the review cannot show is still a change
    if (outside) { out.push({ path: p, outside: true, diff: '', added: 0, removed: 0 }); continue; }
    if (secret) { out.push({ path: p, secret: true, diff: '', added: 0, removed: 0 }); continue; }
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
    const diff = git(root, ['diff', rev, '--no-color', '--no-ext-diff', '--no-textconv', '--', target]);
    // git failed (too big, too slow): say so — an empty answer would read as "committed"
    if (diff === null) { out.push({ path: p, root, git: true, error: tr('差分が大きすぎるか、時間内に取れませんでした'), diff: '', added: 0, removed: 0 }); continue; }
    // no diff: committed since (or never changed); still listed, the review is of the session
    out.push({ path: p, root, git: true, deleted: gone, committed: !diff && rev === 'HEAD', diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF, ...count(diff) });
  }
  return { files: withRel(out, home), roots: [...roots.values()].map(({ rev, ...r }) => r) };
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

module.exports = { of, count, homeDir, screen, placeOf, textDiff, withRel, MAX_FILES, MAX_DIFF };
