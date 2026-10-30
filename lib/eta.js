'use strict';
/**
 * eta.js — when the turn a working card is on is likely to end.
 *
 * Nothing says how hard a request is (its wording, length and the context size were all measured and tell nothing:
 * scripts/eta-features.js), so the estimate is made from how long turns have taken before (a turn: from one of your
 * messages to the last line before your next one), and re-made at every refresh from how far this one has got:
 *
 *  1. History. Every earlier turn of this session, of the same folder and of all sessions votes, with weights: the
 *     session's own 3, the folder's 1, everyone's 0.3. Newer turns count more (the weight halves every 30 turns back
 *     within each group), so a change in how you work shows within a few dozen turns.
 *  2. Survival. Only turns that ran longer than this one already has vote: the weighted median of what they had left,
 *     minus nothing, is the estimate (a turn 4 minutes in is compared with the past turns that took more than 4 minutes).
 *  3. Pace. A past turn counts less the more its number of tool calls at this point differs from this turn's (a kernel on
 *     log(1 + calls), width 1): a turn that has done a lot is compared with past turns that had done a lot by then.
 *  4. Longer than any before. If no past turn ran this long, it is "over": a quarter of the time spent so far, at
 *     least a minute, and the card says it is running long.
 *
 * The result is a time (`at`), not a duration, so a page can count down by itself between refreshes, with the range
 * the votes fell in (`lo`..`hi`, their 25th to 75th percentile). Replayed on 60 days of turns (scripts/eta-backtest.js,
 * run on the later half, 4842 points at 1, 3, 10 and 30 minutes in): the middle guess is unbiased (predicted / actual
 * 1.0, it was 0.87), the typical error is a factor of 2.8 (it was 3.0), and half to twice the real time in 35% of cases.
 * The durations themselves are that spread; nothing cheaper than this did better.
 */

const MIN_TURN_MS = 10 * 1000;           // shorter is a slash command or a quick answer, not a task
const MAX_TURN_MS = 3 * 60 * 60 * 1000;  // longer is a loop or something left running
const PRIOR = [60e3, 3 * 60e3, 8 * 60e3, 15 * 60e3].map((ms) => ({ ms, tools: 0 }));
const FLOOR_MS = 20 * 1000, CEIL_MS = 2 * 60 * 60 * 1000;
const NEED = { session: 3, project: 5, all: 8 };

const W = { own: 3, proj: 1, all: 0.3 }, HALF_TURNS = 30, PACE_SIGMA = 1;

/** The value at cumulative weight q of [[value, weight]] (sorted in place). */
function wquantile(items, q) {
  items.sort((x, y) => x[0] - y[0]);
  let tot = 0;
  for (const x of items) tot += x[1];
  let acc = 0;
  for (const x of items) { acc += x[1]; if (acc >= q * tot) return x[0]; }
  return items.length ? items[items.length - 1][0] : 0;
}

/** The finished turns of a session's events, [{start, end, ms, tools, calls}] (calls: when each tool call came, ms after the start): the last turn is the one in progress and is left out. */
function spans(events) {
  const out = [];
  let start = null, last = 0, calls = [];
  const close = () => {
    if (start != null && last - start >= MIN_TURN_MS && last - start <= MAX_TURN_MS) out.push({ start, end: last, ms: last - start, tools: calls.length, calls });
  };
  for (const e of events || []) {
    if (e.kind === 'user' && e.human) { close(); start = e.t; last = e.t; calls = []; continue; }
    if (start == null) continue;
    if (e.t > last) last = e.t;
    if (e.kind === 'tool_call') calls.push(e.t - start);
  }
  return out;
}
/** How long each took, how many tools it used, and when. Oldest first. */
const turnsOf = (events) => spans(events).map(({ start, ms, tools, calls }) => ({ start, ms, tools, calls }));

/** What every session's past turns add up to: {all, byProject}, each oldest first (the newest `cap` sessions, for speed). */
function pools(sessions, cap = 300) {
  const byProject = new Map();
  const all = [];
  const recent = (sessions || []).slice().sort((a, b) => ((b.events || []).length ? b.events[b.events.length - 1].t : 0) - ((a.events || []).length ? a.events[a.events.length - 1].t : 0)).slice(0, cap);
  for (const s of recent) {
    const ts = turnsOf(s.events);
    if (!ts.length) continue;
    all.push(...ts);
    const k = s.project || '';
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(...ts);
  }
  const old = (a, b) => (a.start || 0) - (b.start || 0);
  all.sort(old);
  for (const v of byProject.values()) v.sort(old);
  return { all, byProject };
}

