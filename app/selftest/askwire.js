// selftest.sh askwire: the permission box's buttons still answer after the panel is refreshed
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
// a card nothing else is changing: a session at work (this very run's own, often) is redrawn from the
// real state on the next refresh, and that took the made-up prompt away before the check could see it
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent);
const c=cs.find(x=>!x.alive&&x.column!=='working')||cs[0];if(!c)return {ok:true,skipped:'no claude card'};
// and no refresh while it runs: the redraw this checks is the one it asks for (openDetail(c,true) below)
const st=window.__kanban.state;window.__kanban.state=()=>{};
c.column='approval';c.alive=true;c.aliveKind='interactive';c.aliveStatus='waiting';c.aliveWaitingFor='permission prompt';c.asking={tool:'Bash',what:'ls'};
panelView='talk';openDetail(c,false,{focus:false,view:'talk'});
await wait(()=>!!document.querySelector('#mhist .askgo'),10000).catch(()=>0);
if(!document.querySelector('#mhist .askgo'))bad.push('the permission box shows 端末で答える');
await sleep(1500);const b0=document.querySelector('#mhist .askgo');openDetail(c,true);
const b=document.querySelector('#mhist .askgo');const same=b0===b;
if(!b||typeof b.onclick!=='function')bad.push('端末で答える still answers after a refresh of the panel (its handler was lost)');
panelView='term';closeDetail('selftest');window.__kanban.state=st;
return {ok:bad.length===0,bad,same};
