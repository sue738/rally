'use strict';
/**
 * perm.js — answer Claude Code's permission prompts from the board.
 *
 * lib/permhook.js (a PermissionRequest hook) leaves the request in dir() as
 * <id>.json and waits for <id>.answer, which the board writes. Files, not a
 * socket: the app has no server, and the browser board and the app then see
 * the same requests. Trust boundary: whoever can write <id>.answer answers.
 */
const Env = require('./env.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

const HOLD_MS = 55 * 60 * 1000;       // under the hook's own 3600s timeout
// a background session's prompt has no terminal to go back to, so it is held up to the hook's own timeout
const HOLD_BG_MS = 24 * 60 * 60 * 1000;
const AGENT_ID = /^[0-9a-z]{1,64}$/i;
const WATCH_MS = 2 * 60 * 1000;       // the board reads at least every 30s while open
const ID = /^[0-9a-f]{32}$/;
const DECISIONS = ['allow', 'deny', 'pass', 'answer', 'automode', 'rule', 'always'];
const ASK_TOOL = 'AskUserQuestion';
// the n-th of the rules Claude Code offered (`always` alone is all of them, as the terminal's row is)
const ALWAYS = /^always:[0-3]$/;
const AUTOMODE = { type: 'setMode', mode: 'auto', destination: 'session' };
const FILE_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const valid = (d) => DECISIONS.includes(d) || ALWAYS.test(String(d));
const WHERE = { localSettings: 'このプロジェクト(自分だけ)', projectSettings: 'このプロジェクト(共有)', userSettings: '全プロジェクト', session: 'このセッションだけ' };

function dir() {
  const d = Env.get('PERM_DIR') || Paths.akHome('perm');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** The board is open: called on every real read of its state. */
function touchWatch() {
  const f = path.join(dir(), '.watch');
  if (Math.random() < 0.01) { try { pruneAsked(); } catch (e) { /* next time */ } }
  try { const t = new Date(); fs.utimesSync(f, t, t); } catch (e) { fs.writeFileSync(f, ''); }
}

/** Someone read the board within WATCH_MS. */
function watching(now = Date.now()) {
  try { return now - fs.statSync(path.join(dir(), '.watch')).mtimeMs < WATCH_MS; } catch (e) { return false; }
}

/**
 * What a request asks, as text to judge (an edit shows its diff: approving
 * must not be blind), and whether that text is all of it (`partial`). Only a
 * request shown whole may be approved from a banner.
 */
const REPLACE_ALL = '  (replace_all: すべて置き換え)';
const EDIT_MAX = 20000;   // per side of an Edit, a Write's content
function describe(tool, input) {
  const i = input || {};
  let partial = false;
  const cut = (v, n) => { const t = String(v == null ? '' : v); if (t.length > n) { partial = true; return t.slice(0, n) + '…'; } return t; };
  const lines = (pre, v, n) => cut(v, n).split('\n').map((l) => pre + l).join('\n');
  const out = (text) => ({ text, partial });
  if (tool === 'Bash') return out(String(i.command || ''));
  if (tool === 'ExitPlanMode') return out(String(i.plan || ''));
  if (tool === ASK_TOOL) return out((questionsOf(tool, i) || []).map((q) => q.question).join('\n'));
  if (tool === 'Edit') return out(`${i.file_path || ''}${i.replace_all ? REPLACE_ALL : ''}\n${lines('- ', i.old_string, EDIT_MAX)}\n${lines('+ ', i.new_string, EDIT_MAX)}`);
  if (tool === 'MultiEdit') {
    const edits = i.edits || [];
    if (edits.length > 20) partial = true;
    return out(`${i.file_path || ''}\n` + edits.slice(0, 20).map((e) => `${lines('- ', e.old_string, 4000)}\n${lines('+ ', e.new_string, 4000)}`).join('\n…\n') + (edits.length > 20 ? `\n(ほか ${edits.length - 20} 箇所)` : ''));
  }
  if (tool === 'Write') return out(`${i.file_path || ''}\n${lines('+ ', i.content, EDIT_MAX)}`);
  if (tool === 'NotebookEdit') return out(`${i.notebook_path || ''}\n${lines('+ ', i.new_source, EDIT_MAX)}`);
  // anything else: the field that names what it touches, then every other field
  const main = ['file_path', 'url', 'path', 'pattern'].find((k) => i[k]);
  if (main) {
    const rest = Object.keys(i).filter((k) => k !== main && i[k] != null && i[k] !== '');
    let r = '';
    for (const k of rest) { let v; try { v = typeof i[k] === 'string' ? i[k] : JSON.stringify(i[k]); } catch (e) { v = String(i[k]); } r += `\n${k}: ${v}`; }
    return out(String(i[main]) + r);
  }
  try { return out(JSON.stringify(i)); } catch (e) { return { text: '', partial: true }; }
}
function whatOf(tool, input) { return describe(tool, input).text; }

/** The allow rules of the terminal's "Yes, and don't ask again" choices (shape as of Claude Code 2.1.283). */
function suggestionsOf(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && x.type === 'addRules' && x.behavior === 'allow' && Array.isArray(x.rules) && x.rules.length && WHERE[x.destination]).slice(0, 4);
}
function labelOf(sg) {
  const rules = sg.rules.map((r) => String(r.toolName || '') + (r.ruleContent ? `(${r.ruleContent})` : '')).join(', ');
  return { rules: rules.slice(0, 300), where: WHERE[sg.destination] };
}

/**
 * The updates the terminal folds into its one "Yes, and …" row (2.1.283),
 * kept as Claude Code offered them so it decides what they mean.
 */
function offered(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && WHERE[x.destination] && (
    (x.type === 'addRules' && x.behavior === 'allow' && Array.isArray(x.rules) && x.rules.length)
    || (x.type === 'setMode' && x.mode === 'acceptEdits')
    || (x.type === 'addDirectories' && Array.isArray(x.directories) && x.directories.length))).slice(0, 8);
}
function offeredLabel(list) {
  const rules = [], dirs = [];
  let mode = null;
  for (const x of list) {
    if (x.type === 'setMode') mode = x.mode;
    else if (x.type === 'addDirectories') dirs.push(...x.directories.map(String));
    else rules.push(...x.rules.map((r) => String(r.toolName || '') + (r.ruleContent ? `(${r.ruleContent})` : '')));
  }
  const where = [...new Set(list.filter((x) => x.type === 'addRules').map((x) => WHERE[x.destination]))].join('・');
  return { rules: rules.join(', ').slice(0, 300), dirs: dirs.join(', ').slice(0, 300), mode, where };
}

