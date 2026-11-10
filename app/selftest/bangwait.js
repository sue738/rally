// selftest.sh bangwait: a `! command` sent while the session works. Claude Code holds it without its `!` (the queue
// record has the command alone), so it showed twice: 届け待ち with the bare command, and under it the echo of the same
// send (端末に入力, `! command`), spinning. Now it is one bubble, 届け待ち, reading `! command`; words that were not
// typed as a command stay words. Nothing is typed anywhere: the echo and the records are made here.
const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:true,skipped:'no claude card'};
panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea')&&$('#mhist'),8000);
const el=$('#mhist'),key=c.agent+':'+c.id,now=Date.now();
const CMD='git -C ~/work/repo push https://example.com/x.git topic:main';
const base=[{kind:'user',t:now-120000,text:'これを直して'},{kind:'assistant',t:now-90000,text:'直しています。'}];
const draw=turns=>{histSig='';renderHistory({agent:c.agent,session:c.id,turns,dropped:0})};
const bubbles=()=>[...el.children].filter(x=>x.classList&&x.classList.contains('turn')&&x.textContent.includes('x.git topic:main'));
const said=x=>x.textContent.replace(/\s+/g,' ');
try{
  // as ▶ 実行 and a `!` from the message box leave it: typed into the terminal, shown at once
  draw(base);
  const e=echoTyped('! '+CMD);
  expect('the send shows at once (端末に入力)',!!e&&bubbles().length===1&&/端末に入力/.test(said(bubbles()[0])));
  // the record catches up: the session is working, so the command is held — written down without its `!`
  draw([...base,{kind:'user',waiting:true,t:Date.now(),text:CMD}]);
  let b=bubbles();out.held=b.map(said);
  expect('one bubble for the held command, not two ('+b.length+')',b.length===1);
  expect('… the 届け待ち one',!!b[0]&&/届け待ち/.test(said(b[0]))&&!b[0]._echo);
  expect('… reading as the `! command` it is',!!b[0]&&said(b[0]).includes('! '+CMD));
  expect('… drawn as a command',!!b[0]&&b[0].classList.contains('cmd'));
  expect('the echo is gone, not kept for later',!(sentEchoes.get(key)||[]).some(x=>String(x.text).includes(CMD)));
  // a later refresh, the echo long gone: still the command
  draw([...base,{kind:'user',waiting:true,t:Date.now(),text:CMD}]);
  b=bubbles();
  expect('a later redraw keeps it one `! command` ('+b.map(said).join(' / ')+')',b.length===1&&said(b[0]).includes('! '+CMD)&&/届け待ち/.test(said(b[0])));
  // words held mid-turn that were not typed as a command stay words
  draw([...base,{kind:'user',waiting:true,t:Date.now(),text:'ls の結果を見て'},{kind:'user',waiting:true,t:Date.now(),text:CMD}]);
  const w=[...el.children].find(x=>x.classList&&x.classList.contains('turn')&&x.textContent.includes('ls の結果を見て'));
  expect('held words are not turned into a command',!!w&&!w.classList.contains('cmd')&&!/!\s*ls/.test(said(w)));
  // the turn ends, the command runs: the record has `! command` and what it printed, and nothing is waiting
  draw([...base,{kind:'user',cmd:true,t:Date.now(),text:'! '+CMD},{kind:'cmdout',t:Date.now(),text:'Everything up-to-date'}]);
  b=bubbles();out.ran=b.map(said);
  expect('once it ran: one `! command`, no longer 届け待ち',b.length===1&&said(b[0]).includes('! '+CMD)&&!/届け待ち/.test(said(b[0])));
}finally{
  const l=(sentEchoes.get(key)||[]).filter(x=>!String(x.text).includes(CMD));if(l.length)sentEchoes.set(key,l);else sentEchoes.delete(key);
  bangTyped.delete(key);histSig='';closeDetail('x');
}
return {ok:bad.length===0,bad,out};
