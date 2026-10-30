// Echo what you sent into the thread at once; the transcript catches up a few seconds later.
function echoSent(text,files){
  const el=$('#mhist');if(!el||!openCard)return null;
  const k=openCard.agent+':'+openCard.id,e={text,n:(files||[]).length,at:Date.now(),who:'送信中…',pending:true};
  sentEchoes.set(k,[...(sentEchoes.get(k)||[]),e]);
  const d=echoEl(e);el.appendChild(d);histStick=true;stickBottom(el);
  // sent in the background: checked against the record too (it vanished after 15 minutes either way, delivered or not)
  e.route='send';setTimeout(()=>{if(openCard&&openCard.agent+':'+openCard.id===k)askHistory(openCard)},ECHO_SENT_LATE_MS-5000);setTimeout(()=>echoLate(k,e),ECHO_SENT_LATE_MS);
  return d;
}
const ECHO_SENT_LATE_MS=120000;
/** Typed into the app's own terminal: no answer comes back, so it is shown as done. */
function echoTyped(text){
  const d=echoSent(text,[]);if(!d)return null;
  d._echo.pending=false;d._echo.route='terminal';d._echo.who='端末に入力';d.classList.remove('pending');d.querySelector('.who').textContent='端末に入力';
  // typing into a terminal has no answer: the record is the only proof. Not in it after 30 s: say so (the echo used to
  // read "端末に入力 · いま" for the whole 15 minutes it was kept, whether or not anything had happened)
  const key=openCard&&openCard.agent+':'+openCard.id,e=d._echo;
  setTimeout(()=>{if(openCard&&openCard.agent+':'+openCard.id===key)askHistory(openCard)},ECHO_LATE_MS-5000);
  setTimeout(()=>echoLate(key,e),ECHO_LATE_MS);
  return d;
}
const ECHO_LATE_MS=30000;
/** Still not in the record: mark that echo, here and in every redraw of it. */
function echoLate(key,e){
  const l=sentEchoes.get(key);if(!l||!l.includes(e)||e.late)return;
  // typed while it works, Claude Code holds the words until the turn ends and only then writes them down: not late
  // yet (a message typed mid-turn read 届いていないかもしれません for the two minutes before it was taken in)
  const c=(live.cards||[]).find(x=>x.agent+':'+x.id===key);
  // only the open panel's record is read again (echoRestore): for another session there is nothing to compare yet, so no
  // verdict (it logged delivered messages as lost once the panel had moved on); judged when it is open again
  if(!(openCard&&openCard.agent+':'+openCard.id===key)){if(Date.now()-e.at<ECHO_KEEP_MS)setTimeout(()=>echoLate(key,e),30000);return}
  // held by the board (今の作業後に送る, a retry after a copy): its own line says so; looked at again later
  if(c&&c.queued&&Date.now()-e.at<ECHO_KEEP_MS){setTimeout(()=>echoLate(key,e),15000);return}
  if(c&&(c.column==='working'||(c.alive&&c.aliveStatus==='busy'))&&Date.now()-e.at<ECHO_KEEP_MS){
    if(!e.waitShown){e.waitShown=true;e.who='作業の区切りで届きます';const el=$('#mhist');if(el)for(const x of el.children)if(x._echo===e){x.title='作業中なので、Claude Code が今の作業の区切りで受け取ります。それまで会話の記録には載りません';const w=x.querySelector&&x.querySelector('.who');if(w)w.textContent=e.who}}
    setTimeout(()=>{if(openCard&&openCard.agent+':'+openCard.id===key)askHistory(openCard);setTimeout(()=>echoLate(key,e),5000)},10000);return}
  e.late=true;e.who='届いていないかもしれません';
  // in the app's log, so a lost message can be traced afterwards (where it went, what it said)
  if(native)try{post({type:'log',text:'not in the record after sending: '+key.slice(0,16)+' via '+(e.route||'?')+' "'+String(e.text||'').replace(/\s+/g,' ').slice(0,40)+'"'})}catch(x){}
  const el=$('#mhist');if(!el)return;
  for(const x of el.children)if(x._echo===e){x.classList.add('error');x.title='送ってしばらくたっても会話の記録に載っていません。端末の入力欄に残っていないか、セッションが止まっていないか確認してください';const w=x.querySelector&&x.querySelector('.who');if(w)w.textContent=e.who}
}
/** an echo for words that were not typed after all: removed and not drawn again */
function echoDrop(d){
  if(!d)return;const e=d._echo;
  for(const [k,l] of sentEchoes){const i=l.indexOf(e);if(i>=0){l.splice(i,1);if(!l.length)sentEchoes.delete(k)}}
  d.remove();
}
// kept until the transcript has them, so a history redraw does not drop them
const sentEchoes=new Map();
const ECHO_KEEP_MS=15*60000;
function echoEl(e){
  const d=document.createElement('div');
  d.className='turn user'+(e.pending?' pending':'')+(e.error||e.late?' error':'');d._echo=e;
  if(e.late)d.title='送ってしばらくたっても会話の記録に載っていません。端末の入力欄に残っていないか、セッションが止まっていないか確認してください';
// a reply is shown as the transcript will have it: the quote as one line
  const rp=replyParse(e.text);
  d.innerHTML='<span class="who">'+esc(e.who)+'</span><span class="when">'+clock(e.at)+'</span>'+(rp?replyLine(rp):String.fromCharCode(10))
    +esc(rp?rp.rest:e.text)+(e.n?String.fromCharCode(10)+esc('添付 '+e.n+'件'):'');
  if(rp)setTimeout(()=>wireRq(d.parentNode||d),0);
  return d;
}
/** After a redraw: the echoes the transcript does not have yet, back at the foot. */
function echoRestore(el,j){
  const k=j.agent+':'+j.session,list=sentEchoes.get(k);if(!list)return;
// NFKC first: the transcript can hold the words decomposed (で as て + ゛, as macOS does) where the box had them composed;
// compared as written, the echo then never matched its own message and stayed under it as a second copy
  const norm=x=>String(x||'').normalize('NFKC').replace(/\s+/g,' ').trim().replace(/^!\s*/,'! ');   // `!cmd` and `! cmd` are the same command
// a 届け待ち turn is the message too: one of the two is enough
  const users=(j.turns||[]).filter(t=>t.kind==='user');
  // the words, not the file list under them: Claude Code turns a typed image path into an attached image ([Image #1]),
  // so the record no longer has the path and a delivered message read 届いていないかもしれません
  const words=x=>{const w=norm(String(x||'').split('添付ファイル(このパスを読んでください)')[0]);return w||norm(x)};
  const left=list.filter(e=>Date.now()-e.at<ECHO_KEEP_MS&&!users.some(t=>(t.t||0)>=e.at-60000&&norm(t.text).includes(words(e.text).slice(0,200))));
  if(left.length)sentEchoes.set(k,left);else sentEchoes.delete(k);
  for(const e of left)el.appendChild(echoEl(e));
}

