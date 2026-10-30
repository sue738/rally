#!/usr/bin/env node
/**
 * rally — one list of every coding-agent session on this machine.
 *
 *   rally                  serve http://127.0.0.1:7331/ and open it
 *   rally --port 8000 --hours 48 --no-open
 *   rally now [--hours 6]  the same columns as text
 */
'use strict';

const Env = require('../lib/env.js');
const path = require('path');
const Paths = require('../lib/paths.js');
const Board = require('../lib/board.js');
const Text = require('../lib/text.js');
const { NAME } = Board;

const JA = /^ja/i.test(Env.get('LANG') || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '');
const L = (en, ja) => (JA ? ja : en);
const n = (x) => Number(x || 0).toLocaleString('en-US');

const HELP = `${NAME} — one list of every coding-agent session on this machine

Usage:
  ${NAME} [options]            serve the board on 127.0.0.1 and open it
  ${NAME} now [options]        the same columns as text
  ${NAME} state [options]      the board's state as JSON, once (what the app uses — no server)
  ${NAME} log [--limit N]      what the app did: every button, every one-shot, every page error
  ${NAME} eta-report [--days N] [--json]   how the completion estimates changed and how close they were
  ${NAME} page                 the board's HTML
  ${NAME} history --as claude --session ID   one session's conversation as JSON (what the detail panel shows)
  ${NAME} wtsetup --cwd DIR [--include a,b | --setup CMD]   what a new worktree would lack (.env …), add to .worktreeinclude, keep a setup command
  ${NAME} perm [--shim | --id ID --answer allow|rule|always|automode|deny|pass|answer [--text T] [--answers JSON]]   permission prompts held for the board (lib/permhook.js), or answer one with the terminal's choices (rule: allow and save --text as a Bash rule; always: allow and save what Claude Code offered; automode: allow and switch the session to auto mode; deny: --text is what to tell Claude; answer: a question, with {"question text":"choice"})
  ${NAME} takeover --session ID   close another terminal's idle claude of this session (SIGTERM, never SIGKILL) and wait until it is gone (ここで開き直す)
  ${NAME} run --as claude|codex --text "…" [--cwd DIR] [--chrome] [--mode plan|acceptEdits]  start an agent headless (--chrome: let it drive Chrome)
  ${NAME} reply --as claude|codex --session ID --text "…" [--when-free]  continue a session headless (what send does; --when-free: 今の作業後に送る, held while it is at work)
  ${NAME} queue --as claude --session ID [--text "…" | --cancel [--key K] | --now --key K]  hold a message, take it back, or send one held message now
  ${NAME} wip                  what is still open in the sessions that were read (the 残作業 view)
  ${NAME} wip --all [--limit N] [--hours H]   read the half-finished ones that were never read (default 10)
  ${NAME} wip --as claude --session ID   read the tail and cache what is still open (what 棚卸し does)
  ${NAME} bgtasks [--stop JSON | --on | --off]   stop background tasks of live sessions (each re-checked first), or turn the automatic stop of stale wait loops on / off
  ${NAME} done --as claude --session ID [--memory]  close a session (--memory: ask it to save what it learned)

Options:
  --port N             port (default 7331)
  --hours N            sessions touched in the last N hours (default 24)
  --agent a[,b]        only these agents
  --dir agent=path     override an agent's transcript root (repeatable)
  --no-open            do not open the browser
  --json               (now) machine-readable
  --all                (now) include finished sessions, subagents and machine-started runs
  --enrich             (state) start background title generation for a few cards missing one
                        (claude -p --model haiku; needs claude installed; RALLY_NO_ENRICH=1 disables it)

Columns are read from each session's last transcript entries and its
subagents', corrected by \`claude agents --json\` (busy / waiting). Nothing is
written to an agent unless you send, start or close.`;

