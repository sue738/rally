'use strict';
/**
 * statusline.js — Claude Code's statusLine command, for the header's allowance.
 *
 * Claude Code hands a statusline its rate limits on stdin (rate_limits.five_hour /
 * seven_day: used_percentage, resets_at in seconds). This keeps them in
 * <home>/limits.json for lib/limits.js, then prints a line: the output of the command
 * given as arguments (an existing statusline, fed the same stdin), else a short one of
 * its own. settings.json names the shim <home>/bin/statusline, which the app rewrites
 * at launch like the permission hook's.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Paths = require('./paths.js');

function file() { return Paths.akHome('limits.json'); }

/** Keep rate_limits from one statusline input; false when it carries none. */
function keep(input, now = Date.now()) {
  const rl = input && input.rate_limits;
  if (!rl || !(rl.five_hour || rl.seven_day)) return false;
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify({ ...rl, cached_at: Math.floor(now / 1000) }), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
  return true;
}

/** The line printed when no other statusline is wrapped. */
function ownLine(input) {
  const m = (input && input.model && (input.model.display_name || input.model.id)) || '';
  const rl = (input && input.rate_limits) || {};
  const pct = (w) => (w && typeof w.used_percentage === 'number' ? Math.round(w.used_percentage) + '%' : null);
  return [m, pct(rl.five_hour) && '5h ' + pct(rl.five_hour), pct(rl.seven_day) && '週 ' + pct(rl.seven_day)].filter(Boolean).join(' · ');
}

function main(argv) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* no stdin */ }
  let input = null;
  try { input = JSON.parse(raw); } catch (e) { /* not JSON */ }
  try { keep(input); } catch (e) { /* the line still prints */ }
  if (argv.length) {
    const r = spawnSync('/bin/sh', ['-c', argv.join(' ')], { input: raw, encoding: 'utf8', timeout: 10000 });
    process.stdout.write(r.stdout || '');
    process.exitCode = r.status || 0;
    return;
  }
  process.stdout.write(ownLine(input) + '\n');
}

function shimPath() { return Paths.akHome('bin', 'statusline'); }
function shimText(node, js) {
  const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
  return '#!/bin/sh\n'
    + '# Rally\'s statusLine command (lib/statusline.js), rewritten by the app at launch.\n'
    + `NODE=${q(node)}\nJS=${q(js)}\n`
    + 'if [ -x "$NODE" ] && [ -f "$JS" ]; then exec "$NODE" "$JS" "$@"; fi\n'
    + '# the app is gone: still run the wrapped statusline\n'
    + '[ $# -gt 0 ] && exec /bin/sh -c "$*"\n';
}
/** Write the shim for this node and this statusline.js. Returns {path, changed}. */
function installShim(node = process.execPath, js = __filename) {
  const f = shimPath(), text = shimText(node, js);
  let cur = null;
  try { cur = fs.readFileSync(f, 'utf8'); } catch (e) { /* none yet */ }
  if (cur === text) return { path: f, changed: false };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', text, { mode: 0o755 });
  fs.chmodSync(f + '.tmp', 0o755);
  fs.renameSync(f + '.tmp', f);
  return { path: f, changed: true };
}

function current() {
  const Env = require('./env.js');
  const f = Env.get('CLAUDE_SETTINGS') || Paths.home('.claude', 'settings.json');
  try { return String((JSON.parse(fs.readFileSync(f, 'utf8')).statusLine || {}).command || ''); } catch (e) { return ''; }
}
/** Does settings.json's statusLine run Rally's shim. */
function installed() { return /\.[\w-]+\/bin\/statusline\b/.test(current()); }
/** The statusLine command to set: the shim, wrapping the one there now. null once it is set. */
function suggest() {
  if (installed()) return null;
  const now = current().trim();
  return shimPath().replace(Paths.home(), '~') + (now ? ' ' + now : '');
}

module.exports = { file, keep, ownLine, main, shimPath, shimText, installShim, installed, suggest };

if (require.main === module) main(process.argv.slice(2));
