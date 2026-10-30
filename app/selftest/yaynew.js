// selftest.sh yaynew: Your Turn empty — a 新規セッション button right under All caught up opens 新規,
// and ⌘N is said on it and on the header's ＋ 新規. The board is the fixture's, its cards moved off Your Turn.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const was=(live.cards||[]).map(c=>[c,c.column]);
try{
  for(const c of live.cards||[])c.column='working';render();await sleep(200);out.cols=[...document.querySelectorAll('section.col')].map(x=>x.dataset.col+':'+x.querySelectorAll('.card').length+(x.querySelector('.yay')?'+yay':'')).join(' ');
  const b=$('.yay .yaynew');out.text=b&&b.textContent;out.header=$('#new').textContent;
  expect('an empty Your Turn has a 新規セッション button',!!b&&/新規セッション/.test(b.textContent));
  expect('… saying ⌘N',!!b&&/⌘N/.test(b.textContent));
  expect('the header ＋ 新規 says ⌘N',/⌘N/.test($('#new').textContent));
  if(b){b.click();await sleep(300)}
  expect('the button opens 新規',!$('#detail').hidden&&$('#new').classList.contains('on'));
  closeDetail('x');
}finally{for(const [c,k] of was)c.column=k;render()}
return {ok:bad.length===0,bad,out};