// Mirrors the terminal's Bash rule seed (2.1.283). Leading VAR=value is skipped only for these
// variables, and a wrapper (sudo, env, xargs…) gets no prefix: the rule would allow anything it runs.
const SAFE_ENV = new Set(['GOEXPERIMENT', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'GO111MODULE', 'RUST_BACKTRACE', 'RUST_LOG', 'NODE_ENV', 'PYTHONUNBUFFERED', 'PYTHONDONTWRITEBYTECODE', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD', 'PYTEST_DEBUG', 'ANTHROPIC_API_KEY', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_TIME', 'CHARSET', 'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'TZ', 'LS_COLORS', 'LSCOLORS', 'GREP_COLOR', 'GREP_COLORS', 'GCC_COLORS', 'TIME_STYLE', 'BLOCK_SIZE', 'BLOCKSIZE', 'COLUMNS', 'LINES', 'CLICOLOR', 'CLICOLOR_FORCE', 'CI', 'DEBIAN_FRONTEND', 'GIT_TERMINAL_PROMPT']);
const WRAPPERS = new Set(['sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash', 'cmd', 'powershell', 'pwsh', 'env', 'xargs', 'command', 'builtin', 'noglob', 'nice', 'stdbuf', 'nohup', 'timeout', 'time', 'watch', 'ionice', 'chrt', 'setsid', 'taskset', 'strace', 'ltrace', 'script', 'flock', 'unshare', 'nsenter', 'sudo', 'doas', 'pkexec', 'su', 'runuser']);
const WORD = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
function commandWords(cmd) {
  const w = String(cmd).trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { if (!SAFE_ENV.has(w[i].split('=')[0])) return null; i++; }
  return w.slice(i);
}
/** `git status …` → `git status *`, `python3 -c …` → `python3 *`, else the command itself. */
function bashPrefix(cmd) {
  const w = commandWords(cmd);
  if (w && w.length >= 2 && !WRAPPERS.has(w[0].split('/').pop()) && WORD.test(w[1])) return `${w[0]} ${w[1]} *`;
  if (w && w.length && WORD.test(w[0]) && !WRAPPERS.has(w[0])) return `${w[0]} *`;
  return String(cmd);
}
/** A rule's text as the edit box may send it: one line, not empty. */
function ruleText(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= 1000 && !/[\t\n\r\u2028\u2029]/.test(t) ? t : null;
}
/**
 * The rule a Bash prompt's "Yes, and don't ask again for:" starts from, or
 * null when the terminal shows Claude Code's own row instead. A compound
 * command (a && b) starts from the one rule Claude Code offered; a single one
 * from its prefix. The terminal's command-spec lookup is not mirrored, so the
 * box stays editable.
 */
function bashRuleSeed(cmd, list) {
  const all = offered(list);
  if (typeof cmd !== 'string' || !all.length) return null;
  if (all.some((x) => x.type !== 'addRules' || x.rules.some((r) => r.toolName !== 'Bash'))) return null;
  if (/&&|\|\||;|\|/.test(cmd)) {
    const rs = all.flatMap((x) => x.rules).filter((r) => r.ruleContent);
    return rs.length === 1 ? ruleText(rs[0].ruleContent) : null;
  }
  return ruleText(bashPrefix(cmd));
}

/**
 * The terminal prompt's choices, in its order (2.1.283): Yes; one "Yes, and …"
 * row; "switch to auto mode" for Bash and MCP tools; No. Null for a question
 * or a plan, which have choices of their own.
 */
function choicesOf(tool, input, list) {
  if (tool === ASK_TOOL || tool === 'ExitPlanMode') return null;
  const out = [{ d: 'allow' }];
  const seed = tool === 'Bash' ? bashRuleSeed((input || {}).command, list) : null;
  const all = offered(list);
  if (seed) out.push({ d: 'rule', rule: seed, where: WHERE.localSettings });
  else if (all.length) out.push({ d: 'always', ...offeredLabel(all), file: FILE_TOOLS.includes(tool) });
  if (tool === 'Bash' || /^mcp__/.test(String(tool))) out.push({ d: 'automode' });
  out.push({ d: 'deny' });
  return out;
}

/** An AskUserQuestion's questions, bounded for the board; null for any other tool or bad input. */
function questionsOf(tool, input) {
  if (tool !== ASK_TOOL || !input || !Array.isArray(input.questions)) return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const qs = input.questions.slice(0, 8).filter((q) => q && typeof q.question === 'string' && q.question).map((q) => ({
    question: str(q.question, 1000),
    header: str(q.header, 60),
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 12).filter((o) => o && typeof o.label === 'string' && o.label)
      .map((o) => ({ label: str(o.label, 200), description: str(o.description, 400) })),
  }));
  return qs.length ? qs : null;
}

/**
 * The board's answers checked against the questions: one non-empty string per
 * question, keyed by its text. Null when anything is missing or extra.
 */
function answersFor(questions, answers) {
  if (!Array.isArray(questions) || !questions.length || !answers || typeof answers !== 'object') return null;
  // the app hands the words over as an argument and macOS decomposes Japanese voiced marks there (ど as と + ゛): the
  // question is looked up by its composed form, and the answer goes on composed (as the options are written)
  const fold = (s) => String(s == null ? '' : s).normalize('NFKC');
  const byKey = new Map(Object.entries(answers).map(([k, v]) => [fold(k), v]));
  const out = {};
  for (const q of questions) {
    const v = byKey.get(fold(q && q.question));
    if (typeof v !== 'string' || !v.trim() || v.length > 4000) return null;
    out[q.question] = v.trim().normalize('NFC');
  }
  return Object.keys(answers).length === questions.length && byKey.size === questions.length ? out : null;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// A command stays short (padding could hide its tail); an edit is kept whole enough for the corner card to answer
const MAX_WHAT = 4000;
const MAX_WHAT_EDIT = 60000;
/**
 * The request's text for the card. A cut says so in words where it is — the
 * hook allows the whole request, so a silent cut could hide a command's tail.
 */
function whatRecord(tool, input) {
  const d = describe(tool, input);
  const max = /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(String(tool)) ? MAX_WHAT_EDIT : MAX_WHAT;
  if (d.text.length <= max) return { what: d.text, ...(d.partial ? { partial: true } : {}) };
  return { what: d.text.slice(0, max) + `\n…(以下 ${d.text.length - max} 文字省略 — 端末で確認してください)`, partial: true };
}

/** Leave a request for the board. Returns its id. */
function put(req, pid = process.pid, opts = {}) {
  const id = crypto.randomBytes(16).toString('hex');
  const rec = {
    id, pid,
    session: String(req.session_id || ''),
    // a subagent asks under its parent's session id; agent_id names its own transcript
    ...(AGENT_ID.test(String(req.agent_id || '')) ? { agent: String(req.agent_id), agentType: String(req.agent_type || '').slice(0, 60) } : {}),
    ...(opts.bg ? { bg: true } : {}),
    cwd: String(req.cwd || ''),
    tool: String(req.tool_name || ''),
    ...whatRecord(req.tool_name, req.tool_input),
    always: suggestionsOf(req.permission_suggestions).map(labelOf),
    t: Date.now(),
  };
  const qs = questionsOf(req.tool_name, req.tool_input);
  if (qs) rec.questions = qs;
  const ch = choicesOf(req.tool_name, req.tool_input, req.permission_suggestions);
  if (ch) rec.choices = ch;
  const f = path.join(dir(), id + '.json');
  Fsx.writeJSONAtomic(f, rec, 0o600, 0);
  return id;
}

function readAnswer(id) {
  try { return fs.readFileSync(path.join(dir(), id + '.answer'), 'utf8'); } catch (e) { return null; }
}

/** The answer written for a request, or null. `answer` carries what was chosen on its next line. */
function taken(id) {
  const t = readAnswer(id);
  if (t == null) return null;
  const d = t.split('\n')[0].trim();
  return valid(d) ? d : null;
}

/** The text a `rule` or `deny` answer carries (the rule as edited; what to tell Claude), or null. */
function takenText(id) {
  const t = readAnswer(id);
  if (t == null || t.indexOf('\n') < 0) return null;
  try { const v = JSON.parse(t.slice(t.indexOf('\n') + 1)); return typeof v === 'string' ? v : null; } catch (e) { return null; }
}

/** What was chosen, for a request answered with `answer`: question text → answer. */
function takenAnswers(id) {
  const t = readAnswer(id);
  if (t == null || t.split('\n')[0].trim() !== 'answer') return null;
  try { return JSON.parse(t.slice(t.indexOf('\n') + 1)); } catch (e) { return null; }
}

/** Remove a request and its answer. */
function clear(id) {
  if (!ID.test(String(id))) return;
  for (const ext of ['.json', '.answer']) { try { fs.unlinkSync(path.join(dir(), id + ext)); } catch (e) { /* gone */ } }
}

/** The open requests, oldest first. A request whose hook died is removed. */
function list() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir()); } catch (e) { return out; }
  for (const n of names) {
    const orphan = /^([0-9a-f]{32})\.answer$/.exec(n);
    if (orphan && !names.includes(orphan[1] + '.json')) { try { fs.unlinkSync(path.join(dir(), n)); } catch (e) { /* gone */ } continue; }
    const m = /^([0-9a-f]{32})\.json$/.exec(n);
    if (!m) continue;
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')); } catch (e) { continue; }
    if (!r || !Number.isInteger(r.pid) || !alive(r.pid)) { clear(m[1]); continue; }
    if (taken(m[1])) continue;                 // answered, the hook is on its way out
    const a = { id: m[1], session: String(r.session || ''), cwd: String(r.cwd || ''), tool: String(r.tool || ''), what: String(r.what || ''), always: Array.isArray(r.always) ? r.always : [], t: +r.t || 0 };
    if (Array.isArray(r.questions) && r.questions.length) a.questions = r.questions;
    if (Array.isArray(r.choices) && r.choices.length) a.choices = r.choices;
    if (r.partial === true) a.partial = true;
    if (typeof r.agent === 'string' && AGENT_ID.test(r.agent)) { a.agent = r.agent; a.agentType = String(r.agentType || ''); }
    if (r.bg === true) a.bg = true;
    out.push(a);
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * A held request's prompt was answered elsewhere: its call already has a
 * result in the transcript. Claude Code races the hook against its own prompt
 * and aborts the hook only with the turn (2.1.283), so the hook outlives it.
 * The hook input has no tool_use_id, so the call is matched by tool and
 * command/path; a tool with neither is never judged (false = not known).
 */
function settled(a, events) {
  if (!a || !Array.isArray(events)) return false;
  const what = String(a.what || '');
  const same = (e) => {
    if (e.kind !== 'tool_call' || e.tool !== a.tool || e.callId == null) return false;
    const i = e.input || {};
    if (typeof i.command === 'string' && i.command) {
      // both sides are cut (the transcript's command at 2000, the request at 4000)
      const n = Math.min(what.length, i.command.length);
      return n > 0 && what.slice(0, n) === i.command.slice(0, n) && (what.length === i.command.length || n >= 2000);
    }
    if (typeof i.path === 'string' && i.path) {
      const first = what.split('\n')[0];
      return first === i.path || (a.tool === 'Edit' && first === i.path + REPLACE_ALL);
    }
    return false;
  };
  let call = null, newest = 0;
  for (const e of events) {
    if ((e.t || 0) > (a.t || 0) + 2000) continue;
    if (e.kind === 'tool_call') newest = Math.max(newest, e.t || 0);
    if (same(e)) call = e;
  }
  if (!call) return false;
  // an identical call from long ago is not this one: the request follows its call within
  // seconds, or later only for calls made together (still the newest batch)
  const near = (call.t || 0) >= (a.t || 0) - SETTLE_NEAR_MS;
  const inLatest = (call.t || 0) >= newest - SETTLE_BATCH_MS;
  if (!near && !inLatest) return false;
  return events.some((e) => e.kind === 'tool_result' && e.callId === call.callId);
}
const SETTLE_NEAR_MS = 15000, SETTLE_BATCH_MS = 5000;

/** The transcript a request's call is in: the session's, or a subagent's own; null if not read. */
function sessionFor(a, byKey) {
  if (!a || !byKey) return null;
  if (!a.agent) return byKey.get('claude\0' + a.session) || null;
  const s = byKey.get('claude\0agent-' + a.agent);
  return s && s.parentId === a.session ? s : null;
}

/**
 * Answer an open request; false when there is none or the input is bad. A
 * question needs `answer`: an allow without answers would not close it.
 * `answers`: the choices for `answer`, the edited rule for `rule`, the
 * message for `deny`.
 */
function answer(id, decision, answers) {
  id = String(id || '');
  if (!ID.test(id) || !valid(decision)) return false;
  const d = dir();
  if (!fs.existsSync(path.join(d, id + '.json')) || taken(id)) return false;
  let rec = {};
  try { rec = JSON.parse(fs.readFileSync(path.join(d, id + '.json'), 'utf8')) || {}; } catch (e) { return false; }
  const asks = Array.isArray(rec.questions) && rec.questions.length > 0;
  let body = decision;
  if (decision === 'answer') {
    const a = asks && answersFor(rec.questions, answers);
    if (!a) return false;
    body = 'answer\n' + JSON.stringify(a);
  } else if (decision === 'allow' && asks) return false;
  else if (['automode', 'rule', 'always'].includes(decision)) {
    // only what the request's own prompt offers
    const ch = Array.isArray(rec.choices) ? rec.choices : [];
    if (asks || !ch.some((c) => c && c.d === decision)) return false;
    if (decision === 'rule') { const t = ruleText(answers); if (!t) return false; body = 'rule\n' + JSON.stringify(t); }
  } else if (decision === 'deny' && typeof answers === 'string' && answers.trim()) {
    if (answers.length > 2000) return false;
    body = 'deny\n' + JSON.stringify(answers.trim());
  }
  const f = path.join(d, id + '.answer');
  Fsx.writeAtomic(f, body, 0o600);
  return true;
}

/**
 * What the hook prints for a decision on `req` (the hook's own input); null
 * prints nothing, leaving the prompt to the terminal. Everything is checked
 * again against `req`, not the copy on disk.
 */
function hookOutput(decision, req, answers) {
  const tool = req && req.tool_name, input = (req && req.tool_input) || {};
  const allow = (updatedInput) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: updatedInput ? { behavior: 'allow', updatedInput } : { behavior: 'allow' } } });
  if (decision === 'answer') {
    const a = answersFor(questionsOf(tool, input), answers);
    return a ? allow({ ...input, answers: a }) : null;
  }
  const updates = (list) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedPermissions: list } } });
  const list = req && req.permission_suggestions;
  if (['automode', 'rule', 'always'].includes(decision)) {
    const ch = choicesOf(tool, input, list) || [];
    if (!ch.some((c) => c.d === decision)) return null;
    if (decision === 'automode') return updates([{ ...AUTOMODE }]);
    // the edited rule, saved where the terminal saves it; `*` alone is any command
    if (decision === 'rule') {
      const t = ruleText(answers);
      if (!t) return null;
      return updates([{ type: 'addRules', rules: [t === '*' ? { toolName: 'Bash' } : { toolName: 'Bash', ruleContent: t }], behavior: 'allow', destination: 'localSettings' }]);
    }
    return updates(offered(list));
  }
  const m = ALWAYS.exec(String(decision));
  if (tool === ASK_TOOL && (decision === 'allow' || m)) return null;
  // sent back exactly as offered: Claude Code decides what the rule means and where it goes
  const rule = m && suggestionsOf(req && req.permission_suggestions)[+decision.slice(7)];
  if (rule) return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedPermissions: [rule] } } };
  if ((decision === 'allow' || m) && tool === 'ExitPlanMode') return allow({ ...input });
  if (decision === 'allow' || m) return allow();
  if (decision === 'deny') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: typeof answers === 'string' && answers.trim() ? answers.trim().slice(0, 2000) : 'ボード(Rally)で拒否されました' } } };
  return null;
}

