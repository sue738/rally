// selftest.sh ptycache: moving between cards on the panel's ターミナル view is smooth — a card
// looked at a moment ago comes back at once (no second claude --resume, no new terminal), the
// look-only ones are kept only for the last few (the oldest closed), a card passed by quickly
// starts nothing, 会話 ⇄ ターミナル does not resize the terminal, and a message to a session
// whose claude runs in this app's own terminal is typed into it (not held, not a copy).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
// every WebGL context made from here on, weakly held: one let go (parked, closed) is given back (ptyGlDrop)
const gls=[];{const gc=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){const x=gc.call(this,t,...a);if(x&&/^webgl/.test(String(t))&&!gls.some(w=>w.deref()===x))gls.push(new WeakRef(x));return x}}
const glLive=()=>gls.filter(w=>{const x=w.deref();return x&&!x.isContextLost()}).length;
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked);
if(cs.length<3)return {ok:true,skipped:'fewer than three stopped claude cards'};
panelView='term';
// every ptyOpen the page makes, counted
let opens=0;const ptyOpen0=window.ptyOpen;window.ptyOpen=function(){opens++;return ptyOpen0.apply(this,arguments)};
const drawn=p=>{if(!p)return false;const b=p.xt.buffer.active;for(let i=0;i<b.length;i++)if(b.getLine(i).translateToString(true).trim())return true;return false};
const visit=async c=>{openDetail(c,false,{focus:false});await wait(()=>{const p=panelPty(c);return p&&p.el.closest('#mterm')&&drawn(p)},6000).catch(()=>0);await sleep(200);return panelPty(c)};
const [a,b,c3]=cs;
const pa=await visit(a),pb=await visit(b),pc=await visit(c3);
expect('each stopped card resumes in the panel (look-only)',!!pa&&!!pb&&!!pc&&pa.auto&&pb.auto&&pc.auto);
expect('… one left for another is kept out of sight, still running (not closed)',!!pa&&!pa.gone&&!pa.closing&&!!pa.el.closest('#ppark'));
expect('… and never shows in the strip',!!pa&&!pa.el.closest('#ptys')&&!stripPanes().some(x=>x.pty===pa||x.pty===pb));
expect('… nor in the palette\'s list of terminals you worked in',!palItems().some(x=>/^裏で動いているターミナル/.test(x.t)));
// back and forth: no new terminal, the same one at once
// the size each had when last on screen (the panel's top differs by card, and so the room left)
const last=new Map([[pa,pa&&pa.xt.cols+'x'+pa.xt.rows],[pb,pb&&pb.xt.cols+'x'+pb.xt.rows],[pc,pc&&pc.xt.cols+'x'+pc.xt.rows]]);
const n0=ptys.size,o0=opens;let worst=0,shown=true;const sizes=[],same=[];
for(const [k,p] of [[a,pa],[b,pb],[c3,pc],[a,pa]]){
  const t0=performance.now();openDetail(k,false,{focus:false});
  const at=!!p&&!!p.el.closest('#mterm')&&!!p.el.offsetParent&&!$('#mterm .mtwait');   // in place in the same task: no empty box, no 再開しています…
  await frame();await frame();const dt=performance.now()-t0;worst=Math.max(worst,dt);shown=shown&&at&&panelPty(k)===p;
  const sz=p&&(p.xt.cols+'x'+p.xt.rows);sizes.push(sz);same.push(sz===last.get(p));last.set(p,sz);await sleep(150)}
out.back={opens:opens-o0,ptys:[n0,ptys.size],worstMs:Math.round(worst),sizes};
expect('coming back to a card looked at shows its terminal at once, in place (no wait message, same terminal)',shown);
expect('… with no ptyOpen and no new terminal (no second claude --resume)',opens===o0&&ptys.size===n0);
expect('… within two frames of the switch (worst '+Math.round(worst)+'ms)',worst<250);
expect('… and at the size it had (not resized on the way back, so the CLI does not redraw)',same.every(Boolean));
// a card passed by quickly (↑↓ through the board) starts nothing
{const k=cs.find(x=>![a,b,c3].includes(x)&&!panelPty(x));
  if(k){const o1=opens;openDetail(k,false,{focus:false});await sleep(120);openDetail(a,false,{focus:false});await sleep(700);
    expect('a card passed by within the wait starts no terminal',opens===o1&&!panelPty(k))}}
