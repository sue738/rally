'use strict';
const { t: tr } = require('./i18n.js');
/**
 * bgopen.js — open a stopped Claude session as a background session
 * (`claude --bg --resume <id>`), so quitting or relaunching the app does not end
 * it: a background session belongs to Claude's supervisor, and the terminal only
 * views it with `claude attach <short>`.
 *
 * Measured against claude 2.1.283:
 * - The first --bg --resume takes flags (--permission-mode kept). Once a session has
 *   run in the background it keeps its saved options and ANY flag starts a copy,
 *   so a session with a job record gets no flags.
 * - Outside a trusted directory it refuses ("Workspace not trusted"); the home folder
 *   is never trusted this way, so those resume in the terminal directly ({direct: true}).
 * - On a running session it would start a copy, so liveness is checked first
 *   (lib/alive.js); not knowing is refused too (null means hold, as in lib/queue.js).
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Paths = require('./paths.js');
const Dispatch = require('./dispatch.js');
const Alive = require('./alive.js');

// the modes a resume may be given (never bypassPermissions); "default" is your settings' own
const MODES = ['auto', 'acceptEdits', 'plan'];

function jobsDir() { return Env.get('CLAUDE_JOBS') || Paths.home('.claude', 'jobs'); }

/** Has this session run in the background before (a job record of its own)? Then it keeps its saved options. */
function hasJob(id) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(jobsDir(), id.slice(0, 8), 'state.json'), 'utf8'));
    return j.sessionId === id || j.resumeSessionId === id;
  } catch (e) { return false; }
}

/**
 * What `claude --bg --resume <id>` said, read. Pure.
 * @returns {{short}|{copy}|{untrusted, line}|{refused}|{unknown}}
 */
function readOutcome(text) {
  const out = Dispatch.plain(text);
  const copy = out.match(/started a copy as ([0-9a-f]{6,})/i);
  if (copy) return { copy: copy[1] };
  const untrusted = out.match(/^\s*((?:Workspace not trusted|Not inside a trusted directory).*)$/m);
  if (untrusted) return { untrusted: true, line: untrusted[1].trim().slice(0, 300) };
  const bg = out.match(/backgrounded\s*[·:]\s*([0-9a-f]{6,})/i);
  if (bg) return { short: bg[1] };
  const first = (out.split('\n').find((l) => l.trim()) || '').trim();
  return first ? { refused: first.slice(0, 300) } : { unknown: true };
}

function writeLog(name, head, text) {
  try {
    const rd = Dispatch.runsDir();
    fs.mkdirSync(rd, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(rd, `${stamp}-${name}.log`), `# ${new Date().toISOString()} ${head}\n${text}`);
  } catch (e) { /* the log is a courtesy */ }
}

/**
 * Open a stopped session as a background one, or find the one running.
 * @param {{id: string, mode?: string, cwd?: string, live?: Map|null}} o
 * @returns {{short, how: 'attached'|'started'} | {direct: true, why} | {error, interactive?}}
 */
function open(o = {}) {
  const id = Dispatch.resumableId('claude', o.id);
  const home = Paths.home();
  const cwd = typeof o.cwd === 'string' && path.isAbsolute(o.cwd) && fs.existsSync(o.cwd) ? o.cwd : null;
  const live = o.live !== undefined ? o.live : Alive.sessions();
  if (!live) return { error: tr('Claude にセッションが動いているか確かめられませんでした(続きではなくコピーになるので開きません)。少し待ってもう一度開いてください') };
  const a = live.get(id);
  if (a) {
    if (a.kind === 'background' && a.short) return { short: String(a.short).slice(0, 12), how: 'attached' };
    return { error: tr('このセッションはほかの端末で開いています'), interactive: true };
  }
  // begun in the home folder: Claude never starts it in the background (see above)
  if (!cwd || cwd.replace(/\/$/, '') === home.replace(/\/$/, '')) return { direct: true, why: 'home' };
  const bin = Dispatch.binaryFor('claude');
  if (!bin) return { error: tr('claude が見つかりません') };
  const args = ['--bg', '--resume', id];
  const job = hasJob(id);
  if (!job && MODES.includes(String(o.mode || ''))) args.push('--permission-mode', String(o.mode));
  const env = { ...process.env, PATH: [path.dirname(bin), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':') };
  // what a Claude session marks its children with does not pass on (see Pty.swift)
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_JOB_DIR' || k.startsWith('CLAUDE_SESSION')) delete env[k];
  let r;
  try { r = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return { error: tr('claude を起動できませんでした: {msg}', { msg: e.message }) }; }
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const got = readOutcome(text);
  const head = `${bin} ${args.join(' ')}  (cwd ${cwd})`;
  if (got.short) {
    // named like a send's log: lib/alive.js starting() then counts it as running
    // until `claude agents` lists it, so nothing resumes it again in that gap
    writeLog('claude-reply', head, text);
    return { short: got.short, how: 'started' };
  }
  writeLog('claude-open', head, text);
  if (got.copy) {
    // it was running after all (started between the check and the resume): the copy goes, nothing opens
    Dispatch.stopBackground(got.copy);
    try { spawnSync(bin, ['rm', got.copy], { env, encoding: 'utf8', timeout: 15000, stdio: 'ignore' }); } catch (e) { /* stopped at least */ }
    return { error: tr('このセッションはほかで動き始めていたので開きませんでした') };
  }
  if (got.untrusted) return { direct: true, why: 'untrusted', line: got.line };
  return { error: got.refused ? tr('Claude が開きませんでした: {why}', { why: got.refused }) : tr('Claude が何も言わずに終わりました') };
}

/** Stop a background session this app started only to show it, when its terminal is let go; a busy one is left alone. */
function stopIdle(o = {}) {
  const id = Dispatch.resumableId('claude', o.id);
  const live = o.live !== undefined ? o.live : Alive.sessions();
  const a = live && live.get(id);
  if (!a) return { ok: true, already: true };
  if (a.kind !== 'background' || (a.status === 'busy' && !o.force)) return { ok: false, error: a.kind !== 'background' ? 'not a background session' : 'busy' };
  const shorts = (a.shorts && a.shorts.length ? a.shorts : [a.short]).filter(Boolean);
  let n = 0;
  for (const sh of shorts) if (Dispatch.stopBackground(sh)) n++;
  return { ok: n > 0, stopped: n };
}

module.exports = { MODES, hasJob, readOutcome, open, stopIdle };
