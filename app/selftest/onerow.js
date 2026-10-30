// selftest.sh onerow: the panel's top is its title row — folded or not — and carries no ターミナル / 会話 switch (the
// header has the one); a lane's header folds its cards (and is remembered); Completed is open when nothing was chosen.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:false,bad:['no claude card on the fixture board']};
panelView='talk';panelFoldSet(true);openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .mviews'),5000);await sleep(300);
const mv=$('#mbody .mviews'),hv=$('#pviewseg');
const shown=e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0};
out.panelSwitch=shown(mv);out.headerSwitch=!!hv&&shown(hv);
expect('the panel shows no ターミナル / 会話 switch of its own (folded)',!shown(mv));
panelFoldSet(false);await sleep(200);
expect('… nor open',!shown($('#mbody .mviews')));
expect('the header has the one, in view',!!hv&&shown(hv)&&hv.getBoundingClientRect().top>=0);
$('#pvterm').click();await sleep(200);
expect('the header\'s ターミナル switches the open card',panelView==='term');
$('#pvtalk').click();await sleep(200);
expect('… and 会話 back',panelView==='talk');
closeDetail('x');
// lanes
const col=document.querySelector('section.col[data-col="working"]'),h=col.querySelector('h2');
h.click();await sleep(100);
expect('a lane header click folds its cards',col.classList.contains('folded')&&getComputedStyle(col.querySelector('.list')).display==='none');
expect('… remembered',(JSON.parse(localStorage.getItem('lanefold')||'{}')||{}).working===1);
h.click();await sleep(100);
expect('… and opens again',!col.classList.contains('folded'));
return {ok:bad.length===0,bad,out};
