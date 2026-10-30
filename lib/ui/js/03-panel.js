// status line icons: 12px line drawings in the text colour
const MSTAT_SVG=d=>'<svg class="mico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>';
const MSTAT_ICON={
  folder:MSTAT_SVG('<path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.6 1.6h5.8a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/>'),
  clock:MSTAT_SVG('<circle cx="8" cy="8" r="6.25"/><path d="M8 4.6V8l2.4 1.5"/>'),
  ctx:MSTAT_SVG('<path d="M8 1.9 14.3 5.3 8 8.7 1.7 5.3z"/><path d="M1.7 8.3 8 11.7l6.3-3.4"/><path d="M1.7 11.1 8 14.5l6.3-3.4"/>'),
  total:MSTAT_SVG('<path d="M12.25 3H3.75l4.5 5-4.5 5h8.5"/>'),
  usd:MSTAT_SVG('<ellipse cx="8" cy="4.25" rx="5.25" ry="2"/><path d="M2.75 4.25v3.75c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2V4.25"/><path d="M2.75 8v3.75c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2V8"/>'),
};
// The context window, when known: Claude's transcript does not record it. A request past 200k
// implies the 1M window, as does [1m] in the model id; otherwise null (no invented denominator).
function ctxWindow(c,ctx){
  if(c&&c.usage&&c.usage.win)return c.usage.win;          // codex records its window
  if(/\[1m\]/i.test(String((c&&c.modelId)||'')+String((c&&c.model)||'')))return 1000000;
  return ctx>200000?1000000:null;
}
// the model picked in a session's send row, until reload (the pulldown is redrawn with the panel)
const modelPicked=new Map();
let wipPoll=0;
// A switch nobody asked for (no click or key just before): in the app's log with who did it, so the next one can be traced
let lastGesture=0;
document.addEventListener('mousedown',()=>{lastGesture=Date.now()},true);
document.addEventListener('keydown',()=>{lastGesture=Date.now()},true);
function autoSwitchLog(what){
  if(Date.now()-lastGesture<1500||!native)return;
  // V8 writes "at f (…)", WebKit (the app) "f@…"
  const at=((new Error().stack||'').split('\n').slice(1,6).map(l=>(l.match(/at (\S+)/)||l.match(/^([\w$.]+)@/)||[])[1]||'').filter(x=>x&&x!=='autoSwitchLog').slice(0,4).join(' < '));
  try{post({type:'log',text:'switched by itself: '+what+' ['+at+']'})}catch(e){}
}
function openDetail(c,keep,how){
  const key=c.agent+':'+c.id;
  if(openFor&&openFor!==key&&panelOpen())autoSwitchLog('panel '+openFor.slice(0,15)+' → '+key.slice(0,15));
  // a card newly opened shows the header's setting; how.view: one that needs its terminal now (an unpark)
  if(panelKey!==key)panelView=how&&how.view||panelPref();
  if(!keep&&panelKey!==key)keepUnsent();
  setTimeout(syncPanelBtns,0);
  setTimeout(()=>{if(typeof askPopSync==='function'&&live)askPopSync(live)},0);
  if(!keep){sel=key;for(const e of document.querySelectorAll('section.col .card'))e.classList.toggle('sel',e.dataset.agent+':'+e.dataset.id===key)}
  if(!keep&&panelKey!==key)delete $('#mbody').dataset.sending;
  if(!keep&&panelKey!==key)panelTermRelease(key);
  if(panelKey!==key)unreadOpened(c);
  panelKey=key;
  seenLater(key);
  openCard=c;openSig=cardSig(c);
  setTimeout(syncOpened,0);
  const h0=$('#mhist');
// a redraw keeps following within 40px of the bottom; once scrolled away, only at the bottom itself
  histStick=keep&&h0?(h0.scrollHeight-h0.clientHeight-h0.scrollTop<(histStick?40:8)):true;
  const prev=keep?detailPrev(h0):null;
  $('#mtitle').textContent=c.agent+' · '+short(c.project)+(c.subagent?t(' (サブエージェント)'):'');
  $('#detail').classList.add('sess');
  const sendable=convAgent(c);
  const rc=resumeCell(c);
  const parent=c.parentId?(live.cards||[]).find(x=>x.id===c.parentId&&x.agent===c.agent):null;
  const meta=detailMetaHtml(c,sendable,rc,parent);
  // 残作業 / 作ったもの sit in the header, flowing on after the status and the branch row (one or two lines, not four)
  $('#mbody').innerHTML='<div id="mmeta" class="sess'+(panelFold?' fold':'')+'">'+meta
    +'<div class="acts">'+detailPendBox(c)+'<details id="mmade" class="madebox" hidden></details>'+'</div></div>'
    +(c.stuck?'<div class="mnote stuck">⚠ '+esc(stuckText(c))+'</div>':'')
    +(c.bgReaped?'<div class="mnote bgreaped">'+esc(bgReapedText(c))+'</div>':'')
    +(c.provLate?'<div class="mnote stuck provlate">⚠ '+esc(c.provLate)+'</div>':'')
    +'<div class="hbar">'+(panelTermView(c)?'<div class="chips mviews" title="'+t('ターミナル: そのセッションの本物の画面(/コマンドも許可の確認もここで) · 会話: 読むための履歴')+'"><button data-p="term">'+t('ターミナル')+'</button><button data-p="talk">'+t('会話')+'</button></div><span class="kbdhint dim" title="'+t('ターミナル ⇄ 会話')+'">⌘\\</span><span class="sp"></span>':'')
    +'<div class="chips viewpick" title="'+t('表示する範囲')+'">'
    +'<button data-v="all">'+t('全部')+'</button>'
    +'<button data-v="last3" title="'+t('最後の3回のやり取りを開いて、それまでは指示だけ')+'">'+t('直前3つ')+'</button>'
    +'<button data-v="last" title="'+t('最後のやり取りを開いて、それまでは指示だけ')+'">'+t('直前のみ')+'</button></div></div>'
    +(panelTermView(c)?'<div id="mterm" class="mterm"></div>':'')
    +'<div id="mhist" class="hist"><div class="more">'+t('履歴を読み込み中…')+'</div></div>'
    +detailQueuedNote(c)
    +(sendable?detailSendBox(c,key):'');

// ターミナル / 会話 moves to the title row so it stays visible when the top is folded
  {const g=$('#mmeta .ttlrow .tctl'),mv=$('#mbody .hbar .mviews'),kh=$('#mbody .hbar .kbdhint');
   if(g&&mv){g.prepend(mv);if(kh)mv.after(kh)}
   // 全部 / 直前3つ / 直前のみ sit at the right end of the header's button row; the bar under it, left with nothing, goes
   const vp=$('#mbody .hbar .viewpick'),mm=$('#mmeta'),hb=$('#mbody .hbar');
   if(vp&&mm&&mm.appendChild){mm.appendChild(vp);if(hb)hb.classList.add('empty')}}
  mountPanelTerm(c,prev?prev.focus==='__term':!!(how&&how.focus));
  wirePendBox(c);
  if(sendable)wireSendBox(c,key);
  {const cb=$('#mcopy');if(cb)cb.onclick=()=>copyId(c)}
  wireDetailMeta(c,key,keep,parent);
  wireSendRow(c);
  wireTitleEdit(c,key);
  wireViewPick();
  wireDoneButtons(c);
  wireQueuedNote(c);
  if(prev)detailRestore(c,prev);
  replyChip();
  const dt=$('#detail');
  if(c.color)dt.dataset.color=c.color; else delete dt.dataset.color;
  dt.style.setProperty('--hue',autoHue(c));dt.classList.add('hued');
  dt.hidden=false;document.body.classList.add('withpanel');
  openFor=c.agent+':'+c.id;
  if(!keep)detailDraftBack(c,key,how);
  detailHistory(c,keep);
}
/** The copy icon in the panel's title row: the session id. */
function copyId(c){
  copyText(c.id);flash(t('セッションIDをコピーしました'));
  const b=$('#mcopy');if(b){b.classList.add('done');setTimeout(()=>b.classList.remove('done'),1500)}
}
function wireDetailMeta(c,key,keep,parent){
  const gtb=$('#mbody .mbtns .goterm');if(gtb)gtb.onclick=()=>goTerm(c);
  for(const a of document.querySelectorAll('#mbody .forkof, #mbody .forkkid'))a.onclick=e=>{e.preventDefault();const x=(live.cards||[]).find(y=>y.agent==='claude'&&y.id===a.dataset.id);if(x)openDetail(x)};
  wirePr(c);if(!keep)askPr(c);
  const ptb=$('#mbody .mbtns .ptygo');if(ptb)ptb.onclick=()=>{
    if(c.alive)openSession((c.aliveShort||c.id).slice(0,8),c);
    else ptyOpen('resume',{session:c.id,label:ptyLabel(c),cwd:c.project||''})};
  const cpb=$('#mbody .mbtns .compact');
  if(cpb)cpb.onclick=()=>{const t=$('#mbody .msg textarea');if(t){t.value='/compact';t.focus()}};
  for(const k of document.querySelectorAll('#mbody .kids .kid'))k.onclick=()=>{
    const kc=(live.cards||[]).find(x=>x.id===k.dataset.id&&x.agent===c.agent);if(kc)openDetail(kc)};
  const pb=$('#mparent');if(pb&&parent)pb.onclick=()=>openDetail(parent);
  const kd=$('#mmeta details.kids');if(kd)kd.ontoggle=()=>{if(kd.open)kidsOpen.add(key);else kidsOpen.delete(key)};
  const mx=$('#mclose2');if(mx)mx.onclick=()=>closeDetail('x');
  const mf=$('#mfold');if(mf)mf.onclick=()=>panelFoldSet(!panelFold);
}
// click the title to rename (Enter saves, Esc cancels, empty reverts to the generated one)
function wireTitleEdit(c,key){
  const cl=$('#clabel');
  if(cl&&!c.subagent)cl.onclick=()=>{
    if(cl.querySelector('input'))return;
    const inp=document.createElement('input');inp.className='ttledit';inp.value=c.titleMine?c.title:(c.title||'');inp.maxLength=80;
    cl.textContent='';cl.appendChild(inp);inp.focus();inp.select();
    const tk='title:'+key;inp.oninput=()=>draftSet(tk,{t:inp.value});
    const done=(save)=>{if(!inp.isConnected)return;draftSet(tk,{t:''});const v=inp.value.trim();
      if(save&&v!==(c.titleMine?c.title:'')){const m={type:'label',agent:c.agent,session:c.id,label:v,color:c.color||''};
        if(v){c.title=v;c.titleMine=true}else{c.titleMine=false}
        if(native)post(m);else fetch('api/label',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).catch(()=>{});
// Also /rename inside Claude, only possible when the session is open in the panel's terminal.
        const tp=c.agent==='claude'&&typeof panelPty==='function'&&panelPty(c);
        if(v&&tp&&!tp.gone){post({type:'ptyin',id:tp.id,data:'/rename '+v.replace(/[\r\n]+/g,' ')+'\r'});toast($('#mbody'),t('Claude 側の名前も /rename で変えました'))}
        else if(v&&c.agent==='claude')toast($('#mbody'),t('ボードの名前を変えました(Claude 側の名前は、ターミナルで開いているときに変えると揃います)'));
        setTimeout(load,600)}
      cl.innerHTML=ico(c)+esc(c.title||t('(題名なし)'))+(c.titleMine?'<span class="mine" title="'+t('あなたがつけた題名')+'">✎</span>':'');render()};
    inp.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();done(true)}else if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();done(false)}};
    inp.onblur=()=>done(true);
  };
}
function wirePendBox(c){
  {const pb=$('#mbody details.pendbox');if(pb)pb.ontoggle=()=>{pendOpenKey=pb.open?c.agent+':'+c.id:''}}
  const ps=$('#pscan');if(ps)ps.addEventListener('click',e=>e.preventDefault());
  if(ps)ps.onclick=()=>{ps.disabled=true;ps.textContent=t('棚卸し中…');
    const m={type:'wip',agent:c.agent,session:c.id};
    if(native)post(m); else fetch('api/wip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).then(r=>r.json()).then(j=>{if(j&&j.error){ps.disabled=false;ps.textContent=t('棚卸しする');toast($('#mbody'),'✗ '+j.error)}}).catch(()=>{ps.disabled=false});
    clearInterval(wipPoll);let n=0;const iv=wipPoll=setInterval(()=>{n++;load();
      const cc=(live.cards||[]).find(x=>x.agent===c.agent&&x.id===c.id);
      if(n>20||(cc&&cc.wip&&cc.wip.status!=='running'))clearInterval(iv)},3000)};
}
function wireDoneButtons(c){
  const dd=$('#dodone');
// 完了 only marks the card: it wakes no session
  if(dd)dd.onclick=()=>{dd.disabled=true;
    const memory=false;
    const m={type:'done',agent:c.agent,session:c.id,memory,dir:c.project};
    if(native)post(m); else fetch('api/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})
      .then(r=>r.json()).then(j=>{if(j&&j.error)toast($('#mbody'),'✗ '+j.error)}).catch(e=>toast($('#mbody'),'✗ '+e));
// stay open with 取り消す at hand instead of closing the panel
    laneLocalSet(c,'done');
    render();openDetail(c,true);toast($('#mbody'),memory?t('完了にしました。学びの保存を依頼しました'):t('完了にしました'));
    setTimeout(load,1500)};
// 待ち is the same record as 完了, in a lane of its own
  const pk=$('#dopark'),upk=$('#unpark');
  const parkSend=(m,then)=>{if(native)post(m); else fetch('api/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})
      .then(r=>r.json()).then(j=>{if(j&&j.error)toast($('#mbody'),'✗ '+j.error)}).catch(e=>toast($('#mbody'),'✗ '+e));then();setTimeout(load,1200)};
  // the card moves first, the record is written after: no wait on the app's answer
  if(pk)pk.onclick=()=>{pk.disabled=true;laneLocalSet(c,'park');render();openDetail(c,true);toast($('#mbody'),t('待ちにしました(Waiting に移動)'));
    parkSend({type:'done',agent:c.agent,session:c.id,park:true},()=>{})};
  if(upk)upk.onclick=()=>{upk.disabled=true;laneLocalSet(c,'undo');render();openDetail(c,true);toast($('#mbody'),t('待ちを外しました'));
    parkSend({type:'done',agent:c.agent,session:c.id,undo:true},()=>{})};
  const ud=$('#undone');
  if(ud)ud.onclick=()=>{ud.disabled=true;
    const m={type:'done',agent:c.agent,session:c.id,undo:true};
    if(native)post(m); else fetch('api/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})
      .then(r=>r.json()).then(j=>{if(j&&j.error)toast($('#mbody'),'✗ '+j.error)}).catch(e=>toast($('#mbody'),'✗ '+e));
    laneLocalSet(c,'undo');render();openDetail(c,true);toast($('#mbody'),t('完了を取り消しました'));setTimeout(load,1000)};
}
// a redraw (keep): conversation, toast, attachments, box and focus as they were
function detailRestore(c,prev){
// the old conversation until the fresh one arrives (no flash); rewired, or its buttons do nothing
  const h=$('#mhist');if(h&&prev.hist){h.innerHTML=prev.hist;if(prev.vsig!=null)h.dataset.vsig=prev.vsig;wireHist(h);wireAsk(c,h);h.scrollTop=prev.scroll}
  const tt=$('#mbody .toast');if(tt&&prev.toast)tt.textContent=prev.toast;
// the same nodes, not a copy: × handlers and in-flight upload paths point at these elements
  const at=$('#mbody .atts');
  if(at&&prev.attsNode&&prev.attsNode!==at&&prev.attsNode.children.length)at.replaceWith(prev.attsNode);
  const t=$('#mbody .msg textarea');if(t&&prev.text)t.value=prev.text;
  const el=prev.focus==='__msg'?t:(prev.focus?$('#'+prev.focus):null);
  if(el&&el.focus){el.focus();if(prev.caret!=null&&el.setSelectionRange)try{el.setSelectionRange(prev.caret,prev.caret)}catch(e){}}
}
// panel width: dragged on the left edge, remembered
const PANEL_MIN=280;
function setPanelWidth(w){
  const max=Math.max(PANEL_MIN,Math.round(window.innerWidth*0.9));
  w=Math.min(max,Math.max(PANEL_MIN,Math.round(w)));
  document.documentElement.style.setProperty('--panelw',w+'px');
  try{localStorage.setItem('panelw',String(w))}catch(e){}
  return w;
}
try{const w=+localStorage.getItem('panelw');if(w)setPanelWidth(w)}catch(e){}
function setListWidth(w){
  w=Math.max(240,Math.min(Math.max(240,Math.min(640,window.innerWidth-480)),Math.round(w)));
  document.documentElement.style.setProperty('--listw',w+'px');
  try{localStorage.setItem('listw',String(w))}catch(e){}
  return w;
}
try{const w=+localStorage.getItem('listw');if(w)setListWidth(w)}catch(e){}
(function(){
  const grip=$('#mgrip');if(!grip)return;
  let dragging=false;
  grip.addEventListener('mousedown',e=>{dragging=true;grip.classList.add('dragging');document.body.classList.add('resizing');e.preventDefault()});
// in リスト the grip is the list's right edge
  window.addEventListener('mousemove',e=>{if(dragging){if(listDocked())setListWidth(e.clientX);else setPanelWidth(window.innerWidth-e.clientX)}});
  window.addEventListener('mouseup',()=>{dragging=false;grip.classList.remove('dragging');document.body.classList.remove('resizing')});
// double click restores the default width
  grip.addEventListener('dblclick',()=>{const k=listDocked()?'listw':'panelw';document.documentElement.style.removeProperty('--'+k);try{localStorage.removeItem(k)}catch(e){}});
})();
// the header's folds float like menus (90-late.css): one open at a time, closed by a click outside or Esc
function hdrFoldsClose(except){let n=0;for(const d of document.querySelectorAll('#mmeta.sess details[open]'))if(d!==except){d.open=false;n++}return n}
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.matches&&d.matches('#mmeta.sess details')&&d.open)hdrFoldsClose(d)},true);
// the backdrop is the details' own ::before, so a click on it lands on the details: inside only if over its summary or its content
function hdrFoldHit(d,x,y){const pad=20;for(const k of d.children){const r=k.getBoundingClientRect();if(r.width&&x>=r.left-pad&&x<=r.right+pad&&y>=r.top-pad&&y<=r.bottom+pad)return true}return false}
document.addEventListener('mousedown',e=>{const d=e.target.closest&&e.target.closest('#mmeta.sess details[open]');
  if(!d||(e.target===d&&!hdrFoldHit(d,e.clientX,e.clientY))){if(hdrFoldsClose()&&d){e.preventDefault();e.stopPropagation()}}},true);
// Esc goes to whatever is above the fold first (a file viewer, ⌘K, a menu)
function hdrAbove(){return !!document.querySelector('#viewer:not([hidden]),#palette,.modemenu:not([hidden])')}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!hdrAbove()&&hdrFoldsClose()){e.preventDefault();e.stopImmediatePropagation()}},true);
