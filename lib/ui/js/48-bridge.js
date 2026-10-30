function shortHome(p){return String(p||'').replace(/^\/Users\/[^/]+/,'~')}
// 作ったもの: artifacts a session published and files it wrote (lib/made.js).
function renderMade(j){
  const box=$('#mmade');if(!box)return;
  const m=j&&j.made||{},arts=m.artifacts||[],files=m.files||[],edited=m.edited||[];
  if(!arts.length&&!files.length&&!edited.length){box.hidden=true;box.innerHTML='';return}
  const sig=arts.map(a=>a.url+a.title).join('|')+'#'+files.map(f=>f.path).join('|')+'#'+edited.length;
  const touched=new Set([...files,...edited].map(f=>f.path)).size;
  if(box.dataset.sig===sig&&!box.hidden)return;     // nothing new: keep it as you left it
  box.dataset.sig=sig;
  // the folds open as modals now: open only while you have it open, never by itself when a file is written
  const open=!!box.open;box.open=open;box.hidden=false;
  box.innerHTML='<summary class="ph"><b>'+t('作ったもの')+'</b><span class="pn">'+[arts.length?t('{n} アーティファクト',{n:arts.length}):'',files.length?t('{n} ファイル',{n:files.length}):'',touched?t('変更 {n}',{n:touched}):''].filter(Boolean).join(' · ')+'</span>'
    +(touched?'<button class="mini review" title="'+t('書いた・編集したファイルの差分をまとめて見る ({key})',{key:esc(kmL('panel.changes'))})+'">'+t('変更をレビュー')+'</button>':'')+'</summary>'
    +arts.map(a=>'<a class="mk art" href="'+esc(a.url)+'" data-url="'+esc(a.url)+'" title="'+esc(a.url)+'">↗ '+esc(a.title||a.url.split('/').pop())+'</a>').join('')
    +files.map(f=>'<button class="mk file" data-path="'+esc(f.path)+'" title="'+t('開く: {path}',{path:esc(f.path)})+'">'+esc(f.path.split('/').pop())+' <span class="dim">'+esc(shortHome(f.path.split('/').slice(0,-1).join('/')))+'</span></button>').join('');
  const rv=box.querySelector('.review');if(rv)rv.onclick=(e)=>{e.preventDefault();e.stopPropagation();if(openCard)openChanges(openCard)};
  for(const a of box.querySelectorAll('a.art'))a.onclick=(e)=>{e.preventDefault();if(native)post({type:'openurl',url:a.dataset.url});else window.open(a.dataset.url,'_blank','noopener')};
  for(const b of box.querySelectorAll('button.file'))b.onclick=()=>openViewer(b.dataset.path);
}
function renderPrompt(r){
  const p=paneOf(r&&r.pane);if(!p)return;
  const line=p.el.querySelector('.tps');if(!line)return;
  p.cwd=r&&r.cwd||p.cwd;
  const g=r&&r.git;
  let html='<span class="pdir">'+esc(shortHome(p.cwd))+'</span>';
  if(g){
    html+='<span class="pgit">'+esc(g.branch)+'</span>';
    if(g.dirty)html+='<span class="pdirty" title="'+t('コミットしていない変更')+'">●'+g.dirty+'</span>';
    if(g.ahead)html+='<span class="pahead" title="'+t('push していないコミット')+'">↑'+g.ahead+'</span>';
    if(g.behind)html+='<span class="pbehind" title="'+t('取り込んでいないコミット')+'">↓'+g.behind+'</span>';
  }
  line.innerHTML=html;
  if(p===activePane())termCwdLabel();
}
window.__kanban={state(s){applyState(s)},notifyState(j){notifyBar(j)},wtsetup(j){wtArrived(j)},pr(j){prArrived(j)},prFinished(j){prFinished(j)},permChanged(){clearTimeout(permKick);permKick=setTimeout(load,250)},
  // a transcript changed (Watch.swift): a waiting card may be working again, so re-read now
  filesMoved(names){const ns=Array.isArray(names)?names:[];const hit=(live.cards||[]).some(c=>!c.subagent&&(YOU.has(c.column)||c.column==='stale')&&ns.some(n=>n.includes(c.id)))||ns.some(n=>/-antigravity\.log$/.test(n));
    if(hit){clearTimeout(permKick);permKick=setTimeout(load,150)}},files(j){filesArrived(j||{})},jobs(j){jobsArrived(j)},
  // a clicked notification opens its card
  focus(key){const c=(live.cards||[]).find(x=>x.agent+':'+x.id===key);if(c)openDetail(c,false,{focus:false});else pendingOpen=key},history(j){
    renderHistory(j);histTouch(j);if(!openFor||openFor===j.agent+':'+j.session){renderMade(j)}},prompt(r){renderPrompt(r)},attached(r){attachedResult(r)},
  // the native side's answer to wip/done/label/queue/…
  ack(r){
    if(r&&r.error){
      if(r.op==='jobact'){jobActed(r);return}
      toast($('#mbody'),'✗ '+r.error);
      const ps=$('#pscan');if(ps&&r.op==='wip'){ps.disabled=false;ps.textContent=t('棚卸しする')}
      if(r.op==='prmerge'){for(const [k,v] of prDone)if(v==='busy'){prDone.set(k,{ok:false,steps:[],error:r.error});prRedraw(k)}}
      // the askbox waits on this answer either way, or its buttons stay disabled
      if(r.op==='perm'){const f=permSaid;permSaid=null;if(f)f(r)}
      setTimeout(load,500);return}
    if(r&&r.op==='delete'){if(!listDocked())closeDetail('deleted');   // リスト: the next render hands the panel to its neighbour
      load();return}
    if(r&&r.op==='typeterm'){toast($('#mbody'),t('▶ 端末に打ち込みました'));setTimeout(load,1500);return}
    if(r&&r.op==='perm'){const f=permSaid;permSaid=null;if(f)f(r.error?r:{});return}
    if(r&&r.op==='stop'){toast($('#mbody'),t('■ 止めました(会話は残っています)'));setTimeout(load,800);return}
    if(r&&r.op==='wip'){setTimeout(load,1500)}
    if(r&&r.op==='jobact'){jobActed(r)}
  },
  error(m){$('#meta').title=t('状態を取得できません: ')+m;
    const box=$('#empty');if(box){box.innerHTML='<b>'+t('状態を取得できません。')+'</b>'+esc(String(m).slice(0,200));box.hidden=false}}};
