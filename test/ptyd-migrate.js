/**
 * ptyd-migrate.js — the real rally-ptyd, in a scratch HOME, while ~/.agentkanban is moved to ~/.rally
 * under it (lib/paths.js migrate). What must hold: the terminal it keeps goes on running, and its socket
 * is reached by the new path and by the old one (through the link), and the host does not take the
 * move for "the socket is gone" (its 5 s check stats the path it was started with).
 *
 * Run: node test/ptyd-migrate.js [path to rally-ptyd]. Exit 0: passed, or no built host to try (says so);
 * exit 1: failed. Never touches the real ~/.agentkanban: HOME is a directory made here.
 */
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const candidates = [process.argv[2], path.join(root, 'app', 'dist', 'Rally.app', 'Contents', 'MacOS', 'rally-ptyd')].filter(Boolean);
const bin = candidates.find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch (e) { return false; } });
if (!bin) { console.log('  - ptyd-migrate: no built rally-ptyd (cd app && ./build.sh) — skipped'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one connection: send lines, collect the events it gets
function dial(sock) {
  return new Promise((resolve, reject) => {
    const c = net.connect(sock);
    const ev = []; let buf = '';
    c.on('data', (b) => { buf += b; let i; while ((i = buf.indexOf('\n')) >= 0) { try { ev.push(JSON.parse(buf.slice(0, i))); } catch (e) { /* not ours */ } buf = buf.slice(i + 1); } });
    c.on('error', reject);
    c.on('connect', () => resolve({ send: (m) => c.write(JSON.stringify(m) + '\n'), ev, end: () => c.destroy() }));
  });
}
async function until(f, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await sleep(25); } return null; }
async function hello(sock) {
  const c = await dial(sock); c.send({ op: 'hello', v: 1 });
  const h = await until(() => c.ev.find((e) => e.ev === 'hello'));
  return { c, h };
}

(async () => {
  const H = fs.mkdtempSync('/tmp/gk-'); // short: a socket path is limited to 104 bytes
  const oldSock = path.join(H, '.agentkanban', 'pty.sock'), newSock = path.join(H, '.rally', 'pty.sock');
  fs.mkdirSync(path.join(H, '.agentkanban'), { mode: 0o700 });
  const host = cp.spawn(bin, [oldSock], { env: { PATH: '/usr/bin:/bin', HOME: H }, stdio: 'ignore', detached: true });
  host.unref();
  let bad = 0;
  const ok = (n, c) => { console.log(c ? '  ✓' : '  ✗', n); if (!c) bad++; };
  try {
    await until(() => fs.existsSync(oldSock));
    let { c, h } = await hello(oldSock);
    ok('ptyd-migrate: the host answers on ~/.agentkanban/pty.sock', !!h && h.pid === host.pid);
    c.send({ op: 'open', id: 't1', argv: ['/bin/cat'], cwd: H, env: { PATH: '/usr/bin:/bin' }, cols: 80, rows: 24, meta: '' });
    const opened = await until(() => c.ev.find((e) => e.ev === 'opened'));
    ok('ptyd-migrate: a terminal (cat) runs in it', !!opened);
    c.end();

    const r = cp.execFileSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(path.join(root, 'lib', 'paths.js'))}).migrate())`], { env: { HOME: H, PATH: process.env.PATH }, encoding: 'utf8' });
    ok('★ ptyd-migrate: ~/.agentkanban is moved to ~/.rally under the running host (' + r + ')', r === 'migrated' && fs.lstatSync(path.join(H, '.agentkanban')).isSymbolicLink() && fs.existsSync(newSock));

    const n1 = await hello(newSock);
    ok('★ ptyd-migrate: the same host answers on the new path, and still lists the terminal', !!n1.h && n1.h.pid === host.pid && (n1.h.tabs || []).some((t) => t.id === 't1'));
    n1.c.send({ op: 'in', id: 't1', b64: Buffer.from('through-the-move\n').toString('base64') });
    const echoed = await until(() => n1.c.ev.some((e) => e.ev === 'data' && e.id === 't1' && Buffer.from(e.b64 || '', 'base64').toString().includes('through-the-move')));
    ok('★ ptyd-migrate: the terminal started before the move takes input and answers after it', !!echoed);
    n1.c.end();

    const o2 = await hello(oldSock);
    ok('★ ptyd-migrate: the old path still reaches the same host (through the link)', !!o2.h && o2.h.pid === host.pid);
    o2.c.end();

    await sleep(6500); // past the host's 5 s check of its socket path
    const n3 = await hello(newSock);
    ok('★ ptyd-migrate: 6 s later the host is still there (the move was not "the socket is gone")', !!n3.h && n3.h.pid === host.pid && (n3.h.tabs || []).some((t) => t.id === 't1'));
    n3.c.send({ op: 'closeall' });
    n3.c.end();
  } catch (e) {
    ok('ptyd-migrate: ' + (e && e.message), false);
  } finally {
    // the host ends itself: no terminal and no client for its socket → gone within its 5 s check once the socket is
    try { fs.unlinkSync(newSock); } catch (e) { /* already gone */ }
    const gone = await until(() => { try { process.kill(host.pid, 0); return false; } catch (e) { return true; } }, 9000);
    ok('ptyd-migrate: the host ends itself when its socket is removed', !!gone);
    if (gone) fs.rmSync(H, { recursive: true, force: true });
    else console.log('  (host still running, scratch kept at ' + H + ')');
  }
  console.log(bad ? `${bad} failed` : 'ptyd-migrate: all passed');
  process.exit(bad ? 1 : 0);
})();
