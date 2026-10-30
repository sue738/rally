'use strict';
/**
 * state.js — the board on one refresh: sessions touched in the last `hours`, their lanes
 * from live.js, and what the board lays over them (decided in columns.js, applied here).
 */
const Env = require('../env.js');
const fs = require('fs');
const Scan = require('../scan.js');
// wider than overlap's 30-min default: the board's point is "before you commit"
const Live = require('../live.js');
const Dispatch = require('../dispatch.js');
const LastMessage = require('../lastMessage.js');
const Stuck = require('../stuck.js');
const Enrich = require('../enrich.js');
const Alive = require('../alive.js');
const Bgtasks = require('../bgtasks.js');
const Perm = require('../perm.js');
const ORPHAN_ASK_MS = 20000;
const STALE_ASK_MS = 60000;   // a reply or tool call this long after a prompt: the prompt is no longer what it waits on
const Labels = require('../labels.js');
const Queue = require('../queue.js');
const Eta = require('../eta.js');
const EtaLog = require('../etalog.js');
const Done = require('../done.js');
const Wip = require('../wip.js');
const SessionIndex = require('../sessionIndex.js');
const Skills = require('../skills.js');
const Limits = require('../limits.js');
const Columns = require('./columns.js');
const { trustedDirs, defaultModels, defaultEfforts, agentModelList } = require('./sessions.js');
const { stopAndConfirm, handOverHeld } = require('./send.js');

// 完了 cards kept past the hours window (the newest ones)
const DONE_KEEP = 2000;
// cards per refresh that get a last-message snippet: bounds a huge --hours window
const LAST_MESSAGE_CAP = 80;
const SUB_RESULT_CAP = 80;       // subagent results read past it, for the parents' panels
// cards eligible for title enrichment; enrich.js bounds the calls it starts
const ENRICH_CANDIDATE_CAP = 24;

/** 返答 that ended in a question moves to あなた待ち. */
function applyAsked(c) {
  if (Columns.askedYou(c)) { c.column = 'needs-you'; c.reason = Columns.ASKED_REASON; }
}

/**
 * Permission prompts held for the board (lib/perm.js), put on their cards. `pass` sends
 * one with no card back to the terminal, after a grace for the scan to catch up.
 */
function placeAsks(cards, asks, now, pass) {
  for (const a of asks) {
    // the subagent that asked is waiting, not finished: its row stays under its parent as running
    if (a.agent) { const k = cards.find((x) => x.agent === 'claude' && x.subagent && x.id === 'agent-' + a.agent); if (k) { k.subRunning = true; k.column = 'working'; k.reason = 'subagent waiting for permission'; } }
    const c = cards.find((x) => x.agent === 'claude' && x.id === a.session && !x.subagent);
    if (!c) {
      if (now - a.t > ORPHAN_ASK_MS) pass(a.id);
      continue;
    }
    // the session went on working well after this was asked (Claude Code stopped waiting for the hook; our side still
    // holds it): not a prompt any more — the card follows what it is doing, and the stale hold is let go
    if (!a.agent && c.lastWorkT && c.lastWorkT > a.t + STALE_ASK_MS) { pass(a.id); continue; }   // (not a subagent's: its parent works on meanwhile)
    // one request per card, the oldest, with a count of the rest
    if (c.permAsk) { c.permAsk.more = (c.permAsk.more || 0) + 1; continue; }
    c.permAsk = Columns.permAskOf(a);
    c.asking = { tool: a.tool, what: a.what };
    c.column = 'approval';
    // AskUserQuestion is answered with a choice, not allowed
    if (a.questions) { c.permAsk.questions = a.questions; c.reason = `asked you a question (${a.tool})`; }
  }
}

/** 許可待ち with no prompt asked since the call is 実行中 (columns.js ranUnasked). */
function applyUnasked(cards, askedAt) {
  for (const c of cards) {
    if (!Columns.ranUnasked(c, askedAt)) continue;
    c.column = 'working'; c.reason = 'running a tool (no permission was asked)'; c.asking = null;
  }
}

