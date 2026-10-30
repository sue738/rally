'use strict';
const { t: tr } = require('../i18n.js');
/** send.js — writing to a session (continue, wake, hand over, or hold) and closing one. */
const fs = require('fs');
const Dispatch = require('../dispatch.js');
const Alive = require('../alive.js');
const Queue = require('../queue.js');
const Done = require('../done.js');
const Attach = require('../attach.js');
const Relay = require('../relay.js');
const { sessionRecord } = require('./sessions.js');

/** Stop every live worker for one session; true once none is left. */
function stopAndConfirm(id, a, opts = {}) {
  if (!a) return true;
  const shorts = (a && a.shorts && a.shorts.length ? a.shorts : [a && a.short]).filter(Boolean);
  if (!shorts.length) return false;
  for (const sh of shorts) Dispatch.stopBackground(sh);
  const deadline = Date.now() + (opts.waitMs || 4000);
  for (;;) {
    const live = Alive.sessions();
    if (!live) return false;                  // cannot confirm: do not resume
    const still = live.get(id);
    if (!still) return true;
    for (const sh of (still.shorts || [still.short]).filter(Boolean)) Dispatch.stopBackground(sh);
    if (Date.now() > deadline) return false;
    Dispatch.sleepMs(300);                          // a real sleep, not a spinning core
  }
}

/**
 * A message for a running session that is not the board's to stop (someone's terminal,
 * or mid-task): typed into its terminal (opts.type, from the app), or relayed as a peer
 * message. null: nothing could take it, hold it.
 */
function handOver({ agent, id, text, files, a, alive, dir, dirs, type, relay }) {
  // the peer channel addresses by name; an ambiguous name is held, not guessed
  const sameName = a.name ? [...alive.values()].filter((x) => x.name === a.name).length : 0;
  // a /command relayed as a message arrives as plain text, so it is never relayed
  const slash = /^\s*[\/／]/.test(String(text || ''));
  // typed, a /command runs and your words are yours — relayed, a "yes" approves nothing
  if (agent === 'claude' && a.kind === 'interactive' && type) {
    const Term = require('../term.js');
    const sess = sessionRecord({ agent, id, dirs });
    const r = (slash ? Term.typeCommand : Term.typeMessage)({ file: sess && sess.file, cwd: dir || (sess && sess.project), text: text + Attach.lines(files) });
    if (r.ok) { if (files.length) Attach.record({ agent, id, files }); return { ok: true, typed: true, to: r.title }; }
    if (!r.noTerminal) return { ok: false, error: r.error };
  }
  if (agent === 'claude' && slash && a.kind === 'interactive') {
    return { ok: false, typeable: true, error: tr('ターミナルで開いているセッションなので、/コマンドは端末で打つ必要があります') };
  }
  if (agent === 'claude' && a.name && sameName === 1 && relay !== false && !slash) {
    try {
      const r = Relay.relay({ name: a.name, text, sessionId: id });
      if (files.length) Attach.record({ agent, id, files });
      return { ok: true, relayed: true, to: a.name, pid: r.pid, log: r.log };
    } catch (e) { try { require('../bgtasks.js').appLog({ ev: 'relay-failed', id: String(id).slice(0, 8), error: String(e && e.message || e).slice(0, 200) }); } catch (x) { /* no log */ } }
  }
  if (agent === 'claude' && a.name && sameName > 1) return { hold: 'ambiguous', to: a.name };
  return null;
}

/** 今の作業後に送る, once the session is idle (lib/queue.js drain); null keeps it held. */
function handOverHeld(i, a, alive) {
  const r = handOver({ agent: i.agent, id: i.id, text: i.text, files: i.attachments || [], a, alive, dir: i.dir, type: !!i.type });
  return r && !r.hold && !r.typeable ? r : null;
}

/**
 * Send to one session. Not running → continue it. An idle background session → stop it
 * and continue it. Someone's terminal, or mid-task → hand over or hold it.
 */
