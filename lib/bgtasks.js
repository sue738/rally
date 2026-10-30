'use strict';
const { t: tr } = require('./i18n.js');
/**
 * bgtasks.js — the background tasks a live session still runs, and the ones left looping.
 * A run_in_background Bash call is a child of claude in the snapshot wrapper
 * (`zsh -c source …/shell-snapshots/… && eval '<cmd>'`), its own process group, stdout on
 * tasks/<id>.output. Stale: turn over, older than STALE_S, a polling loop or long sleep that
 * is sleeping now, output idle for OUT_IDLE_S. Stopping re-verifies parent, command hash and
 * wrapper first (a reused pid is refused), then TERM to the group, KILL after KILL_AFTER_MS.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Paths = require('./paths.js');

const STALE_S = 6 * 3600;
const OUT_IDLE_S = 3600;
const KILL_AFTER_MS = 5000;
const NOTICE_MS = 30 * 60 * 1000;

// the wrapper Claude Code runs a Bash call in (the shell snapshot, then eval of the command)
const WRAP = /^\/bin\/(?:zsh|bash|sh) -c source \S*\/shell-snapshots\/snapshot-[^\s/]+\.sh\b/;
const PARENT = /(?:^|\/)claude(?:\s|$)/;
const SLEEP = /^(?:\/bin\/)?sleep\s/;

const sig = (command) => crypto.createHash('sha1').update(String(command)).digest('hex').slice(0, 16);

/** ps etime ([[dd-]hh:]mm:ss) → seconds. */
function parseEtime(s) {
  const m = String(s || '').trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

/** `ps -axww -o pid=,ppid=,pgid=,etime=,command=` → rows. */
function parsePs(out) {
  const rows = [];
  for (const line of String(out || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s(.*)$/);
    if (!m) continue;
    rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], etimeS: parseEtime(m[4]), command: m[5].replace(/^\s+/, '') });
  }
  return rows;
}
/**
 * The processes under the given session pids, two levels (the wrapper shell and what it runs): pgrep finds them and ps reads
 * only those. `ps -ax` lists every process of the machine, 85 ms of a refresh; this is about a quarter of that.
 */
function readPs(parents) {
  try {
    if (Array.isArray(parents) && parents.length && parents.length <= 200) {
      const kids = (pids) => { const r = spawnSync('/usr/bin/pgrep', ['-P', pids.join(',')], { encoding: 'utf8', timeout: 3000 }); return r.status === 0 ? r.stdout.split('\n').filter((x) => /^\d+$/.test(x)).map(Number) : (r.status === 1 ? [] : null); };
      const one = kids(parents);
      if (one) {
        const two = one.length ? kids(one) : [];
        if (two) {
          const all = [...new Set([...one, ...two])];
          if (!all.length) return [];
          const r = spawnSync('/bin/ps', ['-ww', '-o', 'pid=,ppid=,pgid=,etime=,command=', '-p', all.join(',')], { encoding: 'utf8', timeout: 4000, maxBuffer: 32 * 1024 * 1024 });
          if (r.status === 0 || r.status === 1) return parsePs(r.stdout);      // 1: some of them ended since
        }
      }
    }
    const r = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,etime=,command='], { encoding: 'utf8', timeout: 4000, maxBuffer: 32 * 1024 * 1024 });
    return r.status === 0 ? parsePs(r.stdout) : null;
  } catch (e) { return null; }
}

/** `lsof -a -d 1 -Fpn -p …` → Map pid → the tasks/<id>.output its stdout is. */
function parseLsof(out) {
  const m = new Map();
  let pid = null;
  for (const line of String(out || '').split('\n')) {
    if (line[0] === 'p') pid = +line.slice(1);
    else if (line[0] === 'n' && pid && /\/tasks\/[^/]+\.output$/.test(line.slice(1))) m.set(pid, line.slice(1));
  }
  return m;
}
function readOutputs(pids) {
  if (!pids.length) return new Map();
  try {
    const r = spawnSync('/usr/sbin/lsof', ['-a', '-d', '1', '-Fpn', '-p', pids.join(',')], { encoding: 'utf8', timeout: 4000 });
    return parseLsof(r.stdout);
  } catch (e) { return new Map(); }
}

/**
 * The command inside the wrapper's eval '…' (the raw text as ps shows it: a newline is \012,
 * a quote inside is '"'"'). null when the line is not the wrapper.
 */
