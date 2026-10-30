/**
 * 今の作業後に送る: a message for a busy session is held in the board's queue (lib/queue.js) and sent
 * when it is next idle, one per idle, in order. Delivery is the idle route (lib/board.js sendTo),
 * except a session in this app's own terminal, which the page types into itself (wfTick).
 */
const WF_STORE='whenfree';
let wfOn=new Set();
try{wfOn=new Set(JSON.parse(localStorage.getItem(WF_STORE)||'[]'))}catch(e){}
function wfIsOn(c){return !!c&&wfOn.has(c.agent+':'+c.id)}
function wfSet(c,on){
  const k=c.agent+':'+c.id;wfOn.delete(k);if(on)wfOn.add(k);
  try{localStorage.setItem(WF_STORE,JSON.stringify([...wfOn].slice(-300)))}catch(e){}
}
// the card as the last refresh has it: the panel is not redrawn while you type, so its own copy can be stale
function wfFresh(c){return (c&&(live.cards||[]).find(x=>x.agent===c.agent&&x.id===c.id))||c}
/** busy per `claude agents`, but not one whose turn is over and only background tasks run (lib/live.js) */
// codex has no `claude agents`: its card at work (a turn begun in its transcript and not ended) is busy
function wfBusy(c){c=wfFresh(c);return !!(c&&(c.alive?c.aliveStatus!=='idle'&&!c.background:c.agent==='codex'&&!c.subagent&&c.column==='working'))}
// drawn at once before the queue has them (wfLocal), removed at once when taken back (wfGone)
const wfLocal=new Map(),wfGone=new Set();
function wfHeldOf(c){
  const f=wfFresh(c);if(!f)return [];
  const real=(f.held||[]).filter(h=>!wfGone.has(h.key));
  const k=f.agent+':'+f.id;
// a local line goes once the queue has it, or after a while
  // compared composed (NFKC): a message that came back through the app's arguments was decomposed, and then never matched its own line
  const nt=s=>String(s||'').normalize('NFKC').trim();
  const loc=(wfLocal.get(k)||[]).filter(l=>Date.now()-l.at<30000&&!real.some(h=>nt(h.text)===nt(l.text)&&h.at>=l.at-5000));
  if(loc.length)wfLocal.set(k,loc);else wfLocal.delete(k);
  return [...real,...loc];
}
function wfSettled(key,r){if(r&&!r.queued)wfLocal.delete(key)}
/** held if busy, or if something is already held for it (it goes behind that) */
function wfHolds(c){const f=wfFresh(c);return wfBusy(f)||!!wfHeldOf(f).length||!!(f&&f.queuedPlain)}
// the app's own terminal runs it: claude --resume, or codex resume (its open TUI holds the thread, so a background send would be refused)
function wfOurs(c){if(typeof panelPty!=='function')return false;const p=panelPty(c);return !!(p&&!p.gone&&(p.kind==='resume'||p.kind==='codex'&&c&&c.agent==='codex'))}
function wfPost(m){
  if(native){post(m);return}
  fetch('api/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})
    .then(r=>r.json()).then(j=>{if(j&&j.error)toast($('#mbody'),'✗ '+j.error)}).catch(e=>toast($('#mbody'),'✗ '+e));
}

function wfChip(c){
  return '<button class="mini wfbtn toggle tflag'+(wfIsOn(c)?' on':'')+'" title="'+t('作業中のセッションには途中で渡さず、手が空いたら届けます(複数なら1件ずつ、送った順に)。セッションごとに覚えます · ⌥⏎ で1回だけ逆の送り方')+'">'+t('今の作業後に送る')+'</button>';
}
function wfSync(mb,c){
  const b=mb.querySelector('.wfbtn');if(!b)return;
  const on=wfIsOn(c);b.classList.toggle('on',on);
  const ta=mb.querySelector('.msg textarea'),fb=mb.querySelector('.forkbtn');
  if(ta&&!(fb&&fb.classList.contains('on'))){
    if(!ta.dataset.ph0)ta.dataset.ph0=ta.placeholder;
    ta.placeholder=on?t('今の作業後に送る — 作業中なら、手が空いてから1件ずつ届けます'):ta.dataset.ph0}
}
function wfWire(mb,c){
  const b=mb.querySelector('.wfbtn');if(!b)return;
  b.onclick=()=>{wfSet(c,!wfIsOn(c));wfSync(mb,c);const t=mb.querySelector('.msg textarea');if(t)t.focus()};
  wfSync(mb,c);
}

/** the answer and the next refresh replace the line drawn here */
function wfSend(c,mb,m){
  dispatch({type:'reply',agent:c.agent,session:c.id,text:m.text,model:m.model,attachments:m.files,dir:c.project,typeInto:native,whenFree:true,ours:wfOurs(c)},mb,undefined,m.own);
  const k=c.agent+':'+c.id;
  wfLocal.set(k,[...(wfLocal.get(k)||[]),{key:'local-'+Date.now()+Math.random().toString(36).slice(2,6),text:String(m.text||'').trim(),at:Date.now(),local:true}]);   // trimmed as the queue stores it, or the line drawn here is never matched
  wfDraw(c);setTimeout(load,1500);
}

function heldSig(c){if(!c)return '';const f=wfFresh(c);return wfHeldOf(f).map(h=>h.key+(h.gated?'g':'')+(h.fails||'')).join(',')+'|'+((f&&f.aliveStatus)||'')+'|'+(f&&f.heldEst?Math.round(f.heldEst.ms/60000):'')}
function heldHtml(c){
  if(!c)return '';c=wfFresh(c);
  const hs=wfHeldOf(c);if(!hs.length)return '';
  return '<div class="heldq" data-sig="'+esc(heldSig(c))+'">'+hs.map((h,n)=>{
    const when=h.at?clock(h.at):'';
    return '<div class="turn user held" data-key="'+esc(h.key)+'"><span class="who"><span class="peer wf" title="'+t('作業中なので途中では渡さず、手が空いたら届けます')+'">'+t('今の作業後に送る')+(hs.length>1?' '+(n+1)+'/'+hs.length:'')+'</span></span><span class="when">'+esc(when)+'</span>'
      +'<div class="htext">'+linkify(esc(h.text||''))+'</div>'
      +(h.fails?'<div class="qerr">'+esc(h.error||t('送れませんでした'))+'</div>':'')
      +'<div class="hacts">'+etaTaskChip(c.heldEst)
      +'<button class="mini hedit" title="'+t('送る前に書き直します(順番はそのまま)')+'">'+t('編集')+'</button><button class="mini hnow" title="'+t('待たずに、いまの送り方で送ります(作業中なら途中で渡します)')+'">'+t('今すぐ送る')+'</button><button class="mini hcancel">'+t('取り消す')+'</button></div></div>'}).join('')+'</div>';
}
// a held message being rewritten: the block is not redrawn under the box
const wfEditing=new Set();
function wfEdit(tu,c,h){
  wfEditing.add(h.key);
  const tx=tu.querySelector('.htext');if(!tx)return;
  tx.outerHTML='<textarea class="hbox" rows="3" spellcheck="false">'+esc(h.text||'')+'</textarea>';
  const a=tu.querySelector('.hacts');if(a)a.innerHTML='<button class="mini hsave" title="'+t('Enter で保存(改行は ⇧Enter)')+'">'+t('保存')+' <span class="kk">⏎</span></button><button class="mini hkeep" title="'+t('Esc でやめる')+'">'+t('やめる')+' <span class="kk">esc</span></button>';
  const box=tu.querySelector('textarea.hbox');if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length);
    box.onkeydown=e=>{e.stopPropagation();const ime=e.isComposing||e.keyCode===229;if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&!e.shiftKey&&!e.altKey){   // Enter saves, as the message box sends; ⇧Enter is a new line
e.preventDefault();tu.querySelector('.hsave').click()}else if(e.key==='Escape'&&!ime){e.preventDefault();tu.querySelector('.hkeep').click()}}}
}
/** only the held block, redrawn in place */
function wfDraw(c){
  const el=$('#mhist');if(!el||!openCard||openCard.agent!==c.agent||openCard.id!==c.id)return;
  const old=el.querySelector('.heldq'),html=heldHtml(c);
  if(old){if(old.dataset.sig===heldSig(c))return;if([...wfEditing].some(k=>old.querySelector('[data-key="'+k+'"] textarea.hbox')))return;if(html)old.outerHTML=html;else old.remove()}
  else if(html)el.insertAdjacentHTML('beforeend',html);
  if(html){histStick=true;stickBottom(el)}
}
// capture: the thread folds on a plain click, and these are buttons
document.addEventListener('click',e=>{
  const b=e.target&&e.target.closest&&e.target.closest('#mhist .heldq button');if(!b)return;
  e.stopPropagation();e.preventDefault();
  const tu=b.closest('.turn.held'),c=openCard;if(!tu||!c)return;
  const h=wfHeldOf(c).find(x=>x.key===tu.dataset.key);
  if(!h||h.local){toast($('#mbody'),t('まだ預けているところです。少し待ってからもう一度'));return}
  const gone=()=>{wfGone.add(h.key);wfDraw(c);setTimeout(load,1000)};
  if(b.classList.contains('hedit')){wfEdit(tu,c,h);return}
  if(b.classList.contains('hsave')){const v=(tu.querySelector('textarea.hbox')||{}).value||'';if(!v.trim()){toast($('#mbody'),t('空にはできません。やめるなら 取り消す'));return}
    wfPost({type:'queue',agent:c.agent,session:c.id,edit:true,key:h.key,text:v});h.text=v;wfEditing.delete(h.key);tu.closest('.heldq').dataset.sig='';wfDraw(c);toast($('#mbody'),t('書き直しました'));setTimeout(load,800);return}
  if(b.classList.contains('hkeep')){wfEditing.delete(h.key);tu.closest('.heldq').dataset.sig='';wfDraw(c);return}
  if(b.classList.contains('hcancel')){wfPost({type:'queue',agent:c.agent,session:c.id,cancel:true,key:h.key});gone();toast($('#mbody'),t('今の作業後に送る を取り消しました'));return}
// 今すぐ: typed into our own terminal when it runs there, else the ordinary send (lib/board.js sendHeldNow)
  if(h.ours&&wfOurs(c)){wfPost({type:'queue',agent:c.agent,session:c.id,cancel:true,key:h.key});if(!panelTypeMsg(c,h.text))toast($('#mbody'),t('ターミナルに打ち込めませんでした'));gone();return}
  wfPost({type:'queue',agent:c.agent,session:c.id,now:true,key:h.key,typeInto:native});gone();toast($('#mbody'),t('▶ 今すぐ送りました'));
},true);

// For a session in our own terminal: typed in oldest first once idle and ungated (lib/queue.js), marked
// `delivered` as it is typed so the next one waits for the next idle.
const wfTyping=new Set();
function wfTick(s){
  if(openCard)wfDraw(openCard);
  if(!native||typeof panelPty!=='function')return;
  for(const c of (s&&s.cards)||[]){
    const h=(c.held||[])[0];
    if(!h||!h.ours||h.gated||h.fails||wfTyping.has(h.key))continue;
    if(!(c.alive||c.agent==='codex')||wfBusy(c))continue;
    const p=panelPty(c);if(!p||p.gone||!(p.kind==='resume'||p.kind==='codex'&&c.agent==='codex')||!p.started)continue;
    wfTyping.add(h.key);
    ptyWhenReady(p,q=>{
// a question on screen comes first: a line typed now would answer it
      if(ptyAsking(q)){wfTyping.delete(h.key);return}
      wfPost({type:'queue',agent:c.agent,session:c.id,cancel:true,key:h.key,delivered:true});
      ptyTypeEnter(q,h.text);
      setTimeout(load,1500);
    },300,()=>wfTyping.delete(h.key));   // not ready this time: tried again on a later refresh
  }
}