// 会話 ⇄ ターミナル: the same terminal, the same size (the CLI is not made to redraw)
{openDetail(a,false,{focus:false});await sleep(300);const p=panelPty(a);const sz=()=>p&&(p.xt.cols+'x'+p.xt.rows);const s0=sz();
  panelSwitch('talk');await frame();await sleep(250);const s1=sz();
  panelSwitch('term');await frame();await sleep(250);const s2=sz();
  out.views=[s0,s1,s2];
  expect('会話 ⇄ ターミナル keeps the terminal\'s size ('+[s0,s1,s2].join(' → ')+')',!!p&&s0===s1&&s1===s2&&panelPty(a)===p&&!!p.el.closest('#mterm'))}
// LRU: only the last few look-only terminals are kept; the oldest is closed
{const more=cs.filter(x=>![a,b,c3].includes(x)).slice(0,PTY_CACHE-1);   // 3 kept + 3 new = 6: the two oldest (b, c3) go, a stays
  if(more.length>=PTY_CACHE-1){
    // left in this order: b, c3 (the back-and-forth), a, then the new ones — b is the oldest
    for(const k of more)await visit(k);
    await sleep(1500);
    const cached=[...ptys.values()].filter(p=>p.parked&&p.auto&&!p.gone&&!p.closing);
    out.lru={cached:cached.length,limit:PTY_CACHE,bGone:!ptys.has(pb.id)||pb.gone||pb.closing};
    expect('no more than '+PTY_CACHE+' look-only terminals are kept out of sight ('+cached.length+')',cached.length<=PTY_CACHE);
    expect('… the one looked at longest ago is the one closed',!ptys.has(pb.id)||pb.gone||pb.closing);
    expect('… a newer one is still kept, and comes back at once',ptys.has(pa.id)&&!pa.gone&&!pa.closing&&(()=>{const o=opens;openDetail(a,false,{focus:false});return opens===o&&panelPty(a)===pa&&!!pa.el.closest('#mterm')})())}
  else out.lru='skipped: not enough stopped cards'}
// its claude runs in this app's terminal: the board sees it open in a terminal (agents --json
// says interactive), and a message from the panel is typed into that terminal — not held, not
// handed to the send route (which would hold it or make a copy)
{const k=c3;openDetail(k,false,{focus:false});await sleep(300);let p=panelPty(k);
  if(!p||p.gone){p=await visit(k)}
  k.alive=true;k.aliveKind='interactive';k.aliveStatus='idle';k.aliveChecked=true;
  const sent=[];const dispatch0=window.dispatch;window.dispatch=function(m){sent.push(m&&m.type);return dispatch0.apply(this,arguments)};
  panelSwitch('talk');await sleep(300);
  const t=$('#mbody .msg textarea');
  if(t&&p){t.value='hello-from-park';t.dispatchEvent(new Event('input'));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    const typed=await wait(()=>{const bb=p.xt.buffer.active;let x='';for(let i=0;i<bb.length;i++)x+=bb.getLine(i).translateToString(true);return /hello-from-park/.test(x)},5000).then(()=>true,()=>false);
    await sleep(300);
    out.send={typed,sent,ptys:ptys.size,view:panelView,toast:($('#mbody .toast')||{}).textContent};
    expect('a message to a session running in this app\'s terminal is typed into that terminal',typed);
    expect('… and not sent through the send route (no hold, no copy)',!sent.includes('reply')&&!sent.includes('run'));
    expect('… 会話 stays on screen, the box emptied',panelView==='talk'&&!t.value);
    expect('… and that terminal is yours now (kept, not a look-only one)',!p.auto)}
  else expect('the conversation box is there to send from',false);
  window.dispatch=dispatch0;panelView='term'}
window.ptyOpen=ptyOpen0;
closeDetail('selftest');await sleep(300);
// the terminals parked and closed on the way gave their contexts back: live ones are those drawing
// (xterm's renderer kept a blink timer running after its dispose, and with it the context: 14 live for 2)
{const n=glLive(),drawing=[...ptys.values()].filter(p=>p.gl).length;out.gl={made:gls.length,live:n,drawing};
  expect('a terminal let go gives its WebGL context back ('+n+' live, '+drawing+' drawing, '+gls.length+' made)',gls.length>=2&&n<=drawing)}
return {ok:bad.length===0,bad,...out};
