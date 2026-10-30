'use strict';
const { t: tr } = require('./i18n.js');
/**
 * lastMessage.js — what a person typed and what the agent said in one session:
 * the first ask, the last ask, the last reply (`lastMessage`, for the card) and
 * the whole conversation (`history`, for the panel). An on-demand read of one
 * file, apart from the scan model, which keeps no message text. Claude and
 * Codex only; a null result means "unavailable", not "empty".
 */
const Env = require('./env.js');
const Names = require('./names.js');
const Price = require('./price.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');
const D = require('./vendor/dialogue.js');
const Text = require('./text.js');
const readers = require('./vendor/readers/index.js');
// the claude reader's own patterns, not a local copy (a narrower one leaked slash-command echoes)
const ECHO_RE = readers.byName('claude').ECHO_RE;
const injectedOrigin = readers.byName('claude').injectedOrigin;

const MAX = 220;
// history: long turns are cut, and a long session keeps its newest MAX_TURNS
const MAX_TURN = 60000;    // a turn as written (it was 4000 and long answers ended mid-word in 会話); only a runaway one is cut
const MAX_TURNS = 400;
// Inline base64 images are too big for the app's bridge: each is written once to
// ~/.rally/img/<sha1>.<ext> and the turn carries the path.
const IMG_MAX = 8 * 1024 * 1024;
const IMG_PER_TURN = 4;

function imgDir() {
  return Env.get('IMG') || Paths.akDir('img');
}

/** Cache one inline image and return its path, or null. */
const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' };