let loading=false,lastLoad=0;
/** How far back the board reads: 24 hours (+ / − change it), at least 7 days while Completed is shown. */
function boardHours(){const h=+$('#hours').value||24;const sd=$('#showdone');return sd&&sd.classList.contains('on')?Math.max(h,168):h}
async function load(){
  const h=boardHours();
  loading=true;
  // watch: a visible board, which lets permission prompts wait for it (lib/perm.js)
  const watch=!document.hidden;
  if(native){post({type:'state',hours:h,enrich:true,watch});return}
  try{const r=await fetch('api/state?hours='+h+'&enrich=1'+(watch?'&watch=1':''));applyState(await r.json())}
  catch(e){$('#meta').textContent=t('状態を取得できません(ボードのサーバに接続できません)');console.error(e)}
  render();
}
/** A notice at the bottom of the window, where it is seen whatever the panel shows (the panel's own .toast line is hidden while a terminal is live). */
let flashT=0;
function flash(msg){
  let f=document.querySelector('#flash');
  if(!f){f=document.createElement('div');f.id='flash';f.setAttribute('role','status');document.body.appendChild(f)}
  f.textContent='✓ '+msg;f.classList.add('on');
  clearTimeout(flashT);flashT=setTimeout(()=>f.classList.remove('on'),1800);
}
function toast(d,msg){const t=d.querySelector('.toast');if(t)t.textContent=msg;const b=d.querySelector('.run');if(b)b.disabled=false}
// A send finished: unlock the box. own: the draft key the send took its words
// from, restored as the answer left it (00-core.js). Other sends refill the box only if empty.
function sendingDone(d,back,own){
  delete d.dataset.sending;
  for(const t of d.querySelectorAll('textarea'))t.disabled=false;
  // the panel's message box, or the compose panel's own textarea
  const box=d.querySelector('.msg textarea')||d.querySelector('#ntext');
  if(box){
    if(own){box.value=(back&&back.t)||'';
      if(back&&back.ref&&own!=='new'&&!replyRefs.has(own)){replyRefs.set(own,back.ref);replyChip()}
      // the box shows what is left to send: files that went are taken off (the new-session box kept them), any put back return
      if(own==='new'&&typeof attachClear==='function')attachClear(d);
      if(back&&back.files&&back.files.length&&!attachPaths(d).length)attachRestore(d,back.files);
      if(back)box.dispatchEvent(new Event('input'))}
    else if(typeof back==='string'&&back&&!String(box.value||'').trim())box.value=back;
    if(focusFree(d))box.focus();
  }
  histStick=true;stickBottom($('#mhist'));
}
let lastRun=null;   // where the last 新規 went (and whether it was moved out of ~)
// A new session, from the Enter to its own panel: the compose panel shows each
// step (starting, started, then the session's panel) or why it failed.
let newRun=null,pendingNew=null;
const NEW_WAIT_MS=30000;
function nsState(phase,msg){
  newRun=newRun&&phase!=='starting'?{...newRun,phase,msg}:{phase,msg,at:Date.now()};
  if(panelKey!=='new')return;
  const e=$('#nstate');if(!e)return;
  e.className='nsstate '+phase;e.hidden=false;
  e.innerHTML=(/^(starting|waiting)$/.test(phase)?'<span class="spin">⠋</span>':'')+'<span class="nsmsg">'+esc(msg)+'</span>';
  $('#mbody').dataset.phase=phase;
  // a session that is not showing up can still be looked at where it runs
  if(phase==='late'&&native&&pendingNew&&pendingNew.short){const b=document.createElement('button');b.className='mini';b.textContent=t('端末で開く');
    b.onclick=()=>{openSession(pendingNew?pendingNew.short:'');b.disabled=true};e.append(b)}
}
/** its card is on the board: the panel moves onto it (only from the compose panel you left it on) */
function newArrived(cards){
  if(!pendingNew)return false;
  if(panelKey!=='new'&&panelKey!==pendingNew.prov){pendingNew=null;return false}
  // codex returns no session id: take the first codex card in that folder begun since the Enter
  const p=pendingNew,c=(cards||[]).find(x=>x.agent===p.agent&&(p.dir?x.project===p.dir&&x.firstT!=null&&x.firstT>=p.since:p.id?x.id===p.id:String(x.id).startsWith(p.short)));
  if(!c)return false;
  const onProv=panelKey===p.prov;
  pendingNew=null;newRun=null;delete $('#mbody').dataset.phase;
  // the stand-in's terminal (attached by the short id) now belongs to the real card
  if(onProv)for(const q of ptys.values())if(!q.gone&&q.session&&String(c.id).startsWith(q.session))q.full=c.id;
  openDetail(c,onProv&&openFor===c.agent+':'+c.id,onProv||focusFree($('#detail'))?undefined:{focus:false});return true;
}
// A stand-in card for a just-started claude --bg session, until the board reads
// its first transcript line; the panel only needs the id to attach a terminal.
function provisionalCard(agent,sid,full,req){
  const now=Date.now();
  return {agent,id:full||sid,project:req.dir||'',title:String(req.text||'').trim().split('\n')[0].slice(0,80)||t('(新規セッション)'),
    column:'working',alive:true,aliveKind:'background',aliveShort:sid,aliveChecked:true,firstT:now,lastT:now,provisional:true};
}
/** refresh until the card is there; past NEW_WAIT_MS, say so instead of sitting silent */
function followNew(){
  if(!pendingNew||(panelKey!=='new'&&panelKey!==pendingNew.prov))return;
  if(Date.now()-pendingNew.at>NEW_WAIT_MS){
    if(panelKey===pendingNew.prov){const pc=pendingNew.provCard;
      if(pc&&!pc.provLate){pc.provLate=t('{s}秒たってもボードに出てきません(セッション {id})。最初の書き込みの前に止まったかもしれません。出てきたらこのパネルがそのカードになります',{s:Math.round(NEW_WAIT_MS/1000),id:pendingNew.short});openDetail(pc,true)}
      return}
    nsState('late',t('起動は受け付けられましたが、{s}秒たってもボードに出てきません',{s:Math.round(NEW_WAIT_MS/1000)})+(pendingNew.short?t('(セッション {id})',{id:pendingNew.short}):'')+t('。最初の書き込みの前に止まったかもしれません。出てきたらこのパネルに移ります'));return}
  // once a second: often enough without reads piling up
  load();setTimeout(followNew,1000);
}
const pendingToasts=new Map(),pendingTexts=new Map(),pendingCloses=new Set(),pendingFrom=new Map(),pendingRuns=new Map(),pendingOwn=new Map();
window.__kanban.dispatched=function(r){const d=pendingToasts.get(r.token);pendingToasts.delete(r.token);
  const sentText=pendingTexts.get(r.token);pendingTexts.delete(r.token);
  const closeIt=pendingCloses.has(r.token)||r.closeOnDone;pendingCloses.delete(r.token);
  const from=pendingFrom.get(r.token);pendingFrom.delete(r.token);
  const runReq=pendingRuns.get(r.token);pendingRuns.delete(r.token);
  const own=pendingOwn.get(r.token);pendingOwn.delete(r.token);
  if(!d)return;
  if(d.onDispatched)d.onDispatched(r);
  if(from&&from.includes(':'))wfSettled(from,r);
  if(from&&from.includes(':')&&!r.error)lastSends.set(from,{how:r.relayed||r.typed?'relayed':r.queued?'queued':'started',at:Date.now()});
  // queued or kept by the CLI: not handed back, or it would be sent twice
  const giveBack=r.error&&!r.saved&&!r.queued&&!(r.typeable&&native);
  if(own&&own===panelKey&&d===$('#mbody'))keepUnsent();
  const back=own?draftSettle(own,r.token,!giveBack):null;
  // the panel moved on: settle its echo here
  if(from!==undefined&&from!==panelKey&&sentEchoes.has(from)){const l=sentEchoes.get(from),e=l.find(x=>x.pending);
    if(e){if(r.error||r.queued)l.splice(l.indexOf(e),1);else{e.pending=false;e.who=t('送信済み')}if(!l.length)sentEchoes.delete(from)}}
  if(from!==undefined&&from!==panelKey){if(!own&&giveBack&&sentText&&from&&draftEmpty(draftGet(from)))draftSet(from,{t:sentText},true);setTimeout(load,1200);return}
  if(own)sendingDone(d,back,own);else sendingDone(d,giveBack?sentText:'');
  // the echoed turn says what happened, failure included
  {const pend=document.querySelector('#mhist .turn.pending');
    if(pend){const w=pend.querySelector('.who');
      if(w)w.textContent=r.error?(r.saved?t('保留(claude 側)'):t('送れませんでした')):(r.queued?t('送信待ち'):t('送信済み'));
      if(r.error)pend.classList.add('error');
      pend.classList.remove('pending');
      // keep a sent echo until the transcript has it; drop held or refused ones
      const e=pend._echo;if(e){e.pending=false;e.who=w?w.textContent:t('送信済み');
        if(r.error||r.queued)for(const [k,l] of sentEchoes){const i=l.indexOf(e);if(i>=0){l.splice(i,1);if(!l.length)sentEchoes.delete(k)}}}}}
  // a /command for a session open in a terminal is typed there
  if(r.error&&r.typeable&&native&&sentText&&from&&from.includes(':')){
    const [ag,...rest]=from.split(':');const c=(live.cards||[]).find(x=>x.agent===ag&&x.id===rest.join(':'));
    post({type:'typeterm',agent:ag,session:rest.join(':'),cwd:(c&&c.project)||'',text:sentText.trim()});
    toast(d,t('▶ 端末に {text} を打ち込みました(ターミナルで開いているセッションなので)',{text:sentText.trim()}));return}
  if(r.error&&from==='new'&&closeIt)nsState('failed',t('✗ 起動できませんでした — {err}',{err:r.error})+(sentText&&giveBack?t('(依頼文は残してあります)'):''));
  if(r.error){toast(d,'✗ '+r.error);
    // an untrusted directory: say which are trusted, and offer to start it in a terminal
    if(runReq&&runReq.agent!=='codex'&&/Workspace not trusted|Not inside a trusted/.test(r.error)){
      const tr=(live.trusted||[]).slice(0,4).map(shortHome).join(' / ');
      toast(d,t('✗ {dir} はバックグラウンドで始められないフォルダです',{dir:shortHome(runReq.dir||'')})+(tr?t('。使えるのは {list} など',{list:tr}):'')+t('(一度そのフォルダで claude を開いて信頼すると使えます)'));
      if(native&&runReq.text){const t2=d.querySelector('.toast');if(t2){const req={...runReq};
        if(window.Terminal){const a=document.createElement('button');a.className='mini attachgo primary';a.textContent=t('ここで始める(信頼の確認はターミナルで)');
          a.onclick=()=>{a.disabled=true;a.textContent=startInPane(req)?t('下のターミナルで始めました'):t('始められませんでした')};t2.append(' ',a)}
        const b=document.createElement('button');b.className='mini attachgo';b.textContent=t('Ghostty で始める');
        b.onclick=()=>{post({type:'startterm',dir:req.dir,text:req.text,model:req.model||'',worktree:!!req.worktree});b.disabled=true;b.textContent=t('Ghostty で始めました')};t2.append(' ',b)}}
      return}
    if(r.saved&&r.attach&&native){const tw=d.querySelector('.toast');if(tw){const b=document.createElement('button');b.className='mini attachgo';b.textContent=t('端末で開いて届ける');
      // X is not running and `claude attach` needs a running session: resume it instead
      b.onclick=()=>{const c=(live.cards||[]).find(x=>x.id.startsWith(r.attach));openToDeliver(c,r.attach);
        b.disabled=true;b.textContent=t('端末で開きました')};tw.append(' ',b)}}
    return}
  toast(d,r.typed?t('▶ 端末({to})に打ち込みました — あなたが打ったのと同じ扱いです',{to:r.to||''})
    :r.relayed?(r.pending?t('▶ 動いているセッション({to})へ別セッション経由で渡しています。届かなかったときはカードに理由が出ます',{to:r.to||''}):t('▶ 動いているセッション({to})へ別セッション経由で届けました(承認としては扱われません)',{to:r.to||''}))
    :r.queued?(r.why==='whenfree'?t('今の作業が終わったら送ります(複数なら1件ずつ、送った順に)'):r.why==='ambiguous'?t('同じ名前のセッションが複数あるため直接は送れません({to})。預かって、止まった時点で送ります',{to:r.to||''})
      :r.why==='behind'?t('先に預かっている指示のあとに、送った順で届けます')
      :r.why==='interactive'?t('預かりました。ターミナルが閉じたら送ります')
      :r.why==='unknown'?t('預かりました(実行状況を確認できませんでした)。確認でき次第送ります')
      :t('預かりました。手が空いたら送ります'))
    :r.woke?t('▶ 起こして送りました'):runReq&&runReq.moved?t('▶ {dir} で起動しました(~ ではバックグラウンドで始められないため)',{dir:shortHome(runReq.moved)}):t('▶ 起動しました'));
  if(from&&from!=='new'&&!r.relayed){const tw=d.querySelector('.toast');if(tw)tw.append(' · '+t('⌘C で取り消し'))}
  // a new session: keep the panel and move it onto the session once the board reads it
  if(closeIt&&!r.error&&from==='new'){
    const agent=r.agent||(runReq&&runReq.agent)||'claude',sid=r.session||r.short||'';
    const where=runReq&&runReq.moved?t('{dir} で',{dir:shortHome(runReq.moved)}):'';
    const why=runReq&&runReq.moved?t('(~ ではバックグラウンドで始められないため)'):'';
    toast(d,'');
    if(sid){pendingNew={agent,id:r.session||'',short:sid.slice(0,8),at:Date.now()};
      nsState('waiting',t('▶ {where}起動しました{why}。セッションを起動しています… ボードに出たらそのパネルに移ります({id})',{where,why,id:sid.slice(0,8)}));
      if(!newArrived(live.cards)){
        // claude: open a stand-in now; the real card replaces it
        if(agent==='claude'&&runReq&&panelKey==='new'){const pc=provisionalCard(agent,sid.slice(0,8),r.session||'',runReq);
          pendingNew.prov=pc.agent+':'+pc.id;pendingNew.provCard=pc;openDetail(pc,false,focusFree($('#detail'))?undefined:{focus:false})}
        followNew()}}
    else if(agent==='codex'&&runReq&&runReq.dir){pendingNew={agent,id:'',short:'',dir:runReq.dir,since:runReq.at-2000,at:Date.now()};
      nsState('waiting',t('▶ 起動しました。セッションを起動しています… ボードに出たらそのパネルに移ります'));
      if(!newArrived(live.cards))followNew()}
    else nsState('noid',t('▶ {where}起動しました{why}。ただ {agent} がセッション id を返さなかったので、どのカードか分かりません。作業中の列に出たカードを開いてください',{where,why,agent})+(r.log?t('(ログ: {path})',{path:shortHome(r.log)}):''));
  }else if(closeIt&&!r.error&&r.session){pendingOpen=(r.agent||'claude')+':'+r.session;pendingOpenFrom=panelKey}
  setTimeout(load,1200);setTimeout(load,5000)};
