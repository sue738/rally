'use strict';
/**
 * readers/claude.js — Claude Code transcripts.
 *
 *   ~/.claude/projects/<project-slug>/<session>.jsonl
 *   ~/.claude/projects/<project-slug>/<session>/subagents/agent-<id>.jsonl
 *
 * Each line: {type, timestamp, cwd?, isMeta?, isSidechain?, entrypoint?,
 * attributionSkill?, toolUseResult?, message:{role, model?, usage?, content}}.
 * `tool_use` / `tool_result` blocks are emitted as their own events at the line's timestamp.
 * A user line is `human` only when it is not a tool-result turn, a slash-command echo,
 * or runtime context (`isMeta`).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const M = require('../model.js');

const AGENT = 'claude';

/** Tools that only observe. They cannot leave a mark. */
const READ_ONLY = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'TodoRead',
  'WebFetch', 'WebSearch', 'Task', 'AskUserQuestion', 'ExitPlanMode',
]);
/** Tools that always reach outside this machine — the recipient already saw it. */
const OUTBOUND = /^(SendMessage|SendUserFile|Artifact|PushNotification|mcp__|Slack|Gmail|Notion)/;
const WRITE = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);
const SHELL = new Set(['Bash', 'BashOutput']);

const COMMAND_RE = /<command-name>\/?([A-Za-z0-9_:\-/.]+)<\/command-name>/;
const ECHO_RE = /^<(local-command-std(out|err)|command-(name|message|args)|local-command-caveat|bash-(input|stdout|stderr)|task-notification)\b/;
/**
 * Lines that never reached the model: a local slash command (starts with <command-name>)
 * and `!` shell mode. These are meta. A skill invocation starts with <command-message>
 * instead and is answered by the model, so it stays a user turn.
 */
const LOCAL_RE = /^<(command-name|local-command-std(out|err)|local-command-caveat|bash-(input|stdout|stderr))\b/;
/** A user line no person typed (task notification, peer, coordinator): `origin.kind` marks it. */
const TASK_RE = /^<task-notification\b/;
// the task's end, not one of a Monitor's events: only the end says its <status>
function taskDone(txt) { const x = String(txt).trimStart(), m = /^<task-notification>[\s\S]*?<task-id>([^<\s]+)<\/task-id>/.exec(x); return m && /<status>[^<]+<\/status>/.test(x) ? m[1] : null; }
function injectedOrigin(e) {
  const k = e && e.origin && e.origin.kind;
  return typeof k === 'string' && k !== 'human';
}
const D = require('../dialogue.js');

// CLAUDE_CONFIG_DIR moves ~/.claude for the CLI itself; the transcripts go with it
function defaultDir() { return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'); }

function listFiles(baseDir) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(baseDir);
  return out;
}

/** Id and parent from the path: a subagent's parent is the directory above `subagents/`, found by name, not depth. */
function identify(file, baseDir) {
  const rel = path.relative(baseDir, file);
  const parts = rel.split(path.sep);
  const slug = parts.length > 1 ? parts[0] : '';
  const id = path.basename(file, '.jsonl');
  const k = parts.lastIndexOf('subagents');
  if (k > 0 && k < parts.length - 1) return { slug, id, parentId: parts[k - 1] };
  return { slug, id, parentId: null };
}

/** Normalise one tool_use block into op + input. */
function classify(name, input) {
  const n = String(name || '');
  const i = input && typeof input === 'object' ? input : {};
  if (n === 'Skill') return { op: 'read', input: { skill: typeof i.skill === 'string' ? i.skill : undefined } };
  if (READ_ONLY.has(n)) return { op: 'read', input: {} };
  if (OUTBOUND.test(n)) return { op: 'outbound', input: {} };
  if (WRITE.has(n)) return { op: 'write', input: M.toolInput({ path: i.file_path || i.notebook_path }) };
  if (SHELL.has(n)) return { op: 'shell', input: M.toolInput({ command: i.command }) };
  return { op: 'other', input: {} };
}