function parseArgs(argv) {
  const o = { dirs: {} };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = +argv[++i];
    else if (a === '--hours') o.hours = +argv[++i];
    else if (a === '--agent') o.only = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--dir') { const v = String(argv[++i] || ''); const k = v.indexOf('='); if (k > 0) o.dirs[v.slice(0, k)] = v.slice(k + 1); }
    else if (a === '--no-open') o.noOpen = true;
    else if (a === '--type') o.typeInto = true;
    else if (a === '--when-free') o.whenFree = true;
    else if (a === '--ours') o.ours = true;
    else if (a === '--key') o.key = argv[++i];
    else if (a === '--now') o.now = true;
    else if (a === '--plain') o.plain = true;
    else if (a === '--delivered') o.delivered = true;
    else if (a === '--json') o.json = true;
    else if (a === '--all') o.all = true;
    else if (a === '--enrich') o.enrich = true;
    else if (a === '--file') o.file = argv[++i];
    else if (a === '--id') o.id = argv[++i];
    else if (a === '--watch') o.watch = true;
    else if (a === '--icon') o.iconOnly = true;
    else if (a === '--worktree') o.worktree = true;
    else if (a === '--fork') o.fork = argv[++i];
    else if (a === '--answer') o.answer = argv[++i];
    else if (a === '--answers') o.answers = argv[++i];
    else if (a === '--last-tool') o.lastTool = argv[++i];
    else if (a === '--tools') o.tools = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--targets') o.targets = String(argv[++i] || '').split('|').filter(Boolean);
    else if (a === '--project') o.project = argv[++i];
    // the app passes the words as an argument, and macOS hands a Process's arguments over decomposed (で as て + ゛): put them
    // back, or the held line the page drew (composed) never matched the queued one (it showed twice) and the session read NFD
    else if (a === '--text') { const v = argv[++i]; o.text = typeof v === 'string' ? v.normalize('NFC') : v; }
    else if (a === '--session') o.session = argv[++i];
    else if (a === '--cwd') o.dirArg = argv[++i];
    else if (a === '--include') o.include = argv[++i];
    else if (a === '--drop') o.drop = argv[++i];
    else if (a === '--setup') o.setup = argv[++i];
    else if (a === '--as') o.agentName = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--effort') o.effort = argv[++i];
    else if (a === '--color') o.color = argv[++i];
    else if (a === '--cancel') o.cancel = true;
    else if (a === '--park') o.park = true;
    else if (a === '--on') o.on = true;
    else if (a === '--off') o.off = true;
    else if (a === '--retry') o.retry = true;
    else if (a === '--edit') o.edit = true;
    else if (a === '--off') o.off = true;
    else if (a === '--memory') o.memory = true;
    else if (a === '--force') o.force = true;
    else if (a === '--merge') o.merge = true;
    else if (a === '--shim') o.shim = true;
    else if (a === '--chrome') o.chrome = true;
    else if (a === '--mode') o.mode = argv[++i];
    else if (a === '--limit') o.limit = +argv[++i];
    else if (a === '--days') o.days = +argv[++i];
    else if (a === '--do') o.do = argv[++i];
    else if (a === '--stop') o.stopList = argv[++i];
    else if (a === '--reap') o.reap = true;
    else if (a === '--attach') { (o.attach = o.attach || []).push(String(argv[++i] || '')); }
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a.startsWith('-')) { console.error(L(`unknown option ${a}`, `不明なオプション ${a}`)); process.exit(2); }
    else rest.push(a);
  }
  if (o.hours != null && !(Number.isFinite(o.hours) && o.hours > 0)) { console.error(L('--hours: expected a positive number', '--hours: 正の数で指定してください')); process.exit(2); }
  o.command = rest[0] || 'serve';
  return o;
}

function short(p) { return (String(p).split('/').filter(Boolean).pop() || String(p)).slice(0, 24); }

/**
 * The ask becomes a started session's 概要 at once. `claude --bg` prints a short id;
 * `claude agents --json` maps it to the session id. Best effort: a run must not fail over it.
 */
