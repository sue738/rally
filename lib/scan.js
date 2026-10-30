'use strict';
/**
 * scan.js — read the transcripts, but only the ones that changed.
 *
 * Each refresh is a one-shot process, so the cache is on disk:
 * path → {mtime, size, sessions}; only files whose mtime or size moved are
 * parsed. Claude and Codex (per-file readers) use it; Gemini and Cursor fall
 * back to their reader's read(). Classification is not cached (depends on now).
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Fsx = require('./fsx.js');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');
const Readers = require('./vendor/readers/index.js');

const NAME = 'rally';
const VERSION = 11;         // bump when the cached shape changes (or what a reader emits); 10: codex subagents; 11: codex turn bounds
const CACHEABLE = new Set(['claude', 'codex']);
// An agent whose directory yielded nothing to show (e.g. a Gemini tree of
// only automated files) is skipped, and re-checked this often.
const EMPTY_RECHECK_MS = 10 * 60000;

function cachePath() {
  return Env.get('SCAN_CACHE') || Paths.akDir('scan-cache.json');
}

// ---- persistent mode (the worker and the server: one process that keeps running) ----
// A one-shot refresh parses the 18 MB cache, finds the files with find(1) (stat-ing 13,000) and writes the cache back: about 350 ms
// of a 600 ms refresh. A process that stays keeps the cache in memory (written to disk now and then, for a cold start), keeps the
// list of transcripts up to date from file-system events, and walks the whole tree again only now and then, so a missed event
// shows within RECONCILE_MS.
let persistent = false;
const FLUSH_MS = 30000, RECONCILE_MS = 60000;
let mem = null;                    // {cache, dirty, flushAt}: the cache as of the last scan
const trees = new Map();           // dir → {mtimes: Map(path → mtimeMs), touched: Set(path), watcher, at}
function persist(on = true) {
  persistent = !!on;
  if (!persistent) { for (const t of trees.values()) { try { t.watcher && t.watcher.close(); } catch (e) { /* gone */ } } trees.clear(); flushCache(true); mem = null; }
}
function flushCache(force) {
  if (!mem || !mem.dirty || (!force && Date.now() - mem.flushAt < FLUSH_MS)) return;
  try { Fsx.writeJSONAtomic(cachePath(), mem.cache, undefined, 0); } catch (e) { /* a cache that cannot be written just means a slow start */ }
  mem.dirty = false; mem.flushAt = Date.now();
}

function readCache() {
  if (persistent && mem) return mem.cache;
  let c;
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    c = j && j.version === VERSION && j.files ? { agents: {}, ...j } : { version: VERSION, files: {}, agents: {} };
  } catch (e) { c = { version: VERSION, files: {}, agents: {} }; }
  if (persistent) mem = { cache: c, dirty: false, flushAt: Date.now() };
  return c;
}

function writeCache(c) {
  if (persistent) { mem = { cache: c, dirty: true, flushAt: mem ? mem.flushAt : Date.now() }; flushCache(false); return; }
  const f = cachePath();
  try {
    Fsx.writeJSONAtomic(f, c, undefined, 0);       // atomic: a torn read would drop every entry
  } catch (e) { /* a cache that cannot be written just means a slow refresh */ }
}

