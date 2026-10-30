// selftest.sh soak: the board used for a long while, as a person does, relaunched now and then.
// One launch of SOAK_PHASES (selftest.sh runs them on one scratch home, as persist does: every
// launch but the last quits with its terminals left running, and the next draws them again).
// For its share of SOAK_MIN it keeps doing what wears a page down — cards opened and switched
// (the panel's ターミナル and 会話), strip shells and splits opened and closed, output-heavy
// commands, keys typed into terminals, board refreshes, the look-only cache filled past its limit
// and parked terminals brought back — and every 15 s it writes what it counts to samples.jsonl
// (the app adds its pids there; selftest/soaksample.py measures those processes from outside).
// A launch fails on a page exception, on a terminal left behind (an xterm not in ptys, a pane
// in the page for none), and on a command whose output did not come to an end (a hang).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];
const expect=(what,cond)=>{if(!cond&&!bad.includes(what))bad.push(what)};
const PH=+ST_ENV.phase||1,NPH=+ST_ENV.phases||1,MIN=+ST_ENV.minutes||40;
const T0=Date.now(),until=T0+MIN*60000/NPH;
const out={phase:PH,of:NPH,minutes:Math.round(MIN/NPH*10)/10};
// ---- what is counted -------------------------------------------------------
const S={errors:[],xtNew:0,xtDisp:0,xtGc:0,glNew:0,gls:[],tMade:0,iMade:0,lagMax:0,act:{},actErr:[],heavy:[],opens:[]};
window.__soak=S;
const errAt=m=>{if(S.errors.length<200)S.errors.push({t:Math.round((Date.now()-T0)/1000),m:String(m).slice(0,300)})};
window.addEventListener('error',e=>errAt((e.message||'error')+' @ '+(e.filename||'').split('/').pop()+':'+(e.lineno||'?')));
window.addEventListener('unhandledrejection',e=>errAt('promise: '+String((e.reason&&(e.reason.stack||e.reason.message))||e.reason||'')));
// timers: every one made from now on, and which are still to fire (timeouts) or still repeating (intervals)
const _st=window.setTimeout,_ct=window.clearTimeout,_si=window.setInterval,_ci=window.clearInterval;
const pendT=new Set(),liveI=new Map();
// where a timer was made: the first frames of its stack that are not this script's
const site=()=>String(new Error().stack||'').split('\n').slice(2,5).map(l=>l.replace(/^.*\//,'').replace(/:\d+$/,'')).join(' < ').slice(0,160);
window.setTimeout=function(f,ms,...a){S.tMade++;if(typeof f!=='function')return _st.call(window,f,ms,...a);let id;id=_st.call(window,function(){pendT.delete(id);return f.apply(this,arguments)},ms,...a);pendT.add(id);return id};
window.clearTimeout=function(id){pendT.delete(id);liveI.delete(id);return _ct.call(window,id)};
window.setInterval=function(f,ms,...a){S.iMade++;const id=_si.call(window,f,ms,...a);liveI.set(id,site()+' ('+ms+'ms)');return id};
const intervalSites=()=>{const m={};for(const s of liveI.values())m[s]=(m[s]||0)+1;return m};
window.clearInterval=function(id){liveI.delete(id);pendT.delete(id);return _ci.call(window,id)};
// xterm instances made and disposed from now on (a restored terminal is one made after this), and collected
const fin=window.FinalizationRegistry?new FinalizationRegistry(()=>{S.xtGc++}):null;
const liveXt=new Set();
// (the ones a relaunch drew before this script ran are counted as made now)
if(window.Terminal&&!window.Terminal.__soak){const B=window.Terminal;
  for(const p of ptys.values())if(!p.xtGone){liveXt.add(p.xt);S.xtNew++}
  const d0=B.prototype.dispose;B.prototype.dispose=function(){if(!this.__soakGone){this.__soakGone=1;if(liveXt.delete(this))S.xtDisp++}return d0.apply(this,arguments)};
  class SoakTerminal extends B{constructor(...a){super(...a);S.xtNew++;liveXt.add(this);if(fin)fin.register(this,1)}}
  SoakTerminal.__soak=true;window.Terminal=SoakTerminal}
// WebGL contexts: made, and still live (not lost) — weakly held, so counting keeps none alive
{const gc=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,...a){const x=gc.call(this,type,...a);
    if(x&&/^webgl/.test(String(type))&&!this.__soakGl){this.__soakGl=1;S.glNew++;S.gls.push({ctx:new WeakRef(x),cv:new WeakRef(this)})}return x}}
const glCount=()=>{let live=0,att=0;S.gls=S.gls.filter(g=>{const x=g.ctx.deref();if(!x||x.isContextLost())return false;live++;const cv=g.cv.deref();if(cv&&cv.isConnected)att++;return true});return {live,att}};
// a context WebKit took back (past its 16 live), as the renderer tells the console
{const cl=console.log;console.log=function(...a){if(/webglcontextlost/.test(String(a[0])))S.ctxLost=(S.ctxLost||0)+1;return cl.apply(console,a)}}
// the WebGL renderer's cursor blink: a 600 ms interval (xterm's), one per renderer that is drawing
const blinks=()=>[...liveI.values()].filter(s=>/\(600ms\)$/.test(s)).length;
const lsBytes=()=>{let n=0;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);n+=k.length+(localStorage.getItem(k)||'').length}}catch(e){}return n*2};
// the page's own lag: a 1 s tick that came late
{let last=Date.now();_si.call(window,()=>{const now=Date.now(),lag=now-last-1000;last=now;if(lag>S.lagMax)S.lagMax=lag},1000)}
const counts=()=>{const g=glCount(),v=[...ptys.values()];
  return {dom:document.getElementsByTagName('*').length,ptys:ptys.size,xtLive:S.xtNew-S.xtDisp,xtSet:liveXt.size,xtNew:S.xtNew,xtDisp:S.xtDisp,xtGc:S.xtGc,
    ptyEls:document.querySelectorAll('.pty').length,xtermEls:document.querySelectorAll('.xterm').length,
    parked:v.filter(p=>p.parked&&!p.auto).length,cache:v.filter(p=>p.parked&&p.auto).length,strip:v.filter(p=>!p.host).length,gone:v.filter(p=>p.gone).length,
    gl:v.filter(p=>p.gl).length,glNew:S.glNew,glLive:g.live,glAttached:g.att,canvases:document.querySelectorAll('canvas').length,
    timeouts:pendT.size,intervals:liveI.size,blinks:blinks(),ctxLost:S.ctxLost||0,tMade:S.tMade,iMade:S.iMade,ls:lsBytes(),panes:panes.length,cards:(live.cards||[]).length,
    errors:S.errors.length,actErr:S.actErr.length,lagMax:S.lagMax}};