function innerCommand(command) {
  const s = String(command || '');
  if (!WRAP.test(s)) return null;
  const at = s.indexOf(" && eval '");
  if (at < 0) return null;
  let i = at + 10, out = '';
  for (;;) {
    const q = s.indexOf("'", i);
    if (q < 0) return null;
    out += s.slice(i, q);
    if (s.startsWith(`'"'"'`, q)) { out += "'"; i = q + 5; continue; }
    // what follows the command: the wrapper's own tail
    if (!/^' < \/dev\/null(?: && pwd -P >\| \S+)?\s*$/.test(s.slice(q))) return null;
    return out.replace(/\\012/g, '\n');
  }
}

/** 'loop' (until/while … do … sleep … done), 'sleep' (one long sleep, maybe an echo after), or null. */
function loopKind(inner) {
  const t = String(inner || '').trim();
  if (!t) return null;
  if (/(?:^|[\s;&|(])(?:until|while)\s[\s\S]*?(?:^|[\s;])do\s[\s\S]*?\bsleep\s+\d[\d.]*[smhd]?\b[\s\S]*?(?:^|[\s;])done\b/.test(t)) return 'loop';
  if (/^sleep\s+\d[\d.]*[smhd]?\s*(?:(?:;|&&)\s*(?:echo|printf|true|:)\b[^;&|`$()<>]*)?$/.test(t)) return 'sleep';
  return null;
}

/** One line of the command for the list: the first lines joined, at most `n` characters. */
function shortCommand(inner, n = 160) {
  const t = String(inner || '').replace(/\s*\n\s*/g, ' ; ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/**
 * The background tasks of each live session.
 * @param sessions [{id, pid, turnEnded, column}] — the live claude sessions (claude agents pid)
 * @param io {ps: rows, outputs: pids → Map, mtime: path → ms|null, now}
 * @returns Map session id → [{pid, ppid, pgid, sig, id, cmd, ageS, outIdleS, kind, sleeping, stale}]
 */
function discover(sessions, io = {}, opts = {}) {
  const staleS = opts.staleS || STALE_S, outIdleS = opts.outIdleS || OUT_IDLE_S;
  const now = io.now || Date.now();
  const byPid = new Map();
  for (const s of sessions || []) if (s && s.pid > 1) byPid.set(+s.pid, s);
  const res = new Map();
  if (!byPid.size) return res;
  const rows = io.ps !== undefined ? io.ps : readPs([...byPid.keys()]);
  if (!rows) return res;
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const cand = [];
  for (const r of rows) {
    const s = byPid.get(r.ppid);
    if (!s) continue;
    const inner = innerCommand(r.command);
    if (inner == null) continue;
    cand.push([r, s, inner]);
  }
  if (!cand.length) return res;
  const outs = io.outputs ? io.outputs(cand.map(([r]) => r.pid)) : readOutputs(cand.map(([r]) => r.pid));
  const mtime = io.mtime || ((f) => { try { return fs.statSync(f).mtimeMs; } catch (e) { return null; } });
  for (const [r, s, inner] of cand) {
    const out = outs.get(r.pid);
    if (!out) continue;                      // stdout is not a task's output file
    // foreground calls also write tasks/<id>.output: trust the job's fan list, else wait for the turn to end
    const tid = path.basename(out, '.output');
    if (s.fanIds ? !s.fanIds.has(tid) : !s.turnEnded) continue;
    const mt = mtime(out);
    const ch = kids.get(r.pid) || [];
    const kind = loopKind(inner);
    // in its sleep right now; a single sleep must be only that
    const sleeping = ch.some((k) => SLEEP.test(k.command)) && (kind !== 'sleep' || ch.every((k) => SLEEP.test(k.command)));
    const t = {
      pid: r.pid, ppid: r.ppid, pgid: r.pgid, sig: sig(r.command),
      id: tid, cmd: shortCommand(inner), full: inner.slice(0, 2000),
      ageS: r.etimeS, outIdleS: mt != null ? Math.max(0, Math.round((now - mt) / 1000)) : null,
      kind, sleeping,
    };
    t.stale = !!(s.turnEnded && s.column !== 'working' && kind && sleeping
      && t.ageS != null && t.ageS > staleS && t.outIdleS != null && t.outIdleS > outIdleS);
    if (!res.has(s.id)) res.set(s.id, []);
    res.get(s.id).push(t);
  }
  for (const l of res.values()) l.sort((a, b) => (b.stale - a.stale) || (b.ageS || 0) - (a.ageS || 0));
  return res;
}

function jobsDir() { return Env.get('CLAUDE_JOBS') || Paths.home('.claude', 'jobs'); }
/** A background job's background shells still open (~/.claude/jobs/<short>/state.json fan), or null. */
function fanShells(short) {
  if (!/^[0-9a-f]{6,12}$/.test(String(short || ''))) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(jobsDir(), short, 'state.json'), 'utf8'));
    if (!Array.isArray(j.fan)) return null;
    return new Set(j.fan.filter((f) => f && f.kind === 'shell' && !f.doneAt && f.id).map((f) => String(f.id)));
  } catch (e) { return null; }
}

// ---- stopping ---------------------------------------------------------------------------

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function psOne(pid) {
  try {
    const r = spawnSync('/bin/ps', ['-ww', '-o', 'pid=,ppid=,pgid=,etime=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 });
    return parsePs(r.stdout)[0] || null;
  } catch (e) { return null; }
}

/**
 * Is `pid` still the task that was listed: same parent, same command line, the wrapper, and
 * a parent that is claude? @returns {ok, row} or {error, gone}
 */
function verify(t, io = {}) {
  const one = io.psOne || psOne;
  const pid = +t.pid, ppid = +t.ppid;
  if (!(pid > 1) || !(ppid > 1)) return { error: tr('pid が不正です') };
  const row = one(pid);
  if (!row) return { error: tr('もう止まっています'), gone: true };
  if (row.ppid !== ppid || sig(row.command) !== String(t.sig || '')) return { error: tr('この pid はもう別のプロセスです(止めませんでした)') };
  if (innerCommand(row.command) == null) return { error: tr('バックグラウンドのタスクではありません(止めませんでした)') };
  const parent = one(ppid);
  if (!parent || !PARENT.test(parent.command)) return { error: tr('親が claude ではありません(止めませんでした)') };
  return { ok: true, row, parent };
}

/**
 * Stop one listed task: verified, SIGTERM to its group, SIGKILL after KILL_AFTER_MS if it is
 * still the same process. Waits (a one-shot, not the refresh). @returns {ok, how} or {error}
 */
function stop(t, io = {}) {
  const v = verify(t, io);
  if (!v.ok) return v.gone ? { ok: true, how: 'gone', pid: +t.pid } : { ...v, pid: +t.pid };
  const kill = io.kill || ((p, s) => process.kill(p, s));
  const target = (row, parent) => (row.pgid === row.pid && row.pgid !== parent.pgid ? -row.pid : row.pid);
  try { kill(target(v.row, v.parent), 'SIGTERM'); } catch (e) { if (e.code === 'ESRCH') return { ok: true, how: 'gone', pid: +t.pid }; return { error: String(e.message || e), pid: +t.pid }; }
  const wait = io.sleep || sleepMs;
  const until = Date.now() + (io.killAfterMs != null ? io.killAfterMs : KILL_AFTER_MS);
  while (Date.now() < until) {
    wait(100);
    const again = verify(t, io);
    if (!again.ok) return { ok: true, how: 'TERM', pid: +t.pid };
  }
  const again = verify(t, io);
  if (!again.ok) return { ok: true, how: 'TERM', pid: +t.pid };
  try { kill(target(again.row, again.parent), 'SIGKILL'); } catch (e) { /* went meanwhile */ }
  return { ok: true, how: 'KILL', pid: +t.pid };
}

// ---- the setting, what was stopped automatically ----------------------------------------

function home() { return Paths.akHome(); }
function file() { return Env.get('BGTASKS') || path.join(home(), 'bgtasks.json'); }
function read() {
  try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
}
function write(j) { require('./fsx.js').writeJSONAtomic(file(), j); }
/** 止まらず回っている待ちループを自動で止める: on unless turned off. */
function autoOn(j = read()) { return j.auto !== false; }
function setAuto(on) { const j = read(); j.auto = !!on; write(j); return { ok: true, auto: !!on }; }

function appLog(fields) {
  try {
    fs.mkdirSync(home(), { recursive: true });
    fs.appendFileSync(path.join(home(), 'app.log'), JSON.stringify({ ...fields, t: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }) + '\n');
  } catch (e) { /* the board still loads */ }
}

/**
 * One pass of the automatic stop, once per refresh: SIGKILL for one that was sent SIGTERM a
 * refresh ago (KILL_AFTER_MS) and is still the same process, else SIGTERM to the oldest stale
 * one — one task per pass. Never waits. @returns the record of what it did, or null
 */
function reap(tasksBySession, io = {}) {
  if (Env.get('SELFTEST') && !io.allowSelftest) return null;
  const j = read();
  if (!autoOn(j)) return null;
  const now = io.now || Date.now();
  const kill = io.kill || ((p, s) => process.kill(p, s));
  const done = (j.stopped || []).filter((x) => now - x.t < 24 * 3600000);
  // a TERM a pass ago that did not end it
  for (const x of done) {
    if (x.how !== 'TERM' || x.checked || now - x.t < KILL_AFTER_MS) continue;
    x.checked = true;
    const v = verify(x, io);
    if (v.ok) { try { kill(v.row.pgid === v.row.pid && v.row.pgid !== v.parent.pgid ? -v.row.pid : v.row.pid, 'SIGKILL'); x.how = 'KILL'; } catch (e) { /* gone */ } appLog({ ev: 'bgreap', how: 'KILL', session: x.session.slice(0, 8), pid: x.pid, cmd: x.cmd }); }
    j.stopped = done; write(j);
    return x;
  }
  let pick = null;
  for (const [session, list] of tasksBySession) {
    for (const t of list) {
      if (!t.stale || done.some((x) => x.pid === t.pid && x.sig === t.sig)) continue;
      if (!pick || (t.ageS || 0) > (pick.t.ageS || 0)) pick = { session, t };
    }
  }
  if (!pick) return null;
  const { session, t } = pick;
  const v = verify(t, io);
  if (!v.ok) return null;
  try { kill(v.row.pgid === v.row.pid && v.row.pgid !== v.parent.pgid ? -v.row.pid : v.row.pid, 'SIGTERM'); } catch (e) { return null; }
  const rec = { t: now, session, pid: t.pid, ppid: t.ppid, sig: t.sig, cmd: t.cmd, ageS: t.ageS, how: 'TERM' };
  done.push(rec);
  j.stopped = done.slice(-50);
  write(j);
  appLog({ ev: 'bgreap', how: 'TERM', session: session.slice(0, 8), pid: t.pid, ageS: t.ageS, cmd: t.cmd });
  return rec;
}

/** What the board stopped on its own lately, by session: the card's notice. */
function notices(now = Date.now(), j = read()) {
  const m = new Map();
  for (const x of j.stopped || []) {
    if (now - x.t > NOTICE_MS) continue;
    if (!m.has(x.session)) m.set(x.session, []);
    m.get(x.session).push({ t: x.t, cmd: x.cmd });
  }
  return m;
}

/**
 * On the cards: c.bgTasks (the list), c.background for a live one whose turn ended with
 * tasks behind it, c.bgReaped (what the board stopped on its own, last 30 minutes).
 * opts.reap: the app's refresh may stop one stale loop (the setting decides).
 */
function apply(cards, opts = {}) {
  const live = cards.filter((c) => c.agent === 'claude' && !c.subagent && c.alive && c.alivePid > 1);
  const by = discover(live.map((c) => ({ id: c.id, pid: c.alivePid, turnEnded: !!c.turnEnded && !c.aliveStarting, column: c.column, fanIds: c.aliveKind === 'background' ? (opts.fanShells || fanShells)(c.aliveShort) : null })), opts.io || {}, opts);
  for (const c of live) {
    const l = by.get(c.id);
    if (!l || !l.length) continue;
    c.bgTasks = l.map(({ full, ...t }) => t);
    if (c.turnEnded && !c.background) c.background = { n: l.length, shells: l.length, agents: 0 };
  }
  let reaped = null;
  if (opts.reap) { try { reaped = reap(by, opts.io || {}); } catch (e) { /* the board still loads */ } }
  const nt = notices();
  for (const c of cards) {
    const n = nt.get(c.id);
    if (n) c.bgReaped = n;
    if (reaped && c.bgTasks) c.bgTasks = c.bgTasks.filter((t) => t.pid !== reaped.pid);
  }
  return { reaped, auto: autoOn() };
}

module.exports = { fanShells, STALE_S, OUT_IDLE_S, KILL_AFTER_MS, WRAP, sig, parseEtime, parsePs, parseLsof, innerCommand, loopKind, shortCommand, discover, verify, stop, reap, notices, apply, autoOn, setAuto, read, appLog };
