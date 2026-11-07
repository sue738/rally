'use strict';
/**
 * git.js — what a prompt shows: repo root, branch, dirty count, ahead/behind.
 * Read-only, 2s cap per command; a non-repository answers null.
 */
const { execFileSync } = require('child_process');

const TIMEOUT_MS = 2000;
// A repository's .git/config can make git run commands (core.fsmonitor, hooks, diff.external).
// The board runs git in directories it did not choose, so those are off for every call.
const SAFE_GIT = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'log.showSignature=false'];

// …and so can its filter drivers (filter.X.clean / smudge / process run on status and diff; diff.X.textconv on diff:
// `--no-textconv` there). Each driver the repository defines is overridden to do nothing, through GIT_CONFIG_* (a -c
// cannot carry a driver name with "=" in it). Git LFS's own standard commands are left as they are.
const LFS = { clean: 'git-lfs clean -- %f', smudge: 'git-lfs smudge -- %f', process: 'git-lfs filter-process', required: 'true' };
const GUARD_MS = 10 * 1000;
const guardCache = new Map();
function guardEnv(dir) {
  const hit = guardCache.get(dir);
  if (hit && Date.now() - hit.at < GUARD_MS) return hit.env;
  let out = '';
  try { out = execFileSync('git', ['config', '-z', '--get-regexp', '^filter\\.'], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { out = ''; }
  const drivers = new Map();
  for (const rec of out.split('\0')) {
    const nl = rec.indexOf('\n'), key = nl < 0 ? rec : rec.slice(0, nl), val = nl < 0 ? '' : rec.slice(nl + 1);
    const m = /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(key);
    if (m) { const d = drivers.get(m[1]) || {}; d[m[2].toLowerCase()] = val; drivers.set(m[1], d); }
  }
  const kv = [];
  for (const [name, d] of drivers) {
    if (name === 'lfs' && Object.entries(d).every(([k, v]) => LFS[k] === v)) continue;
    kv.push([`filter.${name}.clean`, 'cat'], [`filter.${name}.smudge`, 'cat'], [`filter.${name}.process`, ''], [`filter.${name}.required`, 'false']);
  }
  const env = { GIT_CONFIG_COUNT: String(kv.length) };
  kv.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  if (guardCache.size > 200) guardCache.clear();
  guardCache.set(dir, { at: Date.now(), env });
  return env;
}

/** git in a directory the board did not choose: SAFE_GIT plus this repository's drivers turned off. Throws like execFileSync. */
function exec(dir, args, o = {}) {
  return execFileSync('git', [...SAFE_GIT, ...args], { cwd: dir, encoding: 'utf8', timeout: o.timeout || TIMEOUT_MS,
    ...(o.maxBuffer ? { maxBuffer: o.maxBuffer } : {}), stdio: o.stdio || ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, ...guardEnv(dir) } });
}

function git(dir, args) {
  try { return exec(dir, args).trim(); } catch (e) { return null; }
}

/** @returns {{branch, dirty, ahead, behind, root}|null} */
function info(dir) {
  if (!dir) return null;
  const root = git(dir, ['rev-parse', '--show-toplevel']);
  if (!root) return null;
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
  const status = git(dir, ['status', '--porcelain']) || '';
  const dirty = status ? status.split('\n').filter(Boolean).length : 0;
  let ahead = 0, behind = 0;
  const counts = git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (counts) {
    const [a, b] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0);
    ahead = a; behind = b;
  }
  return { root, branch, dirty, ahead, behind };
}

module.exports = { info, exec, guardEnv, SAFE_GIT };
