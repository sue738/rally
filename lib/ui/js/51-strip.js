// ---- the terminal strip -------------------------------------------------
// One command per Enter, run by the app through the login shell: not a pty (no
// colours), typing while it runs goes to stdin. Programs that need a real
// terminal are sent to a shell pane instead (termInteractive).
// Up to MAX_PANES panes; the first (`term`) keeps the ids the page and selftest use.
const MAX_PANES=3;
const panes=[];
let paneSeq=0,paneAct=0;
function newPaneState(id,el){return {id,el,hist:[],at:0,busy:false,cwd:'',block:null}}
const term=newPaneState(0,document.querySelector('.tpane[data-pane="0"]'));
panes.push(term);
function paneOf(id){return panes.find(p=>p.id===(+id||0))||null}
function activePane(){return paneOf(paneAct)||panes[0]}
function paneIn(p){return p&&p.el.querySelector('.tin')}
function termCwdLabel(){const c=$('#termcwd'),p=activePane();if(c&&p)c.textContent=(p.cwd||'').replace(/^\/Users\/[^/]+/,'~')}
function setActivePane(p){
  paneAct=p.id;for(const x of panes)x.el.classList.toggle('act',x===p);termCwdLabel();
}
function termBottom(p){const sc=(p||activePane()).el.querySelector('.tscroll');if(sc)sc.scrollTop=sc.scrollHeight}
// the log and ↑ history survive a reload (this browser only)
function logKey(p,k){return p.id?k+':'+p.id:k}
function termSave(p){
  try{
    for(const x of p?[p]:panes){
      const runs=[...x.el.querySelectorAll('.tlog .trun')].filter(b=>!b.classList.contains('busy')).slice(-100).map(b=>({c:b.querySelector('.tcmd').textContent,o:b.querySelector('.tout').textContent.slice(-20000),bad:b.classList.contains('bad'),n:(b.querySelector('.tnote')||{}).textContent||''}));
      localStorage.setItem(logKey(x,'termlog'),JSON.stringify(runs));localStorage.setItem(logKey(x,'termhist'),JSON.stringify(x.hist.slice(-300)));
    }
    localStorage.setItem('termpanes',JSON.stringify(panes.map(x=>x.id)));
  }catch(e){}
}
// the unrun line survives a reload too, but not while a command runs (then it is stdin)
function termLineSave(p){
  try{const i=paneIn(p);if(!i||p.busy)return;const v=String(i.value||'');
    if(v.trim())localStorage.setItem(logKey(p,'termline'),v.slice(0,4000));else localStorage.removeItem(logKey(p,'termline'))}catch(e){}
}
function termLineSaveAll(){for(const p of panes)termLineSave(p)}
function termRestore(p){
  const o=p.el.querySelector('.tlog');if(!o)return;
  try{
    for(const r of JSON.parse(localStorage.getItem(logKey(p,'termlog'))||'[]')){
      const b=document.createElement('div');b.className='trun'+(r.bad?' bad':'');
      b.innerHTML='<div class="tcmd"></div><pre class="tout"></pre>';b.querySelector('.tcmd').textContent=r.c;b.querySelector('.tout').textContent=r.o;
      if(r.n){const n=document.createElement('div');n.className='tnote';n.textContent=r.n;b.appendChild(n)}
      o.appendChild(b);
    }
    p.hist=JSON.parse(localStorage.getItem(logKey(p,'termhist'))||'[]');p.at=p.hist.length;
  }catch(e){}
  try{const v=localStorage.getItem(logKey(p,'termline')),i=paneIn(p);if(v&&i&&!i.value)i.value=v}catch(e){}
  termBottom(p);
}
function termBlock(p,cmd){
  const o=p.el.querySelector('.tlog');if(!o)return null;
  const b=document.createElement('div');b.className='trun busy';
  b.innerHTML='<div class="tcmd"></div><pre class="tout"></pre>';
  b.querySelector('.tcmd').textContent=(p.cwd?p.cwd.replace(/^\/Users\/[^/]+/,'~')+' ':'')+'❯ '+cmd;
  b.querySelector('.tout').textContent='…';
  o.appendChild(b);
  while(o.children.length>200)o.removeChild(o.firstChild);
  termBottom(p);
  return b;
}
function termOpen(on){
  // which path unfolded the strip, in the app's log: it opened at odd moments (the caller is the stack's next frame)
  if(on&&native&&document.body.classList.contains('termclosed'))try{const st=String(new Error().stack||'').split('\n').map(l=>l.split('@')[0].trim()).filter(Boolean);const ev=window.event,how=ev?ev.type+(ev.key?' '+(ev.metaKey?'⌘':'')+ev.key:'')+(ev.target&&ev.target.id?' #'+ev.target.id:ev.target&&ev.target.className?' .'+String(ev.target.className).split(' ')[0]:''):'';post({type:'log',text:'terminal strip opened by: '+(st.slice(1,4).join(' < ')||'?')+(how?' ['+how+']':'')})}catch(e){}
  document.body.classList.toggle('termclosed',!on);
  const t=$('#termtoggle');if(t){const l=on?'ターミナルを隠す':'ターミナルを表示';t.dataset.open=on?'1':'0';
    t.innerHTML='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="'+(on?'M4 6l4 4 4-4':'M4 10l4-4 4 4')+'" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><kbd>⌘J</kbd>';
    t.title=l+' ('+kmL('term.meta')+')';t.setAttribute('aria-label',l)}
  try{localStorage.setItem('termopen',on?'1':'0')}catch(e){}
}
// the tail of a running command's output, a few times a second; shellOut replaces it at exit
window.__kanban.shellPart=function(r){
  const p=paneOf(r.pane)||term;const b=p.block;if(!b||!p.busy)return;
  const sc=p.el.querySelector('.tscroll'),atEnd=!sc||sc.scrollHeight-sc.scrollTop-sc.clientHeight<40;
  p.lastOut=String(r.out||'');
  b.querySelector('.tout').textContent=p.lastOut||'…';
  termAsk(p);
  if(atEnd)termBottom(p);
};
// output ending without a newline: a question waiting for an answer
function termPromptLine(out){const m=/([^\n]*)$/.exec(out||'');const l=m?m[1]:'';return l.trim()?l:''}
const PASS_RE=/pass(word|phrase)|パスワード|\bPIN\b|token/i;
// A running command that asks something: the question moves into the input line, as a terminal
// shows it, with an offer to rerun it in a real shell.
function termAsk(p){
  const b=p.block,line=p.el.querySelector('.tline');
  const q=b&&p.busy&&Date.now()-(p.started||0)>=1500?termPromptLine(p.lastOut):'';
  let n=b&&b.querySelector('.task');
  if(!q){if(n)n.remove();if(line)line.classList.remove('asking');p.secret=false;termInMode(p);return}
  p.secret=PASS_RE.test(q);
  const out=b.querySelector('.tout'),head=p.lastOut.slice(0,p.lastOut.length-q.length).replace(/\n$/,'');
  out.textContent=head;out.hidden=!head;
  if(line){let tq=line.querySelector('.tq');if(!tq){tq=document.createElement('span');tq.className='tq';line.insertBefore(tq,line.querySelector('.tin'))}
    tq.textContent=q.replace(/\s+$/,'')+' ';line.classList.add('asking')}
  termInMode(p);
  if(n)return;
  n=document.createElement('div');n.className='tnote task';
  n.innerHTML='<span>Enter で答える · ⌃D 入力の終わり · ⌃C 止める</span>';
  if(native&&window.Terminal){const k=document.createElement('button');k.className='tshell';k.textContent='本物の端末で続ける';k.title='これを止めて、同じフォルダのシェル(本物の端末)でもう一度実行します';
    k.onclick=e=>{e.stopPropagation();termToShell(p,p.cmd,true)};n.appendChild(k)}
  b.appendChild(n);termBottom(p);
}
function termInMode(p){
  if(!p.busy){const l=p.el&&p.el.querySelector('.tline');if(l)l.classList.remove('asking');const o=p.block&&p.block.querySelector('.tout');if(o)o.hidden=false}
  const i=paneIn(p);if(!i)return;
  i.type=p.busy&&p.secret?'password':'text';
  if(p.busy)i.placeholder=p.el&&p.el.querySelector('.tline.asking')?(p.secret?'(入力は表示されません)':''):'実行中… 入力して Enter で送る · ⌃C で止める';
}
// Rerun a command in a shell pane in this pane's place. stop: it is running here and must be
// stopped first (a running process cannot move terminals).
function termToShell(p,cmd,stop){
  const before=new Set(ptys.keys());
  if(!ptyOpen('shell',{label:cmd.slice(0,24)||'シェル',title:cmd,cwd:p.cwd||term.cwd||''}))return false;
  const s=[...ptys.values()].find(x=>!before.has(x.id));if(!s)return false;
  if(stop&&p.busy){p.movedTo=s.id;post({type:'shellstop',pane:p.id})}
  // exit in the shell brings the command pane back (ptyDrop)
  s.inPlaceOf=p;p.handed=s.id;p.el.hidden=true;
  if(panes.filter(x=>!x.handed).length===0||panes.indexOf(p)===0)$('#ptys').prepend(s.el);
  ptyLayout();
  ptyType(s,cmd);
  return true;
}
// Programs that need a real terminal: they read the keyboard directly, draw a screen, or are a REPL.
function termInteractive(cmd){
  for(let seg of String(cmd).split(/&&|\|\||[;|&]/)){
    seg=seg.trim().replace(/^(\w+=\S*\s+)+/,'').replace(/^(command|builtin|exec|time|env|nohup)\s+/,'');
    const w=seg.split(/\s+/),a=w[0]||'',rest=w.slice(1),args=rest.filter(x=>!x.startsWith('-'));
    if(/^(sudo|su|doas|ssh|sftp|scp|mosh|telnet|ftp|passwd|login|top|htop|btop|less|more|most|man|vi|vim|nvim|view|nano|pico|emacs|tmux|screen|watch|fzf|tig|lazygit|k9s|mc|ranger|nnn|psql|mysql|sqlite3|redis-cli|mongosh|mongo|irb|pry|ipython|bpython|ghci|lua|R|julia|ed)$/.test(a))return true;
    // a REPL / shell / agent started bare
    if(/^(node|python|python3|ruby|bash|zsh|sh|fish|deno|bun|php|perl|claude|codex|gemini|aider)$/.test(a)&&!args.length&&!rest.some(x=>/^-(p|c|e|m|-print|-version|-help|v|h|V)$/.test(x)))return true;
    // logins that print a URL and wait for Enter, and wizards that ask questions
    if(/^(npm|pnpm|yarn)$/.test(a)&&/^(login|adduser|add-user|init|create)$/.test(args[0]||'')&&!rest.some(x=>/^(-y|--yes)$/.test(x)))return true;
    if(/^(npx|pnpx|bunx)$/.test(a)&&/^create-/.test(args[0]||''))return true;
    if(a==='gh'&&(args[0]==='auth'&&/^(login|refresh)$/.test(args[1]||'')||args[0]==='codespace'&&args[1]==='ssh'))return true;
    if(/^(gcloud|firebase|heroku|vercel|netlify|fly|flyctl|wrangler|az|docker|podman|aws)$/.test(a)&&(args.includes('login')||a==='aws'&&args[0]==='configure'))return true;
    if(/^(docker|podman|kubectl)$/.test(a)&&/^(run|exec)$/.test(args[0]||'')&&rest.some(x=>/^-\w*[it]\w*$/.test(x)&&/i/.test(x)&&/t/.test(x)||x==='--interactive'||x==='--tty'))return true;
    if(a==='git'&&(args[0]==='commit'&&!rest.some(x=>/^(-\w*m|-F|--message|--file|--no-edit|-C|--reuse-message|--fixup|--amend=?.*--no-edit)/.test(x))||args[0]==='rebase'&&rest.some(x=>x==='-i'||x==='--interactive')||/^(add|checkout|reset|restore|stash)$/.test(args[0]||'')&&rest.some(x=>x==='-p'||x==='--patch'||x==='-i'||x==='--interactive')||args[0]==='mergetool'))return true;
  }
  return false;
}
window.__kanban.shellOut=function(r){
  const p=paneOf(r.pane)||term;
  p.busy=false;p.secret=false;
  const i=paneIn(p);if(i){i.disabled=false;i.readOnly=false;i.type='text';i.placeholder='';if(p===activePane()&&!p.movedTo&&focusFree(p.el))i.focus()}
  const b=p.block;p.block=null;
  const moved=p.movedTo;p.movedTo=null;
  if(b){
    b.classList.remove('busy');const q=b.querySelector('.task');if(q)q.remove();
    if(moved){
      b.querySelector('.tout').textContent=((r.out||'').replace(/\s+$/,'')+'\n').replace(/^\n$/,'')+'(止めて、シェルで実行し直しました →)';
      termBottom(p);termSave(p);if(r.cwd){p.cwd=r.cwd;if(p===activePane())termCwdLabel()}
      return;
    }
    if(r.code)b.classList.add('bad');
    const out=(r.out||'').replace(/\s+$/,'');
    b.querySelector('.tout').textContent=out||(r.code?'(出力なし)':'(出力なし・正常終了)');
    if(r.code){const n=document.createElement('div');n.className='tnote';n.textContent='終了コード '+r.code;b.appendChild(n)}
  }
  termBottom(p);termSave(p);
  if(r.cwd){p.cwd=r.cwd;if(p===activePane())termCwdLabel()}
  load();
};
function termRun(p,cmd){
  if(typeof p==='string'){cmd=p;p=activePane()}
  const c=cmd.trim();if(!c)return;
  // exit closes the pane; in the last one there is nothing to close, so it starts clean (as `clear`)
  if(/^(exit|logout)$/.test(c)){if(panes.length>1)closePane(p);else termClear(p);return}
  p.hist.push(c);p.at=p.hist.length;
  // `clear` is handled here: run by the app it would only print escape codes
  if(/^clear$/.test(c)){termClear(p);return}
  const b=termBlock(p,c);
  if(!native){if(b){b.classList.remove('busy');b.classList.add('bad');b.querySelector('.tout').textContent='ブラウザからは実行できません。アプリのターミナルで実行してください'}return}
  if(termInteractive(c)&&termToShell(p,c,false)){
    const i=paneIn(p);if(i)i.value='';
    if(b){b.classList.remove('busy');b.querySelector('.tout').textContent='(端末が要るコマンドなので、この区画をシェルに切り替えて実行しました)'}
    termSave(p);return;
  }
  p.block=b;p.busy=true;p.cmd=c;p.lastOut='';p.started=Date.now();p.secret=false;
  const i=paneIn(p);i.readOnly=false;i.value='';termInMode(p);
  clearTimeout(p.askT);p.askT=setTimeout(()=>termAsk(p),1600);
  post({type:'shell',cmd:c,rc:termRc(),pane:p.id});
}
// always load the user's shell rc (aliases, PATH)
function termRc(){return true}
function wirePane(p){
  const i=paneIn(p);if(!i)return;
  if(!native){i.disabled=true;i.placeholder='アプリの中でだけ実行できます(ブラウザでは無効)'}
  i.addEventListener('input',()=>termLineSave(p));
  i.addEventListener('focus',()=>{setActivePane(p);if(typeof ptyOn!=='undefined'&&ptyOn!=='cmd')ptyMark('cmd')});
  // a click in the pane focuses its line, unless selecting text
  const sc=p.el.querySelector('.tscroll');if(sc)sc.addEventListener('mouseup',()=>{setActivePane(p);if(!String(window.getSelection()||'')&&!i.disabled)i.focus()});
  const x=p.el.querySelector('.tpx');if(x)x.onclick=e=>{e.stopPropagation();closePane(p)};
  i.onkeydown=e=>{
    if(e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==='l'||e.key==='L')){e.preventDefault();e.stopPropagation();const v=i.value;termClear(p);i.value=v;termLineSave(p);return}
    if(p.busy&&e.ctrlKey&&(e.key==='c'||e.key==='C')){e.preventDefault();e.stopPropagation();post({type:'shellstop',pane:p.id});const b=p.block;if(b)b.querySelector('.tout').textContent=(p.lastOut?p.lastOut.replace(/\s+$/,'')+'\n':'')+'(中断しています…)';return}
    if(p.busy&&e.ctrlKey&&(e.key==='d'||e.key==='D')){e.preventDefault();e.stopPropagation();post({type:'shellin',pane:p.id,eof:true});return}
    // while busy, Enter sends the line to stdin (not echoed after a password prompt)
    if(p.busy){
      if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();post({type:'shellin',pane:p.id,text:i.value,echo:!p.secret});i.value='';return}
      if(e.key==='ArrowUp'||e.key==='ArrowDown')e.preventDefault();
      return;
    }
    // Tab completes the word at the caret (files and folders; command names for the first word), as a shell does
    if(e.key==='Tab'&&!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.isComposing&&native){e.preventDefault();termComplete(p,i);return}
    if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();termRun(p,i.value);
      if(p.busy){try{localStorage.removeItem(logKey(p,'termline'))}catch(e2){}}else termLineSave(p);return}
    if(e.key==='ArrowUp'){if(p.at>0){p.at--;i.value=p.hist[p.at]||''}e.preventDefault();termLineSave(p)}
    if(e.key==='ArrowDown'){if(p.at<p.hist.length){p.at++;i.value=p.hist[p.at]||''}e.preventDefault();termLineSave(p)}
  };
}
// ---- Tab completion in a command pane's line (the app runs bash's compgen in the pane's folder)
let termCompSeq=0;const termCompWait=new Map();
function termComplete(p,i){
  const at=i.selectionStart==null?i.value.length:i.selectionStart,before=i.value.slice(0,at);
  const word=(/(\S*)$/.exec(before)||['',''])[1],pre=before.slice(0,before.length-word.length);
  const first=!pre.trim()||/[|;&]\s*$/.test(pre);
  const seq=++termCompSeq;termCompWait.set(seq,{p,i,at,word,value:i.value});
  post({type:'complete',pane:p.id,word,first,seq});
}
window.__kanban.completed=function(r){
  const w=termCompWait.get(r&&r.seq);if(!w)return;termCompWait.delete(r.seq);
  const {p,i,at,word,value}=w;if(i.value!==value)return;       // typed on meanwhile: stale
  let items=(r.items||[]).filter(Boolean);if(!items.length)return;
  // what is shown keeps the ~ the person typed
  const home=r.home||'';if(word.startsWith('~')&&home)items=items.map(x=>x.startsWith(home)?'~'+x.slice(home.length):x);
  let common=items[0];for(const x of items)while(!x.startsWith(common))common=common.slice(0,-1);
  const one=items.length===1,put=one?items[0]:common;
  const quote=s=>s.replace(/([ '"()&;|<>$`\\])/g,'\\$1');
  if(one||put.length>word.length){
    const text=quote(put)+(one&&!put.endsWith('/')?' ':'');
    i.value=value.slice(0,at-word.length)+text+value.slice(at);const c=at-word.length+text.length;try{i.setSelectionRange(c,c)}catch(e){}
    termLineSave(p);return}
  // several and nothing more in common: listed under the line, as a shell does
  const o=p.el.querySelector('.tlog');if(!o)return;
  const base=x=>{const t=x.endsWith('/')?x.slice(0,-1):x;return t.slice(t.lastIndexOf('/')+1)+(x.endsWith('/')?'/':'')};
  const b=document.createElement('div');b.className='tblock tcomp';const out=document.createElement('pre');out.className='tout';out.style.opacity='.7';
  out.textContent=items.slice(0,120).map(base).join('   ')+(items.length>120?'   … ('+items.length+' 件)':'');
  b.appendChild(out);for(const old of o.querySelectorAll('.tcomp'))old.remove();o.appendChild(b);termBottom(p);
};
// 分割 splits side by side in the bottom strip, stacked where the strip is a right column
// (layout in 90-late.css); the button icon follows.
const SPLIT_ICON={cols:'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.5v11" stroke="currentColor" stroke-width="1.3"/></svg>',
  rows:'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.3"/></svg>'};
// termSide (69-list.js) can throw before boardView exists at startup
function termStacked(){try{return termSide()}catch(e){return false}}
function termSplitLabel(){
  const b=$('#termsplit');if(!b)return;const rows=termStacked(),k=rows?'rows':'cols';
  if(b.dataset.dir===k)return;b.dataset.dir=k;
  b.innerHTML=SPLIT_ICON[k]+'<span>分割</span>';
  b.title=(rows?'上下に分割':'左右に分割')+' ('+kmL('split.meta')+')';b.setAttribute('aria-label',rows?'ターミナルを上下に分割':'ターミナルを左右に分割');
}
// `clear` / ⌃L: also from what a reload restores; ↑ history and a running block stay
function termClear(p){
  p=p||activePane();const o=p.el.querySelector('.tlog');if(!o)return;
  for(const b of [...o.children])if(b!==p.block)b.remove();
  const i=paneIn(p);if(i&&!p.busy)i.value='';
  termLineSave(p);termSave(p);termBottom(p);
}
/** The palette's 消去: a focused shell gets ⌃L instead */
function termClearFocused(){
  if(typeof ptyOn!=='undefined'&&ptyOn!=='cmd'&&ptys.has(ptyOn)){const s=ptys.get(ptyOn);if(!s.gone)post({type:'ptyin',id:s.id,data:'\x0c'});s.xt.focus();return}
  const p=activePane();termClear(p);const i=paneIn(p);if(i&&!i.disabled)i.focus();
}
/** A new pane after the others (to the right, or below in リスト), starting where the active one is. */
function splitPane(restoreId){
  if(panes.length>=MAX_PANES){toast(document.body,'分割は '+MAX_PANES+' 区画までです');return null}
  const from=activePane();
  const id=restoreId!=null?restoreId:++paneSeq;paneSeq=Math.max(paneSeq,id);
  const el=document.createElement('div');el.className='tpane';el.dataset.pane=id;
  el.innerHTML='<button class="tpx" title="この区画を閉じる">×</button><div class="tscroll"><div class="tlog"></div><div class="tline"><span class="ps-line tps"></span><span class="ps">❯</span><input class="tin" type="text" spellcheck="false" autocomplete="off"></div></div>';
  $('#tpanes').appendChild(el);
  const p=newPaneState(id,el);panes.push(p);
  $('#tpanes').classList.toggle('one',panes.length===1);
  try{ptyLayout()}catch(e){}   // before the shells exist at startup: nothing to share with yet
  wirePane(p);
  if(restoreId!=null)termRestore(p);
  if(native)post({type:'prompt',pane:id,cwd:restoreId!=null?'':(from&&from.cwd||'')});
  if(restoreId==null){termOpen(true);setActivePane(p);const i=paneIn(p);if(i&&!i.disabled)i.focus();termSave()}
  return p;
}
// ⌘[ / ⌘]: step through command panes, then shells, as they sit in the strip
function stripPanes(){return [...panes.filter(p=>!p.handed).map(p=>({cmd:p})),...(typeof ptys!=='undefined'?[...ptys.values()].filter(p=>!p.host):[]).map(p=>({pty:p}))]}
function paneStep(d){
  const all=stripPanes();if(!all.length)return;
  const at=ptyOn!=='cmd'?all.findIndex(x=>x.pty&&x.pty.id===ptyOn):all.findIndex(x=>x.cmd===activePane());
  const nx=all[((at<0?0:at)+d+all.length)%all.length];
  termOpen(true);
  if(nx.pty){ptyShow(nx.pty.id);return}
  ptyMark('cmd');setActivePane(nx.cmd);const i=paneIn(nx.cmd);if(i&&!i.disabled)i.focus();
}
/** ⌘W: close the pane with the keys — a shell (detaches a session's), or a command pane while there is another */
function paneCloseFocused(){
  if(ptyOn!=='cmd'&&ptys.has(ptyOn)){ptyClose(ptyOn);return true}
  if(panes.length>1){closePane(activePane());return true}
  return false;
}
function closePane(p){
  if(panes.length<=1)return;
  if(p.busy)post({type:'shellstop',pane:p.id});
  const k=panes.indexOf(p);panes.splice(k,1);p.el.remove();
  try{localStorage.removeItem(logKey(p,'termlog'));localStorage.removeItem(logKey(p,'termhist'));localStorage.removeItem(logKey(p,'termline'))}catch(e){}
  if(p===term){}
  $('#tpanes').classList.toggle('one',panes.length===1);
  try{ptyLayout()}catch(e){}
  const nx=panes[Math.min(k,panes.length-1)];setActivePane(nx);const i=paneIn(nx);if(i&&!i.disabled)i.focus();
  if(native)post({type:'shellclose',pane:p.id});
  termSave();
}
function termSetup(){
  const i=$('#termin');if(!i)return;
  // at launch, open only if it was left open with something in it
  let open=false;try{const v=localStorage.getItem('termopen'),log=localStorage.getItem('termlog')||'';open=v==='1'&&window.innerWidth>900&&!!log.replace(/[\s\[\]"]/g,'')}catch(e){}
  termOpen(open);
  wirePane(term);
  if(native)post({type:'prompt',pane:0});
  $('#termhead').onclick=e=>{if(e.target.closest('button'))return;termOpen(document.body.classList.contains('termclosed'))};
  $('#termtoggle').onclick=e=>{e.stopPropagation();termOpen(document.body.classList.contains('termclosed'))};
  $('#termsplit').onclick=e=>{e.stopPropagation();splitPane()};
  termSplitLabel();
  if(window.MutationObserver)new MutationObserver(termSplitLabel).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',termSplitLabel);
  termRestore(term);
  try{for(const id of JSON.parse(localStorage.getItem('termpanes')||'[0]'))if(+id)splitPane(+id)}catch(e){}
  setActivePane(term);
  const g=$('#termgrip');let y0=0,h0=0;
  if(g)g.onmousedown=e=>{
    // unfold first, or the folded rule wins over the new height
    if(document.body.classList.contains('termclosed'))termOpen(true);
    g.classList.add('dragging');
    // in リスト the strip is a right column: the grip drags its width
    const side=termSide();
    y0=side?e.clientX:e.clientY;h0=side?$('#term').getBoundingClientRect().width:$('#term').getBoundingClientRect().height;document.body.classList.add('resizing');
    const mv=side
      ?ev=>{const w=Math.max(280,Math.min(window.innerWidth-listWidth()-360,h0+(y0-ev.clientX)));document.documentElement.style.setProperty('--termw',w+'px');try{localStorage.setItem('termw',w)}catch(e2){}}
      :ev=>{const h=Math.max(120,Math.min(window.innerHeight*0.8,h0+(y0-ev.clientY)));document.documentElement.style.setProperty('--termh',h+'px');try{localStorage.setItem('termh',h)}catch(e2){}};
    const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);document.body.classList.remove('resizing');g.classList.remove('dragging')};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);e.preventDefault()};
  if(g)g.ondblclick=()=>{if(termSide()){document.documentElement.style.setProperty('--termw','440px');try{localStorage.setItem('termw',440)}catch(e){}return}
    document.documentElement.style.setProperty('--termh','220px');try{localStorage.setItem('termh',220)}catch(e){}};
  try{const w=+localStorage.getItem('termw');if(w>=280)document.documentElement.style.setProperty('--termw',w+'px')}catch(e){}
  try{const h=+localStorage.getItem('termh');if(h>=120)document.documentElement.style.setProperty('--termh',h+'px')}catch(e){}
}
termSetup();

