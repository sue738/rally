'use strict';
/**
 * bgcmd.js — start a command now, collect its output later, from synchronous
 * code (the board's refresh), so independent waits overlap. A small sh wrapper
 * writes the output, then the exit status; the status file marks completion.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** Start argv; returns a handle, or null when it could not be started. */
function begin(argv) {
  if (!argv || !argv.length) return null;
  const base = path.join(os.tmpdir(), `rally-bg-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    // "$@" after the two paths: nothing in argv is ever read by the shell as code
    const child = spawn('/bin/sh', ['-c', 'o="$0"; d="$1"; shift 1; "$@" > "$o.out" 2>/dev/null; echo $? > "$d.tmp"; mv "$d.tmp" "$d.done"', base, base, ...argv],
      { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return { base, pid: child.pid, at: Date.now() };
  } catch (e) { return null; }
}

/** Wait up to timeoutMs from its start: {status, stdout}, or null (too slow: killed). Files are removed either way. */
function collect(h, timeoutMs) {
  if (!h) return null;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let got = null;
  while (Date.now() - h.at < timeoutMs) {
    try { const st = fs.readFileSync(h.base + '.done', 'utf8'); got = { status: +st.trim(), stdout: fs.readFileSync(h.base + '.out', 'utf8') }; break; }
    catch (e) { Atomics.wait(nap, 0, 0, 5); }
  }
  if (!got) { try { process.kill(-h.pid, 'SIGTERM'); } catch (e) { /* gone */ } }
  for (const ext of ['.out', '.done', '.tmp']) { try { fs.unlinkSync(h.base + ext); } catch (e) { /* not there */ } }
  return got;
}

module.exports = { begin, collect };
