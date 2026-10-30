/**
 * worker.js — `rally worker`, the long-lived process the app asks for state and history (bin/rally.js cmdWorker).
 * Run: node test/worker.js   Exit 0: passed. Its own process and scratch home, so nothing of yours is read or written.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(path.join(home, '.claude', 'projects', '-p'), { recursive: true });
const sess = '11111111-2222-4333-8444-555555555555';
const now = Date.now();
const jl = path.join(home, '.claude', 'projects', '-p', sess + '.jsonl');
const line = (t, o) => JSON.stringify({ timestamp: new Date(t).toISOString(), cwd: '/p', entrypoint: 'cli', ...o });
fs.writeFileSync(jl, [line(now - 5000, { type: 'user', message: { role: 'user', content: 'こんにちは' } }), line(now - 4000, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'はい' }] } })].join('\n') + '\n');

const env = { ...process.env, HOME: home, RALLY_HOME: path.join(tmp, 'rh'), RALLY_NO_ENRICH: '1', RALLY_SCAN_CACHE: path.join(tmp, 'scan.json'), RALLY_QUEUE: path.join(tmp, 'q.json') };
let bad = 0;
const ok = (n, c) => { console.log(c ? '  ✓' : '  ✗', n); if (!c) bad++; };

const p = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'rally.js'), 'worker'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '';
const waiters = new Map();
p.stdout.setEncoding('utf8');
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    const m = /^(\d+) (-?\d+) ([\s\S]*)$/.exec(l);
    if (m && waiters.has(+m[1])) { waiters.get(+m[1])({ code: +m[2], out: m[3] }); waiters.delete(+m[1]); }
  }
});
let id = 0;
const ask = (argv, ms = 20000) => new Promise((resolve) => {
  const n = ++id;
  const t = setTimeout(() => { waiters.delete(n); resolve(null); }, ms);
  waiters.set(n, (r) => { clearTimeout(t); resolve(r); });
  p.stdin.write(JSON.stringify({ id: n, argv }) + '\n');
});
const exited = new Promise((resolve) => p.on('exit', (c) => resolve(c)));

(async () => {
  try {
    const dirArgs = ['--dir', 'claude=' + path.join(home, '.claude', 'projects'), '--agent', 'claude', '--hours', '1'];
    let r = await ask(['state', ...dirArgs]);
    let st = null; try { st = JSON.parse(r.out); } catch (e) { /* checked below */ }
    ok('★ worker: state comes back as one line of JSON with the session on it', r && r.code === 0 && st && Array.isArray(st.cards) && st.cards.some((c) => c.id === sess));
    const r2 = await ask(['state', ...dirArgs]);
    ok('worker: the second state is the same answer (from memory)', r2 && r2.code === 0 && r2.out.length === r.out.length);
    r = await ask(['history', '--as', 'claude', '--session', sess, '--hours', '1', '--dir', 'claude=' + path.join(home, '.claude', 'projects')]);
    let h = null; try { h = JSON.parse(r.out); } catch (e) { /* checked below */ }
    ok('★ worker: history of a session comes back too', r && r.code === 0 && h && Array.isArray(h.turns) && h.turns.some((t) => t.text === 'こんにちは'));
    fs.appendFileSync(jl, line(now - 1000, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '続きです' }] } }) + '\n');
    await new Promise((res) => setTimeout(res, 600));
    r = await ask(['history', '--as', 'claude', '--session', sess, '--hours', '1', '--dir', 'claude=' + path.join(home, '.claude', 'projects')]);
    try { h = JSON.parse(r.out); } catch (e) { h = null; }
    ok('★ worker: a line written while it runs is in the next history', h && h.turns.some((t) => t.text === '続きです'));
    r = await ask(['queue', '--cancel']);
    ok('worker: only state and history are taken (anything else is refused, not run)', r && r.code === 2 && /not a worker command/.test(r.out));
    r = await ask(['history', '--as', 'claude', '--session', 'nope', '--hours', '1']);
    ok('worker: a failing command answers with its exit code and goes on', r && typeof r.code === 'number');
    r = await ask(['state', ...dirArgs]);
    ok('worker: still answering after a failure', r && r.code === 0);
    p.stdin.end();
    const code = await Promise.race([exited, new Promise((res) => setTimeout(() => res('timeout'), 8000))]);
    ok('★ worker: closing its input ends it cleanly, with its cache written to disk', code === 0 && fs.existsSync(env.RALLY_SCAN_CACHE));
  } catch (e) { ok('worker — ' + (e && e.stack || e), false); }
  try { p.kill('SIGKILL'); } catch (e) { /* gone */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `${bad} failed` : 'worker: all passed');
  process.exit(bad ? 1 : 0);
})();
