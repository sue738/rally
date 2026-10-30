'use strict';
/** columns.js — what the board decides about one card, on top of its lane from lib/live.js. Pure. */

/** Did it stop *asking*, or just stop? A turn that ended in a question waits on a person. */
const ASKED_RE = /(ますか|ましょうか|どうします|どうしますか|どちら|どれに|いかがです|教えてください|よろしいですか|良いですか|よいですか|でよい(です)?か|[?？])\s*[。.!！]?$/;
function looksLikeAQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const tail = t.split('\n').filter((l) => l.trim()).pop() || '';
  return ASKED_RE.test(tail.trim());
}

const ASKED_REASON = 'the agent asked you something and stopped';
/** 返答 that is really あなた待ち: this turn (not an earlier one) ended in a question. */
function askedYou(c) {
  return !!(c.column === 'answered' && c.last && c.last.inTurn && looksLikeAQuestion(c.last.assistant));
}

/** The cards you might act on: not 放置, not closed, not a subagent or a machine-started run. */
function actionable(c) {
  return c.column !== 'idle' && c.column !== 'done' && !c.subagent && !c.headless;
}

/**
 * Who gets the expensive extras (message preview, a turn at the title queue): the cards
 * you might act on, then the newest of the rest — by recency alone, old 放置 cards never got any.
 */
function previewOrder(cards) {
  return [...cards].sort((a, b) => (actionable(a) === actionable(b) ? b.lastT - a.lastT : (actionable(a) ? -1 : 1)));
}

/** What a card says about a permission prompt held for it (lib/perm.js list). */
function permAskOf(a) {
  return { id: a.id, tool: a.tool, what: a.what, always: a.always, ...(a.choices ? { choices: a.choices } : {}), t: a.t, ...(a.partial ? { partial: true } : {}), ...(a.bg ? { bg: true } : {}), ...(a.agent ? { agentType: a.agentType || 'subagent' } : {}) };
}

/**
 * A tool call with no result reads as 許可待ち, and so does a long build. With the hook
 * installed every prompt leaves a mark (lib/perm.js markAsked): no mark since the call
 * means the tool is running. `askedAt` is the time of a session's last mark (0 when none).
 */
function ranUnasked(c, askedAt) {
  if (c.agent !== 'claude' || c.column !== 'approval' || c.permAsk || c.aliveStatus === 'waiting') return false;
  if (!/^waiting for permission/.test(c.reason || '') || !c.lastCallT) return false;
  return !(askedAt(c.id) >= c.lastCallT - 5000);
}

/**
 * Sessions worth a 棚卸し: yours, not read yet, not closed, not writing right now.
 * 放置 first, then the ones waiting on you, then the rest.
 */
const WIP_RANK = { stale: 0, 'needs-you': 1, approval: 1, idle: 2 };
function wipEligible(c) {
  return !c.wip && !c.subagent && !c.headless && c.column !== 'done' && c.column !== 'working' && (c.agent === 'claude' || c.agent === 'codex');
}
function wipOrder(x, y) {
  return ((WIP_RANK[x.column] ?? 5) - (WIP_RANK[y.column] ?? 5)) || (y.lastT - x.lastT);
}

function resumeHint(c) {
  if (c.agent === 'claude') return `claude --resume ${c.id}`;
  if (c.agent === 'codex') return `codex resume ${c.id}`;
  if (c.agent === 'antigravity') return `agy --conversation ${c.id}`;
  return null;
}

module.exports = { ASKED_RE, looksLikeAQuestion, ASKED_REASON, askedYou, actionable, previewOrder, permAskOf, ranUnasked, WIP_RANK, wipEligible, wipOrder, resumeHint };
