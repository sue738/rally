#!/usr/bin/env node
'use strict';
/**
 * The board app/selftest.sh runs against: a home directory of its own, with
 * made-up Claude sessions in it, so no scenario opens, resumes, sends to or
 * stages a file into a session of yours, and every run sees the same board.
 *
 *   node selftest-home.js <home> <work>
 *
 * <home> gets .claude/projects/<project>/<id>.jsonl (and a subagent), a
 * .claude/settings.json with the permission hook in it (as an installed
 * board has), and one launchd job of "yours" in Library/LaunchAgents (only
 * read: the selftest app records a job's action and never runs launchctl).
 * <work> gets the project directories the sessions ran in. Times are fixed
 * relative to when this runs, and each file's mtime is its last line's, so
 * nothing on the board moves while a run goes on. Prints the ids as
 * `name=<uuid>` lines for selftest.sh.
 *
 *   lane (as the board classifies it)       session
 *   Your Turn (asked you something)         beta, 12 min ago
 *   Your Turn (answered)                    alpha (long, tools), gamma, epsilon (a subagent), zeta, eta
 *   放置 (quiet for hours)                  delta 7h, home (begun in the home folder) 8h
 */
const fs = require('fs');
const path = require('path');

const [home, work] = process.argv.slice(2);
if (!home || !work) { console.error('usage: selftest-home.js <home> <work>'); process.exit(2); }

const now = Date.now();
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();
const enc = (d) => d.replace(/[^A-Za-z0-9]/g, '-');
const ids = {};
let seq = 0;
// fixed ids, so a report names the same session every run
const uuidFor = (n) => { const h = (0x5e1f7e57 + n).toString(16).padStart(8, '0'); return `${h}-0000-4000-8000-${String(n).padStart(12, '0')}`; };

// a project has files of its own (@ in the message box lists them, the viewer opens one)
function project(cwd) {
  if (cwd === home || fs.existsSync(path.join(cwd, 'README.md'))) return;
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'README.md'), `# ${path.basename(cwd)}\n\nA selftest fixture project.\n`);
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: path.basename(cwd), version: '0.0.0' }, null, 1) + '\n');
  for (let k = 1; k <= 3; k++) fs.writeFileSync(path.join(cwd, 'src', `mod${k}.js`), `module.exports = ${k};\n`);
}

