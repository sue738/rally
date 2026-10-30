'use strict';
/**
 * live.js — the board's columns: from each transcript's last entries (and its subagents'),
 * then corrected by the live process (overlayAlive, once lib/alive.js has asked).
 *   working    wrote within IDLE_S, a subagent runs, or the process is busy — not once the turn ended
 *   approval   a tool call has no result and the file went quiet (a prompt), or the process waits
 *   needs-you  the agent spoke last and has been quiet between IDLE_S and STALE_H
 *   answered   the agent finished its turn
 *   idle       quiet DONE_H+ hours; also subagents, headless runs, imports, /exit'ed sessions
 */
const IDLE_S = 60;
const STALE_H = 6;
// past this, a quiet session is abandoned rather than parked (few are resumed after a day)
const DONE_H = 24;
const ONE_SHOT_S = 120;
const BATCH_MIN = 5;      // this many sessions of one agent starting within…
const BATCH_WINDOW_S = 10; // …this many seconds is a script, not a person
// An unfinished subagent (pending call, no answer yet) counts as running until this old:
// a long tool call writes nothing, but a killed one must not keep its parent working.
const SUB_HANG_S = 30 * 60;
// a pending call of these is a subagent being waited for, not a prompt
const SPAWN_TOOLS = /^(Agent|Task|spawn_agent|wait_agent)$/;

function lastNonMeta(events) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind !== 'meta') return events[i];
  return null;
}

// calls made together (in parallel) start within this of each other
const CALL_BATCH_MS = 5000;
// stop reasons that close the model's turn
const END_STOPS = /^(end_turn|stop_sequence)$/;
// After the last message Stop hooks may run (a blocking one starts a new turn) and the
// runtime writes a turn-end marker. With no marker (older CLIs, no hooks), the turn counts
// as ended after this long.
const TURN_END_GRACE_S = 15;

/**
 * Tool calls still without a result, of the latest batch only: an older orphaned call
 * (interrupted, compacted over) is not open, since later calls ran after it.
 */
function pendingCalls(events) {
  const pending = new Map();
  let newest = null;
  for (const e of events) {
    if (e.kind === 'tool_call' && e.callId != null) { pending.set(e.callId, e); newest = e.t || 0; }
    else if (e.kind === 'tool_result' && e.callId != null) pending.delete(e.callId);
  }
  return [...pending.values()].filter((e) => (e.t || 0) >= newest - CALL_BATCH_MS);
}

/**
 * The model's turn is over: its last line ended the turn, no call is pending, and no user
 * line (hook feedback, notification, prompt) restarted it. Ignores process status on purpose:
 * a background shell keeps the process busy while the model waits on you. Claude only.
 */
function turnEnded(events, now = Date.now(), graceS = TURN_END_GRACE_S) {
  const last = lastNonMeta(events);
  if (!last || last.kind !== 'assistant' || !END_STOPS.test(last.stop || '')) return false;
  if (pendingCalls(events).length) return false;
  let closed = false;
  for (let i = events.length - 1; i >= 0 && events[i] !== last; i--) {
    const e = events[i];
    // /compact after the answer: that is work you started, and it runs now
    if (e.kind === 'meta' && e.sub === 'local' && e.command === 'compact') return false;
    if (e.kind === 'meta' && e.sub === 'turn-end') closed = true;
  }
  return closed || now - last.t >= graceS * 1000;
}

/**
 * Classify one session at `now`.
 * @returns {{column, reason, lastT, idleS, lastKind, lastTool, pending}}
 */
