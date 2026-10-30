'use strict';
/**
 * alive.js — which sessions are running right now, from `claude agents --json`
 * (pid, kind, status, name per live process).
 *
 * `claude --resume <id> -p` starts a second process replaying the transcript;
 * it never reaches a live interactive session, so such a card must not offer to send.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const { spawnSync } = require('child_process');
const Dispatch = require('./dispatch.js');

const TIMEOUT_MS = 4000;

// The CLI prints ANSI escapes before its JSON; strip them first or indexOf('[') finds ESC[.
const ANSI = /\][^]*(?:|\\)|\[[0-9;?]*[a-zA-Z]|[=>]/g;
function parseJson(out) {
  const s = String(out || '').replace(ANSI, '');
  const i = s.indexOf('[');
  if (i === -1) return null;
  try { return JSON.parse(s.slice(i)); } catch (e) { return null; }
}

function jobsDir() { return Env.get('CLAUDE_JOBS') || Paths.home('.claude', 'jobs'); }
/** The transcript a background job writes now, when it is not the one it started as. */
function jobTranscript(short) {
  if (!/^[0-9a-f]{6,12}$/.test(String(short || ''))) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(jobsDir(), short, 'state.json'), 'utf8'));
    const r = j.resumeSessionId || (j.linkScanPath ? path.basename(j.linkScanPath, '.jsonl') : null);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(r || '')) ? r : null;
  } catch (e) { return null; }
}

/** Tasks a background job still has running, from state.json (`fan`, else `inFlight.tasks`). @returns {{n, shells, agents}} or null. */
function jobTasks(short) {
  if (!/^[0-9a-f]{6,12}$/.test(String(short || ''))) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(jobsDir(), short, 'state.json'), 'utf8'));
    if (Array.isArray(j.fan)) {
      const open = j.fan.filter((f) => f && !f.doneAt);
      const shells = open.filter((f) => f.kind === 'shell').length, agents = open.filter((f) => f.kind === 'agent').length;
      return { n: open.length, shells, agents };
    }
    const n = j.inFlight && Number(j.inFlight.tasks);
    return n > 0 ? { n, shells: 0, agents: 0 } : null;
  } catch (e) { return null; }
}

/** Ask `claude agents --json` without waiting, so the board can scan meanwhile; sessions({ begun }) collects it. */
function begin() {
  const bin = Dispatch.binaryFor('claude');
  return bin ? require('./bgcmd.js').begin([bin, 'agents', '--json']) : null;
}
function collect(h) { return require('./bgcmd.js').collect(h, TIMEOUT_MS); }

/**
 * @returns {Map<string, {kind, status, name, pid, copies, short}>} by session id, or null when
 *   the CLI could not be asked. null means "unknown", not "none running": callers must hold.
 */
function sessions(opts = {}) {
  let out;
  if (opts.begun !== undefined) {
    if (!opts.begun) return null;
    out = collect(opts.begun);
    if (!out) return null;
  } else {
    const bin = Dispatch.binaryFor('claude');
    if (!bin) return null;
    try { out = spawnSync(bin, ['agents', '--json'], { encoding: 'utf8', timeout: TIMEOUT_MS }); }
    catch (e) { return null; }
  }
  const map = new Map();
  const list = out && out.status === 0 ? parseJson(out.stdout) : null;
  if (!Array.isArray(list)) return null;
  for (const s of list) {
    const id = s && s.sessionId;
    if (!id) continue;
    // "blocked": a background session waiting on your answer, with no pid — not gone
    const blocked = s.state === 'blocked';
    // anything else with no pid and no status is a finished shell
    if (!s.pid && !s.status && !blocked) continue;
    const prev = map.get(id);
    // one transcript can have several live processes: keep the count
    map.set(id, {
      // any worker in a terminal makes it someone's; any busy one makes it busy
      kind: [s.kind, prev?.kind].includes('interactive') ? 'interactive' : (s.kind || prev?.kind || null),
      // with no status, from state: working → busy; done / blocked → idle (a message wakes it)
      status: [s.status, prev?.status].includes('busy') ? 'busy'
        : (s.status || (s.state === 'working' ? 'busy' : s.state === 'done' || blocked ? 'idle' : null) || prev?.status || null),
      state: s.state || prev?.state || null,
      waitingFor: s.waitingFor || prev?.waitingFor || null,
      name: s.name || prev?.name || null,
      pid: prev ? prev.pid : s.pid,
      // lets lib/takeover.js tell this pid from a reused one
      startedAt: prev ? prev.startedAt : (Number(s.startedAt) || null),
      // short ids (background only) for attach/stop; keep all, since stopping only the
      // first leaves the others and the resume then forks a copy
      short: s.id || prev?.short || null,
      shorts: [...new Set([...(prev?.shorts || []), s.id].filter(Boolean))],
      copies: (prev ? prev.copies : 0) + 1,
    });
  }
  // A woken background job writes a new transcript (state.json resumeSessionId) while
  // `claude agents` keeps the original id: mark that transcript running, resumable by the job's id.
  for (const [id, a] of [...map]) {
    if (a.kind !== 'background' || !a.short) continue;
    const bg = jobTasks(a.short);
    if (bg) a.bg = bg;
    const rid = jobTranscript(a.short);
    if (rid && rid !== id && !map.has(rid)) map.set(rid, { ...a, resumeAs: id });
  }
  // just started or woken by the board and not listed yet: running, not stopped
  for (const [id] of starting()) if (!map.has(id)) map.set(id, { kind: 'background', status: 'busy', waitingFor: null, name: null, pid: null, short: id.slice(0, 8), shorts: [id.slice(0, 8)], copies: 1, starting: true });
  return map;
}

