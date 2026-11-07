'use strict';
/**
 * diagnose.js — 使い方診断: the last few weeks of your sessions, counted (models and their cost, context sizes,
 * skills and commands used, what you had to say twice, the stop hooks' complaints, errors), written next to a
 * prompt for a new Claude session that digs into them and proposes what to change: models and depth, skills,
 * CLAUDE.md, memory, hooks, settings. The counting is here, with no model; the reading is the new session's.
 *
 * Everything stays on this Mac: the files go into the chosen folder's .rally/ (git ignores it), and the session
 * that reads them is one of yours.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const Paths = require('./paths.js');

const MAX_FILE_BYTES = 150 * 1024 * 1024;
// what you say when it went wrong, or when it should not have needed saying: kept as examples for the reader
const CORRECTION = /(違う|ちがう|そうじゃない|そういうことじゃない|じゃなくて|やり直し|戻して|直って(ない|いない)|治って(ない|いない)|まだ(直って|治って|できて|動かない|出ない)|日本語で|短く|長すぎ|わかりにく|分かりにく|読みにく|勝手に|聞かずに|確認してから|なんで(できない|動かない)|ダメ|だめ|やめて|いらない|要らない)/;

function skillsInstalled() {
  const out = [];
  for (const d of [Paths.claudeDir('skills')]) {
    let names = []; try { names = fs.readdirSync(d); } catch (e) { continue; }
    for (const n of names) { try { if (fs.statSync(path.join(d, n, 'SKILL.md')).isFile()) out.push(n); } catch (e) { /* not a skill */ } }
  }
  return out.sort();
}

/** One transcript, counted. Claude Code's format; codex rollouts get the usage only. */
function countFile(file, agent) {
  let text = '';
  try { const st = fs.statSync(file); if (st.size > MAX_FILE_BYTES) return null; text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const lines = text.split('\n').filter(Boolean);
  const r = { file, agent, entrypoint: '', humanMsgs: 0, assistantMsgs: 0, tools: {}, skills: {}, commands: {}, stopHooks: {}, compactions: 0, errors: 0, corrections: [], subagentCalls: 0, modes: {}, first: 0, last: 0, efforts: [] };
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch (x) { continue; }
    const t = Date.parse(e.timestamp || '') || 0;
    if (t) { if (!r.first || t < r.first) r.first = t; if (t > r.last) r.last = t; }
    if (agent !== 'claude') continue;
    if (!r.entrypoint && typeof e.entrypoint === 'string') r.entrypoint = e.entrypoint;
    if (e.type === 'system' && e.subtype === 'compact_boundary') r.compactions++;
    const c = e.message && e.message.content;
    // the stop hooks' complaints come back as meta lines
    if (e.type === 'user' && typeof c === 'string' && /^Stop hook feedback/.test(c)) { const k = c.replace(/^Stop hook feedback:?\s*/, '').replace(/\s+/g, ' ').replace(/\d+/g, 'N').slice(0, 40); r.stopHooks[k] = (r.stopHooks[k] || 0) + 1; continue; }
    if (e.type === 'user' && typeof e.permissionMode === 'string') r.modes[e.permissionMode] = (r.modes[e.permissionMode] || 0) + 1;
    if (e.type === 'user' && typeof c === 'string' && !e.isMeta && !e.isSidechain && !e.isCompactSummary) {
      const cm = /^<command-name>\/?([^<]+)<\/command-name>/.exec(c);
      if (cm) { r.commands[cm[1]] = (r.commands[cm[1]] || 0) + 1; const ef = cm[1] === 'effort' && /<command-args>([^<]*)</.exec(c); if (ef && ef[1].trim()) r.efforts.push(ef[1].trim()); continue; }
      if (/^</.test(c) || /^\[(Rally|rally)\]|This session is being continued/.test(c)) continue;
      r.humanMsgs++;
      if (CORRECTION.test(c) && r.corrections.length < 8) r.corrections.push({ t, text: c.replace(/\s+/g, ' ').slice(0, 160) });
    }
    if (e.type === 'assistant' && Array.isArray(c)) {
      r.assistantMsgs++;
      for (const b of c) {
        if (!b || b.type !== 'tool_use') continue;
        const n = String(b.name || '');
        r.tools[n] = (r.tools[n] || 0) + 1;
        if (n === 'Skill' && b.input && b.input.skill) r.skills[b.input.skill] = (r.skills[b.input.skill] || 0) + 1;
        if (/^(Agent|Task)$/.test(n)) r.subagentCalls++;
      }
    }
    if (e.type === 'user' && Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result' && b.is_error) r.errors++;
  }
  try {
    const u = require('./lastMessage.js').usageOf(lines, agent);
    if (u) { r.usd = Math.round((u.usd || 0) * 100) / 100; r.ctx = u.ctx || 0; r.out = u.outTok || 0; r.by = u.by || {}; r.model = u.model || ''; }
  } catch (e) { /* counted without the cost */ }
  return r;
}

const add = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v; return into; };
const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

