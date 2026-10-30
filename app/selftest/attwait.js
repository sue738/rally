// selftest.sh attwait: a send pressed while a pasted file is still being saved waits for it and carries it
// (it went without it: the image was saved 6s after the send). Nothing is really sent: dispatch is stubbed.
// a picture in the board's own attachments (the selftest's home: nothing of yours is shown)
const AK_SHOT=()=>(live.home||'/tmp')+'/.rally/attachments/2026-09-26T14-01-02-image.png';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:true,skipped:'no claude card'};
const sent=[];const d0=window.dispatch;window.dispatch=(m)=>{sent.push(m);return Promise.resolve()};
// the send itself, not the terminal route: with this card's terminal open here, words and files are typed there instead
const pt0=window.panelTypeMsg;window.panelTypeMsg=()=>false;
try{
  panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea')&&$('#mbody .atts'),8000);
  const mb=$('#mbody'),t=$('#mbody .msg textarea');
  // a chip the way a paste leaves it: named, no path yet
  const chip=attachChip(mb,'shot.png','');
  t.value='これ見て';t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(400);
  expect('nothing goes while the file is being saved (sent '+sent.length+')',sent.length===0);
  expect('the box says it is waiting for the save',/添付を保存しています/.test(mb.textContent));
  // the save lands
  chip.dataset.path='/tmp/ak-attwait.png';chip.querySelector('.n').textContent='ak-attwait.png';
  await wait(()=>sent.length>0,3000).catch(()=>{});
  out.sent=sent.map(m=>({type:m.type,text:m.text,attachments:m.attachments}));
  expect('once saved it goes, with the file ('+JSON.stringify(out.sent)+')',sent.length===1&&(sent[0].attachments||[]).includes('/tmp/ak-attwait.png')&&/これ見て/.test(sent[0].text||''));
  // in the thread, the message shows what it carried: a thumbnail, not a block of paths
  renderHistory({agent:c.agent,session:c.id,turns:[{kind:'user',t:Date.now()-60000,text:'これ見て\n\n添付ファイル(このパスを読んでください):\n- '+AK_SHOT()+'\n- /tmp/notes.txt'},{kind:'assistant',t:Date.now()-30000,text:'見ました'}],dropped:0});
  await sleep(600);
  const u=[...document.querySelectorAll('#mhist .turn.user')].pop();
  expect('the message in the thread has the picture as a thumbnail',!!(u&&u.querySelector('.sentatt a.shot img')));
  expect('… and the other file as a chip',!!(u&&u.querySelector('.sentatt .openfile')));
  expect('… and not the block of paths',!!u&&!/添付ファイル\(このパスを/.test(u.textContent));
  post({type:'selftestshot',name:'thread'});await sleep(800);
}finally{window.dispatch=d0;window.panelTypeMsg=pt0}
return {ok:bad.length===0,bad,out};
