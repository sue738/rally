// selftest.sh bangrun: a ! command the agent suggests in its answer carries ▶ 実行; one click types it into the
// session's terminal as a ! from the box goes (the ! alone, the command, then Enter), shows it as sent, and is never sent
// as words. Nothing real runs: the fake claude sits in the panel's terminal, dispatch is stubbed, ptyin is recorded.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked&&!panelPty(x));
if(!c)return {ok:false,bad:['no stopped claude card on the fixture board']};
const sent=[],typed=[];const d0=window.dispatch,p0=window.post;
window.dispatch=m=>{sent.push(m);return Promise.resolve()};
window.post=m=>{if(m&&m.type==='ptyin')typed.push(m.data);return p0(m)};
const answer={kind:'assistant',t:Date.now(),text:'ログインが要ります。次を打ってください: `! echo BANGRUN` (`x !== y` は比較)\n\nまたは:\n```\n! echo BANGBLOCK\n```\n\n```sh\nnpm test\n```'};
// the answer drawn as the last turn of this session's thread (a history redraw in between would replace it)
// (renderHistory caches what it draws: the record is taken once, so a second draw does not add the answer twice)
let base=null;
const draw=()=>{if(!base){const hc=histCache.get(c.agent+':'+c.id);base=((hc&&hc.j.turns)||[]).filter(x=>x!==answer)}
  histSig='';renderHistory({agent:c.agent,session:c.id,turns:base.concat([answer])});const h=$('#mhist');if(h)stickBottom(h)};
try{
  panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea'),8000);
  await wait(()=>$('#mhist')&&$('#mhist').children.length,8000).catch(()=>{});await sleep(600);
  draw();
  const btns=[...document.querySelectorAll('#mhist .turn.assistant .bangrun')];
  out.buttons=btns.map(b=>(b.closest('.codeblk')?'block:':'inline:')+b.textContent);
  expect('▶ 実行 on the inline ! command and on the one-line block, nowhere else',btns.length===2&&btns.some(b=>!b.closest('.codeblk'))&&btns.some(b=>b.closest('.codeblk')));
  const blk=document.querySelector('#mhist .codeblk.bang');
  if(blk){const r=blk.getBoundingClientRect(),rb=blk.querySelector('.bangrun').getBoundingClientRect(),rc=blk.querySelector('.cpy').getBoundingClientRect();
    out.block={w:Math.round(r.width),run:[Math.round(rb.left-r.left),Math.round(rb.width)],copy:Math.round(rc.left-r.left)};
    expect('… the block one sits inside the block, left of its copy button',rb.left>r.left&&rb.right<=rc.left+1&&rb.top>=r.top-1)}
  const inl=btns.find(b=>!b.closest('.codeblk'));
  const turn=inl&&inl.closest('.turn');const folded0=turn&&turn.classList.contains('folded');
  if(inl)inl.click();
  out.folded=!!(turn&&turn.classList.contains('folded'))!==!!folded0;
  expect('the click does not fold the answer it sits in',!out.folded);
  // it shows at once as sent, as a ! from the box does
  await wait(()=>[...document.querySelectorAll('#mhist .turn.user')].some(e=>e._echo&&/! echo BANGRUN/.test(e.textContent)),15000).catch(()=>{});
  out.echo=[...document.querySelectorAll('#mhist .turn.user')].filter(e=>e._echo).map(e=>e.textContent.slice(0,60));
  expect('the command shows in the conversation as sent',out.echo.some(x=>/! echo BANGRUN/.test(x)));
  await wait(()=>typed.some(x=>/echo BANGRUN/.test(x)),15000).catch(()=>{});await sleep(600);
  out.sent=sent.map(m=>m.type);out.typed=typed.slice(0,6);
  expect('a ▶ 実行 is not sent as words',!sent.length);
  const i=typed.indexOf('!');
  expect('the ! is typed first, alone (it switches Claude Code to bash mode)',i>=0);
  const j=typed.findIndex((x,k)=>k>i&&x.includes('echo BANGRUN'));
  expect('… then the command, without the ! (pasted, without its Enter)',j>i&&!typed[j].includes('\r')&&!/^!/.test(typed[j]));
  expect('… then Enter on its own',j>i&&typed.slice(j+1).includes('\r'));
  expect('only the clicked command was typed',!typed.some(x=>/BANGBLOCK/.test(x)));
  // left on screen for the screenshot
  draw();await sleep(300);
}finally{window.dispatch=d0;window.post=p0;const p=panelPty(c);if(p)ptyClose(p.id)}
return {ok:bad.length===0,bad,out};
