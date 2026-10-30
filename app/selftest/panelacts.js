// selftest.sh panelacts: the panel's 残作業 / 作ったもの line is there in both views, in the same
// place (it used to be hidden in ターミナル, so ⌘\ made it come and go and the top jump), and
// opening it above the panel's terminal refits the terminal to the rows left (claude is the fake)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive);
if(!c)return {ok:true,skipped:'no stopped claude card'};
// a reading with items, so there is something to open (kept over refreshes; this run's wip store is scratch)
const W={status:'ok',at:Date.now(),remaining:[1,2,3,4,5,6].map(i=>({what:'selftest: 残り'+i,evidence:'根拠'+i}))};
const as0=applyState;applyState=st=>{for(const x of (st&&st.cards)||[])if(x.agent===c.agent&&x.id===c.id)x.wip=W;return as0(st)};
c.wip=W;
panelView='term';openDetail(c,false,{focus:false});
await wait(()=>panelPty(c),6000).catch(()=>0);await sleep(1200);
const p=panelPty(c);
if(!p)return {ok:false,bad:['the panel\'s terminal did not open']};
const top=s=>{const e=$(s);return e&&e.offsetParent?Math.round(e.getBoundingClientRect().top):null};
const where=()=>({acts:top('#mbody .acts'),pend:top('#mbody .acts .pendbox'),hbar:top('#mbody .hbar'),actsH:$('#mbody .acts')?Math.round($('#mbody .acts').getBoundingClientRect().height):0});
const inTerm=where();out.term=inTerm;
expect('ターミナル shows the 残作業 line',inTerm.pend!=null&&$('#mbody').classList.contains('pterm'));
panelSwitch('talk');await sleep(500);
const inTalk=where();out.talk=inTalk;
expect('会話 shows it too',inTalk.pend!=null);
expect('… in the same place, and the view switch below it does not move',inTerm.acts===inTalk.acts&&inTerm.hbar===inTalk.hbar&&inTerm.actsH===inTalk.actsH);
panelSwitch('term');await sleep(600);
expect('back in ターミナル it is still there, same place',JSON.stringify(where())===JSON.stringify(inTerm));
// opened: the terminal gets fewer rows, closed: they come back
const rows0=p.xt.rows;const pb=$('#mbody .acts .pendbox');
pb.open=true;await sleep(700);
const rows1=p.xt.rows;const mh=$('#mterm').getBoundingClientRect();
const lastRow=p.el.querySelector('.xterm-screen');const sr=lastRow&&lastRow.getBoundingClientRect();
out.rows=[rows0,rows1];out.fits=sr?[Math.round(sr.bottom),Math.round(mh.bottom)]:null;
expect('opening 残作業 floats over the terminal: it keeps its rows',rows1===rows0);
expect('… and the screen still fits inside its box',!!sr&&sr.bottom<=mh.bottom+2);
pb.open=false;await sleep(700);
out.rows.push(p.xt.rows);
expect('closing it gives the rows back',p.xt.rows===rows0);
return {ok:bad.length===0,bad,...out};
