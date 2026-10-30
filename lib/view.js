'use strict';
const { t: tr } = require('./i18n.js');
/**
 * view.js — one file for the board's viewer: its text (or image data) and its
 * git diff. Read-only, and only regular, non-secret files under home, up to a
 * size cap: the path comes from a transcript, which is not an allowlist.
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

module.exports = { read, allowed, SECRET };
