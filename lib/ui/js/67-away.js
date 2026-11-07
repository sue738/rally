// おかえり: what moved while you were away, every session on one sheet — who waits on you, what finished, what is
// still at it — each with one line: its prompt or question, else the first line of its answer (answers here lead with
// the conclusion). Shown when you come back after AWAY_MS with something unread, or from ⌘K any time. No AI is asked:
// it is read from what the board already has (lib/ui/js/38-unread.js decides what is unread).
const AWAY_MS=15*60*1000;
let awayLeftAt=0,awayEl=null,awayShownAt=0;
function awayAuto(){try{return localStorage.getItem('awayauto')!=='0'}catch(e){return true}}
function awayAutoSet(on){try{localStorage.setItem('awayauto',on?'1':'0')}catch(e){}}
/** The one line a card is summed up by on the sheet. */
function awayLine(c){
  const a=c&&c.permAsk;
  if(a){const q=a.questions&&a.questions[0];return (q?t('質問: ')+String(q.question||''):t('許可: ')+String(a.tool||'')+' '+String(a.what||'')).replace(/\s+/g,' ').trim().slice(0,140)}
  const lines=String((c&&c.last&&c.last.assistant)||'').split('\n').map(l=>l.replace(/\*\*/g,'').replace(/^[#>*\-\s\d.)]+/,'').trim()).filter(Boolean);
  if(c.column==='working')return String(c.doingLine||lines[lines.length-1]||'').slice(0,140);
  // a question is at the end of an answer; anything else leads with its conclusion
  const end=lines[lines.length-1]||'';
  const q=/[?？]\s*$|(ますか|ましょうか|どちら|どうします)[。.]?\s*$/.test(end)?end:'';
  return String(q||c.waitingLine||lines[0]||'').slice(0,140);
}
/** The unread cards on the sheet, in three groups, newest first in each. */
function awayGroups(cards){
  const g={you:[],done:[],work:[]};
  for(const c of cards||[]){
    if(!c||c.subagent||c.headless||!['approval','needs-you','answered','working'].includes(c.column))continue;
    if(typeof unreadShown!=='function'||!unreadShown(c))continue;
    (c.column==='working'?g.work:c.column==='answered'?g.done:g.you).push(c);
  }
  for(const k of Object.keys(g))g[k].sort((a,b)=>(b.lastT||0)-(a.lastT||0));
  return g;
}
function awayClose(){if(!awayEl)return;const back=awayEl._back;awayEl.remove();awayEl=null;if(back&&document.contains(back)&&back.focus)try{back.focus({preventScroll:true})}catch(e){}}
/** Open the sheet. since: when you left (ms), or null when asked for from ⌘K. */
function awayShow(since){
  awayClose();
  const g=awayGroups(live&&live.cards),n=g.you.length+g.done.length+g.work.length;
  const el=document.createElement('div');el.id='away';el.setAttribute('role','dialog');el._back=document.activeElement;
  const row=c=>'<button type="button" class="awr" data-k="'+esc(c.agent+':'+c.id)+'">'
    +'<span class="ico" aria-hidden="true">'+esc(c.icon||'·')+'</span><b>'+esc(c.title||short(c.project))+'</b>'
    +'<span class="awt">'+esc(t('{ago}前',{ago:ago(Math.max(0,Math.round((Date.now()-(c.lastT||Date.now()))/1000)))}))+'</span>'
    +'<span class="awl">'+esc(awayLine(c))+'</span></button>';
  const sec=(cls,title,list)=>list.length?'<section class="aws '+cls+'"><h3>'+esc(title)+' <span class="n">'+list.length+'</span></h3>'+list.map(row).join('')+'</section>':'';
  const head=since?t('おかえりなさい。{m}離れているあいだに',{m:ago(Math.max(1,Math.round((Date.now()-since)/1000)))}):t('未読のまとめ');
  el.innerHTML='<div class="awc"><div class="awh"><b>'+esc(head)+'</b><span class="dim">'+esc(n?t('{n} 件のセッションが動きました',{n}):t('未読はありません'))+'</span>'
    +'<button type="button" class="awx" aria-label="'+esc(t('閉じる'))+'" title="'+esc(t('閉じる (Esc)'))+'">×</button></div>'
    +sec('you',t('あなたの返事待ち'),g.you)+sec('fin',t('終わったもの'),g.done)+sec('work',t('まだ動いているもの'),g.work)
    +'<div class="awf"><label><input type="checkbox" class="awauto"'+(awayAuto()?' checked':'')+'> '+esc(t('戻ったときに自動で出す'))+'</label>'
    +(n?'<button type="button" class="mini awread">'+esc(t('すべて既読にする'))+'</button>':'')+'<button type="button" class="mini awclose">'+esc(t('閉じる (Esc)'))+'</button></div></div>';
  document.body.appendChild(el);awayEl=el;awayShownAt=Date.now();
  el.addEventListener('mousedown',e=>{if(e.target===el){e.preventDefault();awayClose()}});
  el.querySelector('.awx').onclick=awayClose;el.querySelector('.awclose').onclick=awayClose;
  const rd=el.querySelector('.awread');if(rd)rd.onclick=()=>{unreadAllRead();awayClose()};
  el.querySelector('.awauto').onchange=e=>awayAutoSet(e.target.checked);
  for(const b of el.querySelectorAll('.awr'))b.onclick=()=>{const c=(live.cards||[]).find(x=>x.agent+':'+x.id===b.dataset.k);awayClose();if(c)openDetail(c)};
  // the keys stay on the sheet: ↑↓ walk it, Enter opens, Esc closes
  el.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();awayClose();return}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();
      const rs=[...el.querySelectorAll('.awr')];if(!rs.length)return;const i=rs.indexOf(document.activeElement);
      rs[Math.max(0,Math.min(rs.length-1,i<0?0:i+(e.key==='ArrowDown'?1:-1)))].focus();return}
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.length===1)e.stopPropagation();   // not the board's single-key shortcuts
  });
  const first=el.querySelector('.awr')||el.querySelector('.awclose');if(first)first.focus({preventScroll:true});
}
// Away: the window hidden or not in front. Back after AWAY_MS with something unread: the sheet, once the board has
// refreshed (the unread marks come from the fresh state) — not over a palette, the viewer or a box you are typing in.
function awayMark(){if(!awayLeftAt)awayLeftAt=Date.now()}
function awayBack(){
  const left=awayLeftAt;awayLeftAt=0;
  if(!left||Date.now()-left<AWAY_MS||!awayAuto()||awayEl||Date.now()-awayShownAt<AWAY_MS)return;
  setTimeout(()=>{
    if(awayEl||(typeof pal!=='undefined'&&pal)||(typeof viewer!=='undefined'&&viewer)||(typeof typingInPanel==='function'&&typingInPanel()))return;
    const g=awayGroups(live&&live.cards);if(g.you.length+g.done.length+g.work.length)awayShow(left)},1500);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)awayMark();else awayBack()});
window.addEventListener('blur',awayMark);
window.addEventListener('focus',awayBack);
