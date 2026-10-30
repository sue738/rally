// selftest.sh homesend: a stopped session begun in the home folder (which Claude cannot continue in the
// background) is resumed in the panel and the message typed into it, not queued to fail three times.
// Nothing real is sent: the fake claude runs, dispatch is stubbed, ptyin is recorded.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked&&!panelPty(x));
if(!c||!live.home)return {ok:true,skipped:'no stopped claude card'};
const proj0=c.project;c.project=live.home;
const sent=[],typed=[];const d0=window.dispatch,p0=window.post;
window.dispatch=m=>{sent.push(m);return Promise.resolve()};
window.post=m=>{if(m&&m.type==='ptyin'&&!m.reply)typed.push(m.data);return p0(m)};
try{
  panelPrefSet('talk');openDetail(c,false,{focus:false});await wait(()=>$('#mbody .msg textarea'),8000);
  const t=$('#mbody .msg textarea');t.value='ホームのセッションへ';t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await wait(()=>typed.some(x=>/ホームのセッションへ/.test(x)),12000).catch(()=>{});await sleep(400);
  const p=panelPty(c);out.p=p&&{kind:p.kind};out.sent=sent.map(m=>m.type);out.typed=typed.slice(0,4);
  expect('nothing is handed to the background path (it would fail for a home-folder session)',!sent.length);
  expect('the session is resumed in the panel',!!p&&p.kind==='resume');
  expect('the message is typed into it, then Enter',typed.some(x=>/ホームのセッションへ/.test(x))&&typed.includes('\r'));
  expect('the view stays on 会話 (the terminal works behind it)',panelView==='talk');
}finally{window.dispatch=d0;window.post=p0;c.project=proj0;const p=panelPty(c);if(p)ptyClose(p.id)}
return {ok:bad.length===0,bad,out};
