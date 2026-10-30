// selftest.sh ptyglyph: no terminal is left drawing from a stale glyph atlas. The GPU
// renderer's atlas is shared by every terminal of the same font and colours, so clearing it
// for one (a resize, a move, the window's focus) leaves every other terminal's cells pointing
// at glyphs that are no longer where they were — drawn as slivers of other characters the next
// time it draws anything. Every terminal sharing it has to forget its cells too: one that ended
// (a session's pane stays to say why, struck through) and one out of sight included. A lost
// GPU context falls back to the DOM renderer, and many terminals (more than WebKit keeps live
// contexts for) each still draw, on the GPU or in the DOM.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(true);ptyRoom();
const rend=p=>{try{return p.xt._core._renderService._renderer.value}catch(e){return null}};
const isGl=p=>{const r=rend(p);return !!(r&&r._charAtlas!==undefined)};
const text=p=>{const b=p.xt.buffer.active;let x='';for(let i=0;i<b.length;i++)x+=b.getLine(i).translateToString(true)+'\n';return x};
const openShell=async label=>{const before=new Set(ptys.keys());ptyOpen('shell',{label,cwd:term.cwd||''});
  await wait(()=>[...ptys.keys()].some(k=>!before.has(k)),5000);const p=[...ptys.values()].find(x=>!before.has(x.id));
  await wait(()=>/\S/.test(text(p)),6000).catch(()=>{});return p};
