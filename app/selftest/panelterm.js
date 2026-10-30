// selftest.sh panelterm: the detail panel's ターミナル (claude is the recording fake here).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const cs=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive);
if(cs.length<2)return {ok:true,skipped:'fewer than two claude cards'};
const c=cs[0],other=cs[1];
openDetail(c,false,{focus:false});await sleep(600);
// the board asked who is running and this one is not: the terminal view resumes it by itself (no button to press)
expect('a stopped session opens on its terminal view (aliveChecked '+c.aliveChecked+')',$('#mbody').classList.contains('pterm')&&!!c.aliveChecked);
await wait(()=>panelPty(c),5000).catch(()=>0);await sleep(600);
expect('… and resumes there by itself, with no ここで再開 to press',!!panelPty(c)&&!$('#mresume'));
const p=panelPty(c);out.resumed=p&&{kind:p.kind,cols:p.xt.cols,rows:p.xt.rows};
// started in the background and attached (lib/bgopen.js), or — begun in the home folder — resumed in the terminal
expect('it is the session itself in the panel (started in the background and attached, or claude --resume)',!!p&&(p.kind==='attach'&&p.bg||p.kind==='resume')&&!!p.el.closest('#mterm')&&!p.gone);
expect('the terminal has room (at least 60 columns): '+(p&&p.xt.cols)+'x'+(p&&p.xt.rows)+' box '+Math.round($('#mterm').getBoundingClientRect().width),!!p&&p.xt.cols>=60);
await wait(()=>{const b=p&&p.xt.buffer.active;if(!b)return false;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true);return /fake claude/.test(t)},5000).catch(()=>0);
{const b=p&&p.xt.buffer.active;let t='';if(b)for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';
  out.screen=t.trim().slice(0,120);
  expect('the terminal ran the selftest\'s fake claude, never the real one (a test must not resume a real session)',/fake claude (--resume|attach) /.test(t))}
// the top is one row (fold · title · … · ×) and folds to it; measured at what comes under the header (the terminal, else the conversation)
const under=()=>{const t=$('#mterm');return t&&t.offsetParent?t:$('#mhist')};
{const hb=under().getBoundingClientRect().top-$('#detail .modalcard').getBoundingClientRect().top;out.topH=Math.round(hb);
  // (in the docked list a row's panel has nothing to close to: no ×, see 70-list.css lkeep)
  expect('the generic modal head is gone for a session: × sits in the title row (none in the docked list)',getComputedStyle($('#detail .mhead')).display==='none'&&!!$('#mclose2')&&(listDocked()?!$('#mclose2').offsetParent:!!$('#mclose2').offsetParent));
  $('#mfold').click();await sleep(300);
  const top0=$('#detail .modalcard').getBoundingClientRect().top;
  const hf=under().getBoundingClientRect().top-top0;out.foldH=Math.round(hf);
  // the title row itself may be two lines in a narrow panel (title, then its controls): folded, nothing is left under it
  const tr=$('#mmeta .ttlrow').getBoundingClientRect().bottom-top0;out.ttlrowH=Math.round(tr);
  expect('▾ folds the top to the title row (the status line and 残作業 hidden)',hf<hb&&!$('#mbody .acts').offsetParent&&!$('#mbody .mstat').offsetParent&&hf-tr<24);
  expect('… the terminal stays in the panel while folding',!!p&&!p.gone&&!!p.el.closest('#mterm'));
  openDetail(c,true);await sleep(300);
  expect('… and stays folded on a refresh',$('#mmeta').classList.contains('fold'));
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'[',bubbles:true}));await sleep(200);
  expect('[ unfolds it again',!$('#mmeta').classList.contains('fold')&&!!$('#mbody .mstat').offsetParent);
  $('#mbody .ppty .xterm-helper-textarea')&&document.activeElement&&document.activeElement.blur()}
