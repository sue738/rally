// A live session's background tasks (lib/bgtasks.js), each stoppable after a confirming second
// click. `bgtasks --stop` re-checks each process (same parent and command line) before signalling.
let bgPop=null;   // {agent, id} of the list that is open
function bgTaskAge(s){return s==null?'?':ago(s)}
function bgPopClose(){const el=document.querySelector('#bgpop');if(el)el.remove();bgPop=null}
function bgPopDraw(){
  const el=document.querySelector('#bgpop');if(!el||!bgPop)return;
  const c=((live&&live.cards)||[]).find(x=>x.agent===bgPop.agent&&x.id===bgPop.id);
  const l=(c&&c.bgTasks)||[];
  const stale=l.filter(t=>t.stale);
  const auto=!live||live.bgAuto!==false;
  el.innerHTML='<div class="bghead"><b>裏で実行中のタスク</b><span class="dim">'+esc((c&&(c.title||short(c.project)))||'')+'</span><button class="mini bgx" title="閉じる (Esc)">×</button></div>'
    +(l.length?'<ul class="bglist">'+l.map(t=>'<li data-pid="'+t.pid+'"'+(t.stale?' class="stale"':'')+'>'
      +'<code title="'+esc(t.cmd)+'">'+esc(t.cmd)+'</code>'
      +'<span class="bgmeta dim">'+esc(bgTaskAge(t.ageS))+'前から'+(t.outIdleS!=null?' · 出力 '+esc(bgTaskAge(t.outIdleS))+'前':'')+'</span>'
      +(t.stale?'<span class="bgstale" title="ターンは終わり、'+esc(bgTaskAge(t.ageS))+'回り続け、出力も変わっていない待ちループです">止まらず回っています</span>':'')
      +'<button class="mini bgkill" data-pid="'+t.pid+'">止める</button></li>').join('')+'</ul>'
      :'<div class="dim bgnone">いま動いているタスクはありません</div>')
    +'<div class="bgfoot">'+(stale.length?'<button class="mini bgall">止まらず回っている '+stale.length+' 件を全部止める</button>':'')
    +'<label class="bgauto" title="ターンが終わって6時間以上、出力も1時間以上変わらずに回り続けている待ちループ(until/while … sleep)だけを、ボードが自動で止めます"><input type="checkbox" id="bgautock"'+(auto?' checked':'')+'> 止まらず回っている待ちループを自動で止める</label></div>'
    +'<div class="bgtoast dim" aria-live="polite"></div>';
  el.querySelector('.bgx').onclick=bgPopClose;
  const ask=(b,label,run)=>{if(b.dataset.armed){b.disabled=true;b.textContent='止めています…';run();return}
    b.dataset.armed='1';b.textContent=label;b.classList.add('warn');setTimeout(()=>{if(b.isConnected&&!b.disabled){delete b.dataset.armed;bgPopDraw()}},4000)};
  for(const b of el.querySelectorAll('.bgkill'))b.onclick=e=>{e.stopPropagation();const t=l.find(x=>String(x.pid)===b.dataset.pid);if(t)ask(b,'本当に止める?',()=>bgStopTasks(c,[t]))};
  const all=el.querySelector('.bgall');if(all)all.onclick=e=>{e.stopPropagation();ask(all,'本当に '+stale.length+' 件止める?',()=>bgStopTasks(c,stale))};
  const ck=el.querySelector('#bgautock');ck.onchange=()=>{if(live)live.bgAuto=ck.checked;post({type:'bgauto',on:ck.checked})};
}
function bgPopOpen(btn){
  const agent=btn.dataset.agent,id=btn.dataset.id;
  if(bgPop&&bgPop.agent===agent&&bgPop.id===id)return bgPopClose();
  bgPopClose();bgPop={agent,id};
  const el=document.createElement('div');el.id='bgpop';el.className='bgpop';el.setAttribute('role','dialog');
  el.onclick=e=>e.stopPropagation();document.body.appendChild(el);bgPopDraw();
  const r=btn.getBoundingClientRect(),w=Math.min(520,window.innerWidth-16);
  el.style.width=w+'px';el.style.left=Math.max(8,Math.min(r.left,window.innerWidth-w-8))+'px';
  const h=el.offsetHeight;el.style.top=(r.bottom+h+8<window.innerHeight?r.bottom+4:Math.max(8,r.top-h-4))+'px';
}
// a refresh redraws the open list — not while a 止める waits for its second click
function bgPopRefresh(){const el=document.querySelector('#bgpop');if(el&&!el.querySelector('[data-armed],button:disabled'))bgPopDraw()}
function bgStopTasks(c,list){
  if(!c||!list.length)return;
  post({type:'bgtask',session:c.id,tasks:list.map(t=>({pid:t.pid,ppid:t.ppid,sig:t.sig}))});
}
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.bgrun.bgopen');
  if(b){e.stopPropagation();e.preventDefault();bgPopOpen(b);return}
  if(bgPop&&!(e.target.closest&&e.target.closest('#bgpop')))bgPopClose();
},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&bgPop){e.stopPropagation();bgPopClose()}},true);
// bgtask answers (main.swift): what was stopped, what was refused
window.__kanban.bgTasksDone=function(session,r){
  r=r||{};const res=r.results||[];const bad=res.filter(x=>!x.ok);
  const msg=r.error?'止められませんでした: '+r.error:bad.length?bad.length+' 件は止めませんでした: '+bad.map(x=>x.error).join(' / '):'止めました';
  const t=$('#bgpop .bgtoast');if(t&&bgPop&&bgPop.id===session)t.textContent=msg;
  if(!bad.length&&!r.error&&live)for(const c of live.cards||[])if(c.id===session&&c.bgTasks){const gone=new Set(res.map(x=>x.pid));c.bgTasks=c.bgTasks.filter(x=>!gone.has(x.pid))}
  bgPopDraw();if(t&&bgPop&&bgPop.id===session){const t2=$('#bgpop .bgtoast');if(t2)t2.textContent=msg}
  load();
};
