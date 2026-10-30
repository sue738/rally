#!/usr/bin/env node
'use strict';
/**
 * permhook.js — Claude Code's PermissionRequest hook for the board (lib/perm.js).
 * Anything short of an answer prints nothing and exits 0, leaving the prompt to
 * the terminal. settings.json names the shim ~/.rally/bin/permhook; its timeout
 * is how long a background prompt waits:
 *   "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command",
 *     "command": "~/.rally/bin/permhook", "timeout": 86400 }] }]
 */
const Perm = require('./perm.js');

const POLL_MS = 250;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let req;
  try { req = JSON.parse(input); } catch (e) { process.exit(0); }
  // the transcript alone can't tell a tool waiting for permission from one running
  try { Perm.markAsked(req); } catch (e) { /* the prompt still goes on */ }
  const bg = Perm.background();
  if (!Perm.holdable() || (!bg && !Perm.watching())) process.exit(0);
  let id;
  try { id = Perm.put(req, process.pid, { bg }); } catch (e) { process.exit(0); }
  const done = (decision) => {
    const answers = decision === 'answer' ? Perm.takenAnswers(id) : Perm.takenText(id);
    Perm.clear(id);
    const o = Perm.hookOutput(decision, req, answers);
    if (o) process.stdout.write(JSON.stringify(o));
    process.exit(0);
  };
  // Esc in the terminal, the session ending: take the request off the board
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { Perm.clear(id); process.exit(0); });
  const start = Date.now();
  const tick = () => {
    const d = Perm.taken(id);
    if (d) return done(d);
      if ((!bg && !Perm.watching()) || Date.now() - start > (bg ? Perm.HOLD_BG_MS : Perm.HOLD_MS)) return done('pass');
    setTimeout(tick, POLL_MS);
  };
  tick();
});
