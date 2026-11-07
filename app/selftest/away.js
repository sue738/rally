// selftest.sh away: coming back after a while, the sheet lists what moved while you were away — who waits on you, what
// finished — each with its one line, and a row opens its session. Unread is made by hand (seen marks set back).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);closeDetail('x');
const cs=(live.cards||[]).filter(c=>!c.subagent&&!c.headless&&['needs-you','answered','approval'].includes(c.column));
if(cs.length<2)return {ok:false,bad:['fewer than 2 cards in Your Turn on the fixture board']};
const was=JSON.stringify({m:seenMap,b:seenBase});
try{
  // everything older than now is unread: as if you had looked before all of it
  seenBase=0;for(const k of Object.keys(seenMap))delete seenMap[k];
  const g=awayGroups(live.cards);out.groups={you:g.you.length,done:g.done.length,work:g.work.length};
  expect('the Your Turn cards are on the sheet',g.you.length+g.done.length>=2);
  awayShow(Date.now()-40*60*1000);await sleep(200);
  const el=$('#away');out.head=el&&el.querySelector('.awh b').textContent;
  expect('the sheet opens, saying how long you were away',!!el&&/40/.test(out.head||''));
  const rows=el?[...el.querySelectorAll('.awr')]:[];out.rows=rows.length;
  expect('… one row per unread card',rows.length===g.you.length+g.done.length+g.work.length);
  expect('… each with its title and a line',rows.every(r=>r.querySelector('b').textContent.trim()));
  const r=el&&el.getBoundingClientRect();expect('… on screen',!!r&&r.width>200&&r.height>100);
  expect('… the keys are on it',document.activeElement&&document.activeElement.classList.contains('awr'));
  const k=rows[0]&&rows[0].dataset.k;rows[0].click();await sleep(400);
  expect('a row opens its session and the sheet goes',!$('#away')&&panelOpen()&&openCard&&openCard.agent+':'+openCard.id===k);
  awayShow(null);await sleep(100);
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await sleep(100);
  expect('Esc closes it',!$('#away'));
}finally{const o=JSON.parse(was);seenBase=o.b;for(const k of Object.keys(seenMap))delete seenMap[k];Object.assign(seenMap,o.m);awayClose();closeDetail('x')}
return {ok:bad.length===0,bad,out};
