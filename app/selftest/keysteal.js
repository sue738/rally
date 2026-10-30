// selftest.sh keysteal: letters typed into a terminal all reach it when the page moves things
// under your fingers — the terminal's pane moved in the page while the IME is composing
// (WebKit drops the composition without a compositionend, and xterm then took every later
// letter the IME hands over, 英字 mode's keyCode 229, for part of a composition that never
// ends: none was sent), and a command in the コマンド line finishing while you type elsewhere
// (it took the keys back to its line).
// The composition is WebKit's own (selftestime calls the web view's text-input client as an
// input method does); the 英字 letters are emulated as typekeys does (keyCode 229, text after).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const ime=(op,text)=>new Promise(res=>{const cb='__ime'+Math.random().toString(36).slice(2,8);window[cb]=r=>{delete window[cb];res(r)};post({type:'selftestime',op,text:text||'',cb})});
const type=(text,gap)=>new Promise(res=>{const cb='__typed'+Math.random().toString(36).slice(2,8);window[cb]=()=>{delete window[cb];res()};post({type:'selftesttype',text,gap:gap||0.03,cb})});
// what each terminal was sent (typed keys only, not the terminal's own answers)
const sent=new Map();const post0=post;post=m=>{if(m&&m.type==='ptyin'&&!m.reply&&typeof m.data==='string')sent.set(m.id,(sent.get(m.id)||'')+m.data);return post0(m)};
const got=p=>{const s=sent.get(p.id)||'';sent.delete(p.id);return s};
const ime229=(ta,ch)=>{const e=new KeyboardEvent('keydown',{key:ch,code:'Key'+ch.toUpperCase(),bubbles:true,cancelable:true,composed:true});
  Object.defineProperty(e,'keyCode',{get:()=>229});Object.defineProperty(e,'which',{get:()=>229});ta.dispatchEvent(e);return e};
const eiji=async(ta,text)=>{for(const ch of text){const kd=ime229(ta,ch);await sleep(20);
  if(!kd.defaultPrevented){ta.value+=ch;ta.dispatchEvent(new InputEvent('input',{data:ch,inputType:'insertText',bubbles:true,composed:true}))}
  ta.dispatchEvent(new KeyboardEvent('keyup',{key:ch,bubbles:true}));await sleep(15)}};
const inTa=p=>document.activeElement===p.xt.textarea;
try{
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(true);
ptyOpen('shell',{label:'シェル',cwd:term.cwd||''});await wait(()=>[...ptys.values()].some(x=>x.kind==='shell'&&!x.gone),5000);
const sh=[...ptys.values()].find(x=>x.kind==='shell'&&!x.gone);await sleep(1500);
// 1. a strip shell: composing, then its pane moves (as ptyToStrip moves one), then 英字 letters
{const ta=sh.xt.textarea;ta.focus();await sleep(100);got(sh);
  await ime('mark','か');await sleep(60);
  ptyToStrip(sh,true);if(!inTa(sh))sh.xt.focus();await sleep(60);
  await eiji(ta,'abc');await sleep(250);
  const s1=got(sh);out.shell={sent:s1};
  expect('英字 letters after a composition cut short by a move reach the shell (sent "'+s1+'")',s1.includes('abc'));
  await type('xyz',0.04);await sleep(300);
  const s2=got(sh);out.shell.after=s2;
  expect('… and so do keys after them (sent "'+s2+'")',s2.includes('xyz'));
  await eiji(ta,'def');await sleep(250);const s3=got(sh);out.shell.eiji2=s3;
  expect('… and 英字 letters after those (sent "'+s3+'")',s3==='def')}
// 2. a command finishing in the コマンド line while you type in a shell: the keys stay in the shell
{const cp=activePane();const i=paneIn(cp);
  if(!i)bad.push('no command line');
  else{i.focus();termRun(cp,'sleep 1');await sleep(150);
    sh.xt.focus();await sleep(100);got(sh);
    const want='the quick brown fox jumps over';
    await type(want,0.08);await sleep(400);
    const s=got(sh);out.cmdDone={sent:s,focus:document.activeElement&&(document.activeElement.id||document.activeElement.className),busy:!!cp.busy,line:i.value};
    expect('a command that finished in the コマンド line did not take the keys typed into a shell (shell got "'+s+'", line has "'+i.value+'")',s===want&&inTa(sh));
    i.value=''}}
// 3. the panel's terminal: composing, then the panel redraws (its pane is put back into the new panel)
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive);
if(!cs.length)out.panel='skipped: no stopped claude card';
else{const c=cs[0];panelView='term';openDetail(c,false,{focus:false});
  await wait(()=>panelPty(c),6000).catch(()=>0);const p=panelPty(c);
  expect('the stopped session resumes in the panel',!!p);
  if(p){await sleep(1200);p.xt.focus();await sleep(100);got(p);
    await ime('mark','さ');await sleep(60);
    openDetail(openCard,true);await sleep(80);
    expect('the panel\'s terminal keeps the keys through the redraw',inTa(p));
    if(!inTa(p))p.xt.focus();
    await eiji(p.xt.textarea,'ghi');await sleep(250);
    const s=got(p);out.panel={sent:s};
    expect('英字 letters after a composition cut short by a panel redraw reach the panel\'s terminal (sent "'+s+'")',s.includes('ghi'))}
  closeDetail('selftest')}
post0({type:'ptyin',id:sh.id,data:'\x03exit\r'});
}finally{post=post0}
return {ok:bad.length===0,bad,out};