function session(name, cwd, endAgoMin, turns, opts = {}) {
  const id = uuidFor(++seq);
  ids[name] = id;
  fs.mkdirSync(cwd, { recursive: true });
  project(cwd);
  const lines = [];
  // spread over the conversation: a start more than a batch window apart from the others
  let t = now - endAgoMin * MIN - turns.length * 2 * MIN;
  let parent = null;
  const push = (o) => { const uuid = `${id.slice(0, 8)}-${String(lines.length).padStart(4, '0')}`; lines.push(JSON.stringify({ parentUuid: parent, isSidechain: !!opts.sidechain, userType: 'external', entrypoint: 'cli', cwd, sessionId: opts.parentId || id, version: 'selftest', uuid, timestamp: iso(t), ...o })); parent = uuid; };
  let n = 0;
  for (const turn of turns) {
    push({ type: 'user', message: { role: 'user', content: turn.user } });
    t += 20000;
    for (const tool of turn.tools || []) {
      const tid = `toolu_${id.slice(0, 8)}_${n++}`;
      push({ type: 'assistant', message: { role: 'assistant', model: 'claude-selftest', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: tid, name: tool.name, input: tool.input }], usage: { input_tokens: 1200, output_tokens: 80 } } });
      t += 5000;
      push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: tool.out || 'ok', is_error: !!tool.error }] }, ...(tool.patch ? { toolUseResult: { structuredPatch: [{ lines: tool.patch }] } } : {}) });
      t += 5000;
    }
    push({ type: 'assistant', message: { role: 'assistant', model: 'claude-selftest', stop_reason: 'end_turn', content: [{ type: 'text', text: turn.said }], usage: { input_tokens: 2400, output_tokens: 300 } } });
    t += 3000;
    push({ type: 'system', subtype: 'turn_duration', durationMs: 30000 });
    t += 2 * MIN - 33000;
  }
  const dir = opts.parentId
    ? path.join(home, '.claude', 'projects', enc(cwd), opts.parentId, 'subagents')
    : path.join(home, '.claude', 'projects', enc(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, (opts.file || id) + '.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  // the file's mtime is its last line's
  const last = JSON.parse(lines[lines.length - 1]).timestamp;
  fs.utimesSync(f, new Date(last), new Date(last));
  return id;
}

const para = (k) => `ステップ${k}の結果です。変更点をまとめます。\n\n- 設定ファイルを読み直しました\n- テストを追加しました(${k}件)\n- 既存の挙動は変えていません\n\n次は残りの項目を順に見ていきます。必要なら差分を開いて確認してください。`;
const W = (d) => path.join(work, d);

// a long conversation with tool runs of every kind: the thread scrolls, a turn can be replied to
session('alpha', W('alpha'), 40, Array.from({ length: 14 }, (_, k) => ({
  user: k === 0 ? 'selftest: alpha の設定読み込みを整理して' : `次の項目 ${k} もお願いします`,
  tools: k % 3 === 0 ? [{ name: 'Bash', input: { command: `ls -la src/${k}` }, out: 'total 8\nfile.js' }]
    : k % 3 === 1 ? [{ name: 'Edit', input: { file_path: path.join(W('alpha'), `src/mod${k}.js`), old_string: 'a', new_string: 'b' }, patch: ['-a', '+b'] }]
      : [{ name: 'Read', input: { file_path: path.join(W('alpha'), 'README.md') } }, { name: 'Bash', input: { command: 'npm test' }, out: 'failed', error: k === 2 }],
  said: para(k),
})));
// it asked you something and stopped: Your Turn, a question
session('beta', W('beta'), 12, [
  { user: 'selftest: beta のログイン画面を直して', tools: [{ name: 'Read', input: { file_path: path.join(W('beta'), 'login.html') } }], said: '原因はフォームの送信先でした。' },
  { user: 'じゃあ直して', tools: [{ name: 'Write', input: { file_path: path.join(W('beta'), 'login.html'), content: '<form>' } }], said: '直し方が2つあります。A: 送信先を相対パスにする。B: 設定から読む。どちらで進めますか？' },
]);
session('gamma', W('gamma'), 25, [
  { user: 'selftest: gamma のREADMEを書いて', tools: [{ name: 'Write', input: { file_path: path.join(W('gamma'), 'README.md'), content: '# gamma' } }], said: 'README.md を書きました。' },
  { user: '使い方も足して', tools: [{ name: 'Edit', input: { file_path: path.join(W('gamma'), 'README.md'), old_string: '# gamma', new_string: '# gamma\n\n使い方' } }], said: '使い方の節を足しました。' },
]);
// a parent whose subagent ran and finished
const eps = session('epsilon', W('alpha'), 55, [
  { user: 'selftest: epsilon 調査をサブエージェントに任せて', tools: [{ name: 'Task', input: { description: '依存を調べる', prompt: '依存を一覧して', subagent_type: 'general-purpose' }, out: '依存は3つでした' }], said: 'サブエージェントの結果: 依存は3つでした。' },
  { user: 'ありがとう', said: 'どういたしまして。ほかに調べることがあれば言ってください。' },
]);
session('epsilon-sub', W('alpha'), 58, [
  { user: '依存を一覧して', tools: [{ name: 'Bash', input: { command: 'cat package.json' }, out: '{}' }], said: '依存は3つでした' },
], { parentId: eps, sidechain: true, file: 'agent-selftest' });
session('zeta', W('gamma'), 70, [
  { user: 'selftest: zeta のテストを速くして', tools: [{ name: 'Bash', input: { command: 'node test.js' }, out: '12s' }], said: '待ち時間を短くして 12 秒から 3 秒になりました。' },
  { user: 'CIも', tools: [{ name: 'Edit', input: { file_path: path.join(W('gamma'), 'ci.yml'), old_string: 'x', new_string: 'y' } }], said: 'CI の設定も合わせました。' },
]);
session('eta', W('delta'), 90, [
  { user: 'selftest: eta の型エラーを直して', tools: [{ name: 'Bash', input: { command: 'tsc' }, out: 'error TS2322', error: true }, { name: 'Edit', input: { file_path: path.join(W('delta'), 'a.ts'), old_string: 'x', new_string: 'y' } }], said: '型エラーを直しました。' },
  { user: 'ビルドも確認して', tools: [{ name: 'Bash', input: { command: 'tsc' }, out: '' }], said: 'ビルドは通りました。' },
]);
// quiet for hours: 放置
session('delta', W('delta'), 7 * 60, [
  { user: 'selftest: delta の移行計画を立てて', said: '計画の下書きです。' },
  { user: '続けて', tools: [{ name: 'Bash', input: { command: 'git log --oneline' }, out: 'abc' }], said: '途中まで進めました。' },
]);
// begun in the home folder (Claude will not run it in the background)
session('home', home, 8 * 60, [
  { user: 'selftest: ホームで始めた会話', said: 'はい。' },
  { user: 'もう一つ', tools: [{ name: 'Bash', input: { command: 'ls' }, out: 'Library' }], said: '見ました。' },
]);

// an installed board's settings: the permission hook in them
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: 'node /selftest/lib/permhook.js' }] }] } }, null, 1));

// one launchd job of yours (its program under this home), never loaded
const la = path.join(home, 'Library', 'LaunchAgents');
fs.mkdirSync(la, { recursive: true });
fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
fs.writeFileSync(path.join(home, 'logs', 'selftest-job.log'), 'selftest job: done\n');
fs.writeFileSync(path.join(la, 'dev.sue738.rally.selftest-job.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.sue738.rally.selftest-job</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>${home}/bin/selftest-job.sh</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
<key>StandardOutPath</key><string>${home}/logs/selftest-job.log</string>
</dict></plist>
`);

for (const [k, v] of Object.entries(ids)) console.log(`${k}=${v}`);
