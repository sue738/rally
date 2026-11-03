'use strict';
const { t: tr } = require('./i18n.js');
/**
 * view.js — one file for the board's viewer: its text (or image data) and its
 * git diff, and saving an edit of it. Only regular, non-secret files under home,
 * up to a size cap: the path comes from a transcript, which is not an allowlist.
 */
const Env = require('./env.js');
const { NAMES } = require('./names.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Paths = require('./paths.js');

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function home() { return fs.realpathSync(Env.get('FILES_ROOT') || Paths.home()); }

// Keys and credentials are never served, including the remote-access token older
// versions kept (under any past name).
const SECRET = new RegExp(/(^|\/)(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.config\/gcloud|\.config\/gh|\.password-store|Library\/Keychains)(\/|$)|(^|\/)(\.claude\/\.credentials\.json|\.codex\/auth\.json|\.(OWNDIRS)\/token|\.pulumi\/credentials\.json)$|(^|\/)(\.env(\..*)?|\.netrc|\.npmrc|\.pypirc|credentials(\.json)?|id_[a-z0-9]+|[^/]*\.(pem|key|p12|pfx|keychain))$/i.source.replace('OWNDIRS', NAMES.join('|')), 'i');

/** The real path if it is a regular file under home and not a secret, else null. */
function allowed(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return null;
  try {
    const real = fs.realpathSync(p), h = home();
    if (!real.startsWith(h + path.sep)) return null;
    if (SECRET.test(real.slice(h.length)) || SECRET.test(p)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch (e) { return null; }
}

function gitDiff(file) {
  const dir = path.dirname(file);
  const run = (args) => execFileSync('git', [...require('./git.js').SAFE_GIT, ...args], { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    run(['rev-parse', '--is-inside-work-tree']);
  } catch (e) { return { git: false }; }
  try {
    const tracked = (() => { try { run(['ls-files', '--error-unmatch', '--', file]); return true; } catch (e) { return false; } })();
    if (!tracked) return { git: true, untracked: true, diff: '' };
    return { git: true, diff: run(['diff', 'HEAD', '--no-color', '--no-ext-diff', '--', file]) };
  } catch (e) { return { git: true, diff: '', error: tr('git diff が読めませんでした') }; }
}

/** {path, name, kind: md|text|image|binary, text?, data?, size, mtime, diff?} or {path, error}. */
function read(p) {
  const f = allowed(p);
  if (!f) return { path: p, error: tr('このファイルは開けません') };
  const st = fs.statSync(f);
  const ext = path.extname(f).toLowerCase();
  const base = { path: p, name: path.basename(f), size: st.size, mtime: st.mtimeMs };
  if (IMAGE[ext] && ext !== '.svg') {
    if (st.size > MAX_IMAGE) return { ...base, kind: 'image', error: tr('大きすぎます') };
    return { ...base, kind: 'image', data: `data:${IMAGE[ext]};base64,${fs.readFileSync(f).toString('base64')}` };
  }
  const fd = fs.openSync(f, 'r');
  let buf;
  try { const n = Math.min(st.size, MAX_TEXT); buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, 0); } finally { fs.closeSync(fd); }
  if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: 'binary' };
  return {
    ...base,
    kind: /\.(md|markdown|mdx)$/i.test(f) ? 'md' : 'text',
    text: buf.toString('utf8'),
    truncated: st.size > MAX_TEXT,
    ...gitDiff(f),
  };
}

/** Line and column of a character offset, both from 1. */
function lineCol(text, pos) {
  const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
  const nl = before.lastIndexOf('\n');
  return { line: (before.match(/\n/g) || []).length + 1, col: before.length - nl };
}

/** Why the text is not JSON (with its line and column), or '' if it is. */
function jsonError(text) {
  try { JSON.parse(text); return ''; } catch (e) {
    const m = /position (\d+)/.exec(String(e.message));
    const at = m ? lineCol(text, +m[1]) : /end of JSON|Unexpected end/i.test(String(e.message)) ? lineCol(text, text.length) : null;
    return at ? tr('JSON として読めないので保存しません({line} 行 {col} 文字目)', { line: at.line, col: at.col })
      : tr('JSON として読めないので保存しません');
  }
}

/**
 * Save an edit made in the viewer: only a file read() shows as whole text, and only if it is still the
 * version that was read (baseMtime), so another writer's change is never overwritten. A JSON file that
 * parsed before must still parse. Written to a file beside it, then renamed over it: a crash leaves the
 * old file or the new one, never half of one; the mode is kept. Returns the fresh read(), or {path, error}.
 */
function write(p, text, baseMtime) {
  const no = (why) => ({ path: p, error: why });
  const f = allowed(p);
  if (!f) return no(tr('このファイルは開けません'));
  if (typeof text !== 'string') return no(tr('保存する中身がありません'));
  const st = fs.statSync(f);
  const ext = path.extname(f).toLowerCase();
  if (IMAGE[ext] && ext !== '.svg') return no(tr('テキストのファイルだけ保存できます'));
  if (st.size > MAX_TEXT || Buffer.byteLength(text) > MAX_TEXT) return no(tr('大きすぎます'));
  const old = fs.readFileSync(f);
  if (old.subarray(0, 8000).includes(0) || text.includes('\0')) return no(tr('テキストのファイルだけ保存できます'));
  if (!(Number(baseMtime) === st.mtimeMs)) return no(tr('開いた後にこのファイルが変わっています。開き直してから直してください'));
  // settings.json and the like: never written broken (a file that was not JSON to begin with, e.g. with comments, is let be)
  if (/\.json$/i.test(f) && !jsonError(old.toString('utf8'))) { const bad = jsonError(text); if (bad) return no(bad); }
  const tmp = path.join(path.dirname(f), `.${path.basename(f)}.rally-${process.pid}-${Date.now().toString(36)}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeSync(fd, text);
    fs.fchmodSync(fd, st.mode & 0o7777);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, f);
  } catch (e) {
    if (fd != null) try { fs.closeSync(fd); } catch (x) { /* already closed */ }
    try { fs.unlinkSync(tmp); } catch (x) { /* not made */ }
    return no(tr('保存できませんでした: {e}', { e: String(e && e.code || e && e.message || e) }));
  }
  return read(p);
}

module.exports = { read, write, allowed, SECRET };
