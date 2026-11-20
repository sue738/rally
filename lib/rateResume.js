'use strict';
/** Resume a stopped, personal session after an explicit five-hour usage rejection. */
const fs = require('fs');
const path = require('path');
const Env = require('./env.js');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');
const Queue = require('./queue.js');
const Limits = require('./limits.js');
const Dispatch = require('./dispatch.js');

const GRACE_MS = 60000;
const MAX_AGE_MS = 24 * 3600000;
const TEXT = 'The five-hour usage limit has reset. Continue the interrupted task in this session. Check the current work first and avoid repeating completed actions.';
const file = () => Env.get('RATE_RESUME') || Paths.akDir('rate-resume.json');

function tail(file, bytes = 256 * 1024) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start) lines.shift();
      return lines;
    } finally { fs.closeSync(fd); }
  } catch (e) { return []; }
}

function codexReset(limits, at) {
  if (!limits || !limits.fiveHour || !limits.week || !Number.isFinite(limits.at)
    || Math.abs(limits.at - at) > 10 * 60000 || limits.fiveHour.used < 99 || limits.week.used >= 99) return 0;
  const reset = limits.fiveHour.resetsAt;
  return Number.isFinite(reset) && reset > at && reset <= at + 6 * 3600000 ? reset : 0;
}

/** A later turn or answer supersedes the rejected turn, including a native auto-resume. */
function detect(session, limits, now = Date.now(), allowUnresolved = false) {
  if (!session || !['claude', 'codex'].includes(session.agent)) return null;
  let hit = null;
  for (const line of tail(session.file)) {
    if (!line || !/rate_limit|usage_limit_exceeded|task_started|task_complete|"type":"user"|"type":"assistant"/.test(line)) continue;
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    const at = Date.parse(e.timestamp);
    if (!Number.isFinite(at)) continue;
    if (session.agent === 'claude') {
      const q = e.quotaLimits;
      if (e.type === 'assistant' && e.isApiErrorMessage === true && e.error === 'rate_limit'
        && q && q.status === 'rejected' && q.rateLimitType === 'five_hour') {
        const reset = Number(q.resetsAt) * 1000;
        hit = Number.isFinite(reset) && reset > at && reset <= at + 6 * 3600000 ? { at, reset } : null;
      } else if (hit && (e.type === 'assistant' || (e.type === 'user' && !e.isMeta))) hit = null;
    } else {
      const p = e.payload || {};
      if (e.type === 'event_msg' && p.type === 'task_complete' && p.error && p.error.codex_error_info === 'usage_limit_exceeded') {
        const reset = codexReset(limits, at);
        hit = reset || allowUnresolved ? { at, reset } : null;
      } else if (hit && ((e.type === 'event_msg' && (p.type === 'task_started' || p.type === 'task_complete'))
        || (e.type === 'response_item' && p.type === 'message' && p.role === 'user'))) hit = null;
    }
  }
  return hit && now - hit.at <= MAX_AGE_MS ? hit : null;
}

/** Called before the regular queue drain, so a native or manual continuation cancels its scheduled send. */
function sync(cards, sessions, live, now = Date.now()) {
  if (!live) return;
  const byKey = new Map(sessions.map((s) => [`${s.agent}:${s.id}`, s]));
  let codex;
  for (const c of cards) {
    if (!['claude', 'codex'].includes(c.agent) || c.subagent || c.headless
      || !Dispatch.UUID.test(c.id)) continue;
    const key = `${c.agent}:${c.id}`, session = byKey.get(key);
    if (!session || !path.isAbsolute(session.project)) continue;
    if (c.agent === 'codex' && codex === undefined) codex = Limits.codex({ raw: true }) || null;
    const hit = detect(session, c.agent === 'codex' ? codex : null, now, true);
    try {
      Queue.withLock(() => {
        const items = Queue.read();
        const saved = Fsx.readJSON(file(), { byId: {} });
        const byId = saved && saved.byId && typeof saved.byId === 'object' ? saved.byId : {};
        const old = byId[key];
        const queued = items.find((i) => i.autoResume && i.agent === c.agent && i.id === c.id);
        const otherPending = items.some((i) => !i.autoResume && i.agent === c.agent && i.id === c.id);
        const idleBackground = c.agent === 'claude' && c.aliveKind === 'background' && c.aliveStatus === 'idle';
        const active = hit && (!c.alive || idleBackground) && c.column !== 'working'
          && c.column !== 'done' && !c.permAsk && !otherPending;
        if (queued && (!active || queued.limitAt !== hit.at)) {
          if (!queued.claim && !queued.relay) {
            Queue.write(items.filter((i) => i !== queued));
            byId[key] = { at: queued.limitAt, status: 'cancelled' };
            Fsx.writeJSONAtomic(file(), { byId });
          }
          return;
        }
        // A newly installed Rally must not wake an old session whose reset was hours ago.
        if (!active || queued || !hit.reset || hit.reset + GRACE_MS <= now || old && old.at === hit.at) return;
        // The queue item and marker survive app restarts. A second refresh never sends this rejection twice.
        const item = { key: `limit-${c.agent}-${c.id}-${hit.at}`, agent: c.agent, id: c.id,
          text: TEXT, dir: session.project, at: now, retryAt: hit.reset + GRACE_MS,
          ...(c.agent === 'codex' ? { whenFree: true, ours: true } : {}), autoResume: true, limitAt: hit.at };
        Queue.write([...items, item]);
        byId[key] = { at: hit.at, status: 'scheduled' };
        Fsx.writeJSONAtomic(file(), { byId });
      });
    } catch (e) { /* the next refresh may try again */ }
  }
}

module.exports = { detect, codexReset, sync, GRACE_MS, file };
