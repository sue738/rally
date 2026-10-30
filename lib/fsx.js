'use strict';
/**
 * fsx.js — the file habits every store here shares.
 *
 * Atomic writes via a temp file renamed over the target. The temp name is unique per
 * write: several processes (server, app, permission hook) write the same stores.
 *
 * A mkdir lock for read-modify-write. A lock older than `staleMs` is broken by renaming
 * it aside and checking it is the one seen stale, so two breakers cannot remove a fresh lock.
 */
const fs = require('fs');
const path = require('path');

const tmpName = (file) => `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;

/** Write `data` (a string or Buffer) to `file` atomically. */
function writeAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpName(file);
  try {
    fs.writeFileSync(tmp, data, mode != null ? { mode } : undefined);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* never written */ }
    throw e;
  }
}

/** Write `obj` as JSON (`indent` spaces, default 2; 0 for one line) atomically. */
function writeJSONAtomic(file, obj, mode, indent = 2) {
  writeAtomic(file, JSON.stringify(obj, null, indent || undefined) + (indent ? '\n' : ''), mode);
}

/** The JSON in `file`, or `fallback` when it is missing or does not parse. */
function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Run `fn` holding the lock `<file>.lock`; throws if another process holds it longer than `waitMs`. */
function withLock(file, fn, { waitMs = 5000, staleMs = 10000 } = {}) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let seen = null;
      try { seen = fs.statSync(lock); } catch (x) { continue; }        // released meanwhile
      if (Date.now() - seen.mtimeMs > staleMs) {
        const aside = `${lock}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.stale`;
        try { fs.renameSync(lock, aside); } catch (x) { continue; }      // someone else broke it
        let got = null;
        try { got = fs.statSync(aside); } catch (x) { /* gone */ }
        if (got && got.ino === seen.ino && got.mtimeMs === seen.mtimeMs) { try { fs.rmdirSync(aside); } catch (x) { /* gone */ } continue; }
        // what was renamed is a fresh lock another process took after the stale
        // one went: give it back if nobody holds the name now, and wait
        try { if (!fs.existsSync(lock)) fs.renameSync(aside, lock); else fs.rmdirSync(aside); } catch (x) { /* its owner removes it */ }
      }
      if (Date.now() > deadline) throw new Error(`${path.basename(file)} is locked by another process`);
      sleep(20);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch (e) { /* already gone */ } }
}

module.exports = { writeAtomic, writeJSONAtomic, readJSON, withLock, tmpName };
