// 待ちにする / 完了 / 戻す, shown at once: the card the board holds now is changed (a panel's own copy may be an
// older refresh's, and changing that moved nothing until the next read), and a refresh read before the record
// was written does not move it back (kept until the state agrees, at most 10 s)
const laneLocal=new Map();     // agent:id → {kind:'park'|'done'|'undo', at}
function laneLocalSet(c,kind){
  laneLocal.set(c.agent+':'+c.id,{kind,at:Date.now()});
  for(const x of [c,(live.cards||[]).find(y=>y.agent===c.agent&&y.id===c.id)])if(x)laneApply(x,kind);
}
function laneApply(x,kind){
  if(kind==='park'){x.parked=x.parked||{at:Date.now()};x.done=null;x.column='stale'}
  else if(kind==='done'){x.done=x.done||{at:Date.now(),wrapup:'none'};x.parked=null;x.column='done'}
  else{x.done=null;x.parked=null;if(x.column==='stale'||x.column==='done')x.column='answered'}
}
function laneOverlay(cards){
  for(const [k,v] of laneLocal){
    const x=(cards||[]).find(y=>y.agent+':'+y.id===k);
    const agrees=x&&(v.kind==='park'?!!x.parked:v.kind==='done'?!!x.done:!x.parked&&!x.done);
    if(!x||agrees||Date.now()-v.at>10000){laneLocal.delete(k);continue}
    laneApply(x,v.kind);
  }
}
// Your Turn's order within each kind: the one waiting longest first (default), or the newest first; kept per viewer
let yourOrder=(()=>{try{return localStorage.getItem('yourorder')==='new'?'new':'old'}catch(e){return 'old'}})();
function yourOrderSet(v){yourOrder=v==='new'?'new':'old';try{localStorage.setItem('yourorder',yourOrder)}catch(e){}yourOrderPaint();if(typeof render==='function')render()}
function yourOrderPaint(){const b=$('#yourorder');if(!b)return;
  b.textContent=yourOrder==='new'?'新しい順':'古い順';
  b.title='Your Turn の並び: '+(yourOrder==='new'?'最後に動いたのが新しいものが上':'待たせている時間が長いものが上')+'(押すと切り替え。許可・質問で止まっているものはどちらでも先頭)';
  b.onclick=e=>{e.stopPropagation();yourOrderSet(yourOrder==='new'?'old':'new')}}
