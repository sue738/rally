// 残作業 in one place, counted as the header counts it (pendCounts). A reading is a model call
// (lib/wip.js), so a batch is capped at WIP_MAX and needs a second press.
const WIP_MAX=3;   // lib/wip.js MAX_RUNNING: it refuses a fourth running at once
function pendCounts(cards){
  const mine=(cards||[]).filter(c=>!c.subagent&&!c.headless&&(c.agent==='claude'||c.agent==='codex'));
  const read=mine.filter(c=>c.wip&&c.wip.status==='ok');
  const withWork=read.filter(c=>(c.wip.remaining||[]).length)
    .sort((x,y)=>(y.wip.remaining.length-x.wip.remaining.length)||(y.lastT-x.lastT));
  const clean=read.filter(c=>!(c.wip.remaining||[]).length).sort((x,y)=>y.lastT-x.lastT);
  const running=mine.filter(c=>c.wip&&c.wip.status==='running');
  const failed=mine.filter(c=>c.wip&&c.wip.status==='error');
// the same sessions `rally wip` offers (lib/board.js wipCandidates); stale first, then those waiting on you
  const rank={stale:0,'needs-you':1,approval:1,answered:1,idle:2};
  const unread=mine.filter(c=>!c.wip&&c.column!=='done'&&c.column!=='working')
    .sort((x,y)=>((rank[x.column]??5)-(rank[y.column]??5))||(y.lastT-x.lastT));
  const items=withWork.reduce((n,c)=>n+c.wip.remaining.length,0);
  return {withWork,clean,running,failed,unread,items};
}
function pendSig(){const p=pendCounts(live.cards);
  return [p.items,...[...p.withWork,...p.clean,...p.running,...p.failed].map(c=>c.id+c.wip.status+(c.wip.remaining||[]).length+c.wip.at),p.unread.length].join('|')}
// asked here, not yet on the board: a refresh computed before lib/wip.js wrote "running" must not
// bring the button back, or a second press reads the same session twice
const wipAsked=new Map();
function wipOverlay(cards){const now=Date.now();
  for(const c of cards||[]){const t=wipAsked.get(c.agent+':'+c.id);if(!t)continue;
    if(now-t>20000){wipAsked.delete(c.agent+':'+c.id);continue}
    if(!c.wip||(c.wip.status!=='running'&&(c.wip.at||0)<t))c.wip={status:'running',at:t}}}
