// Parked: a card's terminal kept running out of sight while another card is shown.
// host stays set, so code counting strip panes skips it.
function ptyParkBox(){let b=$('#ppark');if(!b){b=document.createElement('div');b.id='ppark';b.hidden=true;document.body.appendChild(b)}return b}
// Look-only: opened for a look and never typed into, or attached to a background session.
// Cached so coming back is instant (a fresh attach shows black until it draws).
function ptyLook(p){return !!p.auto||(p.kind==='attach'&&!p.bg)}
function ptyParked(){return [...ptys.values()].filter(p=>p.parked&&!p.gone&&!ptyLook(p))}
const PTY_CACHE=4;
function ptyCacheTrim(){const c=[...ptys.values()].filter(p=>p.parked&&ptyLook(p)&&!p.gone&&!p.closing).sort((a,b)=>b.parkT-a.parkT);
  for(const p of c.slice(PTY_CACHE)){if(p.kind==='attach')ptyBgStop(p);ptyClose(p.id)}}
function ptyPark(p){p.parked=true;p.host=true;p.el.classList.remove('act');ptyParkBox().appendChild(p.el);ptyGlOff(p);if(ptyOn===p.id)ptyMark('cmd');ptyMetaSync(p)}
function ptyToStrip(p,quiet){p.parked=false;p.host=false;p.fromStrip=true;p.el.classList.remove('ppty');$('#ptys').appendChild(p.el);ptyGlOn(p);ptyLayout();if(!quiet)termOpen(true);requestAnimationFrame(()=>ptyFit(p));ptyMetaSync(p)}
// back into its card's panel (the strip if the card is not on the board)
function ptyUnpark(p){
  const c=(live.cards||[]).find(x=>x.id===p.full);   // any agent's: a codex one went to the strip
  if(!c){ptyToStrip(p);ptyShow(p.id);return}
  const k=c.agent+':'+c.id,el=cardEls().find(e=>e.dataset.agent+':'+e.dataset.id===k);if(el)selectEl(el);
  panelView='term';openDetail(c,false,{focus:true,view:'term'});
}
// What the CLI kept "until the session next starts" is delivered by starting it;
// `claude attach` works only for a running background session.
function openToDeliver(c,short){
  // its panel is open: use the panel's terminal
  if(c&&openCard&&openCard.id===c.id&&$('#mterm')&&panelTermOK(c)&&panelPtyReady(c,false,p=>{p.auto=false},'送信待ち')){const p=panelPty(c);if(p)p.auto=false;return}
  if(c&&c.alive){openSession(short,c);return}
  if(c&&ptyOpen('resume',{session:c.id,label:ptyLabel(c),cwd:c.project||''}))return;
  openSession(short,c);
}
function openSession(short,c){
  if(ptyOpen('attach',{session:short,label:ptyLabel(c),cwd:(c&&c.project)||''}))return;
  post({type:'attachterm',session:short});
}
// the pane a live interactive session runs in (main.swift walks its parents)
window.__kanban.ptyOwner=function(session,id){
  const p=id&&ptys.get(id);if(!p||p.gone||!openCard||openCard.id!==session)return;
  p.full=session;mountPanelTerm(openCard,false);
};
window.__kanban.ptyData=function(id,b64,replay){
  const p=ptys.get(id);if(!p)return;
  // after a relaunch, live data before the replay is already in the replay
  if(p.replaying&&!replay)return;
  if(replay){if(!p.replaying)return;p.replaying=false}
  const s=atob(b64),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);
  p.xt.write(u);
};
// How the app ran a resume (lib/bgopen.js): attached to a background session, or resumed
// directly (Claude will not background one begun in home or an untrusted folder).
window.__kanban.ptyKind=function(id,kind,short,how){
  const p=ptys.get(id);if(!p||p.gone)return;
  if(kind==='attach'){p.kind='attach';p.session=short;p.bg=how==='started';const x=p.el.querySelector('.tx');if(x)x.title='閉じる(セッションは動き続けます)'}
  else p.direct=how||'direct';
  ptyMetaSync(p);
};
// After a relaunch or reload: terminals the pty host still runs come back, a card's parked until
// its card opens, each replayed from what it printed.
window.__kanban.ptyRestore=function(tabs){
  let n=0;
  for(const t of tabs||[]){
    if(!t||!t.id||ptys.has(t.id))continue;
    let m={};try{m=JSON.parse(t.meta||'{}')||{}}catch(e){}
    const kind=['shell','attach','resume','codex','agy'].includes(m.kind)?m.kind:'shell';   // codex/agy kept: a message for that session is typed into it (panelTypeMsg), not sent as a second writer
    const opts={restore:true,id:t.id,session:m.session||'',uuid:m.uuid||'',full:m.full||'',label:m.label||kind,title:m.title||'',cwd:m.cwd||'',auto:!!m.auto,bg:!!m.bg,fromStrip:!!m.fromStrip,cols:t.cols|0,rows:t.rows|0};
    if(m.place!=='strip')opts.host=ptyParkBox();
    if(!ptyOpen(kind,opts))continue;
    const p=ptys.get(t.id);if(!p)continue;n++;
    if(opts.host){p.parked=true;p.parkT=Date.now();ptyMetaSync(p)}
  }
  if(!n)return;
  ptyRestored=n;ptyCacheTrim();
  if(openCard&&$('#mterm'))mountPanelTerm(openCard,false);
};
let ptyRestored=0;
window.__kanban.ptyExit=function(id,code,err){
  const p=ptys.get(id);if(!p)return;
  p.gone=true;p.code=code;
  if(p.parked){ptyDrop(id);setTimeout(load,800);return}
  // a shell's exit carries the last command's status: close it anyway
  if(p.closing||(p.kind==='shell'&&!err)){ptyDrop(id);return}
  // only one that failed at once stays, to say why
  const atOnce=code>0&&Date.now()-(p.openedAt||0)<3000;
  if(!p.host&&!err&&!atOnce){ptyDrop(id);setTimeout(load,800);return}
  // a card's ended terminal is not restarted by itself (mountPanelTerm offers it); one that
  // failed at once stays with what it printed
  if(p.host){ptyEnded.add(p.full||p.session);ptyEndedHow.set(p.full||p.session,{at:Date.now(),attach:p.kind==='attach'});ptyGlOff(p);if(!err&&!atOnce){ptyDrop(id);setTimeout(load,800);return}}
  const why=err?err:'終了しました'+(code>0?'(終了コード '+code+')':'')+(p.kind==='attach'?' — セッションはバックグラウンドで動き続けます':'');
  p.xt.write('\r\n\x1b[2m— '+why+' · × で閉じる\x1b[0m\r\n');
  p.el.classList.add('gone');
  setTimeout(load,800);
};
function ptyClose(id){const p=ptys.get(id);if(!p)return;if(p.gone){ptyDrop(id);return}p.closing=true;post({type:'ptyclose',id})}
function ptyDrop(id){
  const p=ptys.get(id);if(!p)return;
  // renderer first (ptyGlDrop): xterm's dispose does not free all of it
  ptyGlOff(p);p.xtGone=true;
  // a removed element fires no focusout (75-keys.js)
  try{if(p.el.contains&&p.el.contains(document.activeElement)&&typeof keysLeft==='function')keysLeft()}catch(e){}
  try{p.xt.dispose()}catch(e){}
  p.el.remove();ptys.delete(id);
  // a shell that stood in for a command pane: restore the pane
  const cp=p.inPlaceOf;if(cp&&panes.includes(cp)){cp.handed=null;cp.el.hidden=false;ptyLayout();if(ptyOn===id){ptyOn='cmd';ptyMark('cmd');setActivePane(cp);const i=paneIn(cp);if(i&&!i.disabled&&focusFree(null))i.focus()}termBottom(cp);return}
  ptyLayout();
  if(p.host&&openCard&&(openCard.id===p.full))setTimeout(()=>mountPanelTerm(openCard),0);
  // focus moves on only if it was here
  if(ptyOn===id){const next=[...ptys.values()].filter(x=>!x.host).pop();if(focusFree(null)&&!document.body.classList.contains('termclosed'))ptyShow(next?next.id:'cmd');else ptyMark(next?next.id:'cmd')}   // a folded strip stays folded when its pane ends
}
function ptySetup(){
  const cmd=document.querySelector('#termtabs .ttab[data-t="cmd"]');
  if(!cmd)return;
  if(!native||!window.Terminal)return;
  // ask for what the pty host still runs (ptyRestore)
  post({type:'ptylist'});
  cmd.onclick=e=>{e.stopPropagation();ptyShow('cmd')};
  const box=$('#ptys');
  if(window.ResizeObserver)new ResizeObserver(ptyFitAll).observe(box);
  window.addEventListener('resize',ptyFitAll);
  let light=document.body.classList.contains('light');
  new MutationObserver(()=>{const l=document.body.classList.contains('light');if(l===light)return;light=l;const th=ptyColors();for(const p of ptys.values())p.xt.options.theme=th}).observe(document.body,{attributes:true,attributeFilter:['class']});
}
ptySetup();
// --hdrh: measured header + notification bar height, where fixed elements below begin (the header wraps)
{const hd=document.querySelector('header'),nb=$('#notifybar');
  const setH=()=>document.documentElement.style.setProperty('--hdrh',((hd.offsetHeight||0)+(nb&&!nb.hidden?nb.offsetHeight||0:0))+'px');
  setH();if(window.ResizeObserver){const ro=new ResizeObserver(setH);ro.observe(hd);if(nb)ro.observe(nb)}else window.addEventListener('resize',setH);
  window.hdrhSet=setH}
try{$('#showdone').classList.toggle('on',(localStorage.getItem('showdone')||(window.innerWidth>=1700?'1':'0'))==='1');$('#subs').classList.toggle('on',localStorage.getItem('showsubs')==='1')}catch(e){}
applyDone();
$('#hours').onchange=load;
$('#q').oninput=()=>{convo=null;render()};
$('#q').onkeydown=e=>{
  if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){$('#q').value='';convo=null;render();$('#q').blur();return}
  // Enter: search the conversations too
  if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();searchConvo();return}
  if(e.key==='ArrowDown'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#q').blur();sel=null;moveSel(0,0)}
};
