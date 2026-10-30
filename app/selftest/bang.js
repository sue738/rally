// selftest.sh bang: a message beginning with ! is a command for the session's bash mode — typed into
// its terminal (the ! first, then the rest), never sent as words. Nothing real runs: the fake claude
// sits in the panel's terminal, dispatch is stubbed, ptyin is recorded.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked&&!panelPty(x));
if(!c)return {ok:false,bad:['no stopped claude card on the fixture board']};
const sent=[],typed=[];const d0=window.dispatch,p0=window.post;
window.dispatch=m=>{sent.push(m);return Promise.resolve()};
window.post=m=>{if(m&&m.type==='ptyin')typed.push(m.data);return p0(m)};
try{
  panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea'),8000);
  const t=$('#mbody .msg textarea');t.value='!echo BANGOK';t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await wait(()=>typed.some(x=>/echo BANGOK/.test(x)),15000).catch(()=>{});await sleep(300);
  out.sent=sent.map(m=>m.type);out.typed=typed.slice(0,4);
  expect('a ! message is not sent as words',!sent.length);
  const i=typed.indexOf('!');
  expect('the ! is typed first, alone (it switches Claude Code to bash mode)',i>=0);
  expect('… then the command and Enter',i>=0&&typed.slice(i+1).some(x=>x==='echo BANGOK\r'));
}finally{window.dispatch=d0;window.post=p0;const p=panelPty(c);if(p)ptyClose(p.id)}
return {ok:bad.length===0,bad,out};
