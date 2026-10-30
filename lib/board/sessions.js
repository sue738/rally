'use strict';
/** sessions.js — one session looked up by (agent, id), and what is read about it or across the window. */
const fs = require('fs');
const path = require('path');
const Scan = require('../scan.js');
const Live = require('../live.js');
const Dispatch = require('../dispatch.js');
const LastMessage = require('../lastMessage.js');
const Enrich = require('../enrich.js');
const Labels = require('../labels.js');
const Done = require('../done.js');
const Wip = require('../wip.js');
const Attach = require('../attach.js');
const SessionIndex = require('../sessionIndex.js');
const Columns = require('./columns.js');

/**
 * One session's whole conversation, for the detail panel. The file is resolved here from
 * (agent, id), never taken from the client: a path from a request would be a read-anything
 * hole over a tunnel.
 */
function sessionRecord(opts = {}) {
  // the index is written only by the board's own scans, so a hit came out of a scan too
  {
    const root = (opts.dirs || {})[opts.agent];
    const hit = SessionIndex.lookup(opts.agent, opts.id, root ? { root } : {});
    if (hit) return { agent: opts.agent, id: opts.id, file: hit.file, project: hit.project || opts.project, via: 'index' };
  }
  const hours = opts.hours || 24;
  const { found } = Scan.sessions({ only: [opts.agent], dirs: opts.dirs, sinceMs: Date.now() - hours * 3600000 });
  for (const f of found) for (const sess of f.sessions) if (sess.id === opts.id) return { ...sess, via: 'scan' };
  return null;
}

/** Words in the conversations of your sessions in the window (lib/search.js). */
function searchConversations(opts = {}) {
  const hours = opts.hours || 24;
  const { found } = Scan.sessions({ only: opts.only, dirs: opts.dirs, sinceMs: Date.now() - hours * 3600000 });
  const sessions = [];
  for (const f of found) for (const s of f.sessions) if (s.parentId == null && s.entrypoint !== 'sdk-cli' && s.project !== '/') sessions.push(s);
  return require('../search.js').run({ words: opts.words, sessions });
}

/**
 * Directories the Claude CLI trusts: the only places a background session can start.
 * Not the home directory — that is trusted one interactive session at a time.
 */
function trustedDirs() {
  const home = require('os').homedir();
  try {
    const p = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).projects || {};
    return Object.entries(p).filter(([d, v]) => v && v.hasTrustDialogAccepted && d !== home && d.startsWith(home + '/') && fs.existsSync(d)).map(([d]) => d).slice(0, 40);
  } catch (e) { return []; }
}

