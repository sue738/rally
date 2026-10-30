'use strict';
const { t: tr } = require('../i18n.js');
/** server.js — the board's HTTP server, on loopback only. */
const Env = require('../env.js');
const Paths = require('../paths.js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const NAME = 'rally';
const Dispatch = require('../dispatch.js');
const Perm = require('../perm.js');
const Labels = require('../labels.js');
const Queue = require('../queue.js');
const Attach = require('../attach.js');
const { PAGE } = require('../page.js');   // lib/ui/{index.html,css/*.css,js/*.js}
const { resumeHint } = require('./columns.js');
const { sessionRecord, searchConversations, historyFor, wipFor } = require('./sessions.js');
const { sendTo, sendHeldNow, finish, prFinish } = require('./send.js');
const { state } = require('./state.js');

/** Start the server on 127.0.0.1. Returns {server, url, port}. `port` 0 = ephemeral. */
function serve(opts = {}) {
  const port = opts.port != null ? opts.port : 7331;
  /**
   * CSRF / DNS-rebinding guard for the open loopback server: the Host must be this
   * server's loopback name, a browser must say same-origin, and a POST body must be
   * declared JSON (a cross-site page cannot send that without a preflight, never answered).
   */
  const refused = (req, u) => {
    const port = server.address().port;
    const host = String(req.headers.host || '').toLowerCase();
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return [421, 'unexpected Host'];
    if (!u.pathname.startsWith('/api/')) return null;
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return [403, 'cross-site request'];
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return [403, 'cross-origin request'];
    if (req.method === 'POST' && !/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return [415, 'content-type must be application/json'];
    return null;
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const no = refused(req, u);
      if (no) { req.resume(); return json(no[0], { error: no[1] }); }
      if (u.pathname === '/' || u.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(PAGE);
      }
      if (u.pathname === '/api/state') {
        const hours = Math.max(1, Math.min(720, +u.searchParams.get('hours') || opts.hours || 24));
        // opt-in: the page asks for it, a bare fetch does not
        const enrich = u.searchParams.get('enrich') === '1' && !Env.get('NO_ENRICH');
        // watch=1: the page is on screen, so permission prompts may wait for it
        const st = state({ hours, only: opts.only, dirs: opts.dirs, enrich, watch: u.searchParams.get('watch') === '1' });
        st.cards = st.cards.map((c) => ({ ...c, resume: resumeHint(c) }));
        return json(200, st);
      }
      if (u.pathname === '/api/queue' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try {
            const b = JSON.parse(body);
            if (b.now) { const r = sendHeldNow({ agent: b.agent, id: b.session, key: b.key, dirs: opts.dirs }); return json(200, r.error ? r : { ok: true, ...r }); }
            return json(200, { ok: true, ...(b.edit ? Queue.edit({ agent: b.agent, id: b.session, key: b.key, text: b.text }) : b.cancel ? Queue.remove({ agent: b.agent, id: b.session, key: b.key, plain: !!b.plain, delivered: !!b.delivered }) : b.retry ? Queue.retry({ agent: b.agent, id: b.session }) : Queue.add({ agent: b.agent, id: b.session, text: b.text, model: b.model })) });
          } catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/label' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try { const b = JSON.parse(body); return json(200, { ok: true, ...Labels.set({ agent: b.agent, id: b.session, label: b.label, color: b.color }) }); }
          catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/wip' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try {
            const b = JSON.parse(body);
            const r = b.drop != null ? require('../wip.js').drop({ agent: String(b.agent || ''), id: String(b.session || ''), what: String(b.drop) })
              : wipFor({ agent: b.agent, id: b.session, hours: opts.hours || 24, dirs: opts.dirs, model: b.model });
            return json(r.error ? 400 : 200, r);
          } catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/done' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try { const b = JSON.parse(body); return json(200, finish({ agent: b.agent, id: b.session, memory: !!b.memory, undo: !!b.undo, park: !!b.park })); }
          catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/rm' && req.method === 'POST') {
        // the file is the board's own lookup, never a path from the request
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try {
            const b = JSON.parse(body);
            const rec = sessionRecord({ agent: b.agent, id: b.session, hours: 720, dirs: opts.dirs });
            const r = require('../remove.js').remove({ agent: b.agent, id: b.session, record: rec });
            return json(r.error ? 400 : 200, r);
          } catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/attach' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 28e6) req.destroy(); });
        req.on('end', () => {
          try { const b = JSON.parse(body); return json(200, { ok: true, ...Attach.save({ name: b.name, data: b.data }) }); }
          catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/perm' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try { const b = JSON.parse(body); return json(200, Perm.answer(b.id, b.decision, b.decision === 'answer' ? b.answers : b.text) ? { ok: true } : { error: b.decision === 'answer' ? tr('この質問はもう終わっているか、答えが揃っていません') : tr('この許可確認はもう終わっています') }); }
          catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/perm') return json(200, { asks: Perm.list() });
      if (u.pathname === '/api/wtsetup' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
        req.on('end', () => {
          try {
            const b = JSON.parse(body), W = require('../wtsetup.js'), dir = String(b.dir || '');
            const r = Array.isArray(b.include) ? W.include(dir, b.include.map(String)) : W.setSetup(dir, String(b.setup == null ? '' : b.setup));
            return json(200, { dir, ...r });
          } catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/wtsetup') { const dir = String(u.searchParams.get('dir') || ''); return json(200, { dir, ...(require('../wtsetup.js').inspect(dir) || { error: tr('git のリポジトリではありません') }) }); }
      // a session's branch and PR (lib/pr.js); the directory is looked up, never taken from the request
      if (u.pathname === '/api/pr') {
        const sess = sessionRecord({ agent: String(u.searchParams.get('agent') || ''), id: String(u.searchParams.get('session') || ''), hours: opts.hours || 24, dirs: opts.dirs });
        return json(200, { agent: u.searchParams.get('agent'), session: u.searchParams.get('session'), status: sess && sess.project ? require('../pr.js').status(sess.project, { fresh: u.searchParams.get('fresh') === '1' }) : null });
      }
      if (u.pathname === '/api/pr/merge' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
        req.on('end', () => {
          try { const b = JSON.parse(body); const r = prFinish({ agent: b.agent, id: b.session, merge: b.merge === true, dirs: opts.dirs }); return json(200, { agent: b.agent, session: b.session, ...r }); }
          catch (e) { return json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      if (u.pathname === '/api/jobs') return json(200, { jobs: require('../jobs.js').list() });
      if (u.pathname === '/api/search') {
        const words = String(u.searchParams.get('q') || '').split(/\s+/).filter(Boolean);
        return json(200, searchConversations({ words, hours: Math.max(1, Math.min(720, +u.searchParams.get('hours') || opts.hours || 24)), dirs: opts.dirs }));
      }
      if (u.pathname === '/api/changes') {
        const agent = String(u.searchParams.get('agent') || ''), id = String(u.searchParams.get('session') || '');
        const sess = sessionRecord({ agent, id, hours: opts.hours || 24, dirs: opts.dirs });
        if (!sess) return json(200, { files: [], error: tr('セッションが見つかりません') });
        const m = require('../made.js').forSession(sess);
        const paths = [...(m.edited || []), ...(m.files || [])].sort((a, b) => b.t - a.t).map((f) => f.path);
        return json(200, { agent, session: id, ...require('../changes.js').of(paths) });
      }
      if (u.pathname === '/api/view') {
        return json(200, require('../view.js').read(String(u.searchParams.get('path') || '')));
      }
      if (u.pathname === '/api/files') {
        return json(200, require('../files.js').list(String(u.searchParams.get('dir') || '')));
      }
      if (u.pathname === '/api/history') {
        try { Dispatch.recordId(String(u.searchParams.get('agent') || ''), u.searchParams.get('session')); }
        catch (e) { return json(400, { error: e.message }); }
        const hours = Math.max(1, Math.min(720, +u.searchParams.get('hours') || opts.hours || 24));
        return json(200, historyFor({ agent: String(u.searchParams.get('agent') || ''), id: String(u.searchParams.get('session') || ''), hours, dirs: opts.dirs, http: true }));
      }
      if (u.pathname === '/api/img') {
        // a basename joined to the board's own directories, so a path cannot escape
        const name = path.basename(String(u.searchParams.get('f') || ''));
        if (!/^[\w.-]+$/.test(name)) return json(400, { error: 'bad name' });
        // pictures only: the attachment directory also holds whatever was dropped on the page
        if (!/\.(png|jpe?g|gif|webp|heic)$/i.test(name)) return json(404, { error: 'not found' });
        const roots = [Env.get('IMG') || Paths.akDir('img'), Attach.dir()];
        let buf = null, file = null;
        for (const d of roots) {
          const f = path.join(d, name);
          if (!f.startsWith(path.resolve(d) + path.sep)) continue;
          try { buf = fs.readFileSync(f); file = f; break; } catch (e) { /* next root */ }
        }
        if (!buf) return json(404, { error: 'not found' });
        const ext = path.extname(file).slice(1).toLowerCase();
        res.writeHead(200, { 'content-type': `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`, 'cache-control': 'max-age=86400' });
        return res.end(buf);
      }
      if ((u.pathname === '/api/run' || u.pathname === '/api/reply') && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try {
            const b = JSON.parse(body);
            const files = (b.attachments || []).map(Attach.inside).filter(Boolean);
            const r = u.pathname === '/api/reply'
              ? sendTo({ agent: b.agent, id: b.session, text: b.text, model: b.model, attachments: b.attachments, whenFree: !!b.whenFree })
              : Dispatch.dispatch({ agent: b.agent, text: String(b.text || '') + Attach.lines(files), model: b.model, chrome: !!b.chrome, mode: b.mode || undefined, dir: b.dir, addDirs: files.length ? [path.resolve(Attach.dir())] : undefined });
            // a start the CLI refused is not a start (sendTo reads its own reply's log)
            if (u.pathname === '/api/run') { const got = Dispatch.outcome(r.log, b.agent === 'codex' ? 1200 : 6000, r.pid); if (got && got.refused) r.error = tr('{agent} が起動しませんでした: {why}', { agent: b.agent, why: got.refused }); if (got && got.conversation) r.conversation = got.conversation; }
            // an error sendTo reported (a fork, a refusal) is the answer, not a footnote to ok:true
            if (r.error) return json(200, { error: r.error, log: r.log, ...(r.typeable ? { typeable: true } : {}), ...(r.saved ? { saved: true, attach: String(b.session || '').slice(0, 8) } : {}), ...(r.queued ? { queued: true, why: r.why } : {}) });
            const short = u.pathname === '/api/run' && b.agent === 'claude' ? Dispatch.startedShort(r.log) : null;
            json(200, { ok: true, pid: r.pid, log: r.log, argv: r.argv, queued: r.queued, delivered: r.delivered, woke: r.woke, why: r.why, relayed: r.relayed, to: r.to, ...(short ? { short, agent: b.agent } : {}),
              ...(r.conversation ? { session: r.conversation, short: r.conversation.slice(0, 8), agent: b.agent } : {}) });
          } catch (e) { json(400, { error: String(e && e.message || e) }); }
        });
        return;
      }
      json(404, { error: 'not found' });
    } catch (e) { json(500, { error: String(e && e.message || e) }); }
  });
  // a reply's handler runs synchronously for seconds (it waits on the CLI): with Node's 5 s keep-alive the idle socket
  // could be closed just as the next request reused it ("other side closed", seen under load)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${p}/`, port: p });
    });
  });
}

module.exports = { NAME, serve };
