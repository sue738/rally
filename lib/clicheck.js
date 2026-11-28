'use strict';
/**
 * clicheck.js — has an agent's CLI changed under the board?
 *
 * The board drives each CLI by its flags and goes by what it prints. An update can change
 * either, and nothing tells the board: for nine days every start with a file failed on a check
 * a new claude had added, and read as started. So, once per binary (its real path, size and
 * time name the version): every flag lib/dispatch.js buildCommand can pass is looked up in the
 * CLI's own --help, and one that is gone is said — in a bar on the board, and with a start or a
 * send the CLI did not take. A failure in words the board does not know also says when the CLI
 * was last updated. The flags are derived from buildCommand, not listed here: a flag added
 * there is checked without anyone remembering to.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const Env = require('./env.js');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');
const { t: tr } = require('./i18n.js');

const UUID = '11111111-1111-4111-8111-111111111111';
// option sets that between them make buildCommand emit every flag it has for the agent
const SHAPES = {
  claude: [
    { model: 'm', effort: 'high', chrome: true, mode: 'plan', worktree: true, addDirs: ['/x'] },
    { session: UUID },
    { session: UUID, fork: true, worktree: true },
    { print: true },
  ],
  codex: [
    { dir: '/x', model: 'm', effort: 'high', mode: 'plan' },
    { dir: '/x', mode: 'acceptEdits', worktree: true },
    { mode: 'auto' },
    { session: UUID, dir: '/x' },
  ],
};
// where each CLI documents them
const HELP = { claude: [['--help']], codex: [['exec', '--help'], ['--help']] };
const NAMES = { claude: 'Claude Code', codex: 'Codex' };
const RECENT_MS = 14 * 86400e3;   // how long after an update it is still named with a failure
const LOOK_MS = 10 * 60e3;        // how often a CLI that was not found is looked for again

function file() { return Env.get('CLICHECK_FILE') || Paths.akHome('cli-check.json'); }

/** Every flag the board can pass this agent (before `--`), as buildCommand writes them. */
function flagsOf(agent) {
  const Dispatch = require('./dispatch.js');
  const out = new Set();
  for (const shape of SHAPES[agent] || []) {
    let args = [];
    try { args = Dispatch.buildCommand({ agent, text: 'x', ...shape }).args; } catch (e) { continue; }
    for (const a of args) { if (a === '--') break; if (/^--?[A-Za-z]/.test(a)) out.add(a); }
  }
  return [...out].sort();
}

/** Whether `help` documents `flag` (as a whole word: --model is not found in --model-list). */
function documents(help, flag) {
  const f = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,(\`'"])${f}($|[\\s,=<\\[)\`'".])`, 'm').test(help);
}

function identity(bin) {
  try { const real = fs.realpathSync(bin); const st = fs.statSync(real); return `${real}\0${st.size}\0${Math.round(st.mtimeMs)}`; }
  catch (e) { return ''; }
}

function run(bin, args) {
  try { return String(execFileSync(bin, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }) || ''); }
  catch (e) { return String((e && e.stdout) || ''); }
}

/**
 * Not looked at: under the self-test, switched off (RALLY_CLICHECK=0), or the board was pointed at a
 * stand-in (RALLY_BIN_<AGENT>) — a stand-in takes any argv for a start, `--help` included.
 * RALLY_CLICHECK=1 looks at a binary the board was pointed at all the same (a stand-in written to answer --help).
 */
function off(agent) {
  const sw = Env.get('CLICHECK');
  return !!(Env.get('SELFTEST') || sw === '0' || (Env.get('BIN_' + agent.toUpperCase()) && sw !== '1'));
}

/**
 * What the installed CLI of `agent` is, against what the board passes it.
 * @returns {{version, missing: string[], was: string, since: number, checked: boolean}|null} null when it is
 *   not installed, not looked at (off), or not one the board builds commands for. `was`/`since`: the
 *   version it had before this one and when the change was noticed. `checked: false`: its --help could
 *   not be read as one (nothing is claimed then).
 * `opts.bin` names the binary (tests, and then nothing is off); `opts.fresh` ignores what is remembered.
 */
