'use strict';
/**
 * skills.js — the slash commands a Claude session will understand, for the
 * picker. A `/<name>` message runs the skill even headless, so only names are
 * needed. Read from ~/.claude/{skills,commands}, each project's .claude/ up
 * the tree, and enabled plugins (`<plugin>:<name>`); `user-invocable: false`
 * skills are left out. Read-only.
 */
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');

const DESC_MAX = 140;

/**
 * Claude Code's built-in commands, listed by hand: only ones that work when
 * sent headless to a resumed session (/clear does not, so it is left out).
 */
const BUILTIN = [
  { name: 'compact', desc: '会話を要約して文脈を減らす', hint: '[要約で残してほしいこと]' },
  { name: 'context', desc: '文脈の使用量を表示する' },
  { name: 'usage', desc: '利用枠の消費を表示する' },
  // values /model accepts
  { name: 'model', desc: 'このセッションのモデルを切り替える', args: [
    { v: 'opus', d: '最上位' }, { v: 'sonnet', d: '標準' }, { v: 'haiku', d: '軽量・速い' },
    { v: 'fable', d: '別系統(敵対的レビュー向け)' }, { v: 'opusplan', d: 'plan 中は Opus、それ以外は Sonnet' }, { v: 'default', d: '既定に戻す' }] },
  { name: 'effort', desc: 'このセッションの考える深さを変える', args: [
    { v: 'low', d: '速く・軽く' }, { v: 'medium', d: '標準' }, { v: 'high', d: 'じっくり' }, { v: 'xhigh', d: 'さらにじっくり' }, { v: 'max', d: '最大' }] },
  { name: 'goal', desc: '終わりの条件を決めて、満たすまで自動で続けさせる(解除は clear)', hint: '<満たしたい条件> / clear' },
  { name: 'init', desc: 'このリポジトリの CLAUDE.md を作る' },
  { name: 'code-review', desc: '差分のコードレビュー' },
  { name: 'security-review', desc: '差分のセキュリティレビュー' },
  { name: 'simplify', desc: '変更したコードを整理する' },
  // interactive menus: typed into the session's terminal instead
  { name: 'chrome', desc: 'Claude in Chrome をつなぐ・設定する(ターミナルで)' },
  { name: 'rename', desc: 'このセッションの名前を変える', hint: '<新しい名前>' },
  { name: 'permissions', desc: '許可のルールを見る・変える(ターミナルで)' },
  { name: 'config', desc: '設定を開く(ターミナルで)' },
  { name: 'mcp', desc: 'MCP サーバーの状態・接続(ターミナルで)' },
  { name: 'agents', desc: 'サブエージェントの管理(ターミナルで)' },
  { name: 'memory', desc: 'メモリ(CLAUDE.md)を開く(ターミナルで)' },
  { name: 'add-dir', desc: '作業できるフォルダを足す', hint: '<フォルダ>' },
  { name: 'status', desc: '状態を表示する(ターミナルで)' },
].map((b) => ({ ...b, scope: 'builtin' }));

/** The frontmatter keys we need, from the small YAML subset skills use. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[|>][+-]?$/.test(v)) {                 // block scalar: the indented lines below
      const body = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) body.push(lines[++i].trim());
      v = body.join(' ').trim();
    } else if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

/** The first prose line of a file without a description. */
function firstLine(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const l of body.split(/\r?\n/)) {
    const s = l.replace(/^#+\s*/, '').trim();
    if (s) return s;
  }
  return '';
}

function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } }
function list(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }

function entry(name, text, scope) {
  const fm = frontmatter(text);
  if (String(fm['user-invocable']).toLowerCase() === 'false') return null;
  const desc = (fm.description || firstLine(text)).replace(/\s+/g, ' ');
  const e = { name, desc: desc.length > DESC_MAX ? desc.slice(0, DESC_MAX - 1) + '…' : desc, scope };
  if (fm['argument-hint']) e.hint = String(fm['argument-hint']).slice(0, 80);
  return e;
}

/** Every skill and command under one `.claude`-shaped root. */
function fromRoot(root, scope, prefix = '') {
  const out = [];
  for (const d of list(path.join(root, 'skills'))) {
    const text = read(path.join(root, 'skills', d, 'SKILL.md'));
    if (text == null) continue;
    const fm = frontmatter(text);
    const e = entry(prefix + (fm.name || d), text, scope);
    if (e) out.push(e);
  }
  for (const f of list(path.join(root, 'commands'))) {
    if (!f.endsWith('.md')) continue;
    const text = read(path.join(root, 'commands', f));
    if (text == null) continue;
    const e = entry(prefix + f.slice(0, -3), text, scope);
    if (e) out.push(e);
  }
  return out;
}

function claudeHome() { return Paths.claudeDir(); }

/** Yours and your plugins': the same in every directory. */
function common() {
  const home = claudeHome();
  const out = [...BUILTIN, ...fromRoot(home, 'user')];
  let reg = null;
  try { reg = JSON.parse(read(path.join(home, 'plugins', 'installed_plugins.json')) || 'null'); } catch (e) { /* no plugins */ }
  // installed is not enabled: only what settings turn on
  const enabled = {};
  for (const f of ['settings.json', 'settings.local.json']) {
    try { Object.assign(enabled, (JSON.parse(read(path.join(home, f)) || '{}').enabledPlugins) || {}); } catch (e) { /* unreadable settings */ }
  }
  for (const [key, installs] of Object.entries((reg && reg.plugins) || {})) {
    if (enabled[key] !== true) continue;
    const plugin = key.split('@')[0];
    for (const inst of [].concat(installs || [])) {
      if (inst && inst.installPath) out.push(...fromRoot(inst.installPath, 'plugin', plugin + ':'));
    }
  }
  return out;
}

/** A project's own, from `dir` up to (not including) your home. */
function project(dir) {
  const out = [];
  const home = Paths.home();
  let d = path.resolve(String(dir || ''));
  if (!dir || !path.isAbsolute(String(dir))) return out;
  while (d !== home && d !== path.dirname(d)) {
    out.push(...fromRoot(path.join(d, '.claude'), 'project'));
    d = path.dirname(d);
  }
  return out;
}

/**
 * What the page gets: the common list once, and a project list for each
 * directory that has one. A name seen twice keeps its first (nearest) entry.
 */
function forDirs(dirs) {
  const byDir = {};
  for (const d of new Set(dirs || [])) {
    const p = project(d);
    if (p.length) byDir[d] = p;
  }
  const seen = new Set();
  const all = common().filter((s) => !seen.has(s.name) && seen.add(s.name));
  // yours first (by name), then the built-ins you reach for less
  const rank = (x) => (x.scope === 'builtin' ? 1 : 0);
  return { common: all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)), byDir };
}

module.exports = { frontmatter, common, project, forDirs };