/** The model each CLI's own settings name for a new session; the board does not guess a default. */
function defaultModels() {
  const out = {};
  const home = require('os').homedir();
  try { const m = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')).model; if (typeof m === 'string') out.claude = m.slice(0, 60); } catch (e) { /* none set */ }
  // the top level only: a [profiles.x] table has its own model
  try { const top = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').split(/^\s*\[/m)[0]; const m = /^\s*model\s*=\s*"([^"]+)"/m.exec(top); if (m) out.codex = m[1].slice(0, 60); } catch (e) { /* none set */ }
  return out;
}

/** How hard each CLI thinks when nothing is picked: claude's settings effortLevel (and per model, modelSettings), codex's model_reasoning_effort. */
function defaultEfforts() {
  const out = {};
  const home = require('os').homedir();
  const ok = (v) => typeof v === 'string' && /^[a-z]{2,12}$/.test(v);
  const env = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  if (ok(env)) out.claude = env;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    if (!ok(env) && ok(j.effortLevel)) out.claude = j.effortLevel;
    // per model (modelSettings["claude-opus-5-5"].effortLevel): the page picks the one the session runs
    const by = {};
    if (!ok(env)) for (const [m, v] of Object.entries(j.modelSettings || {})) if (v && ok(v.effortLevel) && /^[\w.\-\[\]]{1,80}$/.test(m)) by[m] = v.effortLevel;
    if (Object.keys(by).length) out.claudeModels = by;
  } catch (e) { /* none set */ }
  try { const top = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').split(/^\s*\[/m)[0]; const m = /^\s*model_reasoning_effort\s*=\s*"([a-z]+)"/m.exec(top); if (m && ok(m[1])) out.codex = m[1]; } catch (e) { /* none set */ }
  return out;
}

/**
 * The models each CLI itself offers, for the board's model menu. codex keeps the list its /model shows in
 * ~/.codex/models_cache.json (only the ones it lists, best first); claude's are fixed aliases in the page.
 * @returns {{codex?: Array<{v:string,l:string,d:string}>}}
 */
function agentModelList() {
  const out = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.codex', 'models_cache.json'), 'utf8'));
    const ms = (j.models || []).filter((m) => m && m.slug && m.visibility === 'list' && /^[A-Za-z0-9][\w.:\[\]-]{0,80}$/.test(m.slug))
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    if (ms.length) out.codex = ms.slice(0, 8).map((m) => ({ v: m.slug, l: String(m.display_name || m.slug).slice(0, 40), d: String(m.description || '').slice(0, 120) }));
  } catch (e) { /* codex not installed, or no cache yet: the recently used ones are offered */ }
  return out;
}

function historyFor(opts = {}) {
  const sess = sessionRecord(opts);
  if (sess) {
    const h = LastMessage.history(sess) || { turns: [], dropped: 0 };
    // pictures are cached files: the app's web view can read them directly; over the
    // network they go through a route that serves only that one directory
    for (const t of h.turns || []) for (const im of t.images || []) {
      im.url = opts.http ? `api/img?f=${encodeURIComponent(path.basename(im.file))}` : `file://${encodeURI(im.file)}`;
    }
    const sent = Attach.forSession(opts.agent, opts.id)
      .map((f) => ({ ...f, url: opts.http ? `api/img?f=${encodeURIComponent(require('path').basename(f.path))}` : `file://${encodeURI(f.path)}` }));
    let made = { artifacts: [], files: [] };
    try { made = require('../made.js').forSession(sess); } catch (e) { /* the panel does without */ }
    return { agent: opts.agent, session: opts.id, via: sess.via, sent, made, ...h };
  }
  return { agent: opts.agent, session: opts.id, turns: [], dropped: 0, error: 'この表示範囲にこのセッションの記録がありません(上の「表示範囲(時間)」を広げてください)' };
}

/** Sessions worth a 棚卸し (lib/board/columns.js wipEligible), in the order a sweep should take them. */
function wipCandidates(opts = {}) {
  const hours = opts.hours || 24;
  const now = Date.now();
  const { found } = Scan.sessions({ only: opts.only, dirs: opts.dirs, sinceMs: now - hours * 3600000 });
  const sessions = [];
  for (const f of found) for (const s of f.sessions) sessions.push(s);
  const cards = Live.cards(sessions, now, { boardCopies: Dispatch.boardCopies(), boardCodex: Dispatch.boardCodex() }).filter((c) => now - c.lastT < hours * 3600000);
  Done.apply(cards);
  Wip.apply(cards, Wip.collect());
  Labels.apply(cards);
  Enrich.applyCached(cards);
  const byKey = new Map(sessions.map((s) => [s.agent + '\0' + s.id, s]));
  return cards
    .filter(Columns.wipEligible)
    .sort(Columns.wipOrder)
    .map((c) => ({ card: c, session: byKey.get(c.agent + '\0' + c.id) }))
    .filter((x) => x.session);
}

/** Start one 棚卸し (lib/wip.js). Resolves the file here, like history. */
function wipFor(opts = {}) {
  const sess = sessionRecord(opts);
  if (!sess) return { error: 'この表示範囲にこのセッションの記録がありません(上の「表示範囲(時間)」を広げてください)' };
  return Wip.start({ agent: opts.agent, id: opts.id, session: sess, model: opts.model });
}

module.exports = { sessionRecord, searchConversations, trustedDirs, defaultModels, defaultEfforts, agentModelList, historyFor, wipCandidates, wipFor };
