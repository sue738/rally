'use strict';
const { t: tr } = require('./i18n.js');
/**
 * term.js — find the Ghostty terminal a session runs in, by the title Claude
 * Code gives it (spinner glyph + ai-title, or custom-title after /rename), and
 * focus it, open a new tab, or type a /command or message into it.
 */
const Env = require('./env.js');
const fs = require('fs');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');

/** The title Claude Code gave this session: a /rename wins over its own. */
function titleOf(file) {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try { const size = fs.fstatSync(fd).size, n = Math.min(size, 4 * 1024 * 1024); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); text = b.toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch (e) { return ''; }
  const last = (re) => { let m, v = ''; re.lastIndex = 0; while ((m = re.exec(text))) v = m[1]; return v; };
  const un = (s) => { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } };
  const custom = last(/"customTitle":"((?:[^"\\]|\\.)*)"/g);
  return un(custom || last(/"aiTitle":"((?:[^"\\]|\\.)*)"/g));
}

// (inside tell Ghostty, "tab" is Ghostty's tab class, not the character)
const LIST = `set sep to character id 9
tell application "Ghostty"
set out to ""
repeat with w in windows
repeat with t in tabs of w
repeat with s in terminals of t
set out to out & (id of s) & sep & (name of s) & sep & (working directory of s) & linefeed
end repeat
end repeat
end repeat
return out
end tell`;

