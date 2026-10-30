// selftest.sh drafts: what you are writing stays (drafts, lib/ui/js/00-core.js). Real key events
// (selftesttype) into the panel's send box, 新規 and the strip's command line; the board refreshing
// and the panel redrawn under them; another card and back; a send that fails and one that goes; and a
// fresh page on the same storage — an iframe on this page's origin running the page's own script, with
// the app's bridge hidden from it. (A reload of this page would end this script with it, and a relaunch
// starts on empty storage: the selftest's storage is kept in memory.) Nothing is sent: post() keeps
// the sends to itself here, and their answers are made up.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const type=(text,gap)=>new Promise(res=>{const cb='__typed'+Math.random().toString(36).slice(2,8);window[cb]=()=>{delete window[cb];res()};post({type:'selftesttype',text,gap:gap||0.03,cb})});
const stored=()=>{try{return JSON.parse(localStorage.getItem('drafts')||'{}')}catch(e){return {}}};
const box=()=>$('#mbody .msg textarea');
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const home=(live.home||'').replace(/\/$/,'');
// stopped sessions outside the home folder: a send from the box goes through dispatch (not a terminal)
// (and not the row the docked リスト opened by itself: it is resumed in the panel's terminal, where a send is typed)
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.project&&x.project.replace(/\/$/,'')!==home&&!panelPty(x)&&openFor!==x.agent+':'+x.id);
if(cs.length<2)return {ok:true,skipped:'fewer than two stopped claude cards outside the home folder'};
const [c,c2]=cs;const key=c.agent+':'+c.id;out.card=c.id.slice(0,8);
const body0=document.body.innerHTML;
const post0=window.post,sends=[];
window.post=m=>{if(m&&(m.type==='reply'||m.type==='run')){sends.push(m);return}return post0(m)};
let frame=null;

