'use strict';
/**
 * etalog.js — what the completion estimate (lib/eta.js) said, turn by turn, and how it came out.
 *
 * record(): called with every refresh the page is open for; a turn's estimate is written to
 * <home>/eta/log.jsonl when it is the first one or differs from the last one written by as much as the
 * page would change the number it shows (a quarter of what was left, at least 30 s), so the log holds
 * the revisions a person saw, not every refresh. Each line also keeps what was known then that a later
 * formula might use (what the agent was doing, the turn's place in the session, the prompt's length, the
 * hour, how long since it last wrote). When a turn is seen to have ended, one {kind:'end'} line keeps its
 * real end and length, so the log stands without the transcripts (a turn ends at the last line before
 * your next message).
 *
 * report(): joins the log with how the turns really ended: how often each estimate moved and which way,
 * and how close every estimate was (half to twice the real time, a third to three times, whether the real
 * end fell in the range), by time into the turn and by what it was made from. `rally eta-report`.
 */
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Eta = require('./eta.js');

const KEEP_MS = 24 * 3600 * 1000;
const dir = () => Paths.akHome('eta');
const logFile = () => path.join(dir(), 'log.jsonl');
// the page keeps the number on screen unless the new one differs by this much (lib/ui/js/00-core.js etaSettle)
const moved = (shownAt, at, now) => Math.abs(at - shownAt) >= Math.max(30000, 0.25 * Math.max(shownAt - now, 0));

/** Write the estimates of these cards that are new or revised, and the end of the turns that have ended. eventsOf(card) gives a card's events. Returns how many lines were written. */
function record(cards, now = Date.now(), eventsOf = null) {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const lastF = path.join(dir(), 'last.json');
  let last = {};
  try { last = JSON.parse(fs.readFileSync(lastF, 'utf8')) || {}; } catch (e) { last = {}; }
  const lines = [];
  for (const c of cards) {
    if (!c.eta || !c.turnStart) continue;
    const key = `${c.agent}:${c.id}:${c.turnStart}`, p = last[key];
    if (p && !moved(p.at, c.eta.at, now) && p.over === !!c.eta.over) continue;
    const ev = eventsOf ? eventsOf(c) || [] : [];
    const human = ev.find((e) => e.kind === 'user' && e.human && e.t === c.turnStart);
    lines.push(JSON.stringify({ t: now, agent: c.agent, id: c.id, project: c.project || '', turnStart: c.turnStart, tools: c.turnTools || 0,
      at: c.eta.at, lo: c.eta.lo, hi: c.eta.hi, over: !!c.eta.over, basis: c.eta.basis, n: c.eta.n,
      lastTool: c.lastTool || '', turnNo: c.humanTurns || 0, chars: (human && human.chars) || 0, hour: new Date(now).getHours(), sinceLast: c.lastT ? now - c.lastT : 0 }));
    last[key] = { at: c.eta.at, t: now, over: !!c.eta.over };
  }
  // turns that were tracked and have now ended: keep the real end
  const open = Object.keys(last).filter((k) => !last[k].closed);
  if (open.length && eventsOf) {
    for (const c of cards) {
      const pre = `${c.agent}:${c.id}:`, mine = open.filter((k) => k.startsWith(pre));
      if (!mine.length) continue;
      const spans = Eta.spans(eventsOf(c) || []);
      for (const k of mine) {
        const start = +k.slice(pre.length), sp = spans.find((x) => x.start === start);
        if (!sp) continue;
        lines.push(JSON.stringify({ kind: 'end', t: now, agent: c.agent, id: c.id, turnStart: start, end: sp.end, ms: sp.ms, tools: sp.tools }));
        last[k].closed = true;
      }
    }
  }
  if (!lines.length) return 0;
  for (const k of Object.keys(last)) if (now - last[k].t > KEEP_MS) delete last[k];
  fs.appendFileSync(logFile(), lines.join('\n') + '\n', { mode: 0o600 });
  fs.writeFileSync(lastF + '.tmp', JSON.stringify(last), { mode: 0o600 });
  fs.renameSync(lastF + '.tmp', lastF);
  return lines.length;
}

function read(sinceMs) {
  let text = '';
  try { text = fs.readFileSync(logFile(), 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l) continue; try { const j = JSON.parse(l); if (j.t >= sinceMs) out.push(j); } catch (e) { /* a torn line */ } }
  return out;
}

const med = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const min = (ms) => (ms / 60000).toFixed(1);
const pc = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '–');

/** How one group of estimates came out: rows are {pred, real, lo, hi} in ms from the moment each was made. */
function accuracy(rows) {
  const r = rows.map((x) => x.pred / x.real);
  return {
    n: rows.length,
    half2x: rows.filter((x, i) => r[i] >= 0.5 && r[i] <= 2).length,
    third3x: rows.filter((x, i) => r[i] >= 1 / 3 && r[i] <= 3).length,
    inRange: rows.filter((x) => x.real >= x.lo && x.real <= x.hi).length,
    bias: med(r),
    absMin: med(rows.map((x) => Math.abs(x.pred - x.real))) / 60000,
  };
}
const accLine = (name, a) => a.n ? `  ${name.padEnd(14)} ${String(a.n).padStart(4)}件  半分〜2倍 ${pc(a.half2x, a.n).padStart(4)}  1/3〜3倍 ${pc(a.third3x, a.n).padStart(4)}  範囲に入った ${pc(a.inRange, a.n).padStart(4)}  予測/実際(中央) ${a.bias.toFixed(2)}  中央の誤差 ${a.absMin.toFixed(1)}分` : '';

