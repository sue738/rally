'use strict';
/**
 * limits.js — how much of the 5-hour and weekly allowance is left.
 *
 * Claude: Claude Code gives statusline commands the rate limits on stdin; Rally's statusline
 * (lib/statusline.js) keeps them in <home>/limits.json, or RALLY_LIMITS names another file
 * (no network, no credentials).
 * Codex: token_count events in its session logs carry rate_limits.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');

function file() { return Env.get('LIMITS') || require('./statusline.js').file(); }

// a window whose reset time has passed reads 0%, not the stale use
const mk = (used, resetsAt) => ({ used: resetsAt && resetsAt < Date.now() ? 0 : Math.round(used), resetsAt });
const win = (w) => (w && typeof w.used_percentage === 'number' ? mk(w.used_percentage, (w.resets_at || 0) * 1000) : null);

/** Claude's {fiveHour, week, at} or null when nothing has been cached yet. */
function claude() {
  let j;
  const f = file();
  if (!f) return null;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
  const out = { fiveHour: win(j.five_hour), week: win(j.seven_day), at: (j.cached_at || 0) * 1000 };
  return out.fiveHour || out.week ? out : null;
}

function codexDir() { return Env.get('CODEX_SESSIONS') || Paths.home('.codex', 'sessions'); }

/** The newest session logs, newest first: the dated directories, newest days only. */
function newestLogs(n) {
  const out = [];
  const kids = (d) => { try { return fs.readdirSync(d).sort().reverse().map((x) => path.join(d, x)); } catch (e) { return []; } };
  for (const y of kids(codexDir())) for (const m of kids(y)) for (const d of kids(m)) {
    for (const f of kids(d)) if (f.endsWith('.jsonl')) { try { out.push({ f, t: fs.statSync(f).mtimeMs }); } catch (e) { /* gone */ } }
    if (out.length >= n * 3) return out.sort((a, b) => b.t - a.t).slice(0, n);
  }
  return out.sort((a, b) => b.t - a.t).slice(0, n);
}

/** The last rate_limits with a window in the tail of one log, or null. */
function lastIn(f) {
  let buf;
  try {
    const fd = fs.openSync(f, 'r');
    try {
      const size = fs.fstatSync(fd).size, len = Math.min(size, 512 * 1024);
      buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len);
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
  const text = buf.toString('utf8');
  if (text.indexOf('"rate_limits":{') < 0) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].indexOf('"rate_limits":{') < 0) continue;
    let j; try { j = JSON.parse(lines[i]); } catch (e) { continue; }
    const r = j.payload && j.payload.rate_limits;
    if (r && (r.primary || r.secondary)) return { r, at: Date.parse(j.timestamp) || 0 };
  }
  return null;
}

/** Codex's {fiveHour, week, at, plan} from the newest log that has one (headless runs write rate_limits: null), or null. */
function codex() {
  let best = null;
  // headless runs write none and can be many a day: look well back
  for (const { f } of newestLogs(400)) { best = lastIn(f); if (best) break; }
  if (!best) return null;
  const out = { fiveHour: null, week: null, at: best.at, plan: best.r.plan_type || '' };
  for (const w of [best.r.primary, best.r.secondary]) {
    if (!w || typeof w.used_percent !== 'number') continue;
    const v = mk(w.used_percent, (w.resets_at || 0) * 1000);
    if ((w.window_minutes || 0) >= 1440) out.week = v; else out.fiveHour = v;
  }
  return out.fiveHour || out.week ? out : null;
}

/** Claude's allowance at the top level (as before), Codex's under .codex. */
function read() {
  const c = claude(), x = codex();
  if (!c && !x) return null;
  return Object.assign({}, c || {}, { codex: x || undefined });
}

module.exports = { read, file, claude, codex };
