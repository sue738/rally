// ---- real terminals in the strip ------------------------------------------
// xterm.js tabs on ptys run by the app's pty host (Pty.swift, rally-ptyd): a shell or a Claude
// session (attached; closing only detaches). The app decides what runs from the kind and a
// checked id, never from page text. The host outlives the app (ptyRestore). App only: no shell over the LAN.
const ptys=new Map();let ptyOn='cmd',ptyN=0;
// load the CJK face before any terminal draws
const ptyCjk=document.fonts?document.fonts.load('13px "AK Terminal CJK"','日本').then(f=>f.length>0,()=>false):Promise.resolve(false);
function inPty(){const a=document.activeElement;return !!(a&&a.closest&&a.closest('#ptys, #mterm'))}
function ptyLabel(c){return (c&&(c.title||short(c.project||'')))||'claude'}
function ptyColors(){const cs=getComputedStyle($('#tbody')||document.body),v=k=>cs.getPropertyValue(k).trim();
  // Tokyo Night's 16 colours (xterm's defaults are raw VGA); a faint scrollbar
  return {background:v('--term-bg'),foreground:v('--fg'),cursor:v('--ok'),cursorAccent:v('--term-bg'),selectionBackground:'rgba(122,162,247,.35)',
    black:'#414868',red:'#f7768e',green:'#9ece6a',yellow:'#e0af68',blue:'#7aa2f7',magenta:'#bb9af7',cyan:'#7dcfff',white:'#a9b1d6',
    brightBlack:'#565f89',brightRed:'#ff899d',brightGreen:'#9fe044',brightYellow:'#faba4a',brightBlue:'#8db0ff',brightMagenta:'#c7a9ff',brightCyan:'#a4daff',brightWhite:'#c0caf5',
    scrollbarSliderBackground:'color-mix(in srgb, '+v('--dim')+' 22%, transparent)',scrollbarSliderHoverBackground:'color-mix(in srgb, '+v('--dim')+' 40%, transparent)',scrollbarSliderActiveBackground:'color-mix(in srgb, '+v('--dim')+' 55%, transparent)'}}
/** Give one pane the keys (a shell's id, or 'cmd' for the command panes). Every pane stays in view. */
function ptyMark(id){
  if(id!=='cmd'&&!ptys.has(id))id='cmd';
  ptyOn=id;
  document.body.classList.toggle('onpty',id!=='cmd');
  for(const [k,p] of ptys)p.el.classList.toggle('act',k===id);
  $('#tpanes').classList.toggle('dimact',id!=='cmd');
}
function ptyShow(id){
  ptyMark(id);
  const p=ptys.get(ptyOn);
  // focus now, and again after layout (a frame can be slow in a hidden window)
  if(p){termOpen(true);ptyRoom();p.xt.focus();requestAnimationFrame(()=>{ptyFitAll();p.xt.focus()})}
  else{const i=paneIn(activePane())||$('#termin');if(i&&!i.disabled)i.focus()}
}
function ptyLayout(){
  const tp=$('#tpanes'),py=$('#ptys');if(!tp||!py)return;
  const shown=panes.filter(p=>!p.handed).length;tp.hidden=!shown;
  tp.style.flexGrow=String(shown);py.style.flexGrow=String([...ptys.values()].filter(p=>!p.host).length);
  requestAnimationFrame(ptyFitAll);
}
function ptyFitAll(){for(const p of ptys.values())ptyFit(p)}
// After a resize, a move in the page, unhiding or a DPR change the WebGL glyph atlas goes stale
// (garbled glyphs). The atlas is shared by every terminal with the same font and colours, so all
// of them — ended and hidden ones included — must clear and redraw in the same task.
function ptyRepaintNow(){for(const p of ptys.values()){if(!p.gl)continue;try{p.xt.clearTextureAtlas();p.xt.refresh(0,p.xt.rows-1)}catch(e){}}}
// WebGL: box drawing fills its cell (the DOM renderer breaks it). WebKit caps live contexts
// (the oldest is lost), so a hidden terminal gives its context back (ptyGlOff).
function ptyGlOn(p){
  if(p.gl||p.xtGone||!window.WebglAddon)return;
  try{const gl=new WebglAddon.WebglAddon();gl.onContextLoss(()=>{if(p.gl===gl)p.gl=null;ptyGlDrop(gl)});p.xt.loadAddon(gl);p.gl=gl}catch(e){p.gl=null}
}
function ptyGlOff(p){const gl=p.gl;if(!gl)return;p.gl=null;ptyGlDrop(gl)}
// addon-webgl's dispose leaks its cursor blink timer (_cursorBlinkStateManager), which keeps the
// renderer and its context alive; past WebKit's context cap visible terminals lose theirs.
// Stop the timer and release the context now.
function ptyGlDrop(gl){
  const r=gl&&gl._renderer,ctx=r&&r._gl;
  try{if(r&&r._cursorBlinkStateManager)r._cursorBlinkStateManager.dispose()}catch(e){}
  try{gl.dispose()}catch(e){}
  try{const x=ctx&&!ctx.isContextLost()&&ctx.getExtension('WEBGL_lose_context');if(x)x.loseContext()}catch(e){}
}
let repaintT=0;
function ptyRepaintAll(){clearTimeout(repaintT);repaintT=setTimeout(ptyRepaintNow,120)}
(function watchDpr(){if(typeof window.matchMedia!=='function')return;const mq=window.matchMedia('(resolution: '+(window.devicePixelRatio||1)+'dppx)');
  const on=()=>{ptyRepaintAll();watchDpr()};if(mq.addEventListener)mq.addEventListener('change',on,{once:true})})();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ptyRepaintAll()});
