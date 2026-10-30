'use strict';
const { t: tr } = require('./i18n.js');
/**
 * dispatch.js — start an agent from a card, or answer a session from one:
 *   run    claude --bg -- "<text>"                   (codex exec -C <dir> -- "<text>")
 *   reply  claude --bg --resume <session> -- "<text>" (codex exec -C <dir> resume <session> -- "<text>")
 * The text always follows `--` so a message is never parsed as options; everything else
 * on argv is validated here. The child is detached, logging to ~/.rally/runs/<stamp>.log.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');

const NAME = 'rally';
const AGENTS = ['claude', 'codex', 'antigravity'];
// the command each agent runs as, where it is not the agent's own name
const BINARY = { antigravity: 'agy' };
// both CLIs name sessions by UUID (codex: v7)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const MODEL = /^[A-Za-z0-9][\w.:\[\]-]{0,80}$/;

/** A session id that may go on a command line: only a UUID, so nothing like `--settings=…` reaches argv. */
function resumableId(agent, id) {
  const s = String(id == null ? '' : id);
  if (!AGENTS.includes(agent) || !UUID.test(s)) throw new Error(`not a ${agent} session id: ${s.slice(0, 60)}`);
  return s;
}

/** A session id that is only stored or looked up, never put on a command line (some are "<file>#<id>"). */
function recordId(agent, id) {
  const s = String(id == null ? '' : id);
  if (!/^[a-z]{1,20}$/.test(String(agent || '')) || !s || s.length > 600 || s.startsWith('-') || /[\u0000-\u001f\u007f]/.test(s)) {
    throw new Error(`not a ${agent} session id: ${s.slice(0, 60)}`);
  }
  return s;
}

function modelName(model) {
  const m = String(model || '').trim();
  if (m && !MODEL.test(m)) throw new Error(`not a model name: ${m.slice(0, 60)}`);
  return m;
}

function runsDir() {
  return Env.get('RUNS') || Paths.akDir('runs');
}