/**
 * Which sessions the board may hold: terminal and `claude --bg` sessions run
 * hooks with CLAUDE_CODE_ENTRYPOINT=cli (2.1.282); headless runs (-p, SDK)
 * must not sit waiting on a board.
 */
function holdable(env = process.env) {
  return env.CLAUDE_CODE_ENTRYPOINT === 'cli';
}

/**
 * A `claude --bg` session (its supervisor sets CLAUDE_JOB_DIR, 2.1.283). Nobody
 * sees its prompt until someone attaches, so it is held even with no board open.
 */
function background(env = process.env) {
  return holdable(env) && !!env.CLAUDE_JOB_DIR;
}

// Every prompt leaves a per-session mark, held or not, so the board can tell a tool
// waiting for permission from one that is just running long.
function askedDir() { const d = path.join(dir(), 'asked'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; }
function markAsked(req, now = Date.now()) {
  const sid = String((req && req.session_id) || '');
  if (!/^[0-9a-f-]{8,64}$/.test(sid)) return;
  const f = path.join(askedDir(), sid + '.json');
  Fsx.writeJSONAtomic(f, { t: now, tool: String(req.tool_name || '') }, 0o600, 0);
}
// marks older than a week tell nothing (a session's prompt is judged against its current turn): swept now and then
function pruneAsked(now = Date.now(), maxAge = 7 * 86400000) {
  let d; try { d = askedDir(); } catch (e) { return 0; }
  let n = 0;
  for (const f of fs.readdirSync(d)) { const p = path.join(d, f); try { if (now - fs.statSync(p).mtimeMs > maxAge) { fs.unlinkSync(p); n++; } } catch (e) { /* gone already */ } }
  return n;
}
/** When this session last asked for permission (ms), or 0. */
function askedAt(sessionId) {
  if (!/^[0-9a-f-]{8,64}$/.test(String(sessionId || ''))) return 0;
  try { return +JSON.parse(fs.readFileSync(path.join(askedDir(), sessionId + '.json'), 'utf8')).t || 0; } catch (e) { return 0; }
}
/** The hook is installed in the user's settings: only then does no mark mean no prompt. */
let hookSeen = null;
function hookInstalled() {
  if (hookSeen !== null) return hookSeen;
  const f = Env.get('CLAUDE_SETTINGS') || Paths.home('.claude', 'settings.json');
  try { hookSeen = /permhook/.test(fs.readFileSync(f, 'utf8')); } catch (e) { hookSeen = false; }
  return hookSeen;
}

/**
 * The hook's stable path: a shim the app rewrites at launch to run its own
 * node and permhook.js, so settings.json never names a checkout. With the app
 * gone the shim exits 0, leaving the prompt to the terminal.
 */
function shimPath() {
  return Paths.akHome('bin', 'permhook');
}
function shimText(node, js) {
  const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
  return '#!/bin/sh\n'
    + '# Rally\'s PermissionRequest hook (lib/permhook.js), rewritten by the app at launch.\n'
    + `NODE=${q(node)}\nHOOK=${q(js)}\n`
    + '[ -x "$NODE" ] && [ -f "$HOOK" ] || exit 0\n'
    + 'exec "$NODE" "$HOOK"\n';
}
/** Write the shim for this node and this permhook.js. Returns {path, changed}. */
function installShim(node = process.execPath, js = path.join(__dirname, 'permhook.js')) {
  const f = shimPath(), text = shimText(node, js);
  let cur = null;
  try { cur = fs.readFileSync(f, 'utf8'); } catch (e) { /* none yet */ }
  if (cur === text) return { path: f, changed: false };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', text, { mode: 0o755 });
  fs.chmodSync(f + '.tmp', 0o755);
  fs.renameSync(f + '.tmp', f);
  return { path: f, changed: true };
}
/** What settings.json's PermissionRequest hook names: 'shim', 'other' (a checkout's permhook.js), or null. */
function hookTarget() {
  const f = Env.get('CLAUDE_SETTINGS') || Paths.home('.claude', 'settings.json');
  let hooks = [];
  try { hooks = ((JSON.parse(fs.readFileSync(f, 'utf8')).hooks || {}).PermissionRequest || []).flatMap((m) => (m && m.hooks) || []); } catch (e) { return null; }
  const cmds = hooks.map((h) => String((h && h.command) || '')).filter((c) => /permhook/.test(c));
  if (!cmds.length) return null;
  const norm = (c) => c.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^~(?=\/)/, Paths.home());
  // legacy home dirs are links to the current one (Paths.migrate)
  const shims = [shimPath(), ...Paths.legacyDirs('bin', 'permhook')];
  return cmds.some((c) => shims.includes(norm(c))) ? 'shim' : 'other';
}

module.exports = { pruneAsked, choicesOf, bashPrefix, bashRuleSeed, takenText, MAX_WHAT, describe, whatRecord, settled, sessionFor, background, HOLD_BG_MS, shimPath, shimText, installShim, hookTarget, suggestionsOf, markAsked, askedAt, hookInstalled, HOLD_MS, WATCH_MS, dir, touchWatch, watching, whatOf, questionsOf, answersFor, put, taken, takenAnswers, clear, list, answer, hookOutput, holdable };
