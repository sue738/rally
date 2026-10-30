'use strict';
/**
 * search.js — full-text search over what was said in the transcripts (every
 * word required), returning a snippet of the first match. Run on Enter, not
 * per keystroke: transcripts can be large.
 */
const { lines } = require('./made.js');

function textOf(e) {
  // a message sent mid-turn arrives as an attachment
  if (e && e.type === 'attachment' && e.attachment && e.attachment.type === 'queued_command' && typeof e.attachment.prompt === 'string') {
    return e.attachment.prompt.replace(/^<cross-session-message\b[^>]*>\n?|\n?<\/cross-session-message>[\s\S]*$/g, '');
  }
  if (e && e.type === 'user' && e.origin && e.origin.kind === 'peer' && typeof e.origin.body === 'string' && !e.origin.handback) return e.origin.body;
  const c = e && e.message && e.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n');
  const p = e && e.payload;                                   // codex
  if (p && p.type === 'message' && Array.isArray(p.content)) return p.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n');
  return '';
}

// NFKC: macOS stores some text decomposed (NFD); also folds full-width letters
const norm = (x) => String(x).normalize('NFKC').toLowerCase();

/** @returns {string|null} a snippet where every word occurs, or null */
function inFile(file, words) {
  const low = words.map(norm);
  for (const line of lines(file)) {
    if (!line) continue;
    const l = norm(line);
    if (!low.every((w) => l.includes(w))) continue;          // cheap test on the raw line first
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    if (e.isSidechain || (e.isMeta && !(e.origin && e.origin.kind === 'peer'))) continue;
    const t = textOf(e).normalize('NFKC');
    const tl = t.toLowerCase();
    if (!t || !low.every((w) => tl.includes(w))) continue;
    const at = tl.indexOf(low[0]);
    const from = Math.max(0, at - 30);
    return (from ? '…' : '') + t.slice(from, at + 90).replace(/\s+/g, ' ').trim() + (at + 90 < t.length ? '…' : '');
  }
  return null;
}

/** {hits: {'agent:id': snippet}} for the sessions given. */
function run({ words, sessions }) {
  const w = (words || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
  const hits = {};
  if (!w.length) return { hits };
  for (const s of sessions || []) {
    if (!s || !s.file) continue;
    const sn = inFile(s.file, w);
    if (sn) hits[`${s.agent}:${s.id}`] = sn;
  }
  return { hits };
}

module.exports = { run, inFile, textOf };