function wipStart(c){
  wipAsked.set(c.agent+':'+c.id,Date.now());
  const m={type:'wip',agent:c.agent,session:c.id};
  if(native)post(m);else fetch('api/wip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).catch(()=>{});
  c.wip={status:'running',at:Date.now()};
}
function wipLater(){setTimeout(load,1500);setTimeout(load,15000);setTimeout(load,35000);setTimeout(load,70000)}
function openPendingAll(){
  keepUnsent();   // what you were writing to the card goes with it (unsent), not lost
  const p=pendCounts(live.cards);
  const busy=p.running.length,room=Math.max(0,WIP_MAX-busy),batch=Math.min(room,p.unread.length);
  const nm=c=>ico(c)+esc(c.title||short(c.project)||c.id.slice(0,8));
  const sub=c=>'<span class="dim">'+esc(COL_JA[c.column]||c.column)+' · '+esc(short(c.project))+' · '+ago(c.idleS)+'前</span>';
  const stale=c=>c.lastT&&c.wip&&c.wip.at&&c.lastT>c.wip.at+60000;
  $('#mtitle').textContent='残作業 '+p.items+'件 — '+p.withWork.length+'セッション';$('#detail').classList.remove('sess');
  let html='<div id="mmeta"><div class="pexp">ヘッダーの「残作業 '+(p.items||'–')+'」は、棚卸し済みのセッションに残っている<b>項目の数</b>です('+p.withWork.length+'セッション)。'
    +'未棚卸しのセッションは数えていません。作業中・完了のセッションとサブエージェントは対象外です。</div>'
    +'<div class="pcnt"><span><b>'+p.items+'</b> 件残り('+p.withWork.length+'セッション)</span><span>未棚卸し <b>'+p.unread.length+'</b></span>'
    +(busy?'<span>棚卸し中 <b>'+busy+'</b></span>':'')+(p.failed.length?'<span class="bad">失敗 <b>'+p.failed.length+'</b></span>':'')+'<span class="dim">残りなし '+p.clean.length+'</span></div></div>';
// not #mhist: that id carries the conversation's scroll behaviour
  html+='<div class="hist plist" id="plisth">';
  if(p.withWork.length)html+='<h4 class="psec">残っている</h4>';
  else html+='<div class="more">'+(p.clean.length?'棚卸しした'+p.clean.length+'件には、残っていることはありませんでした':'まだ棚卸ししたセッションがありません')+'</div>';
  for(const c of p.withWork){
    html+='<div class="pitem" tabindex="0" role="button" data-agent="'+esc(c.agent)+'" data-id="'+esc(c.id)+'">'
      +'<div class="ph2"><b>'+nm(c)+'</b>'+sub(c)+'<button class="mini popen" title="このセッションのパネルを開きます">開く</button></div>'
      +(stale(c)?'<div class="ev">棚卸しの後に動いています <button class="mini prescan">棚卸しし直す</button></div>':'')
      +'<ul>'+c.wip.remaining.map(x=>'<li><span class="pw">'+esc(x.what)+'</span><span class="pacts"><button class="mini pgo" title="このセッションに「これを進めて」と送ります">実行</button><button class="mini pno" title="残作業から外します(セッションには何も送りません)">やめる</button></span></li>').join('')+'</ul>'
      +((c.wip.blocked||[]).length?'<div class="ev">判断待ち: '+esc(c.wip.blocked.join(' / '))+'</div>':'')
      +'</div>';
  }
// not read yet: one at a time, or a batch up to what lib/wip.js runs at once
  if(p.unread.length){
    html+='<h4 class="psec">未棚卸し '+p.unread.length+'件<span class="dim">1件ごとにモデル(sonnet)を呼びます · 数十秒 · 同時に'+WIP_MAX+'件まで</span>'
      +(batch?'<button id="pscanall" class="mini" data-n="'+batch+'" title="上から'+batch+'件を棚卸しします。もう一度押して確定">まとめて棚卸し('+batch+'件)</button>':'<span class="dim">いま'+busy+'件実行中 — 終わると続けられます</span>')+'</h4>';
    const shown=p.unread.slice(0,40);
    for(const c of shown)html+='<div class="prow" data-agent="'+esc(c.agent)+'" data-id="'+esc(c.id)+'"><span class="pt">'+nm(c)+'</span>'+sub(c)
      +'<button class="mini pscan1"'+(room?'':' disabled title="同時に'+WIP_MAX+'件までです。いまのが終わるまでお待ちください"')+'>棚卸しする</button></div>';
    if(p.unread.length>shown.length)html+='<div class="more">ほか '+(p.unread.length-shown.length)+'件(古いもの)</div>';
  }
  if(busy||p.failed.length){html+='<h4 class="psec">棚卸し中・失敗</h4>';
    for(const c of [...p.running,...p.failed])html+='<div class="prow" data-agent="'+esc(c.agent)+'" data-id="'+esc(c.id)+'"><span class="pt">'+nm(c)+'</span>'
      +(c.wip.status==='running'?'<span class="dim">棚卸し中…</span>':'<span class="bad" title="'+esc(c.wip.error||'')+'">失敗</span><button class="mini pscan1"'+(room?'':' disabled')+'>もう一度</button>')+'</div>'}
  if(p.clean.length){html+='<details class="pdone"><summary class="dim">残りなし '+p.clean.length+'件</summary>';
    for(const c of p.clean)html+='<div class="prow" data-agent="'+esc(c.agent)+'" data-id="'+esc(c.id)+'"><span class="pt">'+nm(c)+'</span><span class="dim">'+esc(ago(Math.round((Date.now()-c.wip.at)/1000)))+'前に棚卸し'+(stale(c)?' · その後に動いています':'')+'</span><button class="mini popen">開く</button></div>';
    html+='</details>'}
  html+='</div>';
  const keepScroll=panelKey==='pending'&&$('#plisth')?$('#plisth').scrollTop:0,wasOpen=!!document.querySelector('#mbody details.pdone[open]');
  $('#mbody').innerHTML=html;
  if(wasOpen){const d=$('#mbody').querySelector('details.pdone');if(d)d.open=true}
  if(keepScroll){const h=$('#plisth');if(h)h.scrollTop=keepScroll}
  const cardOf=el=>live.cards.find(x=>x.agent===el.dataset.agent&&x.id===el.dataset.id);
  for(const el of $('#mbody').querySelectorAll('.pitem')){
    const open=()=>{const c=cardOf(el);if(c)openDetail(c)};
    el.onclick=open;el.onkeydown=e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();open()}};
  }
  for(const b of $('#mbody').querySelectorAll('.popen'))b.onclick=e=>{e.stopPropagation();const c=cardOf(b.closest('[data-id]'));if(c)openDetail(c)};
  for(const b of $('#mbody').querySelectorAll('.pscan1,.prescan'))b.onclick=e=>{e.stopPropagation();const c=cardOf(b.closest('[data-id]'));if(!c)return;
    b.disabled=true;b.textContent='棚卸し中…';wipStart(c);wipLater()};
  for(const li of $('#mbody').querySelectorAll('.pitem li')){
    const el=li.closest('.pitem'),what=(li.querySelector('.pw')||{}).textContent||'';
    const go=li.querySelector('.pgo'),no=li.querySelector('.pno');
    if(go)go.onclick=e=>{e.stopPropagation();const cc=cardOf(el);if(cc&&pendAct(cc,what,true))li.remove()};
    if(no)no.onclick=e=>{e.stopPropagation();const cc=cardOf(el);if(cc&&pendAct(cc,what,false))li.remove()};
  }