const w0=Math.round($('#detail').getBoundingClientRect().width);
// ⌘\ switches: the conversation (with its box), then the same terminal back, not a new one
document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\',metaKey:true,bubbles:true}));await sleep(400);
expect('⌘\\ shows the conversation alone, with the message box',!$('#mbody').classList.contains('pterm')&&getComputedStyle($('#mhist')).display!=='none'&&(getComputedStyle($('#mterm')).display==='none'||(getComputedStyle($('#mterm')).opacity==='0'&&getComputedStyle($('#mterm')).pointerEvents==='none'))&&getComputedStyle($('#mbody .row.msg.tbox')).display!=='none');
document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\',metaKey:true,bubbles:true}));await sleep(400);
expect('⌘\\ again brings back the same terminal, with the keys, and hides the box',$('#mbody').classList.contains('pterm')&&panelPty(c)===p&&!p.gone&&document.activeElement&&!!document.activeElement.closest('#mterm')&&getComputedStyle($('#mbody .row.msg.tbox')).display==='none');
expect('switching does not move the panel\'s edge',Math.round($('#detail').getBoundingClientRect().width)===w0);
expect('no second ここで再開 chip beside the panel\'s own terminal',!$('#mbody .mbtns .ptygo')||getComputedStyle($('#mbody .mbtns .ptygo')).display==='none');
document.activeElement.blur();
openDetail(c,true);await sleep(400);
expect('a refresh of the panel keeps the same terminal in it',panelPty(c)===p&&!!p.el.closest('#mterm'));
// typed into (a resumed one never typed into closes when you leave): it is yours now
if(p)post({type:'ptyin',id:p.id,data:' '});await sleep(200);
expect('typing into it makes it no longer the look-only kind',!!p&&!p.auto);
const strip0=[...ptys.values()].filter(x=>!x.host).length;
openDetail(other,false,{focus:false});await sleep(600);
const parked=()=>!!p&&!!p.el.closest('#ppark')&&!p.el.closest('#ptys')&&!p.el.closest('#mterm')&&!p.gone;
expect('leaving the card parks a resumed terminal out of sight, still running (not in the strip)',parked());
expect('… no new pane/tab in the strip, and ⌘[ ⌘] does not reach it',[...ptys.values()].filter(x=>!x.host).length===strip0&&!stripPanes().some(x=>x.pty===p)&&!$('#ptys').contains(p&&p.el));
out.parkedStrip={strip:[...ptys.values()].filter(x=>!x.host).length,termclosed:document.body.classList.contains('termclosed')};
{const it=palItems().find(x=>/^裏で動いているターミナル \(\d+\)/.test(x.t));out.palPark=it&&it.t;
  expect('the palette lists it (裏で動いているターミナル (N))',!!it)}
openDetail(c,false,{focus:false});await sleep(600);
expect('coming back brings it into the panel again',!!p&&!!p.el.closest('#mterm')&&!p.parked);
// parked again, then out of the palette: back into its card's panel
openDetail(other,false,{focus:false});await sleep(600);
{const it=palItems().find(x=>/^裏で動いているターミナル/.test(x.t)&&x.t.endsWith(p.label));
  if(it)it.a.run();await sleep(800);
  expect('the palette entry opens it in its card\'s panel',!!it&&openCard&&openCard.id===c.id&&!!p.el.closest('#mterm'));
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur()}
// a running background session is attached, and on leaving kept attached out of sight with the
// look-only ones (coming back shows its screen at once), not listed as one you worked in
// (looked at a moment ago, its claude is this app's own, kept out of sight: a session running in
// the background is not one this app runs, so that one goes first)
{const po=panelPty(other);if(po){ptyClose(po.id);await wait(()=>!ptys.has(po.id),5000).catch(()=>0)}}
other.alive=true;other.aliveKind='background';other.aliveStatus='idle';other.aliveShort=other.id.slice(0,8);
openDetail(other,false,{focus:false});await sleep(900);
const pa=panelPty(other);
expect('a running background session opens attached (claude attach <id>)',!!pa&&pa.kind==='attach'&&pa.session===other.id.slice(0,8));
// leaving it (in the docked list nothing closes a row's panel: another row takes it — one on 会話, which resumes nothing)
{const away=cs[4]||cs[2];panelPrefSet('talk');openDetail(away,false,{focus:false});await sleep(800)}
expect('leaving the card keeps it attached out of sight, as a look-only one (not in the strip, not in the palette)',!!pa&&!pa.gone&&pa.parked&&!!pa.el.closest('#ppark')&&!ptyParked().includes(pa));
if(pa){ptyClose(pa.id);await wait(()=>!ptys.has(pa.id),5000).catch(()=>0)}
expect('… and closing it then is a detach (it was not started for the look: not stopped)',!!pa&&!pa.bg&&!ptys.has(pa.id));
expect('… and leaves the resumed one parked, running, out of the strip',parked());
// the parked claude exits (Ctrl-C ends the fake's sleep): nothing is left of it, nowhere
if(p&&!p.gone){post({type:'ptyin',id:p.id,data:'\x03'});
  const dropped=await wait(()=>!ptys.has(p.id),5000).then(()=>true,()=>false);
  expect('a parked terminal whose claude exits is dropped (not kept, not moved to the strip)',dropped&&!p.el.isConnected&&!palItems().some(x=>/^裏で動いているターミナル/.test(x.t)))}
