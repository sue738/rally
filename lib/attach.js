'use strict';
/**
 * attach.js — files you hand to a session. Pasted/dropped bytes are written to
 * ~/.rally/attachments/ and the message carries the paths (dispatch adds the
 * directory with --add-dir). Names are rebuilt, never trusted: the page can
 * say anything, and this writes under the user's home.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const Paths = require('./paths.js');
const Fsx = require('./fsx.js');

const NAME = 'rally';
const MAX_BYTES = 20 * 1024 * 1024;
const KEEP_DAYS = 30;

function dir() {
  return Env.get('ATTACHMENTS') || Paths.akDir('attachments');
}

/** A name that cannot escape the directory or surprise a shell. */
function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(-60);
  return base || 'file';
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Write one attachment. `data` is a Buffer (or base64 string).
 * @returns {{path, name, bytes}}
 */
function save({ name, data }) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw new Error('空のファイルです');
  if (buf.length > MAX_BYTES) throw new Error(`大きすぎます(${Math.round(buf.length / 1048576)}MB · 上限${MAX_BYTES / 1048576}MB)`);
  const d = dir();
  fs.mkdirSync(d, { recursive: true });
  // the stamp is per second: wx keeps a second same-named paste from overwriting the first
  let file = path.join(d, `${stamp()}-${safeName(name)}`);
  for (let i = 2; ; i++) {
    try { fs.writeFileSync(file, buf, { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST' || i > 50) throw e;
      const ext = path.extname(safeName(name));
      file = path.join(d, `${stamp()}-${path.basename(safeName(name), ext)}-${i}${ext}`);
    }
  }
  return { path: file, name: path.basename(file), bytes: buf.length };
}

/** Drop what nobody is going to open again. Best effort, never throws. */
function sweep(days = KEEP_DAYS) {
  const d = dir();
  let removed = 0;
  try {
    const cutoff = Date.now() - days * 86400000;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); removed++; } } catch (e) { /* next */ }
    }
  } catch (e) { /* no directory yet */ }
  return removed;
}

/**
 * `f` if it is a file inside the attachment directory, else null. Realpath on both sides
 * and a trailing separator: a bare prefix test would pass `<dir>/../x` and `<dir>-evil/x`.
 */
function inside(f) {
  if (typeof f !== 'string' || !f) return null;
  try {
    const root = fs.realpathSync(dir());
    const real = fs.realpathSync(path.resolve(f));
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) return null;
    return path.resolve(f);
  } catch (e) { return null; }
}

function indexPath() { return path.join(dir(), 'index.json'); }

function readIndex() {
  try { const j = JSON.parse(fs.readFileSync(indexPath(), 'utf8')); return j && j.byId ? j : { byId: {} }; }
  catch (e) { return { byId: {} }; }
}

/** Remember which session a file was handed to, so it can be found again. */
function record({ agent, id, files }) {
  const list = (files || []).map(inside).filter(Boolean);
  if (!agent || !id || !list.length) return null;
  const store = readIndex();
  const k = `${agent}:${id}`;
  const prev = store.byId[k] || [];
  const now = Date.now();
  store.byId[k] = [...prev, ...list.map((f) => ({ f, at: now }))].slice(-40);
  try {
    Fsx.writeJSONAtomic(indexPath(), store, undefined, 0);
  } catch (e) { /* the message still went */ }
  return store.byId[k].length;
}

/** What was handed to this session, newest last, only what still exists. */
function forSession(agent, id) {
  const store = readIndex();
  return (store.byId[`${agent}:${id}`] || [])
    .filter((e) => { try { return fs.statSync(e.f).isFile(); } catch (x) { return false; } })
    .map((e) => ({ path: e.f, name: path.basename(e.f), at: e.at,
      image: /\.(png|jpe?g|gif|webp|heic)$/i.test(e.f) }));
}

/**
 * Copy the files into <project>/.rally/ so a resumed session can read them:
 * a resume cannot carry --add-dir (any flag forks a copy).
 */
function stageIn(projectDir, files) {
  const list = (files || []).filter(Boolean);
  if (!projectDir || !list.length) return list;
  const dest = path.join(projectDir, Paths.DIRNAME);
  try { fs.mkdirSync(dest, { recursive: true }); } catch (e) { return list; }
  return list.map((f) => {
    try {
      const to = path.join(dest, path.basename(f));
      if (!fs.existsSync(to)) fs.copyFileSync(f, to);
      return to;
    } catch (e) { return f; }
  });
}

/** The lines appended to a message so the session knows what it was given. */
function lines(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return '';
  return `\n\n添付ファイル(このパスを読んでください):\n${list.map((p) => `- ${p}`).join('\n')}`;
}

module.exports = { MAX_BYTES, dir, inside, safeName, save, sweep, lines, record, forSession, indexPath, stageIn };
