setInterval(()=>{for(const el of document.querySelectorAll('.eta[data-at]'))el.textContent=etaLabel({at:+el.dataset.at,over:el.dataset.over==='1'})},10000);
const HOUR_STEPS=[6,12,24,48,72,168,336,720];
/** The hours window one step wider (+1) or narrower (-1). */
function hoursStep(d){
  const hi=$('#hours');const steps=HOUR_STEPS;const cur=+hi.value||24;
  const nx=d<0?[...steps].reverse().find(x=>x<cur)||steps[0]:steps.find(x=>x>cur)||steps[steps.length-1];hi.value=nx;hi.dispatchEvent(new Event('change'));toast($('#mbody')||document.body,'直近 '+(nx<48?nx+'時間':nx/24+'日'));
}
$('#subs').onclick=()=>{const b=$('#subs');b.classList.toggle('on');try{localStorage.setItem('showsubs',b.classList.contains('on')?'1':'0')}catch(e){}render()};
for(const b of document.querySelectorAll('#pviewseg button')){b.classList.toggle('on',b.dataset.p===panelPref());b.onclick=()=>panelPrefSet(b.dataset.p)}
// the header is the window's title bar (app): the app drags the window from a bare part of it, so it is told when the
// pointer is over one (before the press: the press itself is handled natively)
{const hd=document.querySelector('header');
  const bare=e=>e.target&&!e.target.closest('button,input,select,textarea,a,label,.cspop,#limits');
  if(native&&hd){let on=false;const set=v=>{if(v!==on){on=v;post({type:'hdrbare',bare:v})}};
    hd.addEventListener('mousemove',e=>set(bare(e)));hd.addEventListener('mouseleave',()=>set(false))}}
$('#cardshowbtn').onclick=e=>{e.stopPropagation();cardShowOpen()};
setView();
$('#showdone').onclick=()=>{const h0=boardHours();$('#showdone').classList.toggle('on');applyDone();render();if(boardHours()!==h0)load()};
// a lane folds to its header (remembered)
{let fold={};try{fold=JSON.parse(localStorage.getItem('lanefold')||'{}')||{}}catch(e){}
 for(const s of document.querySelectorAll('section.col[data-col]')){
  const h=s.querySelector('h2');if(!h)continue;
  const set=on=>{s.classList.toggle('folded',on);h.setAttribute('aria-expanded',on?'false':'true');fold[s.dataset.col]=on?1:0;try{localStorage.setItem('lanefold',JSON.stringify(fold))}catch(e){}};
  s.classList.toggle('folded',!!fold[s.dataset.col]);h.setAttribute('aria-expanded',fold[s.dataset.col]?'false':'true');
  h.tabIndex=0;h.setAttribute('role','button');h.title=(h.title?h.title+' · ':'')+'クリックで畳む / 広げる';
  h.onclick=e=>{if(e.target.closest('button,a'))return;set(!s.classList.contains('folded'))};
  h.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===h){e.preventDefault();e.stopPropagation();set(!s.classList.contains('folded'))}};
 }}
// card times tick every second
let staleKick=0;
setInterval(()=>{
  const now=Date.now();
  let stale=false;
  for(const el of document.querySelectorAll('.card .idle[data-t]')){
    const t=+el.dataset.t;if(!t)continue;
    const secs=Math.max(0,Math.round((now-t)/1000));
    el.textContent=ago(secs)+'前';
    // 作業中 means "wrote within the last minute": past that, stop the pulse and re-read
    const card=el.closest('.card');
    if(card&&card.classList.contains('working')&&secs>60){card.classList.add('quiet');stale=true}
  }
  if(stale&&Date.now()-staleKick>10000){staleKick=Date.now();load()}
},1000);
load();
// re-read every 10s while something works, else every 30s
let tickN=0;
setInterval(()=>{
  tickN++;
  const busy=(live.cards||[]).some(c=>c.column==='working'||(c.alive&&c.aliveStatus==='busy'));
  if(busy||tickN%3===0)load();
},10000);
// The open panel re-reads its conversation while it moves, and for 3 minutes after a send
// (a Codex reply is a detached `exec` the board may not see as work).
// and what is drawn is checked against the state now, every few seconds (12-thread.js histReconcile)
setInterval(()=>{try{histReconcile()}catch(e){}},4000);
setInterval(()=>{if(!openCard)return;const ls=lastSends.get(openCard.agent+':'+openCard.id);
  // (and for 45 s after its last line: the last message is often written just as the state flips to finished)
  if(openCard.alive||openCard.column==='working'||openCard.queued||(ls&&Date.now()-ls.at<180000)||Date.now()-(openCard.lastT||0)<45000)askHistory(openCard)},5000);