/**
 * Sessions this board started or woke in the last STARTING_MS, from its run logs.
 * `claude agents` lists a --bg session only seconds after it returns; a send in that
 * gap would resume it and fork a copy.
 * @returns {Map<string, number>} full session id → when it was started
 */
const STARTING_MS = 120 * 1000;
function starting(now = Date.now(), dir = Dispatch.runsDir()) {
  const fs = require('fs'), path = require('path'), os = require('os');
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /-claude(-reply)?\.log$/.test(n)); } catch (e) { return out; }
  const shorts = [];
  for (const n of names.slice(-40)) {
    const f = path.join(dir, n);
    let st; try { st = fs.statSync(f); } catch (e) { continue; }
    if (now - st.birthtimeMs > STARTING_MS && now - st.mtimeMs > STARTING_MS) continue;
    let t = ''; try { t = Dispatch.plain(fs.readFileSync(f, 'utf8').slice(0, 4000)); } catch (e) { continue; }
    const at = st.birthtimeMs || st.mtimeMs;
    const full = t.match(/--resume ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    // a resume that forked (or was asked to) started a new session, not the original
    const copy = t.match(/started a copy as ([0-9a-f]{8})/);
    const forked = /^# [^\n]*--fork-session/.test(t);
    if (full && !copy && !forked) out.set(full[1], at);
    // what the CLI said, not the header's argv (a message may say anything)
    const bg = (t.startsWith('# ') ? t.slice(t.indexOf('\n') + 1) : t).match(/backgrounded · ([0-9a-f]{8})/);
    if (bg && !(full && full[1].startsWith(bg[1]))) shorts.push([bg[1], at]);
  }
  // a new session's log names it by its short id: the transcript has the rest
  if (shorts.length) {
    const root = Paths.claudeDir('projects');
    let dirs = []; try { dirs = fs.readdirSync(root); } catch (e) { /* none */ }
    for (const d of dirs) {
      let fl = []; try { fl = fs.readdirSync(path.join(root, d)); } catch (e) { continue; }
      for (const [sh, at] of shorts) { const m = fl.find((x) => x.startsWith(sh) && x.endsWith('.jsonl')); if (m) out.set(m.slice(0, -6), at); }
    }
  }
  return out;
}

/** Attach liveness to cards; returns how many were matched. */
function apply(cards, map) {
  let n = 0;
  if (!map) return 0;                       // unknown: claim nothing
  for (const c of cards) {
    c.aliveChecked = true;                  // asked, and this is the answer: not running unless marked below
    const a = map.get(c.id);
    if (!a) continue;
    c.alive = true;
    c.aliveShort = a.short || null;
    c.aliveKind = a.kind;
    c.aliveStatus = a.status;
    c.aliveState = a.state || null;
    c.aliveWaitingFor = a.waitingFor || null;
    c.aliveName = a.name;
    c.alivePid = a.pid || null;
    c.aliveCopies = a.copies;
    // just started or woken by the board: its turn is coming, whatever the transcript's last line
    if (a.starting) c.aliveStarting = true;
    // background tasks still running (background jobs only): the card's 裏で実行中
    if (a.bg) c.aliveBg = a.bg;
    // turn ended though the process may say busy (a background shell); lib/queue.js ready reads it
    if (c.turnEnded && !a.starting) a.endedAt = Math.max(a.endedAt || 0, c.lastT || 0);
    n++;
  }
  return n;
}

module.exports = { STARTING_MS, starting, begin, collect, sessions, apply, parseJson, jobTranscript, jobTasks };
