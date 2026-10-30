'use strict';
const { t: tr } = require('./i18n.js');
/**
 * wip.js — 仕掛かり: what is still open in a session (card field `wip`; not
 * `pending`, which is the permission-waiting tool calls).
 *
 * Keyword matching proved unreliable, so a model reads the conversation's tail
 * on request: passed inline to `claude -p` with no tools, not by resuming, so
 * nothing is written into the session and the child cannot stall on a prompt.
 * The answer is cached here.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Fsx = require('./fsx.js');
const { spawn } = require('child_process');
const Paths = require('./paths.js');
const Dispatch = require('./dispatch.js');
const LastMessage = require('./lastMessage.js');

const NAME = 'rally';
const MAX_TURNS = 60;          // the tail is where open work lives
const MAX_CHARS = 24000;       // ~8k tokens: a few cents per reading
const MAX_ITEMS = 8;
const MAX_RUNNING = 3;         // a click each; this is the guard against a storm
const RUN_TIMEOUT_MS = 180000;
const MODEL = 'sonnet';

function storePath() {
  return Env.get('WIP') || Paths.akDir('wip.json');
}
function outDir() {
  return Env.get('WIP_OUT') || Paths.akDir('wip');
}
function key(agent, id) { return `${agent}:${id}`; }

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return j && typeof j === 'object' && j.byId ? j : { byId: {} };
  } catch (e) { return { byId: {} }; }
}
function write(store) {
  Fsx.writeJSONAtomic(storePath(), store);
}

/** The last turns of one session as plain text, newest last. */
function digest(session, opts = {}) {
  const h = LastMessage.history(session, { maxTurns: opts.turns || MAX_TURNS });
  if (!h || !h.turns || !h.turns.length) return '';
  const lines = [];
  for (const t of h.turns) {
    const text = String(t.text || '').replace(/\s+/g, ' ').trim();
    if (t.kind === 'tool') lines.push(`[ツール] ${t.tool || ''} ${text}`.trim());
    else if (t.kind === 'error') lines.push(`[エラー] ${text}`);
    else if (t.kind === 'user') lines.push(`[依頼] ${text}`);
    else lines.push(`[作業] ${text}`);
  }
  let out = lines.join('\n');
  const cap = opts.chars || MAX_CHARS;
  if (out.length > cap) out = out.slice(out.length - cap);   // keep the newest
  return out;
}

const RULES = [
  '[rally] 次は1つの作業セッションの会話の末尾です。この作業で「まだ残っていること」を洗い出してください。',
  '',
  '規則:',
  '- 会話に根拠があるものだけ書く。推測で足さない。',
  '- 残作業とみなすのは、宣言したのに実行していないこと・失敗したまま直していないこと・依頼されたのに応答がないこと・「未確認」「未検証」「後で」と書かれたこと。',
  '- 既に終わっていることは remaining に入れない。残っていなければ remaining は空配列にする。',
  '- 出力は JSON のみ。前後に説明やコードフェンスを書かない。',
  '',
  '形式:',
  '{"summary":"何をしていたセッションか(40字以内)","remaining":[{"what":"残っていること(60字以内)","evidence":"会話中の根拠(30字以内)"}],"blocked":["人の判断待ちで止まっていること"],"state":"done|in-progress|unclear"}',
  '',
  '会話:',
].join('\n');

function promptFor(text) { return `${RULES}\n${text}`; }

/** JSON out of a model's answer, which may arrive fenced or with a preamble. */
function parseAnswer(raw) {
  if (!raw) return null;
  let result = raw;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && typeof j.result === 'string') result = j.result;
  } catch (e) { /* not the CLI envelope: treat the whole thing as the answer */ }
  const i = result.indexOf('{');
  const k = result.lastIndexOf('}');
  if (i < 0 || k <= i) return null;
  let j;
  try { j = JSON.parse(result.slice(i, k + 1)); } catch (e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const items = Array.isArray(j.remaining) ? j.remaining : [];
  return {
    summary: String(j.summary || '').slice(0, 120),
    remaining: items.slice(0, MAX_ITEMS).map((r) => (typeof r === 'string'
      ? { what: r.slice(0, 200), evidence: '' }
      : { what: String((r && r.what) || '').slice(0, 200), evidence: String((r && r.evidence) || '').slice(0, 120) }))
      .filter((r) => r.what),
    blocked: (Array.isArray(j.blocked) ? j.blocked : []).slice(0, MAX_ITEMS).map((b) => String(b).slice(0, 200)).filter(Boolean),
    state: ['done', 'in-progress', 'unclear'].includes(j.state) ? j.state : 'unclear',
  };
}

