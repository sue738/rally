// selftest.sh pendpage: the 残作業 page counts what the header chip counts, says what is counted,
// opens a session's panel, and 棚卸し runs one at a time or as a capped batch that asks twice
// (the fake claude answers: nothing reaches a model, the readings go to this run's scratch wip.json)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(false);
const asked=[];const post0=post;post=m=>{asked.push(m);return post0(m)};
try{
  const mine=(live.cards||[]).filter(c=>!c.subagent&&!c.headless&&(c.agent==='claude'||c.agent==='codex')&&c.column!=='working'&&c.column!=='done');
  if(mine.length<2)return {ok:true,skipped:'fewer than two sessions to read'};
  // two readings made here, kept over every refresh (the board's own come from this run's empty scratch store)
  const k0=mine[0].agent+':'+mine[0].id,k1=mine[1].agent+':'+mine[1].id;let seeded=2;
  const seed=cs=>{for(const c of cs||[]){const k=c.agent+':'+c.id;
    if(k===k0)c.wip={status:'ok',at:Date.now(),remaining:[{what:'selftest: 残り1'},{what:'selftest: 残り2'}].slice(0,seeded)};
    if(k===k1)c.wip={status:'ok',at:Date.now(),remaining:[]}}};
  const as0=applyState;applyState=st=>{seed(st&&st.cards);return as0(st)};
  applyState(live);
  $('#pendall').click();await sleep(300);
  const chip=$('#pendn').textContent,t=$('#mtitle').textContent;
  out.chip=chip;out.title=t;
  expect('the page is open and its button pressed',panelKey==='pending'&&$('#pendall').classList.contains('on'));
  expect('the chip and the page say the same number',t.startsWith('残作業 '+chip+'件'));
  expect('the page says what the number counts',/項目の数/.test(($('#mmeta .pexp')||{}).textContent||''));
  expect('a session with items has 開く and each item 実行 / やめる',!!document.querySelector('#plisth .pitem .popen')&&document.querySelectorAll('#plisth .pitem .pgo').length>=2);
  const done=document.querySelector('#plisth details.pdone');
  expect('残りなし is folded',!!done&&!done.open);
  const rows=[...document.querySelectorAll('#plisth .prow .pscan1')];out.unread=rows.length;
  // まとめて: the first press only arms it
  const sa=$('#pscanall');out.batch=sa&&sa.textContent;
  if(sa){const n0=asked.filter(m=>m.type==='wip').length;sa.click();await sleep(200);
    expect('まとめて asks once more before it calls the model',!!sa.dataset.armed&&/もう一度押すと \d件/.test(sa.textContent)&&asked.filter(m=>m.type==='wip').length===n0);
    expect('… and it is capped at three',+sa.dataset.n<=3);
    const n=+sa.dataset.n;sa.click();await sleep(30);
    const sent=asked.filter(m=>m.type==='wip').length-n0;out.sent=sent;
    expect('the second press starts that many readings, no more',sent===n);
    expect('… and the page shows them at it',/棚卸し中/.test($('#plisth').textContent));
    await sleep(3000);
  }
  // 開く: the session's own panel
  if(panelKey!=='pending')openPendingAll();
  const it=document.querySelector('#plisth .pitem .popen');
  if(it){const id=it.closest('.pitem').dataset.id;it.click();await sleep(800);
    expect('開く opens that session\'s panel',!!openCard&&openCard.id===id&&$('#detail').classList.contains('sess'))}
  // for the screenshot: the page again
  if(panelKey!=='pending')openPendingAll();await sleep(300);
}finally{post=post0}
return {ok:bad.length===0,bad,...out};
