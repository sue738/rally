const $=(s,r=document)=>r.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let live={cards:[],agents:[]};
// Whether a late finisher (a command, a send) may take focus: only from <body> or from inside `el`.
function focusFree(el){const a=document.activeElement;return !a||a===document.body||a===document.documentElement||!!(el&&el.contains(a))}
// How much of a conversation to show: all / the last three exchanges open / the last one open (earlier instructions stay, their replies fold).
let viewMode='all';
try{
  const v=localStorage.getItem('histview');
  if(v==='last'||v==='last3'||v==='all')viewMode=v;   // an older 指示だけ is all now: it hid the latest answer, and that confused
}catch(e){}
function applyTheme(light){
  document.body.classList.toggle('light',light);
  try{localStorage.setItem('theme',light?'light':'dark')}catch(e){}
  const b=$('#theme');if(b)b.textContent=light?'☾':'☀';
}
(function(){
  let pref=null;try{pref=localStorage.getItem('theme')}catch(e){}
  const light=pref?pref==='light':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches);
  applyTheme(!!light);
  const b=$('#theme');if(b)b.onclick=()=>applyTheme(!document.body.classList.contains('light'));
// transitions only once the first theme is in, so the page does not fade from dark to light on open
  setTimeout(()=>document.body.classList.remove('preload'),400);
})();
function applyDone(){
  const on=$('#showdone').classList.contains('on');
  document.body.classList.toggle('hidedone',!on);
  try{localStorage.setItem('showdone',on?'1':'0')}catch(e){}
}
// what a session would cost on the API (lib/price.js); "$?" when none of its models has a known rate
function usdText(u){
  const v=+u.usd||0;
  if(!v&&u.unpriced)return '$?';
  const t=v<0.01?'<$0.01':'$'+(v<10?v.toFixed(2):v<100?v.toFixed(1):Math.round(v));
  return t+(u.unpriced?'+':'');
}
function totalTitle(u){
  const cr=Object.values(u.by||{}).reduce((n,t)=>n+(t.cr||0),0);
  return 'トークンの合計(このセッションの全リクエスト) '+tok((u.inTok||0)+(u.outTok||0))
    +'\n入力 '+tok(u.inTok||0)+(cr?'(うちキャッシュ読み '+tok(cr)+' — 毎回読み直す文脈)':'')+'\n出力 '+tok(u.outTok||0)+(u.think?'(うち思考 '+tok(u.think)+')':'')
    +(u.turns?'\n'+u.turns+' 往復':'')+'\nサブエージェントの分は含みません';
}
function usdTitle(u){
  const by=u.by||{},lines=Object.entries(by).map(([m,t])=>m.replace(/^claude-/,'')+': 入力 '+tok(t.i)+' / 出力 '+tok(t.o)+' / キャッシュ読み '+tok(t.cr)+' / 書き '+tok((t.cw5||0)+(t.cw1||0)));
  return 'API 料金に換算した額(サブスクリプションでは請求されません。規模の目安です)\n'+lines.join('\n')
    +(u.unpriced?'\n単価を確かめていないモデルは含みません: '+u.unpriced.join(', '):'')+'\nサブエージェントの分は含みません';
}
function tok(n){
  n=+n||0;
  if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1)+'M';
  if(n>=1e3)return Math.round(n/1e3)+'k';
  return String(n);
}
/** A time of day for something that happened: 14:05 today, 9/29 14:05 before today (the year too from another year). */
function clock(ms,now=Date.now()){
  const d=new Date(ms),n=new Date(now),hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(d.toDateString()===n.toDateString())return hm;
  return (d.getFullYear()!==n.getFullYear()?d.getFullYear()+'/':'')+(d.getMonth()+1)+'/'+d.getDate()+' '+hm;
}
function ago(s){if(s<60)return s+'秒';if(s<3600)return Math.round(s/60)+'分';if(s<86400)return (s/3600).toFixed(1)+'時間';return Math.round(s/86400)+'日'}
// the folder's name; the home folder as ~
function short(p){const h=((typeof live!=='undefined'&&live&&live.home)||'').replace(/\/$/,'');if(h&&String(p||'').replace(/\/$/,'')===h)return '~';const b=String(p||'').split('/').filter(Boolean).pop();return b||p||''}
const COL_JA={working:'Working',approval:'Your Turn · 許可','needs-you':'Your Turn',answered:'Your Turn · 返答',stale:'Waiting',done:'Completed',idle:'Completed'};
// '' for reasons that only restate the column header
function reasonJa(c){
  const r=c.reason||'';
  const sr=r.match(/^subagents running \((\d+)\)$/);if(sr)return 'サブエージェント実行中 '+sr[1];
  const dn=r.match(/^denied without a prompt: (.+)$/);if(dn)return '許可待ちで停止: '+esc(dn[1])+'(パネルで続けられます)';
  if(r==='the process is busy (claude agents)')return '実行中(プロセスの状態)';
  const wa=r.match(/^waiting for (.+) after 完了 \(claude agents\)$/);if(wa)return '完了にした後、'+esc(wa[1]==='permission prompt'?'許可の確認':'入力')+'で止まっています';
  if(r==='waiting for your reply (claude agents)')return '返事待ち';
  if(r==='waiting for dialog open (claude agents)')return '端末でダイアログが開いたまま';
  if(r==='running a tool (no permission was asked)')return 'ツールを実行中';
  if(r==='waiting for input needed (claude agents)')return '端末で質問が開いたまま';
  const wf=r.match(/^waiting for (.+) \(claude agents\)$/);if(wf)return '待機中: '+esc(wf[1]==='permission prompt'?'許可の確認':wf[1]);
  if(c.column==='working')return c.lastTool?esc(c.lastTool):'';
  if(/^asked you a question/.test(r))return '質問: '+esc((c.pending||[]).join(', '));
  if(/^waiting for permission/.test(r))return '許可待ち: '+esc((c.pending||[]).join(', '));
  if(r==='the agent replied and is waiting for you')return '';
  if(r==='the agent finished its turn')return '';
  if(r==='you spoke last but nothing followed — the run may have died')return 'あなたが話しかけた後、応答がありません(停止した可能性)';
  const q=r.match(/^quiet for (\d+)h$/);if(q)return q[1]+'時間、動きがありません';
  if(r==='batch run (started with others in the same second)')return 'スクリプトが一括起動したセッションです(自動実行)';
  if(r==='subagent, finished')return 'サブエージェントとして起動し、終了しました';
  if(r==='subagent at work (a tool call is still running)')return 'サブエージェント: ツールの実行を待っています';
  if(r==='headless run, finished')return '自動実行(ヘッドレス)として起動し、終了しました';
  if(r==='you exited it (/exit)')return '/exit で終了しました';
  if(r==='imported by Codex Desktop (no work of its own)')return 'Codex Desktop が取り込んだ記録です(作業はしていません)';
  if(r==='you interrupted it (turn aborted)')return '途中で止めました';
  if(r==='answered (one-shot)')return '一問一答で完結しました';
  if(r==='no dialogue yet')return 'まだ何も始まっていません';
  if(r==='the agent asked you something and stopped')return 'あなたへの質問で止まっています';
  if(r==='the agent finished its turn (claude agents: idle)')return '';
  if(r==='a notification came in after its turn; nothing followed')return 'ターンの後に通知が届き、応答はまだありません';
  if(r==='wrote within the last minute')return '';
  const ab=r.match(/^abandoned after (\d+)h$/);if(ab)return ab[1]+'時間、動きがありません';
  const cp=r.match(/^an unused copy of ([0-9a-f]{8})$/);if(cp)return '使われなかったコピーです(元: '+cp[1]+')';
  if(/^a copy a send forked \(stopped by the board\)/.test(r))return '送信で分かれたコピーです(ボードが止めました)';
  return esc(r);
}
// Turn over but background shells/agents still run (lib/live.js): the card stays Your Turn and says so.
function bgNote(c){
  const b=c&&c.background;if(!b||c.column==='working')return '';
  const parts=[];if(b.shells)parts.push('シェル '+b.shells);if(b.agents)parts.push('サブエージェント '+b.agents);
  const tip='ターンは終わっています。裏でバックグラウンドのタスクが動いています'+(parts.length?'('+parts.join('、')+')':'');
  const l=c.bgTasks||[];const st=l.filter(t=>t.stale).length;
  if(l.length)return '<button class="bgrun bgopen'+(st?' stale':'')+'" data-agent="'+esc(c.agent)+'" data-id="'+esc(c.id)+'" title="'+esc(tip+(st?'。止まらず回っている待ちループが '+st+' 件あります':'')+' — クリックで一覧(止める)')+'">裏で実行中 '+(b.n||l.length)+(st?' ⟳':'')+'</button>';
  return '<span class="bgrun" title="'+esc(tip)+'">裏で実行中'+(b.n?' '+b.n:'')+'</span>';
}
// what the board stopped on its own (lib/bgtasks.js reap)
function bgReapedText(c){const r=c&&c.bgReaped;if(!r||!r.length)return '';return '止まらず回っていた裏の処理を止めました: '+r.map(x=>x.cmd).join(' / ')}
// Optional card fields, toggled from the header (69-list.js); stored in localStorage 'cardshow'.
const CARD_FIELDS=[
  ['proj','プロジェクト',true],['agent','エージェント(claude 以外)',true],['model','モデル(いつもと違うとき)',true],
  ['tokens','トークン合計',false],['usd','API 換算の額',true],['ctx','文脈の大きさ(大きくなくても)',false],
  ['last','最後の発言',true],['idle','最後に動いてからの時間',true],
  ['turns','やり取りの回数',false],['tools','ツールを使った回数',false],['age','始めてからの時間',false],['worked','実際に動いた時間の合計',false],
  ['perm','許可のモード(いつもと違うとき)',false],['where','動いている場所(裏 / 端末)',false],['goal','/goal の目標(あるとき)',true]];