const say=(p,s)=>post({type:'ptyin',id:p.id,data:s});
// ---- 1. the atlas shared, cleared for one: every sharer forgets its cells ----
const A=await openShell('claude'),B=await openShell('シェル');await sleep(800);
// a gone pane that stays: a session's that failed at once (a shell's exit closes its tab)
A.kind='resume';A.openedAt=Date.now()+5000;
say(A,'clear; printf "\\n  ☁ Claude Code — 終了したセッションの画面\\n  日本語の行とASCII lines 0123456789\\n  ┌──────────┐ box drawing │ ok │\\n"; exit 3\r');
await wait(()=>A.gone,8000).catch(()=>{});
out.gone={gone:A.gone,cls:A.el.classList.contains('gone'),code:A.code};
expect('a pane that ended and stays, struck through (the state in the report)',A.gone&&A.el.classList.contains('gone'));
out.gl={A:isGl(A),B:isGl(B)};
if(!isGl(A)||!isGl(B)){out.skipped='no WebGL renderer in this web view';}
else{
  const ra=rend(A),rb=rend(B);out.shared=ra._charAtlas===rb._charAtlas;
  expect('the two terminals share one atlas (the premise of this check)',out.shared);
  // every real clear of an atlas, and every renderer's forgetting of its cells, stamped
  let gen=0;const TA=Object.getPrototypeOf(ra._charAtlas),clear0=TA.clearTexture;
  TA.clearTexture=function(){const pg=this._pages&&this._pages[0];const used=pg&&(pg.currentRow.x!==0||pg.currentRow.y!==0);const r=clear0.apply(this,arguments);if(used)this.__g=++gen;return r};
  // (a renderer first seen after this point is a new one: its cells start empty)
  const stamp=r=>{if(!r||r.__stamped)return;r.__stamped=true;r.__m=gen;const m=r._clearModel;r._clearModel=function(){r.__m=++gen;return m.apply(this,arguments)}};
  const stale=()=>[...ptys.values()].filter(p=>{const r=rend(p);if(!r||r._charAtlas===undefined)return false;stamp(r);const a=r._charAtlas;return a&&(a.__g||0)>(r.__m||0)}).map(p=>p.label+(p.gone?'(gone)':'')+(p.el.offsetParent?'':'(hidden)'));
  stale();
  // the other terminal draws new glyphs, then the window comes back to the front (ptyRepaintAll)
  say(B,'printf "\\n  別の端末の新しい文字 ★ ♪ ∑ ≈ «»\\n"\r');await sleep(600);
  window.dispatchEvent(new Event('focus'));await sleep(500);
  out.afterFocus=stale();
  expect('after the window\'s focus, no terminal is left on a stale atlas ('+out.afterFocus.join(', ')+')',out.afterFocus.length===0);
  // a card's terminal coming back from out of sight clears it too: one parked, shown again
  {say(B,'printf "\\n  もう一度 ◆ ◇ ○ ●\\n"\r');await sleep(500);
    const box=ptyParkBox();const C=await openShell('隠れた端末');say(C,'printf "\\n  隠れていた端末 ▲ ▼\\n"\r');await sleep(500);
    ptyPark(C);await sleep(200);
    expect('a terminal out of sight gives its GPU context back',!C.gl&&!isGl(C));say(B,'printf "\\n  その間に △ ▽ ♠ ♣\\n"\r');await sleep(400);
    window.dispatchEvent(new Event('focus'));await sleep(500);
    out.parked=stale();
    expect('… nor one out of sight ('+out.parked.join(', ')+')',out.parked.length===0);
    ptyToStrip(C,true);await sleep(600);out.unparked=stale();
    expect('… and takes one again when it is shown',!!C.gl&&isGl(C)&&/隠れていた端末/.test(text(C)));
    expect('… nor any after one comes back into sight ('+out.unparked.join(', ')+')',out.unparked.length===0);
    ptyClose(C.id);await sleep(400)}
  // what the pane that ended looks like when it draws again (a hover, the cursor, a selection)
  A.xt.refresh(0,A.xt.rows-1);await sleep(300);
  post({type:'selftestshot',name:'gone'});await sleep(900);
  TA.clearTexture=clear0;
  // ---- 2. a lost context: the DOM renderer draws it, and repaints do not throw ----
  {const ctx=rend(B)&&rend(B)._gl;const ext=ctx&&ctx.getExtension('WEBGL_lose_context');
    if(!ext)out.lost='skipped: no WEBGL_lose_context';
    else{ext.loseContext();await wait(()=>!isGl(B),6000).catch(()=>{});await sleep(400);
      let threw=null;try{ptyRepaintAll();window.dispatchEvent(new Event('focus'))}catch(e){threw=String(e)}await sleep(400);
      const rows=B.el.querySelector('.xterm-rows');
      out.lost={gl:isGl(B),pgl:!!B.gl,dom:!!rows,domText:rows?rows.textContent.slice(-80):'',threw};
      expect('a lost GPU context falls back to the DOM renderer',!isGl(B)&&!!rows&&/間に/.test(rows.textContent));
      expect('… and the pane no longer counts as GPU-drawn',!B.gl);
      post({type:'selftestshot',name:'lost'});await sleep(900)}}
}
// ---- 3. more terminals than live contexts: every one still draws ----
{const N=18,many=[];for(let i=0;i<N;i++){const p=await openShell('t'+i);if(p){say(p,'printf "\\n pane '+i+' 日本\\n"\r');many.push(p)}}
  await sleep(4500);   // xterm waits 3s for a lost context to come back before giving up on it
  const st=many.map(p=>{const r=rend(p);const gl=isGl(p);let lost=null;if(gl)try{lost=r._gl?r._gl.isContextLost():null}catch(e){}
    return {id:p.id,gl,lost,dom:!gl&&!!p.el.querySelector('.xterm-rows'),pgl:!!p.gl}});
  out.many={n:st.length,glLive:st.filter(s=>s.gl&&s.lost===false).length,dom:st.filter(s=>s.dom).length,lostStuck:st.filter(s=>s.gl&&s.lost).length};
  expect('every one of '+N+' terminals draws: a live GPU context or the DOM renderer ('+JSON.stringify(out.many)+')',st.every(s=>(s.gl&&s.lost===false)||s.dom));
  expect('… and a pane counts as GPU-drawn only while it is',st.every(s=>s.pgl===s.gl));
  post({type:'selftestshot',name:'many'});await sleep(900);
  for(const p of many)ptyClose(p.id);await sleep(600)}
for(const p of [...ptys.values()])ptyClose(p.id);await sleep(400);
return {ok:bad.length===0,bad,...out};
