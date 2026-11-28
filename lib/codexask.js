#!/usr/bin/env node
'use strict';
/**
 * codexask.js — one Codex turn whose approval prompts are held for the board.
 *
 * `codex exec` cannot ask: what its sandbox refuses is refused. `codex app-server`
 * (JSON-RPC, one message per line on stdio; codex-cli 0.172) sends each approval to its
 * client and waits for the answer, so this stands in for `codex exec` when a session is
 * started with 聞く (ask): the same argv after the binary (lib/dispatch.js buildCommand),
 * the same log. A request is left in lib/perm.js's store, as Claude Code's hook leaves
 * one, and answered from the card; the sandbox is workspace-write, so only what leaves
 * the folder (or the network) asks.
 *
 *   node codexask.js <codex> exec [-C dir] [-c k=v] [--skip-git-repo-check] [resume] [-m model] [<session>] -- <text>
 *
 * The thread ids started this way are kept (asked.json), so a later message to one goes
 * through here too and can ask again.
 */
const fs = require('fs');
const { spawn } = require('child_process');
const Env = require('./env.js');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');
const Perm = require('./perm.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 250;
const HOLD_MS = 24 * 60 * 60 * 1000;      // as long as a background Claude session's prompt is held
const KEEP_MS = 60 * 86400000;
const REPUT_MS = 3000;                    // a request the board let go (no card yet) is asked again

// ── the threads started with ask ────────────────────────────────────────────
function askedFile() { return Env.get('CODEX_ASKED') || Paths.akHome('codex-asked.json'); }
function readAsked() { const j = Fsx.readJSON(askedFile(), {}); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; }
/** This thread's messages go through the app server (its prompts can be answered). */
function known(id) { return UUID.test(String(id || '')) && !!readAsked()[String(id).toLowerCase()]; }
function mark(id, now = Date.now()) {
  if (!UUID.test(String(id || ''))) return false;
  const j = readAsked();
  for (const k of Object.keys(j)) if (now - (+j[k] || 0) > KEEP_MS) delete j[k];
  j[String(id).toLowerCase()] = now;
  Fsx.writeJSONAtomic(askedFile(), j, 0o600, 0);
  return true;
}

// ── argv: what buildCommand hands `codex exec` ──────────────────────────────
function parseArgs(argv) {
  const a = [...argv];
  if (a.shift() !== 'exec') throw new Error('expected `exec` first');
  const o = { dir: '', model: '', effort: '', resume: false, session: '', text: '' };
  while (a.length) {
    const x = a.shift();
    if (x === '--') { o.text = a.join(' '); break; }
    if (x === '-C') o.dir = String(a.shift() || '');
    else if (x === '-m') o.model = String(a.shift() || '');
    else if (x === '-c') { const m = /^model_reasoning_effort="?([a-z]+)"?$/.exec(String(a.shift() || '')); if (m) o.effort = m[1]; }
    else if (x === '--skip-git-repo-check') continue;
    else if (x === 'resume') o.resume = true;
    else if (o.resume && UUID.test(x)) o.session = x;
    else throw new Error(`not supported with ask: ${String(x).slice(0, 60)}`);
  }
  if (!o.text.trim()) throw new Error('text is empty');
  if (o.resume && !o.session) throw new Error('resume needs a session id');
  return o;
}

// ── a request as the store takes it (the shape of Claude Code's hook input) ──
/** The files of a fileChange item, as text to judge: each path and its diff. */
function changesText(item) {
  const ch = item && Array.isArray(item.changes) ? item.changes : [];
  return ch.map((c) => `${(c && c.path) || ''}\n${String((c && c.diff) || '').trimEnd()}`).join('\n\n');
}
function permissionsText(p) {
  const out = [];
  const fsx = (p && p.fileSystem) || {};
  for (const k of ['read', 'write']) if (Array.isArray(fsx[k]) && fsx[k].length) out.push(`${k}: ${fsx[k].join(', ')}`);
  if (p && p.network && p.network.enabled) out.push('network');
  return out.join('\n') || JSON.stringify(p || {});
}
/**
 * A server request as a store request, or null for one this cannot put to a person.
 * `items`: the items seen so far by id (a fileChange approval names its item only).
 */
function requestOf(method, p, session, items) {
  p = p || {};
  const base = { session_id: session, cwd: String(p.cwd || '') };
  if (method === 'item/commandExecution/requestApproval') {
    const net = p.networkApprovalContext;
    const command = typeof p.command === 'string' && p.command ? p.command : net ? `network: ${net.protocol || ''} ${net.host || ''}`.trim() : '';
    if (!command) return null;
    return { ...base, tool_name: 'Bash', tool_input: { command, ...(p.reason ? { description: String(p.reason) } : {}) } };
  }
  if (method === 'item/fileChange/requestApproval') {
    const text = changesText(items && items.get(p.itemId));
    return { ...base, tool_name: 'ApplyPatch', tool_input: { path: text || String(p.grantRoot || p.reason || 'file changes'), ...(text && p.reason ? { reason: String(p.reason) } : {}) } };
  }
  if (method === 'item/permissions/requestApproval') {
    return { ...base, tool_name: 'Permissions', tool_input: { path: permissionsText(p.permissions), ...(p.reason ? { reason: String(p.reason) } : {}) } };
  }
  if (method === 'item/tool/requestUserInput') {
    const qs = Array.isArray(p.questions) ? p.questions : [];
    // a secret is not put on a board; two questions with the same words could not be told apart by their answers
    if (!qs.length || qs.some((q) => !q || q.isSecret || !q.question) || new Set(qs.map((q) => q.question)).size !== qs.length) return null;
    return { ...base, tool_name: 'AskUserQuestion', tool_input: { questions: qs.map((q) => ({ question: q.question, header: q.header || '', options: Array.isArray(q.options) ? q.options : [] })) } };
  }
  return null;
}

/** The JSON-RPC result for a request, from what the board chose. Null: not a decision (pass). */
function resultOf(method, p, decision, answers) {
  const yes = decision === 'allow' || decision === 'autoallow';
  if (!yes && decision !== 'deny' && decision !== 'answer') return null;
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: yes ? 'accept' : 'decline' };
  if (method === 'item/permissions/requestApproval') return { permissions: yes ? { ...(p.permissions || {}) } : {}, scope: 'turn' };
  if (method === 'item/tool/requestUserInput') {
    // no answer in a day (a question has no No): the turn goes on without one
    if (decision === 'deny') return { answers: {} };
    if (decision !== 'answer' || !answers) return null;
    const out = {};
    for (const q of p.questions || []) { const v = answers[q.question]; if (typeof v !== 'string') return null; out[q.id] = { answers: [v] }; }
    return { answers: out };
  }
  return null;
}

