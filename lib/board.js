'use strict';
/**
 * board.js — a local kanban of every agent session on the machine, served on
 * 127.0.0.1 by node:http (no dependencies, no build). Read-only towards agents
 * until a person starts or sends (dispatch.js). Binds to loopback only. The parts
 * live in lib/board/.
 */
const Columns = require('./board/columns.js');
const Sessions = require('./board/sessions.js');
const Send = require('./board/send.js');
const { state } = require('./board/state.js');
const Server = require('./board/server.js');
const { PAGE } = require('./page.js');   // lib/ui/{index.html,css/*.css,js/*.js}

const { NAME, serve } = Server;
const { looksLikeAQuestion, resumeHint } = Columns;
const { defaultModels, searchConversations, historyFor, sessionRecord, wipFor, wipCandidates } = Sessions;
const { WRAPUP, finish, sendTo, sendHeldNow, handOver, stopAndConfirm, prFinish } = Send;

module.exports = { NAME, WRAPUP, defaultModels, searchConversations, looksLikeAQuestion, state, historyFor, sessionRecord, wipFor, wipCandidates, finish, sendTo, sendHeldNow, handOver, stopAndConfirm, resumeHint, serve, PAGE, prFinish };