const OPEN_TURN_S = 30 * 60;
function classify(s, now = Date.now(), opts = {}) {
  opts = { oneShotS: ONE_SHOT_S, ...opts };
  const idleS = opts.idleS || IDLE_S;
  const staleMs = (opts.staleH || STALE_H) * 3600000;
  const doneMs = (opts.doneH || DONE_H) * 3600000;
  const last = lastNonMeta(s.events);
  if (!last) return null;
  const idle = (now - last.t) / 1000;
  const pend = pendingCalls(s.events);
  const lastCall = [...s.events].reverse().find((e) => e.kind === 'tool_call');
  const ended = turnEnded(s.events, now, opts.turnEndGraceS);
  const base = { lastT: last.t, idleS: Math.round(idle), lastKind: last.kind, lastTool: lastCall ? lastCall.tool : null, lastCallT: lastCall ? lastCall.t : null, pending: pend.map((p) => p.tool), turnEnded: ended };
  // a recent write is work in progress — unless it was the model ending its turn
  if (idle < idleS && !ended) return { column: 'working', reason: 'wrote within the last minute', ...base };
  // codex says when a turn starts and ends: open, it is at work — a long build or test prints nothing for minutes, and
  // its last line (a tool call, or a note before one) read as finished or as asking. Not past OPEN_TURN_S of silence:
  // a codex closed mid-turn never writes the end.
  if (s.agent === 'codex' && idle < OPEN_TURN_S) {
    let open = false;
    for (const e of s.events) if (e.kind === 'meta' && e.sub) { if (e.sub === 'turn-start') open = true; else if (e.sub === 'turn-end' || e.sub === 'aborted') open = false; }
    if (open) return { column: 'working', reason: 'codex turn still open', ...base };
  }
  // A parent with running subagents is working, even after its turn ended (background agents
  // wake it when done). A background shell does not count (see overlayAlive).
  const subs = opts.subagents;
  if (subs && subs.running && pend.every((p) => SPAWN_TOOLS.test(p.tool))) {
    return { column: 'working', reason: `subagents running (${subs.running})`, ...base };
  }
  if (s.parentId != null || s.entrypoint === 'sdk-cli' || s.entrypoint === 'github-action' || s.entrypoint === 'import' || s.automated) {
    const reason = s.parentId != null ? 'subagent, finished' : s.entrypoint === 'import' ? 'imported by Codex Desktop (no work of its own)' : 'headless run, finished';
    return { column: 'idle', reason, ...base };
  }
  // /exit is a meta line, so not in `last`, but it closes the session
  const exited = s.events.some((e) => e.kind === 'meta' && e.sub === 'exit' && e.t >= last.t);
  if (exited) return { column: 'idle', reason: 'you exited it (/exit)', ...base };
  // no prompt and no tool call: a stub (Codex Desktop makes many)
  const prompts = s.events.filter((e) => e.kind === 'user' && e.human).length;
  const calls = s.events.filter((e) => e.kind === 'tool_call').length;
  if (!prompts && !calls) return { column: 'idle', reason: 'no dialogue yet', ...base };
  // an interrupted Codex turn: the next move is yours
  const aborted = s.events.some((e) => e.kind === 'meta' && e.sub === 'aborted' && e.t >= last.t);
  if (aborted && now - last.t < staleMs) return { column: 'needs-you', reason: 'you interrupted it (turn aborted)', ...base };
  // one question, one answer, no tool, quickly over: answered, not pending
  const stamps = s.events.filter((e) => e.kind !== 'meta');
  if (prompts === 1 && calls === 0 && last.kind === 'assistant' && stamps[stamps.length - 1].t - stamps[0].t <= opts.oneShotS * 1000) {
    return { column: 'idle', reason: 'answered (one-shot)', ...base };
  }
  // Checked before staleness: a permission prompt does not expire (overlayAlive restores one
  // past DONE_H). A batch with some results back is still open, if the last result is of that batch.
  const batchOpen = pend.length && (last.kind === 'tool_call' || last.kind === 'user'
    || (last.kind === 'tool_result' && last.t >= Math.min(...pend.map((p) => p.t || 0))));
  if (batchOpen && now - last.t < doneMs) {
    const ask = pend.some((p) => /^(AskUserQuestion|request_user_input_async)$/.test(p.tool));
    return { column: 'approval', reason: ask ? `asked you a question (${pend.map((p) => p.tool).join(', ')})` : `waiting for permission: ${pend.map((p) => p.tool).join(', ')}`, ...base };
  }
  // quiet is not finished: its own column, with `waiting` saying on whom
  if (now - last.t >= staleMs) {
    const h = Math.round((now - last.t) / 3600000);
    const waiting = pend.length ? 'permission'
      : aborted ? 'you'
      : (last.kind === 'assistant' || last.kind === 'tool_result' || last.kind === 'tool_call') ? 'you'
      : 'agent';
    if (now - last.t >= doneMs) return { column: 'idle', waiting, reason: `abandoned after ${h}h`, ...base };
    return { column: 'stale', waiting, reason: `quiet for ${h}h`, ...base };
  }
  if (last.kind === 'assistant' || last.kind === 'tool_result' || last.kind === 'tool_call') {
    // whether it asked a question is decided in lib/board/state.js, which has the text
    return { column: 'answered', reason: 'the agent finished its turn', ...base };
  }
  // the last line is the runtime's (notification, interrupt, hook), not yours: what came before decides
  if (last.kind === 'user' && !last.human) {
    if (last.interrupt) return { column: 'needs-you', reason: 'you interrupted it (turn aborted)', ...base };
    const before = [...s.events].reverse().find((e) => e.kind !== 'meta' && !(e.kind === 'user' && !e.human));
    if (!before || before.kind !== 'user') return { column: 'answered', reason: 'a notification came in after its turn; nothing followed', ...base };
  }
  return { column: 'needs-you', reason: 'you spoke last but nothing followed — the run may have died', ...base };
}