// a /command typed in the conversation's box goes to the session's terminal, as typed
{const k=cs[3]||cs[1];panelPrefSet('talk');openDetail(k,false,{focus:false});await sleep(700);
  const t=$('#mbody .msg textarea');t.value='/chrome';t.dispatchEvent(new Event('input'));
  t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(300);
  expect('Enter on /chrome keeps /chrome (a skill whose description mentions Chrome does not replace it)',/^\/chrome\b/.test(t.value)||t.value==='');
  if(t.value.trim())t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  const pk=await wait(()=>{const q=panelPty(k);if(!q)return false;const b=q.xt.buffer.active;let x='';for(let i=0;i<b.length;i++)x+=b.getLine(i).translateToString(true);return /\/chrome/.test(x)},12000).then(()=>true,()=>false);
  expect('… and runs in the session\'s terminal (opened for it), typed behind the page: 会話 stays on screen',pk&&panelView==='talk'&&!$('#mbody').classList.contains('pterm')&&getComputedStyle($('#mhist')).display!=='none');
  const q=panelPty(k);out.bg={pk,view:panelView,pterm:$('#mbody').classList.contains('pterm'),q:!!q,act:document.activeElement&&document.activeElement.className,screen:q&&(()=>{const b=q.xt.buffer.active;let x='';for(let i=0;i<b.length;i++)x+=b.getLine(i).translateToString(true)+'|';return x.replace(/\|+/g,'|').slice(0,300)})(),toast:($('#mbody .toast')||{}).textContent};
  expect('… the hidden terminal never takes the keys',!!q&&!(document.activeElement&&document.activeElement.closest('#mterm')));
  // a command that opens a picker (/model): the terminal comes forward for your choice
  if(q){await sleep(1500);expect('/chrome (no picker here) left 会話 on screen',panelView==='talk');
    panelSlash(k,'/model');await sleep(200);q.xt.write('\r\n Select model\r\n ❯ 1. Default\r\n Enter to confirm · Esc to cancel\r\n');
    const up=await wait(()=>panelView==='term'&&$('#mbody').classList.contains('pterm'),4000).then(()=>true,()=>false);
    expect('a /command that asks something (a picker) brings the terminal forward',up);
    out.picker={view:panelView,val:t.value,toast:($('#mbody .toast')||{}).textContent,screen:(()=>{const b=q.xt.buffer.active;let x='';for(let i=0;i<b.length;i++)x+=b.getLine(i).translateToString(true)+'|';return x.replace(/\|+/g,'|').slice(-300)})()};
    }
  closeDetail('selftest');await sleep(400);panelPrefSet('term')}
