'use strict';
/**
 * antigravity.js — Antigravity (agy CLI) sessions the board started.
 *
 * agy's own conversation store is sealed, so the board reads what `agy -p … --output-format
 * stream-json` prints: one log per run in <home>/antigravity/<stamp>.log, a `# {…}` header line
 * then init / step_update / result events (agy 2026-09-30). Lines carry no clock: step times are
 * the header's plus prior durations. <log>.pid is the run's process. Headless agy denies any
 * tool that needs permission and lists it in denied_actions.
 */
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');

const AGENT = 'antigravity';
const BIN = 'agy';
// a run with no result and no process file is taken to be running this long after its last line
const QUIET_DEAD_MS = 30 * 60000;

function dir() { return Paths.akHome('antigravity'); }

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return null; }
}

function alive(pid) {
  if (!(pid > 1)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** One run's log: its header, the conversation it belongs to, its steps in order, its result. */
function parseLog(file) {
  const lines = readLines(file);
  if (!lines) return null;
  let head = null, conv = null, result = null, cwd = null;
  const steps = new Map(), notes = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('# ')) { if (!head) { try { head = JSON.parse(line.slice(2)); } catch (e) { head = null; } } continue; }
    let e; try { e = JSON.parse(line); } catch (err) { if (line.trim()) notes.push(line.trim()); continue; }
    if (!e || typeof e !== 'object') continue;
    if (e.event === 'init') { conv = e.conversation_id || conv; cwd = (e.init && e.init.cwd) || cwd; }
    else if (e.event === 'step_update' && e.step_update) {
      const u = e.step_update; conv = u.conversation_id || conv;
      const k = u.step_index;
      const s = steps.get(k) || { i: k, type: u.step_type, text: '', state: '', dur: 0 };
      if (u.text_delta) s.text += u.text_delta;
      if (u.state) s.state = u.state;
      if (u.tool_name) s.tool = u.tool_name;
      if (u.tool_info) { s.params = u.tool_info.parameters || s.params; if (u.tool_info.error) s.error = String(u.tool_info.error.message || u.tool_info.error.type || 'error'); }
      if (u.duration_seconds) s.dur = u.duration_seconds;
      steps.set(k, s);
    } else if (e.event === 'result' && e.result) { result = e.result; conv = e.result.conversation_id || conv; }
  }
  if (!head && !conv) return null;
  let mtime = 0; try { mtime = fs.statSync(file).mtimeMs; } catch (e) { /* gone */ }
  let pid = 0; try { pid = +fs.readFileSync(file + '.pid', 'utf8').trim() || 0; } catch (e) { /* none written */ }
  const t0 = (head && head.t) || mtime;
  return {
    file, t0, mtime, pid, conv: conv || (head && head.conversation) || null,
    prompt: head ? String(head.prompt || '') : '', cwd: cwd || (head && head.cwd) || '',
    steps: [...steps.values()].sort((a, b) => a.i - b.i), result, notes,
  };
}

/** Every run log, parsed, newest last. */
function logs(d = dir()) {
  let names = [];
  try { names = fs.readdirSync(d).filter((f) => f.endsWith('.log')); } catch (e) { return []; }
  return names.map((f) => parseLog(path.join(d, f))).filter(Boolean).sort((a, b) => a.t0 - b.t0);
}

/** The runs of each conversation: Map id → [run, …] oldest first (a run agy refused before naming one keeps its file as id). */
function conversations(d = dir()) {
  const out = new Map();
  for (const r of logs(d)) { const k = r.conv || r.file; if (!out.has(k)) out.set(k, []); out.get(k).push(r); }
  return out;
}

/** Is this run still going: no result, and its process there (or, without a pid file, written lately). */
function running(r, now = Date.now()) {
  if (r.result) return false;
  if (r.pid) return alive(r.pid);
  return now - r.mtime < QUIET_DEAD_MS;
}

/** The conversation as turns, oldest first: {t, kind: user|assistant|tool|error, text, tool?}. */
function turns(runs) {
  const out = [];
  for (const r of runs) {
    let t = r.t0;
    if (r.prompt) out.push({ t, kind: 'user', text: r.prompt });
    for (const s of r.steps) {
      if (s.type === 'user_input') continue;
      if (s.type === 'tool') {
        const target = s.params && (s.params.TargetFile || s.params.AbsolutePath || s.params.CommandLine || s.params.Query || s.params.Url);
        out.push({ t, kind: 'tool', tool: s.tool || 'tool', text: target ? String(target).slice(0, 200) : '' });
        if (s.state === 'ERROR') out.push({ t, kind: 'error', text: (s.error || 'error').split('\n')[0].slice(0, 300) });
      } else if (s.text.trim()) out.push({ t, kind: 'assistant', text: s.text.trim() });
      t += Math.round((s.dur || 0) * 1000);
    }
    if (r.result && r.result.denied_actions && r.result.denied_actions.length) {
      out.push({ t: Math.max(t, r.mtime), kind: 'error', text: '許可が要る操作は画面なしでは自動で拒否されました: ' + deniedOf(r).join(', ') + '(ターミナルで続けると確認できます)' });
    }
    if (!r.result && !running(r) && r.notes.length) out.push({ t: r.mtime, kind: 'error', text: r.notes.slice(-3).join(' ').slice(0, 300) });
  }
  return out;
}

function deniedOf(r) {
  return ((r && r.result && r.result.denied_actions) || []).map((a) => String(a.display_name || a.action || '')).filter(Boolean);
}

module.exports = { AGENT, BIN, dir, parseLog, logs, conversations, running, turns, deniedOf, QUIET_DEAD_MS };
