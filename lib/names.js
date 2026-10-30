'use strict';
/**
 * names.js — the product's name, current first, then every earlier one.
 * ~/.<name>, the <NAME>_ env prefix, the command, the launchd label and the
 * [<name>] message line derive from it; readers of old data walk the whole
 * list. scripts/rename.py renames and keeps the old name (the tagged line).
 */
const NAMES = [
  'rally', // rename:keep
  'hotaru',
  'ika',
  'genba',
  'agentkanban',
];
/** What the UI calls it. */
const DISPLAY = 'Rally';

/** A line an earlier version put in front of a message it sent, as [<name>], under any of the names. */
const LINE_RE = new RegExp('^\\[(?:' + NAMES.join('|') + ')\\]', 'i');

module.exports = { LINE_RE, NAMES, NAME: NAMES[0], LEGACY_NAMES: NAMES.slice(1), DISPLAY };