function cacheImage(block) {
  const src = block && block.source;
  if (!src || src.type !== 'base64' || typeof src.data !== 'string') return null;
  // allowlist: the transcript's media type decides how /api/img serves the file
  const mime = String(src.media_type || 'image/png').toLowerCase();
  const ext = IMG_EXT[mime];
  if (!ext) return null;
  if (src.data.length > IMG_MAX * 1.4) return null;
  try {
    const buf = Buffer.from(src.data, 'base64');
    if (!buf.length || buf.length > IMG_MAX) return null;
    const name = `${require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    const d = imgDir();
    const file = path.join(d, name);
    if (!fs.existsSync(file)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(file, buf); }
    return { file, mime, bytes: buf.length };
  } catch (e) { return null; }
}

function imagesIn(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (!b || b.type !== 'image') continue;
    const got = cacheImage(b);
    if (got) out.push(got);
    if (out.length >= IMG_PER_TURN) break;
  }
  return out;
}

/**
 * A message handed over from another session. Relay messages (lib/relay.js) start
 * with a [<name>] line (any earlier name too) saying the words are yours: shown as yours, without it.
 */
const VOICE_RE = new RegExp(Names.LINE_RE.source + '[^\\n]*\\n+', 'i');
function peerTurn(name, body) {
  const b = String(body || '').trim();
  if (VOICE_RE.test(b)) return { text: b.replace(VOICE_RE, '').trim() };
  return { peer: String(name || '').slice(0, 60), text: b };
}

function claudeText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  return parts.join('\n');
}

function codexText(content) {
  if (!Array.isArray(content)) return String(content || '');
  return content.map((c) => (c && typeof c.text === 'string') ? c.text : '').join('\n');
}

/** A person's turn, not a slash-command echo or runtime-injected context. */
function claudeHuman(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain || injectedOrigin(e)) return null;
  const c = e.message && e.message.content;
  const t = (typeof c === 'string' ? c : claudeText(c)).trim();
  if (!t || ECHO_RE.test(t) || D.isSystemText(t)) return null;
  return t;
}

function codexHuman(e) {
  const p = e.payload;
  if (e.type !== 'response_item' || !p || p.type !== 'message' || p.role !== 'user') return null;
  const t = codexText(p.content).trim();
  if (!t || /^\s*<(environment_context|user_instructions|turn_aborted|permissions_instructions)\b/.test(t) || D.isSystemText(t)) return null;
  return t;
}

function claudeAssistant(e) {
  if (e.type !== 'assistant') return null;
  return claudeText(e.message && e.message.content).trim() || null;
}

function codexAssistant(e) {
  const p = e.payload;
  if (e.type !== 'response_item' || !p || p.type !== 'message' || p.role !== 'assistant') return null;
  return codexText(p.content).trim() || null;
}

/**
 * A session's live context (the last `usage`: input + cache read + creation) and
 * what it has spent (the sum). No percentage: the transcript does not record the window.
 */
function usageOf(lines, agent) {
  if (agent !== 'claude' && agent !== 'codex') return null;
  const acc = agent === 'claude' ? usageAcc() : codexUsageAcc();
  const mark = agent === 'claude' ? '"usage"' : '"t';        // codex: token_count / turn_context
  for (const line of lines) {
    if (!line || (line.indexOf(mark) < 0 && line.indexOf('compact_boundary') < 0 && line.indexOf('Goal cleared') < 0 && line.indexOf('goal_status') < 0)) continue;
    let e; try { e = JSON.parse(line); } catch (err) { continue; }
    acc.add(e);
  }
  return acc.done();
}
// the same sums, one entry at a time — carried on from `from` (what an earlier read found)
function usageAcc(from) {
  const f = from || {};
  let ctx = f.ctx || 0, inTok = f.inTok || 0, outTok = f.outTok || 0, think = f.think || 0, model = f.model || null, turns = f.turns || 0;
  let lastId = f.lastId || null;
  let goal = f.goal || null;                          // /goal: its condition, whether it holds, the evaluator's latest reason
  const by = JSON.parse(JSON.stringify(f.by || {}));   // model → { i, o, cr, cw5, cw1 }: what the price is worked out from
  return {
    add(e) {
      if (e && e.type === 'attachment' && e.attachment && e.attachment.type === 'goal_status') {
        // a `sentinel` record is the goal being set; each later one is a verdict (met: the goal cleared itself)
        const a = e.attachment, same = goal && goal.text === a.condition;
        goal = { text: String(a.condition || ''), met: !!a.met, reason: a.reason || (same && !a.sentinel ? goal.reason : '') || '',
          n: a.sentinel ? 0 : (same ? goal.n : 0) + 1, since: a.sentinel || !same ? e.timestamp || null : goal.since };
      } else if (e && e.type === 'system' && e.subtype === 'local_command' && typeof e.content === 'string' && /Goal cleared/.test(e.content)) goal = null;
      // /compact: the context is the summary until the next reply says otherwise
      if (e && e.type === 'system' && e.subtype === 'compact_boundary' && e.compactMetadata && e.compactMetadata.postTokens > 0) ctx = e.compactMetadata.postTokens;
      const m = e && e.message;
      const u = m && m.usage;
      if (!u) return;
      // one reply written as several entries (a line per content block) carries the same usage on each: counted once
      if (m.id && m.id === lastId) return;
      lastId = m.id || null;
      const i = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      ctx = i;                                        // the newest one wins
      inTok += i;
      outTok += u.output_tokens || 0;
      think += (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
      if (m.model) model = m.model;
      turns++;
      if (m.model && m.model !== '<synthetic>') {
        const b = by[m.model] || (by[m.model] = { i: 0, o: 0, cr: 0, cw5: 0, cw1: 0 });
        const cw = u.cache_creation_input_tokens || 0, split = u.cache_creation || null;
        const cw1 = split ? (split.ephemeral_1h_input_tokens || 0) : 0;
        b.i += u.input_tokens || 0; b.o += u.output_tokens || 0; b.cr += u.cache_read_input_tokens || 0;
        b.cw1 += cw1; b.cw5 += cw - cw1;            // no split recorded: the 5-minute kind, the API's default
      }
    },
    done() {
      if (!turns) return null;
      const p = Price.cost(by);
      return { ctx, inTok, outTok, think, turns, model, lastId, by, ...(goal ? { goal } : {}), usd: Math.round(p.usd * 10000) / 10000, ...(p.unpriced.length ? { unpriced: p.unpriced } : {}) };
    },
  };
}

// codex: the newest token_count event carries the totals, last request and window
// (input includes cached). No price: OpenAI's rates are not checked (lib/price.js).
function codexUsageAcc(from) {
  const f = from || {};
  let ctx = f.ctx || 0, inTok = f.inTok || 0, outTok = f.outTok || 0, think = f.think || 0, turns = f.turns || 0, win = f.win || 0, model = f.model || null;
  let last = f.lastTotal || 0;
  return {
    add(e) {
      const p = e && e.payload;
      if (!p) return;
      if (e.type === 'turn_context' && p.model) { model = p.model; return; }
      if (e.type !== 'event_msg' || p.type !== 'token_count' || !p.info) return;
      const t = p.info.total_token_usage, l = p.info.last_token_usage;
      if (!t) return;
      // the same totals written again (a rate-limit update) are not a new request
      if ((t.total_tokens || 0) === last) return;
      last = t.total_tokens || 0;
      inTok = t.input_tokens || 0; outTok = t.output_tokens || 0; think = t.reasoning_output_tokens || 0;
      if (l) ctx = l.input_tokens || 0;
      if (p.info.model_context_window) win = p.info.model_context_window;
      turns++;
    },
    done() {
      if (!turns) return null;
      return { ctx, inTok, outTok, think, turns, model, win: win || null, lastTotal: last, usd: null };
    },
  };
}

function scan(lines, human, assistant, from, each) {
  // inTurn: the last reply came after your last message (a turn with no text has none).
  // `from`: an earlier read's state to continue from; `each(e)`: called on every entry.
  let first = from ? from.first : null, lastHuman = from ? from.human : null, lastAssistant = from ? from.assistant : null, inTurn = !!(from && from.inTurn);
  for (const line of lines) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch (err) { continue; }
    if (!e || typeof e !== 'object') continue; // e.g. a bare `null` line parses without throwing
    if (each) each(e);
    const h = human(e);
    if (h) { if (first == null) first = h; lastHuman = h; inTurn = false; }
    const a = assistant(e);
    if (a) { lastAssistant = a; inTurn = true; }
  }
  return { first, human: lastHuman, assistant: lastAssistant, inTurn: !!lastAssistant && inTurn };
}

/**
 * The three snippets a card shows, cached by (file, mtime, size).
 * @returns {{first:?string, human:?string, assistant:?string}|null} null
 *   when the agent has no reader here, or the file could not be read.
 */
const NAME = 'rally';
let memo = null;                                     // within one process
// bump when what is read changes: entries are otherwise kept by mtime
const MEMO_V = 9;
function memoPath() {
  return Env.get('LAST_CACHE') || Paths.akDir('last-cache.json');
}
function memoRead() {
  if (memo) return memo;
  try { const j = JSON.parse(fs.readFileSync(memoPath(), 'utf8')); memo = j && j.byFile ? j : { byFile: {} }; }
  catch (e) { memo = { byFile: {} }; }
  return memo;
}
function memoWrite(store) {
  const f = memoPath();
  try {
    Fsx.writeJSONAtomic(f, store, undefined, 0);
  } catch (e) { /* a cache that cannot be written is still a working board */ }
}
/** Write whatever this process learned. Called once per run, not per card. */
function flush() { if (memo && memo.dirty) { delete memo.dirty; memoWrite(memo); } }

/** An antigravity conversation's turns (lib/antigravity.js): every run with this session's id. */
function agyTurns(session) {
  const Agy = require('./antigravity.js');
  const runs = Agy.conversations().get(session.id);
  return runs ? Agy.turns(runs) : null;
}

function lastMessage(session) {
  if (!session || !session.file) return null;
  if (session.agent === 'antigravity') {
    const ts = agyTurns(session);
    if (!ts) return null;
    const users = ts.filter((x) => x.kind === 'user'), says = ts.filter((x) => x.kind === 'assistant');
    const lastUser = users[users.length - 1], lastSay = says[says.length - 1];
    const cap = (x) => (x ? Text.cut(x, MAX) : null);
    return { first: cap(users[0] && users[0].text), human: cap(lastUser && lastUser.text), assistant: cap(lastSay && lastSay.text),
      inTurn: !!(lastSay && lastUser && lastSay.t >= lastUser.t), usage: null };
  }
  if (session.agent !== 'claude' && session.agent !== 'codex') return null;
  let st = null;
  try { st = fs.statSync(session.file); } catch (e) { return null; }
  const store = memoRead();
  const hit = store.byFile[session.file];
  if (hit && hit.v === MEMO_V && hit.m === st.mtimeMs && hit.s === st.size) return { first: hit.f, human: hit.h, assistant: hit.a, inTurn: !!hit.i, usage: hit.u || null };
  const M = require('./vendor/model.js');
  const claude = session.agent === 'claude';
  // only appended to since the last read: read just the new lines and carry the state on;
  // anything else (a different file, a read that stopped mid-line) is read whole
  const from = hit && hit.v === MEMO_V && hit.hd && M.appendedSince(session.file, { size: hit.s, head: hit.hd }, st.size) ? hit.s : 0;
  // in pieces up to st.size: a huge transcript cannot be one string, and it grows while read
  const lines = M.fileLines(session.file, { start: from, end: st.size });
  if (!lines) return null;
  const acc = claude ? usageAcc(from ? hit.u : null) : codexUsageAcc(from ? hit.u : null);
  const was = from ? { first: hit.f, human: hit.h, assistant: hit.a, inTurn: !!hit.i } : null;
  const r = claude ? scan(lines, claudeHuman, claudeAssistant, was, (e) => acc.add(e)) : scan(lines, codexHuman, codexAssistant, was, (e) => acc.add(e));
  const cap = (s) => (s ? Text.cut(s, MAX) : null);      // never end on half a character
  const out = { first: cap(r.first && Text.unpaste(r.first)), human: cap(r.human && Text.unpaste(r.human)), assistant: cap(r.assistant), inTurn: r.inTurn, usage: acc.done() };
  store.byFile[session.file] = { v: MEMO_V, m: st.mtimeMs, s: st.size, hd: M.fileHead(session.file, st.size), f: out.first, h: out.human, a: out.assistant, i: out.inTurn ? 1 : 0, u: out.usage };
  store.dirty = true;
  const keys = Object.keys(store.byFile);
  if (keys.length > 4000) { for (const k of keys.slice(0, keys.length - 4000)) delete store.byFile[k]; }
  return out;
}


/** Every turn of one session, oldest first. Claude and Codex only. */
function history(session, opts = {}) {
  if (!session || !session.file) return null;
  if (session.agent === 'antigravity') {
    const ts = agyTurns(session);
    if (!ts) return null;
    const cap = opts.maxTurns || MAX_TURNS;
    const turns = ts.map((x) => (x.text ? { ...x, text: Text.cut(x.text, MAX_TURN) } : x));
    const dropped = Math.max(0, turns.length - cap);
    return { turns: dropped ? turns.slice(-cap) : turns, dropped };
  }
  if (session.agent !== 'claude' && session.agent !== 'codex') return null;
  const lines = require('./vendor/model.js').fileLines(session.file);
  if (!lines) return null;
  const cap = opts.maxTurns || MAX_TURNS;
  const turns = [];
  // File order is the session's order; timestamps can run backwards (a mid-turn message is
  // stamped when queued, parallel errors before later calls), so the clock never goes back.
  // 届け待ち turns keep their own time.
  let clock = null;
  const push = (turn) => {
    if (turn.text) turn.text = Text.cut(turn.kind === 'user' ? Text.unpaste(turn.text) : turn.text, MAX_TURN);
    if (turn.images && !turn.images.length) delete turn.images;
    if (!turn.waiting && turn.t != null) { if (clock != null && turn.t < clock) turn.t = clock; clock = turn.t; }
    turns.push(turn);
  };
  // a Codex rollout replays lines verbatim: count each once (calls/outputs by call_id)
  const seenCx = new Set();
  const replayed = (line, p) => {
    const k = (p.type === 'function_call' || p.type === 'custom_tool_call') && p.call_id ? 'c\0' + p.call_id
      : (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && p.call_id ? 'o\0' + p.call_id
      : 'l\0' + (line.length > 4000 ? `${line.length}:${line.slice(0, 4000)}` : line);
    if (seenCx.has(k)) return true;
    seenCx.add(k);
    return false;
  };
  // enqueued but not yet taken (mid-turn): shown at the end as 届け待ち
  const waitingIn = [];
  // everything the session was handed, shown or not: what a waiting one is checked against
  const handed = [];
  for (const line of lines) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch (err) { continue; }
    if (!e || typeof e !== 'object') continue;
    if (session.agent === 'claude') {
      const t = Date.parse(e.timestamp) || null;
      if (e.type === 'queue-operation') {
        const k = String(e.content || '');
        if (e.operation === 'enqueue' && k) waitingIn.push({ t, k });
        else if (e.operation === 'remove' || e.operation === 'dequeue') { const i = waitingIn.findIndex((w) => w.k === k); if (i >= 0) waitingIn.splice(i, 1); else if (!k && waitingIn.length) waitingIn.shift(); }
        continue;
      }
      const c = e.message && e.message.content;
      if (e.type === 'user' && typeof c === 'string') handed.push({ t, text: c });
      else if (e.type === 'user' && Array.isArray(c)) for (const x of c) { if (x && x.type === 'text' && typeof x.text === 'string') handed.push({ t, text: x.text }); }
      else if (e.type === 'attachment' && e.attachment && e.attachment.type === 'queued_command' && typeof e.attachment.prompt === 'string') handed.push({ t, text: e.attachment.prompt });
      // built-in commands (/context, /compact…): what ran, its output, where it summarised
      if (e.type === 'system' && e.subtype === 'local_command') {
        const out = stripCmd(e.content);
        if (out) push({ t, kind: 'cmdout', text: out });
        continue;
      }
      if (e.type === 'system' && e.subtype === 'compact_boundary') {
        const m = e.compactMetadata || {};
        const k = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0));
        push({ t, kind: 'mark', text: tr('会話を要約しました') + (m.preTokens ? `(${k(m.preTokens)} → ${k(m.postTokens)})` : '') });
        continue;
      }
      if (e.type === 'user' && typeof c === 'string') {
        const cm = /^<command-name>\/?([^<]+)<\/command-name>/.exec(c);
        if (cm) {
          const args = (/<command-args>([\s\S]*?)<\/command-args>/.exec(c) || [])[1];
          push({ t, kind: 'user', cmd: true, text: '/' + cm[1] + (args && args.trim() ? ' ' + args.trim() : '') });
          continue;
        }
        if (/^<local-command-std(out|err)>/.test(c)) { const out = stripCmd(c); if (out) push({ t, kind: 'cmdout', text: out }); continue; }
        // `! command` typed in the session (or sent from the board): what ran, then what it printed
        const bi = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(c);
        if (bi) { push({ t, kind: 'user', cmd: true, text: '! ' + bi[1].trim() }); continue; }
        if (/^<bash-std(out|err)>/.test(c)) { const out = stripCmd(c.replace(/<\/?bash-std(out|err)>/g, '')); if (out) push({ t, kind: 'cmdout', text: out }); continue; }
      }
      // sent mid-turn: recorded as an attachment, not a turn of its own
      if (e.type === 'attachment' && e.attachment && e.attachment.type === 'queued_command' && typeof e.attachment.prompt === 'string') {
        const pr = e.attachment.prompt;
        const m = /^<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/.exec(pr);
        if (m) { const nm = (/from-name="([^"]*)"/.exec(m[1]) || [])[1] || ''; if (m[2].trim()) push({ t, kind: 'user', ...peerTurn(nm, m[2]) }); }
        else if (!/^<(agent-message|task-notification|system-reminder)\b/.test(pr.trim()) && pr.trim()) push({ t, kind: 'user', text: pr.trim() });
        continue;
      }
      // delivered from another session (直接届ける, a peer): a meta entry with the words in
      // origin.body, shown with who handed it over. A subagent's hand-back is left out.
      if (e.type === 'user' && e.origin && e.origin.kind === 'peer' && !e.origin.handback && !e.origin.senderTaskId && typeof e.origin.body === 'string' && e.origin.body.trim()) {
        push({ t, kind: 'user', ...peerTurn(e.origin.name || e.origin.from, e.origin.body) });
        continue;
      }
      if (e.type === 'user') {
        if (Array.isArray(c)) for (const b of c) {
          if (b && b.type === 'tool_result' && b.is_error) push({ t, kind: 'error', text: textOfResult(b.content) });
        }
        const h = claudeHuman(e);
        const pics = imagesIn(c);
        if (h || pics.length) push({ t, kind: 'user', text: h || '', images: pics });
      } else if (e.type === 'assistant') {
        const said = claudeText(c).trim();
        const pics = imagesIn(c);
        if (said || pics.length) push({ t, kind: 'assistant', text: said, images: pics });
        if (Array.isArray(c)) for (const b of c) {
          if (b && b.type === 'tool_use') push({ t, kind: 'tool', tool: String(b.name || ''), text: toolTarget(b.input) });
        }
      }
    } else {
      const t = Date.parse(e.timestamp) || null;
      const p = e.payload;
      if (e.type !== 'response_item' || !p) continue;
      if (replayed(line, p)) continue;
      if (p.type === 'message' && p.role === 'assistant') {
        const said = codexText(p.content).trim();
        if (said) push({ t, kind: 'assistant', text: said });
      } else if (p.type === 'message' && p.role === 'user') {
        const h = codexHuman(e);
        if (h) push({ t, kind: 'user', text: h });
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        push({ t, kind: 'tool', tool: String(p.name || ''), text: String(p.arguments || p.input || '').slice(0, 200) });
      } else if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && /error|failed/i.test(String(p.output || '').slice(0, 80))) {
        push({ t, kind: 'error', text: String(p.output || '') });
      }
    }
  }
  const norm = (x) => String(x || '').replace(VOICE_RE, '').replace(/\s+/g, ' ').trim();
  // taken: matched by words against later turns or handed entries — dequeue records can't
  // say which (the CLI writes empty ones)
  const taken = (w, body) => {
    const b = norm(body); if (!b) return false;
    const after = (x) => (x.t || 0) >= (w.t || 0) - 1000;
    return turns.some((u) => u.kind === 'user' && !u.waiting && after(u) && norm(u.text) === b)
      || handed.some((x) => after(x) && (norm(x.text) === b || norm(x.text) === norm(w.k) || norm(x.text).includes(b)));
  };
  for (const w of waitingIn) {
    const m = /^<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/.exec(w.k);
    const body = (m ? m[2] : w.k).trim();
    if (taken(w, body)) continue;
    // a harness notice (another session went idle, a message was held) is not something you said
    if (body && !/^<(agent-message|task-notification|system-reminder)\b/.test(body) && !/^\[Cross-session [a-z -]+\]/.test(body)) push({ t: w.t, kind: 'user', waiting: true, ...(m ? peerTurn((/from-name="([^"]*)"/.exec(m[1]) || [])[1], body) : { text: body }) });
  }
  const dropped = Math.max(0, turns.length - cap);
  return { turns: dropped ? turns.slice(-cap) : turns, dropped };
}

/** A local command's printed output, without its wrapper tags. */
function stripCmd(v) {
  return String(v || '').replace(/<\/?local-command-std(out|err)>/g, '').replace(/\x1b\[[0-9;]*m/g, '').trim();
}

/** What a tool call touched, for one line of history. */
function toolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  return String(input.command || input.file_path || input.path || input.pattern || input.notebook_path || '').slice(0, 300);
}

function textOfResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join(' ').trim();
}

module.exports = { lastMessage, history, flush, memoPath, usageOf };
