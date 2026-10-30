// selftest.sh cardstep: ⌘] / ⌘[ move the panel to the next / previous card from the message box and
// from the panel's own terminal (where Esc belongs to Claude) — two keys; the keys land in the same
// place on the new card, and what was being written stays with its card.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>1,15000);termOpen(false);
const F=lanes().flat();const key=e=>e.dataset.agent+':'+e.dataset.id;
const A=(live.cards||[]).find(c=>c.agent+':'+c.id===key(F[0])),B=(live.cards||[]).find(c=>c.agent+':'+c.id===key(F[1]));
if(!A||!B)return {ok:false,bad:['fewer than two cards on the fixture board']};
const press=(el,k)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:k,metaKey:true,bubbles:true,cancelable:true}));
const ok=c=>openCard&&openCard.agent+':'+openCard.id===c.agent+':'+c.id;
try{
  panelPrefSet('talk');openDetail(A,false);await wait(()=>$('#mbody .msg textarea'),5000);
  let t=$('#mbody .msg textarea');t.focus();t.value='cardstep draft A';t.dispatchEvent(new Event('input'));
  press(t,']');await sleep(400);
  expect('⌘] in the message box: the panel is on the next card',ok(B));
  const t2=$('#mbody .msg textarea');expect('… with the keys in its message box',document.activeElement===t2);
  press(t2,'[');await sleep(400);
  expect('⌘[ comes back',ok(A));
  expect('… and what was written there is still there',($('#mbody .msg textarea')||{}).value==='cardstep draft A');
  {const b=$('#mbody .msg textarea');b.value='';b.dispatchEvent(new Event('input'))}
  // from the panel's own terminal
  if(panelTermOK(A)){
    await new Promise((res,rej)=>{if(!panelPtyReady(A,false,()=>res(),'test',()=>rej(new Error('no prompt'))))rej(new Error('no terminal'))});
    const p=panelPty(A);p.xt.focus();await sleep(100);out.inTerm=inPty();
    press(document.activeElement,']');await sleep(500);
    expect('⌘] in the panel terminal: the panel is on the next card',ok(B));
    expect("… and the keys are not left in the old card's terminal",!(document.activeElement&&document.activeElement.closest&&p.el.contains(document.activeElement)));
    press(document.activeElement||document.body,'[');await sleep(400);
    const q=panelPty(A);if(q)ptyClose(q.id);
  }else out.term='no panel terminal here';
  // ↑ ↓ with ⌥ or ⌘: the card before / after, from the message box
  {panelPrefSet('talk');openDetail(A,false);await wait(()=>$('#mbody .msg textarea'),5000);
   const tb=$('#mbody .msg textarea');tb.focus();
   const ar=(el,k,alt)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:k,altKey:!!alt,metaKey:!alt,bubbles:true,cancelable:true}));
   ar(tb,'ArrowDown',false);await sleep(400);expect('⌘↓: the next card',ok(B));
   ar($('#mbody .msg textarea'),'ArrowUp',false);await sleep(400);expect('⌘↑: the previous card',ok(A));
   const wa=new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true,cancelable:true});$('#mbody .msg textarea').dispatchEvent(wa);
   expect('⌥→ is the text field\'s (a word at a time): not taken',!wa.defaultPrevented&&ok(A));}
  // ← → : between the three places, one step at a time (list / panel / terminal)
  {boardView!=='list'&&setView('list');await sleep(300);
   panelPrefSet('talk');openDetail(A,false);await wait(()=>$('#mbody .msg textarea'),5000);
   const tb=$('#mbody .msg textarea');tb.focus();
   const ar=(el,k,alt)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:k,altKey:!!alt,metaKey:!alt,bubbles:true,cancelable:true}));
   out.wide=innerWidth;
   ar(tb,'ArrowRight',false);await sleep(300);
   expect('⌘→ from the message box: the keys are in the terminal',paneWhere()==='strip');
   ar(document.activeElement||document.body,'ArrowLeft',false);await sleep(300);
   expect('⌘← from the terminal: back in the panel',paneWhere()==='panel');
   ar(document.activeElement||document.body,'ArrowLeft',false);await sleep(300);
   expect('⌘← from the panel: on the list',paneWhere()==='list'&&!$('#detail').contains(document.activeElement));
   ar(document.activeElement||document.body,'ArrowRight',false);await sleep(300);
   expect('⌘→ from the list: in the panel',paneWhere()==='panel');
   const ev=new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true});
   ar(document.activeElement||document.body,'ArrowLeft',false);await sleep(200);
   const ev2=new KeyboardEvent('keydown',{key:'ArrowLeft',metaKey:true,bubbles:true,cancelable:true});document.dispatchEvent(ev2);
   expect('⌘← on the list (nothing further left) is left alone, not swallowed',!ev2.defaultPrevented);}
  // Enter after a click on the terminal strip that lands on none of its fields: into the terminal, not the middle box
  {boardView!=='list'&&setView('list');await sleep(300);panelPrefSet('talk');openDetail(A,false);await wait(()=>$('#mbody .msg textarea'),5000);termOpen(true);await sleep(300);
   const bx=$('#mbody .msg textarea');bx.blur();
   $('#term').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));await sleep(100);
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await sleep(300);
   out.enterWhere=paneWhere();
   expect('Enter after a click on the terminal strip goes into the strip, not the middle box',paneWhere()==='strip'&&document.activeElement!==$('#mbody .msg textarea'));}
}finally{closeDetail('x')}
return {ok:bad.length===0,bad,out};
