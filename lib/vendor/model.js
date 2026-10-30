'use strict';
/**
 * model.js — the one shape every reader produces. Readers translate their
 * native format into Session/Event; nothing downstream sees a native format.
 *
 * Event {
 *   t         ms since epoch (required)
 *   kind      'user' | 'assistant' | 'tool_call' | 'tool_result' | 'meta'
 *   end       optional busy span [t, end] when the format records a turn's duration (Cursor)
 *   tool      tool name;  callId  pairs a call with its result
 *   op        tool_call: 'read' | 'write' | 'shell' | 'outbound' | 'other'
 *   input     tool_call: {command?, path?} — nothing else is kept, to stay small in memory
 *   ok, text  tool_result: success, and the error text (≤ 200 chars) when not
 *   model, tokens {in, out, cacheRead, cacheWrite} — when the format says
 *   human     user: a person typed it (not a tool result, command echo, injected
 *             context, or the prompt of a headless run)
 *   scripted  user: that headless prompt — work, not dialogue
 *   chars     user/assistant: length of what was said (the text is not kept)
 *   ask, fix  see dialogue.js
 *   injected  written by the runtime (Claude's isMeta / isSidechain); on tool events,
 *             a subagent's own tool use
 *   command   the slash command a person typed, without the slash
 *   lines     tool_result: {added, removed} when the format records the patch
 *   sub       meta: 'compact' | 'local' (terminal-only line) | 'exit' | 'aborted' (Codex)
 * }
 * Session also carries `entrypoint` (who started it) and `autoSkills` ([{name, t}]).
 */

const KINDS = new Set(['user', 'assistant', 'tool_call', 'tool_result', 'meta']);
const OPS = new Set(['read', 'write', 'shell', 'outbound', 'other']);

/** Work-evidence kinds: the ones that prove the agent was doing something. */
const WORK_KINDS = new Set(['user', 'assistant', 'tool_call', 'tool_result']);

const MAX_COMMAND = 2000;
const MAX_TEXT = 200;

/** Build a Session, sorting events and dropping malformed ones. Never throws (undercount, never invent). */
function session(o) {
  const events = [];
  for (const e of o.events || []) {
    if (!e || !Number.isFinite(e.t) || !KINDS.has(e.kind)) continue;
    if (e.end != null && !(Number.isFinite(e.end) && e.end >= e.t)) delete e.end;
    if (e.op != null && !OPS.has(e.op)) e.op = 'other';
    events.push(e);
  }
  events.sort((a, b) => a.t - b.t);
  return {
    agent: String(o.agent),
    // must be unique per agent: a reader whose native id is shared passes the file
    id: String(o.id || o.file || ''),
    file: String(o.file || ''),
    project: String(o.project || ''),
    parentId: o.parentId == null ? null : String(o.parentId),
    // written by a non-interactive caller (an a2a server, a cron job)
    automated: !!o.automated,
    entrypoint: o.entrypoint ? String(o.entrypoint) : 'unknown',
    autoSkills: Array.isArray(o.autoSkills) ? o.autoSkills : [],
    events,
  };
}

/** Sorted, de-duplicated ms stamps of work evidence (one line's several events count once). */
function workStamps(s) {
  const out = [];
  let prev = null;
  for (const e of s.events) {
    if (!WORK_KINDS.has(e.kind) || e.t === prev) continue;
    out.push(e.t); prev = e.t;
  }
  return out; // events are already sorted
}

/** Explicit busy spans [t, end] the format recorded (Cursor turns). */
function workSpans(s) {
  const out = [];
  for (const e of s.events) if (WORK_KINDS.has(e.kind) && e.end != null && e.end > e.t) out.push([e.t, e.end]);
  return out;
}

/** Normalise a tool_call input down to what metrics need. */
function toolInput(o) {
  const out = {};
  if (o && typeof o.command === 'string' && o.command) out.command = o.command.slice(0, MAX_COMMAND);
  if (o && typeof o.path === 'string' && o.path) out.path = o.path;
  return out;
}