function check(agent, opts = {}) {
  if (!SHAPES[agent]) return null;
  if (!opts.bin && off(agent)) return null;
  const now = opts.now || Date.now();
  const all = Fsx.readJSON(file(), {}) || {};
  const prev = all[agent] || null;
  const answer = (e) => ({ version: e.version || '', missing: e.missing || [], was: e.was || '', since: e.since || 0, checked: e.checked !== false });
  const Dispatch = require('./dispatch.js');
  // where it is now: named, or in one of the usual places (looked at each time: it may have been installed elsewhere since)
  let bin = opts.bin || Dispatch.binaryFor(agent, { quick: true });
  let shell = false;
  // elsewhere on the PATH: asking the login shell takes a moment, so where it said last time, while that is still there
  if (!bin && prev && prev.shell && prev.bin && identity(prev.bin) && !opts.fresh) { bin = prev.bin; shell = true; }
  if (!bin) {
    // not found a moment ago: not looked for again on every refresh
    if (prev && !prev.id && !opts.fresh && now - (prev.at || 0) < LOOK_MS) return null;
    bin = Dispatch.binaryFor(agent); shell = !!bin;
  }
  const id = bin ? identity(bin) : '';
  const save = (e) => { all[agent] = e; try { Fsx.writeJSONAtomic(file(), all, 0o600, 0); } catch (x) { /* looked at again next time */ } };
  if (!id) { save({ at: now, ...(prev && prev.version ? { version: prev.version } : {}) }); return null; }
  // the same file as last time: what was found then
  if (prev && prev.id === id && prev.bin === bin && !opts.fresh) return answer(prev);
  const help = HELP[agent].map((a) => run(bin, a)).join('\n');
  // something that does not answer --help as a CLI does (a wrapper script) is not judged
  const checked = /usage|options/i.test(help) && documents(help, '--help');
  const version = (run(bin, ['--version']).match(/\d+\.\d+\.\d+[\w.-]*/) || [''])[0];
  const missing = checked ? flagsOf(agent).filter((f) => !documents(help, f)) : [];
  const changed = !!(prev && prev.version && version && prev.version !== version);
  const e = { bin, id, version, missing, checked, at: now, ...(shell ? { shell: true } : {}), was: changed ? prev.version : (prev && prev.was) || '', since: changed ? now : (prev && prev.since) || 0 };
  save(e);
  return answer(e);
}

/**
 * One sentence for a person, or '': what about this CLI may explain a start or a send it did not take.
 * A flag that is gone is always said. `opts.unexpected` (the CLI failed in words the board does not
 * know): also that it was updated, for two weeks after the update was noticed.
 */
function note(agent, opts = {}) {
  let c = null;
  try { c = check(agent, opts); } catch (e) { return ''; }
  if (!c || !c.checked) return '';
  const name = NAMES[agent] || agent;
  if (c.missing.length) return tr('{name} {version} の --help に、Rally が渡す {flags} がありません。CLI の仕様が変わった可能性があります', { name, version: c.version, flags: c.missing.join(' ') });
  if (opts.unexpected && c.was && (opts.now || Date.now()) - c.since < RECENT_MS) return tr('{name} は {was} から {version} に更新されています。仕様が変わった可能性があります', { name, was: c.was, version: c.version });
  return '';
}

/** note() in brackets, to end a failure's sentence with; '' when there is nothing to say. */
function hint(agent, opts) { const n = note(agent, opts); return n ? ` (${n})` : ''; }

/**
 * For the board's state: {version, missing} per agent whose CLI lacks a flag the board passes; {} when all is well.
 * `opts.bins`: {agent: path} to look at instead of the installed ones (tests).
 */
function forState(agents, opts = {}) {
  const out = {};
  for (const agent of agents || []) {
    if (!SHAPES[agent]) continue;
    let c = null;
    try { c = check(agent, opts.bins && opts.bins[agent] ? { bin: opts.bins[agent] } : {}); } catch (e) { continue; }
    if (c && c.checked && c.missing.length) out[agent] = { version: c.version, missing: c.missing };
  }
  return out;
}

module.exports = { RECENT_MS, flagsOf, documents, check, note, hint, forState, off, file };
