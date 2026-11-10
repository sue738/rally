'use strict';
/**
 * aliases.js — which model each claude alias (opus / sonnet / haiku / fable) names today,
 * asked of the CLI itself, so the board's menus say "fable 5.2" the day the CLI starts
 * handing out 5.2, not after a 5.2 session happens to appear in the history.
 *
 * `claude -p --output-format stream-json --verbose` prints a system/init line carrying the
 * resolved model before it calls the API. The probe points the API base URLs at a closed
 * local port, so no request leaves the machine and nothing is billed, reads lines until
 * init, and kills the child. Measured (CLI 2.1.322): init in ~0.2s; fable → claude-fable-5-2,
 * the same model a real call's modelUsage reported.
 *
 * Kept in ~/.rally/model-aliases.json with the CLI binary it came from. Asked again when
 * the binary changes (an update) or after STALE_MS (a launch can be switched on without
 * one). state() only reads the file; the asking runs in a detached `rally model-aliases`.
 */
const Env = require('./env.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Fsx = require('./fsx.js');
const Paths = require('./paths.js');
const Dispatch = require('./dispatch.js');

const ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];
const ID = /^claude-[a-z0-9][a-z0-9.-]{0,60}$/;
const STALE_MS = 6 * 3600000;
const CHECK_MS = 5 * 60000;          // how often a refresh looks at the binary at all
const PENDING_MS = 2 * 60000;        // a killed child stops blocking the next try after this
const FAIL_RETRY_MS = 30 * 60000;
const PROBE_TIMEOUT_MS = 15000;
const CLOSED = 'http://127.0.0.1:9';

function cachePath() { return Env.get('MODEL_ALIASES') || Paths.akDir('model-aliases.json'); }
function read() { try { const j = JSON.parse(fs.readFileSync(cachePath(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function write(c) { try { Fsx.writeJSONAtomic(cachePath(), c); } catch (e) { /* the next refresh tries again */ } }

/** {opus:'claude-opus-5-5', …}: only the aliases the CLI answered, as model ids. */
function current() {
  const a = read().aliases || {}, out = {};
  for (const k of ALIASES) if (typeof a[k] === 'string' && ID.test(a[k])) out[k] = a[k];
  return out;
}

/** The binary as it is now: a CLI update repoints the symlink or rewrites the file. */
function binKey(bin) {
  if (!bin) return '';
  try { const r = fs.realpathSync(bin); return r + '@' + Math.round(fs.statSync(r).mtimeMs); } catch (e) { return ''; }
}

/** Whether the cache should be asked again, and with which binary. Pure, for the tests. */
function due(c, key, now) {
  if (c.pending && now - c.pending < PENDING_MS) return false;
  if (!key) return false;
  if (c.fail && c.bin === key && now - c.fail < FAIL_RETRY_MS) return false;
  return c.bin !== key || !(now - (c.at || 0) < STALE_MS);
}

/**
 * Called on a board refresh that may start background claude processes (opts.enrich):
 * starts one detached `rally model-aliases` when the cache is stale. Cheap otherwise.
 */
function maybeRefresh(now = Date.now(), spawnFn = spawnProber) {
  const c = read();
  if (c.pending && now - c.pending < PENDING_MS) return false;
  if (c.checked && now - c.checked < CHECK_MS) return false;
  const bin = Dispatch.binaryFor('claude');
  const key = binKey(bin);
  if (!due(c, key, now)) { write({ ...c, checked: now }); return false; }
  write({ ...c, checked: now, pending: now });
  spawnFn();
  return true;
}

function spawnProber() {
  try {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'rally.js'), 'model-aliases'], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) { /* no node at this path: the pending mark runs out and the next refresh tries again */ }
}

/** The model the CLI resolves one alias to, from its init line; '' when there is none in time. */
function probe(bin, alias, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child, buf = '', done = false, timer = null;
    const finish = (v) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
      // a grandchild still holding the pipe must not keep this process alive
      try { child.stdout.destroy(); } catch (e) { /* gone */ }
      resolve(v);
    };
    // --setting-sources project + cwd tmpdir: none of your hooks or CLAUDE.md, as in enrich.js
    const args = ['-p', '--model', alias, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'project', '--tools', '', '--', 'x'];
    const env = { ...process.env, ANTHROPIC_BASE_URL: CLOSED, ANTHROPIC_BEDROCK_BASE_URL: CLOSED, ANTHROPIC_VERTEX_BASE_URL: CLOSED };
    try { child = spawn(bin, args, { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'ignore'], env }); } catch (e) { resolve(''); return; }
    timer = setTimeout(() => finish(''), timeoutMs);
    child.on('error', () => finish(''));
    child.on('close', () => finish(''));
    child.stdout.on('data', (b) => {
      buf += b;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let j = null; try { j = JSON.parse(line); } catch (e) { continue; }
        if (j && j.type === 'system' && j.subtype === 'init') {
          const m = String(j.model || '').replace(/\[[^\]]*\]$/, '');
          return finish(ID.test(m) ? m : '');
        }
      }
      if (buf.length > 65536) finish('');
    });
  });
}

/** Runs in the detached child: asks the CLI for every alias and writes what it answered. */
async function run(now = Date.now()) {
  const bin = Dispatch.binaryFor('claude');
  const key = binKey(bin);
  const prev = read();
  const got = {};
  if (bin) for (const a of ALIASES) { const m = await probe(bin, a); if (m) got[a] = m; }
  // an answer for some aliases keeps the last known ones for the rest
  const c = Object.keys(got).length
    ? { at: now, bin: key, checked: now, aliases: { ...(prev.aliases || {}), ...got } }
    : { ...prev, bin: key, checked: now, fail: now, pending: undefined };
  write(c);
  return c;
}

module.exports = { ALIASES, STALE_MS, CHECK_MS, PENDING_MS, FAIL_RETRY_MS, cachePath, current, binKey, due, maybeRefresh, probe, run };