/** Subagents per parent: {total, running} (running as subRunning says). */
function subagentsByParent(sessions, now = Date.now(), opts = {}) {
  const idleMs = (opts.idleS || IDLE_S) * 1000, hangMs = (opts.subHangS || SUB_HANG_S) * 1000;
  const out = new Map();
  for (const s of sessions) {
    if (s.parentId == null) continue;
    const key = s.agent + '\0' + s.parentId;
    const o = out.get(key) || { total: 0, running: 0 };
    o.total++;
    if (subRunning(s, now, { idleMs, hangMs })) o.running++;
    out.set(key, o);
  }
  return out;
}

/** A task it started in the background (run_in_background) has not said it ended. */
function bgWaiting(events) {
  const open = new Set();
  for (const e of events) { if (e.bgTask) open.add(e.bgTask); else if (e.taskDone) open.delete(e.taskDone); }
  return open.size > 0;
}

/** One subagent at work by the same rule — so the parent's count and the rows it lists agree. */
function subRunning(s, now = Date.now(), o = {}) {
  const idleMs = o.idleMs || IDLE_S * 1000, hangMs = o.hangMs || SUB_HANG_S * 1000;
  const last = lastNonMeta(s.events);
  if (!last) return false;
  const age = now - last.t;
  // waiting on its own background task counts as unfinished: the notification wakes it
  const waiting = pendingCalls(s.events).length > 0 || bgWaiting(s.events);
  // with a call or a background task outstanding it may be quiet for long; with neither, the model's next line
  // comes within seconds, so a last line that is not the model's (a cut-off run) stops counting soon
  const unfinished = waiting || last.kind !== 'assistant';
  return age < idleMs || (unfinished && age < (waiting ? hangMs : Math.min(hangMs, 3 * 60 * 1000)));
}

/**
 * Resumed and forked conversations carry the original's history with its ids and stamps:
 * a session whose first tool call appears in an earlier-started one is its copy.
 * Returns Map(agent\0id → original id).
 */