function sendTo(opts = {}) {
  const { agent, id, model } = opts;
  if (!agent || !id) throw new Error('agent and session are required');
  Dispatch.resumableId(agent, id);
  const wrapup = !!opts.wrapup;
  if (!wrapup) { try { if (Done.read().byId[`${agent}:${id}`]) Done.clear({ agent, id }); } catch (e) { /* the message still goes */ } }
  // the session's own directory travels with the message: codex refuses to resume outside
  // a trusted directory, and claude resumed elsewhere loses its project's permissions
  let dir = opts.dir;
  if (!dir) { const rec = sessionRecord({ agent, id, hours: opts.hours || 24, dirs: opts.dirs }); dir = rec && rec.project; }
  const files = (opts.attachments || []).map(Attach.inside).filter(Boolean);
  // a resume cannot carry --add-dir, so files are copied into the session's directory
  const staged = files.length ? Attach.stageIn(dir && fs.existsSync(dir) ? dir : null, files) : [];
  const text = String(opts.text || '') + Attach.lines(staged);
  // antigravity: each message is its own run; refused while one runs, or both would write it
  if (agent === 'antigravity') {
    const Agy = require('../antigravity.js');
    const runs = Agy.conversations().get(id) || [];
    const last = runs[runs.length - 1];
    if (last && Agy.running(last)) return { error: tr('Antigravity はまだこの会話の作業中です。終わってから送ってください') };
    const r = Dispatch.dispatch({ agent, text, session: id, model, dir: dir || (last && last.cwd) || undefined });
    const got = Dispatch.outcome(r.log, 6000, r.pid);
    if (got && got.refused) return { error: tr('{agent} が受け付けませんでした: {why}', { agent: 'antigravity', why: got.refused }), log: r.log };
    return { ok: true, ...r, delivered: true };
  }
  const alive = opts.alive !== false ? Alive.sessions() : new Map();
  const W = opts.whenFree ? { whenFree: true, type: !!opts.type } : {};
  if (!alive) {                               // unknown: hold rather than risk a copy
    Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W });
    return { ok: true, queued: true, why: 'unknown' };
  }
  const a = alive.get(id);
  // 今の作業後に送る: held until idle and behind anything already held, to keep order;
  // `ours` (the app's own terminal) is typed there by the page
  if (opts.whenFree) {
    const behind = Queue.read().some((i) => i.agent === agent && i.id === id);
    if (behind || (a && (a.status !== 'idle' || opts.ours))) {
      Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W, ours: !!(opts.ours && a) });
      return { ok: true, queued: true, why: 'whenfree' };
    }
  }
  // an ordinary send stays behind ordinary ones already held for this session: sent at once it would arrive first
  // (the held ones went later, merged, after the session had read the newer message)
  // (not behind a relay still on its way: that one is delivered already as far as order goes, and an item queued behind
  // it for a session in someone's terminal waited for the terminal to close — a message never arrived on 10-23)
  if (!opts.whenFree && Queue.read().some((i) => i.agent === agent && i.id === id && !i.whenFree && !i.relay && !(i.fails >= Queue.MAX_FAILS))) {
    Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W });
    return { ok: true, queued: true, why: 'behind' };
  }
  if (a && !Queue.wakeable(a)) {
    const h = handOver({ agent, id, text, files, a, alive, dir, dirs: opts.dirs, type: opts.type, relay: opts.relay });
    // a relay is a promise, not a delivery: queued until the carrier's log says SENT
    if (h && h.relayed) {
      try { Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W, relay: { log: h.log, pid: h.pid } }); } catch (e) { /* the hop is on its way either way */ }
      return { ...h, pending: true };
    }
    if (h && !h.hold) return h;
    Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W });
    // why it could not be handed over now (a held message should be rare: busy sessions are relayed), for the app's log
    const whyHeld = h && h.hold ? h.hold : !a.name ? 'no name to relay to' : [...alive.values()].filter((x) => x.name === a.name).length > 1 ? 'name shared' : /^\s*[\/／]/.test(String(text || '')) ? '/command' : opts.relay === false ? 'relay off' : 'relay failed';
    if (h && h.hold === 'ambiguous') return { ok: true, queued: true, why: 'ambiguous', to: h.to, whyHeld };
    return { ok: true, queued: true, why: a.kind === 'background' ? 'busy' : 'interactive', whyHeld };
  }
  // stop every worker and confirm before resuming: one left running makes the resume fork a copy
  if (a && !stopAndConfirm(id, a)) {
    Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W });
    return { ok: true, queued: true, why: 'busy' };
  }
  // a forked copy is stopped inside Dispatch.resume; a fork or a refusal is not a delivery
  const resume = () => Dispatch.resume({ agent, id, a, text, model, effort: opts.effort, dir: dir && fs.existsSync(dir) ? dir : undefined });
  // just stopped: `claude agents` no longer lists it a moment before the CLI itself lets go, and a resume in that gap forks a copy
  if (a) Dispatch.sleepMs(1200);
  let r = resume();
  // forked anyway: the CLI had not let go yet. Once more after a pause, here, instead of a held retry that wakes it seconds later
  if (r.copy && !r.unchecked && a) { Dispatch.sleepMs(1500); const r2 = resume(); if (!r2.copy) r = r2; }
  if (r.copy && r.unchecked) {
    // it forks on every try: not held for the queue to fork again
    Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W });
    try { Queue.withLock(() => { const it = Queue.read(); const x = it.filter((y) => y.agent === agent && y.id === id).pop(); if (x) { x.fails = Queue.MAX_FAILS; x.error = Queue.UNCHECKED; } Queue.write(it); }); } catch (e) { /* the refresh shows it held */ }
    return { ok: false, queued: true, why: 'unchecked', attachable: true, error: Queue.UNCHECKED };
  }
  if (r.copy) {
    Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W });
    return { ok: true, queued: true, why: 'forked', copy: r.copy };
  }
  if (r.refused) {
    if (r.busy) { Queue.add({ agent, id, text, model, dir, attachments: files, wrapup, ...W }); return { ok: true, queued: true, why: 'busy' }; }
    // the CLI kept it itself: sending again would deliver it twice
    if (r.saved) return { ok: false, saved: true, log: r.log, error: tr('{agent} が受け付けませんでした(メッセージは {agent} 側に保存され、次にこのセッションが起動したときに届きます): {why}', { agent, why: r.refused }) };
    return { ok: false, log: r.log, error: tr('{agent} が受け付けませんでした: {why}', { agent, why: r.refused }) };
  }
  if (files.length) Attach.record({ agent, id, files });
  return { ok: true, delivered: true, woke: !!a, pid: r.pid, log: r.log, argv: r.argv };
}