window.addEventListener('focus',ptyRepaintAll);
// a TUI needs rows: grow a short strip
function ptyRoom(){const t=$('#term');if(!t)return;if(t.getBoundingClientRect().height<320){const n=Math.round(Math.min(window.innerHeight*0.6,380));document.documentElement.style.setProperty('--termh',n+'px')}}
function ptyFit(p){
  if(!p||!p.el.offsetParent)return;
  try{p.fit.fit()}catch(e){}
  // keep the panel terminal's height for 会話 view too: a resize makes the CLI redraw everything
  {const mb=$('#mbody');if(mb&&mb.classList.contains('pterm')&&p.el.parentNode&&p.el.parentNode.id==='mterm'){const h=p.el.parentNode.clientHeight;if(h>100)document.documentElement.style.setProperty('--mtermh',h+'px')}}
  if(!p.gone&&(p.xt.cols!==p.cols||p.xt.rows!==p.rows)){p.cols=p.xt.cols;p.rows=p.xt.rows;if(p.started)post({type:'ptysize',id:p.id,cols:p.cols,rows:p.rows})}
  // new size or place: rebuild the atlas (ptyRepaintNow)
  const at=p.el.getBoundingClientRect(),sig=Math.round(at.width)+'x'+Math.round(at.height)+'@'+(p.el.parentNode&&p.el.parentNode.id||'');
  if(sig!==p.paintSig){p.paintSig=sig;ptyRepaintAll()}
}
function ptyOpen(kind,opts){
  opts=opts||{};
  if(!native||!window.Terminal||!window.FitAddon)return false;
  // one tab per session: reuse the open one (a parked one comes into the strip)
  if(opts.session&&!opts.host&&!opts.restore)for(const p of ptys.values())if(!p.gone&&(p.session===opts.session||p.uuid===opts.session||(p.session.length>=8&&opts.session.startsWith(p.session)))){if(p.parked)ptyToStrip(p);ptyShow(p.id);return true}
  // restore: one the pty host kept running across a relaunch
  const id=opts.restore?opts.id:'p'+(++ptyN)+'x'+Date.now().toString(36);
  // opts.host: the detail panel's terminal, not a strip pane
  const el=document.createElement('div');el.className='pty'+(opts.host?' ppty':'');(opts.host||$('#ptys')).appendChild(el);
  const mono=getComputedStyle(document.body).getPropertyValue('--mono').trim();
  // CJK face first: it covers only CJK ranges; after the mono font it is never reached,
  // since SF Mono's own CJK fallback wins (and is too narrow for two cells).
  const fam='"AK Terminal CJK",'+(mono||'Menlo, monospace');
  const xt=new Terminal({...(opts.cols>0&&opts.rows>0?{cols:opts.cols,rows:opts.rows}:{}),fontFamily:fam,fontSize:12,lineHeight:1.2,cursorBlink:true,scrollback:5000,theme:ptyColors(),macOptionIsMeta:true,
    // xterm's default link handler opens a confirm dialog that blocks the page
    linkHandler:{activate:(e,u)=>{if(!/^https?:\/\//i.test(u))return;if(native)post({type:'openurl',url:u});else window.open(u,'_blank','noopener')}}});
  const fit=new FitAddon.FitAddon();xt.loadAddon(fit);
  // uuid: the session asked for (session becomes the short id once attached);
  // bg: started just for this terminal, so a look-only one is stopped again when closed
  const p={id,kind,session:opts.session||'',uuid:opts.uuid||(kind==='resume'?opts.session||'':''),full:opts.full||'',host:!!opts.host,fromStrip:opts.fromStrip!=null?!!opts.fromStrip:!opts.host,label:opts.label||kind,cwd:opts.cwd||'',el,xt,fit,cols:0,rows:0,gone:false,started:false,auto:!!opts.auto,bg:!!opts.bg,replaying:!!opts.restore};
  ptys.set(id,p);
  el.innerHTML='<div class="plabel"><span class="tl"></span><button class="tx">×</button></div><div class="pbody"></div>';
  el.querySelector('.tl').textContent=p.label;el.title=opts.title||p.label;
  el.querySelector('.tx').title=kind==='attach'?t('閉じる(セッションは動き続けます)'):t('閉じる');
  el.querySelector('.tx').onclick=e=>{e.stopPropagation();if(p.bg&&p.auto&&p.kind==='attach')ptyBgStop(p);ptyClose(id)};
  el.addEventListener('mousedown',()=>{if(ptyOn!==id)ptyMark(id)});
  // ⌘ keys stay the app's; ⌘C with a selection copies. Everything else is the program's.
  // An IME key (keyCode 229, e.g. the Japanese IME's 英字 mode) gets its text after the key
  // (WebKit insertTextAsync), and xterm's 0 ms read can miss it and drop the letter. So that
  // text is sent from its input event and the textarea restored so xterm sends nothing twice.
  let composing=false;p.imePend=0;p.imeBase='';
  xt.attachCustomKeyEventHandler(ev=>{
    // Shift+Enter: a newline in Claude's prompt (sent as ESC CR). Matched by code too: under
    // an IME it arrives as keyCode 229, not always named "Enter".
    const enter=ev.key==='Enter'||ev.code==='Enter'||ev.code==='NumpadEnter'||ev.keyCode===13;
    // WebKit delivers the IME's commit Enter after compositionend, as 229, possibly with Shift
    // still held (？ !): within 250 ms it is the IME's, not a Shift+Enter.
    const imeEnter=ev.keyCode===229&&Date.now()-(p.compEndAt||0)<250;
    if(enter&&ev.shiftKey&&!composing&&!ev.isComposing&&imeEnter)return false;
    if(enter&&ev.shiftKey&&!composing&&!ev.isComposing){
      if(ev.type==='keydown'){if(!p.gone)post({type:'ptyin',id,data:'\x1b\r'});p.swallowNL=Date.now();p.imePend=0}
      return false}
    if(ev.type==='keydown'){
      // a non-IME key ends any composition (as xterm's helper does), in case compositionend never came
      if(composing&&!ev.isComposing&&![229,20,16,17,18].includes(ev.keyCode))composing=false;
      if(ev.keyCode===229&&!composing&&!ev.isComposing){if(!p.imePend)p.imeBase=xt.textarea?xt.textarea.value:'';p.imePend++}
      else if(ev.keyCode!==229)p.imePend=0}
    if(ev.type!=='keydown')return true;
    if(ev.metaKey){if((ev.key==='c'||ev.key==='C')&&xt.hasSelection())post({type:'copy',text:xt.getSelection()});return false}
    return true});
  // terminal replies (focus, cursor position, device attributes) are marked as not typed
  xt.onData(d=>{if(!p.gone)post({type:'ptyin',id,data:d,reply:/^\x1b\[(?:I|O|[?>]?[\d;]*[cRn])$/.test(d)||undefined})});
  // XTVERSION (CSI > q): xterm.js does not answer it; Claude Code uses it to enable smooth
  // wheel scrolling for xterm.js hosts.
  xt.parser.registerCsiHandler({prefix:'>',final:'q'},params=>{if((params[0]|0)!==0)return false;if(!p.gone)post({type:'ptyin',id,data:'\x1bP>|xterm.js(6.0.0)\x1b\\',reply:true});return true});
  xt.open(el.querySelector('.pbody'));
  xt.textarea&&xt.textarea.addEventListener('focus',()=>{if(ptyOn!==id)ptyMark(id)});
  if(xt.textarea){const ta=xt.textarea;
    // keys held, and the last keypress (xterm sends the character on it)
    p.kdown=new Set();
    ta.addEventListener('keydown',e=>{p.kdown.add(e.code||e.keyCode)},true);
    ta.addEventListener('keyup',e=>{p.kdown.delete(e.code||e.keyCode)},true);
    ta.addEventListener('blur',()=>p.kdown.clear());
    ta.addEventListener('keypress',()=>{p.kpAt=Date.now()},true);
    ta.addEventListener('compositionstart',()=>{composing=true;p.imePend=0});
    ta.addEventListener('compositionend',()=>{composing=false;p.compEndAt=Date.now()});
    // Moving a pane in the DOM mid-composition drops it without compositionend (WebKit), and xterm
    // then swallows every later IME letter. On focus, end any such composition (cancelled).
    ta.addEventListener('focus',()=>{if(!composing)return;composing=false;p.imePend=0;ta.value='';
      ta.dispatchEvent(new CompositionEvent('compositionend',{data:''}))});
    // capture, on the pane: before xterm's own input handler
    el.addEventListener('input',e=>{
      if(e.target===ta&&p.swallowNL&&Date.now()-p.swallowNL<400&&(/^insert(LineBreak|Paragraph)$/.test(e.inputType||'')||/^[\r\n]+$/.test(e.data||''))){e.stopPropagation();ta.value='';p.swallowNL=0;return}
      // Text arriving before its keydown while a key is held (some input sources): xterm would drop it.
      // No recent keypress means xterm does not have it, so send it here.
      if(e.target===ta&&!composing&&!e.isComposing&&e.inputType==='insertText'&&e.data&&!p.imePend&&p.kdown&&p.kdown.size&&Date.now()-(p.kpAt||0)>150){
        e.stopPropagation();ta.value='';if(p.gone)return;
        post({type:'ptyin',id,data:e.data});
        const b=xt.buffer.active;if(b.ydisp!==b.ybase)xt.scrollToBottom();return}
      if(e.target!==ta||!p.imePend||composing||e.isComposing||e.inputType!=='insertText'||!e.data)return;
      p.imePend--;e.stopPropagation();
      ta.value=p.imeBase;
      if(p.gone)return;
      post({type:'ptyin',id,data:e.data});
      const b=xt.buffer.active;if(b.ydisp!==b.ybase)xt.scrollToBottom()},true)}
  // WebGL unless it opens out of sight (a parked one restored)
  if(!opts.host||opts.host.id!=='ppark')ptyGlOn(p);
  // glyphs drawn before the CJK face loaded stay at the fallback's size; clearing the atlas is
  // not enough, re-setting the family makes xterm re-measure
  ptyCjk.then(ok=>{if(!ok||p.gone)return;p.cjk=true;const f=xt.options.fontFamily;try{xt.options.fontFamily=f+',serif';xt.options.fontFamily=f;ptyRepaintNow();ptyFit(p)}catch(e){}});
  if(p.host){try{fit.fit()}catch(e){}if(opts.focus)xt.focus()}
  else if(opts.restore)ptyLayout();
  else{ptyLayout();ptyShow(id)}
  try{fit.fit()}catch(e){}
  p.cols=xt.cols;p.rows=xt.rows;p.started=true;p.openedAt=Date.now();
  // replay at its size (a parked one keeps the host's size until shown)
  if(opts.restore){p.metaSig=ptyMetaOf(p);post({type:'ptyreplay',id,cols:p.el.offsetParent?p.cols:0,rows:p.el.offsetParent?p.rows:0});return true}
  p.metaSig=ptyMetaOf(p);
  // keepMode: the session's own permission mode for a background start (lib/bgopen.js)
  const kc=kind==='resume'&&!opts.keepMode&&typeof live!=='undefined'&&(live.cards||[]).find(x=>x.agent==='claude'&&x.id===opts.session);
  post({type:'ptyopen',id,kind,session:p.session,cwd:opts.cwd||'',mode:opts.mode||'',keepMode:opts.keepMode||(kc&&kc.permMode)||'',direct:!!opts.direct,meta:p.metaSig,cols:p.cols||80,rows:p.rows||24});
  return true;
}
// what the pty host keeps with a tab for the next launch
function ptyMetaOf(p){return JSON.stringify({kind:p.kind,session:p.session,uuid:p.uuid||'',full:p.full||'',label:p.label,title:p.el.title||'',cwd:p.cwd||'',place:p.host?'parked':'strip',auto:!!p.auto,bg:!!p.bg,fromStrip:!!p.fromStrip})}
function ptyMetaSync(p){if(!p||p.gone||!p.started)return;const m=ptyMetaOf(p);if(m===p.metaSig)return;p.metaSig=m;post({type:'ptymeta',id:p.id,meta:m})}
if(native)setInterval(()=>{for(const p of ptys.values())ptyMetaSync(p)},3000);
// stop a background session started only to be looked at (the app checks it is idle)
function ptyBgStop(p){const s=p.uuid||p.full;if(p.bg&&/^[0-9a-f]{8}-/.test(s||'')){p.bg=false;post({type:'bgstop',session:s})}}
