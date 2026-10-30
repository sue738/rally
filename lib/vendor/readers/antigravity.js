'use strict';
/**
 * readers/antigravity.js — Antigravity (agy) sessions, from the logs of the runs the board
 * started (see lib/antigravity.js); agy's own store is sealed.
 * One session per conversation; its file is its newest log. Adds `running` and `denied`
 * (permissions its newest run was refused), read by lib/live.js.
 */
const M = require('../model.js');
const Agy = require('../../antigravity.js');

const AGENT = Agy.AGENT;

function defaultDir() { return Agy.dir(); }

const READ = /^(view_file|list_dir|grep_search|find_by_name|read_url_content|search_web|read_resource|list_resources)$/;
const WRITE = /^(write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit)$/;
function op(tool) { return tool === 'run_command' ? 'shell' : WRITE.test(tool) ? 'write' : READ.test(tool) ? 'read' : 'other'; }

function sessionOf(id, runs) {
  const events = [];
  for (const r of runs) {
    let t = r.t0;
    events.push({ t, kind: 'meta' });
    if (r.prompt) events.push({ t, kind: 'user', human: true, chars: r.prompt.length });
    for (const s of r.steps) {
      if (s.type === 'user_input') continue;
      const callId = `${r.file}#${s.i}`;
      if (s.type === 'tool') {
        const target = s.params && (s.params.TargetFile || s.params.AbsolutePath);
        events.push({ t, kind: 'tool_call', tool: s.tool || 'tool', callId, op: op(s.tool), input: target ? M.toolInput({ path: target }) : {} });
        if (s.state === 'DONE' || s.state === 'ERROR') events.push({ t: t + Math.round((s.dur || 0) * 1000), kind: 'tool_result', callId, ok: s.state === 'DONE', ...(s.error ? { text: s.error.slice(0, 200) } : {}) });
      } else if (s.text.trim()) events.push({ t, kind: 'assistant', chars: s.text.length });
      t += Math.round((s.dur || 0) * 1000);
    }
    // the run's end is its turn's end: the lane reads it as answered (lib/live.js turnEnded)
    if (r.result) events.push({ t: Math.max(t, r.mtime), kind: 'assistant', chars: String(r.result.response || '').length, stop: 'end_turn' });
  }
  const last = runs[runs.length - 1];
  const s = M.session({ agent: AGENT, id, file: last.file, project: last.cwd || runs[0].cwd, parentId: null, entrypoint: 'cli', events });
  s.running = Agy.running(last);
  s.denied = Agy.deniedOf(last);
  return s;
}

function read(opts = {}) {
  const dir = opts.dir || defaultDir();
  const sessions = [];
  for (const [id, runs] of Agy.conversations(dir)) {
    const last = runs[runs.length - 1];
    if (opts.sinceMs && last.mtime < opts.sinceMs && !Agy.running(last)) continue;
    sessions.push(sessionOf(id, runs));
  }
  return { agent: AGENT, dir, sessions };
}

function detect(opts = {}) {
  try { return require('fs').statSync(opts.dir || defaultDir()).isDirectory(); } catch (e) { return false; }
}

function rawSources(opts = {}) {
  return Agy.logs(opts.dir || defaultDir()).map((r) => ({ file: r.file, project: r.cwd, scrubbable: false }));
}

module.exports = { AGENT, defaultDir, read, detect, rawSources, sessionOf };
