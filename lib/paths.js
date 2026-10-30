'use strict';
/**
 * paths.js — where the board's and the agents' files live. Resolved on each call,
 * never at module load, so tests that repoint HOME / RALLY_* / CLAUDE_CONFIG_DIR work.
 *
 * Two roots for the board's own files, on purpose apart:
 *   akDir()   ~/.rally, whatever RALLY_HOME says
 *   akHome()  RALLY_HOME, else ~/.rally
 * and two for Claude's:
 *   home('.claude', …)  always under $HOME
 *   claudeDir(…)        CLAUDE_CONFIG_DIR, else ~/.claude
 */
const Env = require('./env.js');
const { NAMES } = require('./names.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** The board's directory name, under a home or a project. */
const DIRNAME = '.' + NAMES[0];
/** What the directory was called before, newest first: each is kept as a link to the current one (migrate). */
const LEGACY_DIRNAMES = NAMES.slice(1).map((n) => '.' + n);

// no parts: the root as it is (an env value is not normalized by path.join)
const under = (root, parts) => parts.length ? path.join(root, ...parts) : root;

/** $HOME, or a path under it. */
function home(...parts) { return under(os.homedir(), parts); }
/** ~/.rally, or a path under it. */
function akDir(...parts) { return path.join(os.homedir(), DIRNAME, ...parts); }
/** RALLY_HOME (else ~/.rally), or a path under it. */
function akHome(...parts) { return under(Env.get('HOME') || akDir(), parts); }
/** CLAUDE_CONFIG_DIR (else ~/.claude), or a path under it. */
function claudeDir(...parts) { return under(process.env.CLAUDE_CONFIG_DIR || home('.claude'), parts); }

/** The same path under each old name (~/.agentkanban/…), newest old name first: what an old settings.json or an old ptyd's socket still names. */
function legacyDirs(...parts) { return LEGACY_DIRNAMES.map((d) => path.join(os.homedir(), d, ...parts)); }

/**
 * Move an old data directory (~/.<earlier name>) to ~/.rally and leave the old name as a
 * symlink, so paths that still name it (settings.json's hook, a running ptyd's socket) resolve.
 * Idempotent; acts only when an old name is a real directory and the new one is absent, and
 * undoes the rename if the link fails. DataDir.swift does the same natively — keep them in step.
 * @returns 'migrated' | 'none' | 'linked' (already done) | 'both' (left alone) | 'failed'
 */
function migrate(names = NAMES, home = os.homedir()) {
  const newP = path.join(home, '.' + names[0]);
  const kind = (p) => { try { const s = fs.lstatSync(p); return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : 'file'; } catch (e) { return 'none'; } };
  const olds = names.slice(1).map((n) => path.join(home, '.' + n));
  const src = olds.find((p) => kind(p) === 'dir');
  if (!src) return olds.some((p) => kind(p) === 'link') ? 'linked' : 'none';
  if (kind(newP) !== 'none') return 'both';
  try { fs.renameSync(src, newP); } catch (e) { return 'failed'; }
  try { fs.symlinkSync(path.basename(newP), src); } catch (e) {
    try { fs.renameSync(newP, src); } catch (x) { /* nothing more to do: the data is at the new path, and says so */ }
    return 'failed';
  }
  return 'migrated';
}

module.exports = { DIRNAME, LEGACY_DIRNAMES, home, akDir, akHome, legacyDirs, claudeDir, migrate };