// a session running in one of our own shells (typed `claude` in ＋シェル): its pane comes into the panel
{ptyOpen('shell',{label:'シェル',cwd:term.cwd||''});await wait(()=>[...ptys.values()].some(x=>x.kind==='shell'&&!x.gone),5000).catch(()=>0);
  const sh=[...ptys.values()].find(x=>x.kind==='shell'&&!x.gone);await sleep(800);
  if(sh){post({type:'ptyin',id:sh.id,data:'sleep 120 & echo CHILDPID=$!\r'});
    const txt=()=>{const b=sh.xt.buffer.active;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';return t};
    await wait(()=>/CHILDPID=\d+/.test(txt()),8000).catch(()=>0);const m=txt().match(/CHILDPID=(\d+)/);
    const k=cs[2]||cs[0];k.alive=true;k.aliveKind='interactive';k.aliveStatus='idle';k.alivePid=m?+m[1]:0;
    openDetail(k,false,{focus:false});await sleep(1200);
    expect('an interactive session running in a ＋シェル pane is shown in the panel (that pane)',!!sh.el.closest('#mterm'));
    closeDetail('selftest');await sleep(400);
    expect('… and goes back to the strip, still running, when the panel closes',!!sh.el.closest('#ptys')&&!sh.gone);
    // a card this run has not opened in a terminal (in the docked list, closing a panel opens the selected
    // row again, on ターミナル: that row may be k by now, resumed here and running in the background)
    const g=cs.find(x=>x!==k&&!panelPty(x)&&!x.alive&&openFor!==x.agent+':'+x.id)||k;
    g.alive=true;g.aliveKind='interactive';g.aliveStatus='idle';g.alivePid=1;openDetail(g,false,{focus:false});await wait(()=>$('#mgoterm'),6000).catch(()=>0);out.gotermView=panelView;out.gotermCard=g.id.slice(0,8)+' '+g.column;
    expect('one running in another terminal (Ghostty) says so, with 端末へ',!!$('#mgoterm'));
    closeDetail('selftest')}}
// 待ちにする, and a card dragged between lanes
// (one no terminal of this run holds: a card resumed here runs in the background, and its lane is 作業中)
{const k=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&![...ptys.values()].some(p=>!p.gone&&(p.full===x.id||(p.session&&x.id.startsWith(p.session))))&&Date.now()-(x.lastT||0)>600000&&x.column!=='working'&&x.column!=='approval'&&!x.done&&!x.parked);
  if(k){panelPrefSet('talk');openDetail(k,false,{focus:false});await sleep(600);
    expect('待ちにする sits beside 完了にする',!!$('#dopark')&&!!$('#dodone')&&$('#dopark').parentElement===$('#dodone').parentElement);
    $('#dopark').click();
    const parked=await wait(()=>!!document.querySelector('[data-col="stale"] .card[data-id="'+k.id+'"]')&&!!$('#unpark'),4000).then(()=>true,()=>false);
    expect('… and moves the card to Waiting, the panel offering 待ちを外す',parked);
    await sleep(1800);
    const k2=(live.cards||[]).find(x=>x.id===k.id);
    expect('… which the board keeps after a refresh (done.json lane: stale)',!!k2&&k2.column==='stale'&&!!k2.parked);
    closeDetail('selftest');await sleep(300);
    const el=document.querySelector('.card[data-id="'+k.id+'"]');
    expect('a card can be dragged',!!el&&el.draggable);
    if(el){const dt=new DataTransfer();el.dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));
      const to=document.querySelector('section.col[data-col="needs-you"]');to.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));
      to.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));el.dispatchEvent(new DragEvent('dragend',{dataTransfer:dt,bubbles:true}));
      await sleep(1800);const k3=(live.cards||[]).find(x=>x.id===k.id);
      expect('dropping it on Your Turn takes the mark off',!!k3&&!k3.parked&&k3.column!=='stale'||(k3&&k3.column==='stale'&&!k3.parked));
      out.dragged=k3&&{col:k3.column,parked:!!k3.parked}}
    panelPrefSet('term')}}
return {ok:bad.length===0,bad,...out};