/** Text of an entry's content blocks (strings and text blocks only). */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  return parts.join('\n');
}

function entrypointName(v) {
  if (v === 'cli') return 'cli';
  if (v === 'sdk-cli') return 'sdk-cli';
  if (v === 'claude-code-github-action') return 'github-action';
  return v ? String(v) : null;
}

/**
 * One transcript as a Session. `opts.end`: read no further. `opts.start` + `opts.prev`: the file
 * was read up to `start` into `prev` and only appended to since — only the new lines are read.
 */
function parseFile(file, baseDir, opts = {}) {
  const prev = opts.start > 0 && opts.prev ? opts.prev : null;
  const lines = M.fileLines(file, { start: prev ? opts.start : 0, end: opts.end });
  if (!lines) return null;
  const { slug, id, parentId } = identify(file, baseDir);
  const events = prev ? prev.events.slice() : [];
  // the project is the first cwd seen, else the slug
  let cwd = prev && prev.project && prev.project !== slug ? prev.project : null;
  let entrypoint = prev && prev.entrypoint && prev.entrypoint !== 'unknown' ? prev.entrypoint : null;
  const autoSeen = new Map(prev ? (prev.autoSkills || []).map((a) => [a.name, a.t]) : []);
  for (const line of lines) {
    const e = M.jsonLine(line);
    if (!e) continue;
    // a mid-turn mode change is its own line with no timestamp; the event before it takes it
    if (e.type === 'permission-mode' && typeof e.permissionMode === 'string' && e.permissionMode) {
      if (events.length) events[events.length - 1].mode = e.permissionMode;
      continue;
    }
    const t = M.ms(e.timestamp);
    if (t == null) continue;
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (!entrypoint && e.entrypoint) entrypoint = entrypointName(e.entrypoint);
    if (typeof e.attributionSkill === 'string' && e.attributionSkill && !autoSeen.has(e.attributionSkill)) autoSeen.set(e.attributionSkill, t);
    if (e.type !== 'user' && e.type !== 'assistant') {
      const m = { t, kind: 'meta' };
      if (e.type === 'system' && e.subtype === 'compact_boundary') m.sub = 'compact';
      // a background task finishing, queued for the model as an attachment
      if (e.type === 'attachment' && e.attachment && typeof e.attachment.prompt === 'string') { const id = taskDone(e.attachment.prompt); if (id) m.taskDone = id; }
      // the runtime closing a model turn; a blocking Stop hook's feedback starts the next one
      if (e.type === 'system' && (e.subtype === 'stop_hook_summary' || e.subtype === 'turn_duration')) m.sub = 'turn-end';
      // /model switched it: show the new one now, not after the next answer
      if (e.type === 'system' && e.subtype === 'local_command' && e.commandRun && e.commandRun.command === 'model') {
        const mm = /Set model to `?([^`\n<]+?)`?(?: and| for|<|$)/.exec(String(e.content || ''));
        if (mm) m.model = mm[1].trim();
      }
      events.push(m);
      continue;
    }
    const msg = e.message || {};
    const content = Array.isArray(msg.content) ? msg.content : [];
    const injected = !!(e.isMeta || e.isSidechain);
    const ev = { t, kind: e.type };
    if (injected) ev.injected = true;
    if (e.type === 'assistant') {
      if (typeof msg.model === 'string' && msg.model !== '<synthetic>') ev.model = msg.model;
      // every line of one message carries the message's final stop_reason
      if (typeof msg.stop_reason === 'string') ev.stop = msg.stop_reason;
      const said = textOf(msg.content);
      if (said) { ev.chars = said.length; if (D.isSelfFix(said)) ev.fix = true; }
      const u = msg.usage;
      if (u && typeof u === 'object') {
        ev.tokens = {
          in: u.input_tokens || 0, out: u.output_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
        };
      }
    } else {
      if (typeof e.permissionMode === 'string' && e.permissionMode) ev.mode = e.permissionMode;
      const onlyResults = content.length > 0 && content.every((b) => b && b.type === 'tool_result');
      if (!onlyResults) {
        const txt = textOf(msg.content).trimStart();
        const cm = COMMAND_RE.exec(txt);
        if (LOCAL_RE.test(txt)) {
          const m = { t, kind: 'meta', sub: 'local' };
          if (cm) { m.command = cm[1]; if (cm[1] === 'exit' || cm[1] === 'quit') m.sub = 'exit'; }
          events.push(m);
          continue;
        }
        if (cm) ev.command = cm[1];
        // Esc on a running turn: written as a user line
        if (/^\[Request interrupted by user/.test(txt)) ev.interrupt = true;
        if (TASK_RE.test(txt)) { const id = taskDone(txt); if (id) ev.taskDone = id; }
        if (injectedOrigin(e) || TASK_RE.test(txt)) ev.injected = true;
        else if (!injected && !ECHO_RE.test(txt)) {
          if (D.isSystemText(txt)) ev.injected = true;
          else { ev.human = true; ev.chars = txt.trim().length; const k = D.askKind(txt); if (k) ev.ask = k; }
        }
      }
    }
    events.push(ev);
    // the patch a Write/Edit result carries
    const r = e.toolUseResult;
    let lines = null;
    if (r && typeof r === 'object' && Array.isArray(r.structuredPatch)) {
      lines = { added: 0, removed: 0 };
      for (const hunk of r.structuredPatch) for (const l of (hunk && hunk.lines) || []) {
        if (typeof l !== 'string') continue;
        if (l[0] === '+') lines.added++; else if (l[0] === '-') lines.removed++;
      }
    }
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const c = classify(b.name, b.input);
        const call = { t, kind: 'tool_call', tool: String(b.name || ''), callId: b.id, op: c.op, input: c.input };
        if (injected) call.injected = true;
        events.push(call);
      } else if (b.type === 'tool_result') {
        const rr = { t, kind: 'tool_result', callId: b.tool_use_id, ok: !b.is_error };
        if (injected) rr.injected = true;
        if (b.is_error) rr.text = M.errorText(b.content);
        // run_in_background: a <task-notification> says when it ends (a Monitor can outlive its work)
        if (r && typeof r === 'object' && typeof r.backgroundTaskId === 'string' && r.backgroundTaskId) rr.bgTask = r.backgroundTaskId;
        if (lines) { rr.lines = lines; lines = null; }
        events.push(rr);
      }
    }
  }
  const autoSkills = [...autoSeen].map(([name, t]) => ({ name, t }));
  // a headless run's (`claude -p`, CI) prompt is work, not a person speaking
  if (entrypoint === 'sdk-cli' || entrypoint === 'github-action') {
    for (const ev of events) if (ev.human) { delete ev.human; ev.scripted = true; }
  }
  return M.session({ agent: AGENT, id, file, project: cwd || slug, parentId, entrypoint: entrypoint || 'unknown', autoSkills, events });
}

/** @returns {{agent, dir, sessions: Session[]}} */
function read(opts = {}) {
  const dir = opts.dir || defaultDir();
  const sessions = [];
  for (const f of listFiles(dir)) {
    if (opts.sinceMs && !M.modifiedSince(f, opts.sinceMs)) continue;
    const s = parseFile(f, dir);
    if (s && s.events.length) sessions.push(s);
  }
  return { agent: AGENT, dir, sessions };
}

function detect(opts = {}) {
  const dir = opts.dir || defaultDir();
  try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; }
}

/** Raw text sources for the secret scanner: every transcript file. */
function rawSources(opts = {}) {
  const dir = opts.dir || defaultDir();
  return listFiles(dir).map((file) => ({ file, project: identify(file, dir).slug, scrubbable: true }));
}

module.exports = { AGENT, READ_ONLY, OUTBOUND, COMMAND_RE, ECHO_RE, LOCAL_RE, injectedOrigin, defaultDir, listFiles, identify, classify, textOf, parseFile, read, detect, rawSources };
