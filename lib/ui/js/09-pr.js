// The session's branch and PR (lib/pr.js). Actions only fill the message box: the session does the
// git/gh work, and nothing leaves the machine until you press Enter.
function forkLink(id,cls){const x=(live.cards||[]).find(y=>y.agent==='claude'&&y.id===id);return '<a href="#" class="'+cls+'" data-id="'+esc(id)+'">'+ico(x)+esc(x?(x.title||short(x.project)):id.slice(0,8))+'</a>'}
const prCache=new Map();
// PR number for pr:123 in the filter: only what a panel already learned from gh, remembered in localStorage.
const prNums=(()=>{try{return JSON.parse(localStorage.getItem('prnums')||'{}')||{}}catch(e){return {}}})();
function prNumOf(c){const k=c.agent+':'+c.id;const s=prCache.get(k);return (s&&s.pr&&s.pr.number)||prNums[k]||0}
// same rule as lib/pr.js mergeable()
function prMergeable(pr){const ck=(pr&&pr.checks)||{};return !!pr&&pr.state==='OPEN'&&!pr.draft&&!ck.fail&&!ck.pending&&pr.review!=='CHANGES_REQUESTED'&&pr.review!=='REVIEW_REQUIRED'&&!['BLOCKED','DIRTY','BEHIND','DRAFT'].includes(pr.merge)}
const prDone=new Map();   // 'agent:id' → the last マージして片付け / 片付け's answer, or 'busy'
const PR_STEP={merge:'マージ',worktree:'worktree',branch:'ブランチ',done:'完了'};
function prStepsHtml(r){
  if(!r)return '';if(r==='busy')return '<span class="prsteps dim">処理中…</span>';
  return '<span class="prsteps">'+(r.steps||[]).map(x=>'<span class="'+(x.ok?'pok':'pfail')+'" title="'+esc(x.detail||'')+'">'+(x.ok?'✓ ':'✗ ')+esc(PR_STEP[x.step]||x.step)+'</span>').join('')+(r.error?'<span class="pfail">'+esc(r.error)+'</span>':'')+'</span>';
}
function prHtml(st,key){
  if(!st)return '';
  const pr=st.pr,bits=[];
  bits.push('<span class="pbr">⎇ '+esc(st.branch)+'</span>'+(st.worktree?'<span class="pwt" title="このセッション専用の git worktree">worktree</span>':''));
  if(!st.onBase&&st.base)bits.push('<span class="dim">'+esc(st.base.replace(/^origin\//,''))+' から +'+st.ahead+'</span>');
  if(st.dirty)bits.push('<span class="pdirty">未コミット '+st.dirty+'</span>');
  if(!st.onBase&&st.ahead&&!st.pushed)bits.push('<span class="dim">未 push</span>');
  if(pr){
    const S={OPEN:pr.draft?'下書き':'オープン',MERGED:'マージ済み',CLOSED:'閉じた'}[pr.state]||pr.state;
    const ck=pr.checks||{};
    bits.push('<a class="prlink" href="#" data-url="'+esc(pr.url)+'" title="'+esc(pr.title)+'">PR #'+pr.number+' '+esc(S)+'</a>'
      +(ck.fail?'<span class="pfail">✗ '+ck.fail+'</span>':'')+(ck.pending?'<span class="dim">⏳ '+ck.pending+'</span>':'')+(ck.pass&&!ck.fail&&!ck.pending?'<span class="pok">✓ '+ck.pass+'</span>':'')
      +(pr.review==='APPROVED'?'<span class="pok">承認済み</span>':pr.review==='CHANGES_REQUESTED'?'<span class="pfail">修正依頼</span>':''));
  }
  const r=key?prDone.get(key):null,busy=r==='busy';
// these run in the board via gh / git, not in the session
  const fin=pr&&!(r&&r.ok)?(prMergeable(pr)?'<button class="mini prfin" data-merge="1"'+(busy?' disabled':'')+' title="gh pr merge --squash → worktree を削除 → 完了。もう一度押すまで何も起きません">マージして片付け</button>'
    :(pr.state==='MERGED'||pr.state==='CLOSED')?'<button class="mini prfin"'+(busy?' disabled':'')+' title="'+(st.worktree?'worktree を削除して':'')+'完了にします。もう一度押すまで何も起きません">片付け</button>':''):'';
  return '<span class="prl">'+bits.join('')+'</span>'
    +fin+prStepsHtml(r);
}
function wirePr(c){
  const box=$('#mpr');if(!box)return;
  for(const a of box.querySelectorAll('a.prlink'))a.onclick=e=>{e.preventDefault();if(native)post({type:'openurl',url:a.dataset.url});else window.open(a.dataset.url,'_blank','noopener')};
// first click arms, second runs (a confirm dialog would block the app's page)
  for(const b of box.querySelectorAll('.prfin'))b.onclick=()=>{
    if(!b.classList.contains('arm')){const l=b.textContent;b.classList.add('arm');b.textContent=b.dataset.merge?'本当にマージ':'本当に片付け';
      setTimeout(()=>{if(b.isConnected&&b.classList.contains('arm')){b.classList.remove('arm');b.textContent=l}},4000);return}
    prFinish(c,!!b.dataset.merge);
  };
}
function prFinish(c,merge){
  const k=c.agent+':'+c.id;prDone.set(k,'busy');prRedraw(k);
  if(native){post({type:'prmerge',agent:c.agent,session:c.id,merge});return}
  fetch('api/pr/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:c.agent,session:c.id,merge})})
    .then(r=>r.json()).then(j=>window.__kanban.prFinished({agent:c.agent,session:c.id,...j})).catch(e=>window.__kanban.prFinished({agent:c.agent,session:c.id,ok:false,steps:[],error:String(e)}));
}
function prRedraw(k){
  if(openFor!==k)return;const box=$('#mpr');if(!box)return;
  box.innerHTML=prHtml(prCache.get(k),k);box.hidden=!prCache.get(k);wirePr(openCard);
}
function prFinished(j){
  if(!j||!j.agent)return;
  const k=j.agent+':'+j.session;prDone.set(k,{ok:!!j.ok,steps:j.steps||[],error:j.error||''});
  prRedraw(k);
  if(j.ok){if(openCard&&openFor===k)askPr(openCard);load()}
}
function askPr(c){
  if(!c||!c.project||!convAgent(c))return;
  if(native){post({type:'pr',agent:c.agent,session:c.id});return}
  fetch('api/pr?agent='+encodeURIComponent(c.agent)+'&session='+encodeURIComponent(c.id)).then(r=>r.json()).then(j=>window.__kanban.pr(j)).catch(()=>{});
}
function prArrived(j){
  if(!j)return;
  const k=j.agent+':'+j.session;prCache.set(k,j.status||null);
  const num=j.status&&j.status.pr&&j.status.pr.number;
  if(num&&prNums[k]!==num){prNums[k]=num;const ks=Object.keys(prNums);if(ks.length>500)delete prNums[ks[0]];try{localStorage.setItem('prnums',JSON.stringify(prNums))}catch(e){}}
  if(openFor!==k)return;
  const box=$('#mpr');if(!box)return;
  box.innerHTML=prHtml(j.status,k);box.hidden=!j.status;wirePr(openCard);
}
