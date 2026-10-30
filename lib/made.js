'use strict';
/**
 * made.js — what a session produced, read from its transcript: claude.ai artifact
 * links from Artifact publishes / Claude Docs calls, and files it wrote or edited.
 * Links are only claude.ai ones and files are only shown in Finder, so the panel
 * cannot become a way to open whatever a transcript names.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

const LINK = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+/g;
const MAX = 40;

function text(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
}

/** The lines of a transcript, read in chunks: a very large one exceeds the maximum string length. */
function* lines(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return; }
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    const dec = new (require('string_decoder').StringDecoder)('utf8');   // a character cut by a read stays whole
    let rest = '', n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const parts = (rest + dec.write(buf.subarray(0, n))).split('\n');
      rest = parts.pop();
      yield* parts;
    }
    if (rest) yield rest;
  } finally { fs.closeSync(fd); }
}

/** @returns {{artifacts: {url,title,file,t}[], files: {path,t}[], edited: {path,t,gone?}[]}} newest first */
function fromClaude(file) {
  const calls = new Map();
  const arts = new Map();
  const files = new Map();
  const edited = new Map();
  for (const line of lines(file)) {
    if (!line || line.indexOf('"tool_') < 0) continue;
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    const c = e && e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    const t = Date.parse(e.timestamp) || 0;
    for (const b of c) {
      if (!b) continue;
      if (b.type === 'tool_use') {
        const name = String(b.name || '');
        calls.set(b.id, { name, input: b.input || {} });
        if (name === 'Write' && b.input && typeof b.input.file_path === 'string' && path.isAbsolute(b.input.file_path)) files.set(b.input.file_path, t);
        const ep = b.input && (b.input.file_path || b.input.notebook_path);
        if (/^(Edit|MultiEdit|NotebookEdit)$/.test(name) && typeof ep === 'string' && path.isAbsolute(ep)) edited.set(ep, t);
      } else if (b.type === 'tool_result' && !b.is_error) {
        const call = calls.get(b.tool_use_id);
        if (!call || !/^(Artifact|mcp__claude_ai_Claude_Docs__)/.test(call.name)) continue;
        const out = text(b.content);
        // an artifact read returns its HTML, links and all: only a publish counts
        if (call.name === 'Artifact' && !/^Published /.test(out)) continue;
        const pub = /^Published (.+?) at (https:\/\/claude\.ai\/\S+)/.exec(out);
        for (const url of new Set(out.match(LINK) || [])) {
          const prev = arts.get(url) || {};
          const f = pub && pub[2].startsWith(url) ? pub[1] : call.input.file_path || prev.file || '';
          arts.set(url, { url, title: String(call.input.title || prev.title || (f ? path.basename(f) : '')).slice(0, 80), file: f, t });
        }
      }
    }
  }
  const byT = (a, b) => b.t - a.t;
  return {
    artifacts: [...arts.values()].sort(byT).slice(0, MAX),
    files: [...files.entries()].map(([p, t]) => ({ path: p, t })).filter((f) => fs.existsSync(f.path)).sort(byT).slice(0, MAX),
    // edited ones that are gone since stay, marked: a deletion is a change the review should show
    edited: [...new Map([...edited, ...files]).entries()].map(([p, t]) => ({ path: p, t, ...(fs.existsSync(p) ? {} : { gone: true }) })).sort(byT).slice(0, MAX),
  };
}

// cached per transcript, re-read only when its size or mtime changes
function cachePath() { return Env.get('MADE_CACHE') || Paths.akDir('made-cache.json'); }
function forSession(sess) {
  if (!sess || !sess.file || sess.agent !== 'claude') return { artifacts: [], files: [], edited: [] };
  let st; try { st = fs.statSync(sess.file); } catch (e) { return { artifacts: [], files: [], edited: [] }; }
  // bump the version when the answer's shape changes
  const key = `v3:${st.size}:${st.mtimeMs}`;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) || {}; } catch (e) { /* first time */ }
  const hit = cache[sess.file];
  if (hit && hit.key === key) return hit.made;
  const made = fromClaude(sess.file);
  cache[sess.file] = { key, made, at: Date.now() };
  const keep = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 200);
  try {
    Fsx.writeJSONAtomic(cachePath(), Object.fromEntries(keep), undefined, 0);
  } catch (e) { /* a cache that cannot be written only costs a re-read */ }
  return made;
}

module.exports = { forSession, fromClaude, LINK, lines };