// まとめて: the first press only arms it (each reading is a model call)
  const sa=$('#pscanall');
  if(sa)sa.onclick=()=>{const n=+sa.dataset.n||0;if(!n)return;
    if(!sa.dataset.armed){sa.dataset.armed='1';sa.classList.add('armed');sa.textContent='もう一度押すと '+n+'件 棚卸しします(モデルを'+n+'回呼びます)';
      setTimeout(()=>{if(sa.isConnected&&sa.dataset.armed){delete sa.dataset.armed;sa.classList.remove('armed');sa.textContent='まとめて棚卸し('+n+'件)'}},5000);return}
    sa.disabled=true;sa.textContent='棚卸し中…';
    for(const c of pendCounts(live.cards).unread.slice(0,n))wipStart(c);
    wipLater();openPendingAll()};
  openFor=null;openCard=null;panelKey='pending';pendShown=pendSig();
  delete $('#detail').dataset.color;
  $('#detail').hidden=false;document.body.classList.add('withpanel');
}
let pendShown='';
/** 実行 sends the item to its session, やめる does not; either way it leaves the reading (lib/wip.js drop). */
function pendAct(c,what,run){
  if(!c||!what)return false;
  if(run)dispatch({type:'reply',agent:c.agent,session:c.id,text:'残作業のうち、次を進めてください: '+what,dir:c.project,typeInto:native},$('#mbody'));
  const m={type:'wip',agent:c.agent,session:c.id,drop:what};
  if(native)post(m);else fetch('api/wip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).catch(()=>{});
  if(c.wip&&c.wip.remaining)c.wip.remaining=c.wip.remaining.filter(x=>x.what!==what);
  return true;
}
$('#pendall').onclick=()=>togglePanel('pending',openPendingAll);
// a view's button closes it when pressed again, and looks pressed while it is open
const PANEL_BTN={pending:'#pendall',new:'#new',jobs:'#jobsbtn'};
/**
 * 定期実行: this Mac's launchd agents, their schedule, last result and logs. Your own jobs can be run,
 * paused (.plist.disabled) or deleted (to the Trash), each on a second press since it changes the
 * real launchd (lib/jobs.js act). The app's own entries are read-only.
 */
function openJobs(){
  keepUnsent();   // what you were writing to the card goes with it (unsent), not lost
  $('#mtitle').textContent='定期実行';$('#detail').classList.remove('sess');
  $('#mbody').innerHTML='<div class="jobs"><div class="vempty">読み込み中…</div></div>';
  openFor=null;openCard=null;panelKey='jobs';delete $('#detail').dataset.color;$('#detail').classList.remove('hued');
  $('#detail').hidden=false;document.body.classList.add('withpanel');
  jobsLoad();
}
function jobsLoad(){if(native)post({type:'jobs'});else fetch('api/jobs').then(r=>r.json()).then(j=>jobsArrived(j)).catch(e=>jobsArrived({jobs:[],error:String(e)}))}
function whenNext(t){
  const d=new Date(t),now=new Date(),mins=Math.round((t-Date.now())/60000);
  const hm=d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
  if(mins<1)return 'まもなく';if(mins<60)return mins+'分後';
  const day=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
  const dd=Math.round((day(d)-day(now))/864e5);
  return dd===0?'今日 '+hm:dd===1?'明日 '+hm:(d.getMonth()+1)+'/'+d.getDate()+'('+'日月火水木金土'[d.getDay()]+') '+hm;
}
const JOB_ACT={run:['今すぐ実行','もう一度押すと今すぐ実行します'],pause:['止める','もう一度押すと止めます(launchd から外し .disabled に)'],resume:['再開','もう一度押すと再開します'],delete:['削除','もう一度押すとゴミ箱へ移します']};
let jobsLast=null;
function jobsHtml(j,keepOther){
  const js=(j&&j.jobs)||[];
  if(!js.length)return '<div class="vempty">'+esc((j&&j.error)||'定期実行は見つかりませんでした(~/Library/LaunchAgents)')+'</div>';
  const row=x=>{
    const st=x.disabled?['off','停止中']:!x.loaded?['off','未登録']:x.running?['run','実行中']:x.lastExit===0||x.lastExit==null?['ok','成功']:['bad','失敗 ('+x.lastExit+')'];
// running now: no second start (launchd would kill and restart it)
    const acts=!x.mine?[]:x.disabled||!x.loaded?['resume','delete']:x.running?['pause','delete']:['run','pause','delete'];
    const b=(a)=>'<button class="mini jact'+(a==='delete'?' danger':'')+'" data-a="'+a+'"'+(native?'':' disabled title="アプリの中からだけ操作できます"')+'>'+JOB_ACT[a][0]+'</button>';
    return '<div class="job'+(x.mine?'':' other')+'" data-label="'+esc(x.label)+'"><span class="jdot '+st[0]+'"></span><div class="jmain">'
      +'<div class="jl1"><b title="'+esc(x.label)+'">'+esc(x.label.replace(/^(com|dev|org|io)\.[^.]+\./,''))+'</b><span class="jst '+st[0]+'">'+esc(st[1])+'</span><span class="jsch" title="スケジュール">'+esc(x.schedule)+'</span></div>'
      +'<div class="jl2 dim">'+(x.lastRun?'<span title="'+esc(new Date(x.lastRun).toLocaleString('ja-JP'))+'">最後 '+ago(Math.round((Date.now()-x.lastRun)/1000))+'前</span>':'<span>まだ実行の記録なし</span>')
      +(x.next?'<span title="'+esc(new Date(x.next).toLocaleString('ja-JP'))+'">次 '+esc(whenNext(x.next))+'</span>':'')
      +'<span class="jprog" title="'+esc(x.program)+'">'+esc(shortHome(x.program))+'</span></div>'
      +(x.said?'<div class="jsaid'+(st[0]==='bad'?' bad':'')+'" title="ログの最後の行">'+esc(x.said)+'</div>':'')
      +'<div class="jacts">'+(x.log?'<button class="mini jlog" data-p="'+esc(x.log)+'">ログ</button>':'')+(x.err?'<button class="mini jlog" data-p="'+esc(x.err)+'">エラーログ</button>':'')
      +(acts.length?'<span class="sp"></span>'+acts.map(b).join(''):'')+'</div></div></div>';
  };
  const mine=js.filter(x=>x.mine),other=js.filter(x=>!x.mine);
  const bad=mine.filter(x=>x.loaded&&!x.disabled&&x.lastExit&&!x.running).length;
  return '<div class="jsum dim">あなたの '+mine.length+' 件'+(bad?' · <span class="bad">失敗 '+bad+'</span>':'')+' · 実行・止める・削除は launchd を実際に変えるので、2回押して確定します</div>'
    +mine.map(row).join('')+(other.length?'<details class="jother"'+(keepOther?' open':'')+'><summary class="dim">そのほか '+other.length+' 件(アプリが入れたもの・見るだけ)</summary>'+other.map(row).join('')+'</details>':'');
}
function jobsArrived(j){
  const box=$('#mbody .jobs');if(!box||panelKey!=='jobs')return;
  jobsLast=j;
  box.innerHTML=jobsHtml(j,!!box.querySelector('details.jother[open]'));
  for(const b of box.querySelectorAll('.jlog'))b.onclick=()=>openViewer(b.dataset.p);
  for(const b of box.querySelectorAll('.jact'))b.onclick=()=>{
    const a=b.dataset.a,label=b.closest('.job').dataset.label;
    if(!b.dataset.armed){b.dataset.armed='1';b.classList.add('armed');b.textContent=JOB_ACT[a][1];
      setTimeout(()=>{if(b.isConnected&&b.dataset.armed){delete b.dataset.armed;b.classList.remove('armed');b.textContent=JOB_ACT[a][0]}},4000);return}
    b.disabled=true;b.textContent='…';jobAsked={a,label};
    post({type:'jobact',action:a,label});
  };
}
let jobAsked=null;
function jobActed(r){
  const was=jobAsked;jobAsked=null;
  if(r&&r.error){toast($('#mbody')||document.body,'✗ '+r.error);if(jobsLast)jobsArrived(jobsLast);return}
  if(panelKey==='jobs')jobsLoad();
  toast($('#mbody')||document.body,was?'✓ '+(JOB_ACT[was.a]||[was.a])[0]+': '+was.label.replace(/^(com|dev|org|io)\.[^.]+\./,''):'✓');
}
$('#jobsbtn').onclick=()=>togglePanel('jobs',openJobs);
/** Opens or closes the 新規 panel; `how` goes to the app's log, so an unexpected opening can be traced to its cause. */
function toggleNew(how){if(native)try{post({type:'log',text:'new-session panel: '+how+(panelOpen()&&panelKey==='new'?' (closing)':'')})}catch(e){}togglePanel('new',openNew)}
function togglePanel(key,open){
  if(panelOpen()&&panelKey===key){closeDetail('toggle');return}
  open();syncPanelBtns();
}
function syncPanelBtns(){
// what is open, for the next launch
  // (not 新規: that is a form for starting something, and reopening it by itself at every launch looked like it opened on its own)
  if(openedFirst&&!window.__akSelftest&&!(panelOpen()&&panelKey==='new')){try{localStorage.setItem('lastpanel',panelOpen()&&panelKey!=='keys'?(panelKey||''):'')}catch(e){}}
for(const [k,sel] of Object.entries(PANEL_BTN)){const b=$(sel);if(b){const on=panelOpen()&&panelKey===k;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on?'true':'false')}}
  syncKeep()}
