'use strict';
/**
 * text.js — cutting strings without breaking characters, and JSON that a
 * strict parser will accept: Foundation's JSONSerialization rejects the whole
 * document over one lone surrogate.
 */

/** Cut to `n` UTF-16 units without leaving a half character behind. */
function cut(s, n) {
  const t = String(s == null ? '' : s);
  if (t.length <= n) return t;
  let end = n;
  const c = t.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;      // do not end on a high surrogate
  return t.slice(0, end);
}

/**
 * Replace unpaired surrogates so the text survives a strict JSON parser.
 * One pass with a lookbehind, so adjacent lone low halves are all caught.
 */
function sane(s) {
  return String(s == null ? '' : s)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

/**
 * Claude Code wraps text you paste in <pasted_content id="x">…</pasted_content id="x"> (a stray backslash form
 * can come with a paste of it): only the words are the message.
 */
function unpaste(s) {
  const t = String(s == null ? '' : s);
  if (!/pasted_content/.test(t)) return t;
  return t.replace(/\n?<\\?\/?pasted_content\b[^>]*>\n?/g, '\n').replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
}

/** JSON.stringify, with any lone surrogate escape repaired. */
function json(value) {
  return JSON.stringify(value, (k, v) => (typeof v === 'string' ? sane(v) : v));
}

module.exports = { cut, sane, json, unpaste };