function copiesOf(sessions) {
  const owner = new Map();                 // callId → earliest-starting session
  const firstT = (s) => { const f = s.events.find((e) => e.kind !== 'meta'); return f ? f.t : Infinity; };
  const starts = new Map(sessions.map((s) => [s, firstT(s)]));
  // a fork keeps the first stamps too; then the file made later is the copy
  const birth = new Map();
  const born = (s) => {
    if (!birth.has(s)) { let b = Infinity; try { b = require('fs').statSync(s.file).birthtimeMs; } catch (e) { /* no file: tests */ } birth.set(s, b); }
    return birth.get(s);
  };
  for (const s of sessions) {
    if (s.parentId != null) continue;
    for (const e of s.events) {
      if (e.kind !== 'tool_call' || e.callId == null) continue;
      const k = s.agent + '\0' + e.callId, prev = owner.get(k);
      if (!prev || starts.get(s) < starts.get(prev) || (starts.get(s) === starts.get(prev) && born(s) < born(prev))) owner.set(k, s);
    }
  }
  const out = new Map();
  for (const s of sessions) {
    if (s.parentId != null) continue;
    const first = s.events.find((e) => e.kind === 'tool_call' && e.callId != null);
    if (!first) continue;
    const o = owner.get(s.agent + '\0' + first.callId);
    if (o && o !== s && o.id !== s.id) out.set(s.agent + '\0' + s.id, o.id);
  }
  return out;
}

/**
 * What the live process says (the alive* fields from lib/alive.js) beats what the transcript
 * suggests. Status: busy, idle, waiting (waitingFor "permission prompt", …).
 */
function overlayAlive(cards) {
  let n = 0;
  for (const c of cards) {
    if (!c.alive) continue;
    // 完了 stays closed whatever the process does: only a message from you reopens it (lib/done.js apply: a new
    // human turn; lib/board/send.js sendTo: a send from the board). A task notification, a peer's message or a
    // scheduled wake-up keeps it working in 完了.
    if (c.column === 'done') continue;
    // idle by its own account, working only because it wrote a moment ago: finished
    if (c.aliveStatus === 'idle' && c.column === 'working' && /^wrote within/.test(c.reason || '')) {
      c.column = 'answered'; c.reason = 'the agent finished its turn (claude agents: idle)'; n++;
      continue;
    }
    // "blocked" on your reply (not a permission prompt): your turn — unless you set it aside (待ちにする): that is your answer
    // to this very state, and only work or a prompt (the branches below) takes it out of Waiting again
    if (c.aliveState === 'blocked' && c.aliveStatus !== 'busy' && c.aliveStatus !== 'waiting' && c.column !== 'done') {
      if (c.parked) continue;
      if (!['needs-you', 'approval', 'answered'].includes(c.column)) { c.column = 'needs-you'; c.reason = 'waiting for your reply (claude agents)'; n++; }
      continue;
    }
    // Busy but the turn ended: a background task runs while the model waits on you. Unless
    // the board just started it (aliveStarting): its turn is coming.
    if (c.aliveStatus === 'busy' && c.turnEnded && !c.aliveStarting) {
      const bg = c.aliveBg || {};
      c.background = { n: bg.n || null, shells: bg.shells || 0, agents: bg.agents || 0 };
      if (c.column === 'working' && /^wrote within/.test(c.reason || '')) { c.column = 'answered'; c.reason = 'the agent finished its turn'; n++; }
      continue;
    }
    if (c.aliveStatus === 'busy' && c.column !== 'working') {
      c.column = 'working'; c.reason = 'the process is busy (claude agents)'; n++;
    } else if (c.aliveStatus === 'waiting' && c.aliveWaitingFor && c.aliveWaitingFor !== 'permission prompt') {
      // a dialog open in its terminal (/model, /config…): your turn, to close it there
      if (c.column !== 'needs-you' || c.reason !== `waiting for ${c.aliveWaitingFor} (claude agents)`) { c.column = 'needs-you'; c.reason = `waiting for ${c.aliveWaitingFor} (claude agents)`; n++; }
    } else if (c.aliveStatus === 'waiting' && c.column !== 'approval') {
      const w = c.aliveWaitingFor || (c.pending && c.pending.length ? 'permission prompt' : 'you');
      c.column = 'approval';
      c.reason = c.pending && c.pending.length && /permission/.test(w)
        ? `waiting for permission: ${c.pending.join(', ')}` : `waiting for ${w} (claude agents)`;
      n++;
    }
  }
  return n;
}