function state(opts = {}) {
  const hours = opts.hours || 24;
  const now = Date.now();
  // RALLY_PROF=1: each phase's time on stderr
  const prof = Env.get('PROF') ? { t: process.hrtime.bigint(), ph: [] } : null;
  const mark = (name) => { if (!prof) return; const t = process.hrtime.bigint(); prof.ph.push([name, Number(t - prof.t) / 1e6]); prof.t = t; };
  // who is running: asked now, collected after the scan, so the two overlap
  const asking = opts.alive !== false ? Alive.begin() : null;
  const extra = [];
  // 完了 is kept however old: a card you closed does not drop off the board when its hours run out (the newest DONE_KEEP: far more than anyone closes)
  const doneKeep = new Set();
  const doneStore = Done.read();
  for (const [k, v] of Object.entries(doneStore.byId || {}).filter(([, v]) => v && v.lane !== 'stale').sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, DONE_KEEP)) {
    const i = k.indexOf(':'), agent = k.slice(0, i), id = k.slice(i + 1);
    const root = (opts.dirs || {})[agent];
    const hit = SessionIndex.lookup(agent, id, root ? { root } : {});
    if (hit) { extra.push(hit.file); doneKeep.add(k); }
  }
  const { found, stats } = Scan.sessions({ only: opts.only, dirs: opts.dirs, sinceMs: now - hours * 3600000, extra });
  const sessions = [];
  for (const f of found) for (const s of f.sessions) sessions.push(s);
  mark('scan');
  // a live session is on the board however long ago it last said anything
  const live = opts.alive !== false ? Alive.sessions({ begun: asking }) : null;   // null = we could not ask
  mark('alive');
  const cards = Live.cards(sessions, now, { boardCopies: Dispatch.boardCopies(), boardCodex: Dispatch.boardCodex() }).filter((c) => now - c.lastT < hours * 3600000 || (live && live.has(c.id)) || doneKeep.has(`${c.agent}:${c.id}`));
  mark('cards');
  // 完了 is set by you, not the clock: first, so a card you closed stays closed
  Done.apply(cards);
  // 棚卸し results run detached (lib/pending.js); there is no daemon to pick them up
  Wip.apply(cards, Wip.collect());
  mark('done+wip');
  const byKey = new Map(sessions.map((s) => [s.agent + '\0' + s.id, s]));
  const ordered = Columns.previewOrder(cards);
  for (const c of ordered.slice(0, LAST_MESSAGE_CAP)) {
    const s = byKey.get(c.agent + '\0' + c.id);
    if (s) {
      c.last = LastMessage.lastMessage(s);
      applyAsked(c);
      if (c.last && c.last.usage) { c.usage = c.last.usage; delete c.last.usage; }
    }
  }
  // a finished subagent's last word is its result, listed in its parent's panel
  const previewed = new Set(ordered.slice(0, LAST_MESSAGE_CAP).map((c) => c.agent + '\0' + c.id));
  let kids = 0;
  for (const c of ordered) {
    if (kids >= SUB_RESULT_CAP) break;
    if (!c.subagent || c.last || !previewed.has(c.agent + '\0' + c.parentId)) continue;
    const s = byKey.get(c.agent + '\0' + c.id);
    if (s) { const l = LastMessage.lastMessage(s); if (l) { delete l.usage; c.last = l; } kids++; }
  }
  LastMessage.flush();                                // one write, not eighty
  mark('lastMessage');
  Enrich.applyCached(cards, (c) => (byKey.get(c.agent + '\0' + c.id) || {}).file);
  mark('enrichCached');
  Labels.apply(cards);
  require('../forks.js').apply(cards);
  mark('labels/forks');
  if (opts.alive !== false) {
    Alive.apply(cards, live);
    // the process's own status outranks the transcript's guess
    Live.overlayAlive(cards);
    for (const c of cards) applyAsked(c);
    // drain held messages only when we know who is running: a failed liveness call must
    // not read as "nobody is running" and resume into a conversation someone is in
    // `claude agents` knows nothing of codex: a codex card mid-turn (its transcript's turn has begun and not ended) counts as
    // busy, so 今の作業後に送る waits for it instead of going at once
    if (opts.drain !== false && live) {
      const forDrain = new Map(live);
      for (const c of cards) if (c.agent === 'codex' && !c.subagent && c.column === 'working' && !forDrain.has(c.id)) forDrain.set(c.id, { status: 'busy', kind: 'codex' });
      Queue.drain(forDrain, { stopAndConfirm, handOver: (i, a) => handOverHeld(i, a, live) });
    }
    Queue.apply(cards);
    Queue.laneOf(cards);
  }
  mark('overlay+queue');
  // an open board's read is what lets the hook hold prompts; with none looking, the terminal asks
  if (opts.watch) { try { Perm.touchWatch(); } catch (e) { /* the board still loads */ } }
  const asks = (opts.perm === false ? [] : Perm.list()).filter((a) => {
    // answered elsewhere while its hook kept waiting (the transcript has the result):
    // pass lets the hook go. A subagent's request is judged by its own transcript.
    const s = Perm.sessionFor(a, byKey);
    if (!s || !Perm.settled(a, s.events)) return true;
    Perm.answer(a.id, 'pass');
    return false;
  });
  placeAsks(cards, asks, now, (id) => Perm.answer(id, 'pass'));
  if (Perm.hookInstalled()) applyUnasked(cards, (id) => Perm.askedAt(id));
  // この指示で完了: only once liveness and the prompts are on the cards
  mark('perm');
  // --reap (the app's refresh only) stops a wait loop left looping after its turn
  let bgAuto = null;
  if (opts.alive !== false && live && opts.bgtasks !== false) {
    try { bgAuto = Bgtasks.apply(cards, { reap: !!opts.reap }).auto; } catch (e) { /* the board still loads */ }
  }
  mark('bgtasks');
  // stuck (lib/stuck.js): last, once the lanes and the prompts are final
  for (const c of cards) {
    const st = Stuck.of(c, (byKey.get(c.agent + '\0' + c.id) || {}).events, now);
    if (st) c.stuck = st;
  }
  mark('stuck');
  // 完了までの目安 (lib/eta.js): the working cards only
  try { Eta.apply(cards, (c) => (byKey.get(c.agent + '\0' + c.id) || {}).events, now, sessions); } catch (e) { /* the board needs no estimate */ }
  // what the estimate said is kept for `eta-report`, only for a board someone is looking at
  if (opts.watch) { try { EtaLog.record(cards, now, (c) => (byKey.get(c.agent + '\0' + c.id) || {}).events); } catch (e) { /* the log is not the board */ } }
  mark('eta');
  // opt-in only: this spawns `claude -p` child processes (real API calls)
  if (opts.enrich) {
    const candidates = ordered.slice(0, ENRICH_CANDIDATE_CAP)
      .filter((c) => !c.titleMine)          // your own 概要 is never rewritten
      .map((c) => ({ agent: c.agent, id: c.id, subagent: c.subagent, lastTool: c.lastTool,
        recentTools: (c.recent || []).map((r) => r.tool).filter(Boolean),
        targets: (c.recent || []).map((r) => r.target).filter(Boolean).map((t) => String(t).split('/').slice(-2).join('/').slice(0, 40)),
        project: c.project ? String(c.project).split('/').filter(Boolean).pop() : '',
        file: (byKey.get(c.agent + '\0' + c.id) || {}).file }));
    // on screen: a few at a time; hidden: one per refresh
    Enrich.enrichSome(candidates, opts.watch ? { batch: 3, iconBatch: 3 } : {});
  }
  // the recent tool calls were for the title queue; the page never reads them
  for (const c of cards) delete c.recent;
  mark('enrichSome');
  SessionIndex.put(sessions);
  mark('sessionIndex');
  const agents = found.map((f) => ({ agent: f.agent, installed: f.installed, sessions: f.sessions.length }));
  // a subagent's title is the task it was handed: Claude Code writes it next to the
  // transcript (agent-<id>.meta.json, "description")
  {
    const fileOf = new Map(sessions.map((x) => [x.agent + '\0' + x.id, x.file]));
    const sessOf = new Map(sessions.map((x) => [x.agent + '\0' + x.id, x]));
    for (const c of cards) {
      if (!c.subagent || c.title) continue;
      if (c.agent === 'codex') {
        const s = sessOf.get(c.agent + '\0' + c.id);
        if (s && s.agentTask) c.title = String(s.agentTask).replace(/_/g, ' ').slice(0, 120);
        if (s && s.agentType) c.agentType = String(s.agentType).slice(0, 60);
        continue;
      }
      const f = fileOf.get(c.agent + '\0' + c.id);
      if (!f) continue;
      try {
        const m = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
        if (m.description) c.title = String(m.description).slice(0, 120);
        if (m.agentType) c.agentType = String(m.agentType).slice(0, 60);
      } catch (e) { /* older sessions have no meta */ }
    }
  }
  let skills = { common: [], byDir: {} };
  try { skills = Skills.forDirs(cards.map((c) => c.project).filter(Boolean)); } catch (e) { /* the board does not need them */ }
  mark('skills');
  const limits = Limits.read();
  let limitsSetup = null;
  if (!(limits && (limits.fiveHour || limits.week)) && agents.some((a) => a.agent === 'claude' && a.installed)) { try { limitsSetup = require('../statusline.js').suggest(); } catch (e) { /* none */ } }
  const out = { now, hours, home: require('os').homedir(), trusted: trustedDirs(), agents, cards, asks, skills, limits, limitsSetup, defaults: defaultModels(), efforts: defaultEfforts(), models: agentModelList(), scan: stats, bgAuto };
  mark('limits/defaults');
  if (prof) process.stderr.write('PROF ' + JSON.stringify(prof.ph.map(([n, ms]) => [n, Math.round(ms * 10) / 10])) + '\n');
  return out;
}

module.exports = { state, applyAsked, placeAsks, applyUnasked };
