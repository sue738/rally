'use strict';
/**
 * What a session's tokens would cost at API prices (USD per million tokens).
 * The list is lib/rates.json:
 *   claude  model → [in, out, cache read, cache write for 5 minutes, cache write for an hour]
 *   menu    which model each name in claude's model menu stood for when the list was written
 *   codex   model → [in, out] (OpenAI's standard tier, developers.openai.com/api/docs/pricing)
 * Only models whose rates match Claude Code's own `costUSD` records are listed; an unlisted
 * model shows as unpriced rather than guessed. On a subscription this is a measure of size,
 * not an invoice.
 *
 * Prices change more often than the app is released. The app fetches this same file from the
 * repository with its daily update check (Update.swift) and leaves it at ~/.rally/rates.json;
 * whichever of the two is dated later (`asof`) is the one in use, so a price change is one
 * commit to that file and no release.
 */
const fs = require('fs');
const Paths = require('./paths.js');

const NAME = /^[a-z0-9][a-z0-9.-]{0,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BYTES = 65536;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/** model → a row of n prices, or null. The copy has no prototype: a model named `constructor` finds nothing. */
function table(o, n) {
  if (!plain(o) || Object.keys(o).length > 200) return null;
  const out = Object.create(null);
  for (const [k, r] of Object.entries(o)) {
    if (!NAME.test(k) || !Array.isArray(r) || r.length !== n || !r.every((v) => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 10000)) return null;
    out[k] = r.slice();
  }
  return out;
}

/** A price list as this file means it, or null. What was fetched is used only when every part of it is a plain number under a plain name. */
function valid(j) {
  if (!plain(j) || typeof j.asof !== 'string' || !DAY.test(j.asof)) return null;
  const claude = table(j.claude, 5), codex = j.codex === undefined ? Object.create(null) : table(j.codex, 2);
  if (!claude || !codex || !Object.keys(claude).length) return null;
  const menu = Object.create(null);
  if (j.menu !== undefined) {
    if (!plain(j.menu)) return null;
    for (const [k, v] of Object.entries(j.menu)) {
      if (!NAME.test(k) || typeof v !== 'string' || !claude[v]) return null;
      menu[k] = v;
    }
  }
  return { asof: j.asof, claude, codex, menu };
}

const BUILT = valid(require('./rates.json'));
if (!BUILT) throw new Error('lib/rates.json is not a price list');

let seen = null;   // { key: the fetched file as it was read, list }
/** The list in use: the fetched one when it is well-formed and dated later than this build's. Read again when the file changes. */
function current() {
  const f = Paths.akHome('rates.json');
  let st = null;
  try { st = fs.statSync(f); } catch (e) { st = null; }
  const key = f + ':' + (st ? st.mtimeMs + ':' + st.size : '');
  if (seen && seen.key === key) return seen.list;
  let list = BUILT;
  if (st && st.isFile() && st.size <= MAX_BYTES) {
    try { const j = valid(JSON.parse(fs.readFileSync(f, 'utf8'))); if (j && j.asof > BUILT.asof) list = j; } catch (e) { /* not a list: this build's */ }
  }
  seen = { key, list };
  return list;
}

/** claude-haiku-4-5-20251001 → claude-haiku-4-5; claude-opus-5-5[1m] → claude-opus-5-5 */
function rateOf(model) {
  const m = String(model || '').replace(/\[[^\]]*\]$/, '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  return current().claude[m] || null;
}
/** by: { model: { i, o, cr, cw5, cw1 } } → { usd, unpriced: [model…] } */
function cost(by) {
  let usd = 0; const unpriced = [];
  for (const [model, t] of Object.entries(by || {})) {
    const r = rateOf(model);
    if (!r) { if ((t.i || 0) + (t.o || 0) + (t.cr || 0) + (t.cw5 || 0) + (t.cw1 || 0) > 0) unpriced.push(model); continue; }
    usd += ((t.i || 0) * r[0] + (t.o || 0) * r[1] + (t.cr || 0) * r[2] + (t.cw5 || 0) * r[3] + (t.cw1 || 0) * r[4]) / 1e6;
  }
  return { usd, unpriced };
}

/**
 * What the page shows beside a model: { asof, claude: { opus: [in, out], … }, codex: { model: [in, out] } }.
 * claude's are by the names its menu uses. `names` is what each stands for today ({ fable: 'claude-fable-5-2' },
 * lib/aliases.js); a name the CLI has not answered for takes the list's own `menu`. A name whose model is
 * not listed has no price rather than its predecessor's. `built`: this build's list, whatever was fetched.
 */
function shown(names, built) {
  const l = built ? BUILT : current(), claude = {};
  for (const k of new Set([...Object.keys(l.menu), ...Object.keys(names || {})])) {
    if (!NAME.test(k)) continue;
    const id = names && own(names, k) && typeof names[k] === 'string' ? names[k] : l.menu[k];
    const r = id && l.claude[String(id).replace(/\[[^\]]*\]$/, '')];
    if (r) claude[k] = r.slice(0, 2);
  }
  return { asof: l.asof, claude, codex: { ...l.codex } };
}

module.exports = { get RATES() { return current().claude; }, rateOf, cost, shown, valid, current };