/** Every transcript under dir, kept up to date by events; the files touched since `sinceMs`. null when it cannot be kept (then find(1)). */
function watchedFiles(dir, sinceMs) {
  let t = trees.get(dir);
  const now = Date.now();
  if (!t || now - t.at > RECONCILE_MS) {
    if (t && t.watcher) { try { t.watcher.close(); } catch (e) { /* gone */ } }
    let out;
    try { out = execFileSync('find', [dir, '-type', 'f', '-name', '*.jsonl', '-print0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }); } catch (e) { return null; }
    const mtimes = new Map();
    for (const f of out.split('\0').filter(Boolean)) { try { mtimes.set(f, fs.statSync(f).mtimeMs); } catch (e) { /* gone since */ } }
    t = { mtimes, touched: new Set(), watcher: null, at: now };
    try {
      t.watcher = fs.watch(dir, { recursive: true, persistent: false }, (ev, name) => { if (name && String(name).endsWith('.jsonl')) t.touched.add(path.join(dir, String(name))); });
      t.watcher.on('error', () => { t.at = 0; });
    } catch (e) { return null; }
    trees.set(dir, t);
  }
  for (const f of t.touched) { try { t.mtimes.set(f, fs.statSync(f).mtimeMs); } catch (e) { t.mtimes.delete(f); } }
  t.touched.clear();
  const out = [];
  for (const [f, m] of t.mtimes) if (!sinceMs || m >= sinceMs) out.push(f);
  return out;
}

/**
 * The transcript files touched since `sinceMs`, via find(1) -newermt — much
 * faster than stat-ing the whole tree from JS. A resumed old session shows up
 * because resuming appends to (and so touches) its file. Falls back to the
 * reader's own walk.
 */
function recentFiles(reader, dir, sinceMs) {
  if (persistent && fs.existsSync(dir)) { const w = watchedFiles(dir, sinceMs); if (w) return w; }
  if (sinceMs && fs.existsSync(dir)) {
    const d = new Date(sinceMs);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    try {
      const out = execFileSync('find', [dir, '-type', 'f', '-name', '*.jsonl', '-newermt', stamp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      return out.split('\n').filter(Boolean);
    } catch (e) { /* fall through to the JS walk */ }
  }
  try { return reader.listFiles(dir); } catch (e) { return []; }
}

/**
 * Sessions for the window, using the cache where the file has not moved.
 * @returns {{found: Array, stats: {parsed, cached, agents}}}
 */
function sessions(opts = {}) {
  const sinceMs = opts.sinceMs || 0;
  const only = opts.only && opts.only.length ? new Set(opts.only) : null;
  const dirs = opts.dirs || {};
  const cache = opts.noCache ? { version: VERSION, files: {}, agents: {} } : readCache();
  const next = { version: VERSION, files: {}, agents: { ...(cache.agents || {}) } };
  const found = [];
  let parsed = 0, cached = 0;

  for (const reader of Readers.READERS) {
    const agent = reader.AGENT;
    if (only && !only.has(agent)) continue;
    // Cursor's history is in another app's data: even looking there triggers a
    // macOS privacy prompt. Only when asked (RALLY_CURSOR=1, or a dir given).
    if (agent === 'cursor' && !dirs[agent] && Env.get('CURSOR') !== '1') continue;
    const dir = dirs[agent] || reader.defaultDir();
    const installed = reader.detect({ dir });
    const seen = (cache.agents || {})[agent];
    const asked = (opts.extra || []).some((f) => path.resolve(f).startsWith(path.resolve(dir) + path.sep));
    // not skipped: a file asked for by name (a 完了 card kept past the window), or antigravity (its
    // logs are the board's own and a new one must show at once)
    if (!opts.noCache && !asked && agent !== 'antigravity' && !(only && only.has(agent)) && seen && seen.useful === 0 && Date.now() - seen.at < EMPTY_RECHECK_MS) {
      found.push({ agent, installed, dir, sessions: [], skipped: 'nothing here last time' });
      continue;
    }

    if (!CACHEABLE.has(agent) || !reader.listFiles || !reader.parseFile) {
      const r = reader.read({ dir, sinceMs });     // gemini, cursor
      const usefulR = r.sessions.filter((s2) => !s2.automated).length;
      const prevR = (cache.agents || {})[agent];
      next.agents[agent] = { at: (usefulR === 0 || !prevR) ? Date.now() : prevR.at, useful: usefulR };
      found.push({ ...r, installed });
      continue;
    }

    const out = [];
    // files asked for by name come whatever their age, but only from under this agent's root
    const extra = new Set((opts.extra || []).filter((f) => path.resolve(f).startsWith(path.resolve(dir) + path.sep)));
    const files = recentFiles(reader, dir, sinceMs);
    for (const f of files) extra.delete(f);
    for (const file of [...files, ...extra]) {
      let st;
      try { st = fs.statSync(file); } catch (e) { continue; }
      if (sinceMs && st.mtimeMs < sinceMs && !extra.has(file)) continue;
      const key = file;
      const hit = cache.files[key];
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
        next.files[key] = hit;
        cached++;
        for (const s of hit.sessions) out.push(s);
        continue;
      }
      // A Claude transcript only appended to since last read: parse just the new
      // lines on top of the cached session. Anything else is read whole.
      const grown = agent === 'claude' && hit && hit.head && hit.sessions && hit.sessions.length === 1
        && require('./vendor/model.js').appendedSince(file, { size: hit.size, head: hit.head }, st.size);
      const s = grown ? reader.parseFile(file, dir, { start: hit.size, prev: hit.sessions[0], end: st.size }) : reader.parseFile(file, dir, { end: st.size });
      const list = !s ? [] : (Array.isArray(s) ? s : [s]);
      parsed++;
      next.files[key] = { mtime: st.mtimeMs, size: st.size, sessions: list };
      if (agent === 'claude') { const hd = require('./vendor/model.js').fileHead(file, st.size); if (hd) next.files[key].head = hd; }
      for (const one of list) out.push(one);
    }
    // `at` moves only for an agent that yields nothing (the skip timer reads
    // it), so an unchanged scan leaves the cache unchanged and unwritten.
    const useful = out.filter((s2) => !s2.automated).length;
    const prevA = (cache.agents || {})[agent];
    next.agents[agent] = { at: (useful === 0 || !prevA) ? Date.now() : prevA.at, useful };
    found.push({ agent, installed, dir, sessions: out });
  }

  if (!opts.noCache) {
    // Keep entries this run did not visit (a narrow --agent/--hours run must
    // not empty the cache); drop those older than a week.
    const keep = Date.now() - 7 * 86400000;
    let dropped = 0;
    for (const [k, v] of Object.entries(cache.files)) {
      if (k in next.files) continue;
      if (v.mtime > keep) next.files[k] = v; else dropped++;
    }
    // The cache is large: rewrite it only when something changed.
    const sameSize = Object.keys(next.files).length === Object.keys(cache.files).length;
    const agentsChanged = JSON.stringify(next.agents) !== JSON.stringify(cache.agents || {});
    if (parsed || dropped || !sameSize || agentsChanged) writeCache(next);
  }
  return { found, stats: { parsed, cached } };
}

module.exports = { cachePath, readCache, writeCache, sessions, persist, flushCache, VERSION };
