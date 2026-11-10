// selftest.sh camera: カメラで撮る beside +file — in a session's message box and in 新規. A press asks the app, the
// photo comes back saved as an attachment (a chip with its picture), and the send carries its path. The app draws
// the selftest's photo itself: no camera is turned on here. Nothing is really sent: dispatch is stubbed.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:true,skipped:'no claude card'};
const sent=[];const d0=window.dispatch;window.dispatch=(m)=>{sent.push(m);return Promise.resolve()};
// the send itself, not the terminal route: with this card's terminal open here, words and files are typed there instead
const pt0=window.panelTypeMsg;window.panelTypeMsg=()=>false;
const shot=async(box)=>{
  await wait(()=>{const x=box.querySelector('.atts .att');return x&&x.dataset.path},8000).catch(()=>{});
  const a=box.querySelector('.atts .att');if(!a||!a.dataset.path)return null;
  const im=a.querySelector('img');
  if(im)await wait(()=>im.complete,4000).catch(()=>{});
  return {path:a.dataset.path,name:a.querySelector('.n').textContent,w:im?im.naturalWidth:0};
};
try{
  // a session's message box
  panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea')&&$('#mbody .atts'),8000);
  const mb=$('#mbody'),cam=$('#mbody .foot .cambtn'),file=$('#mbody .foot .attbtn');
  expect('the message box has カメラで撮る',!!cam);
  expect('… right after +file',!!cam&&!!file&&file.nextElementSibling===cam);
  expect('… saying what it does',!!cam&&/カメラ|photo/i.test(cam.title||''));
  out.label=cam&&cam.textContent;
  if(cam)cam.click();
  out.panel=await shot(mb);
  expect('the photo lands in the box as a saved attachment ('+JSON.stringify(out.panel)+')',!!out.panel&&/attachments[^/]*\/[^/]*camera\.jpg$/.test(out.panel.path));
  expect('… a picture that opens (the file is a real image)',!!out.panel&&out.panel.w>0);
  post({type:'selftestshot',name:'panel'});await sleep(800);
  const t=$('#mbody .msg textarea');t.value='これ読んで';t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await wait(()=>sent.length>0,3000).catch(()=>{});
  out.sent=sent.map(m=>({type:m.type,text:m.text,attachments:m.attachments}));
  expect('the send carries the photo ('+JSON.stringify(out.sent)+')',sent.length===1&&!!out.panel&&(sent[0].attachments||[]).includes(out.panel.path)&&/これ読んで/.test(sent[0].text||''));
  // a second photo is a second file, not the first written over
  attachClear(mb);const cam2=$('#mbody .foot .cambtn');if(cam2)cam2.click();
  const again=await shot(mb);out.again=again&&again.path;
  expect('a second photo is its own file',!!again&&!!out.panel&&again.path!==out.panel.path);
  attachClear(mb);closeDetail('x');await sleep(200);
  // 新規
  openNew();await wait(()=>$('#ntext')&&$('#mbody .nsbar'),8000);
  const ncam=$('#mbody .nsbar .cambtn');
  expect('新規 has カメラで撮る beside +',!!ncam&&!!ncam.previousElementSibling&&ncam.previousElementSibling.classList.contains('attbtn'));
  expect('… named for a screen reader',!!ncam&&!!ncam.getAttribute('aria-label'));
  if(ncam)ncam.click();
  out.fresh=await shot($('#mbody'));
  expect('the photo lands in 新規 too ('+JSON.stringify(out.fresh)+')',!!out.fresh&&/camera\.jpg$/.test(out.fresh.path)&&out.fresh.w>0);
  // as a pasted file does: a photo alone is something to start with
  expect('… and 開始 opens for it',!!$('#mbody .nsgo')&&!$('#mbody .nsgo').disabled);
  post({type:'selftestshot',name:'new'});await sleep(800);
  // ⌘K has it
  const pal=PAL_ACTIONS.find(x=>/カメラで撮る|Take a photo/.test(x.t));
  expect('⌘K offers カメラで撮る while the box is open',!!pal&&pal.when());
  attachClear($('#mbody'));closeDetail('x');
}finally{window.dispatch=d0;window.panelTypeMsg=pt0}
return {ok:bad.length===0,bad,out};
