'use strict';
const { t: tr } = require('./i18n.js');
/**
 * turns.js — what one turn of a session changed. A turn runs from one of your messages to the next.
 *
 * Claude Code keeps, with every Edit / Write result, the file as it was just before (originalFile). So a turn's change
 * to a file is the file before the turn's first edit to it, against the file before the next turn's first edit to it,
 * or the file as it is now when no later turn edited it. That answers "what did my last request change" when the
 * whole diff against the last commit (lib/changes.js) has every turn in it. Read-only.
 *
 * Only files the turn edited with Edit / MultiEdit / Write are listed; a change made only through Bash is not.
 */
const fs = require('fs');
const path = require('path');
const Claude = require('./vendor/readers/claude.js');
const Made = require('./made.js');
const Changes = require('./changes.js');

const EDIT = /^(Edit|MultiEdit|Write)$/;
const MAX_TEXT = 200;

function firstAtOrBefore(starts, t) {
  let lo = 0, hi = starts.length - 1, at = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= t) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}

/**
 * Every turn that edited a file, oldest first: {since, text, edits, files: Map(path → {before, patches})}.
 * before: the file just before the turn's first edit to it — null when that edit created it, undefined when the
 * transcript did not keep it (then patches, the edits' own hunks, stand in).
 */
function scan(file) {
  const parsed = Claude.parseFile(file, path.dirname(path.dirname(file)));
  const humans = ((parsed && parsed.events) || []).filter((e) => e.human).map((e) => e.t);
  // the work before your first message (a started prompt, a resumed session) is a turn of its own
  const starts = [0, ...humans].sort((a, b) => a - b);
  const humanAt = new Set(humans);
  const said = new Map();
  const calls = new Map();
  const turns = new Map();
  for (const line of Made.lines(file)) {
    if (!line || (line.indexOf('"tool_') < 0 && line.indexOf('"user"') < 0)) continue;
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    const t = Date.parse(e && e.timestamp);
    if (!Number.isFinite(t)) continue;
    const c = e.message && e.message.content;
    if (e.type === 'user' && humanAt.has(t) && !said.has(t)) { const x = Claude.textOf(c).trim(); if (x) said.set(t, x.replace(/\s+/g, ' ').slice(0, MAX_TEXT)); }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use' && EDIT.test(String(b.name || ''))) {
        const p = b.input && b.input.file_path;
        if (typeof p === 'string' && path.isAbsolute(p)) calls.set(b.id, { path: p, t });
      } else if (b.type === 'tool_result') {
        const call = calls.get(b.tool_use_id);
        if (!call) continue;
        calls.delete(b.tool_use_id);
        const r = e.toolUseResult;
        // refused or failed: nothing was written
        if (b.is_error || !r || typeof r !== 'object') continue;
        const k = firstAtOrBefore(starts, call.t);
        if (!turns.has(k)) turns.set(k, { since: starts[k] || call.t, edits: 0, files: new Map() });
        const turn = turns.get(k);
        turn.edits++;
        if (!turn.since) turn.since = call.t;
        let f = turn.files.get(call.path);
        if (!f) {
          const before = r.type === 'create' ? null : typeof r.originalFile === 'string' ? r.originalFile : undefined;
          f = { before, patches: [] };
          turn.files.set(call.path, f);
        }
        if (Array.isArray(r.structuredPatch)) f.patches.push(r.structuredPatch);
      }
    }
  }
  return [...turns.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ ...v, text: said.get(starts[k]) || '' }));
}

/** The edits' own hunks, one after another, when the file before the turn is not known (line numbers as each edit saw them). */
function patchText(patches) {
  const out = [];
  for (const hunks of patches) for (const h of hunks || []) {
    if (!h || !Array.isArray(h.lines)) continue;
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines.filter((l) => typeof l === 'string'));
  }
  return out.join('\n');
}

function readNow(p) {
  try { const st = fs.statSync(p); if (!st.isFile()) return undefined; return fs.readFileSync(p, 'utf8'); }
  catch (e) { return e && e.code === 'ENOENT' ? null : undefined; }
}

/**
 * The files one turn changed, shaped as lib/changes.js of() answers (the change viewer draws either).
 * n: the turn's number among the turns that changed something, 1 the oldest; 'last' (or nothing) the newest.
 * A file's `now`: its line numbers are the file's as it is now (comments on them say where to look).
 */
function changes(file, n) {
  const list = scan(file);
  const of = list.length;
  if (!of) return { files: [], roots: [], turn: { n: 0, of: 0 } };
  const i = n === 'last' || n == null || n === '' ? of - 1 : Math.max(0, Math.min(of - 1, (parseInt(n, 10) || of) - 1));
  const turn = list[i];
  const home = Changes.homeDir();
  const out = [], roots = new Map();
  for (const [p, f] of [...turn.files.entries()].slice(0, Changes.MAX_FILES)) {
    const sc = Changes.screen(p, home);
    if (sc.outside) { out.push({ path: p, outside: true, diff: '', added: 0, removed: 0 }); continue; }
    if (sc.secret) { out.push({ path: p, secret: true, diff: '', added: 0, removed: 0 }); continue; }
    const place = Changes.placeOf(p);
    if (place.root && !roots.has(place.root)) roots.set(place.root, { root: place.root });
    const base = { path: p, ...(place.root ? { root: place.root, git: true } : { git: false }) };
    if (place.ignored) { out.push({ ...base, ignored: true, diff: '', added: 0, removed: 0 }); continue; }
    // after the turn: the file just before a later turn's first edit to it, else as it is now
    const later = list.slice(i + 1).find((x) => x.files.has(p));
    const now = !later;
    const after = later ? later.files.get(p).before : readNow(p);
    let diff, approx = false;
    if (f.before === undefined || after === undefined) { diff = patchText(f.patches); approx = true; }
    // made in the turn and gone after it: nothing to compare, said as deleted
    else if (f.before === null && after === null) diff = '';
    else diff = Changes.textDiff(f.before, after);
    if (diff == null) { out.push({ ...base, error: tr('差分が大きすぎるか、時間内に取れませんでした'), diff: '', added: 0, removed: 0 }); continue; }
    out.push({
      ...base, diff: diff.slice(0, Changes.MAX_DIFF), truncated: diff.length > Changes.MAX_DIFF, ...Changes.count(diff),
      ...(f.before === null ? { created: true } : {}), ...(after === null ? { deleted: true } : {}),
      ...(now && !approx ? { now: true } : {}), ...(approx ? { approx: true } : {}),
    });
  }
  return { files: Changes.withRel(out, home), roots: [...roots.values()], turn: { n: i + 1, of, since: turn.since, text: turn.text, edits: turn.edits, last: i === of - 1 } };
}

/** changes() for a session the board found (lib/board/sessions.js sessionRecord); Claude Code's transcripts only. */
function forSession(sess, n) {
  if (!sess || sess.agent !== 'claude' || !sess.file) return { files: [], roots: [], turn: { n: 0, of: 0 }, error: tr('ターンごとの差分は Claude Code のセッションだけです') };
  return changes(sess.file, n);
}

module.exports = { scan, changes, forSession, patchText };
