'use strict';
/**
 * What a session's tokens would cost at API prices (USD per million tokens).
 * Only models whose rates match Claude Code's own `costUSD` records are
 * listed; an unlisted model shows as unpriced rather than guessed. On a
 * subscription this is a measure of size, not an invoice.
 */
const RATES = {
  // in, out, cache read, cache write for 5 minutes, cache write for an hour
  'claude-opus-5-5': [4, 20, 0.2, 5, 8],
  'claude-sonnet-5': [2, 10, 0.2, 2.5, 4],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5, 4],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25, 2],
};
/** claude-haiku-4-5-20251001 → claude-haiku-4-5; claude-opus-5-5[1m] → claude-opus-5-5 */
function rateOf(model) {
  const m = String(model || '').replace(/\[[^\]]*\]$/, '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  return RATES[m] || null;
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
module.exports = { RATES, rateOf, cost };