/** Sessions of one agent that all started inside a BATCH_WINDOW_S window: a script started them. */
function batchIds(sessions, opts = {}) {
  const min = opts.batchMin || BATCH_MIN, win = (opts.batchWindowS || BATCH_WINDOW_S) * 1000;
  // copies carry their original's first stamps, so they do not count as starts
  const copies = opts.copies || copiesOf(sessions);
  const starts = [];
  // only machine-started sessions can be a batch, never an interactive one caught in a burst
  const scripted = (s) => s.entrypoint === 'sdk-cli' || s.entrypoint === 'github-action' || s.entrypoint === 'import' || !!s.automated || s.project === '/';
  for (const s of sessions) {
    if (!scripted(s)) continue;
    if (copies.has(s.agent + '\0' + s.id) || (opts.boardCopies && opts.boardCopies.has(String(s.id).slice(0, 8)))) continue;
    const first = s.events.find((e) => e.kind !== 'meta');
    if (first && s.parentId == null) starts.push({ agent: s.agent, id: s.id, t: first.t });
  }
  starts.sort((a, b) => a.agent.localeCompare(b.agent) || a.t - b.t);
  const out = new Set();
  let i = 0;
  while (i < starts.length) {
    let j = i;
    while (j + 1 < starts.length && starts[j + 1].agent === starts[i].agent && starts[j + 1].t - starts[i].t <= win) j++;
    if (j - i + 1 >= min) for (let k = i; k <= j; k++) out.add(starts[k].agent + '\0' + starts[k].id);
    i = j + 1;
  }
  return out;
}

const RECENT_N = 8;
const MAX_TARGET = 160;

/** The last few tool calls, oldest first, for the detail view. */
function recentTools(events) {
  const calls = events.filter((e) => e.kind === 'tool_call');
  return calls.slice(-RECENT_N).map((e) => {
    const raw = e.input && (e.input.path || e.input.command);
    return { t: e.t, tool: e.tool || null, op: e.op || 'other', target: raw ? String(raw).slice(0, MAX_TARGET) : null };
  });
}

/** The newest tool call without a result: {asking: {tool, what}} — what a permission prompt is about. */
function askingOf(events) {
  const p = pendingCalls(events);
  const c = p[p.length - 1];
  if (!c) return {};
  const i = c.input || {};
  const what = i.command || i.file_path || i.path || i.url || i.pattern || i.description || i.prompt || '';
  return { asking: { tool: c.tool || '', what: String(what).replace(/\s+/g, ' ').slice(0, 300), why: String(i.description || '').slice(0, 120) } };
}

/** Since your last message: how many tool calls, from when, and the latest one's target. */
/** How long it actually worked: the gaps between entries, dropping any over a minute (waiting on you is not work; cchours counts the same way). */
function activeMs(events, gapMs = 60 * 1000) {
  let sum = 0, prev = null;
  for (const e of events || []) {
    if (e.kind === 'meta') continue;
    if (prev != null && e.t > prev && e.t - prev <= gapMs) sum += e.t - prev;
    if (prev == null || e.t > prev) prev = e.t;
  }
  return sum;
}

function turnOf(events) {
  let i = events.length - 1;
  while (i >= 0 && !(events[i].kind === 'user' && events[i].human)) i--;
  const calls = events.slice(i + 1).filter((e) => e.kind === 'tool_call');
  const last = calls[calls.length - 1];
  const raw = last && last.input && (last.input.path || last.input.command || last.input.description || last.input.pattern || last.input.url);
  return { turnTools: calls.length, turnStart: i >= 0 ? events[i].t : null, turnTarget: raw ? String(raw).replace(/\s+/g, ' ').slice(0, 80) : null };
}

