// selftest.sh typekeys: letters typed on the keyboard all arrive — in the panel's terminal,
// the panel's message box and the strip's command line — while the board refreshes and the
// panel redraws under your fingers. Real key events (selftesttype), not KeyboardEvents made here.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const type=(text,gap)=>new Promise(res=>{const cb='__typed'+Math.random().toString(36).slice(2,8);window[cb]=()=>{delete window[cb];res()};post({type:'selftesttype',text,gap:gap||0.03,cb})});
const scr=p=>{const b=p.xt.buffer.active;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';return t};
// where each key went: a keydown on anything but a text field is a key the board could take
const trail=[];const onKey=e=>{const a=document.activeElement;trail.push(e.key+'@'+(a?(a.id||a.className||a.tagName):'-'))};
document.addEventListener('keydown',onKey,true);
const blurs=[];const onOut=e=>{if(e.target&&e.target.closest&&e.target.closest('#mterm, #ptys'))blurs.push((e.target.className||e.target.tagName)+'→'+(e.relatedTarget?(e.relatedTarget.id||e.relatedTarget.className||e.relatedTarget.tagName):'none'))};
document.addEventListener('focusout',onOut,true);
// the board moving under you: a card that changed (its panel redraws), a reload, a repaint
const churn=c=>{let n=0;const t=setInterval(()=>{n++;
  const s={...live,cards:(live.cards||[]).map(x=>x.id===c.id?{...x,doingLine:'いま '+n,lastTool:'Bash'+n}:x)};
  try{applyState(s)}catch(e){out.churnErr=String(e)}
  if(n%3===0)try{load()}catch(e){}
  if(n%2===0)try{ptyRepaintAll();const p=panelPty(c);if(p)ptyFit(p)}catch(e){}
},120);return ()=>clearInterval(t)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive);
if(!cs.length)return {ok:true,skipped:'no stopped claude card'};
const c=cs[0];panelView='term';
openDetail(c,false,{focus:false});
await wait(()=>panelPty(c),6000).catch(()=>0);
const p=panelPty(c);
expect('the stopped session resumes in the panel',!!p);
if(p){
  await wait(()=>/fake claude/.test(scr(p)),6000).catch(()=>0);await sleep(400);
  // 1. the panel's terminal: click it, then type
  p.xt.focus();await sleep(150);
  const want='hello everyone e e e';
  const stop=churn(c);
  await type(want,0.04);
  await sleep(300);stop();await sleep(600);
  const s=scr(p);out.term={screen:s.replace(/\n+/g,'|').slice(0,300),focus:document.activeElement&&(document.activeElement.className||document.activeElement.tagName)};
  expect('every letter typed into the panel\'s terminal reaches it ("'+want+'"; screen: '+s.replace(/\s+/g,' ').slice(-120)+')',s.includes(want));
  expect('the terminal keeps the keys through the redraws',!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm')));
  out.termTrail=trail.splice(0).join(' ');out.termBlurs=blurs.splice(0);
  // the same with a redraw forced through openDetail (a lane move, a done…) while typing
  p.xt.focus();await sleep(150);
  const want2='seven eleven';let k=0;const t2=setInterval(()=>{k++;openDetail(openCard,true)},150);
  await type(want2,0.04);clearInterval(t2);await sleep(600);
  const s2=scr(p);
  expect('… and through a panel redraw ("'+want2+'"; screen: '+s2.replace(/\s+/g,' ').slice(-120)+')',s2.includes(want2));
  expect('… still with the keys after it',!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm')));
  out.term2Trail=trail.splice(0).join(' ');out.term2Blurs=blurs.splice(0);
}
// 1b. the same through the Japanese IME (ことえり): its 英字 mode is an input mode of the IME, not a
// keyboard layout, so WebKit hands each letter over as keydown keyCode 229 and inserts the text
// afterwards (insertTextAsync: after a 0 ms timer may already have run). Emulated here.
const ime229=(ta,ch)=>{const e=new KeyboardEvent('keydown',{key:ch,code:'Key'+ch.toUpperCase(),bubbles:true,cancelable:true,composed:true});
  Object.defineProperty(e,'keyCode',{get:()=>229});Object.defineProperty(e,'which',{get:()=>229});ta.dispatchEvent(e);return e};
const imeType=async(ta,text,late)=>{for(const ch of text){const kd=ime229(ta,ch);
  await sleep(late);                                   // the text comes in after the key
  if(!kd.defaultPrevented){ta.value+=ch;ta.dispatchEvent(new InputEvent('input',{data:ch,inputType:'insertText',bubbles:true,composed:true}))}
  ta.dispatchEvent(new KeyboardEvent('keyup',{key:ch,bubbles:true}));await sleep(15)}};
const imeCompose=async(ta,word)=>{            // かな mode: a word composed, then committed as it is
  ime229(ta,word[0]);ta.dispatchEvent(new CompositionEvent('compositionstart',{data:'',bubbles:true}));
  for(let i=1;i<=word.length;i++){if(i>1)ime229(ta,word[i-1]);const d=word.slice(0,i);ta.dispatchEvent(new CompositionEvent('compositionupdate',{data:d,bubbles:true}));
    ta.value=ta.value.slice(0,ta.value.length-(i-1))+d;ta.dispatchEvent(new InputEvent('input',{data:d,inputType:'insertCompositionText',isComposing:true,bubbles:true,composed:true}));await sleep(20)}
  ime229(ta,'Enter');ta.dispatchEvent(new CompositionEvent('compositionend',{data:word,bubbles:true}));await sleep(60)};
if(p&&!p.gone){openDetail(c,false,{focus:false});await sleep(500);p.xt.focus();await sleep(150);
  const ta=p.xt.textarea;const before=scr(p);
  const stop=churn(c);
  for(const [late,w] of [[0,'ime now '],[4,'ime soon '],[25,'ime late eee ']])await imeType(ta,w,late);
  await imeCompose(ta,'hey');
  stop();await sleep(600);
  const s=scr(p);const want='ime now ime soon ime late eee hey';
  out.ime={screen:s.replace(/\s+/g,' ').slice(-90)};
  expect('every letter typed through the IME (keyCode 229, text inserted after the key) reaches the terminal once ("'+want+'"; screen: '+s.replace(/\s+/g,' ').slice(-90)+')',s.replace(/\s+/g,' ').includes(want));   // a wrapped line is one line here (the width moves it)
  expect('… with the keys still in the terminal',!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm')))}
// 2. the panel's message box (会話)
{panelSwitch('talk');await sleep(400);
  const t=$('#mbody .msg textarea');
  if(!t)bad.push('no message box in 会話');
  else{t.value='';t.focus();await sleep(100);
    const stop=churn(c);const want='hello everyone e e e';
    await type(want,0.04);await sleep(300);stop();await sleep(500);
    const t1=$('#mbody .msg textarea');out.box={val:t1&&t1.value,focus:document.activeElement&&(document.activeElement.className||document.activeElement.tagName)};
    expect('every letter typed into the message box stays in it (got "'+(t1&&t1.value)+'")',!!t1&&t1.value===want);
    out.boxTrail=trail.splice(0).join(' ');
    // the IME's keys (229) are the box's: nothing on the page takes them
    if(t1){t1.focus();const kd=['e','n','j','/'].map(k=>ime229(t1,k));expect('IME keys (229) in the message box are left to the IME',kd.every(x=>!x.defaultPrevented)&&document.activeElement===t1&&!pal)}
    if(t1){t1.value='';t1.dispatchEvent(new Event('input'))}}
  panelSwitch('term');await sleep(300)}
// 3. the strip's command line
{closeDetail('selftest');await sleep(300);termOpen(true);ptyMark('cmd');
  const i=paneIn(activePane());
  if(!i)bad.push('no command line in the strip');
  else{i.value='';i.focus();await sleep(100);
    const stop=churn(c);const want='echo hello everyone e e e';
    await type(want,0.04);await sleep(300);stop();await sleep(400);
    out.cmd={val:i.value,focus:document.activeElement&&(document.activeElement.id||document.activeElement.className||document.activeElement.tagName)};
    expect('every letter typed into the command line stays in it (got "'+i.value+'")',i.value===want);
    out.cmdTrail=trail.splice(0).join(' ');i.value='';
    i.focus();const kd=['e','n','t','j'].map(k=>ime229(i,k));expect('IME keys (229) in the command line are left to the IME',kd.every(x=>!x.defaultPrevented)&&document.activeElement===i)}}
// 4. the board's one-letter keys never act from inside a terminal
{const q=p&&!p.gone?p:null;if(q){openDetail(c,false,{focus:false});await sleep(500);q.xt.focus();await sleep(100);
  const sel0=sel,theme0=document.documentElement.dataset.theme,view0=boardView;
  for(const k of ['j','k','o','t','e','E','n','f','v','L','1','i','a','s','p','?','.'])q.xt.textarea.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
  await sleep(300);
  expect('one-letter board keys typed in the terminal do nothing to the board',sel===sel0&&document.documentElement.dataset.theme===theme0&&boardView===view0&&$('#help').hidden&&!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.xterm')))}}
// Shift+Enter in the terminal: a newline for Claude (ESC CR), plain and as the IME sends it (keyCode 229, key not "Enter"), and the IME's line break after it is not sent again
{const q=p&&!p.gone?p:null;if(q){openDetail(c,false,{focus:false});await sleep(500);q.xt.focus();await sleep(100);
  const got=[],p0=window.post;window.post=m=>{if(m&&m.type==='ptyin'&&m.id===q.id)got.push(m.data);return p0(m)};
  try{
    const ta=q.xt.textarea;
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,shiftKey:true,bubbles:true,cancelable:true}));await sleep(150);
    out.shiftEnter=got.slice();got.length=0;
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Process',code:'Enter',keyCode:229,shiftKey:true,bubbles:true,cancelable:true}));
    ta.dispatchEvent(new InputEvent('input',{inputType:'insertLineBreak',bubbles:true}));await sleep(150);
    out.shiftEnterIme=got.slice();
  }finally{window.post=p0}
  expect('Shift+Enter sends a newline for Claude (ESC CR) ('+JSON.stringify(out.shiftEnter)+')',out.shiftEnter.length===1&&out.shiftEnter[0]==='\x1b\r');
  expect('… also as the Japanese IME sends it, and its line break is not sent again ('+JSON.stringify(out.shiftEnterIme)+')',out.shiftEnterIme.length===1&&out.shiftEnterIme[0]==='\x1b\r');
}}
// Shift + a key in the terminal, one press each: the capital / the symbol arrives once and whole —
// plain, and as the Japanese IME hands it over (keyCode 229, the character as the input's data)
{const q=p&&!p.gone?p:null;if(q){openDetail(c,false,{focus:false});await sleep(500);q.xt.focus();await sleep(100);
  const got=[],p0=window.post;window.post=m=>{if(m&&m.type==='ptyin'&&m.id===q.id)got.push(m.data);return p0(m)};
  const kd=(key,code,kc,extra)=>q.xt.textarea.dispatchEvent(new KeyboardEvent('keydown',{key,code,keyCode:kc,which:kc,shiftKey:true,bubbles:true,cancelable:true,...extra}));
  try{
    // (letters arrive on keypress, which a synthetic keydown does not fire: only the symbols here)
    const plain=[['!','Digit1',49],['?','Slash',191],['_','Minus',189],[':','Semicolon',186],['"','Quote',222],['(','Digit9',57]];
    out.shiftPlain=[];
    for(const [k,cd,kc] of plain){got.length=0;kd(k,cd,kc);await sleep(60);out.shiftPlain.push(k+'→'+JSON.stringify(got.slice()))}
    expect('Shift + key: the character, once ('+out.shiftPlain.join(' ')+')',plain.every(([k],i)=>out.shiftPlain[i]===k+'→'+JSON.stringify([k])));
    // as the IME sends it: keydown 229, then the text as an input event
    const ta=q.xt.textarea;out.shiftIme=[];
    for(const ch of ['A','C','Z']){got.length=0;
      kd('Process','Key'+ch,229);ta.value=ch;ta.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:ch,bubbles:true}));await sleep(100);
      out.shiftIme.push(ch+'→'+JSON.stringify(got.slice()));ta.value=''}
    expect('… and as the IME hands it over, once ('+out.shiftIme.join(' ')+')',['A','C','Z'].every((ch,i)=>out.shiftIme[i]===ch+'→'+JSON.stringify([ch])));
  }finally{window.post=p0}
}}
// Shift held, then letters — as the input source of the person who lost the first one delivers them
// (from ~/.rally/keylog.jsonl): the text arrives BEFORE its keydown (keyCode 229), no keypress:
// keydown Shift · input L · keydown 229 · keyup · input L · keydown 229 …  Each L reaches the terminal once
{const q=p&&!p.gone?p:null;if(q){openDetail(c,false,{focus:false});await sleep(500);q.xt.focus();await sleep(100);
  const got=[],p0=window.post;window.post=m=>{if(m&&m.type==='ptyin'&&m.id===q.id&&!m.reply)got.push(m.data);return p0(m)};
  try{
    const ta=q.xt.textarea,ev=(t,o)=>ta.dispatchEvent(new KeyboardEvent(t,{bubbles:true,cancelable:true,composed:true,...o}));
    ev('keydown',{key:'Shift',code:'ShiftLeft',keyCode:16,shiftKey:true});await sleep(60);
    for(const ch of ['L','L','L']){
      ta.value=ch;ta.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:ch,bubbles:true,composed:true}));await sleep(30);
      ev('keydown',{key:ch,code:'Key'+ch,keyCode:229,shiftKey:true});await sleep(30);
      ev('keyup',{key:ch,code:'Key'+ch,keyCode:76,shiftKey:true});await sleep(120)}
    ev('keyup',{key:'Shift',code:'ShiftLeft',keyCode:16});await sleep(200);
    out.shiftFirst=got.slice();
  }finally{window.post=p0}
  expect('Shift held, the text before its keydown: every L reaches the terminal, the first one too ('+JSON.stringify(out.shiftFirst)+')',out.shiftFirst.join('')==='LLL');
}}
// Enter that commits IME text with Shift still held (typing ？ is Shift + /): the composition has already
// ended when it arrives (keyCode 229). It is the IME's, not a line break — from the input record
{const q=p&&!p.gone?p:null;if(q){openDetail(c,false,{focus:false});await sleep(500);q.xt.focus();await sleep(100);
  const got=[],p0=window.post;window.post=m=>{if(m&&m.type==='ptyin'&&m.id===q.id&&!m.reply)got.push(m.data);return p0(m)};
  try{
    const ta=q.xt.textarea;
    ta.dispatchEvent(new CompositionEvent('compositionstart',{data:'',bubbles:true}));
    ta.dispatchEvent(new CompositionEvent('compositionend',{data:'？',bubbles:true}));
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,shiftKey:true,bubbles:true,cancelable:true}));await sleep(150);
    out.imeShiftEnter=got.slice();got.length=0;
    await sleep(400);   // well after the composition: a real Shift+Enter (as the IME hands it) is still a line break
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Process',code:'Enter',keyCode:229,shiftKey:true,bubbles:true,cancelable:true}));await sleep(150);
    out.lateShiftEnter=got.slice();
  }finally{window.post=p0}
  expect('the IME\'s Enter (Shift still held) right after a composition sends no line break ('+JSON.stringify(out.imeShiftEnter)+')',out.imeShiftEnter.every(d=>!/\x1b\r/.test(d)));
  expect('… and a Shift+Enter well after it is still a line break ('+JSON.stringify(out.lateShiftEnter)+')',out.lateShiftEnter.includes('\x1b\r'));
}}
document.removeEventListener('keydown',onKey,true);document.removeEventListener('focusout',onOut,true);
return {ok:bad.length===0,bad,out};
