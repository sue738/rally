/**
 * page.js — run the board's own script against a stub DOM.
 *
 * `node -c` and `new Function(src)` only parse. Twice now the page shipped
 * parsing fine and threw the moment a panel opened: once a CSS rule that
 * beat [hidden], once a local named `live` that collided with the board's
 * state while `sendable` was never declared. Both would have been caught by
 * simply calling the function.
 *
 * So: execute the script with a fake document, then call the entry points a
 * person actually triggers. No assertions about looks — only "does it run".
 *
 * Run: node test/page.js   (also run from test/test.js)
 */
'use strict';
const fs = require('fs');
const path = require('path');
// the page's own script and stylesheet, joined from lib/ui/js/ and lib/ui/css/ in filename order (lib/page.js)
const uiScript = () => require('../lib/page.js').script();
const uiStyle = () => require('../lib/page.js').style();

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

/** An element that answers to anything the page does to it. */
function el(tag = 'div') {
  const node = {
    tagName: tag.toUpperCase(), children: [], value: '', textContent: '', innerHTML: '',
    hidden: false, checked: false, disabled: false, scrollTop: 0, scrollHeight: 100, clientHeight: 50,
    dataset: {}, style: { setProperty() {}, getPropertyValue: () => '' },
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; }, prepend(c) { this.children.unshift(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {}, after() {}, before() {}, focus() {}, blur() {}, click() {}, scrollIntoView() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
    setAttribute() {}, getAttribute: () => null, closest: () => null,
    querySelector: () => el(), querySelectorAll: () => [],
  };
  node.parentElement = null;
  return node;
}

function fakeDom() {
  const body = el('body');
  // the history pane is the one element a check reads back, so it persists
  const hist = el(), mbody = el();
  const kept = new Map();
  // an id is one element in the whole page: the compose box found from its panel is the same box
  // and the compose panel has no session message box
  mbody.querySelector = (s) => (/^#[\w-]+$/.test(s) ? doc.querySelector(s) : /^\.msg\b/.test(s) && /class="nsw"/.test(mbody.innerHTML) ? null : el());
  const doc = {
    body,
    documentElement: el('html'),
    createElement: (t) => el(t),
    // every other element records a click on it, by the selector it was found with
    // one element per selector, kept: a lane the page fills can be read back
    // (render appends its cards to $('[data-col=…] .list'))
    querySelector: (s) => (s === '#mhist' ? hist : s === '#mbody' ? mbody : kept.get(s) || kept.set(s, Object.assign(el(), { click() { doc.clicks.push(s); } })).get(s)),
    clicks: [],
    querySelectorAll: () => [],
    // kept, so a check can press a key the way the board hears it
    listeners: {},
    addEventListener(t, f) { (doc.listeners[t] = doc.listeners[t] || []).push(f); },
    dispatchEvent() { return true; },
  };
  return doc;
}

function runPage(saved = {}) {
  // the page's script is a plain file now — no extraction, no literal
  const src = uiScript();
  const document = fakeDom();
  const store = { ...saved };
  const fetched = [];
  const timers = [];
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const window = {
    document, localStorage, innerWidth: 900, innerHeight: 800,
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0, webkit: undefined,
  };
  const scope = {
    document, window, localStorage, fetch: (u, o) => { fetched.push([u, o]); return new Promise(() => {}); }, setInterval: () => 0, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    requestAnimationFrame: () => 0, CSS: { escape: (s) => String(s) }, navigator: { clipboard: { writeText() {} } },
    KeyboardEvent: function () {}, DragEvent: function () {}, DataTransfer: function () {},
    getComputedStyle: () => ({ display: 'none', paddingRight: '0px' }),
    console,
  };
  const names = Object.keys(scope);
  // `return` the page's own functions so they can be called from here.
  const body = src + '\n;return {ptyInputHas, mdRender, sentEchoes, echoRestore, yourOrderSet, effortDefault, yourSorted: () => yourSort(live.cards), laneLocalSet, live: () => live, dlgParse, dlgSeen, askHtml, ptyFixKind, toggleNew, syncPanelBtns, openFirstPanel: () => { openedFirst = false; openFirst(); }, histReconcile, thinkState, palItems, unreadReplies, unreadChip, seenBaseline, seenMapRef: () => seenMap, seenARef: () => seenA, echoTyped, unreadFromOf, isUnread, unreadShown, markSeen, unreadCount, unreadAllRead, seenBase: () => seenBase, histAsk, histPut, histCache, histTouch, clock, matchQuery, searchSuggest, flash, copyId, wfHeldOf, wfLocal, wfSend, wfBusy, moreChips, etaLabel, etaChip, etaSettle, etaTaskChip, prHtml, hist: document.querySelector(\'#mhist\'), body: () => document.querySelector(\'#mbody\'), openDetail, openNew, openPendingAll, pendCounts, wipStart, jobsHtml, whenNext, renderHistory, applyState, render, reasonJa, applyTheme, pendLine, echoSent, sentEchoes, cardSig, thinkState, resumeCell, fuzzy, openPalette, closePalette, arrivals, stuckText, kidsPlan, mdRender, diffRender, diffLines, reviewMessage, openChanges, notesOf, sendNotes, noteHere, renderChangesFor: (j) => window.__kanban.changes(j), linkify, askHtml, qAnswers, qPick, permAnswer, modelVer, famVersions, autoHue, topicKey, parseQuery, matchQuery, flipDeltas, prArrived, prNumOf, qerrText, notifyBar, PAL_ACTIONS, clicks: document.clicks, prMergeable, prFinish, prFinished, prDone, wtHtml, wtNote, wtPost, pendAct, dispatch, pendingToasts, dispatched: (r) => window.__kanban.dispatched(r), newState: () => newRun, pendingNewOf: () => pendingNew, panel: () => panelKey, togglePanel, closeDetail, sel: () => sel, setSel: (k) => { sel = k; }, openFor: () => openFor, boardView: () => boardView, setView, VIEWS, cshow, setCardShow, CARD_FIELDS, CHIP_FIELDS, chipOrder, setCardOrder, orderedChips, cardShowOpen, ptys, ptyEnded, kanban: window.__kanban, sentEchoes, panelView: () => panelView, panelPrefSet, ptyUnpark, setFn: (n, f) => { eval(n + \' = f\'); }, bgNote, bgPopOpen, bgStopTasks, bgPopRefresh, win: window, mountPanelTerm, takeoverWhy, KM_DEFS, KM_GROUPS, KM_PRESETS, kmCanon, kmAct, kmBad, kmSet, kmReset, kmResetAll, kmPreset, kmPresetNow, kmLoad, kmParse, kmKey, kmL, kmLabel, kmText, kmOver: () => kmOver, SHORTCUTS, drawHelp, openKeys, keyDraw, kmCapKey, keyCap: () => keyCap, setKeyCap: (v) => { keyCap = v; }};';
  const fn = new Function(...names, body);
  // a key press as the board's own listeners get it, in the order they were added
  const key = (k) => {
    const e = { key: k, target: document.activeElement || document.body, stopped: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; } };
    for (const f of document.listeners.keydown || []) { if (e.stopped) break; f(e); }
  };
  return { ...fn(...names.map((n) => scope[n])), fetched, timers, document, store, key };
}

// the app answers the page through window.__kanban; the harness's window is the page's
function window_changes(api, j) { api.renderChangesFor(j); }

const card = {
  agent: 'claude', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', project: '/Users/me/proj',
  column: 'needs-you', reason: 'the agent replied and is waiting for you', idleS: 300, lastT: Date.now() - 300000,
  firstT: Date.now() - 3600000, toolCalls: 4, humanTurns: 2, assistantTurns: 3, recent: [], subagent: false,
  headless: false, resume: 'claude --resume aaaa', title: '推測された題名', last: { first: 'a', human: 'b', assistant: 'c' },
};

console.log('== the page actually runs (not just parses) ==');
let api;
try { api = runPage(); ok('the script executes against a DOM', !!api && typeof api.openDetail === 'function'); }
catch (e) { ok(`the script executes against a DOM — ${e.message}`, false); }

if (api) {
  // A `claude --resume <id>` pasted into a terminal while the session is
  // still alive forks a second process (see dispatch.js/alive.js) — the
  // exact incident this guards against, measured 2026-09-23. So the raw
  // command must never be offered to copy for a card the board itself
  // marked alive, live or not.
  try {
    const dead = api.resumeCell(card);
    const alive = api.resumeCell({ ...card, alive: true });
    const noHint = api.resumeCell({ ...card, resume: null });
    ok('★ resumeCell: a stopped session still offers the resume command to copy',
      dead.copy === card.resume && dead.html.includes(card.resume));
    ok('★ resumeCell: an alive session withholds the copyable command entirely',
      alive.copy === null && !alive.html.includes(card.resume) && alive.html.includes('locked'));
    ok('★ resumeCell: no resume hint at all when the card has none', noHint.copy === null);
  } catch (e) { ok(`resumeCell — ${e.message}`, false); }

  // ここで開き直す: offered only while it sits idle in the other terminal
  try {
    const it = { ...card, alive: true, aliveKind: 'interactive', aliveStatus: 'idle', alivePid: 4242, aliveCopies: 1 };
    ok('★ takeover: idle in another terminal → offered (no reason to refuse)', api.takeoverWhy(it) === '');
    ok('★ takeover: busy → not offered, 作業中なので移せません', api.takeoverWhy({ ...it, aliveStatus: 'busy' }) === '作業中なので移せません');
    ok('★ takeover: waiting on a prompt → not offered', /確認待ち/.test(api.takeoverWhy({ ...it, aliveStatus: 'waiting', aliveWaitingFor: 'permission prompt' })));
    ok('takeover: two claudes on it, or no pid → not offered', !!api.takeoverWhy({ ...it, aliveCopies: 2 }) && !!api.takeoverWhy({ ...it, alivePid: null }));
    const box = api.document.querySelector('#mterm');
    // (the page is not in the app here: its ptyowner post, after the drawing, has nowhere to go)
    const mount = (c) => { try { api.mountPanelTerm(c, false); } catch (e) { if (!/messageHandlers/.test(e.message)) throw e; } };
    mount(it);
    const idleHtml = box.innerHTML;
    mount({ ...it, aliveStatus: 'busy' });
    ok('★ takeover: the panel shows ここで開き直す beside 端末へ when idle, and says why not when busy', /id="mtakeover"/.test(idleHtml) && /id="mgoterm"/.test(idleHtml) && !/id="mtakeover"/.test(box.innerHTML) && /作業中なので移せません/.test(box.innerHTML));
  } catch (e) { ok(`takeover — ${e.message}`, false); }

  for (const [name, c] of [
    ['a card waiting on you', card],
    ['a live session (message gets queued)', { ...card, alive: true, aliveKind: 'interactive', aliveName: 'me-b7', aliveCopies: 2 }],
    ['a 放置 card', { ...card, column: 'stale', waiting: 'you', reason: 'quiet for 9h' }],
    ['a card with a queued message', { ...card, queued: 'あとでこれを' }],
    ['a queued message the CLI refused and kept', { ...card, queued: 'あとでこれを', queuedFails: 5, queuedError: 'claude が受け付けませんでした(メッセージは向こうに保存され、次にこのセッションが起動したときに届きます): Workspace not trusted.' }],
    ['a card with your own 概要 and colour', { ...card, title: '本番の移行', titleMine: true, color: 'red' }],
    ['a gemini card (no history, no send box)', { ...card, agent: 'gemini', resume: null }],
    ['a working card', { ...card, column: 'working', reason: 'wrote within the last minute', lastTool: 'Bash' }],
    ['a card with a 棚卸し result', { ...card, wip: { status: 'ok', at: Date.now() - 60000, summary: 's', remaining: [{ what: 'DNSを切り替える', evidence: '未実施' }], blocked: ['承認待ち'], state: 'in-progress' } }],
    ['a card whose 棚卸し found nothing left', { ...card, wip: { status: 'ok', at: Date.now(), remaining: [], blocked: [], state: 'done' } }],
    ['a card with a 棚卸し still running', { ...card, wip: { status: 'running', at: Date.now(), pid: 1 } }],
    ['a card whose 棚卸し failed', { ...card, wip: { status: 'error', at: Date.now(), error: '答えが返りませんでした' } }],
    ['a card you marked 完了', { ...card, column: 'done', done: { at: Date.now() - 120000, wrapup: 'memory' } }],
    ['a 完了 whose wrap-up is still queued', { ...card, column: 'done', alive: true, done: { at: Date.now(), wrapup: 'queued' } }],
  ]) {
    try { api.openDetail(c); ok(`openDetail: ${name}`, true); }
    catch (e) { ok(`openDetail: ${name} — ${e.message}`, false); }
  }
  try {
    api.openDetail(card);
    ok('★ panel: no いま / 待ち box under the title', !/id="mnow"|class="mnow"|要約しています/.test(api.body().innerHTML));
  } catch (e) { ok(`panel without いま / 待ち — ${e.message}`, false); }
  try {
    api.openDetail({ ...card, column: 'working', reason: 'the process is busy (claude agents)', usage: { ctx: 535000 } });
    const st = (api.body().innerHTML.match(/<div class="mstat"[^]*?<\/div>/) || [''])[0];
    ok('★ status line: the lane chip stays; state (a dot in the lane\'s colour), folder, clock and context each carry a light icon and a tooltip',
      /class="lane c-working"/.test(st) && /class="mi why" title="状態[^"]*"><span class="sdot c-working"/.test(st)
      && /class="mi dim mproj" title="プロジェクト[^"]*\/Users\/me\/proj"><svg class="mico"/.test(st) && /class="mi dim mago" title="最後に動いたのは[^"]*"><svg class="mico"/.test(st)
      && /class="mi ctx warn" title="文脈[^"]*1M の窓の 54%"><svg class="mico"[^]*<span>535k<\/span><span class="cbar"[^>]*><i style="width:54%">/.test(st)
      && (st.match(/stroke="currentColor"/g) || []).length === 3 && !/[\u{1F300}-\u{1FAFF}]/u.test(st));
    api.openDetail({ ...card, usage: { ctx: 50000 } });
    const st2 = (api.body().innerHTML.match(/<div class="mstat"[^]*?<\/div>/) || [''])[0];
    ok('status line: a small context says its size, and no bar or % (the window is not known)', /<span>50k<\/span>/.test(st2) && !/cbar/.test(st2) && /割合は出しません/.test(st2));
  } catch (e) { ok(`status line icons — ${e.message}`, false); }
  {
    const base = { branch: 'feat/x', base: 'origin/main', onBase: false, worktree: true, ahead: 2, dirty: 0, pushed: true };
    const none = api.prHtml({ ...base, pr: null });
    const open = api.prHtml({ ...base, pr: { number: 7, state: 'OPEN', url: 'u', title: 't', checks: { pass: 3, fail: 1, pending: 0 }, review: '' } });
    const green = api.prHtml({ ...base, pr: { number: 7, state: 'OPEN', url: 'u', title: 't', checks: { pass: 3, fail: 0, pending: 0 }, review: 'APPROVED' } });
    ok('★ pr: no ask buttons (nothing is written into the send box); a failing check → no マージ; all green → マージして片付け', !/data-k=/.test(none) && !/data-k=/.test(open) && !/prfin/.test(open) && /class="mini prfin" data-merge="1"/.test(green) && /worktree/.test(none));
    const merged = api.prHtml({ ...base, pr: { number: 7, state: 'MERGED', url: 'u', title: 't', checks: {}, review: '' } });
    const blocked = api.prHtml({ ...base, pr: { number: 7, state: 'OPEN', url: 'u', title: 't', checks: { pass: 3 }, review: '', merge: 'BLOCKED' } });
    ok('★ pr: merged → 片付け without merging; blocked by the repository → no merge button', /class="mini prfin"(?! data-merge)[^>]*>片付け</.test(merged) && !/prfin/.test(blocked));
    ok('pr: on the base branch there is nothing to offer', !/<button/.test(api.prHtml({ ...base, onBase: true, ahead: 0, pr: null })));
  }
  {
    const md = api.mdRender('見て:\n```sh\nnpm test\n```');
    ok('★ copy: a code block carries its copy button, outside the <pre> it copies', /<div class="codeblk"><button class="cpy"[^]*<\/button><pre data-lang="sh"><code>npm test<\/code><\/pre><\/div>/.test(md));
  }
  {
    // 今の作業後に送る: the chip in the send row, and each held message at the foot of the thread
    const wf = { ...card, alive: true, aliveKind: 'background', aliveStatus: 'busy', queued: '一つ目\n\n二つ目', queuedPlain: '',
      held: [{ key: 'k1', text: '一つ目', at: Date.now() - 60000 }, { key: 'k2', text: '二つ目', at: Date.now() - 1000 }] };
    let h = '', top = '';
    try { api.openDetail(wf); top = api.body().innerHTML; api.renderHistory({ agent: wf.agent, session: wf.id, turns: [{ kind: 'user', text: 'はじめ', t: Date.now() - 90000 }] }); h = api.hist.innerHTML; } catch (e) { ok(`今の作業後に送る — ${e.message}`, false); }
    ok('★ 今の作業後に送る: a chip in the send row, next to --fork', /class="mini wfbtn toggle tflag[^"]*"[^>]*>今の作業後に送る</.test(top) && top.indexOf('wfbtn') > top.indexOf('forkbtn'));
    ok('★ 今の作業後に送る: held ones are in the thread, in order, each with 編集, 今すぐ送る and 取り消す (no waiting notice) — not in the 送信待ち note',
      h.indexOf('data-key="k1"') > h.indexOf('はじめ') && h.indexOf('data-key="k2"') > h.indexOf('data-key="k1"')
      && (h.match(/class="mini hnow"/g) || []).length === 2 && (h.match(/class="mini hcancel"/g) || []).length === 2
      && (h.match(/class="mini hedit"/g) || []).length === 2
      && /今の作業後に送る 1\/2/.test(h) && !/作業中です|手が空いたら送ります/.test(h) && !/mnote queued/.test(top));
    // a message with a trailing newline is stored trimmed by the queue: the line drawn at once must not stay beside it
    try {
      const k = wf.agent + ':' + wf.id;
      api.wfLocal.set(k, [{ key: 'local-x', text: 'おはよう\n', at: Date.now() - 1000, local: true }]);
      const held = api.wfHeldOf({ ...wf, held: [{ key: 'kr', text: 'おはよう', at: Date.now() }] });
      ok('★ 今の作業後に送る: the line drawn at once and the queued one are one message, not two', held.length === 1 && held[0].key === 'kr');
      api.wfLocal.delete(k);
    } catch (e) { ok(`今の作業後に送る dedupe — ${e.message}`, false); }
  }
  {
    // --model: one pulldown like the permission mode (the current choice on it, the four in its menu), not a row of chips
    let top = '';
    try { api.openDetail({ ...card, model: 'opus', modelId: 'claude-opus-5-5' }); top = api.body().innerHTML; } catch (e) { ok(`--model — ${e.message}`, false); }
    const menu = (top.match(/<div class="modemenu modelmenu"[^]*?<\/div><\/span>/) || [''])[0];
    ok('★ --model is one pulldown: the button says 既定 and what that is, the menu has 既定 / opus / sonnet / haiku / fable',
      /class="mini tflag mmodel" data-model=""[^>]*>既定 [^<]*▾<\/button>/.test(top) && (menu.match(/role="menuitem"/g) || []).length === 5 && /data-m="fable"/.test(menu)
      && /data-m="" class="on"/.test(menu) && !/<span class="flag">--model<\/span>/.test(top));
  }
  {
    // a codex session: its menu is codex's models (the ones this Mac's codex sessions ran), never Claude's
    let top = '';
    try {
      api.applyState({ cards: [{ ...card, agent: 'codex', id: 'cx-a', model: 'gpt-5.6-terra', lastT: 3 }, { ...card, agent: 'codex', id: 'cx-b', model: 'gpt-5.5', lastT: 2 }], agents: [], hours: 24, collisions: [] });
      api.openDetail({ ...card, agent: 'codex', id: 'cx-a', model: 'gpt-5.6-terra' }); top = api.body().innerHTML;
    } catch (e) { ok(`--model codex — ${e.message}`, false); }
    const menu = (top.match(/<div class="modemenu modelmenu"[^]*?<\/div><\/span>/) || [''])[0];
    ok('★ --model on a codex session: 既定 (what it runs) and the other codex models seen, no opus / sonnet / haiku / fable',
      /data-m=""/.test(menu) && /data-m="gpt-5.5"/.test(menu) && !/data-m="(opus|sonnet|haiku|fable)"/.test(menu) && /gpt-5.6-terra/.test(menu));
  }
  {
    // codex's own model list (its /model): offered even if no session on this Mac ran them, with its description
    let top = '';
    try {
      api.applyState({ cards: [{ ...card, agent: 'codex', id: 'cx-a', model: 'gpt-5.6-terra', lastT: 3 }], agents: [], hours: 24, collisions: [],
        models: { codex: [{ v: 'gpt-6-astra', l: 'GPT-6-Astra', d: 'Frontier intelligence' }, { v: 'gpt-5.6-terra', l: 'GPT-5.6-Terra', d: 'Balanced' }] } });
      api.openDetail({ ...card, agent: 'codex', id: 'cx-a', model: 'gpt-5.6-terra' }); top = api.body().innerHTML;
    } catch (e) { ok(`--model codex list — ${e.message}`, false); }
    const menu = (top.match(/<div class="modemenu modelmenu"[^]*?<\/div><\/span>/) || [''])[0];
    ok('★ --model on a codex session: the models codex itself offers are in the menu with their description, the one in use marked',
      /data-m="gpt-6-astra"[^]*?Frontier intelligence/.test(menu) && /Balanced · \$2 \/ \$12[^<]*\(いま使っている\)/.test(menu) && (menu.match(/role="menuitem"/g) || []).length === 3 && !/data-m="(opus|sonnet)"/.test(menu));
  }
  {
    // a permission prompt held for the board: its box, its buttons, its id
    const held = { ...card, column: 'approval', permAsk: { id: 'a'.repeat(32), tool: 'Bash', what: 'rm -rf build', t: Date.now() } };
    let h = '', top = '';
    try { api.openDetail(held); top = api.body().innerHTML; api.renderHistory({ agent: held.agent, session: held.id, turns: [{ kind: 'user', text: 'build を消して', t: Date.now() - 5000 }, { kind: 'tool', tool: 'Bash', text: 'rm -rf build', t: Date.now() - 1000 }] }); h = api.hist.innerHTML; } catch (e) { /* checked below */ }
    ok('★ perm: the prompt is in the conversation, after what led to it — not above it', !/askbox/.test(top) && h.indexOf('askbox held') > h.indexOf('build を消して') && h.indexOf('build を消して') >= 0);
    ok('★ perm: a held prompt shows what it asks with 許可 / 拒否 / 端末で答える', /class="askbox held" data-perm="a{32}"/.test(h) && /rm -rf build/.test(h) && /askyes/.test(h) && /askno/.test(h) && /askpass/.test(h));
    try {
      const appr = { ...card, column: 'approval', alive: true, aliveKind: 'interactive', asking: { tool: 'Bash', what: 'make' } };
      api.openDetail(appr);
      api.renderHistory({ agent: appr.agent, session: appr.id, turns: [{ kind: 'user', text: 'x', t: Date.now() }] });
      api.openDetail({ ...appr, title: 'z' }, true);
      api.openDetail({ ...appr, column: 'working', asking: null }, true);
      ok('perm: an approval card (not held) draws and redraws without throwing', /class="askbox"/.test(api.hist.innerHTML) || true);
    } catch (e) { ok('perm: an approval card redraw — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
    {
      // a question held for the board: asked in the panel, answered with a choice
      const qs = [{ question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: '' }] }];
      const qc = { ...card, column: 'approval', reason: 'asked you a question (AskUserQuestion)', alive: true, aliveStatus: 'waiting', aliveWaitingFor: 'input needed',
        permAsk: { id: 'c'.repeat(32), tool: 'AskUserQuestion', what: 'Which color?', t: Date.now(), questions: qs } };
      const qh = api.askHtml(qc);
      ok('★ question: the panel shows the question, its options as buttons, a line for your own answer, and 端末で答える — not 許可 / 拒否',
        /class="askbox held askq" data-perm="c{32}"/.test(qh) && /Which color\?/.test(qh) && /class="aopts rows"><div class="aorow"><button class="mini aopt" data-q="0" data-o="0">Red<\/button><span class="dim adesc">warm<\/span>/.test(qh)
        && /data-o="1">Blue</.test(qh) && /class="aother"/.test(qh) && /askpass/.test(qh) && !/askyes|askno/.test(qh) && !/ダイアログが開いたまま/.test(qh));
      ok('question: one question with one answer goes on the pick (no 答える button); several need 答える', !/askq-send/.test(qh)
        && /askq-send/.test(api.askHtml({ ...qc, permAsk: { ...qc.permAsk, id: 'd'.repeat(32), questions: [qs[0], { ...qs[0], question: 'Which size?' }] } })));
      const pk = api.qPick(qc.permAsk);
      ok('question: nothing picked is no answer', api.qAnswers(qc.permAsk) === null);
      pk.sel[0] = new Set([1]);
      ok('★ question: the pick is the option\'s label, keyed by the question text', JSON.stringify(api.qAnswers(qc.permAsk)) === '{"Which color?":"Blue"}');
      pk.other[0] = ' Green ';
      ok('question: your own words win over a pick', JSON.stringify(api.qAnswers(qc.permAsk)) === '{"Which color?":"Green"}');
      const multi = { id: 'e'.repeat(32), questions: [{ question: 'Sizes?', multiSelect: true, options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] };
      api.qPick(multi).sel[0] = new Set([2, 0]);
      ok('question: several picks are joined by ", " in the order offered', JSON.stringify(api.qAnswers(multi)) === '{"Sizes?":"S, L"}');
      const n0 = api.fetched.length;
      api.permAnswer(qc, 'answer', { 'Which color?': 'Green' });
      const sent = api.fetched.slice(n0).find(([u]) => u === 'api/perm');
      ok('★ question: the answer goes to the board as decision "answer" with the answers', sent && JSON.stringify(JSON.parse(sent[1].body)) === JSON.stringify({ id: 'c'.repeat(32), decision: 'answer', answers: { 'Which color?': 'Green' } }));
      // what is open in the terminal when no hook holds it: named, and why it is answered there
      const dlg = (w) => api.askHtml({ ...card, alive: true, aliveStatus: 'waiting', aliveWaitingFor: w });
      ok('★ dialog: a /command\'s screen says what it is and that the board cannot answer it', /端末でダイアログが開いたままです/.test(dlg('dialog open')) && /\/chrome/.test(dlg('dialog open')) && /ボードからは答えられません/.test(dlg('dialog open')) && /届け待ち/.test(dlg('dialog open')));
      ok('★ dialog: a question not held for the board says it is a question, and which ones the board answers', /端末で質問が開いたままです/.test(dlg('input needed')) && /ボードを開いている間に出た質問/.test(dlg('input needed')));
      ok('dialog: anything else is named by what Claude Code calls it', /sandbox request/.test(dlg('sandbox request')) && /ボードからは答えられません/.test(dlg('sandbox request')));
      ok('question: its lane line reads 端末で質問が開いたまま when only the terminal has it', api.reasonJa({ ...card, reason: 'waiting for input needed (claude agents)' }) === '端末で質問が開いたまま');
    }
    ok('★ perm: a second prompt in a row changes the card signature (the panel redraws, ⌘Y cannot answer one unseen)', api.cardSig(held) !== api.cardSig({ ...held, permAsk: { ...held.permAsk, id: 'b'.repeat(32) } }));
    api.arrivals({ cards: [held] });
    const again = api.arrivals({ cards: [{ ...held, permAsk: { ...held.permAsk, id: 'b'.repeat(32) } }] });
    ok('perm: a second prompt on a card already in Your Turn is news (notified)', again.arrived.length === 1);
    ok('perm: the same prompt on the next refresh is not', api.arrivals({ cards: [{ ...held, permAsk: { ...held.permAsk, id: 'b'.repeat(32) } }] }).arrived.length === 0);
  }
  try { api.openDetail(card); api.openDetail({ ...card, title: '新しい概要' }, true); ok('openDetail: a redraw of the card you are looking at (keep)', true); }
  catch (e) { ok(`openDetail keep — ${e.message}`, false); }
  try {
    ok('★ palette: every character in order matches, out of order does not', api.fuzzy('akb', 'agentkanban') > 0 && api.fuzzy('zz', 'agentkanban') === 0 && api.fuzzy('', 'x') > 0);
    ok('palette: a run and a word start beat scattered letters', api.fuzzy('kan', 'agent kanban') > api.fuzzy('kan', 'k-a-n'));
    api.applyState({ cards: [card, { ...card, id: 'x2', column: 'working' }] });
    api.openPalette(); api.closePalette();
    ok('palette: opens and closes', true);
    {
      // the 作業中 line under the thread goes when the card leaves Working with nothing new in the thread (it used to stay for good)
      const wk = { ...card, id: 'think-1', column: 'working' }, turns = [{ kind: 'user', text: 'やって', t: Date.now() - 20000 }, { kind: 'assistant', text: 'できました', t: Date.now() - 10000 }];
      api.applyState({ cards: [wk], agents: [], hours: 24 });
      api.openDetail(wk);
      api.renderHistory({ agent: wk.agent, session: wk.id, turns });
      const before = /turn think/.test(api.hist.innerHTML);
      api.histCache.set(wk.agent + ':' + wk.id, { j: { agent: wk.agent, session: wk.id, turns }, at: Date.now(), lastT: wk.lastT || 0 });
      api.applyState({ cards: [{ ...wk, column: 'answered' }], agents: [], hours: 24 });
      ok('★ thread: 作業中 shows while the card works, and goes once it is in Your Turn, though the thread has nothing new', before && !/turn think/.test(api.hist.innerHTML));
      {
        // level-triggered: with no event at all, the periodic check finds the thread out of step with the state and draws it again
        const wk2 = { ...card, id: 'think-2', column: 'working' };
        api.applyState({ cards: [wk2], agents: [], hours: 24 });
        api.openDetail(wk2);
        api.renderHistory({ agent: wk2.agent, session: wk2.id, turns: turns });
        api.histCache.set(wk2.agent + ':' + wk2.id, { j: { agent: wk2.agent, session: wk2.id, turns }, at: Date.now(), lastT: wk2.lastT || 0 });
        const drawnThink = /turn think/.test(api.hist.innerHTML), same = api.histReconcile();
        api.applyState({ cards: [{ ...wk2, column: 'answered' }], agents: [], hours: 24 });
        api.hist.innerHTML = '<div class="turn think">stale</div><div>x</div>'; api.hist.dataset.vsig = 'stale';
        const fixed = api.histReconcile();
        ok('★ thread: the periodic check leaves a thread that matches the state alone, and redraws one that does not', drawnThink && same === false && fixed === true && !/turn think/.test(api.hist.innerHTML));
      }
      api.applyState({ cards: [card, { ...card, id: 'x2', column: 'working' }] });
    }
    {
      // sessions sharing a title (a copy carries its parent's name) are told apart in the palette: icon, short id, 複製, what they last said
      api.applyState({ cards: [{ ...card, id: 'aaaa1111-0', title: 'Rally', icon: '🚀', column: 'working' }, { ...card, id: 'bbbb2222-0', title: 'Rally', icon: '🎨', column: 'idle', copyOf: 'aaaa1111-0', last: { human: '', assistant: 'アイコンの案を出しました' } }, { ...card, id: 'cccc3333-0', title: 'ほか', icon: '📦' }], agents: [], hours: 24 });
      const its = api.palItems().filter((x) => x.kind === 's');
      const by = (id) => its.find((x) => x.c.id === id);
      ok('★ palette: sessions with one title carry icon, short id and (a copy) 複製 and what they last said; a unique title stays plain',
        by('aaaa1111-0').ic === '🚀' && by('aaaa1111-0').tag === '#aaaa' && by('bbbb2222-0').tag === '複製 #bbbb' && /アイコンの案/.test(by('bbbb2222-0').sub) && by('cccc3333-0').tag === '' && by('cccc3333-0').ic === '📦' && !/ · アイコン/.test(by('cccc3333-0').sub));
      api.applyState({ cards: [card, { ...card, id: 'x2', column: 'working' }] });
    }
    {
      const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime(), now = at(2026, 9, 30, 15, 0);
      ok('★ clock: today is 14:05, before today 9/29 14:05, another year 2025/12/31 9:07',
        api.clock(at(2026, 9, 30, 14, 5), now) === '14:05' && api.clock(at(2026, 9, 29, 14, 5), now) === '9/29 14:05' && api.clock(at(2025, 12, 31, 9, 7), now) === '2025/12/31 09:07');
    }
    const mq = (q, c) => api.matchQuery(api.parseQuery(q), c);
    ok('★ search: subagents only when asked — is:sub keeps just them, other is: words still mean states',
      mq('is:sub', { agent: 'claude', subagent: true, column: 'idle' }) && !mq('is:sub', { agent: 'claude', column: 'idle' })
      && mq('is:sub is:done', { agent: 'claude', subagent: true, column: 'done' }) && !mq('is:sub is:working', { agent: 'claude', subagent: true, column: 'done' })
      && mq('is:working', { agent: 'claude', column: 'working' }));
    const cs = [{ agent: 'claude', project: '/w/rally' }, { agent: 'codex', project: '/w/rally' }, { agent: 'claude', project: '/w/other' }];
    const sg = (t) => api.searchSuggest(t, cs);
    const lab = (t) => sg(t).items.map((x) => x.label).join(',');
    ok('★ search: a word start offers the filter words that begin with it (ti → title:, a → agent:, after:)', lab('ti') === 'title:' && lab('x ag') === 'agent:' && lab('a') === 'agent:,after:');
    ok('★ search: `is:` offers the states, `agent:` the agents in use, `project:` the folders (busiest first), each replacing just the word typed',
      lab('is:') === 'turn,working,waiting,done,unread,sub' && lab('agent:') === 'claude,codex' && lab('in:') === 'rally,other' && sg('foo is:wo').items[0].insert === 'is:working ' && sg('foo is:wo').tok === 'is:wo');
    ok('search: nothing to offer for a finished value, a plain phrase, a #number or a quote', lab('is:working') === '' && lab('zzz') === '' && lab('#12') === '' && lab('"ti') === '' && lab('before:') === '1h,1d,1w,30d');
  } catch (e) { ok(`palette — ${e.message}`, false); }
  try {
    // arrivals keeps its own memory: the first read is not news, a card that stays is told once
    const base = { ...card, id: 'n1', column: 'stale' };
    api.arrivals({ cards: [base] });
    const a1 = api.arrivals({ cards: [{ ...base, column: 'answered' }, { ...card, id: 'n2', column: 'approval', subagent: true }] });
    const a2 = api.arrivals({ cards: [{ ...base, column: 'answered' }] });
    ok('★ notify: a card that came to your turn arrives once; a subagent does not; the lane is counted', a1.arrived.length === 1 && a1.arrived[0].id === 'n1' && a1.n === 1 && a2.arrived.length === 0);
  } catch (e) { ok(`arrivals — ${e.message}`, false); }
  try {
    // a stuck session is told once per episode, and the first read is not news
    const w = { agent: 'claude', id: 'w1', column: 'working', project: '/p', title: 'ビルド', lastT: Date.now() };
    const st = { ...w, stuck: { kind: 'loop', what: 'Bash npm test', n: 3, since: Date.now(), key: 'loop:aaa' } };
    const f0 = api.arrivals({ cards: [st] });
    const f1 = api.arrivals({ cards: [{ ...w, id: 'w2', stuck: { ...st.stuck, key: 'loop:bbb' } }, st] });
    const f2 = api.arrivals({ cards: [{ ...w, id: 'w2', stuck: { ...st.stuck, key: 'loop:bbb' } }, st] });
    const f3 = api.arrivals({ cards: [{ ...w, id: 'w2' }] });
    const f4 = api.arrivals({ cards: [{ ...w, id: 'w2', stuck: { ...st.stuck, key: 'loop:bbb' } }] });
    ok('★ stuck: told once per episode — not again on the next refresh, not after flickering off', f0.stuck.length <= 1 && f1.stuck.length === 1 && f1.stuck[0].id === 'w2' && f2.stuck.length === 0 && f3.stuck.length === 0 && f4.stuck.length === 0);
    ok('stuck: the text says what repeats, and how long a wait has been up', /3 回繰り返し[^]*npm test/.test(api.stuckText(st)) && /許可待ちが 20 分/.test(api.stuckText({ stuck: { kind: 'wait', what: 'Bash rm', since: Date.now() - 20 * 60000 } })));
    ok('stuck: a new episode changes the card signature (the panel line appears)', api.cardSig(st) !== api.cardSig(w));
    const fresh = runPage();
    ok('stuck: the first read of a board is not news', fresh.arrivals({ cards: [st] }).stuck.length === 0 && fresh.arrivals({ cards: [st, { ...w, id: 'w3', stuck: { ...st.stuck, key: 'loop:ccc' } }] }).stuck.length === 1);
    api.openDetail(st, true);
    ok('stuck: the panel says so', /mnote stuck/.test(api.body().innerHTML));
  } catch (e) { ok(`stuck — ${e.message}`, false); }
  try {
    const h = api.mdRender('# <img src=x onerror=alert(1)>\n[a](javascript:alert(1)) `<b>` **<script>**\n\n| a | b |\n|---|---|\n| <i>x</i> | [l](https://e.com) |');
    ok('★ viewer: markdown never lets a tag through, and links are https only',
      !/<img|<script|<i>|javascript:"|href="javascript/.test(h) && h.includes('<h1>') && h.includes('<table>') && h.includes('href="https://e.com"'));
    ok('viewer: a soft newline is a space, and nothing between Japanese', api.mdRender('a\nb').includes('<p>a b</p>') && api.mdRender('日本\n語').includes('<p>日本語</p>'));
    ok('viewer: lists nest, fences stay verbatim', /<ul><li>a<ul><li>b<\/li><\/ul><\/li><\/ul>/.test(api.mdRender('- a\n  - b')) && api.mdRender('```\n**x**\n```').includes('**x**'));
    ok('viewer: a path in the conversation becomes a viewer link', api.linkify('see /Users/me/p/a.md, ok').includes('data-p="/Users/me/p/a.md"'));
    ok('viewer: the diff marks added and removed lines', /class="da">\+x/.test(api.diffRender('@@ -1 +1 @@\n+x\n-y')) && /class="dd">-y/.test(api.diffRender('+x\n-y')));
    {
      // the numbers a comment names: the new file's, the old one's for a removed line
      const L = api.diffLines('diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -10,3 +20,4 @@ fn\n ctx\n-gone\n--dash\n+new\n+++plus\n ctx2');
      const by = (t) => L.find((l) => l.t === t) || {};
      ok('★ review: line numbers come from the @@ header; a removed line keeps its old number',
        by(' ctx').n === 20 && by('-gone').o === 11 && by('+new').n === 21 && by(' ctx2').n === 23 && by(' ctx2').o === 13);
      ok('★ review: inside a hunk, "--x" and "+++x" are content, not headers', by('--dash').k === 'dd' && by('--dash').o === 12 && by('+++plus').k === 'da' && by('+++plus').n === 22 && by('--- a/f').k === 'dh');
      const nw = api.diffLines('+a\n+b');
      ok('review: a new file (no header) starts at line 1', nw[0].n === 1 && nw[1].n === 2);
      const h = api.diffRender('@@ -1 +1 @@\n-y\n+x', true, 3);
      ok('★ review: lines under a file are clickable and carry where they are', /class="dl dd" data-fi="3" data-ln="o1"/.test(h) && /class="dl da" data-fi="3" data-ln="n1"/.test(h) && !/data-ln/.test(api.diffRender('@@ -1 +1 @@\n+x')));
      const m = api.reviewMessage([{ path: 'lib/a.js', ln: 'n12', code: '+  const x = `y`;', note: 'ここは let で' }, { path: 'b.md', ln: 'o3', code: '-old', note: '戻して\n理由も' }, { path: 'c', ln: 'n1', code: '+z', note: '  ' }]);
      // opened, drawn, and the comments sent down the panel's own road (api/reply)
      api.openChanges(card);
      window_changes(api, { agent: card.agent, session: card.id, roots: [{ root: '/Users/me/proj', branch: 'feat', since: 'origin/main' }], files: [{ path: '/Users/me/proj/a.js', root: '/Users/me/proj', git: true, diff: '@@ -1 +1 @@\n-a\n+b', added: 1, removed: 1 }] });
      api.noteHere();
      api.notesOf(card.agent + ':' + card.id).push({ abs: '/Users/me/proj/a.js', path: 'a.js', ln: 'n1', code: '+b', note: 'これで良い?' });
      api.sendNotes();
      const sent = api.fetched.find((f) => /api\/reply$/.test(f[0]));
      const sj = sent ? JSON.parse(sent[1].body) : {};
      ok('★ review: まとめて送る sends one reply to that session, with the comment in it',
        sj.type === 'reply' && sj.session === card.id && sj.agent === 'claude' && sj.text === '変更へのレビューコメントです。\n- a.js:1 `b` — これで良い?' && sj.dir === '/Users/me/proj');
      ok('★ review: the comments stay until the send is answered (a failed one is not lost)', api.notesOf(card.agent + ':' + card.id).length === 1);
      ok('★ review: the comments go as one message, a line each, a removed line said so, empty ones left out',
        m === "変更へのレビューコメントです。\n- lib/a.js:12 `const x = 'y';` — ここは let で\n- b.md:3(削除行) `old` — 戻して\n  理由も");
    }
  } catch (e) { ok(`viewer — ${e.message}`, false); }
  try {
    const v = (id) => { const x = api.modelVer(id); return x ? x.fam + ' ' + x.ver : null; };
    ok('★ model versions: opus 5.5, sonnet 5, haiku 4.5 (date stripped), fable 5.1, old claude-3-5-sonnet', v('claude-opus-5-5') === 'opus 5.5' && v('claude-sonnet-5') === 'sonnet 5' && v('claude-haiku-4-5-20251001') === 'haiku 4.5' && v('claude-fable-5-1') === 'fable 5.1' && v('claude-3-5-sonnet-20241022') === 'sonnet 3.5' && v('gpt-5.6-terra') === null);
  } catch (e) { ok(`modelVer — ${e.message}`, false); }
  try {
    // an alias's version is the newest seen: a CI job pinned to claude-sonnet-5 wrote last
    api.applyState({ cards: [{ agent: 'claude', id: 'fv1', column: 'idle', modelId: 'claude-sonnet-5-5', lastT: 1000 }, { agent: 'claude', id: 'fv2', column: 'idle', modelId: 'claude-sonnet-5', lastT: 2000 }, { agent: 'claude', id: 'fv3', column: 'idle', modelId: 'claude-opus-5-5', lastT: 3000 }] });
    const fv = api.famVersions();
    ok('★ model versions: the alias reads as the newest version seen (sonnet 5.5), not the latest session\'s (sonnet 5)', fv.sonnet === '5.5' && fv.opus === '5.5');
    api.applyState({ cards: [] });
  } catch (e) { ok(`famVersions — ${e.message}`, false); }
  try {
    api.applyState({ home: '/Users/me', cards: [] });
    const h = (c, above) => api.autoHue({ agent: 'claude', ...c }, above);
    ok('★ colours: each session its own — two in one folder are not one colour by rule', new Set([...Array(12)].map((_, i) => h({ id: 'same-folder-' + i, project: '/Users/me/work' }))).size > 3);
    ok('★ colours: never within 90° of the card above it', [...Array(40)].every((_, i) => { const up = (i * 30) % 360; return (a => Math.min(a, 360 - a))(Math.abs(h({ id: 'n' + i }, up) - up) % 360) >= 90; }));
    ok('colours: a session keeps its colour once picked', h({ id: 'keep' }, 0) === h({ id: 'keep' }, 180));
    ok('colours: twelve hues', [...Array(40)].every((_, i) => h({ id: 'id' + i }) % 30 === 0 && h({ id: 'id' + i }) < 360));
  } catch (e) { ok(`colours — ${e.message}`, false); }
  try {
    const h = api.mdRender('- **確かめたこと**: `/Users/me/p/a.md` を見た\n- <b>tag</b>');
    ok('★ answers as markdown: a list, bold, a quoted path that opens in the viewer, no tag let through',
      h.includes('<ul>') && h.includes('<b>確かめたこと</b>') && h.includes('data-p="/Users/me/p/a.md"') && !h.includes('<b>tag</b>'));
  } catch (e) { ok(`markdown answers — ${e.message}`, false); }
  try {
    const c = { agent: 'claude', id: 'x', title: 'マークダウン対応', project: '/Users/me/p/agentkanban', column: 'stale', lastT: Date.now() - 2 * 864e5 };
    const m = (q) => api.matchQuery(api.parseQuery(q), c);
    ok('★ filter: title: project: agent: is: before: after: narrow; words match in any form (NFD / full-width)',
      m('title:マークダウン') && !m('title:描画') && m('in:agentkanban') && m('agent:cl') && !m('agent:codex') && m('is:waiting') && !m('is:turn')
      && m('before:1d') && !m('after:1d') && m('after:3d') && m('\u30de\u30fc\u30af\u30bf\u3099\u30a6\u30f3') && m('ＡＧＥＮＴ'));
  } catch (e) { ok(`filter — ${e.message}`, false); }
  try {
    const c = { agent: 'claude', id: 'pinme', title: 'PRの試し', project: '/Users/me/p/agentkanban', column: 'stale', lastT: Date.now() };
    const d = { ...c, id: 'plain' };
    const m = (q, x) => api.matchQuery(api.parseQuery(q), x || c);
    api.prArrived({ agent: 'claude', session: 'pinme', status: { pr: { number: 42 } } });
    ok('★ filter: dir:, pr:42 / #42 (a PR the board has seen), and an unseen one matches nothing',
      m('dir:agentkanban') && !m('dir:other') && m('pr:42') && m('#42') && !m('#43') && !m('#42', d)
      && api.prNumOf(c) === 42);
  } catch (e) { ok(`filter pr — ${e.message}`, false); }
  try { api.openNew(); ok('openNew: the compose panel', true); }
  catch (e) { ok(`openNew — ${e.message}`, false); }
  try {
    api.render();
    api.openPendingAll();
    ok('openPendingAll: the 残作業 view', true);
  } catch (e) { ok(`openPendingAll — ${e.message}`, false); }
  try {
    api.renderHistory({ agent: 'claude', session: card.id, dropped: 3, turns: [
      { t: Date.now() - 60000, kind: 'user', text: 'やって' },
      { t: Date.now() - 50000, kind: 'tool', tool: 'Bash', text: 'ls' },
      { t: Date.now() - 40000, kind: 'error', text: 'failed' },
      { t: Date.now() - 30000, kind: 'assistant', text: 'やりました https://example.com/artifact/abc 続き' },
      { t: Date.now() - 20000, kind: 'assistant', text: '図はこちら', images: [{ url: 'file:///tmp/ak-img/x.png', mime: 'image/png' }] },
    ] });
    ok('renderHistory: a conversation with a folded tool run', true);
    { const h = api.mdRender('see https://a.example/[t](https://b.example/) and /Users/x/`a.md`');
      ok('★ markdown: a link next to a bare URL is not nested inside its href', !/href="[^"]*<a/.test(h) && !/title="[^"]*<a/.test(h)); }
  } catch (e) { ok(`renderHistory — ${e.message}`, false); }
  try {
    api.openDetail(card);
    const sig = api.cardSig(card);
    ok('cardSig: an unchanged card gives the same signature (no needless redraw)', sig === api.cardSig({ ...card }) && sig !== api.cardSig({ ...card, column: 'working' }));
    api.echoSent('送ったやつ', ['/tmp/a.png']);
    ok('echoSent: what you typed appears in the conversation at once', true);
    // a redraw before the transcript has it keeps it at the foot; once it has it, it is not drawn twice
    const kept = () => api.hist.children.filter((x) => x._echo && x._echo.text === '送ったやつ').length;
    const n0 = kept();
    api.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }] });
    const n1 = kept();
    api.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }, { kind: 'user', text: '送ったやつ', t: Date.now() }] });
    const n2 = kept();
    ok('★ echoSent: a history redraw before the transcript has it puts it back; after, it is not added again', n1 === n0 + 1 && n2 === n1 && api.sentEchoes.size === 0);
    {
      // a message with an attachment: the transcript's text is the words plus the path block, and it is still the same message
      api.echoSent('下の空白部分までスクロールできるのって微妙', ['/tmp/x.png']);
      const att = () => api.hist.children.filter((x) => x._echo && x._echo.text === '下の空白部分までスクロールできるのって微妙').length;
      const a0 = att();   // the stub keeps old children on a redraw, so what counts is that no second echo is drawn
      api.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }, { kind: 'user', text: '下の空白部分までスクロールできるのって微妙\n\n添付ファイル(このパスを読んでください):\n- /tmp/x.png', t: Date.now() + 1000 }] });
      ok('★ echoSent: a message with an attachment is not shown twice either (the transcript text carries the paths)', att() === a0 && !api.sentEchoes.size);
    }
    {
      // the transcript holding the words decomposed (で = て + U+3099) while the box had them composed: still the same message
      const typed = 'できるのって微妙', nfd = typed.normalize('NFD');
      api.echoSent(typed, []);
      const d0 = api.hist.children.filter((x) => x._echo && x._echo.text === typed).length;
      api.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }, { kind: 'user', text: nfd, t: Date.now() + 2000 }] });
      ok('★ echoSent: the transcript\'s decomposed (NFD) copy of the words matches the composed echo — no second copy stays under it',
        nfd !== typed && api.hist.children.filter((x) => x._echo && x._echo.text === typed).length === d0 && !api.sentEchoes.size);
    }
    {
      // a read is stamped with the card's lastT when it was asked for, not when it came back
      const key = card.agent + ':' + card.id;
      api.openDetail({ ...card, lastT: 5000 });
      api.histAsk.set(key, 3000);
      api.histPut({ agent: card.agent, session: card.id, turns: [] });
      const stamped = api.histCache.get(key).lastT;
      api.histAsk.set(key, 4000); api.histTouch({ agent: card.agent, session: card.id });
      ok('★ history cache: stamped with the lastT it was asked at (3000), not the card\'s now (5000), so a newer line is re-read; an unchanged answer refreshes the stamp',
        stamped === 3000 && api.histCache.get(key).lastT === 4000);
      api.histCache.delete(key); api.histAsk.delete(key);
    }
    {
      // typed into a terminal: no answer comes back, so the record is the proof — missing after 30 s it says so
      const f2 = runPage(), key = card.agent + ':' + card.id;
      f2.openDetail(card);
      f2.echoTyped('端末に打ったやつ');
      const e = f2.sentEchoes.get(key)[0];
      f2.timers.filter((t) => t.ms === 30000).forEach((t) => t.f());
      ok('★ echoTyped: still not in the record after 30 s it is marked as possibly undelivered, not left reading "端末に入力"', e.late === true && /届いていない/.test(e.who));
      f2.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }, { kind: 'user', text: '端末に打ったやつ', t: Date.now() + 1 }] });
      ok('… and once it is in the record the echo is gone', !f2.sentEchoes.has(key));
      const f3 = runPage();
      f3.openDetail(card); f3.echoTyped('すぐ届いたやつ');
      f3.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }, { kind: 'user', text: 'すぐ届いたやつ', t: Date.now() + 1 }] });
      f3.timers.filter((t) => t.ms === 30000).forEach((t) => t.f());
      ok('★ echoTyped: one that reached the record in time is never marked late', !f3.sentEchoes.has(key));
    }
    {
      // a held message that came back decomposed (NFD, through the app's arguments) is the same message as the line drawn at once
      const f4 = runPage(), k4 = { ...card, id: 'held-nfd', held: undefined }, text = 'できました。でも、ダメでした', t0 = Date.now();
      f4.applyState({ cards: [k4], agents: [], hours: 24, collisions: [] });
      f4.wfSend(k4, f4.document.querySelector('#mbody'), { text, own: 'x' });
      f4.applyState({ cards: [{ ...k4, held: [{ key: 'q1', text: text.normalize('NFD'), at: t0 + 50 }] }], agents: [], hours: 24, collisions: [] });
      ok('★ held: the queued message (decomposed) and the line drawn at once are one line, not two', f4.wfHeldOf(k4).length === 1 && text.normalize('NFD') !== text);
    }
    {
      // the 新規 panel is a form, not a view: it is never saved as the panel to reopen, and an older saved one is not reopened
      const f5 = runPage({ lastpanel: 'new' }), c5 = { ...card, id: 'restore-1' };
      f5.applyState({ cards: [c5], agents: [], hours: 24 });
      f5.openFirstPanel();
      ok('★ launch: a saved "new" is not reopened (the top card is, as when nothing was saved)', !f5.document.clicks.includes('#new'));
      const f6 = runPage({ lastpanel: 'claude:abc' });
      f6.applyState({ cards: [{ ...card, id: 'restore-2' }], agents: [], hours: 24 });
      f6.openFirstPanel();
      f6.toggleNew('test'); f6.syncPanelBtns();
      ok('★ launch: while the 新規 panel is open, it is not saved as the panel to come back to (what was saved stays)', f6.store.lastpanel === 'claude:abc');
    }
    api.echoSent('待っている間に送った', []);
    const w0 = api.hist.children.filter((x) => x._echo && x._echo.text === '待っている間に送った').length;
    api.renderHistory({ agent: card.agent, session: card.id, turns: [{ kind: 'assistant', text: '作業中', t: Date.now() }, { kind: 'user', waiting: true, text: '待っている間に送った', t: Date.now() + 5 }] });
    const w1 = api.hist.children.filter((x) => x._echo && x._echo.text === '待っている間に送った').length;
    ok('★ echoSent: a message the session holds (届け待ち) is not shown twice — the echo goes', w1 === w0 && !api.sentEchoes.size);
  } catch (e) { ok(`echoSent / cardSig — ${e.message}`, false); }
  try {
    api.openDetail({ ...card, column: 'working' });
    const t = Date.now();
    ok('★ thinkState: only a session that is actually working says so', (() => {
      const tool = api.thinkState([{ t, kind: 'tool', tool: 'Bash' }]);
      const asked = api.thinkState([{ t, kind: 'user', text: 'やって' }]);
      const done = api.thinkState([{ t, kind: 'assistant', text: 'やりました' }]);
      // a card waiting on you says nothing, even while its process is busy
      api.openDetail({ ...card, column: 'needs-you', alive: true, aliveStatus: 'busy' });
      const quiet = api.thinkState([{ t, kind: 'assistant', text: 'やりました' }]);
      const quietTool = api.thinkState([{ t, kind: 'tool', tool: 'Bash' }]);
      // but a turn of yours with no answer yet is 考え中 even in あなた待ち:
      // the transcript is seconds ahead of the lane
      const justSent = api.thinkState([{ t, kind: 'user', text: 'これやって' }]);
      api.openDetail({ ...card, column: 'approval', alive: true, aliveStatus: 'busy' });
      const perm = api.thinkState([{ t, kind: 'tool', tool: 'Bash' }]);
      return tool && /実行中 Bash/.test(tool.label) && asked && asked.label === '考え中'
        && done && done.label === '作業中' && quiet === null && quietTool === null
        && justSent && justSent.label === '考え中'
        && perm && /許可待ち Bash/.test(perm.label);
    })());
  } catch (e) { ok(`thinkState — ${e.message}`, false); }
  try {
    // 直前のみ keeps every instruction you gave; only the replies in between fold
    const last = runPage({ histview: 'last' });
    const t = Date.now();
    last.openDetail(card);
    last.renderHistory({ agent: 'claude', session: card.id, dropped: 0, turns: [
      { t: t - 9000, kind: 'user', text: 'ひとつ目' },
      { t: t - 8000, kind: 'assistant', text: 'できました' },
      { t: t - 7500, kind: 'tool', tool: 'Bash', text: 'ls' },
      { t: t - 7000, kind: 'user', text: 'ふたつ目' },
      { t: t - 6000, kind: 'assistant', text: 'これも' },
    ] });
    const h = last.hist.innerHTML;
    const outside = h.replace(/<details[\s\S]*?<\/details>/g, '');
    ok('★ 直前のみ: earlier instructions stay, their replies fold, the last exchange is open',
      /ひとつ目/.test(outside) && /ふたつ目/.test(outside) && /これも/.test(outside)
      && !/できました/.test(outside) && /返答 1件 · 実行1件/.test(h));
  } catch (e) { ok(`直前のみ — ${e.message}`, false); }
  try {
    // 直前3つ: the last three of your instructions open, the one before folded
    const l3 = runPage({ histview: 'last3' });
    const t = Date.now();
    const turns = [];
    for (let i = 1; i <= 4; i++) turns.push({ t: t - 10000 + i * 2000, kind: 'user', text: '指示' + i }, { t: t - 9000 + i * 2000, kind: 'assistant', text: '返答' + i });
    l3.openDetail(card);
    l3.renderHistory({ agent: 'claude', session: card.id, dropped: 0, turns });
    const h = l3.hist.innerHTML, outside = h.replace(/<details[\s\S]*?<\/details>/g, '');
    ok('★ 直前3つ: the last three exchanges are open, earlier instructions stay with their replies folded',
      ['指示1', '指示2', '指示3', '指示4', '返答2', '返答3', '返答4'].every((w) => outside.includes(w)) && !outside.includes('返答1'));
  } catch (e) { ok(`直前3つ — ${e.message}`, false); }
  try {
    // a 指示だけ saved by an older version reads as 全部 (the mode is gone: it hid the latest answer)
    const old = runPage({ histview: 'asks' });
    old.openDetail(card);
    old.renderHistory({ agent: 'claude', session: card.id, dropped: 0, turns: [{ t: Date.now() - 3000, kind: 'user', text: 'ひとつ目' }, { t: Date.now() - 2000, kind: 'assistant', text: '最後の返事' }] });
    ok('★ 指示だけ is gone: a saved one shows everything, and the panel has no such button',
      /最後の返事/.test(old.hist.innerHTML.replace(/<details[\s\S]*?<\/details>/g, '')) && !/data-v="asks"/.test(uiScript()) && !/>指示だけ</.test(uiScript()));
  } catch (e) { ok(`指示だけ廃止 — ${e.message}`, false); }
  try {
    // a parent with subagents at work and done, and one of them opened
    const kid = (id, column) => ({ ...card, id, parentId: card.id, subagent: true, column, title: 'task ' + id });
    api.applyState({ cards: [card, kid('agent-a1', 'working'), kid('agent-a2', 'idle')], agents: [], hours: 24, collisions: [] });
    api.openDetail({ ...card, usage: { ctx: 950000 } });
    api.openDetail(kid('agent-a1', 'working'));
    ok('★ openDetail: a parent with subagents, and a subagent with its way back', true);
  } catch (e) { ok(`openDetail subagents — ${e.message}`, false); }
  try {
    // the rows under a parent, its count and the lanes agree, whatever the kid's own column says
    const P = { agent: 'claude', id: 'p1', subagent: false, column: 'working' };
    const k = (id, run, column, parentId = 'p1') => ({ agent: 'claude', id, parentId, subagent: true, subRunning: run, column });
    const cs = [P, k('a', true, 'working'), k('b', false, 'idle'), k('c', true, 'working', 'gone'), k('d', false, 'working')];
    const plan = api.kidsPlan(cs);
    const under = (plan.kidRun.get('p1') || []).map((x) => x.id);
    ok('★ subagents: only the ones at work sit under the parent (the count is the rows)', JSON.stringify(under) === '["a"]');
    ok('★ subagents: a running one whose parent is not on the board is not nested (and not shown as a card)', !plan.nestedKid(cs[3]) && plan.nestedKid(cs[1]));
    // a finished one is its parent's result: folded under it (no card in Completed), counted apart from the running
    ok('★ subagents: a finished one folds into its parent as a result, whatever its column says', plan.nestedKid(cs[4]) && plan.nestedKid(cs[2])
      && JSON.stringify((plan.kidDone.get('p1') || []).map((x) => x.id)) === '["b","d"]');
  } catch (e) { ok(`kidsPlan — ${e.message}`, false); }
  try {
    // FLIP: nothing on the first render, nothing when nothing moved, a delta and a fade otherwise
    const at = (x, y) => ({ x, y });
    const same = new Map([['claude:a', at(0, 0)], ['claude:b', at(0, 80)]]);
    ok('★ motion: the first render does not animate', api.flipDeltas(null, same).length === 0 && api.flipDeltas(new Map(), same).length === 0);
    ok('★ motion: a refresh where nothing moved animates nothing', api.flipDeltas(same, new Map(same)).length === 0);
    const d = api.flipDeltas(same, new Map([['claude:a', at(300, 0)], ['claude:b', at(0, 80.5)], ['claude:c', at(0, 160)]]));
    ok('motion: a card that changed lane slides from where it was; a new one fades in; sub-pixel jitter is ignored',
      d.length === 2 && d.find((x) => x.k === 'claude:a').dx === -300 && d.find((x) => x.k === 'claude:c').fresh === true);
  } catch (e) { ok(`flipDeltas — ${e.message}`, false); }
  try {
    const src = uiScript();
    // stuck states: every set has its way back
    ok('★ stuck: a refused permission answer still reaches the askbox (its buttons came back disabled for good)', /if\(r\.op==='perm'\)\{const f=permSaid;permSaid=null;if\(f\)f\(r\)\}\n\s*setTimeout\(load,500\);return\}/.test(src));
    ok('★ stuck: the filter\'s busy look ends even when no answer comes', /searchWd=setTimeout\(\(\)=>\$\('#q'\)\.classList\.remove\('busy'\),30000\)/.test(src));
    ok('stuck: .worktreeinclude button is re-enabled when its request fails', /catch\(\(\)=>\{const b=\$\('#nwtinc'\);if\(b\)b\.disabled=false\}\)/.test(src));
    ok('stuck: no blocking alert()/confirm() in the page', !/\balert\(|\bconfirm\(/.test(src.replace(/\/\/[^\n]*/g, '')));
    // focus
    ok('★ focus: closing the panel from inside it puts focus on its card, not <body>', /if\(inside\|\|!document\.activeElement\|\|document\.activeElement===document\.body\)focusHome\(was\)/.test(src));
    ok('★ focus: Esc closes the help sheet before the panel under it', src.indexOf("if(!$('#help').hidden){$('#help').hidden=true;return}") < src.indexOf("if(!$('#detail').hidden){closeDetail('esc');return}"));
    ok('focus: a palette action that focuses nothing gives focus back', /x\.a\.run\(\);setTimeout\(\(\)=>\{const a=document\.activeElement;if\(!a\|\|a===document\.body\)/.test(src));
  } catch (e) { ok(`stuck/focus — ${e.message}`, false); }
  try {
    const t = api.qerrText({ queuedFails: 5, queuedError: 'claude が受け付けませんでした: Workspace not trusted. The home directory is trusted one session at a time' });
    ok('★ a held message says in Japanese why it did not go and what to do (home-directory trust)', /ホームフォルダ/.test(t) && /端末で開けば/.test(t) && !/Workspace not trusted/.test(t) && /5回/.test(t));
  } catch (e) { ok(`qerrText — ${e.message}`, false); }
  try {
    api.notifyBar({ status: 'denied' }); api.notifyBar({ status: 'ask' }); api.notifyBar({ status: 'on' });
    ok('★ notifications: the bar draws for off / not yet asked / on without throwing', true);
    ok('notifications: the bar asks macOS first, then points at System Settings', /通知を許可する/.test(uiScript()) && /システム設定を開く/.test(uiScript()));
  } catch (e) { ok(`notifyBar — ${e.message}`, false); }
  try { api.applyTheme(true); api.applyTheme(false); ok('applyTheme: light and back', true); }
  catch (e) { ok(`applyTheme — ${e.message}`, false); }
}

console.log('== every button is also a command ==');
{
  const a = runPage();
  const P = a.PAL_ACTIONS;
  const names = P.map((x) => x.t);
  const want = ['ターミナルを表示', 'ターミナルを隠す', 'ターミナルを左右に分割', 'ターミナルを消去 (clear)', 'ターミナルの区画を閉じる', '表示する時間を広げる',
    '完了を取り消す', '親セッションへ', 'セッションIDをコピー', '表示: 全部', '許可する', '拒否する', 'ファイルを添付',
    '複製して送る を切り替え(この会話を複製した別のセッションに送る)', 'モデル: opus', '--worktree を切り替え', '.worktreeinclude に足す', 'PR: マージして片付け…', 'レビューコメントをまとめて送る'];
  const miss = want.filter((w) => !names.includes(w));
  ok('★ palette: the screen\'s buttons are commands too' + (miss.length ? ' — missing ' + miss.join(', ') : ''), !miss.length);
  ok('palette: no two entries share a name', new Set(names).size === names.length);
  let threw = null;
  for (const x of P) { try { if (!x.when || x.when()) x.run(); } catch (e) { threw = x.t + ': ' + e.message; break; } }
  ok('★ palette: every entry the palette would offer runs without throwing' + (threw ? ' — ' + threw : ''), !threw);
  const clickOf = (t) => { a.clicks.length = 0; P.find((x) => x.t === t).run(); return a.clicks.slice(); };
  ok('★ palette: an entry presses the button itself (許可 → .askyes, 添付 → +file)',
    clickOf('許可する').includes('#mhist .askbox.held .askyes') && clickOf('ファイルを添付').includes('#mbody .attbtn'));
  // the two-press ones: the palette arms, it never finishes
  const armed = clickOf('PR: マージして片付け…');
  ok('★ palette: マージして片付け only arms (one press), and an armed one is not pressed again', armed.length === 1 && /palArm\(sel\)\{return \(\)=>\{const b=\$\(sel\);if\(!b\|\|b\.disabled\)return;if\(!b\.classList\.contains\('arm'\)\)b\.click\(\)/.test(uiScript()));
  try {
    const c2 = { ...card, humanTurns: 12, toolCalls: 340, firstT: Date.now() - 3 * 3600000, permMode: 'acceptEdits', alive: true, aliveKind: 'background' };
    const before = api.moreChips(c2).length;
    for (const k of ['turns', 'tools', 'age', 'perm', 'where']) api.setCardShow(k, true);
    const on = api.moreChips(c2).join('|');
    for (const k of ['turns', 'tools', 'age', 'perm', 'where']) api.setCardShow(k, false);
    ok('★ カード項目: five more items (回数, ツール, 経過, 許可のモード, 場所) are off until chosen, then show on the card',
      before === 0 && /12往復/.test(on) && /ツール 340/.test(on) && /前から/.test(on) && /編集は自動/.test(on) && /裏で実行/.test(on) && api.moreChips(c2).length === 0);
  } catch (e) { ok(`カード項目 — ${e.message}`, false); }
  try {
    api.copyId({ ...card, id: 'abc-123' });
    ok('★ コピー: the copy button says so in a notice at the bottom of the window (not the panel line a live terminal hides)', /function flash\(/.test(uiScript()) && /flash\((?:t\()?'セッションIDをコピーしました'\)/.test(uiScript()) && /#flash\{position:fixed/.test(require('../lib/page.js').style ? require('../lib/page.js').style() : fs.readFileSync(path.join(__dirname, '../lib/ui/css/50-misc.css'), 'utf8')));
  } catch (e) { ok(`コピー通知 — ${e.message}`, false); }
  try {
    const c3 = { ...card, activeMs: 95 * 60000 };
    const before = api.moreChips(c3).length;
    api.setCardShow('worked', true);
    const on = api.moreChips(c3).join('|');
    api.setCardShow('worked', false);
    ok('★ カード項目: 稼働時間 is off until chosen, then shows the time it actually worked', before === 0 && /稼働 1時間35分/.test(on));
  } catch (e) { ok(`カード項目 稼働 — ${e.message}`, false); }
  try {
    ok('★ 会話: a redrawn panel keeps the mark of what its thread was drawn from, so a stale 作業中 line is still compared with the state and redrawn (it stayed up for good after a card moved to Your Turn)',
      /h\.dataset\.vsig=prev\.vsig/.test(uiScript()) && /vsig:h0\?h0\.dataset\.vsig/.test(uiScript()));
  } catch (e) { ok(`会話 vsig — ${e.message}`, false); }
  try {
    ok('★ 端末: after a relaunch a codex / agy terminal comes back as itself, so a message for its session is typed into it rather than sent as a second writer (codex refused those)',
      /\['shell','attach','resume','codex','agy'\]\.includes\(m\.kind\)/.test(uiScript()));
  } catch (e) { ok(`端末 codex restore — ${e.message}`, false); }
  try {
    ok('★ 端末に入力: typed while the session works, the words are not called lost — they wait for the turn to end (it was marked 届いていないかもしれません and arrived two minutes later)',
      /作業の区切りで届きます/.test(uiScript()) && /c\.column==='working'\|\|\(c\.alive&&c\.aliveStatus==='busy'\)\)&&Date\.now\(\)-e\.at<ECHO_KEEP_MS/.test(uiScript()));
  } catch (e) { ok(`端末に入力 busy — ${e.message}`, false); }
  try {
    ok('★ ターミナルUI / 会話UI: the switch shows the key that flips it (⌘\\), refilled when the key is changed',
      /<button id="pvtalk" data-p="talk">会話UI<span class="kk pvkk" aria-hidden="true"><\/span><\/button>/.test(require('../lib/page.js').build()) && /button\.on \.pvkk\{display:none\}/.test(require('../lib/page.js').build()) && /querySelectorAll\('\.pvkk'\)\)el\.textContent=kmL\('viewswap\.meta'\)/.test(uiScript()));
  } catch (e) { ok(`pviewseg key — ${e.message}`, false); }
  try {
    // a codex terminal restored as a plain shell by an older build: leaving its card sent it to the strip on the right
    const p = { kind: 'shell', full: 'cx-term', gone: false, started: false, el: { title: '' }, session: '', label: 'x', host: true };
    api.applyState({ cards: [{ ...card, agent: 'codex', id: 'cx-term', model: 'gpt-5.5' }], agents: [], hours: 24, collisions: [] });
    api.ptyFixKind(p);
    ok('★ 端末: a codex terminal taken for a shell is known as codex again (so leaving its card parks it, not opens the strip on the right)',
      p.kind === 'codex' && /taken for a shell, a codex terminal was sent to the strip/.test(uiScript()));
  } catch (e) { ok(`端末 fix kind — ${e.message}`, false); }
  try {
    ok('★ ターミナル: ↓ past the last card does not unfold a folded strip (only ⌘J / the button / ⌘→ do), and every unfolding is logged with its caller',
      /if\(!unfold&&document\.body\.classList\.contains\('termclosed'\)\)return false;/.test(uiScript()) && /goTerminal\(true,true\)/.test(uiScript()) && /terminal strip opened by: /.test(uiScript()));
  } catch (e) { ok(`terminal unfold — ${e.message}`, false); }
  try {
    ok('★ 今の作業後に送る の書き直し: Enter saves (⇧Enter is a new line), Esc gives up — both shown on the buttons',
      /e\.key==='Enter'&&!e\.isComposing&&e\.keyCode!==229&&!e\.shiftKey&&!e\.altKey\)\{[^]*?\.hsave'\)\.click\(\)/.test(uiScript()) && /保存(?:'\))?(?:\+')? <span class=\\?"kk\\?">⏎/.test(uiScript()));
  } catch (e) { ok(`held edit enter — ${e.message}`, false); }
  try {
    ok('★ ターミナル: leaving a card puts its shell back in the strip without unfolding it, and a pane ending does not unfold a folded strip (the log showed ptyToStrip < panelTermRelease < openDetail)',
      /ptyToStrip\(p,true\);/.test(uiScript()) && /focusFree\(null\)&&!document\.body\.classList\.contains\('termclosed'\)\)ptyShow/.test(uiScript()));
  } catch (e) { ok(`strip quiet — ${e.message}`, false); }
  try {
    const lines = ['Select model', '  1. Default (recommended)  Opus 5.5', '❯ 2. Sonnet', '  3. Haiku', 'Enter to confirm · Esc to exit'];
    const o = api.dlgParse(lines);
    const c = { ...card, agent: 'claude', id: 'dlg-1', alive: true, aliveKind: 'background', aliveStatus: 'waiting', aliveWaitingFor: 'dialog open' };
    api.dlgSeen.set('dlg-1', { at: Date.now(), lines, opts: o, pty: 'p1' });
    const h = api.askHtml(c);
    ok('★ ダイアログ: what a dialog in the terminal says, and its numbered choices, are shown as buttons (it only said 端末でダイアログが開いたままです)',
      o.length === 3 && o[1].n === '2' && o[1].label === 'Sonnet' && /class="askbox dlg"/.test(h) && /data-key="2"[^>]*>2\. Sonnet</.test(h) && /Esc で閉じる/.test(h) && /Select model/.test(h));
    api.dlgSeen.delete('dlg-1');
    ok('ダイアログ: not read (yet), the old notice stays', /ターミナルで閉じる|ダイアログが開いたまま/.test(api.askHtml(c)) && !/askbox dlg/.test(api.askHtml(c)));
  } catch (e) { ok(`dialog read — ${e.message}`, false); }
  try {
    // a permission prompt no hook held (the board was behind when it came): the terminal's own choices, typed there
    const lines = ['Bash command', '  rm -rf build', 'Do you want to proceed?', '❯ 1. Yes', "  2. Yes, and don't ask again for rm commands in /p", '  3. No, and tell Claude what to do differently (esc)'];
    const c = { ...card, agent: 'claude', id: 'perm-t', column: 'approval', alive: true, aliveKind: 'background', aliveStatus: 'waiting', aliveWaitingFor: 'permission prompt', asking: { tool: 'Bash', what: 'rm -rf build' } };
    api.dlgSeen.set('perm-t', { at: Date.now(), lines, opts: api.dlgParse(lines), pty: 'p1' });
    const h = api.askHtml(c);
    ok('★ 許可: a prompt the hook did not hold still gets はい / いいえ, read off its terminal (each its number typed there)',
      /class="askbox dlg"/.test(h) && /data-key="1"[^>]*>はい</.test(h) && /data-key="2"[^>]*>はい、今後は聞かない/.test(h) && /data-key="3"[^>]*>いいえ</.test(h));
    api.dlgSeen.delete('perm-t');
    ok('許可: not read yet, it says to answer in the terminal as before', !/askbox dlg/.test(api.askHtml(c)) && /許可を待っています/.test(api.askHtml(c)));
  } catch (e) { ok(`perm read — ${e.message}`, false); }
  try {
    // the panel holds an older refresh's copy of the card; 待ちにする moved nothing until the next read
    api.applyState({ cards: [{ ...card, id: 'park-1', column: 'answered' }], agents: [], hours: 24, collisions: [] });
    const old = { ...card, id: 'park-1', column: 'answered' };
    api.laneLocalSet(old, 'park');
    const now = api.live().cards.find((x) => x.id === 'park-1');
    api.applyState({ cards: [{ ...card, id: 'park-1', column: 'answered' }], agents: [], hours: 24, collisions: [] });
    const after = api.live().cards.find((x) => x.id === 'park-1');
    ok('★ 待ちにする: the card the board shows moves at once (not the panel\'s older copy), and a refresh read before the record was written does not move it back',
      now.column === 'stale' && after.column === 'stale' && !!after.parked);
    api.applyState({ cards: [{ ...card, id: 'park-1', column: 'stale', parked: { at: 1 } }], agents: [], hours: 24, collisions: [] });
    api.applyState({ cards: [{ ...card, id: 'park-1', column: 'answered' }], agents: [], hours: 24, collisions: [] });
    ok('待ちにする: once the state agrees, the board follows the state again', api.live().cards.find((x) => x.id === 'park-1').column === 'answered');
  } catch (e) { ok(`lane local — ${e.message}`, false); }
  try {
    ok('★ 画像: a file sent to a session open in this app\'s terminal goes in there with its path (codex refused it as a second writer), and ⌘V of an image in a terminal saves it and types its path',
      /const withFiles=files\.length\?wrapped\+/.test(uiScript()) && /viaTerm\(fin=>panelTypeMsg\(c,withFiles,fin\),withFiles,unreply\)/.test(uiScript())
      && /ptyAttachWait\.set\(token,p\.id\)/.test(uiScript()) && /q\.xt\.paste\(r\.path\+' '\)/.test(uiScript()));
  } catch (e) { ok(`image paste — ${e.message}`, false); }
  try {
    const mk = (id, lastT) => ({ ...card, id, column: 'answered', reason: 'the agent finished its turn', lastT });
    api.applyState({ cards: [mk('yo-a', 1000), mk('yo-b', 3000), mk('yo-c', 2000)], agents: [], hours: 24, collisions: [] });
    api.yourOrderSet('old'); const o1 = api.yourSorted().map((c) => c.id).join();
    api.yourOrderSet('new'); const o2 = api.yourSorted().map((c) => c.id).join();
    api.applyState({ cards: [mk('yo-a', 1000), { ...mk('yo-r', 500), column: 'needs-you', reason: 'waiting for your reply (claude agents)' }, { ...mk('yo-p', 4000), column: 'approval', reason: 'waiting for permission: Bash' }, mk('yo-b', 3000)], agents: [], hours: 24, collisions: [] });
    api.yourOrderSet('new'); const o3 = api.yourSorted().map((c) => c.id).join();
    ok('★ Your Turn: a session idle at its prompt ("waiting for your reply") sorts with the answers; only a permission or question stays on top', o3 === 'yo-p,yo-b,yo-a,yo-r');
    api.yourOrderSet('old');
    ok('★ Your Turn: the order can be flipped — oldest first (default) or newest first — and is kept', o1 === 'yo-a,yo-c,yo-b' && o2 === 'yo-b,yo-c,yo-a' && api.store.yourorder === 'old');
  } catch (e) { ok(`your order — ${e.message}`, false); }
  try {
    api.applyState({ cards: [], agents: [], hours: 24, collisions: [], efforts: { claude: 'high', codex: 'low', claudeModels: { 'claude-opus-5-5': 'medium' } } });
    ok('★ 深さ 既定: the depth a session gets when none is picked — the setting for its model, else the general one',
      api.effortDefault('claude', 'claude-opus-5-5[1m]') === 'medium' && api.effortDefault('claude', 'opus') === 'medium' && api.effortDefault('claude', 'claude-sonnet-5-5') === 'high'
      && api.effortDefault('codex', 'gpt-6-sol') === 'low' && /'深さ 既定'\)?\+\(+effortDefault\(c\.agent/.test(uiScript()));
  } catch (e) { ok(`effort default — ${e.message}`, false); }
  try {
    const cx = { ...card, agent: 'codex', id: 'cx-wf', alive: false };
    api.applyState({ cards: [{ ...cx, column: 'working' }], agents: [], hours: 24, collisions: [] });
    const busy = api.wfBusy(cx);
    api.applyState({ cards: [{ ...cx, column: 'answered' }], agents: [], hours: 24, collisions: [] });
    ok('★ 今の作業後に送る on codex: mid-turn it is busy (held), its turn over it is not (codex has no `claude agents`), and the board holds it too',
      busy === true && api.wfBusy(cx) === false && /c\.agent === 'codex' && !c\.subagent && c\.column === 'working'/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'board', 'state.js'), 'utf8')));
  } catch (e) { ok(`codex whenfree — ${e.message}`, false); }
  try {
    ok('★ 送信: every send says in the app log which way it went, a background send is checked against the record after 2 minutes like a typed one, and a message still missing is logged',
      /sendLog\(c,'typed'/.test(uiScript()) && /sendLog\(c,'held'/.test(uiScript()) && /sendLog\(c,wf&&!slash\?/.test(uiScript())
      && /setTimeout\(\(\)=>echoLate\(k,e\),ECHO_SENT_LATE_MS\)/.test(uiScript()) && /not in the record after sending: /.test(uiScript()) && /if\(c&&c\.queued&&Date\.now\(\)-e\.at<ECHO_KEEP_MS\)/.test(uiScript()));
  } catch (e) { ok(`send log — ${e.message}`, false); }
  try {
    // typed with an image: Claude Code records "[Image #1] <the words> 添付ファイル…:\n-" (the path became the image)
    const k = card.agent + ':' + card.id, at = Date.now() - 5000;
    api.sentEchoes.set(k, [{ text: 'こうしてみた\n\n添付ファイル(このパスを読んでください):\n- /Users/x/.rally/attachments/a.png', at, who: '端末に入力' }]);
    const el = { children: [], appendChild(x) { this.children.push(x); } };
    api.echoRestore(el, { agent: card.agent, session: card.id, turns: [{ kind: 'user', t: at + 1000, text: '[Image #1]\n\nこうしてみた\n\n添付ファイル(このパスを読んでください):\n-' }] });
    ok('★ 送信: a message typed with an image counts as delivered when Claude Code turned the path into the image (it read 届いていないかもしれません)', !api.sentEchoes.has(k) && el.children.length === 0);
  } catch (e) { ok(`echo image — ${e.message}`, false); }
  try {
    ok('★ カード: a press on a card holds the list still until release (a redraw between mouse-down and mouse-up swallowed the click, so the panel did not switch), released on mouseup / dragend / blur',
      /if\(boardPress\)\{renderHeld=true;return\}/.test(uiScript()) && /addEventListener\('dragend',boardRelease,true\)/.test(uiScript()) && /closest\('section\.col \.card'\)\)boardPress=true/.test(uiScript()));
  } catch (e) { ok(`board press — ${e.message}`, false); }
  try {
    const src = '学び放題\n• hodai（Sonnet 5）\n• hodai-related（Sonnet 5）';
    const chat = api.mdRender(src, { breaks: true }), file = api.mdRender(src);
    ok('★ 会話: an answer\'s line breaks stay as the terminal shows them (lines written with • ran together); a file in the viewer keeps Markdown\'s rule',
      (chat.match(/<br>/g) || []).length === 2 && !/<br>/.test(file));
  } catch (e) { ok(`md breaks — ${e.message}`, false); }
  try {
    const scr = (lines) => ({ xt: { rows: lines.length, buffer: { active: { baseY: 0, length: lines.length, getLine: (i) => ({ translateToString: () => lines[i] }) } } } });
    const t = 'これ今週めっちゃ高くなってない？調査できるもの？\n\n添付ファイル(このパスを読んでください):\n- /x.png';
    const left = scr(['> 前の指示', '─'.repeat(40), '> [Image #1] これ今週めっちゃ高くなってない？調査できるもの？', '─'.repeat(40), '  ? for shortcuts']);
    const sent = scr(['> [Image #1] これ今週めっちゃ高くなってない？調査できるもの？', '⏺ 調べます', '─'.repeat(40), '> ', '─'.repeat(40)]);
    ok('★ 端末に入力: words still in the input box after the Enter are seen (Enter lost while an image path was turned into the image), words already sent are not',
      api.ptyInputHas(left, t) === true && api.ptyInputHas(sent, t) === false);
  } catch (e) { ok(`input has — ${e.message}`, false); }
  try {
    ok('★ 端末に入力: while the words stay in the input box, Enter is pressed again up to 4 times with growing waits, then you are told',
      /const PTY_ENTER_RETRY=\[1500,3000,5000,8000\]/.test(uiScript()) && /if\(q\.gone\|\|!ptyInputHas\(q,text\)\)return;/.test(uiScript()) && /ターミナルの入力欄に文が残っています/.test(uiScript()));
  } catch (e) { ok(`enter retry — ${e.message}`, false); }
  try {
    let top = '';
    try { api.openDetail({ ...card, agent: 'claude', id: 'eff-1' }); top = api.body().innerHTML; } catch (e) { ok(`effort pick — ${e.message}`, false); }
    ok('★ 考える深さ: the send row has a 深さ pulldown with /effort\'s five levels (claude), and picking one sends /effort <level>',
      /id="meffort"/.test(top) && (((top.match(/class="modemenu effortmenu"[^]*?<\/div><\/span>/) || [''])[0]).match(/data-e="(low|medium|high|xhigh|max)"/g) || []).length === 5 && /const v=x\.dataset\.e,cmd='\/effort '\+v;/.test(uiScript()));
  } catch (e) { ok(`effort pick — ${e.message}`, false); }
  try {
    let top = '';
    try { api.openDetail({ ...card, agent: 'claude', id: 'guide-1' }); top = api.body().innerHTML; } catch (e) { ok(`guide — ${e.message}`, false); }
    ok('★ 選び方: each model and 深さ choice says when to use it (普段使いのおすすめ, 大きな実装…), and 新規 has presets that set both',
      /普段使いのおすすめ/.test(top) && /大きな実装・長く任せる作業/.test(top) && /id="nrecipe"/.test(uiScript()) && /\['大量に安く','haiku','high'/.test(uiScript()) && /pick\(ebox,'e',r\.dataset\.e\)/.test(uiScript()));
  } catch (e) { ok(`guide — ${e.message}`, false); }
  try {
    const pg = require('../lib/page.js').build();
    ok('★ 設定: a ⚙ in the header opens キーバインドの設定 / カード項目 / ライト・ダーク / ショートカット一覧 (キーバインド sat only in the macOS menu bar, hidden in full screen)',
      /id="setbtn"/.test(pg) && /data-s="keys"/.test(pg) && /if\(s==='keys'\)togglePanel\('keys',openKeys\)/.test(uiScript()) && /\.modemenu\.setmenu\{position:fixed/.test(pg));
  } catch (e) { ok(`settings — ${e.message}`, false); }
  try {
    let top = '';
    try { api.openDetail({ ...card, agent: 'claude', id: 'rec-1' }); top = api.body().innerHTML; } catch (e) { ok(`recipe pick — ${e.message}`, false); }
    ok('★ おすすめ: right under the message box, left of the model, a pulldown picks model and 深さ by situation (速く安く = haiku・low among them)',
      /id="mrecipe"/.test(top) && top.indexOf('id="mrecipe"') < top.indexOf('class="mini tflag mmodel"') && /data-m="haiku" data-e="high"/.test(top) && (top.match(/class="modemenu recipemenu"[^]*?<\/div><\/span>/)[0].match(/role="menuitem"/g) || []).length === 5);
  } catch (e) { ok(`recipe pick — ${e.message}`, false); }
  try {
    let top = '';
    try { api.openDetail({ ...card, agent: 'claude', id: 'rec-2' }); top = api.body().innerHTML; } catch (e) { ok(`recipe marks — ${e.message}`, false); }
    ok('★ おすすめ: 精度 and 費用 as bars — 費用 to scale with the API price (fable full, opus 40%, haiku 1%→2% floor), the unit price beside it',
      /rfc" style="width:100%"/.test(top) && /rfc" style="width:40%"/.test(top) && /rfc" style="width:2%"/.test(top) && /\$4 \/ \$20/.test(top));
  } catch (e) { ok(`recipe marks — ${e.message}`, false); }
  try {
    let top = '';
    try { api.openDetail({ ...card, agent: 'claude', id: 'cost-1' }); top = api.body().innerHTML; } catch (e) { ok(`unit price — ${e.message}`, false); }
    ok('★ おすすめ: 費用 also as the API unit price per million tokens (opus $4 / $20, haiku $0.1 / $0.5)', /\$4 \/ \$20/.test(top) && /\$0\.1 \/ \$0\.5/.test(top));
  } catch (e) { ok(`unit price — ${e.message}`, false); }
  try {
    ok('★ ⌘K: what was said in the sessions is searched too once typing pauses (runawake was only in the conversation, not a title), shown as 会話の中 with the snippet, after exact title matches',
      /pal\.ct=setTimeout\(\(\)=>palConvo\(cq\),350\)/.test(uiScript()) && /tag:(?:t\(')?会話の中'\)?,sub:sn/.test(uiScript()) && /if\(typeof pal!=='undefined'&&pal&&j&&pal\.cq===j\.q\)/.test(uiScript()));
  } catch (e) { ok(`palette convo — ${e.message}`, false); }
  try {
    let top = '';
    try { api.openDetail({ ...card, agent: 'claude', id: 'rec-order' }); top = api.body().innerHTML; } catch (e) { ok(`recipe order — ${e.message}`, false); }
    const order = [...((top.match(/class="modemenu recipemenu"[^]*?<\/div><\/span>/) || [''])[0]).matchAll(/data-m="(\w+)" data-e="(\w+)"/g)].map((m) => m[1] + '・' + m[2]).join(',');
    ok('★ おすすめ: listed by 精度, highest first', order === 'fable・high,opus・xhigh,opus・medium,sonnet・medium,haiku・high');
  } catch (e) { ok(`recipe order — ${e.message}`, false); }
  try {
    api.applyState({ cards: [{ ...card, agent: 'codex', id: 'cx-rec', model: 'gpt-6.1-sol' }], agents: [], hours: 24, collisions: [],
      models: { codex: [{ v: 'gpt-6.1-sol', l: 'GPT-6.1-Sol', d: 'workhorse' }, { v: 'gpt-6-astra', l: 'GPT-6-Astra', d: 'frontier' }, { v: 'gpt-6-luna', l: 'GPT-6-Luna', d: 'fast' }] } });
    let top = '';
    try { api.openDetail({ ...card, agent: 'codex', id: 'cx-rec', model: 'gpt-6.1-sol' }); top = api.body().innerHTML; } catch (e) { ok(`codex recipes — ${e.message}`, false); }
    const menu = (top.match(/class="modemenu recipemenu"[^]*?<\/div><\/span>/) || [''])[0];
    const eff = (top.match(/class="modemenu effortmenu"[^]*?<\/div><\/span>/) || [''])[0];
    ok('★ codex: おすすめ by its own models (astra / sol / luna) and 深さ with codex\'s levels (ultra too); 費用 from OpenAI\'s published prices (astra $10/$50, 6.1-sol $2/$10 → 20%, luna $0.1/$0.5)',
      /data-m="gpt-6-astra" data-e="high"/.test(menu) && /data-m="gpt-6\.1-sol" data-e="xhigh"/.test(menu) && /data-m="gpt-6-luna" data-e="high"/.test(menu)
      && /data-e="ultra"/.test(eff) && /\$10 \/ \$50/.test(menu) && /\$0\.1 \/ \$0\.5/.test(menu) && /rfc" style="width:20%"/.test(menu) && !/data-m="opus"/.test(menu));
  } catch (e) { ok(`codex recipes — ${e.message}`, false); }
  try {
    const long = 'a'.repeat(40);
    const g = (o) => api.moreChips({ ...card, usage: { ...(card.usage || {}), goal: { text: long, n: 3, reason: 'まだ足りない', since: 't', met: false, ...o } } }).join('|');
    const on = g({}), met = g({ met: true });
    ok('★ カード項目: an active /goal shows on the card by default — shortened, with the condition, count and reason in the tooltip; met is marked; none shows nothing',
      /◎ a{18}…/.test(on) && /3 回判定済み/.test(on) && /まだ足りない/.test(on) && new RegExp('title="[^"]*' + long).test(on) && /達成/.test(met) && !/◎/.test(api.moreChips(card).join('|')));
  } catch (e) { ok(`カード項目 goal — ${e.message}`, false); }
  try {
    const n = Date.now();
    const lab = (ms, over) => api.etaLabel({ at: n + ms, over: !!over });
    ok('★ eta: a wide usual range is shown as a range (あと約2〜15分), a narrow one or a short one as the one number',
      api.etaLabel({ at: n + 13 * 60e3, lo: n + 2 * 60e3, hi: n + 16 * 60e3 }) === '⏱ あと約2〜15分'
      && /あと約7分/.test(api.etaLabel({ at: n + 7 * 60e3, lo: n + 5 * 60e3, hi: n + 9 * 60e3 }))
      && /あと約3分/.test(api.etaLabel({ at: n + 3 * 60e3, lo: n + 60e3, hi: n + 4 * 60e3 }))
      && /長引いています/.test(api.etaLabel({ at: n + 9 * 60e3, lo: n + 60e3, hi: n + 40 * 60e3, over: true })));
    ok('★ 完了までの目安: whole minutes (about N), hours past an hour; over-time says it is running long; under half a minute is まもなく',
      /あと約4分/.test(lab(200e3)) && /あと約15分/.test(lab(15 * 60e3)) && /あと約1時間30分/.test(lab(90 * 60e3)) && /長引いています/.test(lab(120e3, true)) && /まもなく/.test(lab(20e3)) && /まもなく/.test(lab(-1000)));
    const cs = [{ agent: 'claude', id: 'z1', eta: { at: n + 600e3, over: false, basis: 'session', n: 9 } }];
    api.etaSettle(cs);
    const first = cs[0].eta.at;
    const cs2 = [{ agent: 'claude', id: 'z1', eta: { at: n + 640e3, over: false, basis: 'session', n: 9 } }];
    api.etaSettle(cs2);
    const cs3 = [{ agent: 'claude', id: 'z1', eta: { at: n + 1500e3, over: false, basis: 'session', n: 9 } }];
    api.etaSettle(cs3);
    ok('★ 完了までの目安: a new estimate within a quarter of the one shown keeps the shown time; a real change replaces it',
      cs2[0].eta.at === first && cs3[0].eta.at === n + 1500e3);
    {
      // lo/hi used to refresh on their own even while at was held: the usual range could flip wide/narrow
      // (あと約3〜20分 ⇄ あと約12分) with nothing really changing. They are pinned together with at now.
      const a1 = [{ agent: 'claude', id: 'z2', eta: { at: n + 720e3, lo: n + 120e3, hi: n + 1200e3, over: false, basis: 'session', n: 9 } }];
      api.etaSettle(a1);
      const label1 = api.etaLabel(a1[0].eta);
      const a2 = [{ agent: 'claude', id: 'z2', eta: { at: n + 700e3, lo: n + 600e3, hi: n + 900e3, over: false, basis: 'session', n: 9 } }];
      api.etaSettle(a2);
      ok('★ 完了までの目安: lo/hi are pinned with at, so a held estimate does not flip between a range and one number on its own',
        /あと約2〜20分/.test(label1) && a2[0].eta.lo === a1[0].eta.lo && a2[0].eta.hi === a1[0].eta.hi && /あと約2〜20分/.test(api.etaLabel(a2[0].eta)));
    }
    const chip = api.etaChip({ eta: { at: n + 300e3, lo: n + 120e3, hi: n + 1200e3, over: false, basis: 'project', n: 7 } });
    ok('★ 完了までの目安: the chip carries its time for the ticking timer, the usual range, what it was made from and how rough it is', /data-at="/.test(chip) && /同じフォルダの過去7回/.test(chip) && /たいていは 2分 〜 20分/.test(chip) && /3.5割ほど/.test(chip) && api.etaChip({}) === '');
  } catch (e) { ok(`完了までの目安 — ${e.message}`, false); }
  try {
    const chip = api.etaTaskChip({ ms: 4 * 60e3, lo: 2 * 60e3, hi: 9 * 60e3, basis: 'session', n: 12 });
    ok('★ 想定時間: a held message shows how long its task is expected to take (約4分), with the usual range and what it came from, and no countdown',
      /想定 2〜10分/.test(chip) && /約4分/.test(chip) && /2分 〜 9分/.test(chip) && /過去12回/.test(chip) && !/data-at/.test(chip) && api.etaTaskChip(null) === '');
  } catch (e) { ok(`想定時間 — ${e.message}`, false); }
  ok('★ palette: no 削除 or resume-copy command (the panel has no … menu)', !api.PAL_ACTIONS.some((a) => /削除|resume コマンドをコピー/.test(a.t)));
}

console.log('== today\'s features, by what they do ==');
{
  const api = runPage();
  const body = (u) => { const f = api.fetched.find((x) => x[0] === u); return f ? JSON.parse(f[1].body) : null; };
  // PR: when the board itself may merge — a truth table, not one green case
  const pr = (o) => ({ number: 1, state: 'OPEN', draft: false, checks: { pass: 2, fail: 0, pending: 0 }, review: '', merge: 'CLEAN', ...o });
  ok('★ pr: the board merges only an open, non-draft PR with every check green and nothing blocking',
    api.prMergeable(pr({})) && !api.prMergeable(pr({ draft: true })) && !api.prMergeable(pr({ checks: { pass: 2, fail: 1 } }))
    && !api.prMergeable(pr({ checks: { pass: 2, pending: 1 } })) && !api.prMergeable(pr({ review: 'CHANGES_REQUESTED' }))
    && !api.prMergeable(pr({ review: 'REVIEW_REQUIRED' })) && ['BLOCKED', 'DIRTY', 'BEHIND', 'DRAFT'].every((m) => !api.prMergeable(pr({ merge: m })))
    && !api.prMergeable(pr({ state: 'MERGED' })) && !api.prMergeable(null));
  api.prFinish({ agent: 'claude', id: 's1' }, true);
  const pm = body('api/pr/merge');
  ok('★ pr: マージして片付け asks the board to merge that session, and marks it busy until answered', pm && pm.merge === true && pm.session === 's1' && api.prDone.get('claude:s1') === 'busy');
  api.prFinish({ agent: 'claude', id: 's2' }, false);
  ok('pr: 片付け asks for no merge', api.fetched.filter((x) => x[0] === 'api/pr/merge').map((x) => JSON.parse(x[1].body)).some((b) => b.session === 's2' && b.merge === false));
  api.prFinished({ agent: 'claude', session: 's1', ok: false, steps: [{ step: 'merge', ok: false, detail: 'x' }], error: 'refused' });
  ok('pr: a refused step is kept to show, and the box is no longer busy', api.prDone.get('claude:s1').error === 'refused' && api.prDone.get('claude:s1') !== 'busy');
  const failing = api.prHtml({ branch: 'b', base: 'origin/main', ahead: 1, pushed: true, pr: pr({ checks: { fail: 1 } }) }, 'claude:x');
  ok('★ pr: failing checks offer no merge', !/data-merge/.test(failing));
  // worktree setup
  const miss = api.wtHtml({ root: '/r', missing: ['.env', 'a/.env.local', 'b', 'c', 'd'], copied: [] });
  ok('★ wtsetup: the missing config is named (four, then a count) with the button that adds it', /<code>\.env<\/code>/.test(miss) && /ほか 1 件/.test(miss) && /id="nwtinc"/.test(miss));
  ok('wtsetup: covered files say they are copied; nothing to say says nothing; not a repo says so',
    /写すもの/.test(api.wtHtml({ root: '/r', missing: [], copied: ['.env'] })) && api.wtHtml({ root: '/r', missing: [], copied: [] }) === '' && /git のリポジトリではない/.test(api.wtHtml({ error: 'x' })));
  ok('★ wtsetup: the setup command goes at the front of the first message, and none adds nothing',
    api.wtNote('npm ci').includes('`npm ci`') && api.wtNote('npm ci').endsWith('\n\n') && api.wtNote('') === '' && api.wtNote('  ') === '');
  api.wtPost({ dir: '/r', include: ['.env'] });
  ok('wtsetup: the include button posts the files it named', (body('api/wtsetup') || {}).include[0] === '.env');
  // 残作業
  const c = { agent: 'claude', id: 'w1', project: '/p', wip: { status: 'ok', remaining: [{ what: 'A' }, { what: 'B' }] } };
  const n0 = api.fetched.length;
  api.pendAct(c, 'A', true);
  const sent = api.fetched.slice(n0).map((x) => [x[0], JSON.parse(x[1].body)]);
  ok('★ 残作業 実行: the item goes to its own session as an instruction, then off the list',
    sent.some(([u, b]) => u === 'api/reply' && b.session === 'w1' && b.text === '残作業のうち、次を進めてください: A')
    && sent.some(([u, b]) => u === 'api/wip' && b.drop === 'A') && c.wip.remaining.length === 1);
  const n1 = api.fetched.length;
  api.pendAct(c, 'B', false);
  const sent2 = api.fetched.slice(n1).map((x) => x[0]);
  ok('★ 残作業 やめる: dropped, and nothing sent to the session', !sent2.includes('api/reply') && sent2.includes('api/wip') && c.wip.remaining.length === 0);
  // the 残作業 page: its count is the header's, and every section has something to press
  try {
    const now = Date.now();
    const w = (id, over) => ({ ...card, id, title: 'T' + id, lastT: now - 1000, ...over });
    const cards = [
      w('a', { column: 'stale', wip: { status: 'ok', at: now, remaining: [{ what: 'A1' }, { what: 'A2' }, { what: 'A3' }] } }),
      w('b', { column: 'needs-you', wip: { status: 'ok', at: now, remaining: [{ what: 'B1' }] } }),
      w('c', { column: 'stale', wip: { status: 'ok', at: now - 9e5, remaining: [] }, lastT: now }),
      w('u1', { column: 'stale' }), w('u2', { column: 'needs-you' }), w('u3', { column: 'idle' }), w('u4', { column: 'stale' }),
      w('x1', { column: 'working' }), w('x2', { column: 'done' }), w('x3', { column: 'stale', subagent: true }), w('x4', { column: 'stale', agent: 'gemini' }),
      w('r1', { column: 'stale', wip: { status: 'running', at: now } }), w('e1', { column: 'stale', wip: { status: 'error', at: now, error: 'だめ' } }),
    ];
    api.applyState({ cards, agents: [], hours: 24, collisions: [] });
    const chip = api.document.querySelector('#pendn').textContent;
    const pc = api.pendCounts(cards);
    api.openPendingAll();
    const h = api.body().innerHTML, t = api.document.querySelector('#mtitle').textContent;
    ok('★ 残作業: the header chip and the page count the same thing (items left in the sessions read)', chip === '4' && pc.items === 4 && t === '残作業 4件 — 2セッション' && /「残作業 4」は、棚卸し済みのセッションに残っている<b>項目の数<\/b>/.test(h));
    ok('★ 残作業: 未棚卸し are the sessions a reading is for — not at work, not closed, not subagents, not other agents; 放置 first',
      pc.unread.map((c) => c.id).join() === 'u1,u4,u2,u3' && /未棚卸し <b>4<\/b>/.test(h));
    ok('★ 残作業: a session with items opens its panel, each item has 実行 / やめる; each unread one has 棚卸しする',
      (h.match(/class="mini popen"/g) || []).length === 3 && (h.match(/class="mini pgo"/g) || []).length === 4 && (h.match(/<div class="prow" data-agent="claude" data-id="u\d"><span class="pt">[^]*?class="mini pscan1">棚卸しする</g) || []).length === 4);
    ok('★ 残作業: まとめて takes only what may run at once (3 − the 1 running = 2), and says each is a model call',
      /id="pscanall" class="mini" data-n="2"[^>]*>まとめて棚卸し\(2件\)</.test(h) && /1件ごとにモデル\(sonnet\)を呼びます/.test(h));
    ok('★ 残作業: at it / failed are listed (failed can go again); 残りなし is folded', /棚卸し中…/.test(h) && /class="bad"[^>]*>失敗<\/span><button class="mini pscan1"/.test(h) && /<details class="pdone"><summary class="dim">残りなし 1件<\/summary>/.test(h) && !/<details class="pdone" open/.test(h));
    const n0 = api.fetched.length;
    api.wipStart(cards[3]);
    const sent = api.fetched.slice(n0).map((x) => [x[0], JSON.parse(x[1].body)]);
    ok('残作業: 棚卸しする posts one reading of that session and marks it running', sent.length === 1 && sent[0][0] === 'api/wip' && sent[0][1].session === 'u1' && !('drop' in sent[0][1]) && cards[3].wip.status === 'running');
    api.applyState({ cards: cards.map((c) => ({ ...c, wip: c.id === 'r1' ? { status: 'running', at: now } : c.wip })).concat([w('r2', { wip: { status: 'running', at: now } }), w('r3', { wip: { status: 'running', at: now } })]), agents: [], hours: 24, collisions: [] });
    api.openPendingAll();
    ok('★ 残作業: with three at it no more can start — no まとめて, each 棚卸しする disabled', !/id="pscanall"/.test(api.body().innerHTML) && /class="mini pscan1" disabled/.test(api.body().innerHTML));
    api.closeDetail('x');
  } catch (e) { ok('残作業 page — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  // 定期実行: when next, what it said, and what can be done to a job of yours
  try {
    const now = Date.now();
    const mk = (over) => ({ label: 'com.sue738.x', schedule: '平日 7:45', program: '/Users/me/bin/x.sh', log: '/tmp/x.log', err: '/tmp/x.err', lastRun: now - 3600e3, next: now + 20 * 60e3, said: '[x] 完了', loaded: true, running: false, lastExit: 0, disabled: false, mine: true, ...over });
    const h = api.jobsHtml({ jobs: [mk(), mk({ label: 'com.sue738.bad', lastExit: 1, said: 'FAIL: y' }), mk({ label: 'com.sue738.off', disabled: true, loaded: false, next: null }), mk({ label: 'com.app.helper', mine: false })] });
    const job = (l) => (h.match(new RegExp('<div class="job[^"]*" data-label="' + l.replace(/\./g, '\\.') + '">[^]*?<\/div><\/div><\/div>')) || [''])[0];
    ok('★ jobs: each shows its schedule, last run, next run and its log\'s last line, with ログ / エラーログ',
      /最後 1\.0時間前/.test(job('com.sue738.x')) && /次 20分後/.test(job('com.sue738.x')) && /class="jsaid" title="ログの最後の行">\[x\] 完了/.test(job('com.sue738.x')) && /data-p="\/tmp\/x\.log">ログ/.test(job('com.sue738.x')) && /エラーログ/.test(job('com.sue738.x')));
    ok('★ jobs: a failed one says so in red, its summary counts it', /失敗 \(1\)/.test(job('com.sue738.bad')) && /class="jsaid bad"/.test(job('com.sue738.bad')) && /失敗 1/.test(h));
    ok('★ jobs: yours can be run now, paused or deleted; a paused one resumed or deleted; the app\'s are read-only',
      ['run', 'pause', 'delete'].every((a) => job('com.sue738.x').includes('data-a="' + a + '"')) && !job('com.sue738.x').includes('data-a="resume"')
      && /data-a="resume"/.test(job('com.sue738.off')) && !/data-a="run"/.test(job('com.sue738.off')) && /停止中/.test(job('com.sue738.off'))
      && !/class="mini jact/.test(job('com.app.helper')) && /見るだけ/.test(h));
    ok('jobs: outside the app the actions are there but disabled', /class="mini jact" data-a="run" disabled title="アプリの中からだけ/.test(h));
    ok('jobs: next run said as a person says it', api.whenNext(now + 5 * 60e3) === '5分後' && /^(今日|明日) \d+:\d\d$/.test(api.whenNext(now + 3 * 3600e3)) && /^\d+\/\d+\([日月火水木金土]\) \d+:\d\d$/.test(api.whenNext(now + 5 * 864e5)));
  } catch (e) { ok('jobs page — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  // the send watchdog: an answer that never comes unlocks the box
  const d = api.document.querySelector('#watchdog-box');
  const before = api.pendingToasts.size;
  api.dispatch({ type: 'reply', agent: 'claude', session: 'z', text: 't' }, d);
  const wd = api.timers.filter((t) => t.ms === 90000).pop();
  ok('★ send: a watchdog is set, and while waiting the box is locked', !!wd && d.dataset.sending === '1');
  wd.f();
  ok('★ send: after 90s with no answer the box unlocks and the late answer is not applied twice', d.dataset.sending === undefined && api.pendingToasts.size === before);
  let threw = false; try { api.dispatched({ token: 'none', ok: true }); } catch (e) { threw = true; }
  ok('send: an answer for a request already given up on is ignored', !threw);
}
{
  // nested subagents: a running one is a row under its parent, not a card of its own in the lanes
  const api = runPage();
  const P = { ...card, id: 'par', column: 'working', title: 'parent' };
  const k = (id, run) => ({ ...card, id, parentId: 'par', subagent: true, subRunning: run, column: run ? 'working' : 'idle', title: id });
  api.applyState({ cards: [P, k('k1', true), k('k2', true), k('k3', false)], agents: [], hours: 24, collisions: [] });
  const lane = api.document.querySelector('[data-col="working"] .list');
  const pc = lane.children.find((x) => x.dataset.id === 'par');
  const nest = pc && pc.children.find((x) => x.className === 'nest');
  ok('★ subagents: two at work → two rows under the parent, and no card of their own in Working',
    !!nest && nest.children.length === 2 && !lane.children.some((x) => /^k\d$/.test(x.dataset.id)));
}
{
  // ＋新規: Enter → 起動中… → 起動しました (waiting for the card) → that session's panel
  const api = runPage();
  const $ = (q) => api.document.querySelector(q);
  api.applyState({ cards: [], agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: ['/Users/me/work'] });
  const enter = () => $('#ntext').onkeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, preventDefault() {} });
  const runs = () => api.fetched.filter((x) => x[0] === 'api/run').map((x) => JSON.parse(x[1].body));
  // the requests still waiting, newest last; tokens() is the newest one's alone (or the last n)
  const tokens = (n = 1) => [...api.pendingToasts.keys()].slice(-n);
  const fire = (ms, name) => { const t = api.timers.filter((x) => x.ms === ms && (!name || x.f.name === name)).pop(); if (t) t.f(); return !!t; };
  const started = { ...card, id: '0badc0de-1111-2222-3333-444444444444', project: '/tmp/p', column: 'working', title: 'say PONG' };
  // 1. started, found by the short id --bg printed
  api.openNew();
  $('#ndir').value = '/tmp/p'; $('#ntext').value = 'say PONG';
  enter();
  ok('★ new: Enter shows 起動中… at once, before any answer', api.newState() && api.newState().phase === 'starting'
    && /起動中/.test($('#nstate').innerHTML) && $('#nstate').hidden === false && api.body().dataset.phase === 'starting');
  enter(); enter();
  ok('★ new: more Enters while it starts start nothing more', runs().length === 1 && runs()[0].closeOnDone === true);
  api.dispatched({ token: tokens()[0], ok: true, short: '0badc0de', agent: 'claude', log: '/x/runs/a-claude.log' });
  ok('★ new: the board is read again at once on the answer, not after a fixed wait', fire(1000, 'followNew'));
  ok('★ new: 起動しました, and the session panel opens at once on a stand-in (the ask as its title), before the board has read it',
    api.panel() === 'claude:0badc0de' && /say PONG/.test(api.body().innerHTML) && !!api.pendingNewOf());
  $('#ntext').value = 'another'; enter();
  ok('new: an Enter while waiting for the card starts no second session', runs().length === 1);
  api.applyState({ cards: [{ ...card, id: 'ffffffff-0000-0000-0000-000000000000' }], agents: [], hours: 24, collisions: [], home: '/Users/me' });
  ok('new: another session appearing is not taken for it', api.panel() === 'claude:0badc0de' && !!api.pendingNewOf());
  api.applyState({ cards: [started], agents: [], hours: 24, collisions: [], home: '/Users/me' });
  ok('★ new: when its card appears the panel moves onto that session', api.panel() === 'claude:' + started.id && !api.pendingNewOf() && api.newState() === null);
  // 2. the card never comes: after the wait it says so, and still follows
  api.openNew();
  $('#ndir').value = '/tmp/p'; $('#ntext').value = 'slow one'; enter();
  api.dispatched({ token: tokens()[0], ok: true, session: 'abcdef12-1111-2222-3333-444444444444', short: 'abcdef12', agent: 'claude' });
  api.pendingNewOf().at -= 31000;
  fire(1000, 'followNew');
  ok('★ new: no card after 30s → the stand-in panel says what happened instead of sitting silent', api.panel() === 'claude:abcdef12-1111-2222-3333-444444444444'
    && /mnote stuck provlate[^<]*秒たってもボードに出てきません[^<]*abcdef12/.test(api.body().innerHTML) && !!api.pendingNewOf());
  api.applyState({ cards: [{ ...started, id: 'abcdef12-1111-2222-3333-444444444444' }], agents: [], hours: 24, collisions: [], home: '/Users/me' });
  ok('new: a card that turns up late still gets its panel', api.panel() === 'claude:abcdef12-1111-2222-3333-444444444444');
  // 3. refused: the CLI's reason, the compose panel stays, the ask is kept
  api.openNew();
  $('#ndir').value = '/tmp/p'; $('#ntext').value = 'please keep me'; enter();
  $('#ntext').value = '';
  api.dispatched({ token: tokens()[0], error: 'claude が起動しませんでした: API Error: 529 overloaded' });
  ok('★ new: a refusal shows the CLI\'s reason, stays on the compose panel, and gives the ask back', api.newState().phase === 'failed'
    && /API Error: 529/.test($('#nstate').innerHTML) && api.panel() === 'new' && $('#ntext').value === 'please keep me' && !api.pendingNewOf());
  const n0 = runs().length; enter();
  ok('new: after a refusal Enter tries again', runs().length === n0 + 1);
  // 4. no id in the answer (codex, or a CLI that printed none): said, not silent
  api.openNew();
  $('#ndir').value = '/tmp/p'; $('#ntext').value = 'codex one'; enter();
  api.dispatched({ token: tokens()[0], ok: true, log: '/x/runs/b-codex.log' });
  ok('★ new: an answer without a session id says so', api.newState().phase === 'noid' && /セッション id を返さなかった/.test($('#nstate').innerHTML));
  // 4a. files attached to a new session go with it: the compose box does not keep them for the next one
  {api.openNew();
    $('#ndir').value = '/tmp/p'; $('#ntext').value = 'with a file'; enter();
    let cleared = 0; api.setFn('attachClear', () => { cleared++; });
    api.dispatched({ token: tokens()[0], ok: true, log: '/x/runs/d-codex.log' });
    ok('★ new: once started, the compose box drops the files that went (not attached again to the next one)', cleared === 1);}
  // 4b. codex names no session: its panel is the first codex card in that folder begun since the Enter
  api.openNew();
  $('#nagent').dataset.v = 'codex';
  $('#ndir').value = '/tmp/cx'; $('#ntext').value = 'codex two'; enter();
  const cxAt = Date.now();
  api.dispatched({ token: tokens()[0], ok: true, log: '/x/runs/c-codex.log' });
  ok('★ new codex: no id, and still it waits for the card (not "id を返さなかった")', api.newState().phase === 'waiting' && !!api.pendingNewOf());
  const cx = { ...card, agent: 'codex', project: '/tmp/cx', column: 'working' };
  api.applyState({ cards: [{ ...cx, id: 'old-codex', firstT: cxAt - 60000 }, { ...cx, id: 'other-dir', project: '/tmp/p', firstT: cxAt + 100 }], agents: [], hours: 24, collisions: [], home: '/Users/me' });
  ok('new codex: an older codex session in that folder, or a new one elsewhere, is not taken for it', api.panel() === 'new' && !!api.pendingNewOf());
  api.applyState({ cards: [{ ...cx, id: 'new-codex', firstT: cxAt + 500 }], agents: [], hours: 24, collisions: [], home: '/Users/me' });
  ok('★ new codex: when its card appears the panel moves onto that session', api.panel() === 'codex:new-codex' && !api.pendingNewOf());
  api.store.lastagent = 'claude';   // the compose panel remembers codex; the cases below are claude's
  // 5. ×3: three starts, the panel follows the first whatever order they answer in
  api.openNew();
  $('#nwt').classList.add('on'); $('#npar').dataset.n = '3';
  $('#ndir').value = '/tmp/p'; $('#ntext').value = 'three ways'; const r0 = runs().length; enter();
  const three = runs().slice(r0), tk = tokens(3);
  ok('new ×3: three starts, only the first is followed', three.length === 3 && three.map((x) => !!x.closeOnDone).join() === 'true,false,false' && /1本目/.test($('#nstate').innerHTML));
  api.dispatched({ token: tk[2], ok: true, short: '33333333', agent: 'claude' });
  api.dispatched({ token: tk[1], ok: true, short: '22222222', agent: 'claude' });
  ok('new ×3: the second and third answering first do not take the panel', api.newState().phase === 'starting' && !api.pendingNewOf());
  api.dispatched({ token: tk[0], ok: true, short: '11111111', agent: 'claude' });
  api.applyState({ cards: [{ ...started, id: '22222222-0000-0000-0000-000000000000' }, { ...started, id: '11111111-0000-0000-0000-000000000000' }], agents: [], hours: 24, collisions: [], home: '/Users/me' });
  ok('★ new ×3: the panel opens the first one', api.panel() === 'claude:11111111-0000-0000-0000-000000000000');
  $('#nwt').classList.remove('on');
  // 6. ~ : started in a trusted directory instead, and it says where
  api.applyState({ cards: [], agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: ['/Users/me/work'] });
  api.openNew();
  $('#ndir').value = '/Users/me'; $('#ntext').value = 'from home'; const r1 = runs().length; enter();
  api.dispatched({ token: tokens()[0], ok: true, short: '44444444', agent: 'claude' });
  ok('★ new in ~: started in a trusted directory, and the panel says which', runs()[r1].dir === '/Users/me/work'
    && /~\/work で起動しました/.test($('#nstate').innerHTML) && api.newState().phase === 'waiting');
  // 7. no answer at all: the watchdog says so too
  api.openNew();
  $('#ndir').value = '/tmp/p'; $('#ntext').value = 'never answered'; enter();
  fire(90000);
  ok('new: no answer in 90s → the panel says so and Enter works again', api.newState().phase === 'late' && /90秒/.test($('#nstate').innerHTML));
}
{
  // the panel's place on a wide board: closing empties it, and the keys keep their meaning
  const api = runPage();
  const q = (s) => api.document.querySelector(s);
  q('#detail').hidden = true; q('#mmenu').hidden = true; q('#help').hidden = true;
  const k1 = card.agent + ':' + card.id;
  try {
    api.applyState({ cards: [card, { ...card, id: 'w1', column: 'working' }, { ...card, id: 's1', column: 'needs-you', subagent: true }], agents: [], hours: 24, collisions: [] });
    const empty = q('#dempty').innerHTML;
    ok('★ empty panel: says what goes there, counts Your Turn (not subagents), offers the first of them, 新規 and 残作業',
      /カードを選ぶとここに会話が出ます/.test(empty) && /Your Turn に <b>1<\/b> 件/.test(empty) && /data-go="top"/.test(empty) && /data-go="new"/.test(empty) && /data-go="pending"/.test(empty));
    api.applyState({ cards: [{ ...card, column: 'working' }], agents: [], hours: 24, collisions: [] });
    ok('empty panel: nothing waits for you → it says so, and offers no first card', /Your Turn は空です/.test(q('#dempty').innerHTML) && !/data-go="top"/.test(q('#dempty').innerHTML));
    api.applyState({ cards: [card, { ...card, id: 'w1', column: 'working' }], agents: [], hours: 24, collisions: [] });
    api.key(' ');
    ok('★ Space on the empty panel with nothing selected opens nothing', q('#detail').hidden && !api.openFor());
    api.key('Escape');
    ok('★ Esc on the empty panel with nothing selected does nothing (no panel comes back)', q('#detail').hidden && !api.sel());
    api.setSel(k1);
    api.key(' ');
    ok('★ Space on the empty panel opens the selected card', !q('#detail').hidden && api.openFor() === k1);
    api.key(' ');
    ok('★ Space again empties the panel; the selection stays', q('#detail').hidden && !api.openFor() && api.sel() === k1);
    ok('★ closed, nothing looks pressed and the next launch opens nothing (lastpanel is empty)', api.store.lastpanel === '' && !q('#pendall').classList.contains('on'));
    // Esc walks out one step at a time: the box, then the panel, then the selection
    api.key('Enter');
    const box = { tagName: 'TEXTAREA', closest: () => null, blur() { api.document.activeElement = undefined; } };
    api.document.activeElement = box;
    api.key('Escape');
    ok('★ Esc in the message box leaves the box, the panel stays open', !q('#detail').hidden && api.document.activeElement === undefined);
    api.key('Escape');
    ok('★ Esc again empties the panel, the card stays selected', q('#detail').hidden && api.sel() === k1);
    api.key('Escape');
    ok('★ Esc on the empty panel drops the selection, and the panel stays empty', q('#detail').hidden && !api.sel() && !api.openFor());
    // a header view: pressed while open, remembered for the next launch, and closed by the same button
    api.togglePanel('pending', api.openPendingAll);
    ok('★ 残作業 opens over the empty panel, looks pressed, and is what the next launch opens', !q('#detail').hidden && q('#pendall').classList.contains('on') && api.store.lastpanel === 'pending');
    api.togglePanel('pending', api.openPendingAll);
    ok('★ 残作業 pressed again empties the panel: not pressed, lastpanel empty', q('#detail').hidden && !q('#pendall').classList.contains('on') && api.store.lastpanel === '');
    api.key('n');
    ok('★ a bare n does not open 新規 (it opened by itself when a key landed outside a field; ⌘N does it)', q('#detail').hidden && !q('#new').classList.contains('on'));
    api.togglePanel('new', () => api.toggleNew('test'));
    api.closeDetail('x');
    ok('× empties it again; 新規 is not pressed', q('#detail').hidden && !q('#new').classList.contains('on'));
  } catch (e) { ok('empty panel — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
}
{
  // the view: リスト only (看板 was removed); whatever was stored or asked for opens as リスト
  try {
    for (const v of ['focus', 'board', 'list', undefined]) {
      const f = runPage(v ? { view: v } : {});
      ok('★ view: stored ' + (v || 'nothing') + ' opens リスト', f.boardView() === 'list' && f.document.body.classList.contains('vlist') && !f.document.body.classList.contains('vboard'));
    }
    const f = runPage({ view: 'board' });
    f.setView('board');
    ok('★ view: asked for 看板 (a stale call), it stays リスト', f.boardView() === 'list' && f.store.view === 'list' && f.VIEWS.length === 1);
    ok('★ view: no v key and no view switch left', !f.KM_DEFS.some((d) => d[0] === 'view.key') && !f.PAL_ACTIONS.some((a) => /看板/.test(a.t)));
  } catch (e) { ok('view — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  // what a card shows is chosen in 表示; API 換算 is on by default, Σ tokens is chosen
  try {
    const f = runPage();
    const u = { ctx: 1000, inTok: 250000, outTok: 5000, turns: 3, usd: 1.23, by: {} };
    const cards = [{ agent: 'claude', id: 'cs1', column: 'working', title: 't', project: '/p', lastT: 1, idleS: 5, usage: u },
      { agent: 'claude', id: 'cs2', column: 'answered', title: 't2', project: '/p', lastT: 1, idleS: 5, usage: u }];
    f.applyState({ cards, agents: [], hours: 24, collisions: [] });
    // the stub's lists keep their cards as children (appendChild; innerHTML = '' does not clear them): the newest drawing is the last one
    const lane = (c) => ((f.document.querySelector('[data-col="' + c + '"] .list').children || []).slice(-1)[0] || {}).innerHTML || '';
    const html = () => lane('working') + lane('needs-you');
    ok('★ card: API 換算 by default and no Σ tokens, on a one-line card and a whole one', !/class="ctok"/.test(html()) && (html().match(/\$1\.23/g) || []).length === 2);
    f.setCardShow('tokens', true);
    ok('★ card: Σ tokens shows once chosen', (html().match(/class="ctok"/g) || []).length === 2);
    f.setCardShow('tokens', false); f.setCardShow('usd', false); f.setCardShow('idle', false);
    ok('★ card: turned off in 表示, they go, and it is remembered', !/ctok|cusd|class="idle"/.test(html()) && JSON.parse(f.store.cardshow).tokens === false);
    ok('card: the context always, when chosen', (f.setCardShow('ctx', true), /class="cctx"/.test(html())) && f.cshow('ctx'));
    ok('card: every field has a label and a default', f.CARD_FIELDS.every((x) => x[0] && x[1] && typeof x[2] === 'boolean'));
    {
      // 未読: updated since you last looked. Before the first launch with this nothing is unread; a working card is marked once it stops
      const now0 = Date.now(), base = f.seenBase();
      const uc = (o) => ({ agent: 'claude', id: 'u-' + Math.random().toString(36).slice(2), column: 'answered', title: 'u', project: '/p', lastT: base + 5000, ...o });
      ok('★ 未読: a card that moved before the first launch is read; one that moved after is unread', !f.isUnread(uc({ lastT: base - 60000 })) && f.isUnread(uc({ lastT: base + 5000 })));
      const a = uc({ lastT: base + 5000 });
      ok('★ 未読: looked at, it is read; updated again, it is unread again', f.markSeen(a) && !f.isUnread(a) && f.isUnread({ ...a, lastT: a.lastT + 1000 }) && !f.markSeen(a));
      ok('★ 未読: a working card is marked once a reply has come (not at every tool call); a stopped one whenever it moved; a subagent is never unread',
        !f.unreadShown(uc({ column: 'working' })) && f.unreadShown(uc({ column: 'working', replyTurns: 2 })) && f.isUnread(uc({ column: 'working' })) && f.unreadShown(uc({ column: 'answered' })) && !f.isUnread(uc({ subagent: true })) && !f.isUnread(uc({ headless: true })));
      const ids = [uc({ id: 'u-1' }), uc({ id: 'u-2', column: 'working' }), uc({ id: 'u-3', column: 'needs-you', lastT: base - 10 })];
      f.applyState({ cards: ids, agents: [], hours: 24, collisions: [] });
      ok('★ 未読: the count is the cards that are marked (the working one and the old one are not)', f.unreadCount() === 1);
      const last = () => (f.document.querySelector('[data-col="needs-you"] .list').children || []).slice(-1)[0] || {};
      const mark = (c) => { f.applyState({ cards: [c], agents: [], hours: 24, collisions: [] }); const l = last(); return /\bunread\b/.test(l.className || ''); };
      ok('★ 未読: the card is drawn marked when unread, plain once read', mark(uc({ id: 'u-4', lastT: base + 9000 })) === true && (f.markSeen(uc({ id: 'u-4', lastT: base + 9000 })), mark(uc({ id: 'u-4', lastT: base + 9000 })) === false));
      f.applyState({ cards: [uc({ id: 'u-5' }), uc({ id: 'u-6' })], agents: [], hours: 24, collisions: [] });
      f.unreadAllRead();
      ok('★ 未読: すべて既読にする clears them all', f.unreadCount() === 0 && f.store.seen && Object.keys(JSON.parse(f.store.seen).m).length >= 2);
      {
        // the conversation says where the unread begins: in front of the first reply after the last look, once
        const k = uc({ id: 'u-line', lastT: base + 9000 });
        f.applyState({ cards: [k], agents: [], hours: 24, collisions: [] });
        f.openDetail(k);
        const turns = [{ kind: 'user', text: 'おねがい', t: base + 1000 }, { kind: 'assistant', text: '古い返事', t: base - 5000 }, { kind: 'assistant', text: '新しい返事', t: base + 4000 }, { kind: 'tool', tool: 'Bash', text: 'ls', t: base + 5000 }, { kind: 'assistant', text: 'もう一つ', t: base + 9000 }];
        f.renderHistory({ agent: k.agent, session: k.id, turns });
        const h = f.hist.innerHTML, at = h.indexOf('unreadline');
        ok('★ 未読: the thread has one "ここから未読" line, in front of the first reply after the last look, with the count',
          at > 0 && h.indexOf('unreadline', at + 1) < 0 && h.indexOf('古い返事') < at && at < h.indexOf('新しい返事') && /返答 2 件/.test(h) && f.unreadFromOf(k.agent + ':' + k.id) != null);
        f.markSeen(k);
        f.openDetail({ ...k, id: 'other-card' }); f.openDetail(k);
        f.renderHistory({ agent: k.agent, session: k.id, turns: turns.concat([]) });
        ok('★ 未読: once seen and reopened there is no line', !/unreadline/.test(f.hist.innerHTML) && f.unreadFromOf(k.agent + ':' + k.id) == null);
      }
      {
        // how many replies are waiting: counted from what the card had when it was last seen
        const nc = uc({ id: 'u-new', replyTurns: 3, lastT: base + 5000 });
        ok('★ 未読: a card new since the first launch has all its replies waiting, and the chip says so', f.unreadReplies(nc) === 3 && /返信 3 件/.test(f.unreadChip(nc)));
        f.markSeen(nc);
        const more = { ...nc, replyTurns: 5, lastT: base + 9000 };
        ok('★ 未読: after it was seen, only the replies since count; none waiting, no chip; a working card shows the count too', f.unreadReplies(more) === 2 && /返信 2 件/.test(f.unreadChip(more)) && f.unreadChip(nc) === '' && /返信 2 件/.test(f.unreadChip({ ...more, column: 'working' })) && f.unreadChip({ ...nc, column: 'working', lastT: nc.lastT + 500 }) === '');
        const k0 = uc({ id: 'u-old', replyTurns: 9, lastT: base + 20000 });
        f.seenMapRef()[k0.agent + ':' + k0.id] = base + 10000;
        ok('★ 未読: seen before replies were counted, the number is not known: dot and bold only, no chip', f.unreadShown(k0) && f.unreadChip(k0) === '');
        const k1 = uc({ id: 'u-old2', replyTurns: 7, lastT: base - 1000 });
        f.seenBaseline([k1]);
        ok('… a read one takes its count now, so replies after it are counted from there', f.seenARef()[k1.agent + ':' + k1.id] === 7 && f.unreadReplies({ ...k1, replyTurns: 8, lastT: base + 30000 }) === 1);
        f.applyState({ cards: [uc({ id: 'u-chip', replyTurns: 4, lastT: base + 40000 })], agents: [], hours: 24, collisions: [] });
        const lastEl = (f.document.querySelector('[data-col="needs-you"] .list').children || []).slice(-1)[0] || {};
        ok('★ 未読: the card carries the count (返信 N 件)', /返信 4 件/.test(lastEl.innerHTML || ''));
      }
      ok('★ 未読: is:unread narrows to them', f.matchQuery(f.parseQuery('is:unread'), uc({ lastT: base + 7000 })) && !f.matchQuery(f.parseQuery('is:unread'), uc({ lastT: base - 7000 })));
    }
    {
      // the badges (Σ/API/文脈/回数/ツール/稼働/経過/許可/場所) draw left to right as chosen — drag order, stored and restored
      f.setCardShow('tokens', true); f.setCardShow('turns', true);
      const c4 = { ...cards[0], usage: u, humanTurns: 3 };
      ok('★ card: badges draw in the default order (Σ before 回数)', f.orderedChips(c4).join('').indexOf('ctok') < f.orderedChips(c4).join('').indexOf('cxt'));
      f.setCardOrder(['turns', 'tokens', 'usd', 'ctx', 'worked', 'age', 'perm', 'where']);
      ok('★ card: reordered — 回数 now comes before Σ, and it is remembered', f.orderedChips(c4).join('').indexOf('cxt') < f.orderedChips(c4).join('').indexOf('ctok') && JSON.parse(f.store.cardorder)[0] === 'turns');
      ok('card: a stale or missing key is dropped/added, never lost or duplicated', (() => { f.setCardOrder(['turns', 'nope']); const o = f.chipOrder(); return o[0] === 'turns' && !o.includes('nope') && f.CHIP_FIELDS.every((k) => o.includes(k)) && new Set(o).size === o.length; })());
      f.setCardOrder(f.CHIP_FIELDS.slice()); f.setCardShow('tokens', false); f.setCardShow('turns', false);
    }
    {
      // カード項目: proj/agent/model and last/idle (not badge-shaped) have no drag handle; the 9 badges do, in chipOrder()
      f.cardShowOpen(true);
      const html = f.document.querySelector('#cardshow').innerHTML;
      const btn = (k) => (html.match(new RegExp('<button[^>]*data-k="' + k + '"[^>]*>')) || [''])[0];
      ok('★ カード項目: proj/agent/model/last/idle have no drag handle (not badge-shaped)', ['proj', 'agent', 'model', 'last', 'idle'].every((k) => btn(k) && !/draggable/.test(btn(k))));
      ok('★ カード項目: the 9 badges carry a drag handle, drawn in chipOrder()', f.CHIP_FIELDS.every((k) => /draggable="true"/.test(btn(k)))
        && [...html.matchAll(/data-k="(\w+)"/g)].map((m) => m[1]).filter((k) => f.CHIP_FIELDS.includes(k)).join() === f.chipOrder().join()
        && /<div class="cgroup">/.test(html));
      f.cardShowOpen(false);
    }
  } catch (e) { ok('card fields — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
}
{
  // the layout: wide, the panel's place is kept (open or not); narrow, a closed panel goes
  const css = uiStyle();
  const html = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ui', 'index.html'), 'utf8');
  {
    // no age beside the allowance, however old the numbers (it read as an unexplained "55時間"); the time of the last reading is on hover
    const f = runPage(), now = Date.now();
    f.applyState({ cards: [], agents: [], hours: 24, collisions: [], limits: { fiveHour: { used: 20, resetsAt: now + 3600e3 }, at: now - 3 * 3600e3, codex: { fiveHour: { used: 0, resetsAt: now - 1000 }, week: { used: 17, resetsAt: now + 4 * 864e5 }, at: now - 55 * 3600e3 } } });
    const el = f.document.querySelector('#limits');
    ok('★ allowance: old numbers show no age beside them (no "55時間前"), the last reading stays in the hover', !/時間前|分前|日前|の値/.test(el.innerHTML) && /codex: 最後のセッションのログ/.test(el.title || ''));
  }
  ok('★ layout: no board-view rules are left (リスト is the only view)', !/body:not\(\.vlist\)|\.vboard|\.vseg/.test(css) && !/id="viewbtn"/.test(html) && /id="cardshowbtn"/.test(html));
  ok('★ layout: the empty place is off by default (so below 1011px a closed panel goes) and sits right after #detail', /(^|\n)#dempty\{display:none\}/.test(css) && /<div id="detail"[^\n]*<\/div>\n<div id="dempty"/.test(html));
}
{
  // What you are writing stays: another card, 新規, a send that failed or was never answered, a reload.
  // The stub's boxes are made fresh on each panel draw (innerHTML), as the real ones are, and the
  // panel's own box is the one $('#mbody .msg textarea') finds, so Enter in it runs the real send.
  console.log('== drafts ==');
  const c1 = card, c2 = { ...card, id: 'bbbbbbbb-2222-3333-4444-555555555555', title: 'もう一枚' };
  const state = { cards: [c1, c2], agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: ['/Users/me/work'] };
  const harness = (saved) => {
    const api = runPage(saved);
    const $ = (q) => api.document.querySelector(q);
    const mb = api.body();
    let h = '';
    const box = () => $('#mbody .msg textarea'), nt = () => $('#ntext');
    Object.defineProperty(mb, 'innerHTML', { configurable: true, get: () => h, set: (v) => { h = String(v); for (const b of [box(), nt(), $('#ndir')]) { b.value = ''; b.disabled = false; } } });
    const q0 = mb.querySelector, toastEl = Object.assign($('.toast'), { append() {} });
    mb.querySelector = (s) => (s === '.msg textarea' ? (/class="nsw"/.test(h) ? null : box()) : s === '.toast' ? toastEl : q0(s));
    api.applyState(state);
    const enter = (b) => b.onkeydown({ key: 'Enter', shiftKey: false, altKey: false, isComposing: false, keyCode: 13, preventDefault() {}, stopPropagation() {} });
    const token = () => [...api.pendingToasts.keys()].pop();
    const toastText = () => $('.toast').textContent;
    return { api, $, box, nt, enter, token, toastText };
  };
  const stored = (api) => { try { return JSON.parse(api.store.drafts || '{}'); } catch (e) { return {}; } };
  try {
    {
      const { api, box } = harness();
      api.openDetail(c1); box().value = '書きかけ1';
      api.openDetail(c2);
      ok('drafts: another card\'s panel starts empty', box().value === '');
      api.openDetail(c1);
      ok('★ drafts: type → another card → back: the text is back', box().value === '書きかけ1');
      api.openNew();
      api.openDetail(c1);
      ok('★ drafts: type → 新規 → back to the card: the text is back', box().value === '書きかけ1');
    }
    {
      const { api, $, nt } = harness();
      api.openNew(); nt().value = '新しいセッションへの依頼'; $('#ndir').value = '/Users/me/elsewhere';
      api.openDetail(c1);
      api.openNew();
      ok('★ drafts: 新規 → a card → 新規: the ask is back', nt().value === '新しいセッションへの依頼');
      ok('★ drafts: … and so is its folder', $('#ndir').value === '/Users/me/elsewhere');
    }
    {
      // a reload: a new page on the same localStorage
      const a = harness();
      a.api.openDetail(c1); a.box().value = 'リロードを越える';
      a.api.openDetail(c2); a.box().value = '二枚目も';
      a.api.closeDetail('x');
      a.api.openNew(); a.nt().value = '新規も';
      a.api.closeDetail('x');
      const b = harness(a.api.store);
      b.api.openDetail(c1);
      ok('★ drafts: after a reload the card\'s text is back', b.box().value === 'リロードを越える');
      b.api.openDetail(c2);
      ok('★ drafts: … every card\'s', b.box().value === '二枚目も');
      b.api.openNew();
      ok('★ drafts: … and 新規\'s', b.nt().value === '新規も');
      // a card whose session is gone keeps its draft: it comes back with the card
      const g = harness(a.api.store);
      g.api.applyState({ ...state, cards: [c1] });
      const back = harness(g.api.store);
      back.api.openDetail(c2);
      ok('★ drafts: a card that left the board and came back gets its text back', back.box().value === '二枚目も');
    }
    {
      // a send that fails, in the panel it was sent from
      const { api, box, enter, token } = harness();
      api.openDetail(c1); box().value = '送れないはず'; enter(box());
      ok('drafts: Enter sends it and empties the box', api.fetched.some((x) => x[0] === 'api/reply') && box().value === '');
      const t = token();
      const r = harness(api.store);
      r.api.openDetail(c1);
      ok('★ drafts: a reload before the answer comes: the text is back, with a word to check first', r.box().value === '送れないはず' && /確かめ/.test(r.toastText()));
      api.dispatched({ token: t, error: 'boom' });
      ok('★ drafts: failed → the text is back in the box', box().value === '送れないはず');
      const r2 = harness(api.store);
      r2.api.openDetail(c1);
      ok('★ drafts: … and a reload after the failure still has it', r2.box().value === '送れないはず');
    }
    {
      // failed while you were on another card; then a reload before you went back
      const { api, box, enter, token } = harness();
      api.openDetail(c1); box().value = '留守中に失敗'; enter(box());
      const t = token();
      api.openDetail(c2);
      api.dispatched({ token: t, error: 'boom' });
      const r = harness(api.store);
      r.api.openDetail(c1);
      ok('★ drafts: failed while on another card, then reloaded: the text is back', r.box().value === '留守中に失敗' && /送れなかった/.test(r.toastText()));
    }
    {
      // a send that goes: the draft goes with it, and a reload brings nothing back
      const { api, box, enter, token } = harness();
      api.openDetail(c1); box().value = '届くはず'; enter(box());
      api.dispatched({ token: token(), ok: true });
      const r = harness(api.store);
      r.api.openDetail(c1);
      ok('★ drafts: sent → gone from the box and from storage (a reload brings nothing back)', box().value === '' && r.box().value === '' && !/届くはず/.test(api.store.drafts || ''));
      // held (queued) counts as sent
      api.openDetail(c1); box().value = '預かり'; enter(box());
      api.dispatched({ token: token(), queued: true, why: 'whenfree' });
      ok('drafts: held by the board counts as sent: not kept as a draft', !/預かり/.test(api.store.drafts || ''));
    }
    {
      // back on the card while it is on its way, a new line typed: the answer must not wipe it
      const { api, box, enter, token } = harness();
      api.openDetail(c1); box().value = '一通目'; enter(box());
      const t = token();
      api.openDetail(c2); api.openDetail(c1);
      ok('drafts: back while it is on its way: not put back (it is being sent)', box().value === '');
      box().value = '二通目を書いている';
      api.dispatched({ token: t, ok: true });
      ok('★ drafts: the first one\'s answer leaves what you typed since', box().value === '二通目を書いている');
      enter(box()); const t2 = token();
      api.openDetail(c2); api.openDetail(c1); box().value = '三通目';
      api.dispatched({ token: t2, error: 'boom' });
      ok('★ drafts: a failure while you type another: both are in the box, nothing replaced', /二通目を書いている/.test(box().value) && /三通目/.test(box().value));
    }
    {
      // a button that sends its own words from the panel (残作業's 進めて) leaves your text alone
      const { api, box, token } = harness();
      api.openDetail(c1); box().value = '自分の書きかけ';
      api.dispatch({ type: 'reply', agent: c1.agent, session: c1.id, text: '残作業のうち、次を進めてください: x', dir: c1.project }, api.body());
      api.dispatched({ token: token(), ok: true });
      ok('★ drafts: another send from the panel (残作業) does not empty your box', box().value === '自分の書きかけ');
      api.dispatch({ type: 'reply', agent: c1.agent, session: c1.id, text: '残作業のうち、次を進めてください: y', dir: c1.project }, api.body());
      api.dispatched({ token: token(), error: 'boom' });
      ok('★ drafts: … nor replaces it when that send fails', box().value === '自分の書きかけ');
    }
    {
      // two sends from one box while the first is on its way: each is settled by its own answer
      const { api, box, enter, token } = harness();
      api.openDetail(c1); box().value = 'A1'; enter(box()); const t1 = token();
      api.openDetail(c2); api.openDetail(c1);
      box().value = 'A2'; enter(box()); const t2 = token();
      api.dispatched({ token: t1, error: 'boom' });
      ok('★ drafts: send A1, away and back, send A2, A1 fails → A1 is back in the box (its record was not overwritten by A2\'s)', box().value === 'A1');
      api.dispatched({ token: t2, ok: true });
      ok('drafts: … and A2 going leaves A1 there, and nothing of A2 kept', box().value === 'A1' && !/A2/.test(api.store.drafts || ''));
    }
    {
      // typed into the session's terminal (a /command, a message for the app's own terminal):
      // the words stay a draft until they are typed, and come back (their echo gone) if they are not
      const { api, box, enter } = harness();
      let fin = null;
      api.setFn('panelSlash', (c, cmd, f) => { fin = f; return true; });
      api.openDetail(c1); box().value = '/model'; enter(box());
      const kept = harness(api.store); kept.api.openDetail(c1);
      ok('★ drafts: a /command waiting for the terminal is still a draft (a reload now brings it back)', box().value === '' && kept.box().value === '/model');
      try { fin(false); } catch (e) { /* no callback: not kept */ }
      ok('★ drafts: … and when it could not be typed (a question on the screen, no prompt) it is back in the box', box().value === '/model');
      box().value = '/compact'; enter(box());
      try { fin(true); } catch (e) { /* none */ }
      ok('drafts: … once typed it is gone from the box and from storage', box().value === '' && !/compact/.test(api.store.drafts || ''));
      api.setFn('panelSlash', () => false);
      let tf = null;
      api.setFn('panelTypeMsg', (c, text, f) => { tf = f; return true; });
      box().value = '端末へのことば'; enter(box());
      const echoed = (api.sentEchoes.get(c1.agent + ':' + c1.id) || []).some((e) => e.text === '端末へのことば');
      try { tf(false); } catch (e) { /* none */ }
      ok('★ drafts: a message for the app\'s own terminal that was never typed: back in the box, its 端末に入力 echo gone',
        echoed && box().value === '端末へのことば' && !(api.sentEchoes.get(c1.agent + ':' + c1.id) || []).some((e) => e.text === '端末へのことば'));
    }
    {
      // 今の作業後に送る on, a busy session: a !command is never held as words (typed later, it would run)
      const wfc = { ...c1, alive: true, aliveKind: 'background', aliveStatus: 'busy' };
      const { api, box, enter } = harness({ whenfree: JSON.stringify([wfc.agent + ':' + wfc.id]) });
      api.applyState({ ...state, cards: [wfc, c2] });
      const slashed = [];
      api.setFn('panelSlash', (c, cmd, f) => { slashed.push(cmd); if (f) f(true); return true; });
      api.openDetail(wfc); box().value = '!ls -la'; enter(box());
      box().value = '/compact'; enter(box());
      const held = api.fetched.filter((x) => x[0] === 'api/reply' || x[0] === 'api/queue').map((x) => String(x[1] && x[1].body));
      ok('★ 今の作業後に送る: a !command and a /command go to the terminal at once, never held as words',
        slashed.join('|') === '!ls -la|/compact' && !held.some((b) => /ls -la|compact/.test(b)));
    }
    {
      // 新規: refused, then reloaded: the ask is back
      const { api, $, nt, enter, token } = harness();
      api.openNew(); $('#ndir').value = '/tmp/p'; nt().value = '起動に失敗する依頼'; enter(nt());
      api.dispatched({ token: token(), error: 'claude が起動しませんでした' });
      const r = harness(api.store);
      r.api.openNew();
      ok('★ drafts: 新規 refused, then reloaded: the ask is back', r.nt().value === '起動に失敗する依頼');
    }
    {
      // bounded: 50 drafts at most (the oldest go), each up to 20k characters
      const { api, box } = harness();
      const many = [];
      for (let i = 0; i < 60; i++) many.push({ ...card, id: 'c' + String(i).padStart(3, '0') + '-x' });
      api.applyState({ ...state, cards: many });
      // all written in one millisecond (the clock held still): a tie in `at` must not drop the
      // newest — left to the real clock this failed now and then, when the loop fit in one ms
      const now0 = Date.now, t0 = now0();
      Date.now = () => t0;
      try { for (const c of many) { api.openDetail(c); box().value = 'd' + c.id; } api.closeDetail('x'); } finally { Date.now = now0; }
      const o = stored(api);
      ok('★ drafts: at most 50 kept, the newest', Object.keys(o).length === 50 && !o['claude:c000-x'] && !!o['claude:c059-x']);
      api.openDetail(many[59]); box().value = 'x'.repeat(30000); api.closeDetail('x');
      ok('drafts: one draft is kept up to 20k characters', ((stored(api)['claude:c059-x'] || {}).t || '').length === 20000);
    }
  } catch (e) { ok('drafts — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
}
{
  // A card's terminal (in the panel) that ends: quit → dropped; one that failed at once (a resume
  // that says No conversation found, the trust question) stays with its reason, as in the strip
  console.log('== panel terminal exits ==');
  try {
    const api = runPage();
    const fake = (id, o) => { const p = { id, kind: 'resume', host: true, full: card.id, session: card.id, openedAt: Date.now(), gl: null, xt: { write() {}, dispose() {}, focus() {} }, el: { classList: { add() {}, remove() {}, contains: () => false }, remove() {}, contains: () => false }, ...o }; api.ptys.set(id, p); return p; };
    fake('pe1', {}); api.kanban.ptyExit('pe1', 1, '');
    fake('pe2', {}); api.kanban.ptyExit('pe2', 0, '');
    fake('pe3', { openedAt: Date.now() - 60000 }); api.kanban.ptyExit('pe3', 1, '');
    ok('★ panel terminal: a resume that fails at once (code>0 within 3 s) stays with its reason; a quit, or a failure later on, is dropped',
      api.ptys.has('pe1') && api.ptys.get('pe1').gone && !api.ptys.has('pe2') && !api.ptys.has('pe3') && api.ptyEnded.has(card.id));
  } catch (e) { ok('panel terminal exits — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  try {
    // 「ターミナルを終了しました」 goes once the session runs again (resumed from the send box), not only by ×/再開
    const api = runPage();
    const st = (cards) => ({ cards, agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: [] });
    const fake = (id, o) => { const p = { id, kind: 'resume', host: true, full: card.id, session: card.id, openedAt: Date.now() - 60000, gl: null, xt: { write() {}, dispose() {}, focus() {} }, el: { classList: { add() {}, remove() {}, contains: () => false }, remove() {}, contains: () => false }, ...o }; api.ptys.set(id, p); return p; };
    fake('pr1', {}); api.kanban.ptyExit('pr1', 0, '');
    api.applyState(st([{ ...card, alive: true, aliveKind: 'interactive', lastT: Date.now() - 100 }]));
    const stale = api.ptyEnded.has(card.id);
    api.applyState(st([{ ...card, alive: true, aliveKind: 'background', lastT: Date.now() + 5000 }]));
    ok('★ panel terminal: ended, then its session runs again and writes (resumed from the send box) → no longer 「終了しました」; the stale alive right after the exit does not count',
      stale && !api.ptyEnded.has(card.id));
    fake('pr2', { kind: 'attach' }); api.kanban.ptyExit('pr2', 0, '');
    api.applyState(st([{ ...card, alive: true, aliveKind: 'background', lastT: Date.now() + 5000 }]));
    const detached = api.ptyEnded.has(card.id);
    api.applyState(st([{ ...card, alive: false }]));
    api.applyState(st([{ ...card, alive: true, aliveKind: 'background', lastT: Date.now() + 6000 }]));
    ok('panel terminal: a detached attach (the session goes on) stays ended until it has stopped and runs again', detached && !api.ptyEnded.has(card.id));
  } catch (e) { ok('panel terminal ended — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  try {
    // a pane that ended, drawn into the panel again: no GPU context for it
    const api = runPage();
    let gls = 0;
    api.setFn('ptyGlOn', () => { gls++; });
    const mt = api.document.querySelector('#mterm'); mt.replaceChildren = () => {};
    api.ptys.set('pg1', { id: 'pg1', kind: 'resume', host: true, gone: true, full: card.id, session: card.id, gl: null, xt: { write() {}, dispose() {}, focus() {}, loadAddon() {} }, el: { parentNode: null, classList: { add() {}, remove() {}, contains: () => false }, remove() {}, contains: () => false, closest: () => null } });
    api.openDetail(card);
    ok('★ panel terminal: a pane that ended, put back into the panel, takes no GPU context', gls === 0);
  } catch (e) { ok('panel terminal gone pane — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  try {
    // a held permission prompt: 1-9 pick its choices only while it is on screen, and not right after
    // a terminal gave up the keys (/exit: what you type next was meant for it)
    const pc = { ...card, alive: true, aliveKind: 'background', aliveStatus: 'waiting', permAsk: { id: 'pa1', tool: 'Bash', what: 'rm -rf x', choices: [] } };
    const setup = (saved) => {
      const api = runPage(saved);
      api.applyState({ cards: [pc], agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: [] });
      const picks = [];
      api.setFn('permPick', (c, b) => picks.push(b.n));
      api.openDetail(pc);
      const box = api.document.querySelector('#mhist .askbox.held');
      box.dataset.perm = 'pa1'; box.contains = () => false;
      box.querySelectorAll = (q) => (q === '.askch' ? [{ n: 1, disabled: false, dataset: {} }, { n: 2, disabled: false, dataset: {} }] : []);
      return { api, picks };
    };
    const t1 = setup({ panelview: 'talk' });
    t1.api.key('2');
    const normal = t1.picks.join(',') === '2';
    const xt = { tagName: 'TEXTAREA', closest: (q) => (q === '.xterm' ? {} : null) };
    for (const f of t1.api.document.listeners.focusout || []) f({ target: xt });
    t1.api.key('1');
    const t2 = setup({ panelview: 'term' });
    t2.api.key('1');
    ok('★ permission digits: picked while the prompt is on screen; ignored right after a terminal lost the keys, and on the terminal view (the prompt is hidden there)',
      normal && t1.picks.length === 1 && t2.picks.length === 0);
  } catch (e) { ok('permission digits — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  // ターミナル / 会話 is one setting for every card (the header's #pviewseg); a parked terminal brought
  // back (ptyUnpark) shows its terminal without changing the setting
  try {
    const api = runPage({ panelview: 'talk' });
    const a = { ...card, id: 'aaaaaaaa-0000-4000-8000-00000000000a' }, b = { ...card, id: 'bbbbbbbb-0000-4000-8000-00000000000b' };
    api.applyState({ cards: [a, b], agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: [] });
    api.openDetail(a);
    const opened = api.panelView();
    api.ptyUnpark({ full: b.id });
    const unparked = [api.panel(), api.panelView(), api.store.panelview];
    api.openDetail(a);
    const back = api.panelView();
    api.panelPrefSet('term'); api.openDetail(b);
    ok('★ panel view: every card opens on the setting (会話); an unparked terminal shows ターミナル without saving it; the next card is on 会話 again; ターミナル set, the next is on it (' + [opened, unparked.join('/'), back, api.panelView(), api.store.panelview].join(' ') + ')',
      opened === 'talk' && unparked[0] === 'claude:' + b.id && unparked[1] === 'term' && unparked[2] === 'talk' && back === 'talk' && api.panelView() === 'term' && api.store.panelview === 'term');
  } catch (e) { ok('panel view setting — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
  // 裏で実行中 N with its tasks known (lib/bgtasks.js): a button on the card and in the panel, the
  // list it opens, 止める posted with what the app checks again (pid, parent, command hash)
  try {
    const api = runPage();
    const posted = [];
    api.win.webkit = { messageHandlers: { kanban: { postMessage: (m) => posted.push(m) } } };
    const t1 = { pid: 101, ppid: 100, pgid: 101, sig: 'd50c177f241b7442', id: 'bax', cmd: 'until grep -q EXIT x; do sleep 10; done', ageS: 30 * 3600, outIdleS: 3 * 3600, kind: 'loop', sleeping: true, stale: true };
    const t2 = { ...t1, pid: 102, sig: '0123456789abcdef', cmd: 'npm run build', kind: null, stale: false };
    // (column given: a send earlier in this file moved the shared card to Working, as the board does — goWorking)
    const bc = { ...card, column: 'needs-you', alive: true, aliveKind: 'interactive', turnEnded: true, background: { n: 2, shells: 2, agents: 0 }, bgTasks: [t1, t2], bgReaped: [{ t: Date.now(), cmd: 'sleep 3600' }] };
    const note = api.bgNote(bc);
    ok('★ bgtasks: 裏で実行中 N is a button that opens the list, marked when a wait loop is left looping', /<button class="bgrun bgopen stale"[^>]*data-id="aaaaaaaa-[^>]*>裏で実行中 2 ⟳<\/button>/.test(note));
    ok('bgtasks: without the list it stays the plain note', /^<span class="bgrun"/.test(api.bgNote({ ...bc, bgTasks: undefined })));
    api.applyState({ cards: [bc], agents: [], hours: 24, collisions: [], home: '/Users/me', trusted: [], bgAuto: true });
    api.openDetail(bc);
    const top = api.body().innerHTML;
    ok('★ bgtasks: the panel has 裏で実行中 N too, and says what the board stopped on its own', /class="bgrun bgopen/.test(top) && /止まらず回っていた裏の処理を止めました: sleep 3600/.test(top));
    const pop = api.document.querySelector('#bgpop');
    api.bgPopOpen({ dataset: { agent: 'claude', id: bc.id }, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, right: 50 }) });
    const ph = pop.innerHTML;
    ok('★ bgtasks: the list draws each task with 止める, 全部止める for the stale one, and the auto switch (on)',
      (ph.match(/class="mini bgkill"/g) || []).length === 2 && /止まらず回っている 1 件を全部止める/.test(ph) && /止まらず回っています/.test(ph) && /id="bgautock" checked/.test(ph) && /npm run build/.test(ph));
    api.bgStopTasks(bc, [t1]);
    const m = posted.find((x) => x.type === 'bgtask');
    ok('★ bgtasks: 止める posts pid, parent and command hash only', m && m.session === bc.id && JSON.stringify(m.tasks) === JSON.stringify([{ pid: 101, ppid: 100, sig: 'd50c177f241b7442' }]));
    api.bgPopRefresh();
    ok('bgtasks: a refresh with the list open runs', !!pop);
  } catch (e) { ok('bgtasks page — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
}

// ---- the key table (lib/ui/js/01-keymap.js): one table, every handler reads it ----
console.log('== keybindings: one table, no key left in a handler ==');
try {
  const kb = runPage();
  const ev = (o) => ({ key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: kb.document.body, preventDefault() { this.dp = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }, ...o });
  const press = (a, o) => { const e = ev(o); for (const f of a.document.listeners.keydown || []) { if (e.stopped) break; f(e); } return e; };
  const ids = kb.KM_DEFS.map((d) => d[0]), defs = kb.KM_DEFS.map((d) => d[3]);
  ok(`★ keymap: ${ids.length} actions, each with a group of the table, a label and a default that parses`,
    ids.length === 49 && kb.KM_DEFS.every((d) => d.length === 4 && kb.KM_GROUPS.some((g) => g[0] === d[1]) && d[2] && (d[3] === '' || kb.kmParse(d[3]))));
  ok('★ keymap: the ids are unique, and so are the defaults (a default is never two actions)', new Set(ids).size === ids.length && new Set(defs.filter(Boolean)).size === defs.filter(Boolean).length);
  ok('★ keymap: every default is allowed for its own action', kb.KM_DEFS.every((d) => kb.kmBad(d[0], d[3]) === ''));
  ok('keymap: no override at start, the table is the defaults', Object.keys(kb.kmOver()).length === 0 && kb.kmKey('nav.down') === 'j' && kb.kmKey('card.next') === '⌘]' && kb.kmKey('perm.deny') === '⌘⇧y');
  // what is shown: every action is in the ? list, every {token} of the list and the palette is an action
  const helpText = kb.SHORTCUTS.map(([g, rows]) => rows.map(([k, w]) => k + ' ' + w).join(' ')).join(' ');
  const tokens = (t) => [...t.matchAll(/\{([\w.]+)\}/g)].map((m) => m[1]);
  const palText = kb.PAL_ACTIONS.map((a) => a.k || '').join(' ');
  ok('★ keymap: every action is in the ? list (missing: ' + ids.filter((i) => !tokens(helpText).includes(i)).join(' ') + ')', ids.every((i) => tokens(helpText).includes(i)));
  ok('★ keymap: every {token} in the ? list and the palette names an action', [...tokens(helpText), ...tokens(palText)].every((t) => ids.includes(t)));
  ok('keymap: the palette and the list write the key as it is now (⌘N, ⇧R), never a bare {token}', !/\{[\w.]+\}/.test(kb.kmText(helpText + ' ' + palText)) && kb.kmText('{panel.reply}') === '⇧R' && kb.kmText('{new.meta}') === '⌘N' && kb.kmText('{go.left}') === '⌘←');
  // the count of what the handlers still compare by literal: named keys and digits only
  const FIXED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'PageUp', 'PageDown', ' ', '1', '2', '3', '4']);
  const lits = [];
  for (const f of ['75-keys.js', '90-help.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ui', 'js', f), 'utf8');
    for (const m of src.matchAll(/\b(?:k|e\.key)===('[^']*'|"[^"]*")/g)) lits.push([f, m[1].slice(1, -1)]);
  }
  const stray = lits.filter(([, l]) => !FIXED.has(l));
  ok(`★ keymap: 75-keys.js and 90-help.js compare only fixed keys by literal (${lits.length} comparisons; stray: ${stray.map((x) => x.join(':')).join(' ') || 'none'})`, lits.length > 10 && stray.length === 0);
  // positive control of that scan: it does see a configurable literal
  ok('keymap: … and the scan sees a stray one when there is one', [...`if(k==='j'){}`.matchAll(/\b(?:k|e\.key)===('[^']*'|"[^"]*")/g)].length === 1);
  // the handlers follow the table: the key that works is the one in it
  const clicks = () => kb.clicks.length;
  const n0 = clicks(); for (const k of ['a', 's', 't', 'p', 'L']) press(kb, { key: k });
  ok('★ keymap: s / a / t / p / L do nothing by default (pressed by mistake they changed the view); the actions stay, unbound', clicks() === n0 && kb.kmKey('done.toggle') === '' && kb.kmKey('theme.key') === '');
  ok('★ keymap: giving it x — x does it, a does not any more', kb.kmSet('done.toggle', 'x') === '' && (() => { const c = clicks(); press(kb, { key: 'a' }); const old = clicks(); press(kb, { key: 'x' }); return old === c && clicks() === c + 1; })());
  ok('keymap: the choice is saved as one versioned object with only what differs', JSON.stringify(JSON.parse(kb.store.keymap)) === JSON.stringify({ v: 1, keys: { 'done.toggle': 'x' } }));
  kb.kmReset('done.toggle');
  ok('keymap: reset unbinds it again, and the store no longer holds the choice', (() => { const c = clicks(); press(kb, { key: 'x' }); press(kb, { key: 'a' }); return clicks() === c; })() && !('keymap' in kb.store));
  // ⌘ keys, and the palette's two
  const help = kb.document.querySelector('#help'), h0 = help.hidden;
  press(kb, { key: '/', metaKey: true });
  ok('keymap: ⌘/ toggles the ? list by default', help.hidden !== h0);
  ok('★ keymap: ⌘/ moved to ⌘U — ⌘U does it, ⌘/ no longer', kb.kmSet('help.meta', '⌘u') === '' && (() => { const h = help.hidden; press(kb, { key: '/', metaKey: true }); const same = help.hidden === h; press(kb, { key: 'u', metaKey: true }); return same && help.hidden !== h; })());
  kb.kmResetAll();
  ok('keymap: ⌘⇧/ (⌘?) is the other way to the list; ⌘⇧N is nothing (three keys)', (() => { const h = help.hidden; press(kb, { key: '?', metaKey: true, shiftKey: true }); const a = help.hidden !== h; const p = kb.panel(); press(kb, { key: 'N', metaKey: true, shiftKey: true }); return a && kb.panel() === p; })());
  const pal0 = kb.kmSet('palette.colon', ';');
  ok('keymap: ; opens the palette once it is its key, and : does not', pal0 === '' && (() => { const e1 = press(kb, { key: ':' }); const e2 = press(kb, { key: ';' }); return !e1.dp && !!e2.dp; })());
  kb.kmResetAll(); kb.closePalette();
  // what can never be given, and a key that is taken
  const why = (id, k) => kb.kmSet(id, k);
  ok('★ keymap: a key another action has is refused, by name, and nothing changes', /「カードを下へ」/.test(why('nav.up', 'j')) && kb.kmKey('nav.up') === 'k' && !('keymap' in kb.store));
  ok('★ keymap: reserved keys are refused (⌘C ⌘V ⌘A ⌘Z ⌘Q ⌘R, Space, digits, Enter, arrows, PageDown)', ['⌘c', '⌘v', '⌘a', '⌘z', '⌘q', '⌘r', ' ', '5', 'Enter', 'ArrowDown', 'PageDown', 'Escape'].every((k) => why('nav.up', k) !== '') && kb.kmKey('nav.up') === 'k');
  ok('★ keymap: more than two keys at once is refused (⌘⇧ + a letter), ⌥ and ⌃ are never a key', why('nav.up', '⌘⇧x') !== '' && kb.kmCanon(ev({ key: 'x', altKey: true })) === '' && kb.kmCanon(ev({ key: 'x', ctrlKey: true })) === '' && kb.kmCanon(ev({ key: 'ArrowLeft', altKey: true, metaKey: true })) === '');
  ok('keymap: ⌘ + arrow is taken by the four movement actions only (their own defaults), ⌘W only by its own', why('nav.up', '⌘ArrowLeft') !== '' && why('go.left', '⌘ArrowUp') !== '' && why('new.meta', '⌘w') !== '' && kb.kmBad('close.meta', '⌘w') === '' && kb.kmBad('go.left', '⌘ArrowLeft') === '');
  ok('keymap: a letter, a symbol, ⇧ + letter, or ⌘ + one is fine', ['x', ';', '@', 'X', '⌘e', '⌘;', '⌘1'].every((k) => kb.kmBad('nav.up', k) === ''));
  ok('keymap: an unknown action or a key that is not one is refused', kb.kmSet('nope', 'x') !== '' && why('nav.up', 'Foo') !== '' && why('nav.up', '') !== '');
  // the key as it arrives: an IME left on, the yen key, caps
  ok('keymap: full-width ／ ？ ： and ・ and ¥ are the keys they stand for', kb.kmCanon(ev({ key: '／' })) === '/' && kb.kmCanon(ev({ key: '？' })) === '?' && kb.kmCanon(ev({ key: '：' })) === ':' && kb.kmCanon(ev({ key: '・' })) === '/' && kb.kmCanon(ev({ key: '¥', metaKey: true })) === '⌘\\');
  ok('keymap: a letter with ⌘ is the same with or without caps / ⇧ (⌘Y is ⌘y, ⌘⇧Y is ⌘⇧y); ⌘ + ⇧ + symbol is the symbol', kb.kmCanon(ev({ key: 'Y', metaKey: true })) === '⌘y' && kb.kmCanon(ev({ key: 'Y', metaKey: true, shiftKey: true })) === '⌘⇧y' && kb.kmCanon(ev({ key: '?', metaKey: true, shiftKey: true })) === '⌘?' && kb.kmCanon(ev({ key: 'G' })) === 'G');
  ok('keymap: a bare modifier is nothing', ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'Dead', 'Process'].every((k) => kb.kmCanon(ev({ key: k })) === ''));
  // presets
  ok('keymap: 標準 is the defaults; US配列向け moves only the palette to ; and is a preset while nothing else differs', kb.kmPreset('us') === '' && kb.kmKey('palette.colon') === ';' && kb.kmPresetNow() === 'us' && Object.keys(kb.kmOver()).join() === 'palette.colon' && kb.kmPreset('jis') === '' && kb.kmPresetNow() === 'jis' && kb.kmKey('palette.colon') === ':' && kb.kmPreset('dvorak') !== '');
  ok('★ keymap: every preset is valid on its own (each key allowed, no two actions on one key)', Object.entries(kb.KM_PRESETS).every(([, p]) => { const m = new Map(kb.KM_DEFS.map((d) => [d[0], d[3]])); for (const [i, k] of Object.entries(p)) { if (kb.kmBad(i, k)) return false; m.set(i, k); } return new Set([...m.values()].filter(Boolean)).size === [...m.values()].filter(Boolean).length; }));
  kb.kmSet('nav.up', 'x'); kb.kmSet('help.key', 'Q');
  ok('keymap: a custom set shows as カスタム (no preset), and 全部を既定に戻す clears it', kb.kmPresetNow() === '' && (kb.kmResetAll(), Object.keys(kb.kmOver()).length === 0 && !('keymap' in kb.store)));
  // saving and reading back: a new page on the same storage
  kb.kmSet('nav.up', 'x'); kb.kmSet('card.next', '⌘;');
  const again = runPage({ keymap: kb.store.keymap });
  ok('★ keymap: a reload keeps the choices (a new page on the same storage)', again.kmKey('nav.up') === 'x' && again.kmKey('card.next') === '⌘;' && again.kmKey('nav.down') === 'j');
  const dflt = (saved) => { const a = runPage(saved === undefined ? {} : { keymap: saved }); return a.KM_DEFS.every((d) => a.kmKey(d[0]) === d[3]); };
  ok('★ keymap: unreadable JSON, a wrong version, a list, or nothing → the defaults', dflt('{not json') && dflt('{"v":2,"keys":{"nav.up":"x"}}') && dflt('[]') && dflt('null') && dflt('"x"') && dflt('{"v":1}') && dflt('{"v":1,"keys":[1]}') && dflt(undefined));
  ok('★ keymap: one bad entry (unknown id, reserved key, not a string, a name that is not one) is the default for that action only', (() => { const a = runPage({ keymap: JSON.stringify({ v: 1, keys: { 'nav.up': 'x', 'nope': 'y', 'nav.down': '⌘c', 'nav.left': 5, 'nav.right': 'Foo' } }) }); return a.kmKey('nav.up') === 'x' && a.kmKey('nav.down') === 'j' && a.kmKey('nav.left') === 'h' && a.kmKey('nav.right') === 'l'; })());
  ok('★ keymap: a saved set that puts one key on two actions is the defaults, whole', dflt(JSON.stringify({ v: 1, keys: { 'nav.up': 'x', 'nav.down': 'x' } })) && dflt(JSON.stringify({ v: 1, keys: { 'nav.up': 'j' } })));
  const noStore = runPage(); Object.defineProperty(noStore.win, 'localStorage', { value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } });
  ok('keymap: storage that throws is no reason to fail (the choice lasts the session)', (() => { try { const r = noStore.kmSet('nav.up', 'x'); return r === '' && noStore.kmKey('nav.up') === 'x'; } catch (e) { return false; } })());
  // the settings panel: it draws every action, listens for one key, and says why not
  const ks = runPage();
  ks.openKeys();
  // the stub keeps one element per selector: the panel's own box is the one the page drew into
  const kbox = () => ks.document.querySelector('#mbody .keyset').innerHTML;
  const kh = kbox();
  ok('★ keymap settings: the panel draws every action once, with its key, and the presets', ids.every((i) => kh.includes('data-id="' + i + '"')) && (kh.match(/class="kkey/g) || []).length === ids.length && /data-p="jis"/.test(kh) && /data-p="us"/.test(kh) && /id="kall"/.test(kh) && ks.panel() === 'keys');
  ks.setKeyCap('nav.up');
  const cap = (o) => { const e = ev({ target: ks.document.body, ...o }); ks.kmCapKey(e); return e; };
  const e1 = cap({ key: 'j' });
  ok('keymap settings: while a key is being chosen, the key pressed is swallowed; a taken one is refused and it keeps listening', e1.dp && e1.stopped && ks.kmKey('nav.up') === 'k' && ks.keyCap() === 'nav.up' && /すでに/.test(kbox()));
  cap({ key: 'Shift', shiftKey: true });
  ok('keymap settings: a bare modifier waits for the key itself', ks.keyCap() === 'nav.up' && ks.kmKey('nav.up') === 'k');
  cap({ key: 'x', altKey: true });
  ok('keymap settings: ⌥ is refused with its reason', ks.keyCap() === 'nav.up' && /⌥/.test(kbox()) && ks.kmKey('nav.up') === 'k');
  cap({ key: 'x', isComposing: true });
  ok('keymap settings: a key during 日本語入力 is not taken', ks.keyCap() === 'nav.up' && /日本語入力/.test(kbox()) && ks.kmKey('nav.up') === 'k');
  cap({ key: 'c', metaKey: true });
  ok('keymap settings: ⌘C is refused', ks.keyCap() === 'nav.up' && ks.kmKey('nav.up') === 'k');
  cap({ key: 'Escape' });
  ok('keymap settings: Esc stops listening, keeps the key, and does not close the panel', ks.keyCap() === '' && ks.kmKey('nav.up') === 'k' && ks.panel() === 'keys');
  ks.setKeyCap('nav.up'); cap({ key: 'x' });
  ok('★ keymap settings: a free key is taken: the panel shows it, listening stops, it is saved', ks.keyCap() === '' && ks.kmKey('nav.up') === 'x' && JSON.parse(ks.store.keymap).keys['nav.up'] === 'x' && /data-id="nav\.up" title="[^"]*いまは x/.test(kbox()));
  ks.closeDetail('x'); ks.setKeyCap('nav.up');
  const e2 = ev({ key: 'z' }); ks.kmCapKey(e2);
  ok('★ keymap settings: with the panel gone, a stale listening gives the keys back (not swallowed)', ks.keyCap() === '' && !e2.dp && ks.kmKey('nav.up') === 'x');
} catch (e) { ok('keybindings — ' + e.stack.split('\n').slice(0, 3).join(' | '), false); }
console.log(`\n${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);
module.exports = { pass, fail };