try{
  panelPrefSet('talk');
  openDetail(c,false,{focus:false});await wait(()=>box(),5000);
  box().value='';box().dispatchEvent(new Event('input'));box().focus();await sleep(150);
  // 1. typed: in the box, and written down a moment later (no leaving the box, no switch)
  const T='drafts selftest one';
  await type(T,0.03);await sleep(700);
  out.typed=box().value;
  expect('what is typed arrives in the box ("'+box().value+'")',box().value===T);
  expect('… and is in the drafts a moment later, without leaving the box',(stored()[key]||{}).t===T);
  // 2. the board refreshes while you type: the text stays (the redraw waits), and a forced redraw keeps it too
  {const s={...live,cards:(live.cards||[]).map(x=>x.id===c.id?{...x,doingLine:'いま drafts',lastTool:'Bash-drafts'}:x)};
    applyState(s);await sleep(300);
    expect('a refresh while typing leaves the text',box().value===T);
    openDetail(openCard||c,true);await sleep(300);
    expect('a redraw of the panel keeps the text',box().value===T)}
  // 3. another card, 新規, and back
  openDetail(c2,false,{focus:false});await sleep(300);
  expect('another card shows its own box, not this text',!!box()&&box().value!==T);
  openNew();await sleep(300);$('#ntext').value='';$('#ntext').focus();await sleep(100);
  const N='drafts selftest new';
  await type(N,0.03);await sleep(500);
  openDetail(c,false,{focus:false});await sleep(300);
  expect('back from another card and 新規: the text is back ("'+(box()&&box().value)+'")',box().value===T);
  openNew();await sleep(300);
  expect('新規 again: its ask is back ("'+$('#ntext').value+'")',$('#ntext').value===N);
  openDetail(c,false,{focus:false});await sleep(300);
  // 4. a send that fails: back in the box; then one that goes: gone, from the box and the drafts
  {box().focus();box().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(300);
    const m=sends.filter(x=>x.type==='reply').pop();
    expect('Enter sends it (to the recording post) and empties the box',!!m&&m.text===T&&box().value==='');
    // (one entry per send on its way, by its token)
    expect('… while the drafts keep it aside until the answer',[].concat((stored()[key]||{}).sent||[]).some(x=>x&&x.t===T));
    if(m){window.__kanban.dispatched({token:m.token,error:'selftest: refused'});await sleep(300)}
    expect('a failed send: the text is back in the box ("'+box().value+'")',box().value===T);
    box().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(300);
    const m2=sends.filter(x=>x.type==='reply').pop();
    if(m2&&m2!==m){window.__kanban.dispatched({token:m2.token,ok:true});await sleep(300)}
    expect('a send that went: the box is empty and the draft is gone',box().value===''&&!stored()[key])}
  // 5. written again, with the strip's line typed and not run; then a fresh page on the same storage
  const T2='drafts selftest two';
  box().focus();await type(T2,0.03);await sleep(200);
  termOpen(true);await sleep(200);const tin=$('#termin');tin.value='';tin.focus();await sleep(100);
  const L='echo drafts not run';
  await type(L,0.03);await sleep(500);
  expect('the strip\'s typed line is written down ("'+localStorage.getItem('termline')+'")',localStorage.getItem('termline')===L);
  const src=[...document.scripts].map(s=>s.textContent).find(t=>t.includes('function openDetail('));
  frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-6000px;top:0;width:1280px;height:800px;border:0';
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"></head><body>'+body0+'</body></html>';
  document.body.appendChild(frame);await new Promise(r=>{frame.onload=r;setTimeout(r,5000)});
  const w=frame.contentWindow;
  expect('the fresh page shares this page\'s storage',w.localStorage.getItem('drafts')===localStorage.getItem('drafts'));
  // the bridge hidden: the fresh page asks nothing of the app (its native is false)
  w.addEventListener('error',e=>{out.frameErr=(out.frameErr||[]).concat(String(e.message)+' @'+e.lineno)});
  const sc=w.document.createElement('script');
  sc.textContent='(function(){'+src.replace(/window\.webkit/g,'window.__noBridge')+'\n;window.__probe={openDetail,openNew,applyState,native,box:()=>document.querySelector("#mbody .msg textarea"),ntext:()=>document.querySelector("#ntext"),termin:()=>document.querySelector("#termin"),toast:()=>(document.querySelector("#mbody .toast")||{}).textContent||""}})()';
  // (as this page does in a selftest: no panel of its own at start, the one opened here is the one checked)
  const boot=(win,code)=>{try{win.__akSelftest=true;win.eval(code)}catch(e){out.frameErr=(out.frameErr||[]).concat([typeof e,e&&e.name,e&&e.message,String(e),e&&e.line].join(" | ").slice(0,400))}};
  boot(w,sc.textContent);await sleep(500);
  const P=w.__probe;
  expect('the fresh page ran',!!P);
  if(P){
    out.freshNative=P.native;
    expect('… without the app\'s bridge',P.native===false);
    P.applyState(JSON.parse(JSON.stringify(live)));await sleep(300);
    const fc=JSON.parse(JSON.stringify((live.cards||[]).find(x=>x.id===c.id)||c));
    P.openDetail(fc,false,{focus:false});await sleep(300);
    out.fresh={box:P.box()&&P.box().value,termin:P.termin()&&P.termin().value};
    expect('★ a fresh page: the send box has what was being written ("'+out.fresh.box+'")',!!P.box()&&P.box().value===T2);
    expect('★ … the strip has the line typed and not run ("'+out.fresh.termin+'")',!!P.termin()&&P.termin().value===L);
    P.openNew();await sleep(300);
    out.fresh.ntext=P.ntext()&&P.ntext().value;
    expect('★ … and 新規 has its ask ("'+out.fresh.ntext+'")',!!P.ntext()&&P.ntext().value===N);
  }
  // 6. a send never answered, then a fresh page: the words come back, with a word to check first
  if(P){frame.remove();frame=null}
  {openDetail(c,false,{focus:false});await sleep(200);box().focus();
    box().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(300);
    expect('sent (no answer yet): the box is empty',box().value==='');
    frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-6000px;top:0;width:1280px;height:800px;border:0';
    frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"></head><body>'+body0+'</body></html>';
    document.body.appendChild(frame);await new Promise(r=>{frame.onload=r;setTimeout(r,5000)});
    const w2=frame.contentWindow;
    boot(w2,sc.textContent);await sleep(500);
    const P2=w2.__probe;
    if(P2){P2.applyState(JSON.parse(JSON.stringify(live)));await sleep(300);
      P2.openDetail(JSON.parse(JSON.stringify((live.cards||[]).find(x=>x.id===c.id)||c)),false,{focus:false});const t0=P2.toast();await sleep(300);
      out.unanswered={box:P2.box()&&P2.box().value,toast:t0,toastLater:P2.toast()};
      expect('★ a send the page never heard back about: a fresh page puts the words back ("'+out.unanswered.box+'")',!!P2.box()&&P2.box().value===T2);
      expect('… saying to check the card first',/確かめ/.test(out.unanswered.toast))}
    else expect('the second fresh page ran',false);
    // (answered after all: the draft goes)
    const m3=sends.filter(x=>x.type==='reply').pop();if(m3){window.__kanban.dispatched({token:m3.token,ok:true});await sleep(200)}
  }
}catch(e){bad.push('threw: '+String(e)+' '+(e&&e.stack||''))}
finally{
  if(frame)frame.remove();
  window.post=post0;
  // leave nothing behind: the box, 新規 and the strip empty, and their drafts with them
  try{openNew();await sleep(100);$('#ntext').value='';$('#ntext').dispatchEvent(new Event('input'));keepUnsent();
    const t=$('#termin');if(t){t.value='';t.dispatchEvent(new Event('input'))}
    openDetail(c,false,{focus:false});await sleep(100);if(box()){box().value='';keepUnsent()}closeDetail('selftest');termOpen(false)}catch(e){}
}
out.sends=sends.length;out.left=Object.keys(stored());
return {ok:bad.length===0,bad,...out};
