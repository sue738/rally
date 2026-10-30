// selftest.sh keybind: the keys are chosen from the settings panel — open it, click an action's
// key, press a new one: the new key does it and the old one no longer does; a taken key is
// refused; a ⌘ key moves too; 既定に戻す brings the old key back and the saved choice goes.
// The positive controls come first (the default key works, the unbound one does not) so that a
// scenario passing because nothing ever worked cannot pass. The last check types a real key
// into the web view (WebKit's own keydown, as typekeys does).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const type=(text,gap)=>new Promise(res=>{const cb='__typed'+Math.random().toString(36).slice(2,8);window[cb]=()=>{delete window[cb];res()};post({type:'selftesttype',text,gap:gap||0.03,cb})});
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>1,15000);
termOpen(false);kmResetAll();
const L=lanes().find(l=>l.length>=2);
if(!L)return {ok:false,bad:['no lane with two cards on the fixture board']};
const key=el=>el.dataset.agent+':'+el.dataset.id;
const tgt=()=>document.activeElement||document.body;
const press=(k,o)=>{const t=tgt();t.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...(o||{})}))};
const at=()=>sel;
const home=()=>{selectEl(L[0]);const e=L[0];e.focus({preventScroll:true})};
const btn=id=>document.querySelector('#mbody .kkey[data-id="'+id+'"]');
const saved=()=>{try{return JSON.parse(localStorage.getItem('keymap')||'null')}catch(e){return 'unreadable'}};
try{
  // 1. the defaults, both ways
  home();press('x');await sleep(60);
  expect('x is nothing on the board to start with',at()===key(L[0]));
  press('j');await sleep(60);
  expect('j (the default) moves to the next card',at()===key(L[1]));
  home();
  // 2. the panel: the button opens it, a click starts listening, the next key is the choice
  document.dispatchEvent(new CustomEvent('ak-keys'));await sleep(150);
  expect('the ⌨ button opens the settings panel',panelOpen()&&panelKey==='keys');
  expect('… with a row for each action ('+KM_DEFS.length+')',document.querySelectorAll('#mbody .kkey').length===KM_DEFS.length);
  btn('nav.down').click();await sleep(60);
  expect('clicking a key starts listening (it says so)',keyCap==='nav.down'&&/キーを押してください/.test((btn('nav.down')||{}).textContent||''));
  press('x');await sleep(80);
  expect('the next key is taken: nav.down is x',kmKey('nav.down')==='x'&&keyCap===''&&(btn('nav.down')||{}).textContent==='x');
  expect('… and saved as one versioned object holding only the change',JSON.stringify(saved())===JSON.stringify({v:1,keys:{'nav.down':'x'}}));
  btn('nav.up').click();await sleep(60);
  press('x');await sleep(80);
  expect('x on another action is refused, with the name of the one that has it, and it keeps listening',kmKey('nav.up')==='k'&&keyCap==='nav.up'&&/すでに/.test(document.querySelector('#mbody .kmsg').textContent));
  press('Escape');await sleep(80);
  expect('Esc stops listening and leaves the panel open',keyCap===''&&panelOpen()&&panelKey==='keys'&&kmKey('nav.up')==='k');
  // 3. back on the board: the new key does it, the old one does not
  closeDetail('x');await sleep(150);home();await sleep(60);
  press('j');await sleep(60);
  expect('NEGATIVE: the old key j no longer moves',at()===key(L[0]));
  press('x');await sleep(60);
  expect('the new key x moves to the next card',at()===key(L[1]));
  home();await sleep(60);
  await type('x');await sleep(150);
  out.typed={sel:at(),want:key(L[1])};
  expect('a real x typed into the web view moves too (not only a dispatched event)',at()===key(L[1]));
  // 4. a ⌘ key: ⌘/ (the ? list) moved to ⌘U
  expect('the ? list is closed',$('#help').hidden);
  kmSet('help.meta','⌘u');
  press('/',{metaKey:true});await sleep(80);
  expect('NEGATIVE: ⌘/ no longer opens the ? list',$('#help').hidden);
  press('u',{metaKey:true});await sleep(80);
  expect('⌘U opens it',!$('#help').hidden);
  expect('… and the list shows the new key',/⌘U/.test($('#help').textContent));
  press('Escape');await sleep(80);
  // 5. back to the defaults: per key, then all
  document.dispatchEvent(new CustomEvent('ak-keys'));await sleep(150);
  const rs=document.querySelector('#mbody .kreset[data-id="nav.down"]');
  expect('a changed key offers 既定に戻す',!!rs&&!rs.hidden);
  if(rs)rs.click();await sleep(80);
  expect('reset: nav.down is j again',kmKey('nav.down')==='j'&&(btn('nav.down')||{}).textContent==='j'&&kmKey('help.meta')==='⌘u');
  document.querySelector('#kall').click();await sleep(80);
  expect('全部を既定に戻す: nothing left saved, ⌘/ is the ? list key again',localStorage.getItem('keymap')===null&&kmKey('help.meta')==='⌘/');
  closeDetail('x');await sleep(150);home();await sleep(60);
  press('x');await sleep(60);
  expect('NEGATIVE: after the reset x is nothing again',at()===key(L[0]));
  press('j');await sleep(60);
  expect('… and j moves',at()===key(L[1]));
}finally{kmResetAll();if(!$('#help').hidden)$('#help').hidden=true;if(panelOpen())closeDetail('x')}
return {ok:bad.length===0,bad,out};
