// selftest.sh panelstat: the panel's top has no いま / 待ち box and asks for no summary; its status
// line gives each fact a light 12px icon and a tooltip, and the icons make the row no taller
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(false);
// what the page asks the app for while the panel is open (a summarize would be a haiku call)
const asked=[];const post0=post;post=m=>{asked.push(m&&m.type);return post0(m)};
try{
  const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
  if(!c)return {ok:true,skipped:'no claude session on the board'};
  panelView='talk';
  // a copy made to show every item (a refresh redraws the panel from the board's own card: measured at once)
  const c2={...c,usage:Object.assign({},c.usage||{},{ctx:535000}),reason:'the process is busy (claude agents)',column:'working'};
  openDetail(c2,false,{focus:false});await sleep(150);
  const st=$('#mbody .mstat');const lane=st&&st.querySelector('.lane');
  expect('the lane chip stays',!!lane&&/Working/.test(lane.textContent));
  const items=[...st.querySelectorAll('.mi')];
  out.items=items.map(e=>{const r=e.getBoundingClientRect(),i=e.querySelector('.mico,.sdot'),ir=i&&i.getBoundingClientRect();
    return {cls:e.className,text:e.textContent,title:e.title,h:Math.round(r.height),icon:ir?[Math.round(ir.width),Math.round(ir.height)]:null,fs:getComputedStyle(e).fontSize}});
  out.lane=lane?Math.round(lane.getBoundingClientRect().height):0;
  expect('four items: state, folder, clock, context',['why','mproj','mago','ctx'].every(k=>items.some(e=>e.classList.contains(k))));
  expect('each has a tooltip saying what it is',out.items.every(x=>/状態|プロジェクト|最後に動いた|文脈|トークンの合計|API 料金/.test(x.title)));
  expect('the icons are 12px line drawings in the text colour (the state is a dot)',out.items.every(x=>x.icon&&(x.cls.includes('why')?x.icon[0]<=8:x.icon[0]===12&&x.icon[1]===12)));
  expect('… no emoji in the line',!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(st.textContent));
  expect('the items keep the small type (var(--fs-small))',out.items.every(x=>x.fs===getComputedStyle(document.documentElement).getPropertyValue('--fs-small').trim()));
  expect('an icon makes no item taller than the lane chip',out.items.every(x=>x.h<=out.lane+1));
  const bar=st.querySelector('.ctx .cbar i');
  expect('535k draws a bar at 54% of the 1M window',!!bar&&bar.style.width==='54%'&&/54%/.test(st.querySelector('.ctx').title));
  const dot=st.querySelector('.sdot');
  expect('the state dot takes the lane colour (Working green)',!!dot&&getComputedStyle(dot).backgroundColor!==getComputedStyle(st.querySelector('.mproj')).color);
  // the panel used to ask for its summary 1.5s after you stayed on a card
  await sleep(2500);
  expect('no いま / 待ち box',!$('#mnow')&&!/要約しています/.test($('#mbody').textContent));
  expect('no summarize asked for the panel',!asked.includes('summarize'));
}finally{post=post0}
return {ok:bad.length===0,bad,...out};
