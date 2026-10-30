/**
 * rename-check.js — scripts/rename.py with a name other than the current one: in a copy of the
 * tracked files, rename to a made-up name (and once more, to a second one), and the whole node suite
 * has to pass there. That is what keeps the name a one-command decision (the product's name is not
 * final): nothing may spell the current name in a way the script cannot follow.
 *
 * Run: node test/rename-check.js [hops]   (default 1; each hop runs test/test.js and test/page.js in the copy)
 * Exit 0: passed. Never touches this checkout: the copy is under the temp directory.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const hops = ['Kanbo', 'Zeta'].slice(0, Math.max(1, +process.argv[2] || 1));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-check-'));
let bad = 0;
const ok = (n, c) => { console.log(c ? '  ✓' : '  ✗', n); if (!c) bad++; };
// the copy runs in a clean environment: what an outer test run set under any of the names (its scratch stores) is not the copy's
const prefixes = new RegExp('^(' + [...require('../lib/names.js').NAMES, ...hops.map((h) => h.toLowerCase())].map((n) => n.toUpperCase()).join('|') + ')_');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !prefixes.test(k)));
const run = (cmd, args, cwd, env = {}) => cp.spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...cleanEnv(), RENAME_CHECK_INNER: '1', ...env }, maxBuffer: 64 << 20, timeout: 600000 });

try {
  const files = cp.execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
  for (const f of files) {
    const to = path.join(tmp, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
    fs.chmodSync(to, fs.statSync(path.join(root, f)).mode);
  }
  run('git', ['init', '-q'], tmp); run('git', ['add', '-A'], tmp);
  const before = require('../lib/names.js');
  for (const name of hops) {
    const r = run('python3', ['scripts/rename.py', name], tmp);
    ok(`rename.py ${name}: ${(r.stdout || r.stderr || '').trim().split('\n')[0]}`, r.status === 0);
    run('git', ['add', '-A'], tmp);
    const lower = name.toLowerCase();
    const N = JSON.parse(cp.execFileSync(process.execPath, ['-p', 'JSON.stringify(require("./lib/names.js"))'], { cwd: tmp, encoding: 'utf8' }));
    ok(`${name}: names.js has it first, keeps the earlier names after it (${N.NAMES.join(' → ')})`, N.NAMES[0] === lower && N.NAMES.includes('agentkanban') && N.NAMES.length === before.NAMES.length + hops.indexOf(name) + 1 && N.DISPLAY === name);
    ok(`${name}: paths moved (bin/${lower}.js, app/Sources/${name}/main.swift), the old ones gone`, fs.existsSync(path.join(tmp, 'bin', lower + '.js')) && fs.existsSync(path.join(tmp, 'app', 'Sources', name, 'main.swift')) && !fs.existsSync(path.join(tmp, 'bin', before.NAME + '.js')));
    const t = run(process.execPath, ['test/test.js'], tmp);
    const p = run(process.execPath, ['test/page.js'], tmp);
    const sum = (s) => (String(s).match(/(\d+) passed, (\d+) failed/g) || []).pop() || 'no summary';
    const fails = String(t.stdout).split('\n').filter((l) => l.startsWith('  ✗')).slice(0, 5);
    ok(`${name}: node test/test.js passes in the copy (${sum(t.stdout)}) ${fails.join(' | ')}`, t.status === 0 && /, 0 failed/.test(sum(t.stdout)));
    ok(`${name}: node test/page.js passes in the copy (${sum(p.stdout)})`, p.status === 0 && /, 0 failed/.test(sum(p.stdout)));
    const again = run('python3', ['scripts/rename.py', name], tmp);
    ok(`${name}: the same name again is refused, nothing changes`, again.status !== 0);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(bad ? `${bad} failed` : 'rename-check: all passed');
process.exit(bad ? 1 : 0);
