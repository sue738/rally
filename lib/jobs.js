'use strict';
/**
 * jobs.js — the launchd agents in ~/Library/LaunchAgents: schedule, next run,
 * last result and log. list() only reads; act() changes one job of yours (program
 * under your home): kickstart, pause/resume (bootout + rename to .plist.disabled),
 * delete (bootout, plist moved to the Trash so it can be restored).
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');

const DAY = ['日', '月', '火', '水', '木', '金', '土', '日'];
const hm = (h, m) => `${h == null ? '*' : h}:${String(m == null ? 0 : m).padStart(2, '0')}`;

/** StartCalendarInterval / StartInterval as a person says it. */
function scheduleOf(p) {
  if (p.StartInterval) { const s = p.StartInterval; return s % 3600 === 0 ? `${s / 3600}時間ごと` : s % 60 === 0 ? `${s / 60}分ごと` : `${s}秒ごと`; }
  const c = p.StartCalendarInterval;
  if (c) {
    const list = Array.isArray(c) ? c : [c];
    // group by time: 月 火 水 木 金 7:45 → 平日 7:45
    const byTime = new Map();
    for (const e of list) {
      const t = hm(e.Hour, e.Minute) + (e.Day ? ` (${e.Day}日)` : '');
      if (!byTime.has(t)) byTime.set(t, new Set());
      byTime.get(t).add(e.Weekday == null ? '*' : e.Weekday % 7);
    }
    return [...byTime.entries()].map(([t, days]) => {
      if (days.has('*')) return `毎日 ${t}`;
      const d = [...days].sort();
      const wk = d.join() === '1,2,3,4,5' ? '平日' : d.join() === '0,1,2,3,4,5,6' ? '毎日' : d.join() === '0,6' ? '週末' : d.map((x) => DAY[x]).join('・');
      return `${wk} ${t}`;
    }).join(' / ');
  }
  if (p.KeepAlive) return '常駐';
  if (p.RunAtLoad) return 'ログイン時';
  return 'なし';
}

/**
 * The next time launchd starts it: StartCalendarInterval by walking the minutes of the next
 * 32 days (a monthly Day is the longest gap), StartInterval from the last run; else null.
 */
function nextRun(p, now = Date.now(), lastRun = null) {
  if (p.StartInterval) {
    const iv = p.StartInterval * 1000;
    const base = lastRun && lastRun > now - iv * 4 ? lastRun : now;
    let t = base + iv; while (t < now) t += iv;
    return t;
  }
  const c = p.StartCalendarInterval;
  if (!c) return null;
  const list = (Array.isArray(c) ? c : [c]).filter((e) => e && typeof e === 'object');
  if (!list.length) return null;
  const d = new Date(now); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 32 * 24 * 60; i++) {
    const m = d.getMinutes(), h = d.getHours(), wd = d.getDay(), day = d.getDate(), mo = d.getMonth() + 1;
    if (list.some((e) => (e.Minute == null || e.Minute === m) && (e.Hour == null || e.Hour === h)
      && (e.Weekday == null || e.Weekday % 7 === wd) && (e.Day == null || e.Day === day) && (e.Month == null || e.Month === mo))) return d.getTime();
    d.setMinutes(m + 1);
  }
  return null;
}

/** The last line a log has, for the list's 結果 (read from its last 4 KB). */
function lastLine(file) {
  if (!file) return '';
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, n = Math.min(size, 4096), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    // eslint-disable-next-line no-control-regex
    const lines = buf.toString('utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    return (lines[lines.length - 1] || '').slice(0, 200);
  } catch (e) { return ''; } finally { if (fd != null) try { fs.closeSync(fd); } catch (e) { /* closed */ } }
}

function launchctlList(run = execFileSync) {
  const out = new Map();
  try {
    for (const l of String(run('launchctl', ['list'], { encoding: 'utf8', timeout: 5000 })).split('\n').slice(1)) {
      const [pid, status, label] = l.split('\t');
      if (label) out.set(label.trim(), { pid: pid === '-' ? null : +pid, lastExit: status === '-' ? null : +status });
    }
  } catch (e) { /* not on a Mac */ }
  return out;
}

