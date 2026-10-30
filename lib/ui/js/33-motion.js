// Motion. Until the first state arrives the lanes keep index.html's placeholder cards: an empty board
// before anything was read would be a wrong answer.
let gotState=false,renderedOnce=false;
const reduceMotion=()=>{try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)}catch(e){return false}};
// A hidden page runs no frames, so an animation started then would stall on its first frame until shown.
const noMotion=()=>reduceMotion()||document.hidden;
/** Card positions by agent:id, taken before the lanes are rebuilt. */
function cardRects(){
  const m=new Map();
  for(const d of document.querySelectorAll('section.col .card[data-id]')){const r=d.getBoundingClientRect();m.set(d.dataset.agent+':'+d.dataset.id,{x:r.left,y:r.top})}
  return m;
}
// FLIP deltas; a refresh that changed nothing yields none, so periodic reloads never twitch the board.
function flipDeltas(before,after){
  const out=[];if(!before||!before.size)return out;     // the first render does not move
  for(const [k,r] of after){const b=before.get(k);
    if(!b){out.push({k,fresh:true});continue}
    const dx=b.x-r.x,dy=b.y-r.y;if(Math.abs(dx)>1||Math.abs(dy)>1)out.push({k,dx,dy})}
  return out;
}
function flipPlay(before){
  if(!before||!before.size||noMotion())return 0;
  const els=new Map();for(const d of document.querySelectorAll('section.col .card[data-id]'))els.set(d.dataset.agent+':'+d.dataset.id,d);
  const after=new Map();for(const [k,d] of els){const r=d.getBoundingClientRect();after.set(k,{x:r.left,y:r.top})}
  const ds=flipDeltas(before,after);
  for(const x of ds){const d=els.get(x.k);if(!d||!d.animate)continue;
    if(x.fresh)d.animate([{opacity:0},{opacity:1}],{duration:180,easing:'ease-out'});
    else d.animate([{transform:'translate('+x.dx+'px,'+x.dy+'px)'},{transform:'none'}],{duration:180,easing:'ease-out'})}
  return ds.length;
}
// A new session the CLI starts only in a terminal (an untrusted folder): a ＋シェル pane there with
// `claude -- '…'` typed once its prompt is up, so the CLI can ask its trust question.
function startInPane(req){
  if(!native||!req||!/^\/[^\n]*$/.test(req.dir||'')||!String(req.text||'').trim())return false;
  if(req.model&&!/^[\w.][\w.-]{0,39}$/.test(req.model))return false;
  const q=s=>"$'"+String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,'\\n')+"'";
  const cmd='claude'+(req.model?' --model '+req.model:'')+(req.worktree?' --worktree':'')+' -- '+q(String(req.text).trim());
  const before=new Set(ptys.keys());
  termOpen(true);
  if(!ptyOpen('shell',{cwd:req.dir,label:short(req.dir)||'claude',focus:true}))return false;
  const p=[...ptys.values()].find(x=>!before.has(x.id));if(!p)return false;
  ptyType(p,cmd);
  return true;
}
// typed once the prompt is up (drawn, then quiet for half a second)
function ptyType(p,cmd){
  const t0=Date.now();let seen=-1,quiet=0;
  const tick=setInterval(()=>{
    if(p.gone||Date.now()-t0>15000){clearInterval(tick);return}
    const b=p.xt.buffer.active;let n=0;for(let i=0;i<b.length;i++)n+=b.getLine(i).translateToString(true).trim().length;
    if(n!==seen){seen=n;quiet=Date.now();return}
    if(n>0&&Date.now()-quiet>500){clearInterval(tick);post({type:'ptyin',id:p.id,data:cmd+'\r'});if(focusFree(p.el)||(p.inPlaceOf&&p.inPlaceOf.el.contains(document.activeElement)))p.xt.focus()}
  },120);
}
// the card whose panel is open (the blue frame alone is the keyboard cursor)
function syncOpened(){const on=panelOpen()&&openCard;for(const e of document.querySelectorAll('section.col .card'))e.classList.toggle('opened',!!on&&e.dataset.agent+':'+e.dataset.id===openCard.agent+':'+openCard.id)}
