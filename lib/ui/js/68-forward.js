// ↪ 別のセッションへ: a message sent to the wrong session goes on to the right one. Picked from a list (the last place you
// passed one to first, so a run of them goes quickly), sent there the board's usual way; the session it came from gets
// one short word not to act on it — or, still held there (送信待ち), it is taken back and never reaches it.
// (11-07: three messages for a game went to the monitoring session, and it was asked to pass them on by hand.)
const FWD_NOTE_GAP_MS=3*60*1000;
const fwdNoted=new Map();   // origin key → when it was last told
let fwdEl=null;
function fwdLast(){try{return localStorage.getItem('fwdlast')||''}catch(e){return ''}}
function fwdNoteOn(){try{return localStorage.getItem('fwdnote')!=='0'}catch(e){return true}}
/** The words of one of your messages in a session's conversation (the reply header it carried left out). */
function fwdTextOf(key,at){
  const tu=(typeof panelTurns==='function'?panelTurns(key):[]).filter(x=>x.kind==='user'&&!x.cmd&&(x.t||0)===at).pop();
  if(!tu)return '';
  const rp=replyParse(tu.text||'');
  return String(rp?rp.rest:(tu.text||'')).trim();
}
/** Where it can go: every session on the board but this one and subagents; the last one passed to first, then the newest. */
function fwdTargets(cards,from,q){
  const last=fwdLast();
  let list=(cards||[]).filter(c=>!c.subagent&&!c.headless&&c.agent+':'+c.id!==from&&(c.agent==='claude'||c.agent==='codex'||c.agent==='antigravity'));
  list.sort((a,b)=>((b.agent+':'+b.id===last)-(a.agent+':'+a.id===last))||(b.lastT||0)-(a.lastT||0));
  const w=String(q||'').trim();
  if(w)list=list.map(c=>({c,s:fuzzy(w,(c.title||'')+' '+short(c.project)+' '+((c.last&&c.last.human)||'').slice(0,120))})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.c);
  return list.slice(0,40);
}
function fwdClose(){if(!fwdEl)return;const back=fwdEl._back;fwdEl.remove();fwdEl=null;if(back&&document.contains(back)&&back.focus)try{back.focus({preventScroll:true})}catch(e){}}
/**
 * Open the list. from: 'agent:id' it was sent to; o: {text} or {t: the turn's time}, and {key} (a held 今の作業後に送る)
 * or {plain:true} (the held 送信待ち) when it has not gone yet.
 */