/**
 * The report. sessions: [{agent, id, events}] to read the real ends from (a test passes them; otherwise the
 * transcripts are scanned).
 */
function report({ days = 7, now = Date.now(), sessions = null } = {}) {
  const all = read(now - days * 86400000);
  const log = all.filter((l) => l.kind !== 'end');
  const ends = new Map(all.filter((l) => l.kind === 'end').map((l) => [`${l.agent}:${l.id}:${l.turnStart}`, l]));
  const turns = new Map();
  for (const l of log) { const k = `${l.agent}:${l.id}:${l.turnStart}`; if (!turns.has(k)) turns.set(k, []); turns.get(k).push(l); }
  if (!turns.size) return { turns: 0, text: `見積もりの記録がありません(過去${days}日)。Rally を開いて Working のカードに ⏱ が出ると、記録が始まります。` };
  // a turn whose end was not logged is looked for in the transcripts
  if (!sessions && [...turns.keys()].some((k) => !ends.has(k))) {
    const Scan = require('./scan.js');
    const since = Math.min(...log.map((l) => l.turnStart)) - 3600000;
    sessions = [];
    for (const f of Scan.sessions({ sinceMs: since }).found) for (const s of f.sessions) sessions.push(s);
  }
  const by = new Map((sessions || []).map((s) => [s.agent + ':' + s.id, s]));
  const done = [], running = [], rows = [];
  for (const [k, ls] of turns) {
    ls.sort((a, b) => a.t - b.t);
    const first = ls[0], s = by.get(first.agent + ':' + first.id);
    const en = ends.get(k);
    const span = en ? { start: en.turnStart, end: en.end, ms: en.ms } : s ? Eta.spans(s.events).find((x) => x.start === first.turnStart) : null;
    if (!span) { running.push(k); continue; }
    const revs = ls.slice(1).map((l, i) => ({ by: l.at - ls[i].at, rel: (l.at - ls[i].at) / Math.max(ls[i].at - l.t, 60000) }));
    const t = { key: k, revisions: revs.length, later: revs.filter((r) => r.by > 0).length, earlier: revs.filter((r) => r.by < 0).length,
      biggest: revs.length ? Math.max(...revs.map((r) => Math.abs(r.by))) : 0, real: span.ms, estimates: ls.length };
    done.push(t);
    for (const l of ls) {
      const real = span.end - l.t;
      if (real <= 0) continue;                     // made after the turn ended (the log lags by a refresh)
      rows.push({ pred: l.at - l.t, real, lo: l.lo - l.t, hi: l.hi - l.t, elapsed: l.t - l.turnStart, basis: l.basis, isFirst: l === first, isLast: l === ls[ls.length - 1] });
    }
  }
  const out = [];
  out.push(`完了までの目安 レポート(過去${days}日)`);
  out.push(`記録した作業 ${turns.size} 件(終わったもの ${done.length}、まだ動いている/読めないもの ${running.length})、見積もり ${log.length} 回`);
  if (done.length) {
    const rv = done.map((d) => d.revisions);
    out.push('');
    out.push('■ 見積もりの変化(終わった作業ごと)');
    out.push(`  1件あたりの更新 中央 ${med(rv)}回、最多 ${Math.max(...rv)}回。更新が無かったもの ${done.filter((d) => !d.revisions).length} 件`);
    const tot = done.reduce((a, d) => a + d.revisions, 0), lat = done.reduce((a, d) => a + d.later, 0), ear = done.reduce((a, d) => a + d.earlier, 0);
    out.push(`  更新の向き: 遅くなった ${lat}回 / 早くなった ${ear}回(計 ${tot}回)。1回で一番大きく動いたのは ${min(Math.max(...done.map((d) => d.biggest)))}分`);
  }
  if (rows.length) {
    out.push('');
    out.push('■ 当たり具合(見積もりを出した時点から、実際に終わるまでの残り時間と比べる)');
    out.push(accLine('すべて', accuracy(rows)));
    const firsts = rows.filter((r) => r.isFirst), lasts = rows.filter((r) => r.isLast);
    out.push(accLine('最初の見積もり', accuracy(firsts)));
    out.push(accLine('最後の見積もり', accuracy(lasts)));
    out.push('  経過時間ごと');
    for (const [lo, hi, n] of [[0, 2, '2分まで'], [2, 10, '2〜10分'], [10, 30, '10〜30分'], [30, 1e9, '30分以降']]) out.push(accLine('  ' + n, accuracy(rows.filter((r) => r.elapsed >= lo * 60000 && r.elapsed < hi * 60000))));
    out.push('  根拠ごと');
    for (const b of ['session', 'project', 'all', 'prior']) out.push(accLine('  ' + b, accuracy(rows.filter((r) => r.basis === b))));
  }
  out.push('');
  out.push('(「半分〜2倍」は 予測÷実際 が 0.5〜2 に入った割合。過去60日の検証では 約3.5割、1/3〜3倍で約5割でした。)');
  return { turns: turns.size, done: done.length, running: running.length, estimates: log.length, accuracy: rows.length ? accuracy(rows) : null, text: out.filter((l) => l !== '').length ? out.join('\n') : '' };
}

module.exports = { record, report, read, logFile, moved };
