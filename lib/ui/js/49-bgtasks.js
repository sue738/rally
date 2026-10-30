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
  el.innerHTML='<div class="bghead"><b>'+t('裏で実行中のタスク')+'</b><span class="dim">'+esc((c&&(c.title||short(c.project)))||'')+'</span><button class="mini bgx" title="'+t('閉じる (Esc)')+'">×</button></div>'
    +(l.length?'<ul class="bglist">'+l.map(tk=>'<li data-pid="'+tk.pid+'"'+(tk.stale?' class="stale"':'')+'>'
      +'<code title="'+esc(tk.cmd)+'">'+esc(tk.cmd)+'</code>'
      +'<span class="bgmeta dim">'+t('{age}前から',{age:esc(bgTaskAge(tk.ageS))})+(tk.outIdleS!=null?' · '+t('出力 {age}前',{age:esc(bgTaskAge(tk.outIdleS))}):'')+'</span>'
      +(tk.stale?'<span class="bgstale" title="'+t('ターンは終わり、{age}回り続け、出力も変わっていない待ちループです',{age:esc(bgTaskAge(tk.ageS))})+'">'+t('止まらず回っています')+'</span>':'')
      +'<button class="mini bgkill" data-pid="'+tk.pid+'">'+t('止める')+'</button></li>').join('')+'</ul>'
      :'<div class="dim bgnone">'+t('いま動いているタスクはありません')+'</div>')
    +'<div class="bgfoot">'+(stale.length?'<button class="mini bgall">'+t('止まらず回っている {n} 件を全部止める',{n:stale.length})+'</button>':'')
    +'<label class="bgauto" title="'+t('ターンが終わって6時間以上、出力も1時間以上変わらずに回り続けている待ちループ(until/while … sleep)だけを、ボードが自動で止めます')+'"><input type="checkbox" id="bgautock"'+(auto?' checked':'')+'> '+t('止まらず回っている待ちループを自動で止める')+'</label></div>'
    +'<div class="bgtoast dim" aria-live="polite"></div>';
  el.querySelector('.bgx').onclick=bgPopClose;
  const ask=(b,label,run)=>{if(b.dataset.armed){b.disabled=true;b.textContent=t('止めています…');run();return}
    b.dataset.armed='1';b.textContent=label;b.classList.add('warn');setTimeout(()=>{if(b.isConnected&&!b.disabled){delete b.dataset.armed;bgPopDraw()}},4000)};
  for(const b of el.querySelectorAll('.bgkill'))b.onclick=e=>{e.stopPropagation();const tk=l.find(x=>String(x.pid)===b.dataset.pid);if(tk)ask(b,t('本当に止める?'),()=>bgStopTasks(c,[tk]))};
  const all=el.querySelector('.bgall');if(all)all.onclick=e=>{e.stopPropagation();ask(all,t('本当に {n} 件止める?',{n:stale.length}),()=>bgStopTasks(c,stale))};
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
  const msg=r.error?t('止められませんでした: {e}',{e:r.error}):bad.length?t('{n} 件は止めませんでした: {e}',{n:bad.length,e:bad.map(x=>x.error).join(' / ')}):t('止めました');
  const tt=$('#bgpop .bgtoast');if(tt&&bgPop&&bgPop.id===session)tt.textContent=msg;
  if(!bad.length&&!r.error&&live)for(const c of live.cards||[])if(c.id===session&&c.bgTasks){const gone=new Set(res.map(x=>x.pid));c.bgTasks=c.bgTasks.filter(x=>!gone.has(x.pid))}
  bgPopDraw();if(tt&&bgPop&&bgPop.id===session){const t2=$('#bgpop .bgtoast');if(t2)t2.textContent=msg}
  load();
};
