'use strict';
/**
 * stuck.js — a session that looks stuck, from what its card already has:
 *   - loop: the same call three times in a row, or failing three times in the last eight
 *   - silent: busy with no transcript line for SILENT_MS (a running tool gets TOOL_MS)
 *   - wait: a prompt in the approval lane up for WAIT_MS
 * `key` names one episode, so the board notifies once per episode.
 */
const crypto = require('crypto');

const LOOP_N = 3;
const LOOK = 8;
const SILENT_MS = 10 * 60 * 1000;
const TOOL_MS = 20 * 60 * 1000;
const WAIT_MS = 15 * 60 * 1000;
const BATCH_MS = 5000;           // calls made together (in parallel) start within this of each other
// asking for the output of something else is waiting, not repeating
const POLL = /^(BashOutput|TaskOutput|ReadNotifications|Monitor|KillShell|TaskStop)$/;
const SPAWN = /^(Agent|Task|Workflow)$/;

function sig(e) {
  let i = '';
  try { i = JSON.stringify(e.input || {}); } catch (err) { i = ''; }
  return (e.tool || '') + '\0' + i;
}
function kept(e) { return !!e.input && Object.values(e.input).some((v) => v != null && v !== ''); }
function short(e) {
  const i = e.input || {};
  const w = i.command || i.file_path || i.path || i.url || i.pattern || i.description || '';
  return ((e.tool || '') + (w ? ' ' + String(w).replace(/\s+/g, ' ') : '')).slice(0, 160);
}
function hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12); }

/** The same call repeating at the end of the current turn: {what, n, t, sig} or null. */
function loopOf(events) {
  let i = events.length - 1;
  while (i >= 0 && !(events[i].kind === 'user' && events[i].human)) i--;
  const turn = events.slice(i + 1);
  const calls = turn.filter((e) => e.kind === 'tool_call' && !POLL.test(e.tool || '')).slice(-LOOK);
  if (calls.length < LOOP_N) return null;
  const failed = new Set(turn.filter((e) => e.kind === 'tool_result' && e.ok === false).map((e) => e.callId));
  const last = calls[calls.length - 1], s = sig(last);
  // readers drop the input of e.g. Read/Grep: an empty input never counts as a repeat
  if (!kept(last)) return null;
  // in a row, commands only: repeated edits of one file are normal
  let run = 0;
  if (last.op === 'shell' || (last.input && last.input.command)) for (let k = calls.length - 1; k >= 0 && sig(calls[k]) === s; k--) run++;
  const same = calls.filter((e) => sig(e) === s);
  const fails = same.filter((e) => failed.has(e.callId)).length;
  // the newest one has not answered yet: count it with the failures before it
  const pendingLast = !turn.some((e) => e.kind === 'tool_result' && e.callId === last.callId);
  const failRun = fails + (pendingLast && fails ? 1 : 0);
  const n = Math.max(run, failRun >= LOOP_N ? failRun : 0);
  if (n < LOOP_N) return null;
  return { what: short(last), n, t: (run >= LOOP_N ? calls[calls.length - run] : same[0]).t, sig: s };
}

/**
 * @param c the card (after the process's status and the prompts are on it)
 * @param events the session's parsed events
 * @returns {{kind, what, n?, since, key}|null}
 */
function of(c, events, now = Date.now()) {
  if (!c || c.subagent || c.headless || !events) return null;
  if (c.column === 'done' || c.column === 'idle' || c.column === 'stale') return null;
  const key = (k, x) => k + ':' + hash(c.agent + '\0' + c.id + '\0' + x);
  if (c.column === 'approval') {
    const since = c.permAsk ? c.permAsk.t : c.lastT;
    if (since && now - since >= WAIT_MS) {
      const what = c.permAsk ? (c.permAsk.tool + ' ' + String(c.permAsk.what || '').split('\n')[0]).trim()
        : c.asking ? (c.asking.tool + ' ' + (c.asking.what || '')).trim() : '';
      return { kind: 'wait', what: what.slice(0, 160), since, key: key('wait', c.permAsk ? c.permAsk.id : since) };
    }
  }
  const loop = loopOf(events);
  if (loop) return { kind: 'loop', what: loop.what, n: loop.n, since: loop.t, key: key('loop', loop.sig + '\0' + loop.t) };
  if (c.column === 'working' && c.aliveStatus === 'busy' && c.lastT && now - c.lastT >= SILENT_MS) {
    const pend = events.filter((e) => e.kind === 'tool_call' && e.callId != null);
    const done = new Set(events.filter((e) => e.kind === 'tool_result').map((e) => e.callId));
    // only the latest batch can still be running: an older call without a
    // result was interrupted or compacted away
    const newest = pend.length ? pend[pend.length - 1].t || 0 : 0;
    const open = pend.filter((e) => !done.has(e.callId) && (e.t || 0) >= newest - BATCH_MS);
    const running = open[open.length - 1];
    if (running && SPAWN.test(running.tool || '')) return null;           // its subagents write their own files
    if (running) {
      if (now - running.t < TOOL_MS) return null;
      return { kind: 'tool', what: short(running), since: running.t, key: key('tool', running.callId + '\0' + running.t) };
    }
    return { kind: 'silent', what: '', since: c.lastT, key: key('silent', c.lastT) };
  }
  return null;
}

module.exports = { LOOP_N, LOOK, SILENT_MS, TOOL_MS, WAIT_MS, loopOf, of };