function osa(script, run = execFileSync) {
  // the selftest never drives a terminal app
  if (Env.get('SELFTEST') && run === execFileSync) throw new Error('selftest: osascript is not run');
  return run('osascript', ['-e', script], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Ghostty's terminals: [{id, title, cwd}], the title without its spinner. */
function terminals(run) {
  const out = osa(LIST, run);
  return String(out || '').split('\n').filter(Boolean).map((l) => {
    const [id, name = '', cwd = ''] = l.split('\t');
    // strip exactly one spinner glyph: a title may itself start with a symbol
    return { id, name, title: name.replace(/^[^\p{L}\p{N}\s]\s+/u, '').trim(), cwd };
  });
}

/** The terminal for this title, in this directory when two share a title. */
function pick(list, title, cwd) {
  if (!title) return null;
  const same = list.filter((t) => t.title === title);
  const here = same.filter((t) => t.cwd === cwd);
  // ambiguous: focusing the wrong one is worse than none
  if (here.length === 1) return here[0];
  if (same.length === 1) return same[0];
  return same.length ? { ambiguous: same.length } : null;
}

/** {ok, how, title} — focused its terminal, or only brought the terminal app forward. */
function focus({ file, cwd }, run) {
  const title = file ? titleOf(file) : '';
  let list = [];
  try { list = terminals(run); } catch (e) { return { ok: false, title, error: tr('Ghostty に問い合わせできませんでした') }; }
  const t = pick(list, title, cwd);
  if (t && t.ambiguous) {
    try { osa('tell application "Ghostty" to activate', run); } catch (e) { /* nothing more to do */ }
    return { ok: false, title, how: 'app', error: tr('「{title}」という題名の端末が {n} つあり、どれか決められません', { title, n: t.ambiguous }) };
  }
  if (!t) {
    try { osa('tell application "Ghostty" to activate', run); } catch (e) { /* nothing more to do */ }
    return { ok: false, title, how: 'app', error: title ? tr('「{title}」の端末が見つかりません', { title }) : tr('このセッションの題名がまだありません') };
  }
  if (!/^[\w-]+$/.test(t.id)) return { ok: false, title, error: 'bad terminal id' };
  osa(`tell application "Ghostty"\nfocus (first terminal whose id is "${t.id}")\nactivate\nend tell`, run);
  return { ok: true, title, how: 'terminal' };
}

/**
 * A new Ghostty tab running `claude attach <id>`, for a background session
 * the CLI will only restart from an interactive terminal. Only the checked id
 * is typed.
 */
function openAttach(short, cwd, run) {
  if (!/^[0-9a-f]{6,12}$/.test(short)) return { ok: false, error: 'bad session id' };
  const dir = typeof cwd === 'string' && /^\/[^"\\]*$/.test(cwd) ? cwd : Paths.home();
  osa(`tell application "Ghostty"
set cfg to new surface configuration
set initial working directory of cfg to "${dir}"
set initial input of cfg to "claude attach ${short}" & return
if (count of windows) > 0 then
new tab in front window with configuration cfg
else
new window with configuration cfg
end if
activate
end tell`, run);
  return { ok: true };
}

/**
 * Start a new session in a Ghostty tab, for when the CLI will not start it in
 * the background. The message goes through a file, never through the shell:
 * the tab types claude -- "$(cat <file>)".
 */
function startInTerminal({ dir, text, model, agent = 'claude', worktree = false }, run) {
  if (agent !== 'claude') return { ok: false, error: tr('claude だけです') };
  const fs_ = require('fs'), path_ = require('path');
  if (typeof dir !== 'string' || !/^\/[^"\\\n]*$/.test(dir)) return { ok: false, error: 'bad directory' };
  try { if (!fs_.statSync(dir).isDirectory()) return { ok: false, error: 'not a directory' }; } catch (e) { return { ok: false, error: 'no such directory' }; }
  if (model && !/^[\w.][\w.-]{0,39}$/.test(model)) return { ok: false, error: 'bad model' };
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: tr('内容が空です') };
  const d = Paths.akHome('start');
  fs_.mkdirSync(d, { recursive: true, mode: 0o700 });
  // the tab reads its file at once; clear ones older than a day
  try { for (const x of fs_.readdirSync(d)) { const q = path_.join(d, x); if (Date.now() - fs_.statSync(q).mtimeMs > 86400000) fs_.unlinkSync(q); } } catch (e) { /* best effort */ }
  const f = path_.join(d, `${Date.now()}-${process.pid}.txt`);
  fs_.writeFileSync(f, t, { mode: 0o600 });
  const cmd = `claude${model ? ' --model ' + model : ''}${worktree ? ' --worktree' : ''} -- "$(cat '${f}')"`;
  osa(`tell application "Ghostty"
set cfg to new surface configuration
set initial working directory of cfg to "${dir}"
set initial input of cfg to "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" & return
if (count of windows) > 0 then
new tab in front window with configuration cfg
else
new window with configuration cfg
end if
activate
end tell`, run);
  return { ok: true, file: f };
}

/**
 * Type a single /command into a session's terminal: sent as a peer message it
 * would arrive as plain text. Nothing but one /command is accepted.
 */
function typeCommand({ file, cwd, text }, run) {
  const t = String(text || '').trim();
  if (!/^\/[\w:.-]{1,60}( [^\n\r"\\]{0,120})?$/.test(t)) return { ok: false, error: tr('端末に打てるのは /コマンド 1つだけです') };
  const title = file ? titleOf(file) : '';
  let list = [];
  try { list = terminals(run); } catch (e) { return { ok: false, error: tr('Ghostty に問い合わせできませんでした') }; }
  const term = pick(list, title, cwd);
  if (!term || term.ambiguous || !/^[\w-]+$/.test(term.id)) return { ok: false, error: term && term.ambiguous ? tr('「{title}」の端末が {n} つあり、どれか決められません', { title, n: term.ambiguous }) : tr('「{title}」の端末が見つかりません', { title: title || '?' }) };
  const q = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  osa(`tell application "Ghostty"\nset x to (first terminal whose id is "${term.id}")\ninput text "${q}" to x\nsend key "enter" to x\nend tell`, run);
  return { ok: true, typed: t, title };
}

/**
 * Type the user's message into a session's terminal, so it counts as the
 * user's own words (a peer message cannot approve anything). Pasted as one
 * block, then Enter.
 */
function typeMessage({ file, cwd, text }, run) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t || t.length > 6000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) return { ok: false, error: tr('端末に打てない内容です') };
  const title = file ? titleOf(file) : '';
  let list = [];
  try { list = terminals(run); } catch (e) { return { ok: false, error: tr('Ghostty に問い合わせできませんでした'), noTerminal: true }; }
  const term = pick(list, title, cwd);
  if (!term || term.ambiguous || !/^[\w-]+$/.test(term.id)) return { ok: false, noTerminal: true, error: term && term.ambiguous ? tr('「{title}」の端末が {n} つあり、どれか決められません', { title, n: term.ambiguous }) : tr('「{title}」の端末が見つかりません', { title: title || '?' }) };
  // an AppleScript string, line by line: quotes and backslashes escaped, newlines as linefeed
  const lit = t.split('\n').map((l) => '"' + l.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(' & linefeed & ');
  osa(`tell application "Ghostty"\nset x to (first terminal whose id is "${term.id}")\ninput text (${lit}) to x\nsend key "enter" to x\nend tell`, run);
  return { ok: true, title };
}

module.exports = { titleOf, terminals, pick, focus, openAttach, startInTerminal, typeCommand, typeMessage };