/** Count the sessions active in the last `days` days. */
function collect({ days = 14, now = Date.now(), titles = {} } = {}) {
  const since = now - days * 864e5;
  const Scan = require('./scan.js');
  const r = Scan.sessions({ sinceMs: since });
  const sessions = [];
  for (const f of r.found || []) for (const s of f.sessions || []) {
    if (!s || !s.file || (s.agent !== 'claude' && s.agent !== 'codex')) continue;
    if (s.parentId) continue;   // subagents are counted with their parent's calls
    const c = countFile(s.file, s.agent);
    if (!c || !c.last || c.last < since) continue;
    // started by a script (`claude -p`, the SDK) or by Rally itself: their cost counts, their words are not yours
    const scripted = !!s.automated || /^sdk/.test(c.entrypoint || '') || s.entrypoint === 'sdk-cli';
    sessions.push({ id: s.id, title: titles[`${s.agent}:${s.id}`] || '', project: s.project || '', scripted, ...c });
  }
  const mine = sessions.filter((s) => !s.scripted), scripted = sessions.filter((s) => s.scripted);
  const byDir = {};
  for (const s of scripted) { const k = (s.project && path.basename(s.project)) || '(フォルダ不明)'; byDir[k] = (byDir[k] || 0) + 1; }
  const sum = { sessions: mine.length, scripted: scripted.length, scriptedUsd: Math.round(scripted.reduce((a, s) => a + (s.usd || 0), 0)),
    scriptedBy: Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 6),
    days, humanMsgs: 0, usd: 0, compactions: 0, errors: 0, subagentCalls: 0, tools: {}, skills: {}, commands: {}, stopHooks: {}, modes: {}, models: {}, efforts: {} };
  for (const s of mine) {
    sum.humanMsgs += s.humanMsgs; sum.usd += s.usd || 0; sum.compactions += s.compactions; sum.errors += s.errors; sum.subagentCalls += s.subagentCalls;
    add(sum.tools, s.tools); add(sum.skills, s.skills); add(sum.commands, s.commands); add(sum.stopHooks, s.stopHooks); add(sum.modes, s.modes);
    for (const e of s.efforts) sum.efforts[e] = (sum.efforts[e] || 0) + 1;
    for (const [m, v] of Object.entries(s.by || {})) { const x = sum.models[m] || (sum.models[m] = { sessions: 0, out: 0, cacheRead: 0 }); x.sessions++; x.out += v.o || 0; x.cacheRead += v.cr || 0; }
  }
  sum.usd = Math.round(sum.usd);
  const installed = skillsInstalled();
  sum.skillsUnused = installed.filter((n) => !sum.skills[n]);
  return { at: now, since, sum, sessions };
}

/** The counts as the reader sees them first: totals and the top of each list, with where to look for the rest. */
function markdown(d, jsonPath) {
  const s = d.sum, L = [];
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  L.push(`# 使い方の集計(${day(d.since)}〜${day(d.at)}・${s.days}日)`, '');
  L.push(`- あなたが動かしたセッション ${s.sessions} 件・あなたの発言 ${s.humanMsgs} 件・API 換算の費用 $${s.usd}(サブスクリプションでも利用枠の目安になる)`);
  L.push(`- スクリプトや Rally の裏の処理から動いたセッション ${s.scripted} 件・費用 $${s.scriptedUsd}(多いフォルダ: ${s.scriptedBy.map(([k, v]) => `${k} ${v}`).join('、') || 'なし'})`);
  L.push(`- 会話の要約(/compact など) ${s.compactions} 回・ツールのエラー ${s.errors} 件・サブエージェント呼び出し ${s.subagentCalls} 回`, '');
  L.push('## モデル別', '| モデル | セッション | 出力トークン | キャッシュ読み |', '|---|---|---|---|');
  for (const [m, v] of Object.entries(s.models).sort((a, b) => b[1].out - a[1].out)) L.push(`| ${m} | ${v.sessions} | ${v.out} | ${v.cacheRead} |`);
  L.push('', `考える深さの指定(/effort): ${top(s.efforts, 8).map(([k, v]) => `${k} ${v}回`).join('、') || 'なし'}`);
  L.push(`権限モード(発言時): ${top(s.modes, 6).map(([k, v]) => `${k} ${v}`).join('、') || '不明'}`, '');
  L.push('## 費用の大きいセッション(上位12)', '| セッション | フォルダ | モデル | $ | 文脈の最大 | 要約 | 発言 |', '|---|---|---|---|---|---|---|');
  for (const x of d.sessions.filter((y) => !y.scripted).sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 12)) L.push(`| ${x.title || x.id.slice(0, 8)} | ${path.basename(x.project || '')} | ${x.model || ''} | ${x.usd || 0} | ${Math.round((x.ctx || 0) / 1000)}k | ${x.compactions} | ${x.humanMsgs} |`);
  L.push('', '## スキル', `- 使われた: ${top(s.skills, 20).map(([k, v]) => `${k} ${v}回`).join('、') || 'なし'}`, `- 入っているのに使われていない: ${s.skillsUnused.join('、') || 'なし'}`);
  L.push(`- よく使ったコマンド: ${top(s.commands, 12).map(([k, v]) => `/${k} ${v}回`).join('、') || 'なし'}`, '');
  L.push('## 停止フックの指摘(多い順)');
  for (const [k, v] of top(s.stopHooks, 12)) L.push(`- ${v}回: ${k}…`);
  L.push('', '## やり直し・不満・注意の発言(例)');
  const corr = d.sessions.filter((x) => !x.scripted).flatMap((x) => x.corrections.map((c) => ({ ...c, who: x.title || x.id.slice(0, 8) }))).sort((a, b) => b.t - a.t).slice(0, 40);
  for (const c of corr) L.push(`- [${c.who}] ${c.text}`);
  L.push('', `## ツール(多い順)`, top(s.tools, 20).map(([k, v]) => `${k} ${v}`).join('、'));
  L.push('', `詳細(セッションごとの数字・記録ファイルのパス): ${jsonPath}`);
  return L.join('\n');
}