// from: the session the send belongs to (default: the open panel's; a focus panel passes its own).
// own: the draft key whose box the words came from, kept aside until the answer; other sends pass none.
async function dispatch(m,d,from,own){
  const token=String(Date.now())+Math.random();pendingToasts.set(token,d);pendingFrom.set(token,from!==undefined?from:panelKey);
  if(own){pendingOwn.set(token,own);const cap=own===panelKey?draftCapture(own):null;draftSending(own,token,cap||{t:m.text||'',files:m.attachments||[]})}
  if(m.text)pendingTexts.set(token,m.text);
  if(m.type==='run')pendingRuns.set(token,{at:Date.now(),dir:m.dir,text:m.text,model:m.model,agent:m.agent,moved:m.moved||'',worktree:!!m.worktree});
  if(m.closeOnDone)pendingCloses.add(token);
  d.dataset.sending='1';
  // not the panel's message box: what you write next (a reply included) is typed while this goes; sending again is held back by
  // d.dataset.sending, and sendingDone merges what was typed with the answer (draftSettle)
  for(const t of d.querySelectorAll('textarea'))if(!t.closest('.msg'))t.disabled=true;
  toast(d,t('起動しています…'));
  const rb=d.querySelector('.run');if(rb)rb.disabled=true;
  // an answer that never comes must not leave the box locked for good
  setTimeout(()=>{if(pendingToasts.get(token)!==d)return;pendingToasts.delete(token);pendingTexts.delete(token);pendingCloses.delete(token);pendingRuns.delete(token);pendingFrom.delete(token);pendingOwn.delete(token);
    // unknown whether it went: the words come back, and the toast says to check the card
    if(own&&own===panelKey&&d===$('#mbody')){keepUnsent();const r=draftTake(own);sendingDone(d,r?r.e:null,own)}
    else sendingDone(d,'');toast(d,t('応答が遅れています。届いたかはカードで確かめてください'));
    if(m.closeOnDone&&panelKey==='new'&&d===$('#mbody'))nsState('late',t('起動の応答が90秒ありません。始まったかは作業中の列で確かめてください'));if(native)post({type:'log',text:'dispatch: no answer in 90s ('+m.type+')'})},90000);
  if(native){post({...m,token});return}
  try{const r=await fetch('api/'+m.type,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});window.__kanban.dispatched({...(await r.json()),token,card:m.card})}
  catch(e){window.__kanban.dispatched({error:String(e),token})}
}
