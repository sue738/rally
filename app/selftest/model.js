// selftest.sh model: a model picked for a session running in the panel's terminal is switched there
// (/model <name> typed first, then the message) — a message typed into the terminal carries no --model.
// Also: 会話 / ターミナル switch on the press, so a redraw between press and release cannot eat it.
// Nothing real runs: the fake claude sits in the panel's terminal, dispatch is stubbed, ptyin is recorded.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked&&!panelPty(x)&&x.model!=='fable');
if(!c)return {ok:false,bad:['no stopped claude card on the fixture board']};
const sent=[],typed=[];const d0=window.dispatch,p0=window.post;
window.dispatch=m=>{sent.push(m);return Promise.resolve()};
window.post=m=>{if(m&&m.type==='ptyin')typed.push(m.data);return p0(m)};
try{
  panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea'),8000);
  // its claude in the panel, out of sight (as after a message typed there)
  await new Promise((res,rej)=>{if(!panelPtyReady(c,true,()=>res(),'test',()=>rej(new Error('no prompt'))))rej(new Error('no terminal'))});
  const pick=$('#mbody .msg .modelmenu [data-m="fable"]');expect('fable is in the model menu',!!pick);
  if(pick)pick.click();
  const t=$('#mbody .msg textarea');t.value='MODELMSG';t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await wait(()=>typed.some(x=>/\/model fable/.test(x)),15000).catch(()=>{});
  await wait(()=>typed.some(x=>/MODELMSG/.test(x)),15000).catch(()=>{});await sleep(300);
  out.sent=sent.map(m=>m.type);out.typed=typed.slice(0,6);
  const i=typed.findIndex(x=>x==='/model fable\r'),j=typed.findIndex(x=>/MODELMSG/.test(x));
  expect('/model fable is typed into its terminal',i>=0);
  expect('… before the message',i>=0&&j>i);
  expect('the message is not sent around the terminal',!sent.length);
  const bt=$('#mbody .msg .mmodel');expect('the pick is spent: the button is back to 既定',bt&&bt.dataset.model==='');
  // the view switch on the press: the button is replaced right after it (as a refresh does)
  if($('#mbody .mviews')){
    panelSwitch('term');const b=$('#mbody .mviews button[data-p="talk"]');
    b.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));
    out.viewAfterPress=panelView;expect('会話 switches on the press',panelView==='talk');
  }else bad.push('no 会話 / ターミナル switch in the panel');
}finally{window.dispatch=d0;window.post=p0;const p=panelPty(c);if(p)ptyClose(p.id)}
return {ok:bad.length===0,bad,out};
