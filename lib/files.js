'use strict';
const { t: tr } = require('./i18n.js');
/**
 * files.js — file names under a project, for `@` in the message box: git's list
 * (tracked + untracked, less ignored) in a work tree, else a shallow walk.
 * Names only, never contents, and only under your home directory.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');

const MAX = 20000;
const SKIP = new Set(['.git', 'node_modules', '.build', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', 'vendor', '.cache', 'Library']);

function allowed(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  try {
    const real = fs.realpathSync(dir);
    const home = fs.realpathSync(Env.get('FILES_ROOT') || Paths.home());
    if (real !== home && !real.startsWith(home + path.sep)) return null;
    return fs.statSync(real).isDirectory() ? real : null;
  } catch (e) { return null; }
}

function fromGit(dir) {
  try {
    const out = execFileSync('git', [...require('./git.js').SAFE_GIT, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch (e) { return null; }
}

// macOS asks before an app reads these (a dialog for the board, or a read
// that just waits), and they are not where a session's project lives
const PROTECTED = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library', 'Applications', 'Public'];

/** find(1) in a child with a time limit: a readdir can block (network folder, permission prompt). Partial output is kept. */
function walk(dir, depth = 4, ms = 3000) {
  const home = fs.realpathSync(Paths.home());
  const prune = ['(', '-name', '.*', '-o', ...[...SKIP].flatMap((n) => ['-name', n, '-o'])];
  for (const n of PROTECTED) prune.push('-path', path.join(home, n), '-o');
  prune[prune.length - 1] = ')';
  const args = [dir, '-mindepth', '1', '-maxdepth', String(depth), ...prune, '-prune', '-o', '-type', 'f', '-print0'];
  let out = '';
  try { out = execFileSync('find', args, { encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = String((e && e.stdout) || ''); }       // timed out or a folder refused: keep what came
  const base = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return out.split('\0').filter((f) => f && f.startsWith(base)).map((f) => f.slice(base.length)).slice(0, MAX);
}

/** {dir, files, git, truncated} or {error}. */
function list(dir) {
  const d = allowed(dir);
  if (!d) return { dir, files: [], error: tr('このディレクトリは読めません') };
  const g = fromGit(d);
  // the home directory itself is not a project: two levels are enough to find one
  const all = g || walk(d, d === fs.realpathSync(Paths.home()) ? 2 : 4);
  return { dir, files: all.slice(0, MAX), git: !!g, truncated: all.length >= MAX };
}

module.exports = { list, allowed };
