// selftest.sh palhold: ⌘K's highlight stays on the entry you moved to when the sessions found in what was said arrive
// and reorder the list (an Enter then opened whatever had moved into that row).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);closeDetail('x');
const cs=(live.cards||[]).filter(x=>!x.subagent);
if(cs.length<3)return {ok:false,bad:['fewer than 3 cards']};
const p0=window.post;window.post=m=>{if(m&&m.type==='search')return;return p0(m)};   // the second stage is fed by hand
try{
  openPalette();const inp=pal.inp;inp.value='a';inp.dispatchEvent(new Event('input'));await sleep(50);
  // move onto an action (they follow the sessions), the way you move to the one you want
  const ai=pal.shown.findIndex(x=>x.kind==='a');if(ai<0)return {ok:false,bad:['no action matched']};
  for(let i=0;i<ai;i++)inp.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  const before=pal.shown[pal.at];out.before=before&&before.t;out.atBefore=pal.at;
  // what was said: a session the title search did not list is found there, and goes in above the actions
  pal.cq='a';const listed=new Set(pal.shown.filter(x=>x.kind==='s').map(x=>x.c.id));const fc=cs.find(x=>!listed.has(x.id))||cs[cs.length-1];out.found=fc.title;
  window.__kanban.searched({q:'a',hits:{[fc.agent+':'+fc.id]:'… a …'}});await sleep(50);
  const after=pal.shown[pal.at];out.after=after&&after.t;out.atAfter=pal.at;out.rowNow=pal.shown.findIndex(x=>palKey(x)===palKey(before));
  expect('the highlight is on the same entry after the list was redrawn',!!before&&!!after&&palKey(before)===palKey(after));
  const on=document.querySelector('#palette .pi.on');
  expect('… and it is the one marked on screen',!!on&&+on.dataset.i===pal.at);
  expect('the list did reorder under it (else this proves nothing)',out.atBefore!==out.rowNow);
  inp.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  expect('the arrow keys still move from there',pal.at>=1&&palKey(pal.shown[pal.at])!==palKey(before));
}finally{window.post=p0;closePalette()}
return {ok:bad.length===0,bad,out};
