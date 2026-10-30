'use strict';
const { t: tr } = require('./i18n.js');
/**
 * pr.js — where a session's branch stands: base, ahead count, uncommitted
 * changes and its pull request (via `gh pr view`; null without gh). status()
 * is read-only and cached a minute per directory (gh is slow); finish()
 * merges and cleans up.
 */
const { execFileSync } = require('child_process');
const Git = require('./git.js');

const CACHE_MS = 60 * 1000;
const cache = new Map();

function git(dir, args) {
  try { return execFileSync('git', [...Git.SAFE_GIT, ...args], { cwd: dir, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}

/** The branch the work goes into: origin's default, else main / master. */
function baseOf(dir) {
  const head = git(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  if (head && head !== 'origin/HEAD') return head;
  for (const b of ['origin/main', 'origin/master', 'main', 'master']) if (git(dir, ['rev-parse', '--verify', '--quiet', b])) return b;
  return null;
}

/** The checks on a pull request, counted. */
function checksOf(rollup) {
  const out = { pass: 0, fail: 0, pending: 0 };
  for (const c of rollup || []) {
    const s = String(c.conclusion || c.state || c.status || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(s)) out.pass++;
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s)) out.fail++;
    else out.pending++;
  }
  return out;
}

function prOf(dir, run = execFileSync) {
  let raw;
  try {
    raw = run('gh', ['pr', 'view', '--json', 'number,state,url,title,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup'],
      { cwd: dir, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
  } catch (e) { return null; }                // no PR for this branch, no gh, logged out
  let j; try { j = JSON.parse(raw); } catch (e) { return null; }
  if (!j || !j.number) return null;
  return { number: j.number, state: j.state, url: j.url, title: j.title, draft: !!j.isDraft,
    review: j.reviewDecision || '', merge: j.mergeStateStatus || '', checks: checksOf(j.statusCheckRollup) };
}

/**
 * @returns {null | {root, branch, base, worktree, ahead, dirty, pushed, pr}}
 *   ahead: commits on the branch that the base does not have
 *   pushed: false when the branch has commits its upstream does not (or no upstream)
 */
function status(dir, opts = {}) {
  if (!dir) return null;
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < CACHE_MS && !opts.fresh) return hit.v;
  const g = Git.info(dir);
  if (!g) { cache.set(dir, { at: Date.now(), v: null }); return null; }
  const base = baseOf(dir);
  const ahead = base ? +(git(dir, ['rev-list', '--count', `${base}..HEAD`]) || 0) : 0;
  const upstream = git(dir, ['rev-parse', '--abbrev-ref', '@{u}']);
  // a worktree's git dir is not the repository's own
  const gd = git(dir, ['rev-parse', '--git-dir']), common = git(dir, ['rev-parse', '--git-common-dir']);
  const worktree = !!(gd && common && require('path').resolve(dir, gd) !== require('path').resolve(dir, common));
  const onBase = !!base && (g.branch === base.replace(/^origin\//, ''));
  const v = { root: g.root, branch: g.branch, base, onBase, worktree, ahead, dirty: g.dirty,
    pushed: !!upstream && g.ahead === 0, pr: onBase || g.branch === 'HEAD' ? null : prOf(dir, opts.run) };
  cache.set(dir, { at: Date.now(), v });
  return v;
}

/** Whether the board may merge this PR itself: open, green, reviewed, not blocked. */
function mergeable(pr) {
  if (!pr || pr.state !== 'OPEN' || pr.draft) return false;
  const ck = pr.checks || {};
  if (ck.fail || ck.pending) return false;
  if (pr.review === 'CHANGES_REQUESTED' || pr.review === 'REVIEW_REQUIRED') return false;
  return !['BLOCKED', 'DIRTY', 'BEHIND', 'DRAFT'].includes(pr.merge);
}

const trim = (r) => String(((r && r.stderr) || '') + ((r && r.stdout) || '')).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 400);

/**
 * Merge the session's PR (when `merge` and mergeable), remove its worktree and
 * close its card; the first failing step stops the rest. Nothing is forced:
 * the refusals of `claude rm` / `git worktree remove` are the answer. The
 * worktree goes before the remote branch: after a squash merge, with the
 * remote branch gone, `claude rm` would call its commits unpushed.
 *
 * @param {{dir, agent, id, merge?: boolean, run?: Function, reg?: array|null, done: Function, st?, common?}} o
 *   run(bin, args, cwd) → {status, stdout, stderr}; `reg` is Claude's registry
 *   (lib/remove.js); `done()` marks the card 完了; `st` and `common` stand in
 *   for git in tests.
 */
function finish(o) {
  const { spawnSync } = require('child_process');
  const run = o.run || ((bin, args, cwd) => spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }));
  const steps = [];
  const out = (ok, extra) => ({ ok, steps, ...extra });
  if (!o.dir) return out(false, { error: tr('このセッションの作業フォルダが分かりません') });
  cache.delete(o.dir);
  const st = o.st || status(o.dir, { fresh: true });
  if (!st) return out(false, { error: tr('git リポジトリではありません') });
  // the main checkout: a worktree is removed, and its branch deleted, from here
  const common = st.worktree ? (o.common || git(o.dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) : null;
  const main = common ? require('path').dirname(common) : o.dir;
  const pr = st.pr;
  // `reg` null: `claude agents` failed; checked before the merge so nothing is half done
  if (st.worktree && o.agent === 'claude' && o.reg === null) return out(false, { error: tr('Claude にセッションの状態を確認できなかったので片付けませんでした(claude agents --json --all を確かめてください)') });
  if (o.merge) {
    if (!mergeable(pr)) return out(false, { error: tr('マージできる状態ではありません(チェック・レビュー・競合を確認してください)') });
    const r = run('gh', ['pr', 'merge', String(pr.number), '--squash'], o.dir);
    if (r.status !== 0) { steps.push({ step: 'merge', ok: false, detail: trim(r) }); return out(false, { error: tr('マージできませんでした: {why}', { why: trim(r) || `exit ${r.status}` }) }); }
    steps.push({ step: 'merge', ok: true, detail: tr('PR #{n} をマージしました', { n: pr.number }) });
  } else if (!pr || (pr.state !== 'MERGED' && pr.state !== 'CLOSED')) {
    return out(false, { error: tr('片付けはマージか閉じた後の PR だけです') });
  } else if (pr.state === 'CLOSED' && !st.pushed) {
    return out(false, { error: tr('PR は閉じていて、push していないコミットがあります。片付けると失われます') });
  }
  if (st.worktree) {
    const entry = o.agent === 'claude' ? (o.reg || []).find((s) => s && s.sessionId === o.id) : null;
    if (entry && entry.kind === 'interactive') { steps.push({ step: 'worktree', ok: false, detail: tr('ターミナルで開いたまま') }); return out(false, { error: tr('ターミナルで開いたままです。閉じてから片付けてください') }); }
    let r;
    if (entry && entry.kind === 'background') r = run(o.claude || 'claude', ['rm', o.id], o.dir);
    else r = common ? run('git', ['worktree', 'remove', st.root], main) : { status: 1, stderr: tr('リポジトリ本体が見つかりません') };
    if (r.status !== 0) { steps.push({ step: 'worktree', ok: false, detail: trim(r) }); return out(false, { error: tr('worktree を片付けられませんでした: {why}', { why: trim(r) || `exit ${r.status}` }) }); }
    steps.push({ step: 'worktree', ok: true, detail: tr('worktree を削除しました') });
  }
  if (o.merge && st.branch && st.branch !== 'HEAD') {
    // not fatal: the repository may delete merged branches itself
    const r = run('git', ['push', 'origin', '--delete', st.branch], main);
    steps.push({ step: 'branch', ok: r.status === 0, detail: r.status === 0 ? tr('origin/{branch} を削除しました', { branch: st.branch }) : tr('リモートのブランチは消せませんでした(既に無いか、自動で消える設定かもしれません)') });
  }
  try { o.done(); steps.push({ step: 'done', ok: true, detail: tr('完了にしました') }); }
  catch (e) { steps.push({ step: 'done', ok: false, detail: String(e && e.message || e) }); return out(false, { error: tr('完了にできませんでした') }); }
  return out(true);
}

module.exports = { status, checksOf, baseOf, prOf, mergeable, finish };
