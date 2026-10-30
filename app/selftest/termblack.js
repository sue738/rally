// selftest.sh termblack: a card's terminal comes back with its last screen, not black. For each
// way back to a terminal seen before — to a card running in the background (claude attach), to a
// stopped one the panel resumed, 会話 → ターミナル, the panel closed and opened again — the time
// from the switch until the panel shows that card's terminal with something painted in it.
// The fake claude draws at once; a real `claude attach` takes longer to draw its screen.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const cards=()=>(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
await wait(()=>cards().some(x=>x.alive&&x.aliveKind==='background'),15000).catch(()=>0);
const card=id=>(live.cards||[]).find(x=>x.id===id);
const run=cards().find(x=>x.alive&&x.aliveKind==='background');
const stopped=cards().filter(x=>!x.alive&&x.aliveChecked);
if(!run||stopped.length<1)return {ok:true,skipped:'no background card and stopped card ('+!!run+', '+stopped.length+')'};
panelView='term';
let opens=0;const ptyOpen0=window.ptyOpen;window.ptyOpen=function(){opens++;return ptyOpen0.apply(this,arguments)};
const drawn=p=>{if(!p)return false;const b=p.xt.buffer.active;for(let i=0;i<b.length;i++)if(b.getLine(i).translateToString(true).trim())return true;return false};
// when each terminal last painted (xterm's onRender), whichever renderer it has
const painted=new Map();
const watch=()=>{for(const p of ptys.values())if(!p._tbw){p._tbw=true;p.xt.onRender(()=>painted.set(p,performance.now()))}};
// ms until the card's terminal is in the panel, laid out, with a row of text, and painted since the
// switch (or, one that kept its renderer and its canvas since before, shown again)
const black=async(id,act)=>{
  watch();const p0=panelPty(card(id));const gl0=p0&&p0.gl;
  const t0=performance.now();act();
  while(performance.now()-t0<8000){
    watch();const p=panelPty(card(id)||{id});
    if(p&&p.el.closest('#mterm')&&p.el.offsetParent&&drawn(p)&&((painted.get(p)||0)>=t0||(p===p0&&gl0&&p.gl===gl0)))return Math.round(performance.now()-t0);
    await frame()}
  return 8000};
const visit=async id=>{openDetail(card(id),false,{focus:false});await wait(()=>{const p=panelPty(card(id));return p&&p.el.closest('#mterm')&&drawn(p)},8000).catch(()=>0);await sleep(300)};
const A=run.id,B=stopped[0].id;
await visit(A);
const pa=panelPty(card(A));
expect('the background card opens attached (claude attach)',!!pa&&pa.kind==='attach'&&!pa.bg);
await visit(B);
const o0=opens;
out.ms={};
out.ms.backToAttached=await black(A,()=>openDetail(card(A),false,{focus:false}));await sleep(300);
out.ms.backToResumed=await black(B,()=>openDetail(card(B),false,{focus:false}));await sleep(300);
out.opensBack=opens-o0;
panelSwitch('talk');await sleep(400);
out.ms.talkToTerm=await black(B,()=>panelSwitch('term'));await sleep(300);
closeDetail('selftest');await sleep(600);
const o1=opens;
out.ms.reopenAttached=await black(A,()=>openDetail(card(A),false,{focus:false}));await sleep(300);
out.opensReopen=opens-o1;
out.sameAttached=panelPty(card(A))===pa;
window.ptyOpen=ptyOpen0;
// every way back is a terminal seen a moment ago: within a few frames, and no new terminal
for(const [k,ms] of Object.entries(out.ms))expect(k+' paints its last screen at once ('+ms+' ms)',ms<250);
expect('no terminal is opened again on the way back ('+out.opensBack+', '+out.opensReopen+')',out.opensBack===0&&out.opensReopen===0);
expect('… the attached one is the same terminal, kept',out.sameAttached);
closeDetail('selftest');await sleep(300);
return {ok:bad.length===0,bad,...out};