function running(store) {
  return Object.values((store || read()).byId).filter((v) => v.status === 'running').length;
}

/**
 * Start one reading. `session` is the scan record (it carries the file).
 * Returns {started:true, pid} or throws — the panel shows the message.
 */
function start({ agent, id, session, model }) {
  if (!agent || !id) throw new Error('agent and session are required');
  // the id names the output file below
  Dispatch.resumableId(agent, id);
  const store = read();
  if (store.byId[key(agent, id)] && store.byId[key(agent, id)].status === 'running') return { started: false, already: true };
  if (running(store) >= MAX_RUNNING) throw new Error(tr('棚卸しは同時に{n}件までです', { n: MAX_RUNNING }));
  const text = digest(session);
  if (!text) throw new Error(tr('この形式の記録からは会話を読み出せません'));
  const bin = Dispatch.binaryFor('claude');
  if (!bin) throw new Error(tr('claude が見つかりません'));
  const dir = outDir();
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${agent}-${id}.json`);
  try { fs.unlinkSync(out); } catch (e) { /* first run */ }
  const fd = fs.openSync(out, 'w');
  // --restricted still leaves Read/Edit/Write; the text is not all the
  // user's, so no tools at all
  const args = ['-p', '--model', Dispatch.modelName(model) || MODEL, '--restricted', '--tools', '', '--output-format', 'json', '--', promptFor(text)];
  const child = spawn(bin, args, {
    cwd: Paths.home(), detached: true, stdio: ['ignore', fd, 'ignore'],
    env: { ...process.env, PATH: [path.dirname(bin), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':') },
  });
  child.unref();
  fs.closeSync(fd);
  store.byId[key(agent, id)] = { status: 'running', at: Date.now(), pid: child.pid, out, model: Dispatch.modelName(model) || MODEL };
  write(store);
  return { started: true, pid: child.pid, out };
}

/**
 * Pick up whatever has finished since the last refresh. Called from state(),
 * so there is no daemon: the answer appears on the card at the next poll.
 */
function collect(store) {
  const s = store || read();
  let changed = false;
  for (const [k, v] of Object.entries(s.byId)) {
    if (!v || v.status !== 'running') continue;
    let raw = null;
    try { raw = fs.readFileSync(v.out, 'utf8'); } catch (e) { /* not written yet */ }
    const answer = raw && raw.trim() ? parseAnswer(raw) : null;
    if (answer) {
      s.byId[k] = { status: 'ok', at: Date.now(), startedAt: v.at, model: v.model, ...answer };
      changed = true;
      continue;
    }
    const gone = (() => { try { process.kill(v.pid, 0); return false; } catch (e) { return true; } })();
    if (gone || Date.now() - v.at > RUN_TIMEOUT_MS) {
      s.byId[k] = { status: 'error', at: Date.now(), startedAt: v.at, error: raw && raw.trim() ? tr('読み取れる答えが返りませんでした') : tr('棚卸しが答えを返さずに終わりました') };
      changed = true;
    }
  }
  if (changed) write(s);
  return s;
}

/** Attach the cached reading to its card. */
function apply(cards, store) {
  const s = store || read();
  for (const c of cards) {
    const v = s.byId[key(c.agent, c.id)];
    if (v) c.wip = v;
  }
  return s;
}

function clear({ agent, id }) {
  const s = read();
  delete s.byId[key(agent, id)];
  write(s);
  return { count: Object.keys(s.byId).length };
}

/**
 * Take one item off a session's reading: you sent it to the session (実行)
 * or decided against it (やめる). Matched by its text, as the page shows it.
 */
function drop({ agent, id, what }) {
  const s = read();
  const v = s.byId[key(agent, id)];
  if (!v || !Array.isArray(v.remaining)) return { error: tr('この残作業はもうありません') };
  const i = v.remaining.findIndex((x) => x && x.what === what);
  if (i < 0) return { error: tr('この残作業はもうありません') };
  v.remaining.splice(i, 1);
  write(s);
  return { ok: true, left: v.remaining.length };
}

module.exports = { MAX_ITEMS, MAX_RUNNING, MODEL, storePath, outDir, read, write, digest, promptFor, parseAnswer, start, collect, apply, clear, drop };
