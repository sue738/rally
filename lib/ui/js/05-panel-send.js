// The panel's message box: send, type into the terminal, hold, fork. Wired by openDetail (03-panel.js).
// Typed into the session's own terminal rather than sent (/command, !command): the words stay a draft
// until typed, and come back if they never are. run(fin) starts it and says whether it can; fin(ok) settles.
function panelViaTerm(rk,t,box,run,echo,after){
  const tok='typed-'+Date.now()+Math.random().toString(36).slice(2);let done=null,el=null;
  draftTyping.add(tok);draftSending(rk,tok,draftCapture(rk)||{t});
  const fin=ok=>{if(done!==null)return;done=!!ok;draftTyping.delete(tok);
    if(!done&&panelKey===rk)keepUnsent();        // what you typed since, written down first
    const back=draftSettle(rk,tok,done);
    if(done)return;echoDrop(el);el=null;
    const b=panelKey===rk&&$('#mbody .msg textarea');if(b&&back)draftShow(rk,$('#mbody'),b,back)};
  if(!run(fin)){draftTyping.delete(tok);draftSettle(rk,tok,true);keepUnsent();return false}
  if(done===false)return true;              // refused at once: the words are back in the box
  if(after)after();if(echo)el=echoTyped(echo);
  rememberSent(t);box.sent();
  return true;
}
// flip (⌥⏎): the opposite of the 今の作業後に送る chip, once
// every send leaves a line in the app's log: which way it went (typed into a terminal / sent / held / forked)
function sendLog(c,route,t,files){if(native)try{post({type:'log',text:'send '+route+': '+c.agent+':'+String(c.id).slice(0,8)+' "'+String(t||'').replace(/\s+/g,' ').slice(0,40)+'"'+((files||[]).length?' + '+files.map(f=>String(f).split('/').pop()).join(', '):'')})}catch(e){}}
function panelSend(c,mb,inp,box,flip){
  const go=f=>panelSend(c,mb,inp,box,f);
  if(mb.dataset.sending){toast(mb,t('いま送っているところです。終わってから送ってください(書いた文はそのまま残ります)'));return}
  if(attachAfter(mb,()=>go(flip)))return;
  const txt=inp.value.trim();if(!txt&&!attachPaths(mb).length)return;
  const model=(mb.querySelector('.msg .mmodel')||{dataset:{}}).dataset.model||'';
// one route for every case: sendTo decides whether to deliver now, wake the session, or hold
  const files=attachPaths(mb);
  inp.blur();
// a reply carries which message it answers (replyWrap); a /command never does
  const rk=c.agent+':'+c.id,ref=replyRefs.get(rk),slash=/^\s*[\/／]/.test(txt);
  if(ref)ref.n=replyN(rk,ref);
  const wrapped=ref&&txt&&!slash?replyWrap(ref,txt):txt;
  const fb=mb.querySelector('.forkbtn'),fw=mb.querySelector('.forkwt');
  if(fb&&fb.classList.contains('on')){
    const wt=!!(fw&&fw.classList.contains('on'));
    const note=wt?'(この会話を複製した別セッションです。元のセッションも別に続くことがあります。このセッションは専用の git worktree で動いているので、ファイルは今の作業ディレクトリ(worktree)の中だけで編集し、元のチェックアウトのパスは編集しないでください)\n\n'
      :'(この会話を複製した別セッションです。元のセッションも別に続くことがあります)\n\n';
    dispatch({type:'run',agent:c.agent,dir:c.project,text:note+wrapped,fork:c.id,worktree:wt,model,attachments:files,closeOnDone:true},mb,undefined,rk);
    fb.classList.remove('on');if(fw){fw.classList.remove('on');fw.hidden=true}
    if(wrapped!==txt)replyClear(rk);
    rememberSent(txt);box.sent();attachClear(mb);return}
// --model only reaches a session the board starts, so a running claude one gets /model typed first,
// then the message once that is in.
  if(model&&!slash&&!/^\s*[!！]/.test(txt)&&c.agent==='claude'&&model!==c.model&&(c.alive||panelPty(c))){
    const unpick=()=>{modelPicked.delete(rk);const bt=mb.querySelector('.msg .mmodel');if(bt){bt.dataset.model='';bt.textContent=t('既定 {m} ▾',{m:modelLabel(model,'')})}};
    if(panelSlash(c,'/model '+model,ok=>{if(!ok||panelKey!==rk)return;c.model=model;unpick();setTimeout(()=>{const b=panelKey===rk&&$('#mbody .msg textarea');if(b)b.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',altKey:!!flip,bubbles:true}))},900)}))return;
    toast($('#mbody'),t('ほかの端末で動いているセッションのモデルは、ここからは変えられません(その端末で /model {model} を打つか、「ここで開き直す」でこのアプリに移してください)',{model}));return}
// 今の作業後に送る: never handed over mid-turn
  const wf=wfIsOn(c)!==!!flip;
  const viaTerm=(run,echo,after)=>panelViaTerm(rk,txt,box,run,echo,after);
// /command and !command are typed into the session's terminal, before 今の作業後に送る:
// never held, since a held `!rm …` typed later would run as a command
  if(/^\s*[!！]\S/.test(txt)&&!files.length&&c.agent==='claude'){if(viaTerm(fin=>panelSlash(c,txt.trim().replace(/^！/,'!'),fin)))return;
    toast($('#mbody'),t('! のコマンドは、このアプリのターミナルで開けるセッションでだけ実行できます(ほかの端末で開いているものは、その端末で打ってください)'));return}
  if(slash&&!files.length&&viaTerm(fin=>panelSlash(c,txt.replace(/^\s*／/,'/'),fin)))return;
  if(wf&&!slash&&wfHolds(c)){sendLog(c,'held',wrapped,files);wfSend(c,mb,{text:wrapped,model,files,own:rk});if(wrapped!==txt)replyClear(rk);rememberSent(txt);box.sent();setTimeout(box.clear,120);attachClear(mb);return}
// a stopped session begun in the home folder cannot be resumed in the background (a Claude limit):
// resumed in this panel and typed into instead
  const hm=(live.home||'').replace(/\/$/,''),atHome=!!hm&&String(c.project||'').replace(/\/$/,'')===hm;
  const unreply=()=>{if(wrapped!==txt)replyClear(rk)};
  if(!files.length&&c.agent==='claude'&&!c.alive&&c.aliveChecked&&atHome&&!panelPty(c)&&viaTerm(fin=>panelPtyReady(c,true,()=>{if(!panelTypeMsg(c,wrapped,fin))fin(false)},'送信',()=>fin(false)),wrapped,unreply))return;
  // files ride along as their paths (the agent reads them; codex / claude take an image path as the image): a send
  // through codex exec / a resume was refused while the session's terminal is open here
  const withFiles=files.length?wrapped+'\n\n添付ファイル(このパスを読んでください):\n'+files.map(f=>'- '+f).join('\n'):wrapped;
  if(viaTerm(fin=>panelTypeMsg(c,withFiles,fin),withFiles,unreply)){sendLog(c,'typed',wrapped,files);
    // a terminal takes the words only: a picked model or 深さ is codex's own /model there
    if(c.agent==='codex'&&(model||effortPicked.get(rk)))flash(t('ターミナルで開いている codex には、選んだモデル・深さは渡せません(codex の /model で切り替えてください)'));if(files.length)attachClear(mb);return}
// with 今の作業後に送る on, the board checks again and holds it if busy by now
  sendLog(c,wf&&!slash?'sent (after its work)':'sent',wrapped,files);
  dispatch({type:'reply',agent:c.agent,session:c.id,text:wrapped,model,...(c.agent==='codex'&&effortPicked.get(rk)?{effort:effortPicked.get(rk)}:{}),attachments:files,dir:c.project,typeInto:native,...(wf&&!slash?{whenFree:true}:{})},mb,undefined,rk);
  if(wrapped!==txt)replyClear(rk);
// ↑ recalls what you wrote, not the reply header around it
  rememberSent(txt);
  echoSent(wrapped,files);
  if(!(wf&&!slash))goWorking(c);
  box.sent();setTimeout(box.clear,120);
  attachClear(mb);
}
function wireSendBox(c,key){
  const mb=$('#mbody');const inp=mb.querySelector('.msg textarea');
// Clearing while the IME holds an uncommitted string leaves it behind (re-inserted at compositionend):
// blur first to commit, clear, and clear again if a composition ends right after.
  let sentAt=0;
// the input event tells ↑ history and lists the box is empty; the draft is written at once
  const clearBox=()=>{if(inp.value){inp.value='';inp.dispatchEvent(new Event('input'))}if(panelKey===key)keepUnsent()};
  const box={clear:clearBox,sent:()=>{sentAt=Date.now();clearBox();setTimeout(clearBox,0)}};
  inp.addEventListener('compositionend',()=>{if(Date.now()-sentAt<2000)setTimeout(clearBox,0)});
  attachSetup(mb);
  skillSetup(mb,inp,()=>c.project,()=>c.agent==='claude');
  fileSetup(inp,()=>c.project);
  histSetup(inp);
  draftWatch(inp,key);
  autoGrow(inp,220);
// Enter that commits an IME conversion must not send (keyCode 229 is the older WebKit signal)
  inp.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();panelSend(c,mb,inp,box,e.altKey)}
// Esc in an empty box drops the reply chip first
    else if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229&&!inp.value&&replyRefs.has(c.agent+':'+c.id)){e.preventDefault();e.stopPropagation();replyClear(c.agent+':'+c.id)}
// ⌫ at the start removes the reply chip, as if it were the text before the caret
    else if(e.key==='Backspace'&&!e.isComposing&&e.keyCode!==229&&inp.selectionStart===0&&inp.selectionEnd===0&&replyRefs.has(c.agent+':'+c.id)){e.preventDefault();replyClear(c.agent+':'+c.id)}};
  wireModelPick(c,key,mb,inp);
}
// the --model pulldown; the choice is kept per session until reload
function wireModelPick(c,key,mb,inp){
  const mbt=mb.querySelector('.msg .mmodel'),menu=mb.querySelector('.msg .modelmenu');
  if(!mbt||!menu)return;
  const {mLabel}=modelPickOf(c);
  const items=()=>[...menu.querySelectorAll('button')];
  const open=(focus)=>{menu.hidden=false;const on=items().find(o=>o.classList.contains('on'))||items()[0];if(focus&&on)on.focus()};
  const close=(back)=>{menu.hidden=true;if(back)mbt.focus()};
  mbt.onclick=e=>{e.stopPropagation();if(menu.hidden)open(e.detail===0);else close()};
// arrows also move between cards: stop them while the menu has focus
  mbt.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();open(true)}};
  menu.onkeydown=e=>{const it=items(),i=it.indexOf(document.activeElement);e.stopPropagation();
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();it[(i+(e.key==='ArrowDown'?1:it.length-1))%it.length].focus()}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}
    else if(e.key==='Tab')close()};
  for(const b of items())b.onclick=e=>{e.stopPropagation();mbt.dataset.model=b.dataset.m;
// kept per session: a refresh redraws the panel
    if(b.dataset.m)modelPicked.set(key,b.dataset.m);else modelPicked.delete(key);
    for(const o of items())o.classList.toggle('on',o===b);
    mbt.textContent=mLabel(b.dataset.m)+' ▾';close();inp.focus()};
}
// 考える深さ: picked → /effort <level> goes to the session at once (typed into its terminal, else sent)
function wireEffortPick(c,key){
  const b=$('#meffort'),m=$('#mbody .effortmenu');if(!b||!m)return;
  b.onclick=e=>{e.stopPropagation();m.hidden=!m.hidden;if(!m.hidden){const on=m.querySelector('.on')||m.querySelector('button');if(on&&e.detail===0)on.focus()}};
  m.onkeydown=e=>{const it=[...m.querySelectorAll('button')],i=it.indexOf(document.activeElement);e.stopPropagation();
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();it[(i+(e.key==='ArrowDown'?1:it.length-1))%it.length].focus()}
    else if(e.key==='Escape'){e.preventDefault();m.hidden=true;b.focus()}};
  for(const x of m.querySelectorAll('button'))x.onclick=e=>{e.stopPropagation();m.hidden=true;
    const v=x.dataset.e,cmd='/effort '+v;
    effortPicked.set(key,v);b.textContent=t('深さ {v} ▾',{v});for(const o of m.querySelectorAll('button'))o.classList.toggle('on',o===x);
    if(c.agent==='codex'){toast($('#mbody'),t('次の送信から、考える深さ {v} で動かします',{v}));return}
    sendLog(c,'effort',cmd);
    if(panelSlash(c,cmd,ok=>{if(!ok)toast($('#mbody'),t('切り替えられませんでした。送信欄に {cmd} と打って送ってください',{cmd}))}))return;
    dispatch({type:'reply',agent:c.agent,session:c.id,text:cmd,dir:c.project,typeInto:native},$('#mbody'));
    toast($('#mbody'),t('▶ {cmd} を送りました',{cmd}))};
}
// おすすめ: picks the model (used from the next send, as the model menu does) and the 深さ (sent at once)
function wireRecipePick(c){
  const b=$('#mrecipe'),m=$('#mbody .recipemenu');if(!b||!m)return;
  b.onclick=e=>{e.stopPropagation();m.hidden=!m.hidden;if(!m.hidden&&e.detail===0){const f=m.querySelector('button');if(f)f.focus()}};
  m.onkeydown=e=>{const it=[...m.querySelectorAll('button')],i=it.indexOf(document.activeElement);e.stopPropagation();
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();it[(i+(e.key==='ArrowDown'?1:it.length-1))%it.length].focus()}
    else if(e.key==='Escape'){e.preventDefault();m.hidden=true;b.focus()}};
  for(const x of m.querySelectorAll('button'))x.onclick=e=>{e.stopPropagation();m.hidden=true;
    const mi=[...document.querySelectorAll('#mbody .modelmenu button')].find(o=>o.dataset.m===x.dataset.m);if(mi)mi.click();
    const ei=[...document.querySelectorAll('#mbody .effortmenu button')].find(o=>o.dataset.e===x.dataset.e);if(ei)ei.click();
    b.textContent=x.querySelector('b').firstChild.textContent.trim()+' ▾';
    const ta=$('#mbody .msg textarea');if(ta)ta.focus()};
}
function wireSendRow(c){
  wireEffortPick(c,c.agent+':'+c.id);wireRecipePick(c);
  {const fb=$('#mbody .forkbtn'),fw=$('#mbody .forkwt');
    if(fb)fb.onclick=()=>{fb.classList.toggle('on');if(fw)fw.hidden=!fb.classList.contains('on');const ta=$('#mbody .msg textarea');if(ta){ta.placeholder=fb.classList.contains('on')?t('複製した側に頼むこと(元のセッションには送りません)'):t('このセッションへ');ta.focus()}};
    if(fw)fw.onclick=()=>{fw.classList.toggle('on');const ta=$('#mbody .msg textarea');if(ta)ta.focus()}}
  wfWire($('#mbody'),c);
  {const mb=$('#mmode'),mm=$('#mbody .mmodew:not(.mmodelw):not(.meffw):not(.mrecw) .modemenu');
    if(mb&&mm){for(const x of mm.querySelectorAll('button'))x.classList.toggle('on',x.dataset.m===(c.permMode||'default'));
      mb.onclick=e=>{e.stopPropagation();mm.hidden=!mm.hidden};
      for(const x of mm.querySelectorAll('button'))x.onclick=e=>{e.stopPropagation();mm.hidden=true;if(x.dataset.m===(c.permMode||'default'))return;panelMode(c,x.dataset.m)};}}
}
function wireQueuedNote(c){
  const qa=$('#qattach');
// the board's held text is not the CLI's to deliver: copied to the clipboard before the hold is dropped
  if(qa)qa.onclick=()=>{const held=c.queued||'';
// if the panel can host the session, resume here and type the held words instead
    if(held&&!c.alive&&panelTermOK(c)&&panelPtyReady(c,false,()=>panelTypeMsg(c,held),'預かっていた指示')){post({type:'queue',agent:c.agent,session:c.id,cancel:true});
      qa.disabled=true;qa.textContent=t('ここで再開して届けます…');c.queued=null;setTimeout(load,1500);return}
    if(held)copyText(held);openToDeliver(c,c.id.slice(0,8));post({type:'queue',agent:c.agent,session:c.id,cancel:true});
    qa.disabled=true;qa.textContent=held?t('端末で開きました(文面はコピー済み ⌘V で貼って送信)'):t('端末で開きました');c.queued=null;setTimeout(load,1500)};
  const qr=$('#qretry');
  if(qr)qr.onclick=()=>{const m={type:'queue',agent:c.agent,session:c.id,retry:true};
    if(native)post(m); else fetch('api/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).catch(()=>{});
    qr.disabled=true;qr.textContent=t('送り直します');c.queuedFails=0;setTimeout(load,1200)};
  const qc=$('#qcancel');
// held 今の作業後に送る messages stay: each has its own 取り消す
  if(qc)qc.onclick=()=>{const m={type:'queue',agent:c.agent,session:c.id,cancel:true,...((c.held||[]).length?{plain:true}:{})};
    if(native)post(m); else fetch('api/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})
      .then(r=>r.json()).then(j=>{if(j&&j.error)toast($('#mbody'),'✗ '+j.error)}).catch(e=>toast($('#mbody'),'✗ '+e));
    c.queued=(c.held||[]).length?c.held.map(h=>h.text).join('\n\n'):null;c.queuedPlain='';qc.parentElement.remove();toast($('#mbody'),t('送信待ちを取り消しました'));setTimeout(load,800)};
}
function detailDraftBack(c,key,how){
// Restore the draft for this session (00-core.js): quietly if yours, with a word if its send failed
// or was never answered.
  const box=$('#mbody .msg textarea');const r=box&&!box.value?draftTake(key):null;
  if(r){draftShow(key,$('#mbody'),box,r.e);
    if(r.why==='failed')toast($('#mbody'),t('送れなかったメッセージを戻しました'));
    else if(r.why==='unsure')toast($('#mbody'),t('送信の結果を確かめられなかった文を戻しました。届いていないかカードで確かめてから送ってください'))}
  if(box&&box.focus&&!(how&&how.focus===false))box.focus();
// a title that was being renamed when the page went
  const td=draftGet('title:'+key),cl=$('#clabel');
  if(td&&td.t&&cl&&cl.onclick&&!c.subagent){cl.onclick();const ti=cl.querySelector('input.ttledit');if(ti){ti.value=td.t;draftSet('title:'+key,{t:td.t})}}
}