/** The ask for the new session that reads it all. */
function prompt({ days, mdPath, jsonPath, reportPath }) {
  return [
    `私の Claude Code(と Codex)の使い方を、過去${days}日分のセッションをもとに徹底的に診断して、改善点を提案してください。`,
    '',
    '材料:',
    `- 集計: ${mdPath}(全体の数字・上位の例)。詳細は ${jsonPath}(セッションごとの数字と記録ファイルのパス)`,
    '- 生の記録: ~/.claude/projects/ 以下の .jsonl。集計で気になったところは、必要な分だけ grep して根拠を確かめる',
    '- いまの設定: ~/.claude/settings.json、~/.claude/CLAUDE.md と各プロジェクトの CLAUDE.md、~/.claude/skills/、各プロジェクトの memory(~/.claude/projects/*/memory/)、フック(~/.claude/hooks/)',
    '',
    '見る観点:',
    '1. モデルと考える深さ: 作業の種類ごとに、高すぎる(安いモデル・浅い深さで足りる)/低すぎる(やり直しが多い)ものはないか',
    '2. 利用枠と費用: どのセッションが使っているか。文脈が大きいまま続けている、要約や引き継ぎで減らせる、並列にしすぎ、など',
    '3. 繰り返している指示: 同じ注意や修正を何度もしているもの。スキル・CLAUDE.md・memory・フックにすべきものと、既存のスキルで使われていない・重なっているもの',
    '4. 失敗のパターン: やり直し・「まだ直っていない」・停止フックの指摘が多い作業。原因と防ぎ方',
    '5. 並列の進め方: 同時に動かす数、送り先の間違い、待ち時間、Rally(このボード)の使い方',
    '6. 権限と自動化: 許可の聞かれ方、auto モード、定期実行にできる作業',
    '',
    '進め方:',
    '- 主張には根拠(件数・期間・セッションの例)を付ける。推測は推測と書く',
    '- 設定やファイルは変更しない。提案だけにする。すぐ使える形(スキルの下書き、CLAUDE.md に足す文、settings の差分)は報告に入れる',
    `- 最後に、効果と手間で順位をつけた5〜10個の提案にまとめて、${reportPath} に Markdown で保存し、要点を返信で伝える`,
  ].join('\n');
}

/** <dir>/.rally/ for the files: never followed through a link, ignored by git (as lib/attach.js stageIn). */
function folderIn(dir, stamp) {
  const base = path.join(dir, Paths.DIRNAME);
  try { if (fs.lstatSync(base).isSymbolicLink()) throw new Error('.rally is a link'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  try { const gi = path.join(base, '.gitignore'); if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n', { flag: 'wx' }); } catch (e) { /* the files still go */ }
  const out = path.join(base, `diagnose-${stamp}`);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  return out;
}

/**
 * Count, write the two files into `dir`'s .rally/, and return what the new session is started with.
 * @returns {{dir, prompt, model, effort, md, json, report, sessions}}
 */
function prepare({ dir, days = 14, titles = {}, now = Date.now() } = {}) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('a folder is needed');
  const d = collect({ days, now, titles });
  const stamp = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  const out = folderIn(dir, stamp);
  const json = path.join(out, 'data.json'), md = path.join(out, 'data.md'), report = path.join(out, 'report.md');
  fs.writeFileSync(json, JSON.stringify(d, null, 1), { mode: 0o600 });
  fs.writeFileSync(md, markdown(d, json), { mode: 0o600 });
  return { dir, model: 'opus', effort: 'high', md, json, report, sessions: d.sum.sessions, prompt: prompt({ days, mdPath: md, jsonPath: json, reportPath: report }) };
}

module.exports = { CORRECTION, countFile, collect, markdown, prompt, prepare, skillsInstalled };