// ── the run ─────────────────────────────────────────────────────────────────
function main(argv) {
  const bin = argv[0];
  let o;
  try { o = parseArgs(argv.slice(1)); } catch (e) { console.log(`Error: ${e.message}`); process.exit(2); }
  const say = (s) => { try { fs.writeSync(1, s + '\n'); } catch (e) { /* the log is gone */ } };
  const child = spawn(bin, ['app-server'], { cwd: o.dir || process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1, thread = '', turn = '', ended = false;
  const waiting = new Map();          // our requests: id → {res, rej}
  const held = new Map();             // the server's requests held on the board: rpc id → {perm, timer}
  const items = new Map();
  const send = (m) => { try { child.stdin.write(JSON.stringify(m) + '\n'); } catch (e) { /* it is gone: 'exit' ends the run */ } };
  const call = (method, params) => new Promise((res, rej) => { const id = nextId++; waiting.set(id, { res, rej }); send({ id, method, params }); });
  const finish = (code) => {
    if (ended) return; ended = true;
    for (const h of held.values()) { clearInterval(h.timer); Perm.clear(h.perm); }
    try { child.kill(); } catch (e) { /* gone */ }
    process.exit(code);
  };
  child.on('error', (e) => { say(`Error: could not start ${bin}: ${e.message}`); finish(1); });
  child.on('exit', () => { if (!ended) { say('Error: codex app-server ended before the turn did'); finish(1); } });
  child.stderr.on('data', () => { /* its own log lines: not the conversation */ });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => {
    if (thread && turn) send({ id: nextId++, method: 'turn/interrupt', params: { threadId: thread, turnId: turn } });
    setTimeout(() => finish(130), 300);
  });

  /** Put one server request on the board and answer it when the person has. */
  const hold = (id, method, p) => {
    const req = requestOf(method, p, thread, items);
    if (!req) { send({ id, error: { code: -32601, message: 'not answered by Rally' } }); say(`rally: ${method} cannot be shown on the board; refused`); return; }
    const t0 = Date.now();
    const h = { perm: Perm.put(req, process.pid, { bg: true, cli: 'codex' }), timer: null, again: 0 };
    held.set(id, h);
    say(`rally: asking on the board — ${req.tool_name}: ${Perm.whatOf(req.tool_name, req.tool_input).split('\n')[0].slice(0, 200)}`);
    h.timer = setInterval(() => {
      if (h.again) { if (Date.now() < h.again) return; h.again = 0; h.perm = Perm.put(req, process.pid, { bg: true, cli: 'codex' }); return; }
      const d = Perm.taken(h.perm);
      if (!d && Date.now() - t0 < HOLD_MS) return;
      const answers = d === 'answer' ? Perm.takenAnswers(h.perm) : null, text = d === 'deny' ? Perm.takenText(h.perm) : null;
      Perm.clear(h.perm);
      const r = resultOf(method, p, d || 'deny', answers);
      // let go by the board (no card for it yet): the prompt is still open here, so it is asked again
      if (!r) { h.again = Date.now() + REPUT_MS; return; }
      clearInterval(h.timer); held.delete(id);
      send({ id, result: r });
      say(`rally: ${d ? `answered ${d}` : 'not answered in 24 hours; refused'}`);
      // what the person said with a No reaches the turn as their next words
      if (text && turn) send({ id: nextId++, method: 'turn/steer', params: { threadId: thread, expectedTurnId: turn, input: [{ type: 'text', text, text_elements: [] }] } });
    }, POLL_MS);
  };

  const onMessage = (m) => {
    if (m.id !== undefined && m.method) return hold(m.id, m.method, m.params);
    if (m.id !== undefined) {
      const w = waiting.get(m.id); waiting.delete(m.id);
      if (w) (m.error ? w.rej(new Error(String((m.error && m.error.message) || 'request failed'))) : w.res(m.result));
      return;
    }
    const p = m.params || {};
    if (m.method === 'turn/started' && p.turn && p.turn.id && (!p.threadId || p.threadId === thread)) turn = p.turn.id;
    else if (m.method === 'item/started' && p.item && p.item.id) items.set(p.item.id, p.item);
    else if (m.method === 'item/completed' && p.item) {
      const it = p.item;
      if (it.type === 'agentMessage' && it.text) say(it.text);
      else if (it.type === 'commandExecution') say(`$ ${String(it.command || '').slice(0, 300)}  (${it.status}${it.exitCode == null ? '' : ` ${it.exitCode}`})`);
      items.delete(it.id);
    } else if (m.method === 'turn/completed' && (!p.threadId || p.threadId === thread)) {
      const t = p.turn || {};
      if (t.error) say(`Error: ${String(t.error.message || JSON.stringify(t.error)).slice(0, 500)}`);
      finish(t.status === 'completed' ? 0 : 1);
    }
  };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch (e) { continue; }
      try { onMessage(m); } catch (e) { say(`rally: ${e.message}`); }
    }
  });

  (async () => {
    await call('initialize', { clientInfo: { name: 'rally', title: 'Rally', version: require('../package.json').version } });
    send({ method: 'initialized' });
    const common = { approvalPolicy: 'on-request', sandbox: 'workspace-write', ...(o.dir ? { cwd: o.dir } : {}), ...(o.model ? { model: o.model } : {}), ...(o.effort ? { config: { model_reasoning_effort: o.effort } } : {}) };
    const th = o.resume ? await call('thread/resume', { threadId: o.session, ...common }) : await call('thread/start', common);
    thread = (th && th.thread && th.thread.id) || o.session;
    if (!UUID.test(thread)) throw new Error('codex app-server named no thread');
    mark(thread);
    const r = await call('turn/start', { threadId: thread, input: [{ type: 'text', text: o.text, text_elements: [] }] });
    if (r && r.turn && r.turn.id) turn = r.turn.id;
    // the first line of the log once the message is taken: lib/dispatch.js outcome() waits for it
    say(`rally: codex thread ${thread} turn started (ask: its approval prompts are answered on the board)`);
  })().catch((e) => {
    // said as codex exec says it, so the caller reads a busy thread the same way (lib/dispatch.js outcome)
    say(/active writer|thread-store conflict/i.test(e.message) ? e.message : `Error: ${e.message}`);
    finish(1);
  });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { known, mark, askedFile, parseArgs, requestOf, resultOf, changesText, permissionsText };