/** Error text for a failed tool_result, flattened and capped. */
function errorText(v) {
  let s = '';
  if (typeof v === 'string') s = v;
  else if (Array.isArray(v)) s = v.map((x) => (x && typeof x === 'object' && typeof x.text === 'string') ? x.text : (typeof x === 'string' ? x : '')).join(' ');
  else if (v && typeof v === 'object') { try { s = JSON.stringify(v); } catch (e) { s = ''; } }
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** Parse an ISO timestamp (or ms number) to ms, or null. */
function ms(iso) {
  if (iso == null) return null;
  if (typeof iso === 'number') return Number.isFinite(iso) ? iso : null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** True when the file was modified at or after sinceMs (stat only; unreadable → false). */
function modifiedSince(file, sinceMs) {
  try { return require('fs').statSync(file).mtimeMs >= sinceMs; } catch (e) { return false; }
}

/**
 * The lines of a file, read in 8MB pieces (V8 cannot make a string past ~512MB), or null
 * when it cannot be opened. `start` / `end`: only the bytes in [start, end) — the part
 * appended since the last read, capped at the size the caller keyed its cache with.
 */
const CHUNK = 8 * 1024 * 1024;
function fileLines(file, opts = {}) {
  const fs = require('fs');
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }
  return (function* () {
    try {
      let pos = opts.start > 0 ? opts.start : 0;
      const end = opts.end != null ? opts.end : Infinity;
      let size = 0; try { size = fs.fstatSync(fd).size; } catch (e) { /* read what is there */ }
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(65536, Math.min(size, end) - pos)));
      const dec = new (require('string_decoder').StringDecoder)('utf8');   // a character cut by a read stays whole
      let rest = '', n;
      while (pos < end && (n = fs.readSync(fd, buf, 0, Math.min(buf.length, end - pos), pos)) > 0) {
        pos += n;
        const parts = (rest + dec.write(buf.subarray(0, n))).split('\n');
        rest = parts.pop();
        yield* parts;
      }
      rest += dec.end();
      if (rest) yield rest;
    } finally { fs.closeSync(fd); }
  })();
}

/** A fingerprint of a file's first `n` bytes (at most 4KB): the same file, not one written anew. */
const HEAD = 4096;
function fileHead(file, n) {
  const fs = require('fs');
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }
  try {
    const b = Buffer.allocUnsafe(Math.max(0, Math.min(HEAD, n == null ? HEAD : n)));
    const k = fs.readSync(fd, b, 0, b.length, 0);
    return require('crypto').createHash('sha1').update(b.subarray(0, k)).digest('hex').slice(0, 16) + ':' + k;
  } catch (e) { return null; } finally { fs.closeSync(fd); }
}

/**
 * Has the file only grown since it was read up to `prev.size`? Longer, same head (`prev.head`),
 * and that read ended at a line end — then the lines from prev.size on are exactly the new ones.
 */
function appendedSince(file, prev, size) {
  if (!prev || !(prev.size > 0) || !prev.head || !(size > prev.size)) return false;
  const fs = require('fs');
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return false; }
  try {
    const b = Buffer.allocUnsafe(1);
    if (fs.readSync(fd, b, 0, 1, prev.size - 1) !== 1 || b[0] !== 0x0a) return false;
  } catch (e) { return false; } finally { fs.closeSync(fd); }
  return fileHead(file, prev.size) === prev.head;
}

/** Parse one JSONL line, or null. */
function jsonLine(line) {
  if (!line) return null;
  try { return JSON.parse(line); } catch (e) { return null; }
}

module.exports = { KINDS, OPS, WORK_KINDS, MAX_COMMAND, MAX_TEXT, session, workStamps, workSpans, toolInput, errorText, modifiedSince, ms, jsonLine, fileLines, fileHead, appendedSince };