async function nameStartedSession(r, o) {
  // agy names its conversation on its log's first line
  if (o.agentName === 'antigravity') {
    if (!r || !r.log) return null;
    // the outcome watch may have ended before that line was written
    for (let i = 0; i < 20 && !r.conversation; i++) {
      const m = (() => { try { return /^\{"event":"init","conversation_id":"([0-9a-f-]{36})"/m.exec(require('fs').readFileSync(r.log, 'utf8')); } catch (e) { return null; } })();
      if (m) r.conversation = m[1]; else await new Promise((res) => setTimeout(res, 250));
    }
    if (!r.conversation) return null;
    try { require('../lib/labels.js').set({ agent: 'antigravity', id: r.conversation, label: String(o.text || '').replace(/\s+/g, ' ').slice(0, 40), auto: true }); } catch (e) { /* a generated title then */ }
    return { id: r.conversation, short: r.conversation.slice(0, 8) };
  }
  if (o.agentName !== 'claude' || !r || !r.log) return null;
  const fs_ = require('fs');
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  let shortId = null;
  for (let i = 0; i < 20 && !shortId; i++) {
    await sleep(250);
    shortId = require('../lib/dispatch.js').startedShort(r.log);
  }
  if (!shortId) return null;
  try {
    const Alive = require('../lib/alive.js');
    const Labels = require('../lib/labels.js');
    for (let i = 0; i < 8; i++) {
      for (const [id, a] of Alive.sessions()) {
        if (a && a.short === shortId) {
          Labels.set({ agent: 'claude', id, label: String(o.text || '').replace(/\s+/g, ' ').slice(0, 40), auto: true });
          return { id, short: shortId };
        }
      }
      await sleep(400);
    }
  } catch (e) { /* the card will get a generated title instead */ }
  // not listed yet: the short id is still the session's (its id begins with it)
  return { id: null, short: shortId };
}

function cmdNow(o) {
  const st = Board.state({ hours: o.hours || 24, only: o.only, dirs: o.dirs });
  if (o.json) return console.log(Text.json(st));
  // same default as the board: no subagents or machine-started runs unless --all
  const cards = st.cards.filter((c) => o.all || (!c.subagent && !c.headless));
  const ago = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 86400)}d`);
  console.log(L(`${NAME} — sessions touched in the last ${st.hours}h`, `${NAME} — 直近${st.hours}時間に動いたセッション`));
  if (st.limits) {
    const left = (t) => { const x = Math.max(0, Math.round((t - Date.now()) / 60000)); return x < 60 ? `${x}m` : x < 1440 ? `${Math.floor(x / 60)}h${String(x % 60).padStart(2, '0')}m` : `${Math.floor(x / 1440)}d${Math.round((x % 1440) / 60)}h`; };
    const one = (label, w) => (w ? `${label} ${w.used}% (${L('resets in', 'あと')} ${left(w.resetsAt)})` : null);
    const both = (st.limits.fiveHour || st.limits.week) && st.limits.codex;
    const line = (x) => [one('5h', x.fiveHour), one(L('week', '週'), x.week)].filter(Boolean).join(' · ');
    if (st.limits.fiveHour || st.limits.week) console.log('  ' + (both ? 'claude ' : '') + line(st.limits));
    if (st.limits.codex) console.log('  ' + (both ? 'codex  ' : '') + line(st.limits.codex));
  }
  const LANES = { yours: ['approval', 'needs-you', 'answered'], working: ['working'], stale: ['stale'], ended: ['done', 'idle'] };
  const cols = o.all ? ['yours', 'stale', 'working', 'ended'] : ['yours', 'stale', 'working'];
  const TITLES = { yours: 'Your Turn', working: 'Working', stale: 'Waiting', ended: 'Completed' };
  // blocked first, then answered — the order the page uses
  const rank = (c) => (c.column === 'approval' || /^(asked you a question|waiting for)/.test(c.reason || '') ? 0 : c.column === 'needs-you' ? 1 : 2);
  for (const col of cols) {
    let cs = cards.filter((c) => LANES[col].includes(c.column));
    if (col === 'yours') cs = cs.sort((x, y) => rank(x) - rank(y) || (y.lastT || 0) - (x.lastT || 0));
    if (!cs.length && col === 'stale') continue;
    console.log(`\n${TITLES[col]} (${n(cs.length)})`);
    for (const c of cs.slice(0, col === 'ended' ? 10 : 50)) {
      console.log(`  ${c.agent.padEnd(7)} ${ago(c.idleS).padStart(5)}  ${short(c.project).padEnd(24)} ${c.title ? c.title.slice(0, 40) : c.reason}  …${c.id.slice(-8)}`);
      const w = c.wip;
      if (w && w.status === 'ok' && (w.remaining || []).length) {
        console.log(`  ${' '.repeat(7)} ${L('open', '残り')} ${w.remaining.length}: ${w.remaining.map((r) => r.what).join(' / ').slice(0, 96)}`);
      }
    }
    if (col === 'ended' && cs.length > 10) console.log(`  … ${n(cs.length - 10)} more`);
  }
  const doneCount = st.cards.filter((c) => c.column === 'idle').length;
  if (!o.all && doneCount) console.log(L(`\n  (${n(doneCount)} automatic / ended sessions hidden — --all shows them)`, `\n  (自動・終了 ${n(doneCount)} 件は非表示 — --all で表示)`));
  const hidden = st.cards.length - cards.length;
  if (hidden > 0 && !o.all) console.log(L(`\n  (${n(hidden)} subagent / machine-started sessions hidden — --all shows them)`, `\n  (サブエージェント・自動実行 ${n(hidden)} 件は非表示 — --all で表示)`));
  console.log(L(`\n  resume: claude --resume <id> · codex resume <id>   ·   ${NAME} for the page`, `\n  再開: claude --resume <id> · codex resume <id>   ·   画面は ${NAME}`));
}

/**
 * `rally worker`: the app's refreshes without a new process each time. A line of JSON on stdin ({id, argv}) runs that
 * command, `state` or `history`, in this process; the answer is one line, `<id> <exit code> <the command's output>`
 * (its output is one line of JSON). Scanning keeps its cache in memory and its file list up to date from events
 * (lib/scan.js persist), which is most of a refresh's cost. The app falls back to a process per command whenever this one
 * is not there, so nothing depends on it. Leaving (stdin closed, SIGTERM) writes the cache to disk.
 */