/** Where the agent's binary is. GUI apps get a bare PATH, so try the usual places, then the login shell. RALLY_BIN_<AGENT> overrides. */
function binaryFor(agent) {
  const env = Env.get(`BIN_${agent.toUpperCase()}`);
  const name = BINARY[agent] || agent;
  // under the selftest only the named stand-in runs, never the real CLI
  if (Env.get('SELFTEST')) { try { if (env && path.isAbsolute(env)) { fs.accessSync(env, fs.constants.X_OK); return env; } } catch (e) { /* refused */ } return null; }
  if (env) return env;
  const home = Paths.home();
  for (const c of [path.join(home, '.local', 'bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (e) { /* next */ }
  }
  try {
    const p = execFileSync('/bin/zsh', ['-lc', `command -v ${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
    if (p && p.startsWith('/')) return p;
  } catch (e) { /* not found */ }
  return null;
}

// --permission-mode values offered for a new Claude session; bypassPermissions deliberately is not.
const MODES = ['plan', 'acceptEdits', 'auto'];
// The same modes in the other CLIs (codex-cli 0.154, agy 2026-09); never codex's danger-full-access. agy has no auto.
const AGENT_MODES = {
  codex: { plan: ['-s', 'read-only'], acceptEdits: ['-s', 'workspace-write'], auto: ['--approve-for-me'] },
  antigravity: { plan: ['--mode', 'plan'], acceptEdits: ['--mode', 'accept-edits'] },
};
function agentMode(agent, mode) {
  if (!mode) return [];
  const f = (AGENT_MODES[agent] || {})[String(mode)];
  if (!f) throw new Error(`permission mode for ${agent} must be one of ${Object.keys(AGENT_MODES[agent] || {}).join(', ')}`);
  return f;
}

/**
 * The argv for one dispatch. Pure. A new Claude session uses `--bg`, not `-p`, so it stays
 * listable, attachable and resumable in place. `--remote-control` is never combined with
 * `--bg`: the prompt is then not consumed.
 */
function buildCommand({ agent, text, dir, session, model, effort, print, chrome, addDirs, worktree, fork, mode }) {
  if (!AGENTS.includes(agent)) throw new Error(`agent must be one of ${AGENTS.join(', ')}`);
  const t = String(text || '').trim();
  if (!t) throw new Error('text is empty');
  // codex reads a prompt of `-` from stdin, which is closed here
  if (agent === 'codex' && t === '-') throw new Error('text is empty');
  const m = modelName(model);
  if (session) resumableId(agent, session);
  if (dir && !path.isAbsolute(String(dir))) throw new Error(`directory must be absolute: ${dir}`);
  if (agent === 'claude') {
    const args = print ? [] : ['--bg'];
    if (session) args.push('--resume', String(session));
    // Any extra flag on a resume makes the CLI fork a copy that ignores the prompt, so a
    // resume carries only the id and the text — except --fork-session, which asks for the copy.
    if (session && fork && !print) {
      args.push('--fork-session');
      if (worktree) args.push('--worktree');
      args.push('--', t);
      return { args, cwd: dir || undefined };
    }
    if (session) {
      if (print) args.push('-p');
      args.push('--', t);
      return { args, cwd: dir || undefined };
    }
    if (m) args.push('--model', m);
    // how hard it thinks, per start (a resume takes only the text: /effort is typed or sent instead)
    if (effort) { if (!EFFORTS.includes(String(effort))) throw new Error(`effort must be one of ${EFFORTS.join(', ')}`); args.push('--effort', String(effort)); }
    // opt-in per start; the extension still asks before it acts
    if (chrome) args.push('--chrome');
    if (mode) {
      if (!MODES.includes(String(mode))) throw new Error(`permission mode must be one of ${MODES.join(', ')}`);
      args.push('--permission-mode', String(mode));
    }
    if (worktree) args.push('--worktree');
    // grant the attachments' directory, or the agent cannot read them
    for (const d of addDirs || []) {
      if (!path.isAbsolute(String(d))) throw new Error(`directory must be absolute: ${d}`);
      args.push('--add-dir', String(d));
    }
    if (print) args.push('-p');
    args.push('--', t);
    return { args, cwd: dir || undefined };
  }
  // antigravity: one print run per message, stream-json read back by lib/antigravity.js. agy has
  // no -C (cwd is the folder); the text is -p's value, so a leading - is not a flag.
  if (agent === 'antigravity') {
    const args = ['-p', t, '--output-format', 'stream-json'];
    if (session) args.push('--conversation', String(session));
    if (m) args.push('--model', m);
    if (!session) args.push(...agentMode(agent, mode));
    for (const d of addDirs || []) {
      if (!path.isAbsolute(String(d))) throw new Error(`directory must be absolute: ${d}`);
      args.push('--add-dir', String(d));
    }
    return { args, cwd: dir || undefined };
  }
  // codex (codex-cli 0.154): `-C` belongs to `exec` and is refused after `resume`; all options
  // precede `--`. Both start and resume need --skip-git-repo-check, or a folder that is not a
  // trusted git repo is refused.
  const args = ['exec'];
  if (dir) args.push('-C', dir);
  // how hard it reasons, per run (start or resume): codex's own config key
  if (effort) { if (!CODEX_EFFORTS.includes(String(effort))) throw new Error(`effort must be one of ${CODEX_EFFORTS.join(', ')}`); args.push('-c', `model_reasoning_effort="${effort}"`); }
  if (!session) args.push('--skip-git-repo-check');
  if (session) args.push('resume');
  if (m) args.push('-m', m);
  // --worktree is refused without --enable worktrees
  if (!session) { args.push(...agentMode(agent, mode)); if (worktree) args.push('--enable', 'worktrees', '--worktree'); }
  if (session) args.push('--skip-git-repo-check', String(session));
  args.push('--', t);
  return { args, cwd: dir || undefined };
}

/**
 * Start the agent detached. Returns {pid, log, argv}. Throws on bad input
 * or a missing binary — the caller shows the message on the card.
 */
function dispatch({ agent, text, dir, session, model, effort, print, chrome, addDirs, worktree, fork, mode }) {
  if (!AGENTS.includes(agent)) throw new Error(`agent must be one of ${AGENTS.join(', ')}`);
  if (dir) {
    let st;
    try { st = fs.statSync(dir); } catch (e) { throw new Error(`directory not found: ${dir}`); }
    if (!st.isDirectory()) throw new Error(`not a directory: ${dir}`);
  }
  const bin = binaryFor(agent);
  if (!bin) throw new Error(`${agent} is not installed (not in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin or PATH)`);
  const { args, cwd } = buildCommand({ agent, text, dir, session, model, effort, print, chrome, addDirs, worktree, fork, mode });
  // an antigravity run's log is its transcript: kept apart, not pruned with the runs
  const agy = agent === 'antigravity';
  const rd = agy ? require('./antigravity.js').dir() : runsDir();
  fs.mkdirSync(rd, { recursive: true });
  try { pruneRuns(); } catch (e) { /* the logs only grow a while longer */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const log = path.join(rd, `${stamp}-${agent}${session ? '-reply' : ''}.log`);
  const fd = fs.openSync(log, 'a');
  // one line, whatever the message holds: forkedCopy() skips exactly one
  const q = (a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a);
  if (agy) fs.writeSync(fd, `# ${JSON.stringify({ rally: 1, t: Date.now(), prompt: String(text || '').trim(), cwd: cwd || Paths.home(), conversation: session || null, model: model || null })}\n`);
  else fs.writeSync(fd, `# ${new Date().toISOString()} ${bin} ${args.map(q).join(' ')}${cwd ? `  (cwd ${q(cwd)})` : ''}\n`);
  const child = spawn(bin, args, {
    cwd: cwd || Paths.home(),
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, PATH: [path.dirname(bin), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':') },
  });
  // unhandled, an async spawn error would crash the board server
  child.on('error', (e) => { try { fs.appendFileSync(log, `rally: could not start ${bin}: ${e.message}\n`); } catch (x) { /* nowhere to say it */ } });
  child.unref();
  fs.closeSync(fd);
  if (agy && child.pid) { try { fs.writeFileSync(log + '.pid', String(child.pid)); } catch (e) { /* taken as running a while */ } }
  // no pid: the spawn failed; 'error' fires too late for callers that wait synchronously
  if (!child.pid) {
    try { fs.appendFileSync(log, `rally: could not start ${bin}\n`); } catch (x) { /* nowhere to say it */ }
    throw new Error(tr('{agent} を起動できませんでした({bin})', { agent, bin }));
  }
  return { pid: child.pid, log, argv: [bin, ...args], cwd: cwd || Paths.home() };
}

/**
 * Stop a background session by its short id. A running one cannot be resumed in place
 * (it forks a copy) but a stopped one can, so the board stops an idle one, then resumes.
 */
function stopBackground(short) {
  const bin = binaryFor('claude');
  if (!bin || !short) return false;
  try {
    const r = execFileSync(bin, ['stop', String(short)], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    return /stopped/i.test(r || '');
  } catch (e) { return false; }
}

/**
 * Did the CLI fork a copy instead of continuing? Read from the detached run's log.
 * @returns {{copy: string}|null} the copy's short id
 */
function forkedCopy(log, waitMs = 4000) {
  const r = outcome(log, waitMs);
  return r && r.copy ? { copy: r.copy } : null;
}

// What the CLI says when it did not take the message. Matched on its first line only:
// later lines can be agent output (codex echoes the prompt).
const REFUSED = /^\s*(Workspace not trusted.*|Couldn't start a background session.*|Not inside a trusted directory.*|API Error.*)$/;
const FIRST_ERROR = /^\s*(Error: .+)$/;
/** A `codex exec … resume <thread>` the board started is still running for this thread. */
function codexExecRunning(tid, self) {
  // another one than the run that just failed (it may not have exited yet)
  try { return execFileSync('/usr/bin/pgrep', ['-fl', tid], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').some((l) => /\bexec\b.*\bresume\b/.test(l) && +l.split(' ')[0] !== +self); }
  catch (e) { return false; }                      // pgrep exits 1 when nothing matches
}
const CODEX_BUSY = tr('このセッションは別の codex(端末やアプリ)で開いているので、送れませんでした。そこで打つか、その codex を閉じてから送り直してください');

// the CLI colours its output even into a file
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

/** The short id `claude --bg` printed ("backgrounded · <id>"), or null. */
function startedShort(log) {
  let t = '';
  try { t = fs.readFileSync(log, 'utf8'); } catch (e) { return null; }
  const m = plain(t.startsWith('# ') ? t.slice(t.indexOf('\n') + 1 || t.length) : t).match(/backgrounded\s*[·:]\s*([0-9a-f]{6,})/i);
  return m ? m[1] : null;
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms) { Atomics.wait(SLEEP, 0, 0, ms); }

function exited(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
}

/**
 * What became of a detached start, from its log: a forked copy ({copy}), a refusal
 * ({refused, saved, busy}), an agy conversation id, or null (nothing went wrong that it said).
 */
function outcome(log, waitMs = 4000, pid) {
  // RALLY_OUTCOME_MS caps the watch (tests)
  const cap = +Env.get('OUTCOME_MS'); if (cap > 0) waitMs = Math.min(waitMs, cap);
  const deadline = Date.now() + waitMs;
  let last = false;
  for (;;) {
    let text = '';
    try { text = fs.readFileSync(log, 'utf8'); } catch (e) { /* not written yet */ }
    // skip dispatch()'s header line: it holds the argv, message included
    const out = plain(text.startsWith('# ') ? text.slice(text.indexOf('\n') + 1 || text.length) : text);
    const m = out.match(/started a copy as ([0-9a-f]{6,})/i);
    // "could not check whether … is running": an unparseable ~/.claude/sessions/ record makes
    // every resume a copy, so retrying only makes more (unchecked)
    if (m) { const u = /could not (check whether session|read the saved state)/i.test(out); return { copy: m[1], unverified: u, unchecked: u }; }
    // codex: the session is open in another codex (a terminal, the app) — only one may write it, so nothing was sent
    // the writer is the board's own `codex exec … resume` still answering the previous message: held, and sent when that
    // turn ends (it read 送れませんでした whenever two were sent close together). An open codex TUI stays for hours: not held.
    if (/thread-store conflict|already has an active writer/i.test(out)) {
      const tid = (out.match(/thread ([0-9a-f-]{36}) already has an active writer/i) || [])[1];
      return tid && codexExecRunning(tid, pid) ? { refused: CODEX_BUSY, saved: false, busy: true } : { refused: CODEX_BUSY, saved: false, busy: false };
    }
    // the CLI's first line, past note:/warning: and codex's "Reading … from stdin"
    const line = out.split('\n').find((l) => l.trim() && !/^\s*(note|warning):/i.test(l) && !/^Reading (additional input|prompt) from stdin/.test(l)) || '';
    const bad = line.match(REFUSED) || line.match(FIRST_ERROR);
    if (bad) return { refused: bad[1].replace(/\s*Your message is saved.*$/, '').slice(0, 300), saved: /Your message is saved/i.test(out), busy: /is running as a background session/i.test(out) };
    // agy: its first line names the conversation — the run is under way
    const init = out.match(/^\{"event":"init","conversation_id":"([0-9a-f-]{36})"/m);
    if (init) return { conversation: init[1] };
    // done: it said so, the time is up, or the process is gone (then one last read)
    if (/backgrounded/i.test(out) || Date.now() > deadline || last) return null;
    if (exited(pid)) last = true;
    // a real sleep, not a busy loop
    sleepMs(120);
  }
}

/**
 * Continue one session with one message and read back what the CLI said. The single path
 * for both a send and a queued message. `a` is the alive.js entry (resumeAs: the job's own
 * id). A copy the CLI forked is stopped here.
 * @returns {{sent: true, pid, log, argv} | {copy, unchecked, unverified, log} | {refused, saved, busy, log}}
 */
function resume({ agent, id, a, text, model, effort, dir, addDirs }) {
  const E = module.exports;                  // through the exports: tests stand in for dispatch and outcome
  const r = E.dispatch({ agent, text, session: (a && a.resumeAs) || id, model, effort: agent === 'codex' ? effort : undefined, dir, addDirs });
  // codex refuses at once if at all; anything later is work
  const got = E.outcome(r.log, agent === 'codex' ? 1200 : 6000, r.pid);
  if (got && got.copy) { E.stopBackground(got.copy); return { ...got, log: r.log }; }
  if (got && got.refused) return { ...got, log: r.log };
  return { sent: true, pid: r.pid, log: r.log, argv: r.argv };
}

/** Session records under ~/.claude/sessions/ that do not parse (one breaks the CLI's running check). @returns {string[]} */
function unreadableSessionRecords() {
  const dir = Paths.claudeDir('sessions');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (e) { return []; }
  return names.map((n) => path.join(dir, n)).filter((f) => {
    try { JSON.parse(fs.readFileSync(f, 'utf8')); return false; } catch (e) { return e.code !== 'ENOENT'; }
  });
}

/** What to tell the person when the CLI could not check (outcome's unverified). */
function unverifiedError() {
  const bad = unreadableSessionRecords();
  return bad.length
    ? tr('Claude がセッションの状態を確かめられず、続きではなくコピーを作るので送りませんでした。壊れたセッション記録があります: {bad}(ディスクが一杯のときに書きかけで残ったもの。中の最初の {…} だけを残すか、そのセッションを終了すると直ります)', { bad: bad.join(', ') })
    : tr('Claude がセッションの状態を確かめられず、続きではなくコピーを作るので送りませんでした(claude agents --json で様子を見てください)');
}

// Run logs are kept this long; what the board still needs from pruned ones is kept in runs/index.json.
const RUNS_KEEP_MS = 7 * 86400000;
const INDEX_KEEP_MS = 60 * 86400000;
const PRUNE_EVERY_MS = 6 * 3600000;
const indexPath = () => path.join(runsDir(), 'index.json');
function readIndex() {
  try { const j = JSON.parse(fs.readFileSync(indexPath(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
}

// the copies one log says the CLI started, from its output, never the header's argv
function copiesIn(text) {
  const out = String(text || '');
  const body = out.startsWith('# ') ? out.slice(out.indexOf('\n') + 1 || out.length) : out;
  return [...new Set([...plain(body).matchAll(/started a copy as ([0-9a-f]{6,})/gi)].map((m) => m[1].toLowerCase().slice(0, 8)))];
}
// a codex log's header: the session it answered, or where and when it started one
function codexOf(head) {
  const m = /^# (\S+) /.exec(head);
  const t = m ? Date.parse(m[1]) : NaN;
  const r = /\bresume (?:--skip-git-repo-check )?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(head);
  if (r) return { id: r[1], t };
  const c = / -C (\S+)/.exec(head) || /\(cwd ([^)]+)\)\s*$/.exec(head);
  return c && !Number.isNaN(t) ? { start: { t, dir: c[1] } } : null;
}
function headOf(file) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(8192); const k = fs.readSync(fd, b, 0, b.length, 0); return b.slice(0, k).toString('utf8').split('\n')[0]; } finally { fs.closeSync(fd); }
}

/** Remove run logs older than `keepMs`, first saving their facts to the index. At most every PRUNE_EVERY_MS unless `force`. Returns how many went. */
function pruneRuns({ now = Date.now(), keepMs = RUNS_KEEP_MS, force = false } = {}) {
  const dir = runsDir();
  const idx = readIndex();
  if (!force && idx.prunedAt && now - idx.prunedAt < PRUNE_EVERY_MS) return 0;
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.log')); } catch (e) { return 0; }
  const copies = idx.copies || {}, codexIds = idx.codexIds || {};
  let codexStarts = idx.codexStarts || [];
  const gone = [];
  for (const n of names) {
    const f = path.join(dir, n);
    let st; try { st = fs.statSync(f); } catch (e) { continue; }
    if (now - st.mtimeMs <= keepMs) continue;
    try {
      for (const id of copiesIn(fs.readFileSync(f, 'utf8'))) copies[id] = st.mtimeMs;
      if (/-codex(-reply)?\.log$/.test(n)) {
        const c = codexOf(headOf(f));
        if (c && c.id) codexIds[c.id] = st.mtimeMs;
        if (c && c.start) codexStarts.push(c.start);
      }
    } catch (e) { continue; }                   // unread: kept for the next pass
    gone.push(f);
  }
  const fresh = (o) => Object.fromEntries(Object.entries(o).filter(([, t]) => now - t < INDEX_KEEP_MS));
  codexStarts = codexStarts.filter((x) => now - x.t < INDEX_KEEP_MS);
  try {
    require('./fsx.js').writeJSONAtomic(indexPath(), { prunedAt: now, copies: fresh(copies), codexIds: fresh(codexIds), codexStarts });
  } catch (e) { return 0; }                     // nothing is removed whose facts were not kept
  let n = 0;
  for (const f of gone) { try { fs.unlinkSync(f); n++; } catch (e) { /* gone already */ } }
  return n;
}

/** Short ids of the copies this board's sends made, from the run logs and index. A log is re-read only when its size or mtime changes. */
let copyCache = null;
function boardCopies() {
  const dir = runsDir();
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.log')); } catch (e) { return new Set(); }
  if (!copyCache || copyCache.dir !== dir) copyCache = { dir, files: new Map(), index: [], indexKey: null };
  let ik = '';
  try { const st = fs.statSync(indexPath()); ik = `${st.mtimeMs}:${st.size}`; } catch (e) { /* none yet */ }
  if (ik !== copyCache.indexKey) { copyCache.index = Object.keys(readIndex().copies || {}); copyCache.indexKey = ik; }
  const ids = new Set(copyCache.index);
  const seen = new Set(names);
  for (const k of [...copyCache.files.keys()]) if (!seen.has(k)) copyCache.files.delete(k);
  for (const n of names) {
    let st; try { st = fs.statSync(path.join(dir, n)); } catch (e) { continue; }
    const key = `${st.mtimeMs}:${st.size}`;
    let hit = copyCache.files.get(n);
    if (!hit || hit.key !== key) {
      let t = '';
      try { t = fs.readFileSync(path.join(dir, n), 'utf8'); } catch (e) { continue; }
      hit = { key, ids: copiesIn(t) };
      copyCache.files.set(n, hit);
    }
    for (const id of hit.ids) ids.add(id);
  }
  return ids;
}

/**
 * Codex sessions this board started or answered, so the reader does not take their
 * `codex exec` origin for a script's. A reply names its id; a start is known by where and
 * when. @returns {{ids: Set, starts: [{t, dir}]}}
 */
let codexCache = null;
function boardCodex() {
  const dir = runsDir();
  let names;
  try { names = fs.readdirSync(dir).filter((n) => /-codex(-reply)?\.log$/.test(n)); } catch (e) { return { ids: new Set(), starts: [] }; }
  let ik = '';
  try { const st = fs.statSync(indexPath()); ik = `${st.mtimeMs}:${st.size}`; } catch (e) { /* none yet */ }
  const key = dir + '\0' + names.length + '\0' + (names.length ? names.reduce((a, b) => (a > b ? a : b)) : '') + '\0' + ik;
  if (codexCache && codexCache.key === key) return codexCache.v;
  const heads = codexCache && codexCache.dir === dir ? codexCache.heads : new Map();
  const idx = readIndex();
  const ids = new Set(Object.keys(idx.codexIds || {})), starts = [...(idx.codexStarts || [])];
  const seen = new Set(names);
  for (const k of [...heads.keys()]) if (!seen.has(k)) heads.delete(k);
  for (const n of names) {
    if (!heads.has(n)) { try { heads.set(n, codexOf(headOf(path.join(dir, n)))); } catch (e) { continue; } }
    const c = heads.get(n);
    if (c && c.id) ids.add(c.id);
    else if (c && c.start) starts.push(c.start);
  }
  codexCache = { key, dir, heads, v: { ids, starts } };
  return codexCache.v;
}

module.exports = { AGENT_MODES, pruneRuns, RUNS_KEEP_MS, resume, exited, sleepMs, MODES, boardCodex, boardCopies, unreadableSessionRecords, unverifiedError, AGENTS, UUID, resumableId, recordId, modelName, runsDir, binaryFor, buildCommand, dispatch, stopBackground, forkedCopy, outcome, startedShort, plain };