const enough = (own, proj, all) => own.length >= NEED.session || proj.length >= NEED.project || all.length >= NEED.all;
const basisOf = (own, proj) => (own.length >= NEED.session ? 'session' : proj.length >= NEED.project ? 'project' : 'all');

/**
 * The votes of the past turns that ran longer than `elapsed`: [[time they had left, weight]]. Within each group a turn
 * counts less the further back it is; with `tools` known, less the more its tool calls by `elapsed` differ from that.
 */
function votes({ own, proj, all }, elapsed, tools) {
  const items = [];
  const add = (list, w) => {
    const m = list.length;
    for (let i = 0; i < m; i++) {
      const x = list[i];
      if (x.ms <= elapsed + 5000) continue;
      let ww = w * Math.pow(0.5, (m - 1 - i) / HALF_TURNS);
      if (tools != null && x.calls) {
        let n = 0;
        for (const dt of x.calls) { if (dt <= elapsed) n++; else break; }
        const d = Math.log1p(n) - Math.log1p(tools);
        ww *= Math.exp(-(d * d) / (2 * PACE_SIGMA * PACE_SIGMA));
      }
      if (ww > 1e-6) items.push([x.ms - elapsed, ww]);
    }
  };
  add(own, W.own); add(proj, W.proj); add(all, W.all);
  return items;
}

/**
 * {at, lo, hi, basis, over, n} for a card working on its turn, or null when there is nothing to say.
 * own: this session's finished turns; proj / all: the pools.
 */
function estimate({ now, turnStart, tools = 0, own = [], proj = [], all = [] }) {
  if (!turnStart || now < turnStart) return null;
  const elapsed = now - turnStart;
  if (elapsed > MAX_TURN_MS) return null;
  const known = enough(own, proj, all);
  const basis = known ? basisOf(own, proj) : 'prior';
  const n = known ? (basis === 'session' ? own : basis === 'project' ? proj : all).length : PRIOR.length;
  const items = known ? votes({ own, proj, all }, elapsed, tools) : PRIOR.filter((t) => t.ms > elapsed + 5000).map((t) => [t.ms - elapsed, 1]);
  const clamp = (ms) => Math.min(Math.max(ms, FLOOR_MS), CEIL_MS);
  let remaining, over = false, lo, hi;
  if (items.length < (known ? 3 : 1)) {
    over = true;
    remaining = Math.max(elapsed * 0.25, 60e3);
    lo = Math.max(elapsed * 0.1, 30e3); hi = elapsed;
  } else {
    remaining = wquantile(items, 0.5); lo = wquantile(items, 0.25); hi = wquantile(items, 0.75);
  }
  remaining = clamp(remaining);
  return { at: Math.round(now + remaining), lo: Math.round(now + Math.min(clamp(lo), remaining)), hi: Math.round(now + Math.max(clamp(hi), remaining)), basis, over, n };
}

/**
 * How long a task that has not started is likely to take: the middle and the usual range of the turns in the
 * same history the countdown uses (the session's own, the folder's and everyone's, newer ones counting more).
 * What a request asks cannot be told from its text (its length says nothing about how long it takes), so every
 * message held for a session gets the same figure. {ms, lo, hi, basis, n}
 */
function taskEstimate(own, proj, all) {
  const known = enough(own, proj, all);
  const basis = known ? basisOf(own, proj) : 'prior';
  const items = known ? votes({ own, proj, all }, -5000, null).map(([v, w]) => [v - 5000, w]) : PRIOR.map((t) => [t.ms, 1]);
  const clamp = (v) => Math.min(Math.max(v, 60e3), CEIL_MS);
  return { ms: clamp(wquantile(items, 0.5)), lo: clamp(wquantile(items, 0.25)), hi: clamp(wquantile(items, 0.75)), basis, n: known ? (basis === 'session' ? own : basis === 'project' ? proj : all).length : PRIOR.length };
}

/**
 * Put `eta` on every working card whose turn is running, and `heldEst` (how long a message held for it is expected
 * to take once it starts) on every working card that holds some.
 */
function apply(cards, eventsOf, now = Date.now(), sessions = []) {
  const p = pools(sessions);
  for (const c of cards) {
    if (c.column !== 'working' || c.subagent) continue;
    const own = turnsOf(eventsOf(c) || []), proj = p.byProject.get(c.project || '') || [];
    if (c.turnStart && !c.turnEnded) {
      const e = estimate({ now, turnStart: c.turnStart, tools: c.turnTools || 0, own, proj, all: p.all });
      if (e) c.eta = e;
    }
    if (c.held && c.held.length) c.heldEst = taskEstimate(own, proj, p.all);
  }
  return cards;
}

module.exports = { spans, turnsOf, pools, estimate, taskEstimate, apply, MIN_TURN_MS, MAX_TURN_MS };