function fwdStart(from,o){
  fwdClose();
  const text=String(o&&o.text||fwdTextOf(from,o&&o.t)||'').trim();
  if(!text){toast($('#mbody')||document.body,t('渡す文が見つかりません(表示し直してから押してください)'));return}
  const held=!!(o&&(o.key||o.plain));
  const el=document.createElement('div');el.id='fwd';el.setAttribute('role','dialog');el._back=document.activeElement;
  el.innerHTML='<div class="fwc"><div class="fwh"><b>'+esc(t('別のセッションへ渡す'))+'</b><span class="dim">'+esc(held?t('送信待ちのうちなので、元のセッションには届きません'):t('元のセッションにも届いています'))+'</span></div>'
    +'<pre class="fwt">'+esc(text.length>300?text.slice(0,300)+'…':text)+'</pre>'
    +'<input class="fwq" spellcheck="false" autocomplete="off" placeholder="'+esc(t('渡し先を検索'))+'">'
    +'<div class="fwl" role="listbox"></div>'
    +(held?'':'<label class="fwn"><input type="checkbox"'+(fwdNoteOn()?' checked':'')+'> '+esc(t('元のセッションに「これは別のセッション宛てでした。対応しないでください」と伝える'))+'</label>')
    +'</div>';
  document.body.appendChild(el);fwdEl=el;
  const q=el.querySelector('.fwq'),list=el.querySelector('.fwl');let at=0,shown=[];
  const draw=()=>{
    shown=fwdTargets(live&&live.cards,from,q.value);at=Math.min(at,Math.max(0,shown.length-1));
    list.innerHTML=shown.length?shown.map((c,i)=>'<button type="button" class="fwr'+(i===at?' on':'')+'" data-i="'+i+'">'
      +'<span class="ico" aria-hidden="true">'+esc(c.icon||'·')+'</span><b>'+esc(c.title||short(c.project))+'</b>'
      +'<span class="d">'+esc(short(c.project)+' · '+(COL_JA[c.column]||c.column)+' · '+t('{ago}前',{ago:ago(Math.max(0,Math.round((Date.now()-(c.lastT||Date.now()))/1000)))}))+'</span></button>').join('')
      :'<div class="dim">'+esc(t('該当なし'))+'</div>';
    const on=list.querySelector('.fwr.on');if(on)on.scrollIntoView({block:'nearest'});
  };
  const go=i=>{const c=shown[i];if(!c)return;const note=held?false:!!(el.querySelector('.fwn input')||{}).checked;
    try{localStorage.setItem('fwdnote',note||held?'1':'0')}catch(e){}
    fwdClose();fwdSend(from,c,text,{...(o||{}),note})};
  q.addEventListener('input',()=>{at=0;draw()});
  el.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();fwdClose();return}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();at=Math.max(0,Math.min(shown.length-1,at+(e.key==='ArrowDown'?1:-1)));draw();return}
    if(e.key==='Enter'&&e.target===q){e.preventDefault();e.stopPropagation();go(at);return}
    e.stopPropagation();   // typing in the search box is not a board shortcut
  });
  list.addEventListener('mousedown',e=>{const r=e.target.closest('.fwr');if(r){e.preventDefault();go(+r.dataset.i)}});
  el.addEventListener('mousedown',e=>{if(e.target===el){e.preventDefault();fwdClose()}});
  draw();q.focus();
}
/** Send it to `c`; take it back from `from` while it is held there, else tell `from` (once in a few minutes) not to act on it. */
function fwdSend(from,c,text,o){
  const to=c.agent+':'+c.id;
  try{localStorage.setItem('fwdlast',to)}catch(e){}
  // sent from a box of its own: the open panel's send box is not marked as sending, and its answer settles nothing there
  const sink=document.createElement('div');
  dispatch({type:'reply',agent:c.agent,session:c.id,text,dir:c.project,typeInto:native},sink,to);
  const i=from.indexOf(':'),fa=from.slice(0,i),fid=from.slice(i+1);
  if(o&&(o.key||o.plain)){
    if(typeof wfPost==='function')wfPost({type:'queue',agent:fa,session:fid,cancel:true,...(o.key?{key:o.key}:{plain:true})});
  }else if(o&&o.note&&!(Date.now()-(fwdNoted.get(from)||0)<FWD_NOTE_GAP_MS)){
    fwdNoted.set(from,Date.now());
    const fc=(live.cards||[]).find(x=>x.agent+':'+x.id===from);
    const head=text.replace(/\s+/g,' ').slice(0,40)+(text.length>40?'…':'');
    dispatch({type:'reply',agent:fa,session:fid,text:t('(直前に送った「{head}」など、続けて送ったメッセージは別のセッション宛てでした。それらには対応せず、進めていた作業があればそのまま続けてください)',{head}),dir:fc&&fc.project||undefined,typeInto:native},document.createElement('div'),'fwd:'+from);
  }
  if(typeof native!=='undefined'&&native)try{post({type:'log',text:'forward: '+from.slice(0,15)+' → '+to.slice(0,15)+' "'+text.replace(/\s+/g,' ').slice(0,40)+'"'})}catch(e){}
  const d=$('#mbody')||document.body;
  toast(d,t('↪ 「{title}」に渡しました',{title:c.title||short(c.project)}));
  const tb=$('#mbody .toast');if(tb){const b=document.createElement('button');b.className='mini';b.textContent=t('開く');b.onclick=()=>openDetail(c);tb.append(' ',b)}
}
/** Your last message to the open session: the echo of one just sent, else the newest of yours in its conversation. */
function fwdLastSent(){
  if(!openCard)return null;const k=openCard.agent+':'+openCard.id;
  const es=(typeof sentEchoes!=='undefined'&&sentEchoes.get(k))||[];const e=es[es.length-1];
  if(e&&e.text){const rp=replyParse(e.text);return {text:rp?rp.rest:e.text}}
  const tu=(typeof panelTurns==='function'?panelTurns(k):[]).filter(x=>x.kind==='user'&&!x.cmd&&!x.waiting&&!x.peer&&x.t).pop();
  return tu?{t:tu.t}:null;
}