const WORKER_COMMANDS = new Set(['state', 'history']);
async function runCaptured(argv) {
  const keep = { write: process.stdout.write, argv: process.argv };
  let out = '';
  process.stdout.write = (s) => { out += typeof s === 'string' ? s : Buffer.from(s).toString('utf8'); return true; };
  process.argv = [keep.argv[0], keep.argv[1], ...argv];
  process.exitCode = 0;
  try { await main(); }
  catch (e) { out = String(e && e.message || e); process.exitCode = 1; }
  finally { process.stdout.write = keep.write; process.argv = keep.argv; }
  const code = process.exitCode || 0;
  process.exitCode = 0;
  return { out, code };
}
function cmdWorker() {
  const Scan = require('../lib/scan.js');
  Scan.persist(true);
  const bye = () => { try { Scan.persist(false); } catch (e) { /* leaving anyway */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
  let buf = '', chain = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      chain = chain.then(async () => {
        let req = null;
        try { req = JSON.parse(line); } catch (e) { return; }
        const argv = Array.isArray(req.argv) ? req.argv.map(String) : [];
        let r;
        if (!WORKER_COMMANDS.has(argv[0])) r = { out: 'not a worker command: ' + argv[0], code: 2 };
        else r = await runCaptured(argv);
        process.stdout.write(`${req.id} ${r.code} ${String(r.out).replace(/\n/g, ' ')}\n`);
        // a resident helper must not grow without bound: past this much memory it leaves, and the app starts a fresh one
        // (the commands go as processes in between)
        // 600 MB was reached right after warming up on a large transcript, so it restarted about once a minute (cold each time)
        const cap = (+Env.get('WORKER_MAX_MB') || 1200) * 1048576;
        if (process.memoryUsage().rss > cap) bye();
      });
    }
  });
  process.stdin.on('end', () => { chain.then(bye); });
}

