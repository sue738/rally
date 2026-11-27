// selftest.sh later: あとで送る end to end, with nothing real sent. A stopped claude card (an ordinary send would
// continue it at once) gets two messages through the send row's menu: one for 10分後, one for a time of day two hours
// on. The page checks the chip and its menu, the answer, the held lines with their times, that they are still held
// after several refreshes (the board's drain runs on each), and 取り消す. Both are taken back at the end, so none
// goes off later in another scenario; selftest.sh checks that the fake claude never got either.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const pad=n=>String(n).padStart(2,'0');
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
panelView='talk';
const home=(live.home||'').replace(/\/$/,'');
// stopped, outside the home folder, not in a terminal of the app's: a send from the box goes through dispatch
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.project&&x.project.replace(/\/$/,'')!==home&&!panelPty(x)&&openFor!==x.agent+':'+x.id);
if(!cs.length)return {ok:true,skipped:'no stopped claude card outside the home folder'};
const c=cs[0],key=c.agent+':'+c.id;out.card=c.id.slice(0,8);
openDetail(c,false,{focus:false,view:'talk'});
await wait(()=>$('#mbody .msg textarea'),5000);
const mb=()=>$('#mbody'),chip=()=>$('#mbody .laterbtn'),menu=()=>$('#mbody .latermenu'),box=()=>$('#mbody .msg textarea');
const held=()=>[...document.querySelectorAll('#mhist .heldq .turn.held.later')];
const card=()=>(live.cards||[]).find(x=>x.agent+':'+x.id===key)||c;
const toastText=()=>(($('#mbody .toast')||{}).textContent)||'';
{const row=chip()&&chip().closest('.foot'),wf=row&&row.querySelector('.wfbtn');
  expect('the send row has あとで ▾, after 今の作業後に送る',!!chip()&&!!wf&&!!(wf.compareDocumentPosition(chip())&Node.DOCUMENT_POSITION_FOLLOWING));}
expect('… off to begin with',!!chip()&&!chip().classList.contains('on'));
chip().click();await sleep(150);
expect('it opens a menu: 10分後, 30分後, 1時間後, 2時間後 and a time of day',!!menu()&&!menu().hidden&&menu().querySelectorAll('button[data-mins]').length===4&&!!menu().querySelector('.laterinput'));
menu().querySelector('[data-mins="10"]').click();await sleep(150);
expect('10分後 turns it on and says so',chip().classList.contains('on')&&/10分後/.test(chip().textContent)&&menu().hidden);
expect('… and the box says when',/10分後に送ります/.test(box().placeholder));
const idle=async()=>{await wait(()=>!mb().dataset.sending,20000).catch(()=>{})};
const send=async v=>{await idle();const t=box();t.value=v;t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(200);await idle()};
const t0=Date.now();
await send('selftest later 1');
await wait(()=>/に送ります/.test(toastText()),15000).catch(()=>{});
out.toast1=toastText();
expect('the answer says the time it goes',/に送ります/.test(out.toast1));
expect('… and the chip is off again (it is for one send)',!chip().classList.contains('on'));
// the second: a time of day two hours on
const d2=new Date(Date.now()+2*3600000),hm=pad(d2.getHours())+':'+pad(d2.getMinutes());
chip().click();await sleep(150);
menu().querySelector('.laterinput').value=hm;menu().querySelector('.laterset').click();await sleep(150);
expect('a time of day turns it on with that time',chip().classList.contains('on')&&chip().textContent.includes(hm));
await send('selftest later 2');
await wait(()=>/に送ります/.test(toastText()),15000).catch(()=>{});
// the queue's own lines, not the page's drawn-at-once ones
const mine=()=>(card().held||[]).filter(h=>h.sendAt&&/selftest later/.test(h.text||''));
for(let k=0;k<20;k++){if(mine().length>=2&&mine().every(h=>!h.local))break;load();await sleep(700)}
await wait(()=>held().length===2&&!held().some(e=>/^local-/.test(e.dataset.key)),8000).catch(()=>{});
const hs=mine();out.sendAt=hs.map(h=>clock(h.sendAt));out.held=held().map(e=>e.querySelector('.who').textContent.trim());
expect('the queue holds both, each with its time',hs.length===2
  &&hs[0].sendAt>=t0+10*60000&&hs[0].sendAt<t0+10*60000+60000
  &&pad(new Date(hs[1].sendAt).getHours())+':'+pad(new Date(hs[1].sendAt).getMinutes())===hm);
expect('both are in the thread, saying when they go',held().length===2&&hs.length===2&&held().every((e,i)=>e.querySelector('.who').textContent.includes(clock(hs[i].sendAt))));
expect('… each with 今すぐ送る and 取り消す',held().length===2&&held().every(e=>e.querySelector('.hnow')&&e.querySelector('.hcancel')));
expect('the 送信待ち note does not repeat them',!$('#mbody .mnote.queued'));
expect('the card knows the next one\'s time',card().sendAt===hs[0].sendAt);
// several refreshes, each running the drain: neither goes before its time
for(let k=0;k<4;k++){load();await sleep(800)}
expect('nothing goes before its time',mine().length===2);
{const h=$('#mhist');if(h){h.scrollTop=h.scrollHeight}box().blur();await sleep(300)}
post({type:'selftestshot',name:'later'});await sleep(900);
// both taken back, so nothing is left to go off in a later scenario
for(let k=0;k<4&&held().length;k++){held()[0].querySelector('.hcancel').click();await sleep(400);if(k===0)out.cancelToast=toastText()}
expect('取り消す says so',/予約を取り消しました/.test(out.cancelToast||''));
for(let k=0;k<6&&mine().length;k++){load();await sleep(700)}
expect('… and both are out of the thread and the queue',!held().length&&!mine().length);
return {ok:bad.length===0,bad,...out};
