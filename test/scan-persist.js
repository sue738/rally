/**
 * scan-persist.js — lib/scan.js in persistent mode (the worker, the server): the file list is kept by file-system events and
 * the cache lives in memory. Run: node test/scan-persist.js   Exit 0: passed. Its own process, since events need a running loop.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-persist-'));
process.env.RALLY_SCAN_CACHE = path.join(tmp, 'cache.json');
const Scan = require('../lib/scan.js');
const dir = path.join(tmp, 'claude');
let bad = 0;
const ok = (n, c) => { console.log(c ? '  ✓' : '  ✗', n); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (t, o) => JSON.stringify({ timestamp: new Date(t).toISOString(), cwd: '/p', entrypoint: 'cli', ...o });
const user = (t, text) => line(t, { type: 'user', message: { role: 'user', content: text } });
const write = (name, lines) => { const f = path.join(dir, '-p', name + '.jsonl'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lines.join('\n') + '\n'); return f; };
const scan = () => Scan.sessions({ dirs: { claude: dir }, only: ['claude'], sinceMs: Date.now() - 3600e3 });
const count = (r) => r.found.reduce((n, f) => n + f.sessions.length, 0);

(async () => {
  try {
    const t0 = Date.now() - 60000;
    const a = write('aaaaaaaa-0000-0000-0000-000000000000', [user(t0, 'go')]);
    Scan.persist(true);
    let r = scan();
    ok('persistent: the first scan finds the file', count(r) === 1 && r.stats.parsed === 1);
    r = scan();
    ok('★ persistent: the second scan parses nothing and reads it from memory', count(r) === 1 && r.stats.parsed === 0 && r.stats.cached === 1);
    write('bbbbbbbb-0000-0000-0000-000000000000', [user(t0 + 1000, 'go too')]);
    await sleep(500);
    r = scan();
    ok('★ persistent: a file made while it runs is found by the event (no walk of the tree)', count(r) === 2 && r.stats.parsed === 1 && r.stats.cached === 1);
    fs.appendFileSync(a, user(t0 + 2000, 'more') + '\n');
    await sleep(500);
    r = scan();
    const sa = r.found[0].sessions.find((s) => s.id.startsWith('aaaaaaaa'));
    ok('★ persistent: a file that grew is read again, and only that one', count(r) === 2 && r.stats.parsed === 1 && sa && sa.events.filter((e) => e.kind === 'user').length === 2);
    fs.unlinkSync(path.join(dir, '-p', 'bbbbbbbb-0000-0000-0000-000000000000.jsonl'));
    await sleep(500);
    r = scan();
    ok('★ persistent: a file that is gone is gone', count(r) === 1);
    ok('persistent: nothing is written to disk on every scan (only now and then)', !fs.existsSync(process.env.RALLY_SCAN_CACHE));
    Scan.persist(false);
    let disk = null; try { disk = JSON.parse(fs.readFileSync(process.env.RALLY_SCAN_CACHE, 'utf8')); } catch (e) { /* checked below */ }
    ok('persistent: leaving it flushes the cache to disk for a cold start', disk && disk.version === Scan.VERSION && Object.keys(disk.files).length >= 1);
    r = scan();
    ok('one-shot again: the same answer from the file', count(r) === 1 && r.stats.cached === 1 && r.stats.parsed === 0);
  } catch (e) { ok('scan-persist — ' + (e && e.stack || e), false); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `${bad} failed` : 'scan-persist: all passed');
  process.exit(bad ? 1 : 0);
})();
