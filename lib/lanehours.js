'use strict';
/**
 * lanehours.js — how long a quiet session takes to move lanes on its own (lib/live.js classify):
 * Your Turn → Waiting after `staleH`, Waiting → Completed after `doneH`. Set from ⚙ → 列が移るまでの時間
 * (`rally lanehours --stale H --done H`), kept in ~/.rally/lane-hours.json.
 */
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

// a day quiet is possibly forgotten; three days quiet is let go (a weekend does not close Friday's work)
const STALE_H = 24;
const DONE_H = 72;
// what ⚙ offers; the CLI takes any whole hour up to the widest window the board reads
const STALE_CHOICES = [6, 12, 24, 48];
const DONE_CHOICES = [24, 48, 72, 168];
const MAX_H = 720;

function file() { return Paths.akHome('lane-hours.json'); }

const hour = (v) => { const n = Math.round(+v); return Number.isFinite(n) && n >= 1 && n <= MAX_H ? n : null; };

/** {staleH, doneH}: what was saved, else the defaults; doneH is never below staleH. */
function read() {
  const j = Fsx.readJSON(file(), null) || {};
  const staleH = hour(j.staleH) || STALE_H;
  const doneH = Math.max(hour(j.doneH) || DONE_H, staleH);
  return { staleH, doneH };
}

/** Save both; a Completed time below the Waiting one is refused (the Waiting lane would never fill). */
function write(staleH, doneH) {
  const s = hour(staleH), d = hour(doneH);
  if (!s || !d) return { ok: false, error: `hours are whole numbers from 1 to ${MAX_H}` };
  if (d < s) return { ok: false, error: 'the time to Completed must not be shorter than the time to Waiting' };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  Fsx.writeJSONAtomic(file(), { staleH: s, doneH: d });
  return { ok: true, staleH: s, doneH: d };
}

module.exports = { STALE_H, DONE_H, STALE_CHOICES, DONE_CHOICES, MAX_H, file, read, write };
