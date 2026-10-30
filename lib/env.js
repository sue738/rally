'use strict';
/**
 * env.js — the board's environment variables: <NAME>_<VAR> under the current
 * name, falling back to each earlier name (lib/names.js), so setups written for
 * an old name keep working. Every read goes through get().
 */
const { NAMES } = require('./names.js');

const PREFIXES = NAMES.map((n) => n.toUpperCase() + '_');

/** The value of the variable under the newest name that sets it, else undefined. */
function get(name) {
  for (const p of PREFIXES) {
    const v = process.env[p + name];
    if (v !== undefined) return v;
  }
  return undefined;
}

module.exports = { get };