function plist(file, run = execFileSync) {
  try { return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', timeout: 5000 })); } catch (e) { return null; }
}

/** [{label, schedule, program, log, lastRun, loaded, running, lastExit, disabled, mine}] */
function list(opts = {}) {
  const dir = opts.dir || Paths.home('Library', 'LaunchAgents');
  const home = Paths.home();
  const lc = launchctlList(opts.run);
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.plist(\.disabled)?$/.test(f)); } catch (e) { return out; }
  for (const f of files) {
    const p = plist(path.join(dir, f), opts.run);
    if (!p || !p.Label) continue;
    const args = p.ProgramArguments || (p.Program ? [p.Program] : []);
    const script = args.find((a, i) => i > 0 && /[/.]/.test(a) && !a.startsWith('-')) || args[0] || '';
    const log = p.StandardOutPath || p.StandardErrorPath || '';
    const err = p.StandardErrorPath && p.StandardErrorPath !== log ? p.StandardErrorPath : '';
    let lastRun = null;
    for (const l of [log, err]) { try { if (l) lastRun = Math.max(lastRun || 0, fs.statSync(l).mtimeMs); } catch (e) { /* no log yet */ } }
    const st = lc.get(p.Label);
    const disabled = f.endsWith('.disabled') || p.Disabled === true;
    const lastExit = st ? st.lastExit : null;
    out.push({
      label: p.Label, schedule: scheduleOf(p), program: script, log, err, lastRun, file: path.join(dir, f),
      next: disabled || !st ? null : nextRun(p, opts.now || Date.now(), lastRun),
      // what it said last: its error log's when it failed, else its output's
      said: (lastExit ? lastLine(err) : '') || lastLine(log) || lastLine(err),
      disabled, loaded: !!st, running: !!(st && st.pid), lastExit,
      mine: args.some((a) => String(a).startsWith(home)),
    });
  }
  return out.sort((a, b) => (b.mine - a.mine) || (a.disabled - b.disabled) || a.label.localeCompare(b.label));
}

const ACTS = ['run', 'pause', 'resume', 'delete'];
/** One change to one job of yours: {ok, done} or {error}. `run` stands in for execFileSync in tests. */
function act({ label, action, dir, run = execFileSync, trash, uid } = {}) {
  if (!ACTS.includes(action)) return { error: `unknown action: ${action}` };
  if (Env.get('SELFTEST') && run === execFileSync) return { error: 'selftest: launchd is not touched' };
  const home = Paths.home();
  const job = list({ dir, run }).find((j) => j.label === label);
  if (!job) return { error: 'その定期実行は見つかりません' };
  if (!job.mine) return { error: 'あなたのスクリプトの定期実行だけ操作できます(アプリが入れたものは触りません)' };
  const u = uid != null ? uid : process.getuid();
  const lc = (args) => run('launchctl', args, { encoding: 'utf8', timeout: 10000 });
  const off = job.file.endsWith('.disabled') ? job.file : job.file + '.disabled';
  const on = job.file.replace(/\.disabled$/, '');
  try {
    if (action === 'run') {
      if (job.disabled || !job.loaded) return { error: '止まっているので実行できません(先に再開してください)' };
      lc(['kickstart', `gui/${u}/${label}`]);
      return { ok: true, done: '実行しました' };
    }
    if (action === 'pause') {
      if (job.disabled) return { ok: true, done: 'もう止まっています' };
      if (job.loaded) { try { lc(['bootout', `gui/${u}/${label}`]); } catch (e) { /* already out */ } }
      fs.renameSync(job.file, off);
      return { ok: true, done: '止めました(.plist.disabled にしました)' };
    }
    if (action === 'resume') {
      if (job.file !== on) fs.renameSync(job.file, on);
      if (!list({ dir, run }).find((j) => j.label === label && j.loaded)) lc(['bootstrap', `gui/${u}`, on]);
      return { ok: true, done: '再開しました' };
    }
    // delete: out of launchd, the file into the Trash (a move, so it can come back)
    if (job.loaded) { try { lc(['bootout', `gui/${u}/${label}`]); } catch (e) { /* already out */ } }
    const bin = trash || path.join(home, '.Trash');
    fs.mkdirSync(bin, { recursive: true });
    let to = path.join(bin, path.basename(job.file));
    if (fs.existsSync(to)) to = path.join(bin, `${path.basename(job.file)}.${Date.now()}`);
    fs.renameSync(job.file, to);
    return { ok: true, done: 'ゴミ箱に移しました', trashed: to };
  } catch (e) { return { error: String(e && (e.stderr || e.message) || e).slice(0, 300) }; }
}

module.exports = { list, scheduleOf, nextRun, lastLine, act };
