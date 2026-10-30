// Two transports: in the app, the WebKit message handler "kanban" (the shell
// calls back into window.__kanban); in a browser, the loopback API.
const native=!!(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.kanban);
// a panel that can hold a terminal is the wide one, for every panel
if(native&&window.Terminal)document.body.classList.add('termpanel');
// page errors go to the app's log
window.addEventListener('error',e=>{try{if(native)post({type:'log',text:(e.message||'')+' @ '+(e.lineno||'?')})}catch(x){}});
window.addEventListener('unhandledrejection',e=>{try{if(native)post({type:'log',text:'promise: '+String((e.reason&&e.reason.message)||e.reason||'')})}catch(x){}});
function post(m){
  // an auto-opened terminal becomes yours once you type into it
  if(m&&m.type==='ptyin'&&!m.reply){const p=ptys.get(m.id);if(p)p.auto=false}
  window.webkit.messageHandlers.kanban.postMessage(m)}
// Code-block copy button (drawn by mdRender). The app uses the native
// pasteboard: the clipboard API is unreliable in a file-loaded web view.
const CPY='<button class="cpy" type="button" title="'+t('コピー')+'" aria-label="'+t('コピー')+'"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button>';
function copyText(t){
  if(native){post({type:'copy',text:String(t)});return}
  try{navigator.clipboard.writeText(String(t))}catch(e){}
}
// capture: a click on the button must not also fold the answer it sits in
document.addEventListener('click',e=>{
  const b=e.target&&e.target.closest&&e.target.closest('.cpy');if(!b)return;
  e.preventDefault();e.stopPropagation();
  const pre=b.parentElement&&b.parentElement.querySelector('pre');if(!pre)return;
  copyText(pre.textContent);
  b.classList.add('done');clearTimeout(b._t);b._t=setTimeout(()=>b.classList.remove('done'),1200);
},true);
/** Answer a permission prompt the hook is holding for the board (lib/perm.js). */
const PERM_SAID={allow:'✓ 許可しました',deny:'✗ 拒否しました',pass:'↗ 端末の許可確認に戻しました',answer:'✓ 答えました',automode:'✓ 許可して、auto モードにしました',rule:'✓ 許可して、今後は聞かないルールを保存しました',always:'✓ 許可して、Claude Code が示したルールを保存しました'};
async function permAnswer(c,decision,answers){
  const a=c&&c.permAsk;if(!a)return;
  for(const b of document.querySelectorAll('#mhist .askbox.held button, #mhist .askbox.held input'))b.disabled=true;
  const said=r=>{if(r&&r.error)flash('✗ '+r.error);toast($('#mbody')||document.body,r&&r.error?'✗ '+r.error:a.questions&&decision==='pass'?t('↗ 端末の質問に戻しました'):t(PERM_SAID[decision]||'✓ 許可して、今後は聞かないルールを保存しました'));if(!(r&&r.error)){qPicks.delete(a.id);draftSet('ask:'+a.id,{t:''});if(decision==='automode')c.permMode='auto';if(decision!=='deny'&&decision!=='pass')goWorking(c)}delete c.permAsk;setTimeout(load,300)};
  const msg={id:a.id,decision};if(decision==='answer')msg.answers=answers;else if(typeof answers==='string'&&answers)msg.text=answers;
  if(native){post({type:'perm',...msg});permSaid=said;return}
  try{const r=await fetch('api/perm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(msg)});said(await r.json())}
  catch(e){said({error:String(e)})}
}
let permSaid=null,permKick=0,permIds='';
// held permission prompts show up now: the app watches the directory, the browser polls
if(!native)setInterval(async()=>{
  try{const r=await fetch('api/perm');const ids=((await r.json()).asks||[]).map(a=>a.id).join();if(ids!==permIds){permIds=ids;load()}}catch(e){}
},3000);
const outSeen=new Map();                 // id → output tokens at the last refresh
/** What is left of the 5-hour and weekly allowance, beside the title. */
function renderLimits(l,setup){
  const el=$('#limits');if(!el)return;
  limSetup=setup||null;
  if(!l&&!setup){el.hidden=true;return}
  l=l||{};
  const left=(t)=>{const s=Math.max(0,Math.round((t-Date.now())/1000));return s<3600?Math.round(s/60)+'m':s<86400?Math.floor(s/3600)+'h'+String(Math.round(s%3600/60)).padStart(2,'0')+'m':Math.floor(s/86400)+'d'+Math.round(s%86400/3600)+'h'};
  // label + % above a thin bar: the fill is what is used, the tick how far through the window the clock is
  const one=(label,w,span)=>{if(!w)return '';
    const done=w.resetsAt&&w.resetsAt<=Date.now(),pace=w.resetsAt&&!done?Math.min(1,Math.max(0,1-(w.resetsAt-Date.now())/span)):0;
    const cls=w.used>=90?' bad':w.used>=75||(pace>0&&w.used/100>pace+.1)?' warn':'';
    const bar='<span class="limbar"><span class="limbarfill" style="width:'+Math.min(100,w.used)+'%"></span>'
      +(pace>0?'<span class="limbarpace" style="left:'+(pace*100).toFixed(1)+'%"></span>':'')+'</span>';
    return '<span class="lim'+cls+'" title="'+t('{label}: {used}% 使用',{label,used:w.used})+' · '+(done?t('リセット済'):t('あと{left}でリセット({pace}% 経過)',{left:left(w.resetsAt),pace:Math.round(pace*100)}))+'">'
      +'<span class="limtop">'+label+' <b>'+w.used+'%</b></span>'+bar+'</span>'};
  // one group per agent; the agent's name only when there are two
  const cx=l.codex,cl=l.fiveHour||l.week;
  const group=(name,x)=>'<span class="limg">'+(cl&&cx?'<span class="limn">'+name+'</span>':'')+one('5h',x.fiveHour,5*36e5)+one(t('週'),x.week,7*864e5)+'</span>';
  el.innerHTML=(cl?group('claude',l):setup?'<span class="limg"><button class="mini limset" id="limset" title="'+t('Claude Code の 5時間・週の利用枠をここに出す設定')+'">'+t('Claude の利用枠を出す')+'</button></span>':'')+(cx?group('codex',cx):'');
  const b=$('#limset');if(b)b.onclick=e=>{e.stopPropagation();limSetupOpen(b)};
  el.title=t('利用枠: 使用率とリセットまでの時間\nclaude: ステータスラインが最後に受け取った値')+(l.at?'('+new Date(l.at).toLocaleTimeString()+')':'')
    +(cx?'\n'+t('codex: 最後のセッションのログ({when})',{when:new Date(cx.at).toLocaleString()+(cx.plan?' · '+cx.plan:'')}):'');
  el.hidden=false;limFit();
}
/** The allowance gives up its details (reset times, then the ages, then the second agent) rather than being cut off mid-number. */
function limFit(){
  const el=$('#limits');if(!el||el.hidden)return;
  el.classList.remove('tight','tighter','tightest');
  for(const k of ['tight','tighter','tightest'])if(el.scrollWidth>el.clientWidth+1)el.classList.add(k);
}
window.addEventListener('resize',()=>limFit());
let limSetup=null;
/** How to get Claude's allowance: Claude Code hands it only to a statusline, so settings.json names Rally's (lib/statusline.js). */
function limSetupOpen(b){
  let pop=document.getElementById('limpop');
  if(!pop){pop=document.createElement('div');pop.id='limpop';pop.className='limpop';pop.hidden=true;document.body.appendChild(pop);
    document.addEventListener('click',e=>{if(!pop.hidden&&!pop.contains(e.target))pop.hidden=true})}
  if(!pop.hidden){pop.hidden=true;return}
  const line='"statusLine": { "type": "command", "command": '+JSON.stringify(limSetup||'')+' }';
  pop.innerHTML='<p>'+t('Claude Code は利用枠をステータスラインにだけ渡します。<code>~/.claude/settings.json</code> に次の1行を足すと、Rally がそれを受け取ってここに出します。')+'</p><pre>'+esc(line)+'</pre>'
    +(/ /.test(limSetup||'')?'<p class="dim">'+t('今のステータスラインはそのまま表示されます(Rally が間に入るだけです)。')+'</p>':'<p class="dim">'+t('ステータスラインにはモデル名と使用率が出ます。')+'</p>')
    +'<p class="dim">'+t('次に Claude Code が画面を描いたときから数字が出ます。')+'</p><button class="mini" id="limcopy">'+t('コピー')+'</button>';
  const r=b.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(r.left,innerWidth-440))+'px';pop.style.top=(r.bottom+6)+'px';pop.hidden=false;
  $('#limcopy').onclick=()=>{try{navigator.clipboard.writeText(line).then(()=>{toast(pop,t('コピーしました'));flash(t('設定をコピーしました'))},()=>{})}catch(e){}};
}
// Cards that came to your turn: notify once each and badge the Dock. The first
// read is not news; subagents and machine-started runs are skipped.
const YOU=new Set(['needs-you','approval','answered']);
// answered or sent something: show it working now, before the next refresh
function goWorking(c){const x=c&&(live.cards||[]).find(y=>y.agent===c.agent&&y.id===c.id);if(!x||!YOU.has(x.column))return;
  x.column='working';x.reason='wrote within the last minute';x.lastT=Date.now();x.idleS=0;if(gotState)render()}
let yourTurn=null,yourHours=null,askSeen=null,stuckSeen=null;
// Stuck episodes (lib/stuck.js) are told once. The set only grows, so an
// episode that flickers off and back on is not told twice.
function stuckText(c){
  const s=c.stuck;if(!s)return '';
  const m=Math.max(1,Math.round((Date.now()-(s.since||Date.now()))/60000));
  return s.kind==='loop'?t('同じ操作を {n} 回繰り返しています: {what}',{n:s.n,what:s.what})
    :s.kind==='tool'?t('ツール実行が {m} 分続いています: {what}',{m,what:s.what})
    :s.kind==='wait'?t('許可待ちが {m} 分続いています',{m})+(s.what?': '+s.what:'')
    :t('{m} 分なにも出力していません(作業中のまま)',{m});
}
function stuckArrivals(s){
  const out=[],first=stuckSeen===null;
  if(first)stuckSeen=new Set();
  for(const c of s.cards||[]){
    if(!c.stuck||c.subagent||c.headless||stuckSeen.has(c.stuck.key))continue;
    stuckSeen.add(c.stuck.key);if(!first)out.push(c);
  }
  return out;
}
function arrivals(s){
  const now=new Set(),arrived=[];
  // widening the hours window brings in older cards: not news
  if(s.hours!==undefined&&s.hours!==yourHours){if(yourHours!==null)yourTurn=null;yourHours=s.hours}
  for(const c of s.cards||[]){
    if(!YOU.has(c.column)||c.subagent||c.headless)continue;
    const k=c.agent+':'+c.id;now.add(k);
    // a second prompt in a row is news, though the card never left the lane
    const ask=c.permAsk&&c.permAsk.id,newAsk=ask&&askSeen&&!askSeen.has(ask);
    if(yourTurn&&!yourTurn.has(k)||newAsk)arrived.push(c);
  }
  askSeen=new Set((s.cards||[]).map(c=>c.permAsk&&c.permAsk.id).filter(Boolean));
  yourTurn=now;
  const told=new Set(arrived.map(c=>c.agent+':'+c.id));
  return {n:now.size,arrived,stuck:stuckArrivals(s).filter(c=>!told.has(c.agent+':'+c.id))};
}
function notifyText(c){
  const said=c.last&&c.last.assistant||'';
  const body=c.permAsk&&c.permAsk.questions?t('質問: ')+c.permAsk.questions[0].question.replace(/\s+/g,' ').slice(0,140)
    :c.permAsk?t('許可待ち: ')+c.permAsk.tool+(c.permAsk.what?' '+c.permAsk.what.replace(/\s+/g,' ').slice(0,120):'')
    :c.column==='approval'?t('許可待ち')+(c.lastTool?': '+c.lastTool:'')
    :/^asked you a question/.test(c.reason||'')?t('質問: ')+(c.pending||[]).join(', ')
    :said?said.replace(/\s+/g,' ').slice(0,140):t('あなたの番です');
  return {title:(c.title||short(c.project))+' · '+c.agent,body};
}
var asksSent='',askApprSeen=null;
function tellArrivals(s){
  const first=yourTurn===null;
  const a=arrivals(s);
  // corner cards for new prompts (43-askpop.js); at launch, those from the last 10 minutes
  askPopSync(s);for(const c of a.arrived)if(askPopId(c))askPopShow(c);
  {const now=new Set();for(const c of s.cards||[])if(c.column==='approval'&&!c.subagent&&!c.headless){const k=c.agent+':'+c.id;now.add(k);
     if(first?Date.now()-(c.lastT||0)<600000:askApprSeen&&!askApprSeen.has(k))askPopShow(c)}
   askApprSeen=now}
  if(!native)return a;
  post({type:'badge',n:a.n});
  // a burst (e.g. waking from sleep) is one notification
  if(a.arrived.length>3)post({type:'notify',key:'',title:t('あなたの番が {n} 件',{n:a.arrived.length}),body:a.arrived.map(c=>c.title||short(c.project)).join(' / ').slice(0,200)});
  // Allow from the banner only when it shows the whole request: a truncated
  // command would be approved for what it did not show. Raw length, not collapsed.
  else for(const c of a.arrived)post({type:'notify',key:c.agent+':'+c.id,...notifyText(c),perm:c.permAsk&&!c.permAsk.questions&&!c.permAsk.partial&&String(c.permAsk.what||'').length<=120&&!c.permAsk.more?c.permAsk.id:''});
  {const asks=(s.cards||[]).filter(c=>c.column==='approval'&&!c.subagent&&!c.headless).map(c=>({key:c.agent+':'+c.id,title:(c.title||short(c.project)).slice(0,60)}));
    const sig=JSON.stringify(asks);if(sig!==asksSent){asksSent=sig;post({type:'asks',items:asks})}}
  for(const c of a.stuck.slice(0,3))post({type:'notify',key:c.agent+':'+c.id,title:'⚠ '+(c.title||short(c.project))+' · '+c.agent,body:stuckText(c).slice(0,200)});
  return a;
}
// A card's subject: its folder unless that is home, else the head of the title
// ("Rally改良" and "rally作業" are one subject).
function topicKey(c){
  const home=(live.home||'').replace(/\/$/,'');
  const proj=String(c.project||'').replace(/\/$/,'');
  if(proj&&proj!==home&&proj!=='/')return 'p:'+proj.split('/').pop().toLowerCase();
  const t=String(c.title||'').trim();
  const w=t.match(/^[A-Za-z][A-Za-z0-9_-]{2,}/);
  if(w)return 't:'+w[0].toLowerCase();
  if(t)return 't:'+[...t].slice(0,3).join('');
  return 'i:'+c.id;
}
// A card's hue is per session, not per folder (most share one). Fixed once
// picked; one of twelve, stepped away from the card drawn above.
const hues=new Map();
function hueHash(k){let h=2166136261;for(let i=0;i<k.length;i++){h^=k.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function hueGap(a,b){const d=Math.abs(a-b)%360;return Math.min(d,360-d)}
function autoHue(c,above){
  const k=c.agent+':'+c.id;
  if(hues.has(k))return hues.get(k);
  let h=(hueHash(k)%12)*30;
  // a 150° step visits every slot before repeating
  for(let i=0;i<12&&above!=null&&hueGap(h,above)<90;i++)h=(h+150)%360;
  hues.set(k,h);return h;
}
// First read: reopen the last panel, else the top card; a panel you closed stays closed.
var openedFirst=false;   // var: syncPanelBtns reads it before this line runs
function openFirst(){
  if(openedFirst)return;openedFirst=true;
  if(panelOpen()||pendingOpen||window.innerWidth<1011||window.__akSelftest)return;
  let last=null;try{last=localStorage.getItem('lastpanel')}catch(e){}
  if(last==='')return;
  if(last&&last.includes(':')){const c=(live.cards||[]).find(x=>x.agent+':'+x.id===last);
    if(c){const e=cardEls().find(x=>x.dataset.agent+':'+x.dataset.id===last);if(e)selectEl(e);openDetail(c,false,{focus:false});return}}
  else if(last&&last!=='new'&&PANEL_BTN[last]){const b=$(PANEL_BTN[last]);if(b){b.click();return}}   // 新規 was saved by older versions: never reopened
  const el=cardEls()[0];if(!el)return;
  const c=(live.cards||[]).find(x=>x.agent+':'+x.id===el.dataset.agent+':'+el.dataset.id);
  if(c){selectEl(el);openDetail(c,false,{focus:false})}
}
function applyState(s){etaSettle(s.cards);if(typeof laneOverlay==='function')laneOverlay(s.cards);live=s;gotState=true;seenBaseline(s.cards);seenSync();seenPrune();tellArrivals(s);
  wfTick(s);
  if(typeof ptyEndedSync==='function')ptyEndedSync(s.cards);
  if(typeof bgPopRefresh==='function')bgPopRefresh();
  // a held message waits while a terminal has the session: close a parked look-only one so it is delivered
  if(typeof ptys!=='undefined')for(const p of ptys.values())if(p.parked&&ptyLook(p)&&!p.gone&&!p.closing&&(s.cards||[]).some(c=>c.id===p.full&&c.queued))ptyClose(p.id);
  renderLimits(s.limits,s.limitsSetup);
  // output tokens since the last refresh, from the transcript's usage records
  for(const c of s.cards||[]){
    const n=(c.usage&&c.usage.outTok)||0;
    const was=outSeen.get(c.id);
    if(was!=null&&n>was)c.outDelta=n-was;
    outSeen.set(c.id,n);
  }
  $('#meta').title=(s.agents||[]).filter(a=>a.installed).map(a=>a.agent+' '+a.sessions).join(' · ')+' · '+t('直近{n}時間',{n:s.hours});
  wipOverlay(s.cards);
  {const pc=pendCounts(s.cards);$('#pendn').textContent=pc.items?String(pc.items):'–';
    $('#pendall').title=t('残作業: 棚卸し済みの{s}セッションに残っている{n}項目',{s:pc.withWork.length,n:pc.items})+(pc.unread.length?' · '+t('未棚卸し {n}件',{n:pc.unread.length}):'')+' (p)';
    // redraw only when readings changed: a redraw takes the button you are on
    if(panelOpen()&&panelKey==='pending'&&pendSig()!==pendShown&&!document.querySelector('#pscanall[data-armed]'))openPendingAll()}
  render();unreadPaint();loading=false;lastLoad=Date.now();openFirst();
  if(pendingOpen){
    const fresh=(s.cards||[]).find(x=>x.agent+':'+x.id===pendingOpen);
    // not if you have moved to another session since: the jump would take you away from what you are reading
    if(fresh){const from=pendingOpenFrom;pendingOpen=null;pendingOpenFrom=null;if(!from||from===panelKey||!panelOpen())openDetail(fresh,false,focusFree($('#detail'))?undefined:{focus:false})}
  }
  newArrived(s.cards);
  if(openFor&&openCard){
    const c2=(s.cards||[]).find(x=>x.agent+':'+x.id===openFor);
    // an unchanged panel is not redrawn
    if(c2){const sig=cardSig(c2);
      // Not while you type: replacing the box drops IME composition, undo and the skill list.
      if(sig!==openSig&&typingInPanel()){redrawLater=c2}
      else if(sig!==openSig){openSig=sig;redrawLater=null;openDetail(c2,true)}
      else{openCard=c2;const ml=document.querySelector('#mmeta .mline');if(ml&&c2.factLine)ml.textContent=c2.factLine}}
  }}
// ---- notifications allowed? ---------------------------------------------
// The app reports macOS's notification setting; the bar links to where to turn it on.
let notifyStatus='on';
function notifyBar(j){
  notifyStatus=(j&&j.status)||'on';
  const b=$('#notifybar');if(!b)return;
  let snooze=0;try{snooze=+localStorage.getItem('notifysnooze')||0}catch(e){}
  const off=notifyStatus!=='on';
  b.hidden=!off||Date.now()<snooze;if(window.hdrhSet)window.hdrhSet();
  if(!off)return;
  b.querySelector('.nb-t').textContent=notifyStatus==='ask'?t('🔔 macOS の通知がまだオンになっていません。オンにすると、あなたの番と許可待ちをバナーで知らせます')
    :notifyStatus==='silent'?t('🔕 通知は許可されていますが、バナーが出ない設定です(あなたの番・許可待ちに気づけません)')
    :t('🔕 通知がオフになっています。あなたの番・許可待ちが来ても知らせられません');
  const go=$('#notifygo');go.textContent=notifyStatus==='ask'?t('通知を許可する'):t('システム設定を開く');
  go.onclick=()=>{post({type:'notifyperm'});if(notifyStatus!=='ask')go.textContent=t('設定で Rally をオンにしてください')};
  $('#notifyx').onclick=()=>{b.hidden=true;if(window.hdrhSet)window.hdrhSet();try{localStorage.setItem('notifysnooze',String(Date.now()+7*864e5))}catch(e){}};
}
