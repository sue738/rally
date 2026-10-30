// selftest.sh grips: the resize handles are wide enough to grab (panel edge, terminal strip), and the
// card whose panel is open keeps its own colour stripe under the ring that marks it.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:false,bad:['no claude card on the fixture board']};
openDetail(c,false,{focus:false});await sleep(400);
const mg=$('#mgrip'),tg=$('#termgrip');
out.mgrip=mg&&Math.round(mg.getBoundingClientRect().width);out.termgrip=tg&&Math.round(tg.getBoundingClientRect().height);
expect('the panel edge grip is at least 36px wide',!!mg&&mg.getBoundingClientRect().width>=36);
expect('the terminal strip grip is at least 28px tall',!tg||getComputedStyle(tg).display==='none'||tg.getBoundingClientRect().height>=28);
const el=[...document.querySelectorAll('section.col .card')].find(e=>e.classList.contains('opened'));
out.shadow=el&&getComputedStyle(el).boxShadow;
expect('the open card is marked',!!el);
expect('… and keeps its colour stripe (an inset shadow) beside the ring',!!el&&/inset/.test(getComputedStyle(el).boxShadow));
// the part of the grip that actually takes the mouse (something else may sit over half of it)
const live_=(g)=>{const r=g.getBoundingClientRect(),y=Math.round(r.top+r.height/2);let n=0;for(let x=Math.floor(r.left);x<Math.ceil(r.right);x++)if(document.elementFromPoint(x,y)===g)n++;return n};
out.mgripLive=live_($('#mgrip'));
expect('the panel edge grip takes the mouse over at least 36px (リスト)',out.mgripLive>=36);
setView('list');await sleep(400);openDetail(c,false,{focus:false});await sleep(400);
out.mgripLiveList=live_($('#mgrip'));out.listw=getComputedStyle(document.documentElement).getPropertyValue('--listw');
expect('… and in the docked list',out.mgripLiveList>=36);
// the terminal column's grip, between the panel and the terminal (half of it stands over the panel)
termOpen(true);await sleep(400);
out.termgripCol=live_($('#termgrip'));{const g=$('#termgrip'),r=g.getBoundingClientRect(),y=Math.round(r.top+r.height/2),e=document.elementFromPoint(Math.floor(r.left)+4,y);out.cover=e&&((e.id?'#'+e.id:'')+'.'+String(e.className).slice(0,40)+' z='+getComputedStyle(e).zIndex+' in '+(e.closest('#detail')?'detail':e.closest('#term')?'term':'?'))}out.termgripColBox=Math.round($('#termgrip').getBoundingClientRect().width);
expect('the grip between the panel and the terminal takes the mouse over its whole width',out.termgripCol>=36);
closeDetail('x');
return {ok:bad.length===0,bad,out};
