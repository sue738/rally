'use strict';
/**
 * sessionIndex.js — agent + id → transcript file, so opening a card does not
 * cost a scan.
 *
 * Written only from the board's own scans, never from a request: a path that
 * did not come out of a scan is never served.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

const NAME = 'rally';
const MAX = 4000;                      // newest first; a year of sessions fits

function indexPath() {
  return Env.get('INDEX') || Paths.akDir('session-index.json');
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    return j && typeof j === 'object' && j.byId ? j : { byId: {} };
  } catch (e) { return { byId: {} }; }
}

function write(store) {
  Fsx.writeJSONAtomic(indexPath(), store, undefined, 0);
}

function key(agent, id) { return `${agent}:${id}`; }

function lastT(s) {
  // a scan record has events, not lastT
  if (s.lastT) return s.lastT;
  const ev = s.events;
  for (let i = (ev && ev.length ? ev.length - 1 : -1); i >= 0; i--) if (ev[i] && ev[i].t) return ev[i].t;
  return 0;
}

/** Record what a scan found; writes only when something changed. */
function put(sessions, opts = {}) {
  const store = opts.store || read();
  let changed = 0;
  for (const s of sessions || []) {
    if (!s || !s.agent || !s.id || !s.file) continue;
    const k = key(s.agent, s.id);
    const prev = store.byId[k];
    const t = lastT(s);
    if (prev && prev[0] === s.file && prev[1] === t) continue;
    // the project too: codex refuses to resume outside its own directory
    store.byId[k] = [s.file, t, s.project || ''];
    changed++;
  }
  if (!changed) return store;
  const keys = Object.keys(store.byId);
  if (keys.length > MAX) {
    keys.sort((a, b) => (store.byId[b][1] || 0) - (store.byId[a][1] || 0));
    const kept = {};
    for (const k of keys.slice(0, MAX)) kept[k] = store.byId[k];
    store.byId = kept;
  }
  write(store);
  return store;
}

/**
 * One session's {file, project}, or null. The file must still exist and
 * still sit under the agent's transcript root — a stale entry is a miss,
 * not a read of whatever now lives at that path.
 */
function lookup(agent, id, opts = {}) {
  if (!agent || !id) return null;
  const v = (opts.store || read()).byId[key(agent, id)];
  if (!v) return null;
  const file = v[0];
  const root = opts.root || rootFor(agent);
  if (root && !path.resolve(file).startsWith(path.resolve(root) + path.sep)) return null;
  try { if (!fs.statSync(file).isFile()) return null; } catch (e) { return null; }
  return { file, project: v[2] || '' };
}

function rootFor(agent) {
  try {
    const r = require('./vendor/readers/index.js').byName(agent);
    return r && r.defaultDir ? r.defaultDir() : null;
  } catch (e) { return null; }
}

module.exports = { MAX, indexPath, read, write, put, lookup, rootFor, lastT };