/**
 * 今すぐ送る: one held message sent the ordinary way. Claimed under the queue's lock so a
 * concurrent drain cannot send it twice, and removed only once the send went.
 */
function sendHeldNow({ agent, id, key, type, dirs }) {
  if (!key) throw new Error('key is required');
  const t = Queue.take({ agent, id, key });
  if (t.claimed) return { ok: true, going: true };
  if (!t.item) return { error: tr('もう届いたか、取り消されています') };
  const i = t.item;
  let r;
  try { r = sendTo({ agent, id, text: i.text, model: i.model || undefined, dir: i.dir || undefined, dirs, type, wrapup: !!i.wrapup }); }
  catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  // failed: it stays, with the reason, for もう一度送る
  try { Queue.release({ agent, id, key, token: t.token, done: !!(r && (r.ok || r.queued || r.saved)), error: r && !r.ok ? String(r.error || tr('届けられませんでした')).slice(0, 300) : '' }); }
  catch (e) { /* its claim runs out and it is held again */ }
  return r;
}

/** What a session is asked to do on its way out: it writes its own memory, under its own permissions. */
const WRAPUP = [
  '[rally] このセッションをここで完了にします。次だけやって終了してください。',
  '1. この作業で得た「次回以降に効く学び」があれば、あなたのメモリ運用の規約に従って保存する(該当する既存メモリがあれば新規作成せず更新する)。学びが無ければ何も書かない。',
  '2. やり残しがあれば1行ずつ挙げる。無ければ「なし」と書く。',
  '3. それ以外の作業はしない。',
].join('\n');

/** Close a session and, when asked, have it write down what it learned (held if it is busy). */
function finish(opts = {}) {
  const { agent, id } = opts;
  if (!agent || !id) throw new Error('agent and session are required');
  Dispatch.recordId(agent, id);
  if (opts.undo) return { ok: true, undone: true, ...Done.clear({ agent, id }) };
  // 待ちにする: set aside, not finished
  if (opts.park) return { ok: true, parked: true, ...Done.set({ agent, id, wrapup: 'none', lane: 'stale' }) };
  if (!opts.memory) return { ok: true, ...Done.set({ agent, id, wrapup: 'none' }) };
  // 'queued' goes in before the ask: a drain in another process can deliver it before sendTo returns
  const before = Done.read().byId[`${agent}:${id}`];
  Done.set({ agent, id, wrapup: 'queued' });
  let r;
  try { r = sendTo({ agent, id, text: WRAPUP, alive: opts.alive, dir: opts.dir, wrapup: true }); }
  catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  // the ask did not go: restore the card
  if (!r.ok && !r.queued) {
    try { if (before) Done.put({ agent, id, value: before }); else Done.clear({ agent, id }); } catch (e) { /* shown as it is */ }
    return { ok: false, error: r.error || tr('完了の依頼を届けられませんでした'), ...(r.saved ? { saved: true } : {}) };
  }
  // stays 'queued' until the queue delivers it
  if (r.queued || r.pending) return { ok: true, queued: true, ...Done.read().byId[`${agent}:${id}`] };
  return { ok: true, pid: r.pid, log: r.log, woke: r.woke, ...(Done.delivered({ agent, id }) || Done.read().byId[`${agent}:${id}`]) };
}

/** マージして片付け / 片付け for a session's PR. The directory is looked up, never taken from the caller. */
function prFinish(opts = {}) {
  const { agent, id } = opts;
  if (!agent || !id) throw new Error('agent and session are required');
  if (agent !== 'claude' && agent !== 'codex') throw new Error('unknown agent');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/.test(String(id))) throw new Error('bad session id');
  const sess = sessionRecord({ agent, id, hours: opts.hours || 720, dirs: opts.dirs });
  if (!sess || !sess.project) return { ok: false, steps: [], error: tr('このセッションの記録が見つかりません') };
  const Remove = require('../remove.js');
  return require('../pr.js').finish({
    dir: sess.project, agent, id, merge: !!opts.merge,
    reg: agent === 'claude' ? Remove.registry() : null, claude: Dispatch.binaryFor('claude') || 'claude',
    done: () => finish({ agent, id }),
  });
}

module.exports = { stopAndConfirm, handOver, handOverHeld, sendTo, sendHeldNow, WRAPUP, finish, prFinish };
