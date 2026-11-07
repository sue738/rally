// selftest.sh diagnose: ⚙ → 使い方診断 asks for the counts; when they come back, 新規 opens with the prompt written in,
// claude, Opus, 深さ high and the folder they were written to — Enter is yours. post is stubbed (nothing is counted).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);closeDetail('x');
const posted=[];const p0=window.post;window.post=m=>{if(m&&m.type==='diagnose'){posted.push(m);return}return p0(m)};
try{
  const item=document.querySelector('[data-s="diagnose"]');
  expect('the ⚙ menu has it',!!item);
  if(item)item.click();await sleep(100);
  expect('… which asks for the counts of the last 14 days',posted.length===1&&posted[0].days===14);
  const dir=(live.trusted||[])[0]||(live.cards.find(c=>c.project)||{}).project||'/tmp';
  window.__kanban.diagnosed({dir,prompt:'私の使い方を診断してください(selftest)',model:'opus',effort:'high',sessions:7});await sleep(600);
  out.text=($('#ntext')||{}).value;out.model=($('#nmodel')||{dataset:{}}).dataset.model;out.effort=($('#neffort')||{dataset:{}}).dataset.e;out.dir=($('#ndir')||{}).value;
  expect('新規 opens with the prompt written in',panelKey==='new'&&/selftest/.test(out.text||''));
  expect('… on Opus and 深さ high',out.model==='opus'&&out.effort==='high');
  expect('… in the folder the counts were written to',out.dir===dir);
  window.__kanban.diagnosed({error:'boom'});await sleep(100);
  expect('a failure says so',/boom/.test(document.body.textContent));
  // the real way round: the app runs `rally diagnose` and calls back (on the fixture home: whatever it finds there)
  closeDetail('x');const d0=window.__kanban.diagnosed;let back=null;window.__kanban.diagnosed=j=>{back=j;return d0(j)};
  p0({type:'diagnose',days:14});await wait(()=>back,60000).catch(()=>{});window.__kanban.diagnosed=d0;
  out.native=back&&(back.error?'error: '+String(back.error).slice(0,80):'sessions '+back.sessions+' in '+back.dir);
  expect('the app runs the count and calls back',!!back&&(!!back.prompt||!!back.error));
}finally{window.post=p0;closeDetail('x')}
return {ok:bad.length===0,bad,out};