/**
 * A reply to one message. The agent only sees the text, so the target travels in the words: a header
 * (time, how far back) and a quote — the selection verbatim, else head and tail of the message.
 * Pure: test/test.js evaluates it straight out of the page.
 */
function replyWrap(ref,t){
  t=String(t==null?'':t);
// a header in front of a /command would make it plain words
  if(!ref||/^\s*[\/／]/.test(t))return t;
  const d=new Date(ref.t||Date.now()),hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  const n=Math.max(1,ref.n|0);
  const head=ref.who==='user'?'[返信] '+hm+' の私の指示('+n+'件前)への補足:':'[返信] '+hm+' のあなたの回答('+n+'件前)への返信:';
  const sel=String(ref.sel||'').replace(/\r/g,'').trim(),s=String(ref.text||'').replace(/\r/g,'').trim();
  let q=sel?sel.slice(0,400):s.length<=280?s:s.split(/\n[ \t]*\n/)[0].slice(0,200).trim()+'\n…'+s.slice(-80).trim();
// collapse blank-line runs; at most 8 lines, keeping the last
  let ls=q.replace(/\n[ \t]*(\n[ \t]*)+/g,'\n\n').split('\n').map(l=>l.replace(/\s+$/,''));
  if(ls.length>8)ls=[...ls.slice(0,6),'…',ls[ls.length-1]];
  return head+'\n'+ls.map(l=>l?'> '+l:'>').join('\n')+'\n\n'+t;
}
/** replyWrap read back: {hm, who, n, quote (one line), rest (your comment)}, or null for any other message */
function replyParse(s){
  s=String(s||'');
  const m=s.match(/^\[返信\] (\d{1,2}:\d{2}) の(あなたの回答|私の指示)\((\d+)件前\)への(?:返信|補足):\n((?:>.*(?:\n|$))+)/);
  if(!m)return null;
  return {hm:m[1],who:m[2]==='私の指示'?'user':'assistant',n:+m[3],quote:m[4].split('\n').map(l=>l.replace(/^> ?/,'').trim()).filter(Boolean).join(' '),rest:s.slice(m[0].length).replace(/^\n+/,'')};
}
function replyHM(t){if(!t)return '';const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function replyLine(rp){return '<div class="rq" data-hm="'+esc(rp.hm)+'" data-k="'+rp.who+'" title="クリックで元の発言へ">↩ '+esc(rp.hm)+' の'+(rp.who==='user'?'指示':'回答')+': '+esc(rp.quote.slice(0,120))+'</div>'}
function wireRq(el){
  for(const q of el.querySelectorAll('.rq'))q.onclick=e=>{e.stopPropagation();
// the latest turn of that kind at that minute before the reply: the one it answered
    const own=q.closest('.turn');let hit=null;
    for(const x of el.querySelectorAll('.turn[data-hm="'+q.dataset.hm+'"][data-k="'+q.dataset.k+'"]'))if(x!==own&&(!own||own.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_PRECEDING))hit=x;
    if(!hit){toast($('#mbody')||document.body,q.dataset.hm+' の発言はこの表示範囲にありません');return}
    for(let p=hit.parentElement;p&&p!==el;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
    hit.classList.remove('folded');histStick=false;hit.scrollIntoView({block:'center',behavior:'smooth'});
    hit.classList.remove('rflash');void hit.offsetWidth;hit.classList.add('rflash');setTimeout(()=>hit.classList.remove('rflash'),1600)};
}
// the message a reply is to, per session ('agent:id'); part of its draft (00-core.js)
const replyRefs=new Map();
function panelTurns(key){const hc=histCache.get(key);return (hc&&hc.j&&hc.j.turns)||[]}
/** how many messages back a turn is (1 = the newest), counted at send */
function replyN(key,ref){
  const ts=panelTurns(key).filter(x=>x.kind==='user'||x.kind==='assistant');
  const i=ts.findIndex(x=>x.t===ref.t&&x.kind===ref.who);return i<0?(ref.n||1):ts.length-i;
}
function replyTo(key,who,t,sel,text){
  const x=panelTurns(key).find(y=>y.t===t&&y.kind===who);
  const ref={who,t,sel:sel||'',text:x?String(x.text||''):String(text||'')};ref.n=replyN(key,ref);
  replyRefs.set(key,ref);replyChip();if(key===panelKey)keepUnsent();
  const b=$('#mbody .msg textarea');if(b){b.disabled=false;b.focus();const n=b.value.length;try{b.setSelectionRange(n,n)}catch(e){}}
}
function replyClear(key){replyRefs.delete(key);if(key===panelKey){replyChip();keepUnsent()}}
function replyChip(){
  const box=$('#mbody .row.msg');if(!box)return;
  let ch=box.querySelector('.replychip');const ref=panelKey&&replyRefs.get(panelKey);
  if(!ref){if(ch)ch.remove();return}
  if(!ch){ch=document.createElement('div');ch.className='replychip';const at=box.querySelector('.atts');box.insertBefore(ch,at||null)}
  const ex=(ref.sel||ref.text).replace(/\s+/g,' ').trim();
  ch.innerHTML='<span class="rw">↩ '+esc(replyHM(ref.t))+' の'+(ref.who==='user'?'指示':'回答')+(ref.sel?'(選択)':'')+'へ</span><span class="rx">'+esc(ex.slice(0,160))+'</span><button class="rclose" title="返信をやめる(欄の先頭で ⌫ ・空の欄で Esc)">×</button>';
  ch.querySelector('.rclose').onclick=e=>{e.stopPropagation();replyClear(panelKey);const b=$('#mbody .msg textarea');if(b)b.focus()};
}
/** Shift+R: a reply to the newest answer */
function replyLatest(){
  if(!panelOpen()||!openCard||!$('#mbody .msg textarea'))return false;
  const key=openCard.agent+':'+openCard.id;const a=panelTurns(key).filter(x=>x.kind==='assistant').pop();
  if(!a)return false;replyTo(key,'assistant',a.t,'');return true;
}
// Is the session mid-turn? The lane or process says working, or the conversation ends with your
// unanswered message or a tool call without a result.
function thinkState(turns){
  const c=openCard;if(!c)return null;
  const last=turns&&turns.length?turns[turns.length-1]:null;
  const since=last&&last.t?last.t:Date.now();
// waiting on you is not working, whatever the process reports (a permission prompt reads as busy)
  const waiting=c.column==='needs-you'||c.column==='approval'||c.column==='answered'||c.column==='stale'||c.column==='done';
  if(c.column==='approval')return last&&last.kind==='tool'?{label:'許可待ち '+(last.tool||''),since}:{label:'許可待ち',since};
// the conversation is ahead of the lane: an unanswered message of yours means an answer is owed
  if(last&&last.kind==='user')return {label:'考え中',since};
  if(waiting)return null;
  const busy=c.column==='working'||(c.alive&&c.aliveStatus==='busy');
  if(last&&last.kind==='tool'&&busy){
    let n=0,start=since;for(let i=turns.length-1;i>=0&&turns[i].kind!=='user';i--){if(turns[i].kind==='tool'){n++;start=turns[i].t||start}}
    return {label:'実行中 '+(last.tool||''),target:String(last.text||'').replace(/\s+/g,' ').slice(0,90),count:n,since,start};
  }
  if(c.column==='working')return {label:'作業中',since};
  return null;
}
// one spinner clock for the whole page
const SPIN='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';let spinAt=0;
setInterval(()=>{const els=document.querySelectorAll('.spin');if(!els.length)return;spinAt=(spinAt+1)%SPIN.length;for(const e of els)e.textContent=SPIN[spinAt]},100);
let thinkTimer=null;
function tickThinking(){
  if(thinkTimer)clearInterval(thinkTimer);
  const upd=()=>{
    const el=document.querySelector('#mhist .think');
    if(!el){if(thinkTimer)clearInterval(thinkTimer);thinkTimer=null;return}
    const t=+el.dataset.since||Date.now();
    const lab=el.querySelector('.t');if(!lab)return;
    const base=lab.textContent.replace(/\s*\(.*\)$/,'');
    const st=+el.dataset.start;
    lab.textContent=base+' ('+ago(Math.max(0,Math.round((Date.now()-t)/1000)))+(st&&st<t?' · 連続 '+ago(Math.max(0,Math.round((Date.now()-st)/1000))):'')+')';
  };
  upd();thinkTimer=setInterval(upd,1000);
}