async function main() {
  const o = parseArgs(process.argv);
  // a data directory under an older name is moved to ~/.rally first (lib/paths.js migrate)
  Paths.migrate();
  if (o.command === 'now') return cmdNow(o);
  if (o.command === 'worker') return cmdWorker();
  if (o.command === 'state') {
    // one shot for the app: the JSON the page needs, no server. RALLY_NO_ENRICH overrides
    // --enrich unconditionally (tests must not start real `claude -p` title calls).
    const enrich = !!o.enrich && !Env.get('NO_ENRICH');
    // --watch: the page is on screen, so prompts may wait for it; --reap: see lib/bgtasks.js
    const st = Board.state({ hours: o.hours || 24, only: o.only, dirs: o.dirs, enrich, watch: !!o.watch, reap: !!o.reap });
    st.cards = st.cards.map((c) => ({ ...c, resume: Board.resumeHint(c) }));
    return process.stdout.write(Text.json(st));
  }
  if (o.command === 'eta-report') {
    // what the completion estimates said and how they came out (lib/etalog.js)
    const r = require('../lib/etalog.js').report({ days: o.days || 7 });
    return process.stdout.write(o.json ? Text.json(r) : r.text + '\n');
  }
  if (o.command === 'history') {
    // one shot for the app's detail panel: one session's whole conversation
    const h = Board.historyFor({ agent: o.agentName, id: o.session, hours: o.hours || 24, dirs: o.dirs });
    return process.stdout.write(Text.json(h));
  }
  if (o.command === 'pr') {
    // one shot for the app: where a session's branch stands, and its pull request (lib/pr.js)
    const sess = Board.sessionRecord({ agent: o.agentName, id: o.session, hours: o.hours || 24, dirs: o.dirs });
    return process.stdout.write(Text.json({ agent: o.agentName, session: o.session, status: sess && sess.project ? require('../lib/pr.js').status(sess.project) : null }));
  }
  if (o.command === 'wtsetup') {
    // one shot for the app: what a new worktree of --cwd would lack (lib/wtsetup.js); --setup '' drops it
    const W = require('../lib/wtsetup.js');
    if (o.include != null) return process.stdout.write(Text.json(W.include(o.dirArg, String(o.include).split(',').filter(Boolean))));
    if (o.setup != null) return process.stdout.write(Text.json(W.setSetup(o.dirArg, o.setup)));
    return process.stdout.write(Text.json(W.inspect(o.dirArg) || { error: 'git のリポジトリではありません' }));
  }
  if (o.command === 'prmerge') {
    // one shot for the app: マージして片付け (--merge) or 片付け for a session's PR
    try { return process.stdout.write(Text.json({ agent: o.agentName, session: o.session, ...Board.prFinish({ agent: o.agentName, id: o.session, merge: !!o.merge, dirs: o.dirs }) })); }
    catch (e) { process.stdout.write(Text.json({ agent: o.agentName, session: o.session, ok: false, steps: [], error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command === 'perm') {
    // one shot for the app: answer a held permission prompt (lib/perm.js); no --id lists them
    const Perm = require('../lib/perm.js');
    // --shim: at launch the app points <home>/bin/permhook (and bin/statusline) at its own node and lib/
    if (o.shim) { try { const sl = require('../lib/statusline.js'); try { sl.installShim(); } catch (e) { /* the hook's shim still counts */ } return process.stdout.write(Text.json({ ok: true, ...Perm.installShim(), hook: Perm.hookTarget() || 'none', statusline: sl.installed() })); } catch (e) { return process.stdout.write(Text.json({ error: String(e && e.message || e) })); } }
    if (!o.id) return process.stdout.write(Text.json({ asks: Perm.list() }));
    let answers = null;
    if (o.answers != null) { try { answers = JSON.parse(o.answers); } catch (e) { return process.stdout.write(Text.json({ error: 'bad --answers' })); } }
    return process.stdout.write(Text.json(Perm.answer(o.id, o.answer, o.answer === 'answer' ? answers : o.text) ? { ok: true } : { error: o.answer === 'answer' ? 'この質問はもう終わっているか、答えが揃っていません' : 'この許可確認はもう終わっています' }));
  }
  if (o.command === 'stop') {
    // one shot for the app: stop a background session (the conversation is kept)
    const D = require('../lib/dispatch.js');
    const id = String(o.session || '');
    if (!D.UUID.test(id)) return process.stdout.write(Text.json({ error: 'bad session id' }));
    return process.stdout.write(Text.json(D.stopBackground(id.slice(0, 8)) ? { ok: true } : { error: '止められませんでした(もう止まっているか、バックグラウンドのセッションではありません)' }));
  }
  if (o.command === 'bgopen') {
    // one shot for the app: a stopped session opened as a background one (lib/bgopen.js), to attach to
    try { return process.stdout.write(Text.json(require('../lib/bgopen.js').open({ id: o.session, mode: o.mode, cwd: o.dirArg }))); }
    catch (e) { return process.stdout.write(Text.json({ error: String(e && e.message || e) })); }
  }
  if (o.command === 'bgstop') {
    // one shot for the app: a background session opened only to be looked at, stopped again once let go (idle only)
    try { return process.stdout.write(Text.json(require('../lib/bgopen.js').stopIdle({ id: o.session, force: !!o.force }))); }
    catch (e) { return process.stdout.write(Text.json({ error: String(e && e.message || e) })); }
  }
  if (o.command === 'bgtasks') {
    // one shot for the app: 裏で実行中's list; --stop re-checks each first (same parent, same command line)
    const B = require('../lib/bgtasks.js');
    if (o.on || o.off) return process.stdout.write(Text.json(B.setAuto(!!o.on)));
    if (o.stopList != null) {
      let list; try { list = JSON.parse(o.stopList); } catch (e) { return process.stdout.write(Text.json({ error: 'bad --stop' })); }
      if (!Array.isArray(list) || !list.length || list.length > 50) return process.stdout.write(Text.json({ error: 'bad --stop' }));
      const results = list.map((t) => B.stop({ pid: t && t.pid, ppid: t && t.ppid, sig: t && t.sig }));
      return process.stdout.write(Text.json({ ok: results.every((r) => r.ok), results }));
    }
    return process.stdout.write(Text.json({ auto: B.autoOn() }));
  }
  if (o.command === 'takeover') {
    // one shot for the app: close another terminal's idle claude of this session and wait until it is
    // gone, so the resume does not fork a copy (lib/takeover.js)
    try { const r = require('../lib/takeover.js').run({ id: o.session }); if (r.error) process.exitCode = 1; return process.stdout.write(Text.json(r)); }
    catch (e) { process.exitCode = 1; return process.stdout.write(Text.json({ error: String(e && e.message || e) })); }
  }
  if (o.command === 'startterm') {
    // one shot for the app: start a new session in a Ghostty tab (where the CLI will start it)
    try { return process.stdout.write(Text.json(require('../lib/term.js').startInTerminal({ dir: o.dirArg, text: o.text, model: o.model, agent: o.agentName || 'claude', worktree: !!o.worktree }))); }
    catch (e) { return process.stdout.write(Text.json({ error: String(e && e.message || e) })); }
  }
  if (o.command === 'attachterm') {
    // one shot for the app: open the session in a new Ghostty tab (claude attach), which delivers what it holds
    return process.stdout.write(Text.json(require('../lib/term.js').openAttach(String(o.session || ''), o.dirArg)));
  }
  if (o.command === 'jobs') {
    // one shot for the app: launchd jobs; --do run|pause|resume|delete --id <label> changes one
    const J = require('../lib/jobs.js');
    if (o.do) { const r = J.act({ label: o.id, action: o.do }); if (r.error) process.exitCode = 1; return process.stdout.write(Text.json(r)); }
    return process.stdout.write(Text.json({ jobs: J.list() }));
  }
  if (o.command === 'search') {
    // one shot for the app: words in the conversations of the sessions in the window
    const words = String(o.text || '').split(/\s+/).filter(Boolean);
    return process.stdout.write(Text.json({ q: o.text || '', ...Board.searchConversations({ words, hours: o.hours || 24, dirs: o.dirs }) }));
  }
  if (o.command === 'typeterm') {
    // one shot for the app: type a /command into the terminal a session is open in
    const sess = Board.sessionRecord({ agent: o.agentName, id: o.session, hours: o.hours || 24, dirs: o.dirs });
    if (!sess) return process.stdout.write(Text.json({ ok: false, error: 'セッションが見つかりません' }));
    return process.stdout.write(Text.json(require('../lib/term.js').typeCommand({ file: sess.file, cwd: o.dirArg || sess.project, text: o.text })));
  }
  if (o.command === 'focusterm') {
    // one shot for the app: bring forward the Ghostty terminal a session runs in
    const sess = Board.sessionRecord({ agent: o.agentName, id: o.session, hours: o.hours || 24, dirs: o.dirs });
    if (!sess) return process.stdout.write(Text.json({ ok: false, error: 'セッションが見つかりません' }));
    return process.stdout.write(Text.json(require('../lib/term.js').focus({ file: sess.file, cwd: o.dirArg || sess.project })));
  }
  if (o.command === 'changes') {
    // one shot for the app: every file a session wrote or edited, with git's diff
    const sess = Board.sessionRecord({ agent: o.agentName, id: o.session, hours: o.hours || 24, dirs: o.dirs });
    if (!sess) return process.stdout.write(Text.json({ files: [], error: 'セッションが見つかりません' }));
    const m = require('../lib/made.js').forSession(sess);
    const paths = [...(m.edited || []), ...(m.files || [])].sort((a, b) => b.t - a.t).map((f) => f.path);
    return process.stdout.write(Text.json({ agent: o.agentName, session: o.session, ...require('../lib/changes.js').of(paths) }));
  }
  if (o.command === 'view') {
    // one shot for the app: one file for the viewer (text, picture, git diff)
    return process.stdout.write(Text.json(require('../lib/view.js').read(o.dirArg)));
  }
  if (o.command === 'files') {
    // one shot for the app: the file names under a project, for `@` in the box
    return process.stdout.write(Text.json(require('../lib/files.js').list(o.dirArg)));
  }
  if (o.command === 'queue') {
    // one shot for the app: hold an instruction until that session is free
    const Q = require('../lib/queue.js');
    try {
      if (o.now) { const r = Board.sendHeldNow({ agent: o.agentName, id: o.session, key: o.key, type: !!o.typeInto, dirs: o.dirs }); return process.stdout.write(Text.json(r.error ? r : { ok: true, ...r })); }
      const r = o.edit ? Q.edit({ agent: o.agentName, id: o.session, key: o.key, text: o.text }) : o.cancel ? Q.remove({ agent: o.agentName, id: o.session, key: o.key, plain: !!o.plain, delivered: !!o.delivered }) : o.retry ? Q.retry({ agent: o.agentName, id: o.session }) : Q.add({ agent: o.agentName, id: o.session, text: o.text, model: o.model });
      return process.stdout.write(Text.json({ ok: true, ...r }));
    } catch (e) { process.stdout.write(Text.json({ error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command === 'label') {
    // one shot for the app: name/colour one session, kept in ~/.rally/labels.json
    const Labels = require('../lib/labels.js');
    try { return process.stdout.write(Text.json({ ok: true, ...Labels.set({ agent: o.agentName, id: o.session, label: o.text, color: o.color }) })); }
    catch (e) { process.stdout.write(Text.json({ error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command === 'wip' && o.all) {
    // each one is a model call: the count is printed before anything runs, and --limit caps it
    const Wip = require('../lib/wip.js');
    const limit = Number.isFinite(o.limit) && o.limit > 0 ? o.limit : 10;
    const cand = Board.wipCandidates({ hours: o.hours || 24, only: o.only, dirs: o.dirs }).slice(0, limit);
    if (!cand.length) return console.log(L('nothing left to read in this window', 'この範囲に未棚卸しのセッションはありません'));
    console.log(L(`reading ${n(cand.length)} sessions, ${Wip.MAX_RUNNING} at a time (one model call each)`,
      `${n(cand.length)}件を棚卸しします(${Wip.MAX_RUNNING}件ずつ・1件につきモデルを1回呼びます)`));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let withWork = 0, clean = 0, failed = 0;
    for (let i = 0; i < cand.length; i += Wip.MAX_RUNNING) {
      const wave = cand.slice(i, i + Wip.MAX_RUNNING);
      for (const c of wave) {
        try { Wip.start({ agent: c.card.agent, id: c.card.id, session: c.session }); }
        catch (e) { failed++; console.log(`  ✗ ${short(c.card.project)} …${c.card.id.slice(-8)}  ${e.message}`); }
      }
      for (let t = 0; t < 90; t++) {
        const store = Wip.collect();
        if (wave.every((c) => (store.byId[`${c.card.agent}:${c.card.id}`] || {}).status !== 'running')) break;
        await sleep(2000);
      }
      const store = Wip.collect();
      for (const c of wave) {
        const v = store.byId[`${c.card.agent}:${c.card.id}`] || {};
        const name = c.card.title || short(c.card.project);
        if (v.status !== 'ok') { failed++; console.log(`  ✗ ${name}  ${v.error || L('no answer', '答えが返りませんでした')}`); continue; }
        const r = v.remaining || [];
        if (!r.length) { clean++; console.log(`  ・ ${name}  ${L('nothing left', '残りなし')}`); continue; }
        withWork++;
        console.log(`  ▸ ${name}  ${L('open', '残り')} ${r.length}: ${r.map((x) => x.what).join(' / ').slice(0, 100)}`);
      }
    }
    console.log(L(`\n  ${n(withWork)} with work left, ${n(clean)} clean, ${n(failed)} unread — ${NAME} wip lists them`,
      `\n  残あり ${n(withWork)}件 · 残りなし ${n(clean)}件 · 読めず ${n(failed)}件 — 一覧は ${NAME} wip`));
    return;
  }
  if (o.command === 'wip' && !o.session) {
    // the 残作業 view, in the terminal: what the cached 棚卸し readings say
    const Wip = require('../lib/wip.js');
    const st = Board.state({ hours: o.hours || 24, only: o.only, dirs: o.dirs, alive: false });
    const cards = st.cards.filter((c) => c.wip && c.wip.status === 'ok' && !c.subagent && !c.headless);
    const open = cards.filter((c) => (c.wip.remaining || []).length).sort((x, y) => y.wip.remaining.length - x.wip.remaining.length);
    if (o.json) return console.log(Text.json(open.map((c) => ({ agent: c.agent, id: c.id, title: c.title, project: c.project, ...c.wip }))));
    // counted as the board's 残作業 page does (pendCounts): the sessions a reading is for
    const unread = st.cards.filter((c) => !c.wip && !c.subagent && !c.headless && (c.agent === 'claude' || c.agent === 'codex') && c.column !== 'done' && c.column !== 'working').length;
    console.log(L(`${NAME} — what is still open (${n(open.length)} of ${n(cards.length)} read sessions)`, `${NAME} — 残作業(棚卸し済み ${n(cards.length)}件中 ${n(open.length)}件に残あり)`));
    for (const c of open) {
      console.log(`\n  ${c.title || short(c.project)}  ${c.agent} …${c.id.slice(-8)}`);
      for (const r of c.wip.remaining) console.log(`    - ${r.what}${r.evidence ? `  (${r.evidence})` : ''}`);
      for (const b of c.wip.blocked || []) console.log(L(`    ! waiting on you: ${b}`, `    ! 判断待ち: ${b}`));
    }
    if (!open.length) console.log(L('  nothing left in the sessions that were read', '  棚卸し済みのセッションに残っていることはありません'));
    if (unread) console.log(L(`\n  ${n(unread)} sessions not read yet — ${NAME} wip --as claude --session ID reads one (a model call, ~30s)`,
      `\n  未棚卸し ${n(unread)}件 — ${NAME} wip --as claude --session ID で1件読みます(モデルを呼びます・30秒ほど)`));
    return;
  }
  if (o.command === 'wip') {
    // one shot for the app: read one session's tail and cache what is still open; --drop takes one item off
    if (o.drop != null) return process.stdout.write(Text.json(require('../lib/wip.js').drop({ agent: o.agentName, id: o.session, what: o.drop })));
    try { return process.stdout.write(Text.json(Board.wipFor({ agent: o.agentName, id: o.session, hours: o.hours || 24, dirs: o.dirs, model: o.model }))); }
    catch (e) { process.stdout.write(Text.json({ error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command === 'done') {
    // one shot for the app: close a session, or take that back with --cancel
    try { return process.stdout.write(Text.json(Board.finish({ agent: o.agentName, id: o.session, memory: !!o.memory, undo: !!o.cancel, park: !!o.park, dir: o.dirArg }))); }
    catch (e) { process.stdout.write(Text.json({ error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command === 'rm') {
    // one shot for the app: `claude rm` the session, its transcript into the Trash (lib/remove.js)
    try {
      const Remove = require('../lib/remove.js');
      const rec = Board.sessionRecord({ agent: o.agentName, id: o.session, hours: o.hours || 720, dirs: o.dirs });
      const r = Remove.remove({ agent: o.agentName, id: o.session, record: rec });
      if (r.error) process.exitCode = 1;
      return process.stdout.write(Text.json(r));
    } catch (e) { process.stdout.write(Text.json({ error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command === 'enrich') {
    // one shot for the detached child lib/enrich.js spawns; --icon: an icon for an existing title
    const Enrich = require('../lib/enrich.js');
    if (o.iconOnly) return process.stdout.write(Text.json({ icon: Enrich.runIcon({ agent: o.agentName, id: o.session }) }));
    const r = Enrich.runOne({ agent: o.agentName, id: o.session, file: o.file, lastTool: o.lastTool,
      recentTools: o.tools, targets: o.targets, project: o.project });
    return process.stdout.write(Text.json(r || { ok: false }));
  }
  if (o.command === 'gitinfo') {
    // what the terminal strip's prompt shows
    const G = require('../lib/git.js');
    const dir = o.dirArg || process.cwd();
    return process.stdout.write(Text.json({ cwd: dir, git: G.info(dir) }));
  }
  if (o.command === 'log') {
    const fs_ = require('fs');
    // written by the app (main.swift logLine)
    const f = Paths.akHome('app.log');
    let lines = [];
    try { lines = fs_.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch (e) { return console.log(L('nothing logged yet', 'まだ記録がありません')); }
    const n = Number.isFinite(o.limit) && o.limit > 0 ? o.limit : 40;
    if (o.json) return console.log(lines.slice(-n).join('\n'));
    for (const line of lines.slice(-n)) {
      try {
        const j = JSON.parse(line);
        const t = String(j.t || '').slice(11, 19);
        const rest = Object.entries(j).filter(([k]) => k !== 't' && k !== 'ev').map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 120) : v}`).join(' ');
        console.log(`${t} ${String(j.ev || '').padEnd(11)} ${rest}`);
      } catch (e) { console.log(line.slice(0, 200)); }
    }
    return;
  }
  if (o.command === 'page') return process.stdout.write(Board.PAGE);
  if (o.command === 'run' || o.command === 'reply') {
    // one shot for the app: start the agent detached, print what happened
    const Dispatch = require('../lib/dispatch.js');
    try {
      const files = (o.attach || []).filter(Boolean);
      const r = o.command === 'reply'
        ? Board.sendTo({ agent: o.agentName, id: o.session, text: o.text, model: o.model, effort: o.effort, attachments: files, dir: o.dirArg, type: !!o.typeInto, whenFree: !!o.whenFree, ours: !!o.ours })
        : (() => { const Attach = require('../lib/attach.js');
            const keep = files.map(Attach.inside).filter(Boolean);
            return Dispatch.dispatch({ agent: o.agentName, text: String(o.text || '') + Attach.lines(keep), model: o.model, effort: o.effort, chrome: !!o.chrome, mode: o.mode || undefined, worktree: !!o.worktree, dir: o.dirArg, addDirs: keep.length ? [path.resolve(Attach.dir())] : undefined,
              ...(o.fork ? { session: Dispatch.recordId('claude', o.fork), fork: true, model: undefined } : {}) }); })();
      // a start the CLI refused is not a start (sendTo reads its own reply's log)
      if (o.command === 'run') { const got = Dispatch.outcome(r.log, o.agentName === 'codex' ? 1200 : 6000, r.pid); if (got && got.refused) r.error = `${o.agentName} が起動しませんでした: ${got.refused}`; if (got && got.conversation) r.conversation = got.conversation; }
      // exit 0: the app passes a JSON answer through only then, and the page needs saved / attach
      if (r.error) return process.stdout.write(Text.json({ error: r.error, ...(r.typeable ? { typeable: true } : {}), ...(r.saved ? { saved: true, attach: String(o.session || '').slice(0, 8) } : {}), ...(r.queued ? { queued: true, why: r.why } : {}), log: r.log }));
      const started = o.command === 'run' ? await nameStartedSession(r, o) : null;
      const named = started && started.id;
      // --fork: the fork remembers where it was cut from (its transcript does not)
      if (named && o.fork) require('../lib/forks.js').set(named, o.fork);
      return process.stdout.write(Text.json({ ok: true, pid: r.pid, log: r.log, argv: r.argv,
        ...(r.queued ? { queued: true, why: r.why, ...(r.to ? { to: r.to } : {}) } : {}), ...(r.woke ? { woke: true } : {}),
        ...(r.relayed ? { relayed: true, to: r.to } : {}), ...(r.typed ? { typed: true, to: r.to } : {}),
        ...(named ? { session: named } : {}), ...(started && started.short ? { short: started.short, agent: o.agentName } : {}) }));
    } catch (e) { process.stdout.write(Text.json({ error: String(e && e.message || e) })); process.exitCode = 1; return; }
  }
  if (o.command !== 'serve') { console.error(L(`unknown command "${o.command}"`, `不明なコマンド "${o.command}"`)); console.log(HELP); process.exit(2); }
  const r = await Board.serve({ port: o.port, hours: o.hours, only: o.only, dirs: o.dirs });
  const url = r.url;
  console.log(L(`${NAME} → ${url}   (Ctrl-C to stop; reads transcripts on each refresh, writes only ~/.${NAME}/)`, `${NAME} → ${url}   (Ctrl-C で終了。更新のたびに転記を読むだけ。書くのは ~/.${NAME}/ のみ)`));
  if (!o.noOpen && process.platform === 'darwin') { try { require('child_process').spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* no browser */ } }
}

main();