let cardShow={};try{const o=JSON.parse(localStorage.getItem('cardshow')||'{}');if(o&&typeof o==='object')cardShow=o}catch(e){}
function cshow(k){if(k in cardShow)return !!cardShow[k];const f=CARD_FIELDS.find(x=>x[0]===k);return !!(f&&f[2])}
function setCardShow(k,on){cardShow[k]=!!on;try{localStorage.setItem('cardshow',JSON.stringify(cardShow))}catch(e){}if(typeof render==='function'&&typeof live!=='undefined'&&live)render()}
// The badge-shaped fields of CARD_FIELDS (proj/agent/model sit in their own line, last/idle are not badges):
// their left-to-right order, draggable in カード項目 (69-list.js). Stored in localStorage 'cardorder'.
const CHIP_FIELDS=['tokens','usd','ctx','turns','tools','worked','age','perm','where','goal'];
let cardOrder=CHIP_FIELDS.slice();
try{const o=JSON.parse(localStorage.getItem('cardorder')||'null');if(Array.isArray(o))cardOrder=o}catch(e){}
/** cardOrder, kept to exactly the known fields (a stale key dropped, a new one added at the end). */
function chipOrder(){
  const seen=new Set(),out=[];
  for(const k of cardOrder)if(CHIP_FIELDS.includes(k)&&!seen.has(k)){seen.add(k);out.push(k)}
  for(const k of CHIP_FIELDS)if(!seen.has(k)){seen.add(k);out.push(k)}
  return out;
}
function setCardOrder(order){
  cardOrder=order.filter(k=>CHIP_FIELDS.includes(k));
  try{localStorage.setItem('cardorder',JSON.stringify(cardOrder))}catch(e){}
  if(typeof render==='function'&&typeof live!=='undefined'&&live)render();
}
/** The /goal chip's tooltip: the whole condition, how many checks it has had, what the evaluator last said. */
function goalTitle(g){return '/goal: '+g.text+(g.met?'\n達成しました':'\n'+(g.n?g.n+' 回判定済み':'まだ判定されていません'))+(g.reason?'\n判定の理由: '+g.reason:'')}
// One builder per badge; '' when it has nothing to show (off, or the card has nothing for it).
const CHIP_BUILD={
  tokens:c=>{const u=c.usage;return u&&u.inTok&&cshow('tokens')?'<span class="ctok" title="'+esc(totalTitle(u))+'">Σ'+tok((u.inTok||0)+(u.outTok||0))+'</span>':''},
  usd:c=>{const u=c.usage;return u&&u.inTok&&cshow('usd')&&u.usd>0?'<span class="cusd" title="'+esc(usdTitle(u))+'">'+esc(usdText(u))+'</span>':''},
  ctx:c=>cshow('ctx')&&c.usage&&c.usage.ctx?'<span class="cctx" title="このセッションが今送っている文脈の大きさ(直近のリクエスト)">'+tok(c.usage.ctx)+'</span>':'',
  turns:c=>cshow('turns')&&c.humanTurns?'<span class="cxt" title="あなたの指示の回数">'+esc(c.humanTurns+'往復')+'</span>':'',
  tools:c=>cshow('tools')&&c.toolCalls?'<span class="cxt" title="このセッションがツールを使った回数">'+esc('ツール '+c.toolCalls)+'</span>':'',
  worked:c=>cshow('worked')&&c.activeMs>=60000?'<span class="cxt" title="実際に動いていた時間の合計(60秒以上の沈黙は数えない)">'+esc('稼働 '+etaSpan(c.activeMs))+'</span>':'',
  age:c=>cshow('age')&&c.firstT?'<span class="cxt" title="最初の発言からの時間">'+esc(ago(Math.round((Date.now()-c.firstT)/1000))+'前から')+'</span>':'',
  perm:c=>cshow('perm')&&c.permMode&&c.permMode!=='default'?'<span class="cxt" title="許可のモード: '+esc(c.permMode)+'">'+esc(PERM_JA[c.permMode]||c.permMode)+'</span>':'',
  goal:c=>{const g=c.usage&&c.usage.goal;return g&&g.text&&cshow('goal')?'<span class="cgoal'+(g.met?' met':'')+'" title="'+esc(goalTitle(g))+'">'+esc('◎ '+(g.met?'達成 ':'')+(g.text.length>18?g.text.slice(0,18)+'…':g.text))+'</span>':''},
  where:c=>cshow('where')&&c.alive?'<span class="cxt" title="このセッションが動いている場所">'+(c.aliveKind==='background'?'裏で実行':'端末で実行')+'</span>':'',
};
/** The badges in their chosen order. `extra`: a key→html override for a field a view draws its own way (ctx: the full card's warn/bad classes). */
function orderedChips(c,extra){
  const out=[];
  for(const k of chipOrder()){
    const h=(extra&&k in extra)?extra[k]:CHIP_BUILD[k](c);
    if(h)out.push(h);
  }
  return out;
}
function moreChips(c){return chipOrder().filter(k=>k!=='tokens'&&k!=='usd'&&k!=='ctx').map(k=>CHIP_BUILD[k](c)).filter(Boolean)}
// ---- 完了までの目安 (lib/eta.js): a time to count down to; a new estimate replaces it only when it differs enough
const ETA_BASIS={session:'このセッションの過去%n回の所要時間から(新しいものと、ここまでのツールの使い方が似たものを重く見ています)',project:'同じフォルダの過去%n回の所要時間から(新しいものを重く見ています)',all:'全セッションの過去%n回の所要時間から(新しいものを重く見ています)',prior:'過去の記録が少ないので標準の見積もり'};
function etaSpan(ms){const m=Math.max(1,Math.round(ms/60000));return m<60?m+'分':Math.floor(m/60)+'時間'+(m%60?String(m%60)+'分':'')}
/** Minutes, not seconds: the guess is good to about a factor of two, so a second hand would only pretend. */
/** "2〜13分" when the usual range is wide (the top at least three times the bottom): one number would claim more than is known; else ''. */
function etaRangeText(lo,hi){
  if(!(lo>0&&hi>0)||hi<3*Math.max(lo,60000)||hi<5*60000)return '';
  const a=Math.max(1,Math.round(lo/60000)),b=hi<3600000?Math.round(hi/300000)*5||5:0;
  return b?(a<b?a+'〜'+b+'分':b+'分'):'';
}
function etaLabel(e){
  const s=Math.round((e.at-Date.now())/1000);
  if(s<=30)return '⏱ まもなく';
  {const rg=e.over?'':etaRangeText(e.lo&&e.lo-Date.now(),e.hi&&e.hi-Date.now());if(rg)return '⏱ あと約'+rg}
  const m=Math.ceil(s/60),r=Math.round(m/5)*5;
  const t=m<60?m+'分':Math.floor(r/60)+'時間'+(r%60?String(r%60).padStart(2,'0')+'分':'');
  return '⏱ '+(e.over?'長引いています · ':'')+'あと約'+t;
}
/** How long a message held for a session is expected to take once it starts (lib/eta.js heldEst): a length, not a countdown. */
function etaTaskChip(h){
  if(!h)return '';
  const now=Date.now();
  const why='この作業にかかりそうな時間の想定: 約'+etaSpan(h.ms)+'(たいていは '+etaSpan(h.lo)+' 〜 '+etaSpan(h.hi)+')\n'
    +(ETA_BASIS[h.basis]||'').replace('%n',h.n)+'\n依頼の内容の難しさは測れないので、過去のやり取りの長さから出しています。当たりにくい目安です';
  const rg=etaRangeText(h.lo,h.hi);
  return '<span class="eta task" title="'+esc(why)+'">⏱ 想定 '+(rg||'約'+etaSpan(h.ms))+'</span>';
}
function etaChip(c){
  const e=c&&c.eta;if(!e)return '';
  const now=Date.now(),range=e.lo&&e.hi?'たいていは '+etaSpan(e.lo-now)+' 〜 '+etaSpan(e.hi-now)+'(過去の実績では、半分ほどがこの範囲でした)':'';
  const why=range+(range?'\n':'')+(ETA_BASIS[e.basis]||'').replace('%n',e.n)+(e.over?'。これまでで一番長く、終わりの見当がつきません':'')
    +'\n当たりにくい見積もりです: 過去60日の検証で、実際の半分〜2倍に収まったのは3.5割ほど、3分の1〜3倍で5割ほど\n進み具合で見積もりは変わります';
  return '<span class="eta'+(e.over?' over':'')+'" data-at="'+e.at+'" data-over="'+(e.over?1:0)+'" title="'+esc('完了までの目安\n'+why)+'">'+esc(etaLabel(e))+'</span>';
}
const etaShown=new Map();
/** A new estimate within a quarter (at least 30 s) of the one on screen keeps the shown time: the number does not wobble at every refresh. */
function etaSettle(cards){
  const now=Date.now(),seen=new Set();
  for(const c of cards||[]){
    const k=c.agent+':'+c.id;if(!c.eta)continue;seen.add(k);
    const p=etaShown.get(k);
    // lo/hi are pinned along with at: left to refresh on their own they shrink every few seconds and can flip
    // "the usual range is wide" on and off with nothing really changing (あと約3〜20分 ⇄ あと約12分)
    if(p&&p.over===c.eta.over&&Math.abs(c.eta.at-p.at)<Math.max(30000,.25*Math.max(p.at-now,0))){c.eta.at=p.at;c.eta.lo=p.lo;c.eta.hi=p.hi}
    else etaShown.set(k,{at:c.eta.at,over:c.eta.over,lo:c.eta.lo,hi:c.eta.hi});
  }
  for(const k of [...etaShown.keys()])if(!seen.has(k))etaShown.delete(k);
}
const PERM_JA={acceptEdits:'編集は自動',auto:'auto',plan:'計画',bypassPermissions:'許可なし'};
function lastLine(c){
  if(!c.last)return '';
  const t=c.last.assistant||c.last.human;
  if(!t)return '';
  return '<div class="last'+(c.last.assistant?'':' mine')+'" title="'+esc(t)+'">'+(c.last.assistant?'':'<b>あなた:</b> ')+esc(t)+'</div>';
}
/** The CLI's default model, or the board's most common one: not worth a word on each card. */
function usualModel(c){
  const d=((live.defaults||{})[c.agent])||'';
  if(d&&(c.model===d||String(c.model).startsWith(d)))return true;
  const n={};for(const x of live.cards||[])if(x.agent===c.agent&&x.model)n[x.model]=(n[x.model]||0)+1;
  const top=Object.keys(n).sort((a,b)=>n[b]-n[a])[0];
  return !d&&c.model===top;
}
const WHY_SHORT={'you spoke last but nothing followed — the run may have died':'応答なし(止まった?)'};
function shortWhy(c,full){const s=WHY_SHORT[c.reason||''];return s?esc(s):full}
// Cards with the same title are told apart by folder, fork, or id prefix (dupTitles, set in render).
let dupTitles=new Map();
function dupTag(c){
  const t=c.title||short(c.project),same=dupTitles.get(t);
  if(!same||same.length<2)return '';
  const tag=c.forkOf?'複製':(new Set(same.map(x=>x.project)).size>1?short(c.project):'#'+c.id.slice(0,4));
  return ' <span class="dup">'+esc(tag)+'</span>';
}
// c.title / c.waiting / c.icon come from lib/enrich.js and appear on a later refresh.
function ico(c){return c&&c.icon?'<span class="ico" aria-hidden="true">'+esc(c.icon)+'</span>':''}
// `claude --resume <id>` is not offered while the session is alive: resuming a live one forks a
// second process that replays the transcript (see dispatch.js buildCommand, alive.js).
function resumeCell(c,opts){
  opts=opts||{};
  const idShort=esc(c.id.slice(0,opts.idLen||18));
  if(!c.resume)return{html:'<code>'+idShort+'</code>',copy:null};
  if(c.alive)return{html:'<code class="locked" title="動いているセッションです。resume すると別コピーができるので、ここではコピーできません">'+idShort+'</code>',copy:null};
  const hint=opts.enterHint===false?'クリックでコピー':'クリック / Enter でコピー';
  return{html:'<code title="'+hint+'">'+esc(c.resume)+'</code>',copy:c.resume};
}
// Which panel is showing ('claude:<id>', 'new', …). #mbody is shared by every card, so an answer
// to a send checks this before touching the draft or the box.
let panelKey='';
const kidsOpen=new Set();              // sessions whose subagent list you opened
let pendOpenKey='';                    // the session whose 残作業 is open right now (kept across a redraw)
/**
 * Drafts survive switching cards, redraws, failed sends, reloads and crashes. One localStorage
 * store keyed by what the box writes to ('agent:id', 'new', 'title:agent:id', 'ask:<id>',
 * 'dnote:agent:id'), capped at DRAFT_MAX entries of DRAFT_CHARS each.
 * A send empties the box but keeps its text in `sent` (per send token) until answered: dropped on
 * success, restored on failure, restored with a warning if never answered.
 */