let iter=0;
const sample=why=>{const c=counts();S.lagMax=0;try{post({type:'selftestsample',sample:{t:Date.now(),phase:PH,iter,why:why||'',...c}})}catch(e){}return c};
const sampler=_si.call(window,()=>sample(),15000);
// ---- helpers ---------------------------------------------------------------
const tail=(p,n)=>{if(!p||p.xtGone)return '';const b=p.xt.buffer.active;let t='';for(let i=Math.max(0,b.length-(n||40));i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';return t};
const drawn=p=>/\S/.test(tail(p,200));
const act=async(name,f)=>{S.act[name]=(S.act[name]||0)+1;try{return await f()}catch(e){S.actErr.push({t:Math.round((Date.now()-T0)/1000),name,e:String(e&&e.message||e).slice(0,200)});return null}};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const shells=()=>[...ptys.values()].filter(p=>p.kind==='shell'&&!p.gone&&!p.closing&&!p.host);
const openShell=async()=>{const before=new Set(ptys.keys());ptyOpen('shell',{label:'soak',cwd:''});
  await wait(()=>[...ptys.values()].some(x=>!before.has(x.id)&&!x.gone&&drawn(x)),12000).catch(()=>0);
  const s=[...ptys.values()].find(x=>!before.has(x.id));if(s)await sleep(400);return s};
// a command whose output is heavy, run to its end (a marker after it), timed
let heavyN=0;
const heavy=async(s,cmd)=>{const n=++heavyN,mark='SOAK-END-'+n+'-';const t0=Date.now();
  post({type:'ptyin',id:s.id,data:cmd+'; echo '+mark+'$((6*7))\r'});
  const done=await wait(()=>s.gone||new RegExp(mark+'42').test(tail(s,30)),120000).then(()=>true,()=>false);
  const r={cmd:cmd.slice(0,40),ms:Date.now()-t0,done:done&&!s.gone};S.heavy.push(r);return r};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,20000);
termOpen(true);panelView='term';
// the relaunch: what the pty host kept is drawn again
if(PH>1){await wait(()=>ptyRestored>0,15000).catch(()=>0);await sleep(1500)}
out.restored=ptys.size;out.restoredKinds=[...ptys.values()].map(p=>p.kind+(p.parked?(p.auto?':cache':':parked'):':strip'));
out.start=sample('start');
// stopped cards, and those whose claude runs in one of this app's terminals (the board sees those as running)
const cs=()=>(live.cards||[]).filter(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&x.aliveChecked&&(!x.alive||panelPty(x)));
if(cs().length<3){_ci.call(window,sampler);return {ok:true,skipped:'fewer than 3 claude cards to open',...out}}
// ---- the loop --------------------------------------------------------------
while(Date.now()<until){
  iter++;
  // a card, on its ターミナル (resumed there, look-only) — now and then 会話 and back
  await act('open',async()=>{const c=pick(cs());const t0=Date.now();openDetail(c,false,{focus:false});
    const ok=await wait(()=>{const p=panelPty(c);return p&&p.el.closest('#mterm')&&drawn(p)},10000).then(()=>true,()=>false);
    S.opens.push(ok?Date.now()-t0:-1);if(S.opens.length>400)S.opens.shift();
    if(iter%3===0){panelSwitch('talk');await sleep(700);panelSwitch('term');await sleep(300)}
    // typed into: it is yours, and parked (not the look-only cache) when the panel moves on
    if(iter%4===0){const p=panelPty(c);if(p&&!p.gone)post({type:'ptyin',id:p.id,data:'soak '+iter+' typed\r'})}});
  // a strip shell with heavy output; at most three kept (the oldest closed)
  if(iter%3===1)await act('shell',async()=>{let s=shells();if(s.length>=3)ptyClose(s[0].id);
    const sh=iter%2?await openShell():(shells().slice(-1)[0]||await openShell());if(!sh)throw new Error('no shell');
    const r=await heavy(sh,iter%2?'seq 1 200000':'yes | head -c 5000000');
    expect('a heavy command comes to its end within 2 min ('+r.cmd+', '+r.ms+' ms)',r.done)});
  // keys typed into a shell: letters as the keyboard sends them (real key events), then Enter
  if(iter%5===2)await act('type',async()=>{const sh=shells().slice(-1)[0];if(!sh)return;ptyShow(sh.id);sh.xt.focus();await sleep(150);
    const doneT=new Promise(r=>{window.__soakTyped=r});post({type:'selftesttype',text:'echo soaktype'+iter,cb:'__soakTyped',gap:0.02});
    await Promise.race([doneT,sleep(8000)]);post({type:'ptyin',id:sh.id,data:'\r'});
    const seen=await wait(()=>new RegExp('^soaktype'+iter+'$','m').test(tail(sh,20)),6000).then(()=>true,()=>false);
    S.typed=(S.typed||0)+(seen?1:0);S.typeTried=(S.typeTried||0)+1});
  // a split: a command pane beside the first, a command run in it with output, closed again
  if(iter%4===3)await act('split',async()=>{const p=splitPane();if(!p)return;termRun(p,'seq 1 60000');
    await wait(()=>!p.busy,60000).catch(()=>0);expect('a command in a split pane ends',!p.busy);closePane(p)});
  // the board read again (as its timer and a finished command do)
  if(iter%2===0)await act('refresh',async()=>{load();await sleep(600)});
  // one parked back where it belongs (its card's panel), then the number of parked ones kept in bounds
  if(iter%7===5)await act('unpark',async()=>{const ps=ptyParked();if(!ps.length)return;const p=pick(ps);ptyUnpark(p);await sleep(900);
    const more=ptyParked();if(more.length>5){const o=more[0];ptyClose(o.id)}});
  if(iter%9===8)await act('close',async()=>{closeDetail('selftest');await sleep(500)});
  // the look-only cache is never over its limit, and no terminal is left behind
  {const v=[...ptys.values()];const cache=v.filter(p=>p.parked&&p.auto&&!p.gone&&!p.closing).length;
    expect('no more than '+PTY_CACHE+' look-only terminals are kept ('+cache+')',cache<=PTY_CACHE)}
  await sleep(250);
}
// ---- the end of this launch -------------------------------------------------
closeDetail('selftest');await sleep(1500);
// what is left settles: closes answered, exits handled
await wait(()=>![...ptys.values()].some(p=>p.closing),8000).catch(()=>0);
const end=sample('end');out.end=end;out.intervalSites=intervalSites();out.iters=iter;out.actions=S.act;out.actErr=S.actErr.slice(0,20);out.errors=S.errors.slice(0,30);
out.heavy={n:S.heavy.length,maxMs:Math.max(0,...S.heavy.map(h=>h.ms)),notDone:S.heavy.filter(h=>!h.done)};
const ok=S.opens.filter(x=>x>=0).sort((a,b)=>a-b);out.opens={n:S.opens.length,failed:S.opens.filter(x=>x<0).length,median:ok[ok.length>>1]||0,p95:ok[Math.floor(ok.length*.95)]||0,max:ok[ok.length-1]||0};
out.typed={seen:S.typed||0,tried:S.typeTried||0};
out.left=[...ptys.values()].filter(p=>!p.gone&&!p.closing).map(p=>p.kind+(p.parked?(p.auto?':cache':':parked'):':strip'));
expect('no page exception ('+S.errors.length+': '+(S.errors[0]&&S.errors[0].m)+')',S.errors.length===0);
expect('every xterm made is one in ptys ('+end.xtLive+' live, '+end.ptys+' in ptys)',end.xtLive===end.ptys&&end.xtSet===end.ptys);
expect('a terminal pane in the page for each one in ptys ('+end.ptyEls+' panes, '+end.ptys+')',end.ptyEls===end.ptys);
expect('no more WebGL contexts live than terminals drawing with one ('+end.glLive+' live, '+end.gl+' terminals)',end.glLive<=end.gl);
// a renderer let go stops its cursor blink and gives its context back (ptyGlDrop)
expect('no cursor blink timer left running for a renderer let go ('+end.blinks+' for '+end.gl+' drawing)',end.blinks<=end.gl);
expect('no WebGL context taken back by WebKit (past its 16 live: '+end.ctxLost+')',end.ctxLost===0);
expect('opening a card draws its terminal ('+out.opens.failed+' of '+out.opens.n+' did not)',out.opens.failed<=Math.max(1,out.opens.n*0.05));
_ci.call(window,sampler);
return {ok:bad.length===0,bad,...out};
