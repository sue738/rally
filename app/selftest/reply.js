// selftest.sh reply: replying to one message from the detail panel's 会話. Nothing is really sent:
// dispatch and panelSlash are stubbed to record what a send would carry, and put back at the end.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
// not the row the docked リスト opened by itself: it is resumed in the panel's terminal, where a send is typed, not dispatched
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!panelPty(x)&&openFor!==x.agent+':'+x.id);
if(!cs.length)return {ok:true,skipped:'no claude card'};
const sent=[],slashed=[];const d0=window.dispatch,p0=window.panelSlash;
window.dispatch=(m)=>{sent.push(m);return Promise.resolve()};
window.panelSlash=(c,cmd)=>{slashed.push(cmd);return true};
try{
  // a card whose conversation has an answer in it
  let c=null;
  for(const x of cs.slice(0,6)){panelPrefSet('talk');openDetail(x,false,{focus:false});
    if(await wait(()=>document.querySelector('#mhist .turn.assistant[data-t] .rbtn'),8000).then(()=>true,()=>false)){c=x;break}}
  if(!c)return {ok:true,skipped:'no claude card with an answer in its conversation'};
  const key=c.agent+':'+c.id;out.card=c.id.slice(0,8);
  const box=()=>$('#mbody .msg textarea'),chip=()=>$('#mbody .replychip');
  // a second Enter when the first one only picked from the /command list (as panelterm does)
  const enter=t=>t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  const send=async(v)=>{const t=box();t.value=v;t.dispatchEvent(new Event('input'));enter(t);await sleep(300);if(t.value.trim()){enter(t);await sleep(300)}};
  expect('the conversation offers ↩ on turns (user or assistant only)',[...document.querySelectorAll('#mhist .rbtn')].every(b=>{const t=b.closest('.turn');return t.classList.contains('assistant')||t.classList.contains('user')&&!t.classList.contains('cmd')&&!t.classList.contains('pending')}));
  // ↩ on the last answer
  // looked up each time: a redraw of the panel puts new nodes in the conversation
  const lastA=()=>[...document.querySelectorAll('#mhist .turn.assistant[data-t]')].pop();
  lastA().querySelector('.rbtn').click();await sleep(200);
  expect('↩ on the last answer puts a reply chip in the send box, above the attachments',!!chip()&&chip().nextElementSibling===$('#mbody .atts'));
  expect('… and the box has the keys',document.activeElement===box());
  out.chip=chip()&&chip().textContent;
  {const rx=chip().querySelector('.rx'),rx0=rx.textContent;rx.textContent='絞り込めます。「明らかに広告」は次の2つに限ります。'.repeat(12);await sleep(50);const r=chip().getBoundingClientRect(),m=$('#mbody').getBoundingClientRect();out.chipBox=[Math.round(r.left),Math.round(r.right),Math.round(m.left),Math.round(m.right)];
   expect('the chip stays inside the panel, however long the quote ('+out.chipBox+')',r.right<=m.right+1&&r.left>=m.left-1);rx.textContent=rx0}
  // the chip survives a redraw of the panel
  openDetail(c,true);await sleep(200);
  expect('the chip survives a redraw of the panel',!!chip());
  // a send carries the header, the quote and the comment
  await send('selftest: この部分について');
  const m=sent.find(x=>x.type==='reply');out.text=m&&m.text;
  expect('a send with a chip starts with [返信]',!!m&&/^\[返信\] \d\d:\d\d のあなたの回答\(\d+件前\)への返信:\n> /.test(m.text));
  expect('… and ends with the comment as typed',!!m&&m.text.endsWith('\n\nselftest: この部分について'));
  expect('… and the chip is gone after the send',!chip());
  expect('↑ history keeps the comment only',(JSON.parse(localStorage.getItem('senthist')||'[]').slice(-1)[0])==='selftest: この部分について');
  const echo=[...document.querySelectorAll('#mhist .turn.pending')].pop();
  expect('the sent reply is drawn with a one-line quote, not the quote twice',!!echo&&!!echo.querySelector('.rq')&&!/^> /m.test(echo.textContent));
  // a /command is never wrapped, and the chip stays for the next message
  document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'R',shiftKey:true,bubbles:true}));await sleep(200);
  expect('⇧R replies to the newest answer',!!chip()&&replyRefs.get(key)&&replyRefs.get(key).who==='assistant');
  const n0=sent.length;await send('/compact');
  expect('/compact with a chip goes as /compact, unwrapped',slashed[slashed.length-1]==='/compact'&&sent.slice(n0).every(x=>!/\[返信\]/.test(x.text||'')));
  expect('… and the chip stays',!!chip());
  // × drops it; Esc in an empty box does too
  chip().querySelector('.rclose').click();await sleep(100);
  expect('× removes the chip',!chip()&&!replyRefs.has(key));
  lastA().querySelector('.rbtn').click();await sleep(100);const t=box();t.value='';t.dispatchEvent(new Event('input'));t.focus();
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(100);
  expect('Esc in an empty box removes the chip (and the panel stays open)',!chip()&&!$('#detail').hidden);
  // ⌫ at the start of the box takes it off like a character; with text after the caret it stays
  {lastA().querySelector('.rbtn').click();await sleep(100);const t2=box();t2.value='abc';t2.dispatchEvent(new Event('input'));t2.focus();t2.setSelectionRange(3,3);
   t2.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));await sleep(100);
   expect('⌫ in the middle of the text leaves the chip',!!chip());
   t2.setSelectionRange(0,0);t2.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));await sleep(100);
   expect('⌫ at the very start removes the chip, and the text stays',!chip()&&t2.value==='abc');
   t2.value='';t2.dispatchEvent(new Event('input'))}
  // a selection inside one answer offers ↩ ここに返信, and quotes it verbatim
  {const la=lastA(),md=la.querySelector('.md')||la;const w=document.createTreeWalker(md,NodeFilter.SHOW_TEXT);let n=null;while(w.nextNode()){if(w.currentNode.textContent.trim().length>=6){n=w.currentNode;break}}
    if(n){const r=document.createRange();r.setStart(n,0);r.setEnd(n,Math.min(n.textContent.length,24));const s=getSelection();s.removeAllRanges();s.addRange(r);
      const want=String(s).trim();$('#mhist').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await sleep(100);
      const f=document.getElementById('rfloat');expect('a selection in one answer shows 「↩ ここに返信」',!!f&&!f.hidden);
      if(f&&!f.hidden){f.click();await sleep(100);expect('… which makes a chip quoting the selection',!!chip()&&replyRefs.get(key)&&replyRefs.get(key).sel===want)}}
    else out.noSelText=true}
  // left for the screenshot: a chip in the box, and the reply drawn in the thread
  if(!chip())lastA().querySelector('.rbtn').click();
  box().value='ここの続きをお願いします';box().dispatchEvent(new Event('input'));box().blur();
  {const h=$('#mhist');h.scrollTop=h.scrollHeight;await sleep(300)}
  out.sends=sent.length;out.slashed=slashed;
}finally{window.dispatch=d0;window.panelSlash=p0}
expect('dispatch is put back',window.dispatch===d0);
return {ok:bad.length===0,bad,...out};
