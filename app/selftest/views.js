// selftest.sh views: the board is リスト only (看板 and フォーカス were removed), and 表示 in the
// header chooses what a card shows, in the real page.
// Returns {ok, bad[], ...}; each failed expectation is one line in bad.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(false);
expect('no view switch is left in the header',!document.querySelector('#viewbtn')&&VIEWS.length===1&&VIEWS[0][0]==='list');
expect('no フォーカス view is left in the page',!document.querySelector('#focus,#fdock,.ftile'));
// whatever is asked for (an old stored value, a stale call): リスト
for(const v of ['board','focus','list']){setView(v);await sleep(200);
  expect('asked for '+v+': リスト',boardView==='list'&&document.body.classList.contains('vlist')&&!document.body.classList.contains('vboard'))}
const rows=[...document.querySelectorAll('section.col .card')].filter(c=>c.getBoundingClientRect().height>0);
const widths=new Set(rows.map(c=>Math.round(c.getBoundingClientRect().width)));
out.list={rows:rows.length,widths:[...widths]};
expect('list: rows share one width (the lanes are stacked)',rows.length>0&&widths.size===1);
// v does nothing to the view now
document.dispatchEvent(new KeyboardEvent('keydown',{key:'v',bubbles:true}));await sleep(300);
expect('v: still リスト',boardView==='list'&&document.body.classList.contains('vlist'));
// 表示: a switch per field, ticked when on; a switch turned off takes that field off every card
const cs0=JSON.stringify(cardShow);
try{
  const b=$('#cardshowbtn');expect('表示 is in the header and shown',!!b&&b.getBoundingClientRect().width>0);
  b.click();await sleep(200);
  const pop=$('#cardshow'),sw=[...pop.querySelectorAll('button[data-k]')];
  out.fields=sw.map(x=>x.dataset.k+(x.classList.contains('on')?'+':'-'));
  expect('表示 opens its list of fields, one switch each',!pop.hidden&&sw.length===CARD_FIELDS.length);
  const r=pop.getBoundingClientRect();expect('… inside the window',r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight);
  const chips=()=>document.querySelectorAll('section.col .card .ctok').length;
  const tb=pop.querySelector('button[data-k="tokens"]');
  if(!tb.classList.contains('on')){tb.click();await sleep(200)}
  const on=chips();
  tb.click();await sleep(300);
  out.tokChips={on,off:chips()};
  expect('トークン合計 off: no Σ on any card (was '+on+')',chips()===0&&!tb.classList.contains('on')&&tb.getAttribute('aria-pressed')==='false');
  tb.click();await sleep(300);
  expect('… and back on',chips()===on&&tb.classList.contains('on'));
  document.body.click();await sleep(200);
  expect('a click elsewhere closes it',pop.hidden&&b.getAttribute('aria-expanded')==='false');
}finally{cardShow=JSON.parse(cs0);try{localStorage.setItem('cardshow',cs0)}catch(e){}render();$('#cardshow').hidden=true}
return {ok:bad.length===0,bad,...out};