/** The permission mode of the latest turn that recorded one (claude only). */
function modeOf(events) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].mode) return events[i].mode;
  return null;
}

/** claude-sonnet-5-20260115 → sonnet. */
function modelOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i].model;
    if (!m || typeof m !== 'string' || m === '<synthetic>') continue;
    const short = /opus/i.test(m) ? 'opus' : /sonnet/i.test(m) ? 'sonnet' : /haiku/i.test(m) ? 'haiku' : /fable/i.test(m) ? 'fable' : m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    return short;
  }
  return null;
}

/** The model id as the transcript has it (claude-opus-5-5), for its version. */
function modelIdOf(events) {
  for (let i = events.length - 1; i >= 0; i--) { const m = events[i].model; if (m && typeof m === 'string' && m !== '<synthetic>') return m.slice(0, 80); }
  return null;
}

/** Cards for the board: one per session, newest first, with the classification. */
function cards(sessions, now = Date.now(), opts = {}) {
  const copies = copiesOf(sessions);
  const batch = batchIds(sessions, { ...opts, copies });
  const subs = subagentsByParent(sessions, now, opts);
  const byKey = new Map(sessions.map((s) => [s.agent + '\0' + s.id, s]));
  const out = [];
  // a Codex session the board started or answered is yours, not a script's (Dispatch.boardCodex)
  const bc = opts.boardCodex;
  const yours = (s) => {
    if (!bc || s.agent !== 'codex' || s.entrypoint !== 'sdk-cli') return false;
    if (bc.ids.has(s.id)) return true;
    const f = s.events.find((e) => e.kind !== 'meta');
    return !!f && bc.starts.some((st) => st.dir === s.project && f.t >= st.t - 5000 && f.t - st.t < 120000);
  };
  sessions = sessions.map((s) => (yours(s) ? { ...s, entrypoint: 'cli', events: s.events.map((e) => (e.scripted ? { ...e, human: true, scripted: undefined } : e)) } : s));
  // the board's own headless passes (run in ~/.rally or a legacy dir) are no card at all;
  // --bg sessions they start for you are interactive and stay
  const Paths = require('./paths.js');
  const owns = opts.ownDir ? [opts.ownDir] : [Paths.akDir(), ...Paths.legacyDirs()];
  const inOwn = (s) => typeof s.project === 'string' && owns.some((own) => s.project === own || s.project.startsWith(own + '/'));
  const mach = new Set(sessions.filter((s) => s.entrypoint === 'sdk-cli' && s.parentId == null && inOwn(s)).map((s) => s.agent + '\0' + s.id));
  // …and the subagents such a pass starts go with it
  const machinery = (s) => mach.has(s.agent + '\0' + s.id) || (s.parentId != null && mach.has(s.agent + '\0' + s.parentId));
  for (const s of sessions) {
    if (machinery(s)) continue;
    const sub = s.parentId == null ? subs.get(s.agent + '\0' + s.id) : null;
    let c = classify(s, now, sub ? { ...opts, subagents: sub } : opts);
    if (!c) continue;
    // a reader that knows whether the process runs (antigravity) decides working / approval
    if (s.running === true) c = { ...c, column: 'working', reason: 'running (agy -p)' };
    else if (s.running === false && s.denied && s.denied.length && c.column !== 'idle') c = { ...c, column: 'approval', reason: `denied without a prompt: ${s.denied.join(', ')}` };
    else if (s.running === false && c.column === 'working') c = { ...c, column: 'answered', reason: 'the run ended (agy -p)' };
    if (c.column !== 'working' && batch.has(s.agent + '\0' + s.id)) c = { ...c, column: 'idle', reason: 'batch run (started with others in the same second)' };
    // Copies the board's sends forked (and stopped) go idle, even from working. Other copies go
    // idle only if nobody wrote in them; one you went on in (a --fork) stays.
    if (!copies.has(s.agent + '\0' + s.id) && opts.boardCopies && opts.boardCopies.has(String(s.id).slice(0, 8))) c = { ...c, column: 'idle', reason: 'a copy a send forked (stopped by the board)' };
    if ((c.column !== 'working' || (opts.boardCopies && opts.boardCopies.has(String(s.id).slice(0, 8)))) && copies.has(s.agent + '\0' + s.id)) {
      const o = byKey.get(s.agent + '\0' + copies.get(s.agent + '\0' + s.id));
      const seen = new Set((o ? o.events : []).map((e) => e.t));
      const made = opts.boardCopies && opts.boardCopies.has(String(s.id).slice(0, 8));
      if (made || !s.events.some((e) => !seen.has(e.t) && (e.kind === 'assistant' || e.kind === 'tool_call'))) c = { ...c, column: 'idle', reason: `${made ? 'a copy a send forked (stopped by the board)' : 'an unused copy'} of ${String(copies.get(s.agent + '\0' + s.id)).slice(0, 8)}` };
    }
    // a subagent's lane follows the same rule as its parent's count
    if (s.parentId != null) {
      const run = subRunning(s, now, { idleMs: (opts.idleS || IDLE_S) * 1000, hangMs: (opts.subHangS || SUB_HANG_S) * 1000 });
      if (run && c.column !== 'working') c = { ...c, column: 'working', reason: 'subagent at work (a tool call is still running)' };
      else if (!run && c.column === 'working') c = { ...c, column: 'idle', reason: 'subagent, finished' };
    }
    const first = s.events.find((e) => e.kind !== 'meta');
    out.push({
      agent: s.agent, id: s.id, project: s.project, entrypoint: s.entrypoint,
      subagent: s.parentId != null, parentId: s.parentId,
      ...(s.parentId != null ? { subRunning: subRunning(s, now, { idleMs: (opts.idleS || IDLE_S) * 1000, hangMs: (opts.subHangS || SUB_HANG_S) * 1000 }) } : {}),
      // started by a machine, not a person; `cwd: /` is the only tell codex gives
      headless: s.entrypoint === 'sdk-cli' || s.entrypoint === 'github-action' || !!s.automated || s.project === '/',
      firstT: first ? first.t : null,
      activeMs: activeMs(s.events),
      toolCalls: s.events.filter((e) => e.kind === 'tool_call').length,
      humanTurns: s.events.filter((e) => e.kind === 'user' && e.human).length,
      assistantTurns: s.events.filter((e) => e.kind === 'assistant').length,
      // when it last did something itself (a reply or a tool call): a held prompt older than this was left behind
      lastWorkT: (() => { for (let i = s.events.length - 1; i >= 0; i--) { const e = s.events[i]; if (e.kind === 'assistant' || e.kind === 'tool_call') return e.t; } return null; })(),
      // replies with words in them (a line that only calls a tool or thinks is not one): what the thread shows as 返答
      replyTurns: s.events.filter((e) => e.kind === 'assistant' && e.chars > 0).length,
      recent: recentTools(s.events),
      // the turn in progress: tool calls since your last message, and when it began
      ...turnOf(s.events),
      // what it is asking to run, if a call has no answer yet (a permission prompt shows this)
      ...askingOf(s.events),
      model: modelOf(s.events),
      permMode: modeOf(s.events),
      modelId: modelIdOf(s.events),
      ...(sub ? { subagents: sub } : {}),
      ...(copies.has(s.agent + '\0' + s.id) ? { copyOf: copies.get(s.agent + '\0' + s.id) } : {}),
      ...c,
    });
  }
  return out.sort((a, b) => b.lastT - a.lastT);
}

module.exports = { bgWaiting, IDLE_S, STALE_H, DONE_H, ONE_SHOT_S, BATCH_MIN, BATCH_WINDOW_S, SUB_HANG_S, TURN_END_GRACE_S, lastNonMeta, pendingCalls, turnEnded, classify, subagentsByParent, copiesOf, overlayAlive, batchIds, recentTools, modelOf, turnOf, activeMs, subRunning, cards };
