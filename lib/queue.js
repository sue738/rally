'use strict';
/**
 * queue.js — instructions held until a session is free.
 *
 * Resuming a running session forks a copy (claude CLI), so a message is held
 * here until the session stops, then continued in place with
 * `claude --bg --resume <full id>`. An idle background session is stopped and
 * continued at once. 今の作業後に送る (`whenFree`) items wait for idle and go
 * one per turn, in order, never merged.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Dispatch = require('./dispatch.js');
const Done = require('./done.js');
const Relay = require('./relay.js');
const Fsx = require('./fsx.js');

const NAME = 'rally';
const MAX_TEXT = 4000;
const MAX_ITEMS = 50;
// a drain's claim on an item: longer than any send, short enough not to strand one if the drain dies
const CLAIM_MS = 120000;
// after this many failures an item stops being retried and stays on the card with the error
const MAX_FAILS = 5;
// a failed send is tried again after a wait that grows (seconds), so a moment's trouble is over by then
// and five quick failures do not use up the tries before it is
const BACKOFF_S = [5, 15, 45, 120];
const backoffMs = (fails) => Env.get('QUEUE_BACKOFF') === '0' ? 0 : 1000 * BACKOFF_S[Math.min(Math.max(fails, 1), BACKOFF_S.length) - 1];
/** An item that is given up on (shown as failed), as against one that fell over once and will be tried again. */
const stopped = (q) => !!(q.fails && ((q.fails || 0) >= MAX_FAILS || q.unsure || q.cliKept));
/** Every failure, for finding out why sends fall over: ~/.rally/queue-fails.jsonl (best effort). */
function logFail(i, error, fails) {
  try {
    const f = Paths.akHome('queue-fails.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ t: Date.now(), agent: i.agent, id: i.id, whenFree: !!i.whenFree, fails, error: String(error || '').slice(0, 300) }) + '\n');
  } catch (e) { /* the log is a convenience */ }
}
const UNCHECKED = 'Claude がこのセッションの状態を確認できず、続きではなくコピーを作ってしまいます。端末で開いて届けてください';
const LOCK_WAIT_MS = 5000;
// whenFree: the wait after a delivery when the session was never seen busy in between
const GAP_MS = 60000;
const LOCK_STALE_MS = 10000;
// a drain runs inside the app's one-shot `state`, killed at 60 s: no new send after this
const DRAIN_BUDGET_MS = 20000;
const INTERRUPTED = '送信の途中で中断しました。届いたかどうか会話を確かめてから、もう一度送ってください';

function queuePath() {
  return Env.get('QUEUE') || Paths.akDir('queue.json');
}

function read() {
  const j = Fsx.readJSON(queuePath(), null);
  return Array.isArray(j && j.items) ? j.items : [];
}

/** Past MAX_ITEMS the oldest go — never one in flight, and never the newest. */
function write(items) {
  const now = Date.now();
  let over = items.length - MAX_ITEMS;
  const kept = over > 0 ? items.filter((i, k) => !(over > 0 && k < items.length - 1 && !inflight(i, now) && over-- > 0)) : items;
  Fsx.writeJSONAtomic(queuePath(), { items: kept });
}

// The board server, the app's `state` refreshes and the CLI all read-modify-write queue.json.
function withLock(fn) {
  return Fsx.withLock(queuePath(), fn, { waitMs: LOCK_WAIT_MS, staleMs: LOCK_STALE_MS });
}

const claimed = (i, now) => !!(i.claim && now - i.claim.at < CLAIM_MS);
// handed to a relay carrier (lib/relay.js) whose answer is not in yet
const relaying = (i) => !!(i && i.relay);
// being sent: not to be merged, taken back or sent again
const inflight = (i, now) => claimed(i, now) || relaying(i);
const same = (a, b) => a.agent === b.agent && a.id === b.id;
const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// whenFree: closed after a delivery until the session is seen at work again, or GAP_MS.
// Right after a delivery `claude agents` can still say idle, and the next would share its turn.
function gated(i, now = Date.now()) {
  return !!(i && i.after && !i.busySeen && now - i.after < GAP_MS);
}

/**
 * whenFree: may this held message go now? `a` is the session's alive.js entry
 * (undefined: not running).
 */
function ready(i, a, now = Date.now()) {
  if (!i || gated(i, now)) return false;
  if (!a) return true;
  if (a.status === 'idle') return true;
  // busy only with background tasks, its turn ended after the last delivery: it is
  // waiting on you (mirrors 22-whenfree.js wfBusy); handed over, not stopped
  return a.status === 'busy' && !!a.endedAt && a.endedAt > (i.after || 0);
}

/** Two held items for one session, as one: the older text first. */
function merge(older, newer) {
  return { ...newer,
    text: `${older.text}\n\n${newer.text}`.slice(0, MAX_TEXT * 2),
    model: String(newer.model || older.model || ''),
    dir: newer.dir || older.dir || '',
    attachments: [...new Set([...(older.attachments || []), ...(newer.attachments || [])])],
    wrapup: !!(older.wrapup || newer.wrapup) };
}

/**
 * Hold one instruction for a busy session, with its own directory (codex
 * won't resume outside it; claude would lose the project's permissions) and
 * attachments. A second message for the session is appended to the first
 * unless that one is in flight. `wrapup` marks the 完了 ask for done.json.
 */
function add({ agent, id, text, model, dir, attachments, wrapup, whenFree, type, ours, relay }) {
  const t = String(text || '').trim().slice(0, MAX_TEXT);
  if (!agent || !id) throw new Error('agent and session are required');
  Dispatch.resumableId(agent, id);
  if (!t) throw new Error('text is empty');
  const files = (attachments || []).filter((f) => typeof f === 'string').slice(0, 20);
  return withLock(() => {
    const items = read();
    const now = Date.now();
    // the CLI delivers what it kept itself; merging into it would deliver it twice
    for (let k = items.length - 1; k >= 0; k--) if (items[k].agent === agent && items[k].id === id && items[k].cliKept) items.splice(k, 1);
    // never merged: whenFree, a relay already handed over, or one that may have arrived (unsure)
    const at = whenFree || relay ? -1 : items.findIndex((i) => i.agent === agent && i.id === id && !inflight(i, now) && !i.whenFree && !i.unsure);
    const item = { key: newKey(), agent, id, text: t, model: String(model || ''), dir: dir || '', attachments: files, wrapup: !!wrapup, at: now };
    if (whenFree) Object.assign(item, { whenFree: true, ...(type ? { type: true } : {}), ...(ours ? { ours: true } : {}) });
    if (relay) item.relay = { log: String(relay.log || ''), pid: relay.pid || 0, at: now };
    if (at >= 0) items.push({ ...merge(items.splice(at, 1)[0], item), fails: 0, error: '' });
    else items.push(item);
    write(items);
    return { queued: Math.min(items.length, MAX_ITEMS), merged: at >= 0, key: item.key };
  });
}

/**
 * A card whose next instruction is already held is not waiting on you: it shows in Working until the
 * message goes out. A send that failed is yours to look at, so that card stays in Your Turn.
 */
function laneOf(cards) {
  for (const c of cards) {
    if (c.column !== 'needs-you' || !c.queued || c.queuedFails) continue;
    // held for a terminal somebody has open, it goes when that closes: nothing is running, so it is not Working
    if (c.alive && c.aliveKind === 'interactive' && !(c.held && c.held.length && !c.queuedPlain && c.held.every((h) => h.ours))) continue;
    c.column = 'working';
    c.reason = '送るメッセージを預かっています(手が空いたら届き、動き出します)';
  }
  return cards;
}

/**
 * Take held messages back: all of a session's, only non-whenFree (`plain`), or
 * one (`key`). One in flight is never taken: it is going anyway. `delivered`:
 * the page typed it into its terminal, so close the gate as after a send.
 */
function remove({ agent, id, key, plain, delivered }) {
  return withLock(() => {
    const now = Date.now();
    const all = read();
    const hit = (i) => same(i, { agent, id }) && (key ? i.key === key : plain ? !i.whenFree : true);
    const busy = all.filter((i) => hit(i) && inflight(i, now));
    const items = all.filter((i) => !hit(i) || busy.includes(i));
    const taken = all.filter((i) => hit(i) && !busy.includes(i));
    if (delivered && taken.length) for (const i of items) if (same(i, { agent, id }) && i.whenFree) { i.after = now; delete i.busySeen; }
    write(items);
    return { queued: items.length, removed: taken.length, ...(busy.length ? { claimed: true } : {}), ...(key && taken[0] ? { item: taken[0] } : {}) };
  });
}

/** Rewrite one held message's text where it stands in line; one in flight is not changed. */
function edit({ agent, id, key, text }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('空のメッセージにはできません(取り消すなら 取り消す)');
  return withLock(() => {
    const now = Date.now();
    const items = read();
    const x = items.find((i) => same(i, { agent, id }) && i.key === key);
    if (!x) return { edited: false };
    if (inflight(x, now)) return { edited: false, claimed: true };
    x.text = t;
    write(items);
    return { edited: true };
  });
}

/**
 * Claim one held message for a send outside a drain (今すぐ送る). {claimed: true}
 * when it is in flight; {item, token} when it is now the caller's — `release` it after.
 */
function take({ agent, id, key }) {
  return withLock(() => {
    const now = Date.now();
    const items = read();
    const x = items.find((i) => same(i, { agent, id }) && i.key === key);
    if (!x) return {};
    if (inflight(x, now)) return { claimed: true };
    const token = `now-${process.pid}-${now}-${Math.random().toString(36).slice(2)}`;
    x.claim = { token, at: now, going: true };
    write(items);
    return { item: { ...x }, token };
  });
}

/** After `take`: `done` takes it out; otherwise it is held again, with `error`. */
function release({ agent, id, key, token, done, error }) {
  return withLock(() => {
    const items = read();
    const k = items.findIndex((i) => same(i, { agent, id }) && i.key === key && i.claim && i.claim.token === token);
    if (k < 0) return { released: false };
    if (done) items.splice(k, 1);
    else {
      const x = items[k];
      delete x.claim;
      if (error) { x.fails = (x.fails || 0) + 1; x.error = error; }
    }
    write(items);
    return { released: true };
  });
}

/** Clear a stopped item's failures so the next drain takes it; never one the CLI kept (double delivery). */
function retry({ agent, id }) {
  return withLock(() => {
    const items = read();
    let n = 0;
    for (const i of items) if (i.agent === agent && i.id === id && !i.cliKept && i.fails) { delete i.fails; delete i.error; delete i.unsure; delete i.retryAt; n++; }
    write(items);
    return { retried: n, queued: items.length };
  });
}

/** An idle background session: the board may stop and continue it now (not someone's terminal, not mid-turn). */
function wakeable(a) {
  return !!(a && a.kind === 'background' && a.status === 'idle' && a.short);
}

/** Attach the held messages to their cards; a failing send says why. */
function apply(cards, items) {
  const list = items || read();
  const now = Date.now();
  for (const c of cards) {
    const qs = list.filter((i) => i.agent === c.agent && i.id === c.id && !relaying(i));
    if (!qs.length) continue;
    c.queued = qs.map((q) => q.text).join('\n\n');
    c.queuedAt = qs[qs.length - 1].at;
    // whenFree ones are drawn in the thread, one each
    const plain = qs.filter((q) => !q.whenFree);
    if (plain.length !== qs.length) {
      c.queuedPlain = plain.map((q) => q.text).join('\n\n');
      c.held = qs.filter((q) => q.whenFree).map((q) => ({ key: q.key || '', text: q.text, at: q.at, model: q.model || '',
        ...(q.ours ? { ours: true } : {}), ...(gated(q, now) ? { gated: true } : {}), ...(stopped(q) ? { fails: q.fails, error: q.error || '' } : q.fails ? { retrying: q.fails } : {}) }));
    }
    // failed = given up on (yours to look at); one that fell over once is being tried again by itself, and says so only softly
    const failed = qs.find(stopped);
    if (failed) { c.queuedFails = failed.fails; c.queuedError = failed.error || ''; }
    else { const again = qs.find((q) => q.fails); if (again) { c.queuedRetry = again.fails; c.queuedError = again.error || ''; } }
  }
  return list;
}

/**
 * Settle relays from their carriers' logs: SENT takes the item out; a refusal
 * holds it again with the reason; no answer at all may have gone, so it is
 * kept `unsure` and not resent by itself. Mutates `items`.
 * @returns {boolean} whether anything changed
 */
function settleRelays(items, now, settled, failed) {
  let dirty = false;
  for (let k = items.length - 1; k >= 0; k--) {
    const x = items[k];
    if (!relaying(x)) continue;
    let r = null;
    try { r = Relay.result(x.relay.log, x.relay.pid); } catch (e) { r = null; }
    // the carrier's watchdog kills it at the timeout
    if (!r && now - (x.relay.at || 0) > Relay.timeoutMs() + 30000) r = { error: Relay.NO_ANSWER, unknown: true };
    if (!r) continue;
    dirty = true;
    if (r.sent) {
      items.splice(k, 1);
      settled.push({ agent: x.agent, id: x.id, key: x.key, relayed: true, log: x.relay.log });
      // from when it went, not when SENT was read: ready() compares endedAt with this
      const went = x.relay.at || now;
      for (const y of items) if (y.whenFree && same(y, x)) { y.after = went; delete y.busySeen; }
      if (x.wrapup) { try { Done.delivered({ agent: x.agent, id: x.id }); } catch (e) { /* the ask still went */ } }
      continue;
    }
    const log = x.relay.log;
    delete x.relay;
    x.fails = r.unknown ? MAX_FAILS : (x.fails || 0) + 1;
    x.error = String(r.error || '転送できませんでした').slice(0, 300);
    if (r.unknown) x.unsure = true; else x.retryAt = now + backoffMs(x.fails);
    logFail(x, x.error, x.fails);
    failed.push({ agent: x.agent, id: x.id, error: x.error, log });
  }
  return dirty;
}

/**
 * Deliver what can be delivered. `alive` is the map from alive.js.
 *
 * Items are claimed under the lock, and each outcome is written as soon as it
 * is known (the drain may be killed mid-way). Each claim is renewed as its
 * turn comes and marked `going` just before its send: an expired `going`
 * claim means a drain died mid-send, so it is held with INTERRUPTED, never resent.
 * @returns {{sent: Array, kept: number, failed: Array, settled: Array}} `settled`:
 *   relays handed over earlier whose carrier has now said SENT
 */
function drain(alive, opts = {}) {
  if (!alive) return { sent: [], kept: read().length, failed: [] };   // liveness unknown: hold
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  const budget = opts.budgetMs != null ? opts.budgetMs : DRAIN_BUDGET_MS;
  const sent = [];
  const failed = [];
  const settled = [];
  let mine;
  try {
    mine = withLock(() => {
      const now = Date.now();
      const raw = read();
      let dirty = settleRelays(raw, now, settled, failed);
      for (const i of raw) {
        if (!i.claim || !i.claim.going || claimed(i, now)) continue;
        delete i.claim;
        Object.assign(i, { fails: MAX_FAILS, error: INTERRUPTED, unsure: true });
        failed.push({ agent: i.agent, id: i.id, error: INTERRUPTED });
        dirty = true;
      }
      // whenFree: a session seen at work since its last delivery opens the gate
      for (const i of raw) {
        if (!i.whenFree || !i.after || i.busySeen) continue;
        const a = alive.get(i.id);
        if (a && a.status !== 'idle') { i.busySeen = true; dirty = true; }
      }
      const items = [];
      const busy = new Set();               // sessions a drain or a relay is sending to right now
      for (const i of raw) if (inflight(i, now)) busy.add(`${i.agent}\0${i.id}`);
      // one resume per session: a second right behind the first would find it running and fork a copy
      const mergeable = (x) => !inflight(x, now) && !x.whenFree && !x.unsure;
      for (const i of raw) {
        const prev = mergeable(i) && items.find((x) => same(x, i) && mergeable(x));
        if (prev) items[items.indexOf(prev)] = merge(prev, i); else items.push(i);
      }
      const pick = [];
      const first = new Set();              // one per session per drain, oldest first
      for (const i of items) {
        const k = `${i.agent}\0${i.id}`;
        if (inflight(i, now) || busy.has(k) || first.has(k) || (i.fails || 0) >= MAX_FAILS || (i.retryAt || 0) > now) continue;
        first.add(k);
        const a = alive.get(i.id);
        if (i.whenFree) {
          if (!ready(i, a, now)) continue;                        // at work, or its last one just went
          if (i.ours && (a || i.agent === 'codex')) continue;     // the page types it into the app's own terminal (codex: no alive entry when idle)
          if (a && !wakeable(a) && !opts.handOver) continue;      // idle, but nobody to hand it over
        } else if (a && !wakeable(a)) continue;                  // someone's terminal, or mid-task
        i.claim = { token, at: now };
        pick.push({ ...i });
      }
      if (pick.length || dirty) write(items);
      return pick;
    });
  } catch (e) { return { sent, kept: read().length, failed, settled }; }   // locked: the next refresh tries
  const byToken = (x) => x.claim && x.claim.token === token;
  // renew this item's claim (`going`: its send starts now); false when it is gone
  const touch = (i, going) => {
    try {
      return withLock(() => {
        const items = read();
        const x = items.find((y) => byToken(y) && same(y, i));
        if (!x) return false;
        x.claim.at = Date.now();
        if (going) x.claim.going = true;
        write(items);
        return true;
      });
    } catch (e) { return false; }            // locked: its claim runs out and the next drain takes it
  };
  // write one item's outcome now: sent, handed to a relay, or back with why not
  const settle = ({ i, done, relay, error, stop, unsure }) => {
    try {
      withLock(() => {
        const items = read();
        const k = items.findIndex((y) => byToken(y) && same(y, i));
        if (k < 0) return;
        const x = items[k];
        const at = Date.now();
        if (done) {
          items.splice(k, 1);
          for (const y of items) if (y.whenFree && same(y, i)) { y.after = at; delete y.busySeen; }
        } else if (relay) {
          delete x.claim;
          x.relay = { log: String(relay.log || ''), pid: relay.pid || 0, at };
        } else {
          delete x.claim;
          if (error) {
            x.fails = stop ? MAX_FAILS : (x.fails || 0) + 1; x.error = error;
            if (!stop) x.retryAt = at + backoffMs(x.fails);
            logFail(x, error, x.fails);
            if (stop && error !== UNCHECKED && !unsure) x.cliKept = true;
            if (unsure) x.unsure = true;
          }
          // a message left for the same session while this one was out
          const later = x.whenFree || x.unsure ? -1 : items.findIndex((y) => y !== x && same(y, x) && !inflight(y, Date.now()) && !y.whenFree && !y.unsure);
          if (later >= 0) { items[later] = { ...merge(x, items[later]), fails: x.fails, error: x.error, retryAt: x.retryAt }; items.splice(k, 1); }
        }
        write(items);
      });
    } catch (e) { /* the claim runs out: a sent one then reads as interrupted, never as unsent */ }
    if (done && i.wrapup) { try { Done.delivered({ agent: i.agent, id: i.id }); } catch (e) { /* the ask still went */ } }
  };
  const fail = (i, error, extra = {}) => { failed.push({ agent: i.agent, id: i.id, error }); settle({ i, error, ...extra }); };
  for (const i of mine) {
    if (Date.now() - started > budget) { settle({ i }); continue; }      // the next refresh
    if (!touch(i, false)) continue;
    const a = alive.get(i.id);
    // whenFree to a session not the board's to stop: handed over as sendTo does, or held (null)
    if (i.whenFree && a && !wakeable(a)) {
      if (!touch(i, true)) continue;
      let r = null;
      try { r = opts.handOver(i, a); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
      if (!r) { settle({ i }); continue; }
      if (!r.ok) { fail(i, String(r.error || '届けられませんでした').slice(0, 300)); continue; }
      if (r.relayed) {
        // the carrier's answer decides; if not in yet, settleRelays reads it later
        let now = null;
        try { now = Relay.result(r.log, r.pid); } catch (e) { now = null; }
        if (!now) { settle({ i, relay: r }); continue; }
        if (!now.sent) { fail(i, String(now.error || '転送できませんでした').slice(0, 300), now.unknown ? { stop: true, unsure: true } : {}); continue; }
      }
      sent.push({ agent: i.agent, id: i.id, key: i.key, pid: r.pid, log: r.log, ...(r.relayed ? { relayed: true } : {}), ...(r.typed ? { typed: true } : {}) });
      settle({ i, done: true });
      continue;
    }
    // Waking must stop every worker of the conversation and confirm it is gone, or the
    // resume forks a copy. Never resume without stopAndConfirm (lib/board/send.js).
    if (a && !(opts.stopAndConfirm && opts.stopAndConfirm(i.id, a))) { settle({ i }); continue; }
    if (!touch(i, true)) continue;
    try {
      const files = (i.attachments || []).filter(Boolean);
      const got = Dispatch.resume({ agent: i.agent, id: i.id, a, text: i.text, model: i.model || undefined,
        dir: i.dir || undefined, addDirs: files.length ? [path.dirname(files[0])] : undefined });
      if (got.copy) {
        // an unchecked copy would recur on every try: stop now; any other copy counts toward MAX_FAILS
        if (got.unchecked) fail(i, UNCHECKED, { stop: true });
        else fail(i, 'Claude がこのセッションを動いているとみなして、続きではなくコピーを作りました');
        continue;
      }
      if (got.refused) {
        if (got.busy) { settle({ i }); continue; }              // running after all: the next drain
        // saved by the CLI for its next start: resending would deliver it twice
        failed.push({ agent: i.agent, id: i.id, error: got.refused });
        settle({ i, error: `${i.agent} が受け付けませんでした${got.saved ? '(メッセージは向こうに保存され、次にこのセッションが起動したときに届きます)' : ''}: ${got.refused}`, stop: got.saved });
        continue;
      }
      sent.push({ agent: i.agent, id: i.id, key: i.key, pid: got.pid, log: got.log });
      settle({ i, done: true });
    } catch (e) {
      fail(i, String(e && e.message || e).slice(0, 300));
    }
  }
  return { sent, kept: read().length, failed, settled };
}

module.exports = { stopped, backoffMs, BACKOFF_S, UNCHECKED, INTERRUPTED, DRAIN_BUDGET_MS, CLAIM_MS, MAX_ITEMS, MAX_FAILS, GAP_MS, queuePath, read, write, withLock, add, remove, take, release, retry, apply, laneOf, drain, wakeable, ready, gated, edit };
