let openFor=null,openCard=null,histStick=true,openSig='',histSig='',pendingOpen=null,pendingOpenFrom=null;
// Conversations already read, so switching cards draws at once and re-reads only if the session moved.
const histCache=new Map();
// the card's lastT when a read was asked for: what that read can have seen. Stamped at the answer, the card may
// already be newer than the read (a message written in between), and the cache then claimed to be up to date
// and the last message stayed off the panel until the cache aged out.
const histAsk=new Map();
const HIST_KEEP=8;
function histPut(j){
  const k=(j&&j.agent)+':'+(j&&j.session);
  if(!j||!j.session)return;
  histCache.delete(k);
  histCache.set(k,{j,at:Date.now(),lastT:histAsk.has(k)?histAsk.get(k):openCard&&openCard.id===j.session?(openCard.lastT||0):0});
  while(histCache.size>HIST_KEEP)histCache.delete(histCache.keys().next().value);
}
/** Remove a session (lib/remove.js): registry via `claude rm`, transcript to the Trash. */
/** Same rule as the parent's count (lib/live.js subRunning). */
function kidAtWork(k){return k.subRunning!=null?!!k.subRunning:k.column==='working'}
// Which subagents nest under which card. kidAtWork decides rows, the 実行中 count and (via lib/live.js)
// the lane alike, so they never disagree. One whose parent is not on the board is not shown (39-board.js).
function kidsPlan(cards){
  const parents=new Set(cards.filter(p=>!p.subagent).map(p=>p.agent+':'+p.id));
  const kidRun=new Map(),kidDone=new Map(),nested=new Set();
  for(const k of cards){
    if(!k.subagent||!k.parentId||!parents.has(k.agent+':'+k.parentId))continue;
// a finished one is its parent's result, not a card of its own in Completed
    const m=kidAtWork(k)?kidRun:kidDone;
    if(!m.has(k.parentId))m.set(k.parentId,[]);m.get(k.parentId).push(k);nested.add(k.agent+':'+k.id);
  }
  return {kidRun,kidDone,nested,nestedKid:c=>nested.has(c.agent+':'+c.id)};
}
function cardSig(c){
  const w=c.wip||{};
// What the panel shows about a card: same signature, nothing to redraw. idleS is left out: redrawing
// for a clock drops attachment handlers, in-flight uploads and IME composition. The held prompt's id
// is in, or ⌘Y could answer a request the panel is not showing.
  return [c.column,c.reason,c.lastTool,c.title,c.icon||'',c.color,c.queued||'',c.queuedFails||0,c.queuedRetry||0,(c.permAsk||{}).id||'',(c.permAsk||{}).more||0,
    c.alive?1:0,c.aliveKind,c.aliveStatus,c.aliveName,w.status,w.at,(c.done||{}).at,(c.parked||{}).at,c.model,c.permMode||'',
    (live.cards||[]).filter(x=>x.parentId===c.id).map(x=>x.id+x.column+(x.subRunning?1:0)).join(','),
    Math.round(((c.usage||{}).ctx||0)/50000),(c.stuck||{}).key||'',c.doingLine||'',c.waitingLine||'',heldSig(c)].join('|');
}
/** An answer that drew nothing new (same turns) still says how fresh the cache is. */
function histTouch(j){
  const k=(j&&j.agent)+':'+(j&&j.session),e=histCache.get(k);
  if(e&&histAsk.has(k)){e.at=Date.now();e.lastT=histAsk.get(k)}
}
function askHistory(c){
  histAsk.set(c.agent+':'+c.id,c.lastT||0);
  const h=boardHours();
  if(native){post({type:'history',agent:c.agent,session:c.id,hours:h});return}
  fetch('api/history?agent='+encodeURIComponent(c.agent)+'&session='+encodeURIComponent(c.id)+'&hours='+h)
    .then(r=>r.json()).then(j=>window.__kanban.history(j)).catch(e=>{console.error(e);const el=$('#mhist');if(el)el.innerHTML='<div class="more">履歴を取得できません(接続を確認してください)</div>'});
}
// No role labels: yours is an indented bubble, the agent's is flush left; tool lines keep their name.
const WHO={tool:'',error:'エラー',cmdout:'結果'};
// linkified after escaping, so the text stays text
const URL_RE=/(https?:\/\/[^\s<>"'）)】]+)/g;
const PATH_RE=/(^|[\s(（「`'"：:=])(\/Users\/[^\s<>"'`）)」、。,]+\.[A-Za-z0-9]{1,8})(?=$|[\s<>"'`）)」、。,:])/g;
// the same, never across the markdown renderer's placeholders (\u0000 / \u0001)
const MD_PATH_RE=/(^|[\s(（「`'"：:=])(\/Users\/[^\s<>"'`）)」、。,\u0000\u0001]+\.[A-Za-z0-9]{1,8})(?=$|[\s<>"'`）)」、。,:\u0000\u0001])/g;
// one pass for both: a second pass put a path link inside a URL link's href
const LINK_RE=new RegExp(URL_RE.source+'|'+PATH_RE.source,'g');
// Attached files are appended as a block of paths (lib/attach.js); the thread shows them as thumbnails/chips.
const ATT_HEAD='\n\n添付ファイル(このパスを読んでください):\n';
function splitAttach(text){
  const s=String(text||''),i=s.indexOf(ATT_HEAD);if(i<0)return {text:s,files:[]};
  const files=s.slice(i+ATT_HEAD.length).split('\n').map(l=>(l.match(/^- (\/.+)$/)||[])[1]).filter(Boolean);
  return files.length?{text:s.slice(0,i),files}:{text:s,files:[]};
}
function attachThumbs(files){
  if(!files.length)return '';
  return '<div class="sentatt">'+files.map(p=>{const n=p.split('/').pop();
    const url=native?'file://'+encodeURI(p):'api/img?f='+encodeURIComponent(n);
    return /\.(png|jpe?g|gif|webp|heic)$/i.test(n)
      ?'<a class="shot" href="'+esc(url)+'" title="'+esc(p)+'"><img src="'+esc(url)+'" alt="添付" loading="lazy"></a>'
      :'<button class="mini openfile" data-p="'+esc(p)+'" title="'+esc(p)+'">📎 '+esc(n.slice(0,32))+'</button>'}).join('')+'</div>';
}
document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('.sentatt .openfile');if(!b)return;e.preventDefault();openViewer(b.dataset.p)});
function linkify(escaped){
  return String(escaped).replace(LINK_RE,(m,u,pre,p)=>u
    ?'<a class="ext" href="'+u+'" title="'+u+'">'+(u.length>72?u.slice(0,72)+'…':u)+'</a>'
    :pre+'<a class="fpath" href="#" data-p="'+p+'" title="ビューワーで開く">'+p+'</a>');
}
document.addEventListener('click',e=>{const a=e.target&&e.target.closest&&e.target.closest('a.fpath');if(!a)return;e.preventDefault();openViewer(a.dataset.p.replace(/&amp;/g,'&'))});
// Keep the newest turn on screen: scrollTop right after innerHTML runs before layout, so snap again
// across frames and keep a ResizeObserver on the pane while at the bottom.
let histObs=null;
// Scrolling up stops following at once; reaching the bottom resumes it. histWheel lets a pending
// anchor-keep (click handler below) see that a wheel moved the pane since.
let histWheel=0;
document.addEventListener('wheel',e=>{const h=$('#mhist');if(!h||!h.contains(e.target))return;histWheel++;if(e.deltaY<0)histStick=false},{capture:true,passive:true});
document.addEventListener('scroll',e=>{const h=$('#mhist');if(h&&e.target===h&&h.scrollHeight-h.clientHeight-h.scrollTop<8)histStick=true;
  const t=e.target;if(t&&t.classList&&(t.id==='mhist'||t.classList.contains('fhist')))syncLatest(t)},true);
// ↓ 最新へ: a sibling of the pane, not a child, since the pane's innerHTML is redrawn on every refresh.
function syncLatest(h){
  if(!h||!h.parentNode||!h.isConnected)return;
  let b=h.nextElementSibling;
  if(!b||!b.classList.contains('tolatest')){b=document.createElement('button');b.className='mini tolatest';b.type='button';b.textContent='↓ 最新へ';b.title='いちばん新しいところへ';b.hidden=true;
    b.onclick=e=>{e.stopPropagation();const hh=b.previousElementSibling;if(!hh)return;if(hh.id==='mhist')histStick=true;stickBottom(hh);b.hidden=true};h.after(b)}
  const away=h.clientHeight>0&&h.scrollHeight-h.clientHeight-h.scrollTop>80;
  b.hidden=!away;if(away){b.style.top=(h.offsetTop+h.clientHeight-40)+'px';b.style.left=(h.offsetLeft+h.clientWidth/2)+'px'}
}
// Opening/folding something yourself is not new content: stop following and keep what you clicked in place.
document.addEventListener('click',e=>{
  const h=$('#mhist');if(!h||!e.target||!e.target.closest||!h.contains(e.target))return;
  const anchor=e.target.closest('summary,details,.turn')||e.target;
  const top=anchor.getBoundingClientRect().top;
  histStick=false;const w0=histWheel;
  const keep=()=>{if(!document.contains(anchor)||histWheel!==w0)return;const d=anchor.getBoundingClientRect().top-top;if(d)h.scrollTop+=d};
  requestAnimationFrame(()=>{keep();requestAnimationFrame(keep)});setTimeout(keep,80);
},true);
function stickBottom(el){
  if(!el)return;
// pending snaps are dropped once you scroll up (histStick off)
  const go=()=>{if(el.id==='mhist'&&!histStick)return;el.scrollTop=el.scrollHeight};
  go();requestAnimationFrame(()=>{go();requestAnimationFrame(go)});
  setTimeout(go,60);setTimeout(go,240);
  if(typeof ResizeObserver!=='undefined'&&!histObs){
    histObs=new ResizeObserver(()=>{if(histStick){const h=$('#mhist');if(h)h.scrollTop=h.scrollHeight}});
  }
  if(histObs){try{histObs.disconnect();histObs.observe(el);for(const c of el.children)histObs.observe(c)}catch(e){}}
}
// Separate from renderHistory: a redraw (openDetail keep) restores the pane from HTML, which carries no handlers.
function railOf(host,title){
  let g=host.querySelector(':scope>.fold');
  if(!g){g=document.createElement('span');g.className='fold';host.prepend(g)}
  g.title=title;return g;
}
function wireHist(el){
  for(const d of el.querySelectorAll('details.tools')){
    const g=railOf(d,'左端のバーで閉じる');
    g.onclick=(e)=>{e.stopPropagation();e.preventDefault();d.open=!d.open};
  }
  for(const t of el.querySelectorAll('.turn.assistant')){
    t.classList.add('foldable');
    const g=railOf(t,'左端のバーで畳む');
    g.onclick=(e)=>{e.stopPropagation();t.classList.toggle('folded')};
// An open turn folds only from its rail, so clicks to read or select do not fold it; a folded one opens anywhere.
    t.onmousedown=null;
    t.onclick=()=>{if(t.classList.contains('folded'))t.classList.remove('folded')};
  }
// replies only in the detail panel (a focus panel has no box to put them in)
  if(el.id!=='mhist')return;
  wireRq(el);
  for(const b of el.querySelectorAll('.turn .rbtn'))b.onclick=e=>{e.stopPropagation();const t=b.closest('.turn');if(t&&panelKey)replyTo(panelKey,t.dataset.k,+t.dataset.t,'',t.textContent)};
  el.onmouseup=()=>setTimeout(()=>replyFloat(el),0);
  if(!el._rfl){el._rfl=1;el.addEventListener('scroll',()=>{const f=document.getElementById('rfloat');if(f)f.hidden=true},{passive:true})}
}
// Text selected inside one message offers 「↩ ここに返信」 with the selection as the quote.
function replyFloat(el){
  let f=document.getElementById('rfloat');
  if(!f){f=document.createElement('button');f.id='rfloat';f.className='rfloat';f.hidden=true;f.textContent='↩ ここに返信';
    f.onmousedown=e=>{e.preventDefault();e.stopPropagation()};document.body.appendChild(f);
    document.addEventListener('mousedown',e=>{if(e.target!==f)f.hidden=true})}
  const s=window.getSelection&&window.getSelection();const txt=s&&!s.isCollapsed?String(s).trim():'';
  const turnOf=n=>{const e=n&&(n.nodeType===1?n:n.parentElement);return e&&e.closest?e.closest('.turn[data-k]'):null};
  const a=txt?turnOf(s.anchorNode):null;
  if(!a||a!==turnOf(s.focusNode)||!el.contains(a)||!panelKey||!$('#mbody .msg textarea')){f.hidden=true;return}
  const r=s.getRangeAt(0).getBoundingClientRect();
  f.style.left=Math.max(8,Math.min(window.innerWidth-120,r.right-100))+'px';f.style.top=Math.min(window.innerHeight-36,r.bottom+6)+'px';f.hidden=false;
  f.onclick=e=>{e.stopPropagation();f.hidden=true;replyTo(panelKey,a.dataset.k,+a.dataset.t,txt.slice(0,400));try{s.removeAllRanges()}catch(x){}};
}
// Why a held message did not go, in words that say what to do; unknown CLI errors are shown shortened.
function qerrText(c){
  const e=String(c.queuedError||''),n=c.queuedFails||0;
  const head='送れませんでした('+n+'回'+(n>=5?'・これ以上は自動で送りません':'')+')';
  if(/not trusted/i.test(e))return head+': ホームフォルダで始めたセッションは、裏からは続けられません(Claude の制限)。端末で開けば届けられます';
  if(/状態を確認できず/.test(e))return head+': '+esc(e);
  return head+(e?': '+esc(e.slice(0,160)):'');
}
// Waits no hook sees: "dialog open" is a slash command's screen or a notice; "input needed" is a question
// or MCP input, answerable here only if the permission hook held it for the board.
const DIALOG_WHY={
  'dialog open':['端末でダイアログが開いたままです','スラッシュコマンドの画面(/chrome・/model・/config など)かお知らせです。フックを通らないので、ボードからは答えられません'],
  'input needed':['端末で質問が開いたままです','選択肢の質問か MCP の入力です。ボードで答えられるのは、ボードを開いている間に出た質問だけです'],
};
function dialogWhy(w){return DIALOG_WHY[w]||['端末で確認が開いたままです','「'+w+'」の確認です。ボードからは答えられません']}
// What the dialog says, read off the session's own terminal (no hook carries it): its text and numbered choices.
// The terminal is this panel's, or a look-only attach parked out of sight. A choice is its number typed there.
const dlgSeen=new Map();      // card id → {at, lines:[…], opts:[{n,label}], pty}
const dlgAsked=new Map();     // card id → when a read was last started
function dlgParse(lines){
  const opts=[];
  for(const l of lines){const m=/^\s*(?:[❯›>]\s*)?(\d{1,2})[.)]\s+(.+?)\s*$/.exec(l);if(m&&!opts.some(o=>o.n===m[1]))opts.push({n:m[1],label:m[2]})}
  return opts;
}
function dlgScreen(p){
  const b=p.xt.buffer.active,top=b.baseY||0,rows=p.xt.rows||24,out=[];
  for(let i=top;i<Math.min(b.length,top+rows);i++)out.push(b.getLine(i).translateToString(true).replace(/\s+$/,''));
  // the dialog is the screen's lower part: from the last rule or blank run up, at most 14 lines
  const keep=out.filter((l,i)=>l.trim()||(out[i-1]||'').trim());
  return keep.slice(-14).filter(l=>!/^[─━\-–—=_\s╭╮╰╯│]+$/.test(l));
}
function dlgEnsure(c){
  if(!native||!window.Terminal||!c||!c.alive)return;
  const k=c.id,t=dlgAsked.get(k)||0;if(Date.now()-t<6000)return;dlgAsked.set(k,Date.now());
  let p=panelPty(c);
  if(!p&&c.aliveKind==='background'){
    if(!ptyOpen('attach',{host:ptyParkBox(),session:(c.aliveShort||c.id).slice(0,8),full:c.id,label:ptyLabel(c),cwd:c.project||'',auto:true}))return;
    p=panelPty(c);if(p){p.parked=true;p.parkT=Date.now();ptyCacheTrim()}
  }
  if(!p)return;
  ptyWhenReady(p,q=>{const lines=dlgScreen(q);dlgSeen.set(k,{at:Date.now(),lines,opts:dlgParse(lines),pty:q.id});try{histReconcile()}catch(e){}
    try{if(typeof askPopSync==='function'&&live)askPopSync(live)}catch(e){}},500,()=>{});
}
/** A permission prompt's own choices (1. Yes / 2. Yes, and don't ask again… / 3. No…) in the board's words. */
function dlgPermLabel(l){return /^Yes$/i.test(l)?'はい':/^Yes,/i.test(l)?'はい、今後は聞かない'+((/(for|to)\s+(.+)$/i.exec(l)||[])[2]?' ('+(/(for|to)\s+(.+)$/i.exec(l)||[])[2].replace(/\s*\(.*\)\s*$/,'')+')':''):/^No\b/i.test(l)?'いいえ':l}
/** Choices read off the terminal for a permission prompt no hook held (the board was not in front when it came). */
function dlgPermOpts(c){
  if(!c||c.permAsk||!c.alive||c.agent!=='claude'||c.aliveWaitingFor!=='permission prompt')return null;
  dlgEnsure(c);const d=dlgSeen.get(c.id);
  return d&&d.opts.length?d.opts.map(o=>({n:o.n,label:dlgPermLabel(o.label),raw:o.label})):null;
}
function dlgPress(c,key){
  const d=dlgSeen.get(c.id),p=d&&ptys.get(d.pty);if(!p||p.gone){toast($('#mbody'),'ターミナルにつながっていません。「ターミナルで閉じる」から答えてください');return}
  post({type:'ptyin',id:p.id,data:key});dlgSeen.delete(c.id);dlgAsked.delete(c.id);
  toast($('#mbody'),'▶ ターミナルに送りました');
  setTimeout(()=>{try{histReconcile()}catch(e){}if(typeof load==='function')load()},1200);
}
/**
 * A held AskUserQuestion: options as buttons plus a free-text answer. A single single-select question
 * goes on pick (like Enter in the terminal); otherwise 答える sends all at once, as Claude takes them in one reply.
 */
const qPicks=new Map();       // request id → {sel:[Set of option index], other:[text]}, kept across a panel redraw
// free-text answers are drafts too ('ask:<id>'), so a reload keeps them
function qPick(a){let p=qPicks.get(a.id);if(!p){const d=draftGet('ask:'+a.id),o=(d&&d.o&&d.o.other)||[];
  p={sel:a.questions.map(()=>new Set()),other:a.questions.map((q,i)=>String(o[i]||''))};qPicks.set(a.id,p)}return p}
function qOtherSave(id,p){draftSet('ask:'+id,{t:p.other.join('\n'),o:{other:p.other}})}
function qOne(a){return a.questions.length===1&&!a.questions[0].multiSelect}
function askQHtml(a){
  const one=qOne(a);
  return '<div class="askbox held askq" data-perm="'+esc(a.id)+'"><b>質問に答えてください</b>'+(a.more?' <span class="dim">ほかに '+a.more+' 件</span>':'')
    +a.questions.map((q,i)=>'<div class="aq" data-q="'+i+'">'
      +'<div class="aqh">'+(q.header?'<span class="atool">'+esc(q.header)+'</span> ':'')+'<span class="aqt">'+esc(q.question)+'</span>'+(q.multiSelect?' <span class="dim">いくつでも選べます</span>':'')+'</div>'
      +((q.options||[]).some(o=>o.description)
        ?'<div class="aopts rows">'+(q.options||[]).map((o,j)=>'<div class="aorow"><button class="mini aopt" data-q="'+i+'" data-o="'+j+'">'+esc(o.label)+'</button>'
          +(o.description?'<span class="dim adesc">'+esc(o.description)+'</span>':'')+'</div>').join('')+'</div>'
        :'<div class="aopts">'+(q.options||[]).map((o,j)=>'<button class="mini aopt" data-q="'+i+'" data-o="'+j+'">'+esc(o.label)+'</button>').join('')+'</div>')
      +'<input class="aother" data-q="'+i+'" placeholder="ほかの答えを書く'+(one?'(Enter で答える)':'')+'" autocomplete="off">'
      +'</div>').join('')
    +(one?'':'<button class="mini askq-send" disabled>答える</button>')
    +'<button class="mini askpass" title="このボードでは答えず、端末の質問で答えます">端末で答える</button>'
    +'<span class="dim">端末にも同じ質問が出ています。どちらで答えてもかまいません</span></div>';
}
/** Question text → chosen label(s) joined by ", ", or your own words. */
function qAnswers(a){
  const p=qPick(a),out={};
  for(const [i,q] of a.questions.entries()){
    const own=(p.other[i]||'').trim();
    const v=own||[...p.sel[i]].sort((x,y)=>x-y).map(j=>(q.options[j]||{}).label).filter(Boolean).join(', ');
    if(!v)return null;
    out[q.question]=v;
  }
  return out;
}
function wireAskQ(c,root){
  const box=root.querySelector('.askbox.askq');const a=c.permAsk;
  if(!box||!a||!a.questions||box.dataset.perm!==a.id)return;
  const p=qPick(a),one=qOne(a),send=box.querySelector('.askq-send');
  const paint=()=>{
    for(const b of box.querySelectorAll('.aopt'))b.classList.toggle('on',p.sel[+b.dataset.q].has(+b.dataset.o)&&!(p.other[+b.dataset.q]||'').trim());
    if(send)send.disabled=!qAnswers(a)||box.classList.contains('sent');
  };
  const go=()=>{const ans=qAnswers(a);if(!ans)return;box.classList.add('sent');permAnswer(c,'answer',ans)};
  for(const b of box.querySelectorAll('.aopt'))b.onclick=()=>{
    if(b.disabled)return;
    const i=+b.dataset.q,j=+b.dataset.o,q=a.questions[i];
    if(q.multiSelect){p.sel[i].has(j)?p.sel[i].delete(j):p.sel[i].add(j)}else{p.sel[i]=new Set([j])}
    if(p.other[i]){p.other[i]='';qOtherSave(a.id,p)}const inp=box.querySelector('.aother[data-q="'+i+'"]');if(inp)inp.value='';
    paint();if(one)go();
  };
  for(const inp of box.querySelectorAll('.aother')){
    const i=+inp.dataset.q;inp.value=p.other[i]||'';
    inp.oninput=()=>{p.other[i]=inp.value;qOtherSave(a.id,p);paint()};
    inp.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();if(qAnswers(a))go()}};
  }
  if(send)send.onclick=go;
  paint();
}
// A held prompt's choices, numbered as the terminal numbers them (lib/perm.js choicesOf). An older hook
// sends no list: its offered rules stand in. auto モード is not offered to a session already in it.
function permChoices(c){
  const a=c.permAsk;
  const ch=Array.isArray(a.choices)&&a.choices.length?a.choices
    :[{d:'allow'},...(a.always||[]).map((r,i)=>({d:'always:'+i,rules:r.rules,where:r.where})),{d:'deny'}];
  return ch.filter(x=>!(x.d==='automode'&&c.permMode==='auto'));
}
function permChoiceHtml(x,n){
  const k='<kbd>'+n+'</kbd> ';
  if(x.d==='allow')return '<div class="achoice"><button class="mini askch askyes" data-d="allow" title="許可 ('+n+' / ⌘Y)">'+k+'はい</button></div>';
  if(x.d==='deny')return '<div class="achoice"><button class="mini askch askno" data-d="deny" title="拒否 ('+n+' / ⌘⇧Y)">'+k+'いいえ</button></div>';
  if(x.d==='rule')return '<div class="achoice"><button class="mini askch askrule-go" data-d="rule" title="許可して、'+esc(x.where)+'ではこの形のコマンドを今後聞かないルールを保存します(端末の「Yes, and don\'t ask again for:」と同じ。欄は書き換えられます)">'+k+'はい、今後は聞かない:</button>'
    +'<input class="askrule" type="text" maxlength="1000" value="'+esc(x.rule)+'" title="保存するルール(Bash)。* は任意の続き"><span class="dim">'+esc(x.where)+'</span></div>';
  if(x.d==='automode')return '<div class="achoice"><button class="mini askch askauto" data-d="automode" title="許可して、このセッションを auto モードにします(端末の「Yes, and switch to auto mode」と同じ)">'+k+'はい、auto モードに切り替える</button><span class="dim">以後の許可確認は auto モードが判断します</span></div>';
// Claude Code's own second row (e.g. accept-edits for a file tool)
  const what=x.mode==='acceptEdits'?'はい、このセッション中は編集を自動で許可する'+(x.dirs?'(と '+x.dirs+' へのアクセス)':'')+(x.rules?'(と '+x.rules+')':'')
    :x.rules?'はい、今後は聞かない: '+x.rules+(x.dirs?'(と '+x.dirs+' へのアクセス)':'')
    :x.dirs?'はい、このセッション中は '+x.dirs+' へのアクセスを許可する':'はい、今後は聞かない';
  return '<div class="achoice"><button class="mini askch askalways" data-d="'+esc(x.d)+'" title="許可して、Claude Code が示したルールを保存します(端末の 2 番目の選択肢と同じ)">'+k+esc(what)+'</button>'+(x.where?'<span class="dim">'+esc(x.where)+'</span>':'')+'</div>';
}
function permPick(c,b){
  const d=b.dataset.d,row=b.closest('.achoice');
  if(d==='rule'){const i=row&&row.querySelector('.askrule'),t=i&&i.value.trim();if(!t){if(i)i.focus();return}permAnswer(c,'rule',t);return}
  if(d==='deny'){const i=row&&row.querySelector('.askfb');permAnswer(c,'deny',i&&i.value.trim()||undefined);return}
  permAnswer(c,d);
}
// A pending permission prompt at the foot of the conversation, answered here if the hook (lib/perm.js) held it.
function askHtml(c){
  if(!c)return '';
  let html='';
// only when Claude itself reports a permission prompt, not a lane guessed from the transcript
  const blocked=!!c.alive&&c.aliveWaitingFor==='permission prompt';
  if(c.permAsk&&c.permAsk.questions&&c.permAsk.questions.length)return askQHtml(c.permAsk);
// something open in its terminal that no hook sees: it takes no message until closed there
  if(!c.permAsk&&c.alive&&c.agent==='claude'&&c.aliveStatus==='waiting'&&c.aliveWaitingFor&&c.aliveWaitingFor!=='permission prompt'){
    const [what,why]=dialogWhy(c.aliveWaitingFor);
    dlgEnsure(c);
    const d=dlgSeen.get(c.id);
    if(d&&d.lines.some(l=>l.trim())){
      // read off its terminal: what it says, and its choices as buttons (each is its number typed there)
      return '<div class="askbox dlg"><b>'+esc(what)+'</b> <span class="dim">端末の画面から読み取りました</span>'
        +'<pre class="awhat">'+esc(d.lines.join('\n'))+'</pre>'
        +(d.opts.length?'<div class="aopts">'+d.opts.map(o=>'<button class="mini dlgk" data-key="'+esc(o.n)+'" title="端末で '+esc(o.n)+' を押します">'+esc(o.n+'. '+o.label)+'</button>').join('')+'</div>'
          :'<div class="aopts"><button class="mini dlgk" data-key="\r" title="端末で Enter を押します">Enter</button></div>')
        +'<div class="aopts"><button class="mini dlgk" data-key="\x1b" title="端末で Esc を押します(閉じる)">Esc で閉じる</button>'
        +(native&&(panelTermOK(c)||c.aliveKind==='interactive')?'<button class="mini askgo" data-how="'+(c.aliveKind==='interactive'?'term':'attach')+'">ターミナルで見る ↗</button>':'')+'</div></div>';
    }
    return '<div class="askbox"><b>'+esc(what)+'</b><span class="dim">'+esc(why)+'。閉じるまで、送った指示は届け待ちのまま止まります</span>'
      +(native?(panelTermOK(c)||c.aliveKind==='interactive'?'<button class="mini askgo" data-how="'+(c.aliveKind==='interactive'?'term':'attach')+'">ターミナルで閉じる ↗</button>':''):'')+'</div>';
  }
  if(c.permAsk){
    const a=c.permAsk;
    html='<div class="askbox held" data-perm="'+esc(a.id)+'"><b>許可を待っています</b> <span class="atool">'+esc(a.tool)+'</span>'+(a.agentType?' <span class="dim">サブエージェント('+esc(a.agentType)+')</span>':'')+(a.more?' <span class="dim">ほかに '+a.more+' 件</span>':'')
      +(a.what?'<pre class="awhat">'+esc(a.what)+'</pre>':'')
      +'<div class="achoices">'+permChoices(c).map((x,i)=>permChoiceHtml(x,i+1)).join('')+'</div>'
      +'<span class="dim">'+(a.bg?'バックグラウンドのセッションは、ここでの答えを待っています(開くと「running hooks…」と出ています)':'端末には「running hooks…」と出て、ここでの答えを待っています')
      +' · <button class="linkish askpass" title="このボードでは答えず、端末の許可確認に戻します">端末で答える</button></span></div>';
  }else if(blocked&&c.agent==='claude'&&!c.subagent&&dlgPermOpts(c)){
    // not held by the hook (the board was behind when it came): its choices read off the terminal, each typed there as its number
    const a=c.asking||{},o=dlgPermOpts(c);
    html='<div class="askbox dlg"><b>許可を待っています</b>'+(a.tool?' <span class="atool">'+esc(a.tool)+'</span>':'')
      +(a.what?'<pre class="awhat">'+esc(a.what)+'</pre>':'')
      +'<div class="aopts">'+o.map(x=>'<button class="mini dlgk'+(x.label==='はい'?' primary':'')+'" data-key="'+esc(x.n)+'" title="端末で '+esc(x.n)+' を押します: '+esc(x.raw)+'">'+esc(x.label)+'</button>').join('')+'</div>'
      +'<span class="dim">端末の画面から読み取った選択肢です。押すとその番号を端末に打ちます</span></div>';
  }else if(blocked&&c.agent==='claude'&&!c.subagent){
    const a=c.asking||{};
    html='<div class="askbox"><b>許可を待っています</b>'+(a.tool?' <span class="atool">'+esc(a.tool)+'</span>':'')
      +(a.what?'<pre class="awhat">'+esc(a.what)+'</pre>':'')
      +(native?(c.aliveKind==='interactive'?'<button class="mini askgo" data-how="term">端末で答える ↗</button>'
        :c.alive&&c.aliveKind==='background'?'<button class="mini askgo" data-how="attach">開いて答える ↗</button>':''):'')
      +'<span class="dim">'+(c.aliveKind==='background'?'バックグラウンドの許可確認は、開いたときにだけ表示されます':'この許可確認はそのセッションの端末に出ていて、ここからは答えられません'+(native&&canGoTerm(c)?'':'。端末で答えてください'))+'</span></div>';
  }
  return html;
}
function wireAsk(c,root){
  root=root||$('#mhist');if(!root)return;
  wireAskQ(c,root);
  for(const b of root.querySelectorAll('.askbox.dlg .dlgk'))b.onclick=()=>dlgPress(c,b.dataset.key);
  for(const b of root.querySelectorAll('.askbox.held .askch'))b.onclick=()=>permPick(c,b);
  for(const i of root.querySelectorAll('.askbox.held .askrule, .askbox.held .askfb'))i.onkeydown=e=>{
    if(e.key!=='Enter'||e.isComposing||e.keyCode===229)return;e.preventDefault();const b=i.closest('.achoice').querySelector('.askch');if(b&&!b.disabled)permPick(c,b)};
  const pb=root.querySelector('.askbox.held .askpass');if(pb)pb.onclick=()=>permAnswer(c,'pass');
  const agb=root.querySelector('.askgo');if(agb)agb.onclick=()=>{
// its terminal is ours (this panel, or a ＋シェル pane moved in): show it here
    const own=panelPty(c);
    if(own&&!own.gone&&$('#mbody .mviews')){panelSwitch('term');requestAnimationFrame(()=>own.xt.focus());return}
    if(agb.dataset.how==='attach'&&$('#mbody .mviews')&&panelTermOK(c)){panelSwitch('term');return}
    if(agb.dataset.how==='term')goTerm(c);
    else openSession((c.aliveShort||c.id).slice(0,8),c);
    agb.textContent='開きました';agb.disabled=true};
}
