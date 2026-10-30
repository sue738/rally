// selftest.sh histscroll: scrolling the detail panel's 会話 up is not undone by the page.
// A wheel is played as WebKit delivers it: the wheel event, then the pane's scrollTop moves.
// Whatever the page does after that (a follow-the-bottom still pending from a refresh, a
// click's anchor-keeping, a panel redraw) must leave the pane where the wheel put it.
// The conversation is drawn from made-up turns; askHistory is stubbed so no real read lands
// over them, and put back at the end.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:true,skipped:'no claude card'};
const a0=window.askHistory;
try{
  panelView='talk';openDetail(c,false,{focus:false,view:'talk'});
  await wait(()=>$('#mhist')&&!$('#mhist .more'),8000).catch(()=>{});
  window.askHistory=()=>{};await sleep(1500);   // a read already on its way lands before ours
  const now=Date.now();let n=0;
  const turns=[];for(let i=0;i<60;i++)turns.push({kind:i%2?'assistant':'user',t:now-(120-i)*60000,text:(i%2?'返答 ':'指示 ')+i+'\n'+'スクロールの確認用の行です。'.repeat(6)});
  // a refresh with something new at the foot, as the 5 s poll draws it
  const refresh=()=>{n++;turns.push({kind:'assistant',t:now+n*1000,text:'新しい返答 '+n+'\n'+'増えた行です。'.repeat(8)});renderHistory({agent:c.agent,session:c.id,turns:turns.slice(),dropped:0})};
  const h=()=>$('#mhist');
  const gap=()=>{const e=h();return e.scrollHeight-e.clientHeight-e.scrollTop};
  const wheelUp=px=>{const e=h();const t=e.querySelector('.turn:last-child')||e;t.dispatchEvent(new WheelEvent('wheel',{deltaY:-px,bubbles:true,cancelable:true}));e.scrollTop-=px};
  const toBottom=async()=>{histStick=true;stickBottom(h());await sleep(400)};
  refresh();await sleep(600);
  out.pane={h:h().clientHeight,sh:h().scrollHeight};
  expect('the conversation is long enough to scroll ('+out.pane.sh+' in '+out.pane.h+')',h().scrollHeight>h().clientHeight+1200);
  expect('it opens at the bottom (gap '+Math.round(gap())+')',gap()<8);
  // nothing under the pointer but the conversation itself (a hidden terminal, an overlay left behind)
  {const r=h().getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);out.hit=hit&&(hit.id||hit.className);
   expect('the middle of the conversation is the conversation under the pointer (got '+out.hit+')',!!hit&&h().contains(hit))}

  // control: a wheel up with nothing pending stays where it went
  await toBottom();wheelUp(400);await sleep(400);out.idle=Math.round(gap());
  expect('control: scrolled up with nothing pending, it stays up (gap '+out.idle+')',out.idle>300);

  // a refresh just drew new turns and is still snapping to the bottom (rAF, 60 ms, 240 ms)
  await toBottom();refresh();wheelUp(400);await sleep(400);out.afterRefresh=Math.round(gap());
  expect('scrolled up while a refresh was snapping to the bottom, it stays up (gap '+out.afterRefresh+')',out.afterRefresh>300);
  // … and the next refresh does not pull it down either
  refresh();await sleep(400);out.nextRefresh=Math.round(gap());
  expect('… and the next refresh leaves it up (gap '+out.nextRefresh+')',out.nextRefresh>300);

  // a click in the conversation keeps what was clicked in place for a moment (rAF, rAF, 80 ms);
  // a wheel right after it is you moving, not the page
  await toBottom();
  {const u=[...h().querySelectorAll('.turn.user')].pop();u.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));wheelUp(400);await sleep(300)}
  out.afterClick=Math.round(gap());
  expect('scrolled up right after a click in the conversation, it stays up (gap '+out.afterClick+')',out.afterClick>300);

  // a little way up (not at the bottom), a redraw of the panel (a card change) and then a refresh
  await toBottom();wheelUp(24);await sleep(200);
  openDetail(c,true);await sleep(200);refresh();await sleep(400);out.afterKeep=Math.round(gap());
  expect('24 px up, a panel redraw and a refresh leave it up (gap '+out.afterKeep+')',out.afterKeep>=16);

  // and following still works: at the bottom, a refresh keeps the newest in view
  await toBottom();refresh();await sleep(500);out.follow=Math.round(gap());
  expect('at the bottom, a refresh follows the newest (gap '+out.follow+')',out.follow<8);
  // … also across a panel redraw
  openDetail(c,true);await sleep(200);refresh();await sleep(500);out.followKeep=Math.round(gap());
  expect('at the bottom, a redraw then a refresh still follows (gap '+out.followKeep+')',out.followKeep<8);
}finally{window.askHistory=a0}
return {ok:bad.length===0,bad,...out};
