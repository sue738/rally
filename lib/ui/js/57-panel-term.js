// open the session's folder in an editor (the app picks one; RALLY_EDITOR overrides by bundle id)
function openEditor(c){
  if(!native||!c||!c.project){toast($('#mbody')||document.body,'エディタはアプリの中からだけ開けます');return}
  if(c.project===(live.home||''))return toast($('#mbody')||document.body,'ホームフォルダはエディタで開きません');
  post({type:'openeditor',path:c.project});toast($('#mbody')||document.body,'エディタで開きました: '+shortHome(c.project));
}
// The detail panel's terminal: `claude attach` for a background session, `claude --resume` for a
// stopped one. Leaving the card detaches an attached one; a resumed one is parked, not closed
// (it is this app's process: closing it would end the turn).
// panelView: 'term' (the session's screen) or 'talk' (the conversation); the terminal stays open behind 'talk'.
// what an opened card shows: the header's ターミナル / 会話, one setting for every card. A card whose
// terminal is needed right now (a send, an unpark) shows it without changing the setting.
function panelPref(){try{return localStorage.getItem('panelview')==='talk'?'talk':'term'}catch(e){return 'term'}}
let panelView=panelPref();
function panelPrefSet(v){v=v==='talk'?'talk':'term';try{localStorage.setItem('panelview',v)}catch(e){}
  for(const b of document.querySelectorAll('#pviewseg button'))b.classList.toggle('on',b.dataset.p===v);
  if(openCard&&$('#mbody .mviews'))panelSwitch(v);else panelView=v}
