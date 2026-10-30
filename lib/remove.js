'use strict';
/**
 * remove.js — take a session off the machine, recoverably.
 *
 * A background Claude session's registry entry is removed only by `claude rm`
 * (which refuses a worktree with unpushed commits). The transcript and its
 * `<id>/` side directory are moved to the Trash, never unlinked. Sessions
 * open in a terminal, and subagents, are refused.
 */
const Env = require('./env.js');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Paths = require('./paths.js');
const Dispatch = require('./dispatch.js');
const Alive = require('./alive.js');

function trashDir() {
  return Env.get('TRASH') || Paths.home('.Trash');
}

/** Everything in Claude's registry, finished background sessions included. */
function registry() {
  const bin = Dispatch.binaryFor('claude');
  if (!bin) return null;
  const r = spawnSync(bin, ['agents', '--json', '--all'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return null;
  return Alive.parseJson(r.stdout || '');
}

/** Move one path into `dest`, across volumes if it has to. */
function moveInto(src, dest) {
  const to = path.join(dest, path.basename(src));
  try { fs.renameSync(src, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, to, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  return to;
}

/**
 * @param {{agent, id, record: {file, parentId?}|null, reg?: array|null, run?: Function}} o
 *   `record` is the board's own lookup of the session (never a client path);
 *   `reg` and `run` exist for tests.
 */
function remove(o) {
  const { agent, id, record } = o;
  if (!agent || !id) throw new Error('agent and session are required');
  // it goes into argv (`claude rm <id>`): an id, never an option
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/.test(String(id))) throw new Error('bad session id');
  if (!record || !record.file) return { error: 'このセッションの記録が見つかりません(表示範囲を広げてください)' };
  if (record.parentId != null) return { error: 'サブエージェントは親のセッションと一緒に削除されます' };
  const out = { ok: true, agent, id };
  if (agent === 'claude') {
    const reg = o.reg !== undefined ? o.reg : registry();
    // A failed `claude agents` is not "nobody runs": refuse rather than guess.
    if (!Array.isArray(reg)) return { error: 'Claude にセッションの状態を確認できなかったので削除しませんでした(claude agents --json --all を確かめてください)' };
    // A resumed background job writes a new transcript while the registry
    // keeps its first id (lib/alive.js resumeAs): this one may be live.
    const writer = reg.find((s) => s && s.sessionId !== id && s.id && (s.pid || s.status || s.state === 'blocked') && Alive.jobTranscript(s.id) === id);
    if (writer) return { error: `バックグラウンドのジョブ(${String(writer.id).slice(0, 12)})がこの会話の続きを書いています。止めてから削除してください` };
    const entry = reg.find((s) => s && s.sessionId === id);
    if (entry && entry.kind === 'interactive') return { error: 'ターミナルで開いたままです。閉じてから削除してください' };
    if (entry && entry.kind === 'background') {
      const run = o.run || ((args) => spawnSync(Dispatch.binaryFor('claude'), args, { encoding: 'utf8', timeout: 30000 }));
      const r = run(['rm', id]);
      if (r.status !== 0) {
        const why = String((r.stderr || '') + (r.stdout || '')).replace(/\x1b\][^\x07]*\x07/g, '').trim();
        return { error: 'claude rm が止めました: ' + (why || `exit ${r.status}`) };
      }
      out.registry = 'removed';
    }
  }
  // mkdtemp: unique even for two removals in the same millisecond
  fs.mkdirSync(trashDir(), { recursive: true });
  const dest = fs.mkdtempSync(path.join(trashDir(), `rally-${agent}-${id.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}-`));
  const moved = [];
  const file = record.file;
  // `claude rm` may already have taken the transcript with it
  if (fs.existsSync(file)) moved.push(moveInto(file, dest));
  if (agent === 'claude') {
    const side = path.join(path.dirname(file), path.basename(file, '.jsonl'));
    if (side !== file && fs.existsSync(side) && fs.statSync(side).isDirectory()) moved.push(moveInto(side, dest));
  }
  if (!moved.length && !out.registry) { try { fs.rmdirSync(dest); } catch (e) { /* not empty */ } return { error: '記録ファイルが既にありません' }; }
  if (!moved.length) try { fs.rmdirSync(dest); } catch (e) { /* not empty */ }
  out.trash = moved.length ? dest : null;
  out.moved = moved;
  return out;
}

module.exports = { remove, trashDir, registry };
