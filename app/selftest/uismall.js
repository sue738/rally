// selftest.sh uismall: ↓ 最新へ over a conversation scrolled up, in the board's side panel, and the
// panel's lane chip in colour
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const r={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
// a session with a conversation long enough to scroll: the claude cards, newest first, until one is
const cands=(live.cards||[]).filter(c=>c.agent==='claude'&&!c.subagent&&!c.headless).sort((a,b)=>(b.assistantTurns||0)-(a.assistantTurns||0)).slice(0,6);
if(!cands.length)return {ok:true,skipped:'no claude sessions'};
let h=null;
for(const c of cands){
  openDetail(c,false,{focus:false});await sleep(1200);
  const talk=document.querySelector('#detail .mviews button[data-p="talk"]');if(talk){talk.click();await sleep(1200)}
  // looked up again after the wait: switching views redraws the panel, and a short conversation has nothing to scroll
  await wait(()=>{const x=$('#mhist');return x&&x.scrollHeight>x.clientHeight+200},6000).catch(()=>{});
  const x=$('#mhist');r.hist={k:c.agent+':'+c.id,sh:x&&x.scrollHeight,ch:x&&x.clientHeight};
  if(x&&x.scrollHeight>x.clientHeight+200){h=x;break}
}
// the lane in the panel's status line is coloured (not the plain text colour)
const lane=document.querySelector('#mmeta .mstat .lane');
r.lane=lane?{text:lane.textContent,color:getComputedStyle(lane).color,cls:lane.className}:null;
if(lane&&/\bc-(working|needs-you|approval|answered)\b/.test(lane.className))expect('the panel\'s lane chip is coloured',getComputedStyle(lane).color!==getComputedStyle(document.body).color);
if(h){
  h.dispatchEvent(new WheelEvent('wheel',{deltaY:-400,bubbles:true}));h.scrollTop=0;await sleep(400);
  const b=h.nextElementSibling&&h.nextElementSibling.classList.contains('tolatest')?h.nextElementSibling:null;
  const br=b&&b.getBoundingClientRect(),hr=h.getBoundingClientRect();
  r.btn=b?{hidden:b.hidden,rect:[br.left,br.top,br.width,br.height].map(Math.round),hist:[hr.left,hr.top,hr.width,hr.height].map(Math.round)}:null;
  expect('scrolled up, ↓ 最新へ shows',!!b&&!b.hidden&&br.width>0);
  expect('… over the bottom of the conversation',!!b&&br.bottom<=hr.bottom+2&&br.top>hr.top+hr.height/2&&br.left>hr.left&&br.right<hr.right);
  if(b&&!b.hidden){const e=document.elementFromPoint(br.left+br.width/2,br.top+br.height/2);expect('… and nothing covers it',e===b||b.contains(e))}
  await sleep(1200);   // for the screenshot's sake nothing; the click follows
  if(b){b.click();await sleep(700)}
  r.after={gap:Math.round(h.scrollHeight-h.clientHeight-h.scrollTop),hidden:b&&b.hidden,stick:histStick};
  expect('clicking it goes to the bottom',r.after.gap<10&&histStick===true);
  expect('… and it hides at the bottom',!b||b.hidden);
}else r.skippedHist='no conversation long enough to scroll';
return {ok:bad.length===0,bad,r};
