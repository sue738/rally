'use strict';
const { t: tr } = require('./i18n.js');
/**
 * takeover.js — move a session open in another terminal into this app's panel.
 *
 * Resuming while that claude runs would fork the conversation, so an idle one
 * is closed with SIGTERM (claude 2.1.x exits cleanly and keeps the transcript;
 * typing /exit is unsafe onto a half-written input line) and we wait until
 * `claude agents` drops it. Never SIGKILL. The pid is verified first: this
 * user's, a claude, and not started after the registered one.
 */
const Env = require('./env.js');
const path = require('path');
const { spawnSync } = require('child_process');
const Dispatch = require('./dispatch.js');
const Alive = require('./alive.js');

const WAIT_MS = 10000;
// startedAt is when the claude registered, a moment after its process began
const START_SLACK_MS = 5000;

/** Can this session be closed there? null when it can; else {error, why}. Pure. */
function refusal(a) {
  if (a.kind !== 'interactive') return { error: tr('ほかの端末で開いているセッションではありません'), why: 'kind' };
  if ((a.copies || 1) > 1) return { error: tr('このセッションは {n} つの claude で開かれています。どれを閉じるか決められないので移せません', { n: a.copies }), why: 'copies' };
  if (a.status === 'busy') return { error: tr('作業中なので移せません(ターンが終わってからもう一度)'), why: 'busy' };
  if (a.status === 'waiting' || a.waitingFor || a.state === 'blocked') return { error: tr('確認を待っているので移せません(その端末で答えてから)'), why: 'waiting' };
  if (a.status !== 'idle') return { error: tr('いま待機中か分からないので移せません'), why: 'status' };
  if (!(Number(a.pid) > 1)) return { error: tr('その claude のプロセスが分かりません'), why: 'pid' };
  return null;
}

/** uid, command and start of a pid, from ps. null when it is not running. */
function psInfo(pid) {
  const q = (col) => {
    try { const r = spawnSync('ps', ['-o', `${col}=`, '-p', String(pid)], { encoding: 'utf8', timeout: 4000 }); return r.status === 0 ? r.stdout.trim() : null; }
    catch (e) { return null; }
  };
  const uid = q('uid');
  if (uid == null || uid === '') return null;
  const start = Date.parse(q('lstart') || '');
  return { uid: Number(uid), comm: q('comm') || '', args: q('args') || '', start: Number.isFinite(start) ? start : null };
}

/**
 * Is this pid still that session's claude? Pure over what ps said.
 * The selftest's stand-in is its fake binary run by sh (`/bin/sh <fake> …`): only under the selftest.
 */
function verify(info, a, uid, bin) {
  if (!info) return tr('その claude はもう動いていません');
  if (info.uid !== uid) return tr('そのプロセスはあなたのものではありません');
  const words = String(info.args || '').split(/\s+/);
  const fake = !!Env.get('SELFTEST') && !!bin && (words[0] === bin || words[1] === bin);
  if (path.basename(info.comm) !== 'claude' && !fake) return tr('そのプロセスは claude ではありません');
  if (a.startedAt && info.start && info.start > a.startedAt + START_SLACK_MS) return tr('その番号のプロセスはあとから始まった別のものです');
  return null;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * Close the other terminal's claude of this session and wait until it is gone.
 * @param {{id, sessions?, ps?, kill?, isAlive?, sleep?, waitMs?, uid?, bin?}} o — the rest are for tests
 * @returns {{ok: true, closed: boolean, ms?}|{error, why}}
 */
function run(o = {}) {
  const id = Dispatch.resumableId('claude', o.id);
  const sessions = o.sessions || (() => Alive.sessions());
  const ps = o.ps || psInfo;
  const kill = o.kill || ((pid, sig) => process.kill(pid, sig));
  const isAlive = o.isAlive || alive;
  const sleep = o.sleep || Dispatch.sleepMs;
  const waitMs = o.waitMs || WAIT_MS;
  const uid = o.uid != null ? o.uid : process.getuid();
  const live = sessions();
  if (!live) return { error: tr('Claude にセッションが動いているか確かめられませんでした(閉じていません)'), why: 'unknown' };
  const a = live.get(id);
  // nobody runs it now: nothing to close
  if (!a) return { ok: true, closed: false };
  const no = refusal(a);
  if (no) return no;
  const pid = Number(a.pid);
  const bad = verify(ps(pid), a, uid, o.bin !== undefined ? o.bin : Dispatch.binaryFor('claude'));
  if (bad) return { error: tr('{why}(閉じていません)', { why: bad }), why: 'verify' };
  try { kill(pid, 'SIGTERM'); } catch (e) { return { error: tr('閉じられませんでした: {why}', { why: e.code || e.message }), why: 'kill' }; }
  // bounded by the naps and by the clock (a slow `claude agents` must not stretch it)
  let waited = 0; const t0 = Date.now();
  while (waited < waitMs && Date.now() - t0 < waitMs + 5000) {
    sleep(250); waited += 250;
    if (isAlive(pid)) continue;
    const m = sessions();
    if (!m) continue;
    const b = m.get(id);
    if (!b) return { ok: true, closed: true, ms: waited };
    // someone opened it again meanwhile: a resume here would be the copy
    if (Number(b.pid) !== pid) return { error: tr('ほかでまた開かれたので、ここでは開いていません'), why: 'reopened' };
  }
  return { error: tr('その端末の claude が {s} 秒たっても終わりませんでした。ここでは開いていません(強制終了もしていません)', { s: Math.round(waitMs / 1000) }), why: 'stuck', stillRunning: isAlive(pid) };
}

module.exports = { WAIT_MS, refusal, verify, psInfo, run };
