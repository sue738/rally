// 未読: a card updated since you last looked at it. "Looked" = its panel stayed open for a moment with this window in
// front. Remembered per card as the time of the last line seen (localStorage 'seen'); a card never seen counts as
// unread only if it moved after the first launch with this (so the first start is not all unread).
// seenA (stored as r): how many replies (replyTurns) the card had then, to say how many came since (unknown for one seen before this was kept)
let seenMap={},seenA={},seenBase=0,seenT=0;
try{const o=JSON.parse(localStorage.getItem('seen')||'null');if(o&&typeof o==='object'){seenMap=o.m&&typeof o.m==='object'?o.m:{};seenA=o.r&&typeof o.r==='object'?o.r:{};seenBase=+o.base||0}}catch(e){}
// Where the unread began in the card whose panel is open: the time it was last seen when it was opened, kept while it
// stays open (it is marked seen a moment after, and the line must not vanish under you).
const unreadFrom=new Map();
function unreadFromOf(key){return unreadFrom.has(key)?unreadFrom.get(key):null}
function seenSave(){try{localStorage.setItem('seen',JSON.stringify({base:seenBase,m:seenMap,r:seenA}))}catch(e){}}
if(!seenBase){seenBase=Date.now();seenSave()}
const ckey=c=>c.agent+':'+c.id;
function isUnread(c){
  if(!c||c.subagent||c.headless)return false;
  const s=seenMap[ckey(c)];
  return (c.lastT||0)>(s==null?seenBase:s);
}
/** Replies (with words) that came since it was last seen; a card new since the first launch has had all of them unseen. 0 when not known. */
function replyDelta(c){
  const k=ckey(c);
  if(k in seenA)return Math.max(0,(c.replyTurns||0)-seenA[k]);
  return k in seenMap?0:(c.replyTurns||0);
}
/** Marked on the card: unread. A working card moves on every tool call, so it is marked only once a reply has come (something to read). */
function unreadShown(c){return isUnread(c)&&(c.column!=='working'||replyDelta(c)>0)}
/** On opening a card: where its unread starts, or nothing when it is read. */
function unreadOpened(c){
  const k=ckey(c),cur=(live.cards||[]).find(x=>ckey(x)===k)||c;
  unreadJumped.delete(k);
  if(isUnread(cur)){const s=seenMap[k];unreadFrom.set(k,s==null?seenBase:s)}else unreadFrom.delete(k);
}
function markSeen(c){
  if(!c||c.subagent)return false;
  const k=ckey(c),t=c.lastT||0;
  if((seenMap[k]||0)>=t&&k in seenMap)return false;
  seenMap[k]=Math.max(seenMap[k]||0,t);seenA[k]=c.replyTurns||0;seenSave();return true;
}
// You are looking when this window has the focus, or you touched it (mouse, keys, wheel) within the last minute:
// a web view can report no focus while you are plainly working in it.
let seenTouch=0;
for(const t of ['pointerdown','keydown','wheel','mousemove'])document.addEventListener(t,()=>{seenTouch=Date.now()},{capture:true,passive:true});
function inFront(){return !document.hasFocus||document.hasFocus()||Date.now()-seenTouch<60000}
/** The open card, seen — only while you are looking. */
function seenSync(){
  if(typeof panelOpen!=='function'||!panelOpen()||!panelKey)return false;
  if(!inFront())return false;
  const c=(live.cards||[]).find(x=>ckey(x)===panelKey);
  return markSeen(c);
}
/** After a card is opened: seen once it has stayed (a run of j/k does not read everything it passes). */
function seenLater(key){clearTimeout(seenT);seenT=setTimeout(()=>{if(panelKey===key&&seenSync())unreadPaint()},600)}
function unreadReplies(c){return unreadShown(c)?replyDelta(c):0}
/** The chip on the card: how many replies are waiting. */
function unreadChip(c){const n=unreadReplies(c);return n?'<span class="cun" title="前に見てから届いた返信 '+n+' 件">返信 '+n+' 件</span>':''}
/** A card read before replies were counted: take its count now, so what comes after is counted from here. */
function seenBaseline(cards){
  let n=0;
  for(const c of cards||[]){if(c.subagent)continue;const k=ckey(c);if(!(k in seenA)&&!isUnread(c)){seenA[k]=c.replyTurns||0;n++}}
  if(n)seenSave();
}
function unreadCount(){return (live.cards||[]).filter(unreadShown).length}
/** The marks on the cards on screen, without redrawing the lanes. */
function unreadPaint(){
  const byKey=new Map((live.cards||[]).map(c=>[ckey(c),c]));
  for(const el of document.querySelectorAll('section.col .card')){const c=byKey.get(el.dataset.agent+':'+el.dataset.id);el.classList.toggle('unread',!!c&&unreadShown(c))}
}
/** Drop what is remembered of cards long gone from the board. */
function seenPrune(){
  const have=new Set((live.cards||[]).map(ckey)),old=Date.now()-30*864e5;let n=0;
  for(const k of Object.keys(seenMap))if(!have.has(k)&&seenMap[k]<old){delete seenMap[k];delete seenA[k];n++}
  if(n)seenSave();
}
const unreadJumped=new Set();
/** More unread than fits: scroll to where it begins, once per opening (it stays there; ↓ 最新へ goes back down). */
function unreadJump(el,key){
  if(unreadJumped.has(key)||!el||unreadFromOf(key)==null)return;
  const line=el.querySelector('.unreadline');if(!line)return;
  unreadJumped.add(key);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(panelKey!==key||!line.isConnected)return;
    const hr=el.getBoundingClientRect(),lr=line.getBoundingClientRect();
    if(lr.top>=hr.top)return;                      // it is on screen already
    histStick=false;el.scrollTop+=lr.top-hr.top-8;syncLatest(el);
  }));
}
function unreadNext(){
  const el=[...document.querySelectorAll('section.col .card.unread')][0];
  const c=el?(live.cards||[]).find(x=>x.agent===el.dataset.agent&&x.id===el.dataset.id):(live.cards||[]).find(unreadShown);
  if(!c)return;
  if(el&&typeof selectEl==='function')selectEl(el);
  openDetail(c,false,{focus:false});
  if(el)el.focus({preventScroll:true});
}
function unreadAllRead(){for(const c of live.cards||[])if(unreadShown(c))markSeen(c);unreadPaint()}
window.addEventListener('focus',()=>{if(seenSync())unreadPaint()});