const DRAFT_STORE='drafts',DRAFT_MAX=50,DRAFT_CHARS=20000;
function draftAll(){try{const o=JSON.parse(localStorage.getItem(DRAFT_STORE)||'{}');return o&&typeof o==='object'&&!Array.isArray(o)?o:{}}catch(e){return {}}}
function draftWrite(o){
  const ks=Object.keys(o).sort((a,b)=>(o[b].at||0)-(o[a].at||0));
  for(const k of ks.splice(DRAFT_MAX))delete o[k];
  for(;;){try{localStorage.setItem(DRAFT_STORE,JSON.stringify(o));return true}catch(e){if(ks.length<2)return false;delete o[ks.pop()]}}
}
// a strictly increasing stamp: several drafts written in one ms must not tie in the oldest-first sort
function draftNow(o){let m=0;for(const k in o)m=Math.max(m,(o[k]&&o[k].at)||0);return Math.max(Date.now(),m+1)}
function draftGet(key){return (key&&draftAll()[key])||null}
function draftEmpty(d){return !d||!String(d.t||'').trim()&&!d.ref&&!(d.files||[]).length}
function draftSents(cur){return !cur||!cur.sent?[]:Array.isArray(cur.sent)?cur.sent.filter(Boolean):[cur.sent]}
// tokens of words being typed into a terminal (03-panel.js), in flight like a dispatch
const draftTyping=new Set();
// the box still showing what is in flight is not a new draft
function draftSame(a,b){return !!a&&!!b&&String(a.t||'').trim()===String(b.t||'').trim()&&JSON.stringify(a.files||[])===JSON.stringify(b.files||[])}
function draftPart(d){const e={t:String((d&&d.t)||'').slice(0,DRAFT_CHARS)};if(d&&d.ref)e.ref=d.ref;if(d&&d.files&&d.files.length)e.files=d.files.slice(0,20);if(d&&d.o)e.o=d.o;return e}
function draftSet(key,d,failed){
  if(!key)return;
  const o=draftAll(),cur=o[key],e=draftPart(d);e.at=draftNow(o);
  if(failed)e.failed=1;
  const ss=draftSents(cur);
  if(ss.length){e.sent=ss;if(ss.some(x=>draftSame(e,x))){e.t='';delete e.ref;delete e.files}}
  if(draftEmpty(e)&&!e.sent){if(!cur)return;delete o[key]}
  else o[key]=e;
  draftWrite(o);
}
function draftSending(key,token,d){
  if(!key)return;
  const o=draftAll(),s=draftPart(d);s.s=token;
  o[key]={t:'',at:draftNow(o),sent:[...draftSents(o[key]),s]};draftWrite(o);
}
// put a send (`s`) back in front of what was written since; other sends stay
function draftMerge(cur,s){
  const t=String(cur.t||'').trim()?s.t+'\n\n'+cur.t:s.t;
  const e={t,at:Date.now()};const ref=cur.ref||s.ref,files=[...(s.files||[]),...(cur.files||[])],oo=cur.o||s.o;
  if(ref)e.ref=ref;if(files.length)e.files=files;if(oo)e.o=oo;
  const rest=draftSents(cur).filter(x=>x!==s);if(rest.length)e.sent=rest;return e;
}
function draftSettle(key,token,ok){
  const o=draftAll(),cur=o[key],ss=draftSents(cur),s=ss.find(x=>x.s===token);
  if(!s)return cur||null;
  if(ok){const rest=ss.filter(x=>x!==s);if(rest.length)cur.sent=rest;else delete cur.sent;if(draftEmpty(cur)&&!cur.sent)delete o[key]}
  else{o[key]=draftMerge(cur,s);o[key].failed=1}
  draftWrite(o);return o[key]||null;
}
// A draft for a box just drawn, with why ('failed', 'unsure' if never answered, '').
// A send still in flight is not restored: it would go twice.
function draftTake(key){
  const o=draftAll(),cur=o[key];if(!cur)return null;
  let e=cur,why=cur.failed?'failed':'';
  const ss=draftSents(cur);
  if(ss.length){
    const going=x=>draftTyping.has(x.s)||(typeof pendingToasts!=='undefined'&&pendingToasts.has(x.s));
    for(const x of ss.filter(x=>!going(x)).reverse()){e=draftMerge(e,x);why='unsure'}
    o[key]=e;const {sent,...rest}=e;e=rest;e.t=e.t||'';
  }else if(cur.failed){delete cur.failed}
  draftWrite(o);
  return draftEmpty(e)?null:{e,why};
}
function draftBox(key){return key==='new'?$('#ntext'):key&&key.includes(':')?$('#mbody .msg textarea'):null}
function draftCapture(key){
  const b=draftBox(key),mb=$('#mbody');if(!b)return null;
  const d={t:b.value||'',files:mb&&typeof attachPaths==='function'?attachPaths(mb):[]};
  if(key==='new'){if(typeof newOpts==='function')d.o=newOpts()}
  else if(typeof replyRefs!=='undefined'&&replyRefs.get(key))d.ref=replyRefs.get(key);
  return d;
}
function keepUnsent(){const k=panelKey,d=draftCapture(k);if(d)draftSet(k,d)}
function draftWatch(ta,key){
  if(!ta||!ta.addEventListener)return;let t=0;
  const save=()=>{clearTimeout(t);if(panelKey===key&&draftBox(key)===ta)keepUnsent()};
  ta.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(save,300)});
  ta.addEventListener('blur',save);
}
function draftShow(key,mb,box,e){
  box.value=e.t||'';
  if(key!=='new'&&e.ref&&typeof replyRefs!=='undefined'&&!replyRefs.has(key)){replyRefs.set(key,e.ref);replyChip()}
  if(e.files&&e.files.length&&mb&&typeof attachRestore==='function'&&!attachPaths(mb).length)attachRestore(mb,e.files);
  box.dispatchEvent(new Event('input'));
}
// save the box on reload, close, or going to the background
{const flush=()=>{try{keepUnsent();if(typeof termLineSaveAll==='function')termLineSaveAll()}catch(e){}};
  window.addEventListener('beforeunload',flush);window.addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flush()})}
