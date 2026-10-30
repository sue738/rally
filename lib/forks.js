'use strict';
/**
 * forks.js — which session was forked from which. A --fork-session transcript
 * does not say where it came from, so the board records the link when it forks.
 */
const Env = require('./env.js');
const fs = require('fs');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

function file() { return Env.get('FORKS') || Paths.akHome('forks.json'); }
function read() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch (e) { return {}; } }

/** Record that `child` was cut from `parent`. */
function set(child, parent) {
  if (!child || !parent || child === parent) return;
  const m = read();
  m[child] = { parent, at: Date.now() };
  Fsx.writeJSONAtomic(file(), m, undefined, 1);
}

/** c.forkOf on a fork, c.forks (newest first) on the session it was cut from. */
function apply(cards) {
  const m = read();
  const kids = new Map();
  for (const c of cards) {
    const v = c.agent === 'claude' && m[c.id];
    if (!v) continue;
    c.forkOf = v.parent;
    if (!kids.has(v.parent)) kids.set(v.parent, []);
    kids.get(v.parent).push({ id: c.id, at: v.at });
  }
  for (const c of cards) {
    const k = c.agent === 'claude' && kids.get(c.id);
    if (k) c.forks = k.sort((a, b) => b.at - a.at).map((x) => x.id);
  }
}

module.exports = { file, read, set, apply };
