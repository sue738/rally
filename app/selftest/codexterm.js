// selftest.sh codexterm: a codex session has a ターミナル view too. While it works there is nothing to
// attach to (codex exec), and it says so; stopped, ここで再開 runs codex resume <id> in the panel (the
// fake codex draws "fake codex resume <id>"), and a send from the box is typed into that terminal.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const base=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.id));
if(!base)return {ok:false,bad:['no claude card with a uuid on the fixture board']};
const cx={...base,agent:'codex',id:base.id.replace(/^./,'c'),title:'codexterm selftest',column:'working',alive:undefined,aliveKind:undefined,aliveChecked:true};
// kept over refreshes: the board has no codex session of its own
const as0=applyState;applyState=st=>{if(st&&st.cards&&!st.cards.some(x=>x.agent==='codex'&&x.id===cx.id))st.cards=[...st.cards,cx];return as0(st)};
live.cards=[...(live.cards||[]),cx];
const scr=p=>{if(!p)return '';const b=p.xt.buffer.active;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';return t};
try{
  panelView='term';openDetail(cx,false,{focus:false});await sleep(300);
  expect('a codex card has the ターミナル / 会話 switch',!!$('#mbody .mviews')&&!!$('#mterm'));
  out.working=($('#mterm')||{}).textContent;
  expect('… working: it says codex exec cannot be attached to, and offers no 再開',/codex exec/.test(out.working||'')&&!$('#mresume'));
  cx.column='idle';openDetail(cx,false,{focus:false});await sleep(300);
  const b=$('#mresume');out.stopped=b&&b.textContent;
  expect('… stopped: ここで再開 (codex resume)',!!b&&/codex resume/.test(b.textContent));
  if(b)b.click();
  await wait(()=>{const p=panelPty(cx);return p&&/fake codex resume/.test(scr(p))},8000).catch(()=>0);
  const p=panelPty(cx);out.screen=scr(p).trim().slice(0,120);out.kind=p&&p.kind;
  expect('the panel runs codex resume <id> (the fake, never the real codex)',!!p&&p.kind==='codex'&&new RegExp('fake codex resume '+cx.id).test(scr(p)));
  await wait(()=>p&&p.started,4000).catch(()=>0);
  expect('a send from the box is typed into that terminal',!!p&&panelTypeMsg(cx,'selftest hello'));
}finally{applyState=as0;live.cards=(live.cards||[]).filter(x=>!(x.agent==='codex'&&x.id===cx.id));const p=panelPty(cx);if(p)ptyClose(p.id);closeDetail('selftest')}
return {ok:bad.length===0,bad,out};
