// selftest.sh persist: the app's terminals outlive the app. Run twice by selftest.sh on one
// scratch home: phase 1 opens them and the app quits leaving them running (RALLY_SELFTEST_KEEPPTY);
// phase 2 is the relaunch, which finds them running and draws them again, attached by session id.
//   - a stopped session opened in its card's panel: started in the background and attached (lib/bgopen.js)
//   - a session Claude will not run in the background (begun in the home folder): resumed directly, in the pty host
//   - a shell in the strip
// ST_ENV.session / session2 name scratch sessions (SELFTEST_REAL_CLAUDE=1, the real claude); without them
// two stopped cards on the board are used with the recording fake (nothing real is resumed).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={phase:ST_ENV.phase};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const scr=p=>{if(!p)return '';const b=p.xt.buffer.active;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';return t};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,20000);
const home=(live.home||'').replace(/\/$/,'');
const cards=(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent);
const pick=(id,pred)=>id?cards.find(x=>x.id===id):cards.find(pred);
if(ST_ENV.phase==='1'){
  // a terminal's signals are the default ones, not the host's (it ignores SIGHUP/SIGTERM/SIGPIPE, and an
  // ignored disposition survives exec): kill ends a job, a closed tab hangs up, `yes | head` is quiet.
  // (A login zsh resets them itself, so with zsh this holds either way; a login bash keeps SIGTERM ignored.)
  {const before=new Set(ptys.keys());ptyOpen('shell',{label:'persist-sig',cwd:''});
   await wait(()=>[...ptys.values()].some(x=>!before.has(x.id)&&!x.gone&&/\S/.test(scr(x))),10000).catch(()=>0);
   const s=[...ptys.values()].find(x=>!before.has(x.id)&&!x.gone);
   if(s){await sleep(600);
     post({type:'ptyin',id:s.id,data:'bash -c \'sleep 3 & p=$!; kill $p; wait $p; t=$?; sleep 3 & q=$!; kill -HUP $q; wait $q; h=$?; e=$( { yes | head -1 >/dev/null; } 2>&1 ); echo "SIGS term=$t hup=$h pipe=[$e] END"\'\r'});
     await wait(()=>/SIGS term=\w+ hup=\w+ pipe=\[.*?\] END/.test(scr(s)),10000).catch(()=>0);
     const m=scr(s).match(/SIGS term=(\w+) hup=(\w+) pipe=\[(.*?)\] END/);
     out.signals=m?{term:m[1],hup:m[2],pipe:m[3]}:{screen:scr(s).replace(/\s+/g,' ').trim().slice(-300)};
     expect('kill (SIGTERM) ends a job in a terminal ('+JSON.stringify(out.signals)+')',!!m&&m[1]==='143');
     expect('SIGHUP ends a job in a terminal',!!m&&m[2]==='129');
     expect('a closed pipe ends `yes` quietly (no Broken pipe)',!!m&&m[3]==='');
     // output faster than the page draws is held back at the program (flow control), not queued without
     // bound: a ⌃C after `yes` gets the prompt back in seconds (it waited over 2 minutes)
     post({type:'ptyin',id:s.id,data:'yes\r'});await sleep(3000);
     post({type:'ptyin',id:s.id,data:'\x03'});await sleep(300);post({type:'ptyin',id:s.id,data:'clear; echo YES-DONE-$((1+1))\r'});
     {const t=Date.now();await wait(()=>/YES-DONE-2/.test(scr(s)),60000).catch(()=>0);out.signals.yesPromptMs=Date.now()-t}
     expect('after `yes` and ⌃C the prompt is back within 10 s ('+out.signals.yesPromptMs+' ms)',out.signals.yesPromptMs<10000);
     const t0=Date.now();ptyClose(s.id);await wait(()=>!ptys.has(s.id)||ptys.get(s.id).gone,6000).catch(()=>0);
     out.signals.closeMs=Date.now()-t0;
     expect('closing its tab hangs the shell up at once (not the SIGKILL 2 s later) ('+out.signals.closeMs+' ms)',out.signals.closeMs<1500)}
   else expect('a shell for the signal check opens',false)}
  termOpen(false);panelView='term';
  // the background one: a stopped card outside the home folder (the scratch session, with the real claude)
  const a=pick(ST_ENV.session,x=>!x.headless&&!x.alive&&x.aliveChecked&&x.project&&x.project.replace(/\/$/,'')!==home);
  if(!a)return {ok:bad.length===0,bad,...out,skipped:'no stopped claude card outside the home folder'};
  openDetail(a,false,{focus:false});
  await wait(()=>{const p=panelPty(a);return p&&p.kind==='attach'&&/\S/.test(scr(p))},ST_ENV.real?45000:15000).catch(()=>0);
  const pa=panelPty(a);
  out.a={id:a.id,kind:pa&&pa.kind,session:pa&&pa.session,bg:pa&&pa.bg,screen:scr(pa).replace(/\s+/g,' ').trim().slice(0,200)};
  expect('a stopped session opens in its panel started in the background and attached ('+(pa&&pa.kind)+')',!!pa&&pa.kind==='attach'&&pa.session===a.id.slice(0,8)&&pa.bg);
  // typed into: it is yours (parked, not the look-only cache, when the panel closes)
  if(pa)pa.auto=false;
  // left (in the docked list nothing closes a row's panel: another row takes it — one on 会話, which resumes nothing)
  {const away=cards.find(x=>x!==a&&!x.headless);panelPrefSet('talk');if(away)openDetail(away,false,{focus:false});await sleep(600)}
  expect('… and, its card left, it stays out of sight, attached (not detached, not in the strip)',!!pa&&!pa.gone&&pa.parked&&!!pa.el.closest('#ppark'));
  // the direct one: a session Claude will not run in the background, resumed in the pty host
  // (session2 may be "<id>@<its folder>": a scratch session the board does not show as a card)
  const [id2,dir2]=String(ST_ENV.session2||'').split('@');
  const b=id2?(cards.find(x=>x.id===id2)||{id:id2,project:dir2||''}):pick('',x=>x!==a&&!x.headless&&!x.alive&&x.aliveChecked);
  if(b){ptyOpen('resume',{session:b.id,label:'direct',cwd:b.project||dir2||'',direct:true});
    await wait(()=>[...ptys.values()].some(p=>p.uuid===b.id&&/\S/.test(scr(p))),20000).catch(()=>0);
    const pb=[...ptys.values()].find(p=>p.uuid===b.id);
    out.b={id:b.id,kind:pb&&pb.kind,screen:scr(pb).replace(/\s+/g,' ').trim().slice(0,160)};
    expect('a session opened directly runs in the strip (claude --resume)',!!pb&&pb.kind==='resume'&&!pb.gone)}
  // a shell, with something on its screen and a child that runs on
  ptyOpen('shell',{label:'persist-shell',cwd:''});
  await wait(()=>[...ptys.values()].some(x=>x.kind==='shell'&&!x.gone&&/\S/.test(scr(x))),10000).catch(()=>0);
  const sh=[...ptys.values()].find(x=>x.kind==='shell'&&!x.gone);
  // more than the host keeps (RING_MAX, 1 MB) first: the replay after the relaunch reads a trimmed buffer
  // (it trapped there once — a long session's output took the host and every terminal in it down)
  if(sh){await sleep(600);post({type:'ptyin',id:sh.id,data:'head -c 1300000 /dev/zero | tr "\\0" x; echo; echo PERSIST-$((40+2)); sleep 900 & echo CHILD=$!\r'});
    await wait(()=>/PERSIST-42/.test(scr(sh))&&/CHILD=\d+/.test(scr(sh)),30000).catch(()=>0)}
  expect('the shell runs (PERSIST-42 on its screen)',!!sh&&/PERSIST-42/.test(scr(sh)));
  out.shellChild=(scr(sh).match(/CHILD=(\d+)/)||[])[1]||'';
  await sleep(3500);   // the notes (meta) reach the host
  out.tabs=[...ptys.values()].map(p=>({id:p.id,kind:p.kind,session:p.session,uuid:p.uuid,full:p.full,parked:!!p.parked,host:!!p.host}));
  return {ok:bad.length===0,bad,...out};
}
// phase 2: the relaunch
await wait(()=>ptyRestored>0,15000).catch(()=>0);
await sleep(1500);
out.restored=[...ptys.values()].map(p=>({id:p.id,kind:p.kind,session:p.session,uuid:p.uuid,full:p.full,parked:!!p.parked,strip:!p.host,chars:scr(p).replace(/\s/g,'').length}));
expect('the terminals running before the quit come back ('+ptys.size+')',ptys.size>=2);
const sh=[...ptys.values()].find(p=>p.kind==='shell');
expect('the shell comes back into the strip, its screen drawn again (PERSIST-42)',!!sh&&!sh.host&&/PERSIST-42/.test(scr(sh)));
if(sh){post({type:'ptyin',id:sh.id,data:'echo AFTER-$((50+5))\r'});
  const live2=await wait(()=>/AFTER-55/.test(scr(sh)),8000).then(()=>true,()=>false);
  expect('… and it is the same shell, live: what is typed now runs in it',live2)}
