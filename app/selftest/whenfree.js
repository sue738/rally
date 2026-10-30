// selftest.sh whenfree: 今の作業後に送る end to end, with nothing real sent. The card is a real
// conversation that the fake `claude agents` (selftest.sh) lists as an interactive session at
// work; everything the board does goes to the fake claude, which records it. Two messages go
// with 今の作業後に送る (⌥⏎ once with the chip off, then Enter with it on) and a third is taken back.
// selftest.sh keeps the session busy until the page says so (a colour on the card), then idle; each hand-over starts a turn
// (busy for a while, then idle again). The page checks the chip, the held lines in the thread and
// that they go one per idle; selftest.sh checks from the recorded calls that nothing went while it
// was busy and that the two went in order, one per idle, and the third never.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
// 会話: the panel's terminal would open a pty on the session (not what this is about)
panelView='talk';
let c=null;
for(let k=0;k<30&&!c;k++){c=(live.cards||[]).find(x=>x.aliveName==='wf-selftest');if(!c){load();await sleep(1000)}}
if(!c)return {ok:false,bad:['the card stubbed as busy is not on the board']};
const key=c.agent+':'+c.id;out.card=c.id.slice(0,8);
expect('the stubbed card is at work (claude agents: interactive, busy)',c.alive&&c.aliveKind==='interactive'&&c.aliveStatus==='busy');
openDetail(c,false,{focus:false,view:'talk'});
await wait(()=>$('#mbody .msg textarea'),5000);
const mb=()=>$('#mbody'),chip=()=>$('#mbody .wfbtn'),box=()=>$('#mbody .msg textarea');
const held=()=>[...document.querySelectorAll('#mhist .heldq .turn.held')];
const card=()=>(live.cards||[]).find(x=>x.agent+':'+x.id===key)||c;
{const row=chip()&&chip().parentElement,fb=row&&row.querySelector('.forkbtn');
  expect('the send row has a 今の作業後に送る chip, after --fork',!!chip()&&!!fb&&[...row.children].indexOf(chip())>[...row.children].indexOf(fb));}
expect('… off to begin with',!!chip()&&!chip().classList.contains('on'));
const idle=async()=>{await wait(()=>!mb().dataset.sending,20000).catch(()=>{})};
const send=async(v,alt)=>{await idle();const t=box();t.value=v;t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',altKey:!!alt,bubbles:true}));await sleep(200);await idle()};
// 1: ⌥⏎ with the chip off — that way once
await send('selftest whenfree 1',true);
out.toast1=($('#mbody .toast')||{}).textContent;
expect('⌥⏎ holds it: the answer says 今の作業が終わったら送ります',/今の作業が終わったら送ります/.test(out.toast1||''));
expect('… and the chip is still off (⌥⏎ is once)',!chip().classList.contains('on'));
// the chip: on, remembered for this session
chip().click();await sleep(100);
expect('the chip turns on',chip().classList.contains('on'));
expect('… remembered for this session',JSON.parse(localStorage.getItem('whenfree')||'[]').includes(key));
openDetail(card(),false,{focus:false});await wait(()=>chip(),3000);
expect('… and still on when the panel is opened again',chip().classList.contains('on'));
// 2: Enter with the chip on
await send('selftest whenfree 2');
out.toast2=($('#mbody .toast')||{}).textContent;
expect('Enter with the chip on holds it too',/今の作業が終わったら送ります/.test(out.toast2||''));
// the queue's own lines, not the page's drawn-at-once ones
for(let k=0;k<20;k++){const hs=card().held||[];if(hs.length>=2&&hs.every(h=>!h.local))break;load();await sleep(700)}
await wait(()=>held().length===2&&!held().some(e=>/^local-/.test(e.dataset.key)),8000).catch(()=>{});
const texts=()=>held().map(e=>(e.textContent.match(/selftest whenfree \d/)||[''])[0]);
out.held=texts();
expect('both are in the thread as 今の作業後に送る, in the order sent',out.held.join('|')==='selftest whenfree 1|selftest whenfree 2'&&held().every(e=>/今の作業後に送る/.test(e.querySelector('.who').textContent)));
expect('… each with 今すぐ送る and 取り消す',held().every(e=>e.querySelector('.hnow')&&e.querySelector('.hcancel')));
expect('… after the conversation, at its foot',(()=>{const h=$('#mhist'),q=h&&h.querySelector('.heldq');return !!q&&q===h.lastElementChild})());
expect('the 送信待ち note does not repeat them',!$('#mbody .mnote.queued'));
// 3: held, then taken back — it must never go
await send('selftest whenfree 3');
for(let k=0;k<20;k++){const hs=card().held||[];if(hs.length>=3&&hs.every(h=>!h.local))break;load();await sleep(700)}
await wait(()=>held().length===3&&!held().some(e=>/^local-/.test(e.dataset.key)),8000).catch(()=>{});
const third=held()[2];
expect('a third is held behind them',!!third&&/selftest whenfree 3/.test(third.textContent));
if(third){third.querySelector('.hcancel').click();await sleep(300);out.cancelToast=($('#mbody .toast')||{}).textContent}
expect('取り消す takes that one out of the thread at once',held().length===2);
for(let k=0;k<4;k++){load();await sleep(700)}
expect('… and out of the queue (the next refresh has two)',(card().held||[]).length===2&&held().length===2);
{const h=$('#mhist');h.scrollTop=h.scrollHeight;box().value='';box().blur();await sleep(300)}
post({type:'selftestshot',name:'held'});await sleep(900);
// while it is at work, nothing goes (the drain runs on every refresh)
for(let k=0;k<4;k++){load();await sleep(800)}
out.whileBusy=(card().held||[]).length;
expect('nothing is delivered while the session is busy',out.whileBusy===2);
// the go-ahead for selftest.sh: the session turns idle now
post({type:'label',agent:c.agent,session:c.id,color:'green'});
// then idle: one per idle, the oldest first
const seen=[];const t0=Date.now();
while(Date.now()-t0<120000){
  load();await sleep(1000);
  const x=card(),n=(x.held||[]).length;
  const s=n+':'+(x.aliveStatus||'-');if(seen[seen.length-1]!==s)seen.push(s);
  if(!n&&!x.queued)break;
}
out.timeline=seen;out.deliveredIn=Math.round((Date.now()-t0)/1000)+'s';
expect('both are delivered once it is idle',!(card().held||[]).length&&!card().queued);
expect('… one per idle: the second waited while the first one\'s turn ran',seen.some(s=>/^1:busy/.test(s)));
expect('the thread has no held line left',await wait(()=>!held().length,5000).then(()=>true,()=>false));
return {ok:bad.length===0,bad,...out};