// blocked first (it cannot move without you), then answered; within each, as yourOrder says
// "waiting for your reply" is a session idle at its prompt: that is your turn like a finished answer, not a block
function yourBlocked(c){return c.column==='approval'||/^(asked you a question|waiting for (?!your reply))/.test(c.reason||'')}
function yourSort(cards){
  const rank=c=>yourBlocked(c)?0:1;
  return (cards||[]).filter(c=>['needs-you','approval','answered'].includes(c.column)).sort((x,y)=>rank(x)-rank(y)||(yourOrder==='new'?(y.lastT||0)-(x.lastT||0):(x.lastT||0)-(y.lastT||0)));
}
function laneMovable(c){return convAgent(c)&&!c.subagent&&!c.headless}
// dropped on a lane: Waiting parks it, Completed closes it, Your Turn / Working takes either mark off
function laneMove(c,col){
  const m={type:'done',agent:c.agent,session:c.id,dir:c.project};
  if(col==='stale'){if(c.parked&&c.column==='stale')return;m.park=true;laneLocalSet(c,'park')}
  else if(col==='done'){if(c.done)return;m.memory=false;laneLocalSet(c,'done')}
  else{if(!c.done&&!c.parked)return;m.undo=true;laneLocalSet(c,'undo')}
  if(native)post(m); else fetch('api/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).then(r=>r.json()).then(j=>{if(j&&j.error)toast(document.body,'✗ '+j.error)}).catch(()=>0);
  render();if(openCard&&openCard.id===c.id)openDetail(c,true);
  toast($('#mbody')||document.body,col==='stale'?'待ちにしました':col==='done'?'完了にしました':'元のレーンに戻しました');
  setTimeout(load,1200);
}
function laneDropSetup(){
  const targets=[...document.querySelectorAll('section.col[data-col]')].map(s=>[s,s.dataset.col]);
  const sd=$('#showdone');if(sd)targets.push([sd,'done']);
  for(const [el,col] of targets){
    el.addEventListener('dragover',e=>{if(![...e.dataTransfer.types].includes('text/x-akcard'))return;e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('dropon')});
    el.addEventListener('dragleave',e=>{if(!el.contains(e.relatedTarget))el.classList.remove('dropon')});
    el.addEventListener('drop',e=>{const k=e.dataTransfer.getData('text/x-akcard');el.classList.remove('dropon');if(!k)return;e.preventDefault();
      const c=(live.cards||[]).find(x=>x.agent+':'+x.id===k);if(c)laneMove(c,col)});
  }
}
// A press on a card holds the list still until it is released: the board redraws every refresh (every second or two),
// and a card replaced between mouse-down and mouse-up gets no click — the panel did not switch to it
let boardPress=false,renderHeld=false;
document.addEventListener('mousedown',e=>{if(e.button===0&&e.target.closest&&e.target.closest('section.col .card'))boardPress=true},true);
const boardRelease=()=>{if(!boardPress)return;boardPress=false;if(renderHeld){renderHeld=false;setTimeout(render,0)}};
document.addEventListener('mouseup',boardRelease,true);document.addEventListener('dragend',boardRelease,true);   // a drag ends without a mouseup
window.addEventListener('blur',()=>{if(boardPress){boardPress=false;if(renderHeld){renderHeld=false;render()}}});
function render(){
  if(!gotState)return;                       // the placeholders stay until there is something to show
  if(boardPress){renderHeld=true;return}
  const flipFrom=renderedOnce?cardRects():null;
  renderLanes();
  syncOpened();
  renderedOnce=true;
  flipPlay(flipFrom);
  listKeep();
  renderDempty();
}
// the panel's place on a wide board while nothing is open; its buttons press the header's own
function renderDempty(){
  const box=$('#dempty');if(!box)return;
  const you=(live.cards||[]).filter(c=>YOU.has(c.column)&&!c.subagent&&!c.headless).length;
  const pend=(($('#pendn')||{}).textContent||'').trim();
  const html='<b>カードを選ぶとここに会話が出ます</b>'
    +'<span>'+(you?'Your Turn に <b>'+you+'</b> 件あります':'Your Turn は空です')+'</span>'
    +'<div class="drow">'+(you?'<button class="mini primary" data-go="top">Your Turn の先頭を開く</button>':'')
    +'<button class="mini" data-go="new">＋ 新規 <kbd>n</kbd></button>'
    +'<button class="mini" data-go="pending">残作業 '+esc(pend&&pend!=='–'?pend:'–')+' <kbd>p</kbd></button></div>'
    +'<span><kbd>↑↓</kbd> で選んで <kbd>Space</kbd> / <kbd>Enter</kbd> で開く</span>';
// redrawn only on change, so a refresh does not take a hovered button away
  if(box.dataset.sig===html)return;box.dataset.sig=html;box.innerHTML=html;
  for(const b of box.querySelectorAll('button[data-go]'))b.onclick=()=>{
    const k=b.dataset.go;
    if(k==='top'){const el=$('[data-col="needs-you"] .card');if(el){selectEl(el);openSelected({focus:false})}return}
    const hb=$(PANEL_BTN[k]);if(hb)hb.click()};
}
function renderLanes(){
// running subagents per parent: the parent card says so even while subagent cards are hidden
  const {kidRun,kidDone,nestedKid}=kidsPlan(live.cards||[]);
  dupTitles=new Map();for(const x of live.cards||[]){if(x.subagent||x.headless)continue;const t=x.title||short(x.project);if(!dupTitles.has(t))dupTitles.set(t,[]);dupTitles.get(t).push(x)}
  const showSubs=$('#subs').classList.contains('on');
  const shownAll=(live.cards||[]).filter(c=>showSubs||(!c.subagent&&!c.headless));
  const q=(($('#q')||{}).value||'').trim();
  const pq=parseQuery(q);
  const hit=c=>matchQuery(pq,c);
// a filter must reach the lanes hidden by default
  document.body.classList.toggle('searching',!!q);
// Lanes answer whose move it is: permission, question and finished answer are all yours.
  const LANES={'needs-you':['needs-you','approval','answered'],working:['working'],stale:['stale'],done:['done','idle']};
  for(const col of Object.keys(LANES)){
    const el=$('[data-col="'+col+'"] .list');el.innerHTML='';
    const inCol=c=>LANES[col].includes(c.column);
// hidden by default: subagents and headless runs; a subagent shows only under its parent unless 自動実行 is on
    let cs=live.cards.filter(c=>inCol(c)&&(showSubs||(!c.subagent&&!c.headless))&&hit(c)&&!nestedKid(c));
// oldest first: the one waiting longest is next
    if(col==='needs-you')cs=yourSort(cs);
    $('[data-col="'+col+'"] .n').textContent=cs.length;
    if(col==='needs-you'&&!cs.length){
      const vis=c=>(showSubs||(!c.subagent&&!c.headless))&&hit(c);
      const nWork=live.cards.filter(c=>c.column==='working'&&vis(c)).length,nWait=live.cards.filter(c=>c.column==='stale'&&vis(c)).length;
      const line=nWork?'Your Turn は空です。エージェントが '+nWork+' 本働いています。'
        :nWait?'Your Turn は空です。Waiting に '+nWait+' 件、手が止まったままのものがあります。'
        :'動いているエージェントもありません。今日はここまで。';
      el.innerHTML='<div class="yay"><div class="burst" aria-hidden="true"><i>'+(nWork?'🎉':nWait?'☕':'🌙')+'</i><i>✨</i><i>'+(nWork?'🎊':'💤')+'</i></div><b>'+(nWork||nWait?'All caught up!':'All quiet.')+'</b><span>'+line+'</span>'
        +'<button class="mini yaynew">＋ 新規セッション <span class="kk">'+esc(kmL('new.meta'))+'</span></button></div>';
      el.querySelector('.yaynew').onclick=e=>{e.stopPropagation();toggleNew('empty-lane button')};continue}
    if(col==='done')$('#donen').textContent=' '+cs.length;

    for(const c of cs.slice(0,col==='done'?1000:200)){
      const d=document.createElement('div');d.className='card '+col+((c.subagent||c.headless)?' sub':'')+(unreadShown(c)?' unread':'');d.dataset.agent=c.agent;d.dataset.id=c.id;if(c.color)d.dataset.color=c.color;
      if(laneMovable(c)){d.draggable=true;d.ondragstart=e=>{e.dataTransfer.setData('text/x-akcard',c.agent+':'+c.id);e.dataTransfer.effectAllowed='move';document.body.classList.add('dragging')};
        d.ondragend=()=>{document.body.classList.remove('dragging');for(const x of document.querySelectorAll('.dropon'))x.classList.remove('dropon')}}
      {const prevEl=el.lastElementChild;const above=prevEl&&prevEl.dataset.hue!=null?+prevEl.dataset.hue:null;const hu=autoHue(c,above);d.style.setProperty('--hue',hu);d.dataset.hue=hu}
      const kind=col!=='needs-you'?'':yourBlocked(c)?'<span class="kind k-block">'+(/^asked you a question/.test(c.reason||'')?'質問':'許可')+'</span>':c.column==='answered'?'<span class="kind k-ans">返答</span>':'';
// with the 許可/質問 chip in front, the reason says only what is asked
      let whyR=reasonJa(c);if(kind)whyR=whyR.replace(/^(許可待ち|質問): /,'');
      let why=shortWhy(c,whyR);
/** How many messages wait for this card (今の作業後に送る and plain held ones). */
function heldN(c){return Math.max((c.held||[]).length,c.queued?1:0)}
// Your Turn gets whole cards; the other lanes one line each. Optional fields: cshow (00-core.js).
      if(col!=='needs-you'){
        d.classList.add('compact');let cm;
        d.innerHTML='<div class="cline"><span class="cdot"></span><span class="ct" title="'+esc((c.title||short(c.project))+' · '+c.agent+' · '+short(c.project))+'">'+ico(c)+esc(c.title||short(c.project))+dupTag(c)+'</span>'
          +(c.stuck?'<span class="stk" title="'+esc(stuckText(c))+'">⚠</span>':'')
          +(c.bgReaped?'<span class="bgreaped" title="'+esc(bgReapedText(c))+'">⏹</span>':'')
          +(cshow('idle')?'<span class="idle" data-t="'+(c.lastT||0)+'">'+ago(c.idleS)+'前</span>':'')+'</div>'
// the chips get their own line under the title, so the title keeps the width
          +(cm=[unreadChip(c),(c.queued?'<span class="cq'+(c.queuedFails?' bad':'')+'" title="'+esc(c.queued)+'">'+(c.queuedFails?'✉ 送信失敗':'✉ 送信待ち '+heldN(c)+(c.queuedRetry?' · 再送待ち':''))+'</span>':''),
            bgNote(c),
            ...orderedChips(c),etaChip(c)].filter(Boolean).join(''),cm?'<div class="cmeta">'+cm+'</div>':'')
          +(convo&&convo.hits[c.agent+':'+c.id]?'<div class="found">会話: '+esc(convo.hits[c.agent+':'+c.id])+'</div>':'')
// Waiting: the auto-written line of what it was on and waits for; else its last words
          +(col==='stale'&&(c.waitingLine||c.doingLine)?'<div class="cwait" title="このセッションがいま何で止まっているか(自動の要約)">'+esc(c.waitingLine||c.doingLine)+'</div>':'')
          +(cshow('last')?lastLine(c):'')
          +(col==='working'&&(c.lastTool||c.turnTools)?'<div class="cact"><span class="spin">⠋</span><b>'+esc(c.lastTool||'')+'</b>'+(c.turnTarget?'<span class="tgt" title="'+esc(c.turnTarget)+'">'+esc(c.turnTarget)+'</span>':'')+(c.turnTools?'<i title="あなたの最後の指示から、このセッションが実行したツールの数">'+c.turnTools+'回</i>':'')+'</div>':'');
      } else
      {
// meta that is the same on every card (claude, the usual model, a normal context) is left off
        const meta=[];
        {const uc=unreadChip(c);if(uc)meta.push(uc)}
        if(cshow('proj'))meta.push('<span class="proj" title="'+esc(c.project)+'">'+esc(short(c.project))+'</span>');
        if(cshow('agent')&&c.agent!=='claude')meta.push('<span class="agent">'+esc(c.agent)+'</span>');
        if(cshow('model')&&c.model&&!usualModel(c))meta.push('<span class="model" title="'+esc(c.modelId||c.model)+'">'+esc(modelLabel(c.model,c.modelId))+'</span>');
// a context past 400k is a warning, shown whatever is chosen; it takes ctx's place in the order either way
        const ctxHtml=c.usage&&(c.usage.ctx>=400000||cshow('ctx')&&c.usage.ctx)?'<span class="ctx'+(c.usage.ctx>=900000?' bad':c.usage.ctx>=400000?' warn':'')+'" title="このセッションが今送っている文脈の大きさ(直近のリクエスト)">'+tok(c.usage.ctx)+'</span>':'';
        meta.push(...orderedChips(c,{ctx:ctxHtml}));
        {const ec=etaChip(c);if(ec)meta.push(ec)}
        {const bn=bgNote(c);if(bn)meta.push(bn)}
        d.innerHTML='<div class="top"><span class="ttl" title="'+esc(c.title||c.project||'')+'">'+ico(c)+esc(c.title||short(c.project))+dupTag(c)+'</span>'+(cshow('idle')?'<span class="idle" data-t="'+(c.lastT||0)+'">'+ago(c.idleS)+'前</span>':'')+'</div>'
        +'<div class="meta">'+meta.join('<i>·</i>')+(why||kind?'<span class="why" title="'+esc(reasonJa(c).replace(/<[^>]*>/g,''))+'">'+kind+why+'</span>':'')+'</div>'
        +(kind&&/許可/.test(kind)&&c.asking&&c.asking.what?'<code class="askwhat">'+esc(c.asking.what.slice(0,90))+'</code>':'')
        +(c.outDelta?'<div class="delta">+'+tok(c.outDelta)+' 出力</div>':'')
        +pendLine(c)
        +(c.stuck?'<div class="stuck">⚠ '+esc(stuckText(c))+'</div>':'')
        +(c.bgReaped?'<div class="bgreaped">'+esc(bgReapedText(c))+'</div>':'')
        +(c.queued?'<div class="queued'+(c.queuedFails?' bad':'')+'">'+(c.queuedFails?'送信失敗: ':'送信待ち '+heldN(c)+'件'+(c.queuedRetry?'(再送待ち)':'')+': ')+esc(c.queued.slice(0,60))+'</div>':'')
        +(cshow('last')?lastLine(c):'')
        +(convo&&convo.hits[c.agent+':'+c.id]?'<div class="found">会話: '+esc(convo.hits[c.agent+':'+c.id])+'</div>':'');
      }
// No id or resume command on the card: copying resume off a live card forks the conversation (see resumeCell).
      const kr=(kidRun.get(c.id)||[]).slice().sort((x,y)=>(y.lastT||0)-(x.lastT||0));
      if(kr.length){const nest=document.createElement('div');nest.className='nest';
        for(const k of kr.slice(0,5)){const r=document.createElement('div');r.className='nk';r.title='サブエージェント: '+(k.title||k.agentType||'');
          r.innerHTML='<span class="nb">↳</span><span class="nt">'+esc(k.title||k.agentType||'サブエージェント')+'</span>'+(k.lastTool?'<b>'+esc(k.lastTool)+'</b>':'')+'<span class="idle" data-t="'+(k.lastT||0)+'">'+ago(k.idleS)+'前</span>';
          r.onclick=e=>{e.stopPropagation();openDetail(k,false,{focus:false})};nest.appendChild(r)}
        if(kr.length>5){const r=document.createElement('div');r.className='nk more';r.textContent='ほか '+(kr.length-5)+' 本';nest.appendChild(r)}
        d.appendChild(nest)}
      const kd=kidDone.get(c.id)||[];
      if(kd.length){const r=document.createElement('div');r.className='nk kdone';r.title='終わったサブエージェントの結果はパネルで見られます';
        r.innerHTML='<span class="nb">✓</span><span class="nt">サブエージェント '+kd.length+' 本の結果</span>';
        d.appendChild(r)}   // only a note: no button of its own, a click is the card's
      d.tabIndex=0;d.setAttribute('role','button');d.setAttribute('aria-label',(c.title||short(c.project))+(unreadShown(c)?'(未読)':'')+' の詳細');
// click selects and opens the panel while the board keeps the keys; clicking the open card closes it;
// double click goes into the message box
      d.onclick=(e)=>{if(e.target.closest('input,button,textarea,select,a'))return;
        // a drag-selection ending on a <code> snippet (the resume id, 許可 の内容) is a copy, not a click
        const s=window.getSelection&&window.getSelection();if(e.target.closest('code')&&s&&!s.isCollapsed&&String(s))return;
        if(e.detail<2&&panelOpen()&&openFor===c.agent+':'+c.id){closeDetail('toggle');d.focus({preventScroll:true});return}
        selectEl(d);if(!panelOpen()||openFor!==sel)openSelected({focus:false});d.focus({preventScroll:true})};
      d.ondblclick=(e)=>{if(e.target.closest('input,button,textarea,select,a'))return;openDetail(c)};
      d.onfocus=()=>{for(const o of document.querySelectorAll('.card.sel'))o.classList.remove('sel');d.classList.add('sel');sel=c.agent+':'+c.id};
      el.appendChild(d);
    }
  }
  if(sel){const el=document.querySelector('section.col .card[data-id="'+CSS.escape(sel.split(':').slice(1).join(':'))+'"]');if(el)el.classList.add('sel');else sel=null}
  const box=$('#empty');
  if(box){
    const visible=[...document.querySelectorAll('section.col .card')].length;
    const total=(live.cards||[]).length;
    let msg='';
    const noAgents=(live.agents||[]).length&&!(live.agents||[]).some(x=>x.installed);
    if(noAgents)msg='<b>claude / codex が見つかりません。</b>PATH(~/.local/bin, /opt/homebrew/bin, /usr/local/bin)にあるか確認してください。ボードはインストール済みのエージェントの記録だけを読みます。';
    else if(!total)msg='<b>この範囲にセッションがありません。</b>表示範囲(時間)を広げるか、＋新規セッション で始められます。';
    else if(!shownAll.length)msg='<b>あなたのセッションはありません。</b>'+total+'件はすべてサブエージェントか自動実行です — 「自動実行も表示」で出ます。';
    else if(!visible&&q)msg='<b>「'+esc(q)+'」に一致するカードはありません。</b>Escape で絞り込みを解除します。';
    else if(!visible)msg='<b>表示するカードがありません。</b>「終わったもの」を押すと、完了にしたものや自動実行も出ます。';
    box.innerHTML=msg;box.hidden=!msg;
  }
}


yourOrderPaint();
