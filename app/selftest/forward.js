// selftest.sh forward: a message sent to the wrong session goes on to another — ↪ on it, pick the session, Enter: it is
// sent there, and the first session is told not to act on it; a held one is taken back instead. Sends are stubbed.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);closeDetail('x');
const cs=(live.cards||[]).filter(c=>c.agent==='claude'&&!c.subagent&&!c.headless);
if(cs.length<2)return {ok:false,bad:['fewer than 2 claude cards']};
const from=cs[0],to=cs[1];
const sent=[],posted=[];const p0=window.post;
window.post=m=>{if(m&&m.type==='reply'){sent.push(m);return}if(m&&m.type==='queue'){posted.push(m);return}if(m&&/^(notify|badge|asks)$/.test(m.type))return;return p0(m)};
try{
  panelView='talk';openDetail(from,false,{focus:false,view:'talk'});await wait(()=>$('#mhist .turn'),8000).catch(()=>{});await sleep(600);
  const userTurn=[...document.querySelectorAll('#mhist .turn.user')].find(x=>x.querySelector('.fbtn'));
  out.hasButton=!!userTurn;
  expect('your messages carry ↪',!!userTurn);
  // the target is found by typing its title; Enter passes it on
  try{localStorage.setItem('fwdnote','1')}catch(e){}
  if(userTurn)userTurn.querySelector('.fbtn').click();else fwdStart(from.agent+':'+from.id,{text:'テスト用の文'});
  await sleep(150);
  const el=$('#fwd');expect('the list opens',!!el);
  const q=el&&el.querySelector('.fwq');if(q){q.value=String(to.title||'').slice(0,6);q.dispatchEvent(new Event('input'))}
  await sleep(100);
  out.first=el&&el.querySelector('.fwr.on b')&&el.querySelector('.fwr.on b').textContent;
  q&&q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await sleep(300);
  out.sent=sent.map(m=>({to:m.session.slice(0,8),text:String(m.text).slice(0,30)}));
  expect('the list closes',!$('#fwd'));
  expect('it is sent to the session picked',sent.some(m=>m.session===to.id));
  expect('… and the first one is told not to act on it',sent.some(m=>m.session===from.id&&/別のセッション宛て/.test(m.text)));
  // a held one: taken back from where it was, never told
  sent.length=0;fwdSend(from.agent+':'+from.id,to,'預かり中の文',{plain:true});await sleep(100);
  out.held={sent:sent.map(m=>m.session.slice(0,8)),posted};
  expect('a held one goes to the session picked, is taken back from the first, and the first is not told',sent.length===1&&sent[0].session===to.id&&posted.some(m=>m.cancel&&m.plain&&m.session===from.id));
}finally{window.post=p0;fwdClose();closeDetail('x')}
return {ok:bad.length===0,bad,out};
