// selftest.sh shifttype: capitals typed as a keyboard types them (real key events through the web view,
// Shift held) reach the message box and the panel's terminal whole and once — Hello World, Cursor —
// including while the board redraws under the typing (a working session refreshes the panel).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const type=(text,gap)=>new Promise(res=>{const cb='__typed'+Math.random().toString(36).slice(2,8);window[cb]=()=>{delete window[cb];res()};post({type:'selftesttype',text,gap:gap||0.03,cb})});
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked&&!panelPty(x));
if(!c)return {ok:false,bad:['no stopped claude card on the fixture board']};
const words='Hello World Cursor ABC Zed Quick Brown Fox';
// 1. the message box
panelPrefSet('talk');openDetail(c,false,{focus:false});await wait(()=>$('#mbody .msg textarea'),8000);
const ta=$('#mbody .msg textarea');ta.focus();await sleep(150);
let churn=setInterval(()=>{try{load()}catch(e){}},400);
await type(words,0.025);await sleep(300);clearInterval(churn);
const ta2=$('#mbody .msg textarea');out.box=ta2.value;
expect('capitals typed with Shift reach the message box whole ('+ta2.value+')',ta2.value===words);
ta2.value='';ta2.dispatchEvent(new Event('input'));
// 2. the panel's terminal
if(panelTermOK(c)){
  await new Promise((res,rej)=>{if(!panelPtyReady(c,false,()=>res(),'test',()=>rej(new Error('no prompt'))))rej(new Error('no terminal'))});
  const p=panelPty(c);p.xt.focus();await sleep(200);
  const got=[],p0=window.post;window.post=m=>{if(m&&m.type==='ptyin'&&m.id===p.id)got.push(m.data);return p0(m)};
  churn=setInterval(()=>{try{load()}catch(e){}},400);
  try{await type(words,0.025);await sleep(400)}finally{clearInterval(churn);window.post=p0}
  out.term=got.join('');
  expect('capitals typed with Shift reach the terminal whole ('+got.join('')+')',got.join('')===words);
  const q=panelPty(c);if(q)ptyClose(q.id);
}
// 3. the Japanese IME in kana mode: Shift + a letter starts a latin word inside the IME (marked text
// "C", "Cu", … "Cursor"), which Enter / Space commits — the text system's own calls, as an IME makes them
const ime=(op,text)=>new Promise(res=>{const cb='__ime'+Math.random().toString(36).slice(2,8);window[cb]=r=>{delete window[cb];res(r)};post({type:'selftestime',op,text:text||'',cb})});
const composeWord=async(w,space)=>{for(let i=1;i<=w.length;i++){await ime('mark',w.slice(0,i));await sleep(25)}await ime('insert',w);await sleep(80);if(space)await type(' ',0.02)};
{panelPrefSet('talk');openDetail(c,false,{focus:false});await wait(()=>$('#mbody .msg textarea'),8000);await sleep(300);
 const b=$('#mbody .msg textarea');b.value='';b.focus();await sleep(150);
 await composeWord('Cursor',true);await composeWord('Shift',true);await composeWord('Zed',false);
 out.imeBox=b.value;
 expect('a latin word made in the IME (Shift + letter) lands whole in the message box ('+b.value+')',b.value==='Cursor Shift Zed');
 b.value='';b.dispatchEvent(new Event('input'))}
if(panelTermOK(c)){
  openDetail(c,false,{focus:false});await sleep(300);
  await new Promise((res,rej)=>{if(!panelPtyReady(c,false,()=>res(),'test',()=>rej(new Error('no prompt'))))rej(new Error('no terminal'))});
  const p=panelPty(c);p.xt.focus();await sleep(200);
  const got=[],p0=window.post;window.post=m=>{if(m&&m.type==='ptyin'&&m.id===p.id)got.push(m.data);return p0(m)};
  try{await composeWord('Cursor',true);await composeWord('Shift',false);await sleep(300)}finally{window.post=p0}
  out.imeTerm=got.join('');
  expect('… and in the terminal ('+got.join('')+')',got.join('')==='Cursor Shift');
  const q=panelPty(c);if(q)ptyClose(q.id);
}
// 4. "？" typed through the Japanese IME must not bring a line break with it (a message came out as
// "…どう⏎？ダサい⏎？"): kana composed and committed, then ？ marked and committed, the way an IME does
{panelPrefSet('talk');openDetail(c,false,{focus:false});await wait(()=>$('#mbody .msg textarea'),8000);await sleep(300);
 const b=$('#mbody .msg textarea');b.value='';b.focus();await sleep(150);
 const kana=async(w)=>{for(let i=1;i<=w.length;i++){await ime('mark',w.slice(0,i));await sleep(25)}await ime('insert',w);await sleep(80)};
 await kana('なんで');await kana('？');await kana('ダサい');await kana('？');
 out.qBox=JSON.stringify(b.value);
 expect('？ typed through the IME brings no line break ('+JSON.stringify(b.value)+')',b.value==='なんで？ダサい？');
 b.value='';b.dispatchEvent(new Event('input'))}
closeDetail('x');
return {ok:bad.length===0,bad,out};