// the panel's header can fold to the title row, giving the terminal the room
let panelFold=false;try{panelFold=localStorage.getItem('panelfold')==='1'}catch(e){}
function panelFoldSet(on){
  panelFold=!!on;try{localStorage.setItem('panelfold',panelFold?'1':'0')}catch(e){}
  const m=$('#mmeta');if(m)m.classList.toggle('fold',panelFold);
  const b=$('#mfold');if(b){b.textContent=panelFold?'▸':'▾';b.setAttribute('aria-expanded',panelFold?'false':'true')}
  const p=openCard&&panelPty(openCard);if(p)requestAnimationFrame(()=>ptyFit(p));
}
function panelTermOK(c){return native&&!!window.Terminal&&!!c&&c.agent==='claude'&&!c.subagent}
/** The panel has a ターミナル view: claude's (panelTermOK), or a codex session's, reopened with codex resume. */
function panelTermView(c){return panelTermOK(c)||(native&&!!window.Terminal&&!!c&&(c.agent==='codex'||c.agent==='antigravity')&&!c.subagent)}
let panelTermTimer=null;
function panelPty(c){for(const p of ptys.values())if(!p.gone&&!p.closing&&p.full===c.id)return p;return null}
// sessions whose panel terminal ended: offer to restart rather than restarting by itself
const ptyEnded=new Set();
// …until the session runs again (seen stopped then alive, or writing since); checked on every refresh
const ptyEndedHow=new Map();
function ptyEndedSync(cards){
  for(const id of [...ptyEnded]){
    const c=(cards||[]).find(x=>x.id===id),h=ptyEndedHow.get(id);if(!c||!h)continue;
    if(!c.alive){h.dead=true;continue}
    if(!h.dead&&(h.attach||(c.lastT||0)<=h.at+1000))continue;
    ptyEnded.delete(id);ptyEndedHow.delete(id);
    if(openCard&&openCard.id===id&&$('#mterm'))mountPanelTerm(openCard,false);
  }
}
function mountPanelTerm(c,focus){
  const mb=$('#mbody'),box=$('#mterm');
  if(!mb)return;
  const on=!!box&&panelView==='term';
  mb.classList.toggle('pterm',on);
  document.body.classList.toggle('pterm-on',!!box);
  mb.classList.toggle('hasterm',!!box);
  for(const b of mb.querySelectorAll('.mviews button'))b.classList.toggle('on',b.dataset.p===(box?panelView:'talk'));
  // on pointerdown: a refresh redrawing between press and release would replace the button and lose the click
  for(const b of mb.querySelectorAll('.mviews button')){b.onpointerdown=e=>{if(e.button===0){e.preventDefault();panelSwitch(b.dataset.p)}};b.onclick=e=>{if(e.detail===0)panelSwitch(b.dataset.p)}}
  if(!box)return;
  // refit when the terminal's own box resizes (fold, 残作業 above, window width)
  if(window.ResizeObserver&&!box._ro){let q=0;box._ro=new ResizeObserver(()=>{cancelAnimationFrame(q);q=requestAnimationFrame(()=>{
    const p=openCard&&panelPty(openCard);if(p&&!p.gone&&p.el.closest('#mterm')&&box.clientHeight>0)ptyFit(p)})});box._ro.observe(box)}
  // one already open for this session (here or in the strip) moves into the panel; an ended one stays to say why
  const have=panelPty(c)||[...ptys.values()].find(p=>!p.gone&&!p.closing&&p.session&&c.id.startsWith(p.session))||[...ptys.values()].find(p=>p.gone&&p.host&&p.full===c.id);
  box.classList.remove('live');
  if(have&&!have.gone){ptyEnded.delete(c.id);ptyEndedHow.delete(c.id)}
  if(have){let hidden=false;
    // keep focus if it had it before the move
    const had=have.el.contains(document.activeElement);
    if(have.el.parentNode!==box){const fromStrip=!have.host;hidden=!!have.parked;
      box.replaceChildren(have.el);have.host=true;have.parked=false;have.parkT=0;have.full=c.id;have.el.classList.add('ppty');if(!have.gone)ptyGlOn(have);
      if(fromStrip)ptyLayout()}
    box.classList.add('live');
    // focus now; fit after layout, and rebuild the atlas only when it was hidden (ptyRepaintNow)
    if((focus||had)&&on)have.xt.focus();
    requestAnimationFrame(()=>{ptyFit(have);if(hidden)ptyRepaintNow();if(focus&&on)have.xt.focus()});return}
  if(!on)return;
  clearTimeout(panelTermTimer);
  // codex / antigravity: nothing to attach to while a print run works. Stopped, reopen only on a press:
  // the board cannot tell whether one runs elsewhere, and two would write one session.
  if(c.agent==='codex'||c.agent==='antigravity'){
    const agy=c.agent==='antigravity',run=agy?'agy -p':'codex exec',again=agy?'agy --conversation':'codex resume';
    if(c.column==='working'){box.innerHTML='<div class="mtstart"><span>作業中です。'+run+' にはつなげないので、終わったらここで再開できます</span></div>';return}
    // agy -p cannot ask for permission, so such a run was denied; interactively it can (Pty.swift mode "go")
    const denied=agy&&/^denied without a prompt: (.+)/.exec(c.reason||'');   // lib/live.js
    if(denied){
      box.innerHTML='<div class="mtstart"><span>'+esc(denied[1])+' の許可が要る操作は、画面なしの実行では確認できずに止まりました</span><button id="mresume" class="mini primary" title="agy --conversation をこのパネルで開き、許可を確認しながら続けます">ここで許可して続ける</button></div>';
      $('#mresume').onclick=()=>{box.innerHTML='';box.classList.add('live');ptyOpen('agy',{host:box,session:c.id,uuid:c.id,full:c.id,label:ptyLabel(c),cwd:c.project||'',mode:'go',focus:true})};
      if(focus)$('#mresume').focus();
      return}
    box.innerHTML='<div class="mtstart"><span>このセッションはいま動いていません</span><button id="mresume" class="mini primary" title="再開すると、ここがそのセッションの画面になります">ここで再開 <span class="dim">('+again+')</span></button></div>';
    $('#mresume').onclick=()=>{box.innerHTML='';box.classList.add('live');ptyOpen(agy?'agy':'codex',{host:box,session:c.id,uuid:c.id,full:c.id,label:ptyLabel(c),cwd:c.project||'',focus:true})};
    if(focus)$('#mresume').focus();
    return}
  // open in another terminal: offer to bring it forward, or take it over while idle (takeoverWhy)
  if(c.alive&&c.aliveKind==='interactive'){
    const why=takeoverWhy(c);
    box.innerHTML='<div class="mtstart"><span>ほかの端末で開いています</span><button id="mgoterm" class="mini primary" title="そのセッションの端末を前に出します ('+esc(kmL('panel.goterm'))+')">端末へ</button>'+
      (why?'<span class="dim mtwhy">'+esc(why)+'</span>':'<button id="mtakeover" class="mini" title="その端末の claude を閉じて(会話は残ります)、このパネルで開き直します">ここで開き直す</button>')+'</div>';
    $('#mgoterm').onclick=()=>goTerm(c);
    const tb=$('#mtakeover');if(tb)tb.onclick=()=>takeoverPress(c,tb);
    // redrawn while closing: keep it disabled (a second press would resume twice)
    if(tb&&takeoverWait.has(c.id)){tb.disabled=true;tb.classList.add('arm');tb.textContent='その端末の claude を閉じています…'}
    if(c.alivePid)post({type:'ptyowner',pid:c.alivePid,session:c.id});
    return}
  const running=c.alive&&c.aliveKind==='background';
  if(ptyEnded.has(c.id)){
    box.innerHTML='<div class="mtstart"><span>ターミナルを終了しました</span><button id="mresume" class="mini primary">'+(running?'もう一度つなぐ':'ここで再開 <span class="dim">(claude --resume)</span>')+'</button></div>';
    $('#mresume').onclick=()=>{ptyEnded.delete(c.id);ptyEndedHow.delete(c.id);mountPanelTerm(c,true)};
    if(focus)$('#mresume').focus();
    return}
  if(running){
    // delayed, so ↑↓ through cards does not attach to each on the way
    box.innerHTML='<div class="mtwait dim">接続しています…</div>';box.classList.add('live');
    panelTermTimer=setTimeout(()=>{if(openCard!==c&&!(openCard&&openCard.id===c.id))return;box.innerHTML='';box.classList.add('live');
      ptyOpen('attach',{host:box,session:(c.aliveShort||c.id).slice(0,8),full:c.id,label:ptyLabel(c),cwd:c.project||'',focus})},focus?0:350);
    return}
  const go=(f,auto)=>{box.innerHTML='';box.classList.add('live');ptyOpen('resume',{host:box,session:c.id,full:c.id,label:ptyLabel(c),cwd:c.project||'',focus:f!==false,auto:!!auto})};
  // Known stopped: resume it without a press. Only when liveness is known (resuming a running
  // session forks a copy), and delayed so ↑↓ past cards does not start each.
  if(c.aliveChecked&&!c.alive&&!c.headless){
    box.innerHTML='<div class="mtwait dim">再開しています… <span class="dim">(claude --resume)</span></div>';box.classList.add('live');
    panelTermTimer=setTimeout(()=>{if(openCard!==c&&!(openCard&&openCard.id===c.id))return;if(panelView!=='term')return;go(!!focus,true)},focus?0:350);
    return}
  box.innerHTML='<div class="mtstart"><span>このセッションはいま動いていません</span><button id="mresume" class="mini primary" title="再開すると、ここがそのセッションの画面になります。パネルを離れても裏で動き続け、このカードを開くとまたここに出ます">ここで再開 <span class="dim">(claude --resume)</span></button></div>';
  $('#mresume').onclick=()=>go(true);
  if(focus)$('#mresume').focus();
}
/** ターミナル ⇄ 会話 */
function panelSwitch(v){
  if(!openCard||!$('#mbody .mviews'))return;
  if((v==='talk'?'talk':'term')!==panelView)autoSwitchLog('view '+panelView+' → '+v+' on '+openCard.agent+':'+openCard.id.slice(0,8));
  panelView=v==='talk'?'talk':'term';
  const c=openCard;mountPanelTerm(c,panelView==='term');
  if(typeof askPopSync==='function'&&live)askPopSync(live);
  if(panelView==='talk'){histStick=true;askHistory(c);const h=$('#mhist');if(h)stickBottom(h);
    const b=msgBox();if(b&&!b.disabled&&document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm'))b.focus()}
}
// The session's terminal in the panel, at its prompt: the open one, or attach/resume one.
// bg: keep 会話 on screen. then(p) once the CLI has drawn and gone quiet; never() if not within 20 s.
function panelPtyReady(c,bg,then,what,never){
  if(!panelTermOK(c))return false;
  if(c.alive&&c.aliveKind==='interactive'&&!panelPty(c))return false;   // someone's terminal
  if(!bg&&panelView!=='term')autoSwitchLog('view talk → term (to type '+(what||'')+') on '+c.agent+':'+String(c.id).slice(0,8));
  if(!bg)panelView='term';
  mountPanelTerm(c,!bg);
  let p=panelPty(c);
  if(p&&!p.gone){then(p);return true}
  const box=$('#mterm');if(!box)return false;
  clearTimeout(panelTermTimer);box.innerHTML='';box.classList.add('live');
  const running=c.alive&&c.aliveKind==='background';
  ptyOpen(running?'attach':'resume',{host:box,session:running?(c.aliveShort||c.id).slice(0,8):c.id,full:c.id,label:ptyLabel(c),cwd:c.project||'',focus:!bg});
  p=panelPty(c);if(!p)return false;
  toast($('#mbody'),bg?what+' の準備をしています…':'ターミナルを開いて '+what+' を送ります…');
  ptyWhenReady(p,then,undefined,never&&(()=>{if(!p.gone)toast($('#mbody'),'ターミナルが応答しないので送っていません。ターミナルで直接打ってください');never()}));
  return true;
}
// then(p) once the CLI has drawn and gone quiet (at its prompt)
function ptyWhenReady(p,then,quiet,never){
  const t0=Date.now();let seen=-1,quietSince=0;const q=quiet==null?900:quiet;
  const tick=setInterval(()=>{
    if(p.gone||Date.now()-t0>20000){clearInterval(tick);if(never)never();else if(!p.gone)toast($('#mbody'),'ターミナルが応答しないので送っていません。ターミナルで直接打ってください');return}
    const b=p.xt.buffer.active;let n=0;for(let i=0;i<b.length;i++)n+=b.getLine(i).translateToString(true).trim().length;
    if(n!==seen){seen=n;quietSince=Date.now();return}
    if(n>0&&Date.now()-quietSince>q){clearInterval(tick);then(p)}
  },150);
}
// A message for a session running in this app's own terminal is typed there: the send route
// cannot type into it. false: no such terminal. fin(true|false): whether it was typed.
function panelTypeMsg(c,text,fin){
  const p=panelPty(c);
  ptyFixKind(p);
  if(!p||p.gone||!(p.kind==='resume'||p.kind==='attach'||p.kind==='codex'||p.kind==='agy')||!p.started)return false;
  const bg=panelView!=='term'||!p.el.closest('#mterm');
  const go=q=>{
    if(ptyAsking(q)){panelSwitch('term');requestAnimationFrame(()=>q.xt.focus());flash('ターミナルが確認を待っています。答えてから送り直してください');if(fin)fin(false);return}
    // paste as one block so a newline does not send early, then Enter
    // with a file path in it Claude Code first turns the path into an image ([Image #1]); an Enter sent meanwhile was
    // lost and the words sat in the input until pressed by hand. So: Enter later, then once more if they are still there
    ptyTypeEnter(q,text);if(fin)fin(true);
    toast($('#mbody'),bg?'▶ このアプリのターミナルで動いているので、そこに打ち込みました(画面はそのまま)':'▶ ターミナルに打ち込みました');
  };
  ptyWhenReady(p,go,300,fin&&(()=>{if(!p.gone)toast($('#mbody'),'ターミナルが応答しないので送っていません。ターミナルで直接打ってください');fin(false)}));
  return true;
}
// a question on screen (trust, menu, permission): a typed line would be taken as the answer
// what the screen shows now, not the scrollback: a codex answer that once printed "Do you want to …" kept every later
// message from the conversation pulling the terminal forward as if it were asking
/** Paste words into a session's terminal and press Enter — later when they carry a file path (Claude Code first turns
 * the path into an image, and an Enter meanwhile was lost) — then look again and press Enter while they are still in the
 * input box: up to 4 more times, the waits growing (1.5, 3, 5, 8 s). Words that have gone are not pressed for again. */
const PTY_ENTER_RETRY=[1500,3000,5000,8000];
function ptyTypeEnter(q,text){
  const slow=/添付ファイル\(このパスを読んでください\)/.test(text);
  q.xt.paste(text);setTimeout(()=>{if(!q.gone)post({type:'ptyin',id:q.id,data:'\r'})},slow?700:60);
  const log=m=>{if(native)try{post({type:'log',text:'send typed: '+m})}catch(e){}};
  const check=n=>{
    if(q.gone||!ptyInputHas(q,text))return;
    if(n>=PTY_ENTER_RETRY.length){log('still in the input after '+n+' more Enters');flash('ターミナルの入力欄に文が残っています。Enter で送ってください');return}
    post({type:'ptyin',id:q.id,data:'\r'});log('Enter pressed again ('+(n+1)+')');
    setTimeout(()=>check(n+1),PTY_ENTER_RETRY[n+1]||PTY_ENTER_RETRY[n]);
  };
  setTimeout(()=>check(0),(slow?700:60)+PTY_ENTER_RETRY[0]);
  // typed into a terminal that had only just attached, the words can land before its prompt is up and vanish (10-21:
  // nothing in the box, nothing sent). Not on the screen at all a moment later: typed once more
  // (only a short one-line message: a long or multi-line paste is shown as [Pasted text …], not its words)
  if(!/\n/.test(text)&&text.length<200&&!slow)setTimeout(()=>{if(q.gone||ptyScreenHas(q,text))return;log('not on the screen after typing, typed again');
    q.xt.paste(text);setTimeout(()=>{if(!q.gone)post({type:'ptyin',id:q.id,data:'\r'})},slow?700:60)},2560);
}
/** These words anywhere on the visible screen (in the box, or above it as the prompt just sent). */
function ptyScreenHas(p,text){
  const b=p.xt.buffer.active,top=b.baseY||0,rows=p.xt.rows||24;let all='';
  for(let i=Math.max(0,top-rows);i<Math.min(b.length,top+rows);i++)all+=b.getLine(i).translateToString(true);
  const head=String(text).split('添付ファイル(')[0].replace(/\s+/g,'').slice(0,12);
  return !head||all.replace(/\s+/g,'').includes(head);
}
/** Are these words still in the session's input box (between its two rules at the foot of the screen), not sent? */
function ptyInputHas(p,text){
  const b=p.xt.buffer.active,top=b.baseY||0,rows=p.xt.rows||24,L=[];
  for(let i=top;i<Math.min(b.length,top+rows);i++)L.push(b.getLine(i).translateToString(true));
  const rules=L.map((l,i)=>/^\s*[─━]{10,}\s*$/.test(l)?i:-1).filter(i=>i>=0);if(rules.length<2)return false;
  const box=L.slice(rules[rules.length-2]+1,rules[rules.length-1]).join(' ').replace(/\s+/g,'');
  const head=String(text).split('添付ファイル(')[0].replace(/\s+/g,'').slice(0,12);
  return !!head&&box.includes(head);
}
function ptyAsking(p){const b=p.xt.buffer.active,top=b.baseY||0,rows=p.xt.rows||24;let x='';for(let i=top;i<Math.min(b.length,top+rows);i++)x+=b.getLine(i).translateToString(true)+'\n';return /Enter to confirm|Esc to cancel|Do you want to|❯ (Yes|No)\b|› \d\. Yes\b|Would you like to (run|make|apply)/.test(x)}
function panelSlash(c,cmd,fin){
  // from 会話 it is typed out of sight; the terminal comes forward only if the command asks something
  const bg=panelView!=='term';
  const name=cmd.split(/\s/)[0];
  const show=p=>{panelSwitch('term');requestAnimationFrame(()=>p.xt.focus())};
  const type=p=>{
    const line=cmd.replace(/[\r\n]+/g,' ');
    // !command: send ! first (it switches the prompt to bash mode), the rest a moment later
    if(/^!/.test(line)){post({type:'ptyin',id:p.id,data:'!'});setTimeout(()=>{if(!p.gone)post({type:'ptyin',id:p.id,data:line.slice(1)+'\r'})},150)}
    else post({type:'ptyin',id:p.id,data:line+'\r'});
    if(!bg){p.xt.focus();toast($('#mbody'),'▶ ターミナルで '+name+' を実行しました');return}
    toast($('#mbody'),'▶ '+name+' を裏で送りました(画面はそのまま)');
    setTimeout(()=>{if(!p.gone&&panelView!=='term'&&openCard&&openCard.id===c.id&&ptyAsking(p)){show(p);flash(name+' が選択を待っています')}},1200);
  };
  return panelPtyReady(c,bg,p=>{if(ptyAsking(p)){if(bg)show(p);else p.xt.focus();flash('ターミナルが確認を待っています。答えてから '+name+' を送り直してください');if(fin)fin(false);return}type(p);if(fin)fin(true)},name,fin&&(()=>fin(false)));
}
// the permission mode, as the status line under Claude's prompt shows it
const PERM_MODES=[['default','確認あり','毎回たずねます'],['acceptEdits','編集OK','ファイル編集は確認なし(コマンドは確認)'],['plan','計画だけ','読んで計画だけ。変更しません'],['auto','auto','安全な操作は自動で進めます']];
function ptyMode(p){
  const b=p.xt.buffer.active;let x='';for(let i=Math.max(0,b.length-8);i<b.length;i++)x+=b.getLine(i).translateToString(true)+'\n';
  if(/auto mode on/i.test(x))return 'auto';if(/accept edits on/i.test(x))return 'acceptEdits';if(/plan mode on/i.test(x))return 'plan';
  if(/bypass permissions on/i.test(x))return 'bypassPermissions';
  return 'default';   // the CLI says "manual mode on"; the transcript records it as default
}
// Shift+Tab until the status line shows the wanted mode
function panelMode(c,want){
  const label=(PERM_MODES.find(m=>m[0]===want)||[,want])[1];
  // Shift+Tab cycles manual → acceptEdits → plan; auto is only a start flag, so restart the
  // session with it — only one this panel started (restarting others would fork a copy).
  if(want==='auto'){
    const p0=panelPty(c);
    const mine=!!p0&&(p0.kind==='resume'||(p0.kind==='attach'&&p0.bg));
    if(c.alive&&!mine){toast($('#mbody'),'動いているセッションは auto に切り替えられません(auto は起動時に決まります)');return false}
    const box=$('#mterm');if(!box)return false;
    const wasBg=!!p0&&p0.kind==='attach'&&p0.bg;
    if(p0&&!p0.gone){p0.full='';ptyClose(p0.id)}
    const run=()=>{box.innerHTML='';box.classList.add('live');const before=new Set(ptys.keys());
      // direct: a background session would keep its own mode
      ptyOpen('resume',{host:box,session:c.id,full:c.id,label:ptyLabel(c),cwd:c.project||'',focus:panelView==='term',mode:'auto',direct:true});
      const p=[...ptys.values()].find(x=>!before.has(x.id));if(!p)return;
      const t0=Date.now();const iv=setInterval(()=>{
        if(!p.gone&&ptyMode(p)==='auto'){clearInterval(iv);c.permMode='auto';syncModeBtn(c);toast($('#mbody'),'▶ auto で開き直しました');return}
        const b=p.xt.buffer.active;let x='';for(let i=Math.max(0,b.length-12);i<b.length;i++)x+=b.getLine(i).translateToString(true)+'\n';
        if(/auto mode unavailable/i.test(x)){clearInterval(iv);c.permMode=ptyMode(p);syncModeBtn(c);toast($('#mbody'),'このモデル('+(c.model||'いまのモデル')+')では auto は使えません。/model で opus か sonnet にすると選べます');return}
        if(p.gone||Date.now()-t0>20000){clearInterval(iv);toast($('#mbody'),'auto にできませんでした')}},300)};
    // resume only once it has stopped: resuming a running one starts a copy
    if(wasBg){bgStopWait.set(c.id,r=>{if(r&&r.ok)setTimeout(run,300);else toast($('#mbody'),'止められなかったので auto にしていません(もう一度開いてください)')});post({type:'bgstop',session:c.id,force:true})}
    else setTimeout(run,p0?600:0);
    toast($('#mbody'),'auto で開き直しています…');
    return true}
  return panelPtyReady(c,panelView!=='term',p=>{
    if(ptyAsking(p)){toast($('#mbody'),'ターミナルが確認を待っています。答えてから切り替えてください');return}
    let n=0;const step=()=>{
      const now=ptyMode(p);
      if(now===want){c.permMode=want;syncModeBtn(c);toast($('#mbody'),'▶ モードを '+label+' にしました');return}
      if(++n>6||p.gone){c.permMode=now;syncModeBtn(c);toast($('#mbody'),label+' に切り替えられませんでした');return}
      post({type:'ptyin',id:p.id,data:'\x1b[Z'});setTimeout(step,450)};
    step()},'モード切替');
}
// bgstop answers (main.swift): session → callback
const bgStopWait=new Map();
window.__kanban.bgStopped=function(session,r){const f=bgStopWait.get(session);if(!f)return;bgStopWait.delete(session);f(r||{})};
// ここで開き直す: close a session in another terminal and resume it here. Resuming while it runs
// would fork a copy, so the app first SIGTERMs its checked pid (lib/takeover.js) and answers once
// `claude agents` no longer lists it. Only while it is idle there.
function takeoverWhy(c){
  if(c.aliveStatus==='busy')return '作業中なので移せません';
  if(c.aliveStatus==='waiting'||c.aliveWaitingFor||c.aliveState==='blocked')return '確認待ちなので移せません(その端末で答えてから)';
  if((c.aliveCopies||1)>1)return 'いくつもの端末で開いているので移せません';
  if(c.aliveStatus!=='idle'||!c.alivePid)return 'いま待機中か分からないので移せません';
  return '';
}
const takeoverWait=new Map();
// two presses: the first says what will happen
function takeoverPress(c,b){
  if(!b.classList.contains('arm')){b.classList.add('arm');b.textContent='その端末の claude を閉じて開き直す(会話は残ります)';
    setTimeout(()=>{if(b.isConnected&&b.classList.contains('arm')&&!b.disabled){b.classList.remove('arm');b.textContent='ここで開き直す'}},5000);return}
  if(takeoverWait.has(c.id))return;
  b.disabled=true;b.textContent='その端末の claude を閉じています…';
  takeoverWait.set(c.id,r=>{
    const here=openCard&&openCard.id===c.id;
    if(!r||!r.ok){toast($('#mbody')||document.body,(r&&r.error)||'閉じられませんでした。ここでは開いていません');if(here)mountPanelTerm(openCard,false);return}
    for(const x of [c,here?openCard:null])if(x){x.alive=false;x.aliveKind=null;x.aliveStatus=null;x.alivePid=null;x.aliveChecked=true}
    if(!here||panelView!=='term'){toast(document.body,'その端末の claude を閉じました。カードを開くとここで再開します');return}
    const box=$('#mterm');if(!box||panelPty(openCard))return;
    clearTimeout(panelTermTimer);box.innerHTML='';box.classList.add('live');
    ptyOpen('resume',{host:box,session:c.id,full:c.id,label:ptyLabel(openCard),cwd:openCard.project||'',focus:true});
    toast($('#mbody'),'▶ その端末の claude を閉じて、ここで開き直しました');
  });
  post({type:'takeover',session:c.id});
}
window.__kanban.tookOver=function(session,r){const f=takeoverWait.get(session);if(!f)return;takeoverWait.delete(session);f(r||{})};
function syncModeBtn(c){const b=$('#mmode');if(!b)return;const m=PERM_MODES.find(x=>x[0]===(c.permMode||'default'));b.textContent=(m?m[1]:c.permMode)+' ▾';b.dataset.m=c.permMode||'default'}
/** A codex / agy terminal an older build restored (and saved) as a plain shell: still its session's. */
function ptyFixKind(p){
  if(!p||p.kind!=='shell'||!p.full)return;
  const c=(live.cards||[]).find(x=>x.id===p.full);
  if(c&&(c.agent==='codex'||c.agent==='antigravity')){p.kind=c.agent==='codex'?'codex':'agy';ptyMetaSync(p)}
}
function panelTermRelease(nextKey){
  clearTimeout(panelTermTimer);
  for(const p of [...ptys.values()]){
    if(!p.host||p.gone||p.parked)continue;
    // taken for a shell, a codex terminal was sent to the strip on the right whenever you left its card
    ptyFixKind(p);
    if(nextKey&&nextKey.endsWith(':'+p.full))continue;
    // look-only terminals are parked (out of sight) so coming back is instant; only the last
    // PTY_CACHE are kept, and closing one started just for the look stops that session again
    if((p.kind==='resume'||p.kind==='attach')&&ptyLook(p)){ptyPark(p);p.parkT=Date.now();ptyCacheTrim();continue}
    // a resumed one you worked in is this app's process: parked, back with its card; strip ones return there
    if(p.kind!=='shell'&&!p.fromStrip){ptyPark(p);continue}
    // a shell's session is asked again next time: its claude may have exited
    if(p.kind==='shell')p.full='';
    // back to the strip without unfolding it: leaving a card is not asking for the terminal (it opened by itself)
    if(native)try{post({type:'log',text:'panel terminal back to the strip: '+p.kind+(p.fromStrip?' (from strip)':'')})}catch(e){}
    ptyToStrip(p,true);
  }
}
