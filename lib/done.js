'use strict';
/**
 * done.js — 完了 is a state you set, not one the clock infers (a quiet session
 * may be abandoned, not finished). Kept in ~/.rally/done.json.
 * `wrapup`: 'memory' (asked to save what it learned), 'none', or 'queued'
 * (the ask is waiting in queue.js).
 */
const Env = require('./env.js');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

const NAME = 'rally';
const MAX_NOTE = 400;
const WRAPUPS = ['none', 'memory', 'queued'];
const REOPEN_GRACE_MS = 60000;

function donePath() {
  return Env.get('DONE') || Paths.akDir('done.json');
}

function read() {
  const j = Fsx.readJSON(donePath(), null);
  return j && typeof j === 'object' && j.byId ? j : { byId: {} };
}

function write(store) {
  Fsx.writeJSONAtomic(donePath(), store);
}

/** Read-modify-write under done.json's lock: several processes write it. */
function update(fn) {
  return Fsx.withLock(donePath(), () => { const store = read(); const out = fn(store); write(store); return out; });
}

function key(agent, id) { return `${agent}:${id}`; }

/** Mark one session finished. Returns what was stored. */
function set({ agent, id, note, wrapup, lane }) {
  if (!agent || !id) throw new Error('agent and session are required');
  return update((store) => {
    store.byId[key(agent, id)] = {
      at: Date.now(),
      note: String(note || '').slice(0, MAX_NOTE),
      wrapup: WRAPUPS.includes(wrapup) ? wrapup : 'none',
      // 'stale': put in Waiting by hand (待ちにする), not closed
      ...(lane === 'stale' ? { lane: 'stale' } : {}),
    };
    return store.byId[key(agent, id)];
  });
}

/** Put back a record exactly as it was (lib/board/send.js finish, when its ask did not go). */
function put({ agent, id, value }) {
  return update((store) => { store.byId[key(agent, id)] = value; return value; });
}

/** The held wrap-up was delivered: 'queued' becomes 'memory'; anything else is left alone. */
function delivered({ agent, id }) {
  return update((store) => {
    const v = store.byId[key(agent, id)];
    if (!v || v.wrapup !== 'queued') return null;
    v.wrapup = 'memory';
    v.wrapAt = Date.now();
    return v;
  });
}

/** Take it back: the session returns to whichever lane its transcript says. */
function clear({ agent, id }) {
  return update((store) => {
    delete store.byId[key(agent, id)];
    return { done: Object.keys(store.byId).length };
  });
}

/** Move finished cards into the 完了 lane, whatever their transcript's recency says. */
function apply(cards, store) {
  const s = store || read();
  const reopened = [];
  for (const c of cards) {
    const v = s.byId[key(c.agent, c.id)];
    if (!v) continue;
    // spoken to again in its terminal: reopen. The grace covers the wrap-up ask's own turn.
    if (v.wrapup !== 'queued' && c.turnStart && c.turnStart > Math.max(v.at || 0, v.wrapAt || 0) + REOPEN_GRACE_MS) {
      delete s.byId[key(c.agent, c.id)];
      reopened.push([key(c.agent, c.id), v.at]);
      continue;
    }
    if (v.lane === 'stale') {
      // set aside, not hidden: a card at work or asking for a permission stays where it can be seen
      if (c.column === 'working' || c.column === 'approval') continue;
      c.parked = v;
      c.column = 'stale';
      c.reason = 'あなたが待ちにしました';
      continue;
    }
    c.done = v;
    c.column = 'done';
    c.reason = v.wrapup === 'memory' ? 'あなたが完了にしました(学びを保存)' : 'あなたが完了にしました';
  }
  // replay onto the current file, skipping records set anew meanwhile
  if (reopened.length && !store) {
    try { update((cur) => { for (const [k, at] of reopened) if (cur.byId[k] && cur.byId[k].at === at) delete cur.byId[k]; }); } catch (e) { /* shown open either way */ }
  }
  return s;
}

module.exports = { WRAPUPS, donePath, read, write, update, set, put, delivered, clear, apply };
