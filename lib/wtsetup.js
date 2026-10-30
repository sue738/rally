'use strict';
const { t: tr } = require('./i18n.js');
/**
 * wtsetup.js — what a fresh worktree lacks, before a session starts in one.
 *
 * `claude --worktree` copies only tracked files plus what `.worktreeinclude`
 * names. This finds gitignored config files it does not cover and, on request,
 * adds them. A per-repo setup command (~/.rally/wtsetup.json) is prepended to
 * the first message by the page (lib/ui/js/45-wtsetup.js).
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Fsx = require('./fsx.js');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');
const { SAFE_GIT } = require('./git.js');

// ignored files worth carrying: configuration and secrets, not build output
const WORTH = /(^|\/)\.env($|\.)|(^|\/)\.dev\.vars$|\.local(\.[a-z0-9]+)?$|(^|\/)master\.key$|(^|\/)credentials(\.[a-z0-9]+)?$|(^|\/)\.npmrc$|(^|\/)\.secrets?(\.|$)/i;
const SKIP = /(^|\/)(node_modules|vendor|dist|build|target|\.git|\.venv|venv|__pycache__|\.next|\.cache|tmp|log|coverage)\//;
const MAX = 30;

function git(dir, args) {
  try { return execFileSync('git', [...SAFE_GIT, ...args], { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
}
const list = (out) => String(out || '').split('\n').filter(Boolean);

function file() { return Env.get('WTSETUP') || Paths.akHome('wtsetup.json'); }
function read() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch (e) { return {}; } }

/** The ignored files that look like configuration, relative to the root. */
function candidates(root) {
  return list(git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']))
    .filter((f) => WORTH.test(f) && !SKIP.test(f)).slice(0, MAX);
}

/**
 * @returns {null | {root, include, candidates, copied, missing, setup}}
 *   include: the root has a .worktreeinclude
 *   copied: candidates it names; missing: the ones it does not
 */
function inspect(dir) {
  if (!dir) return null;
  dir = String(dir).replace(/^~(?=\/|$)/, Paths.home());
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const root = top.trim();
  const inc = path.join(root, '.worktreeinclude');
  const include = fs.existsSync(inc);
  const cands = candidates(root);
  // what Claude Code would copy: untracked files the include file matches
  const matched = include ? new Set(list(git(root, ['ls-files', '--others', '--ignored', '--exclude-from=' + inc]))) : new Set();
  const copied = cands.filter((f) => matched.has(f));
  const missing = cands.filter((f) => !matched.has(f));
  return { root, include, candidates: cands, copied, missing, setup: String(read()[root] || '') };
}

/**
 * Add files to the root's .worktreeinclude. Only names that are candidates
 * right now: the request says which, never what the file gets to contain.
 */
function include(dir, files) {
  const s = inspect(dir);
  if (!s) return { error: tr('git のリポジトリではありません') };
  const add = [...new Set(files || [])].filter((f) => s.missing.includes(f));
  if (!add.length) return { ok: true, added: [], ...inspect(dir) };
  const inc = path.join(s.root, '.worktreeinclude');
  let cur = '';
  try { cur = fs.readFileSync(inc, 'utf8'); } catch (e) { cur = '# gitignore 対象のうち、git worktree に写すもの(Claude Code が読みます)\n'; }
  if (cur && !cur.endsWith('\n')) cur += '\n';
  // a literal name: a leading / anchors it to the root, and []*?! are escaped
  fs.writeFileSync(inc, cur + add.map((f) => '/' + f.replace(/([[\]*?!\\#])/g, '\\$1')).join('\n') + '\n');
  return { ok: true, added: add, ...inspect(dir) };
}

/** Keep (or with '' drop) the setup command for the repository of `dir`. */
function setSetup(dir, cmd) {
  const s = inspect(dir);
  if (!s) return { error: tr('git のリポジトリではありません') };
  const m = read();
  const v = String(cmd || '').replace(/\r?\n/g, ' ').trim().slice(0, 500);
  if (v) m[s.root] = v; else delete m[s.root];
  Fsx.writeJSONAtomic(file(), m, undefined, 1);
  return { ok: true, ...inspect(dir) };
}

module.exports = { WORTH, file, read, candidates, inspect, include, setSetup };