// what this board last sent to each session, and how: ⌘C takes back only that
const lastSends=new Map();
// ⌘C / ⌃C: withdraw a held message, or stop a background claude session working on it
// (the conversation is kept). An interactive session has to be stopped in its terminal.
function cancelSend(c){
  if(!c)return;
  const box=$('#mbody'),key=c.agent+':'+c.id;
  const ls=lastSends.get(key);const recent=ls&&Date.now()-ls.at<30*60000;
  const cancelQueue=()=>{const q=$('#qcancel');if(q)q.click();else{post({type:'queue',agent:c.agent,session:c.id,cancel:true});c.queued=null;toast(box,'送信待ちを取り消しました');setTimeout(load,800)}lastSends.delete(key)};
  if(c.queued||(recent&&ls.how==='queued')){cancelQueue();return}
  if(!recent){toast(box,'このボードから最近送ったものはありません');return}
  if(ls.how==='relayed'||(c.alive&&c.aliveKind==='interactive')){toast(box,'端末で開いているセッションへ直接届けたので、ここからは止められません。端末で Esc を押してください(T で端末へ)');return}
  if(c.agent!=='claude'){toast(box,'止められるのは claude のバックグラウンドセッションだけです');return}
  if(!native){toast(box,'止めるのはアプリの中でだけできます');return}
  post({type:'stop',agent:c.agent,session:c.id});lastSends.delete(key);toast(box,'■ 送ったものの作業を止めています…(会話は残ります)');setTimeout(load,1500);
}
// Model id → {fam, ver}. An alias (opus/sonnet/haiku) takes the newest version seen on this
// machine, so there is no version table to keep up to date.
function modelVer(id){
  const m=String(id||'').match(/claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)||String(id||'').match(/claude-(\d+)-(\d+)-(opus|sonnet|haiku)/);
  if(!m)return null;
  return /^\d/.test(m[1])?{fam:m[3],ver:m[1]+'.'+m[2]}:{fam:m[1],ver:m[2]+(m[3]?'.'+m[3]:'')};
}
function famVersions(){
  const out={};
// newest seen, not most recent: a pinned older id written last would mislabel the alias
  const n=v=>v.split('.').map(Number),gt=(a,b)=>{const x=n(a),y=n(b);return x[0]!==y[0]?x[0]>y[0]:(x[1]||0)>(y[1]||0)};
  for(const c of (live.cards||[])){const v=modelVer(c.modelId);if(v&&(!out[v.fam]||gt(v.ver,out[v.fam])))out[v.fam]=v.ver}
  return out;
}
/** The thinking depth a session gets when none is picked: the CLI's setting for that model (claude modelSettings), else its general one. */
function effortDefault(agent,model){
  const e=(typeof live!=='undefined'&&live&&live.efforts)||{};
  if(agent!=='claude')return e[agent]||'';
  const by=e.claudeModels||{},keys=Object.keys(by),m=String(model||'').replace(/\[.*$/,'');
  const k=m&&(keys.find(x=>x===m)||keys.find(x=>x.startsWith(m)||m.startsWith(x))||(/^(opus|sonnet|haiku|fable)$/.test(m)?keys.find(x=>x.includes('-'+m+'-')):''));
  return (k&&by[k])||e.claude||(!m&&keys.length===1?by[keys[0]]:'')||''}
function modelLabel(short,id){const v=modelVer(id);const fv=famVersions();return short?(short+((v&&v.ver)||fv[short]?' '+((v&&v.ver)||fv[short]):'')):''}
// a session the board can hold a conversation with and send to
function convAgent(c){return !!c&&(c.agent==='claude'||c.agent==='codex'||c.agent==='antigravity')}
function canPty(c){return native&&!!window.Terminal&&c.agent==='claude'&&!c.subagent&&(!c.alive||c.aliveKind==='background')}
function canGoTerm(c){return native&&c.agent==='claude'&&!c.subagent&&c.alive&&c.aliveKind==='interactive'}
function goTerm(c){if(!c||!canGoTerm(c))return;post({type:'focusterm',agent:c.agent,session:c.id,cwd:c.project||''})}