const pa=[...ptys.values()].find(p=>p.kind==='attach');
expect('the session attached before the quit is back, still attached, out of sight until its card opens',!!pa&&pa.parked&&!pa.el.closest('#ptys'));
if(pa){
  const c=cards.find(x=>x.id===pa.full)||cards.find(x=>x.id.startsWith(pa.session));
  let opens=0;const o0=window.ptyOpen;window.ptyOpen=function(){opens++;return o0.apply(this,arguments)};
  if(c){termOpen(false);panelView='term';openDetail(c,false,{focus:false});await sleep(1200)}
  window.ptyOpen=o0;
  out.reopen={card:c&&c.id,opens,inPanel:!!pa.el.closest('#mterm'),screen:scr(pa).replace(/\s+/g,' ').trim().slice(-200)};
  expect('opening its card shows that same terminal in the panel (by session id), starting nothing new',!!c&&panelPty(c)===pa&&!!pa.el.closest('#mterm')&&opens===0);
  expect('… with its screen drawn again',/\S/.test(scr(pa)));
  closeDetail('selftest');await sleep(400)}
const pb=[...ptys.values()].find(p=>p.kind==='resume');
out.direct=pb?{uuid:pb.uuid,gone:pb.gone,chars:scr(pb).replace(/\s/g,'').length}:null;
if(ST_ENV.session2||pb)expect('the directly resumed session is back too, still running',!!pb&&!pb.gone&&/\S/.test(scr(pb)));
// the host killed while the app runs, twice: each time the next terminal starts a new host (it does
// not fall back to ptys held in-process, which end with the app), and the dead host is reaped (no zombie)
{const killed=[];out.hostLoss=[];
 const openSh=async label=>{const before=new Set(ptys.keys());ptyOpen('shell',{label,cwd:''});
   await wait(()=>[...ptys.values()].some(x=>!before.has(x.id)&&!x.gone&&/\S/.test(scr(x))),12000).catch(()=>0);
   const s=[...ptys.values()].find(x=>!before.has(x.id)&&!x.gone);if(s)await sleep(600);return s};
 let cur=[...ptys.values()].find(p=>p.kind==='shell'&&!p.gone);
 for(let round=1;round<=2&&cur;round++){
   const t0=Date.now();
   post({type:'ptyin',id:cur.id,data:'echo HOST=$PPID; sleep .3; kill -9 $PPID\r'});
   await wait(()=>/HOST=\d+/.test(scr(cur)),6000).catch(()=>0);
   killed.push((scr(cur).match(/HOST=(\d+)/)||[])[1]||'');
   await wait(()=>cur.gone,8000).catch(()=>0);
   await sleep(2500);
   const t1=Date.now();cur=await openSh('persist-loss'+round);const openMs=Date.now()-t1;
   const rec={round,killed:killed[killed.length-1],openMs};
   if(cur){post({type:'ptyin',id:cur.id,data:'echo "PARENT=$(ps -o comm= -p $PPID | xargs basename) ZOMBIES=<$(ps -o stat= -p '+killed.join(',')+' | tr -d " \\n")>END"\r'});
     // wrapped rows joined: the pane may be narrow
     const flat=()=>{const b=cur.xt.buffer.active;let t='';for(let i=0;i<b.length;i++){const l=b.getLine(i);t+=(l.isWrapped?'':'\n')+l.translateToString(true)}return t};
     await wait(()=>/PARENT=\S+ ZOMBIES=<[^>]*>END/.test(flat()),6000).catch(()=>0);
     const m=flat().match(/PARENT=(\S+) ZOMBIES=<([^>]*)>END/);rec.parent=m&&m[1];rec.zombies=m&&m[2];if(!m)rec.screen=flat().replace(/\s+/g,' ').trim().slice(-300)}
   out.hostLoss.push(rec);
   expect('after the pty host is lost ('+round+'), a new terminal runs in a new host, not in-process ('+JSON.stringify(rec)+')',!!cur&&rec.parent==='rally-ptyd');
   expect('… and the lost host is reaped, not left a zombie',!!cur&&rec.zombies==='')}
 if(!cur)expect('a shell after the host loss opens',false)}
return {ok:bad.length===0,bad,...out};
