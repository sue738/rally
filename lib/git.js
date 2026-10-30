'use strict';
/**
 * git.js — what a prompt shows: repo root, branch, dirty count, ahead/behind.
 * Read-only, 2s cap per command; a non-repository answers null.
 */
const { execFileSync } = require('child_process');

const TIMEOUT_MS = 2000;
// A repository's .git/config can make git run commands (core.fsmonitor, hooks, diff.external).
// The board runs git in directories it did not choose, so those are off for every call.
const SAFE_GIT = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', '-c', 'core.pager=cat'];

function git(dir, args) {
  try {
    return execFileSync('git', [...SAFE_GIT, ...args], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
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

module.exports = { info, SAFE_GIT };
