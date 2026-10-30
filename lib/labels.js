'use strict';
/**
 * labels.js — the colour and optional title you give a session, keyed by agent + id
 * in ~/.rally/labels.json. A typed title replaces the generated one (enrich.js).
 * Nothing here is written to the agents.
 */
const Env = require('./env.js');
const fs = require('fs');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');
const Dispatch = require('./dispatch.js');

const NAME = 'rally';
const MAX_LABEL = 80;
// A fixed palette: a free-form colour from the page would be network input drawn into CSS.
const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'grey'];

function labelsPath() {
  return Env.get('LABELS') || Paths.akDir('labels.json');
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(labelsPath(), 'utf8'));
    return j && typeof j === 'object' && j.byId ? j : { byId: {} };
  } catch (e) { return { byId: {} }; }
}

function write(store) {
  Fsx.writeJSONAtomic(labelsPath(), store);
}

function key(agent, id) { return `${agent}:${id}`; }

/** Set (or clear) one session's label and colour. Returns what was stored. */
function set({ agent, id, label, color, auto }) {
  if (!agent || !id) throw new Error('agent and session are required');
  Dispatch.recordId(agent, id);
  const store = read();
  const k = key(agent, id);
  const text = String(label == null ? (store.byId[k] || {}).label || '' : label).slice(0, MAX_LABEL).trim();
  const col = COLORS.includes(color) ? color : ((store.byId[k] || {}).color || '');
  if (!text && !col) delete store.byId[k];
  // auto: the board's stand-in (a new session's first words), not a name you gave it
  else store.byId[k] = { label: text, color: col, at: Date.now(), ...(auto ? { auto: true } : {}) };
  write(store);
  return store.byId[k] || { label: '', color: '' };
}

/** Attach stored labels to cards; a typed title replaces the generated one. */
function apply(cards, store) {
  const s = store || read();
  for (const c of cards) {
    const v = s.byId[key(c.agent, c.id)];
    if (!v) continue;
    if (v.color) c.color = v.color;
    // A label the board wrote itself (marked auto, or older ones equal to the first message)
    // is a stand-in: Claude's own name for the session wins once it has one.
    if (v.label) {
      const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
      const first = c.last && c.last.first;
      const auto = v.auto || (first && norm(first).startsWith(norm(v.label)));
      if (auto && (c.titleFrom === 'claude' || c.titleFrom === 'rename')) continue;
      c.title = v.label; c.titleMine = !auto;
    }
  }
  return s;
}

module.exports = { COLORS, labelsPath, read, write, set, apply };
