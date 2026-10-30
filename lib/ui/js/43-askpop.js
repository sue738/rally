// A new permission prompt or question as a corner card, without taking focus, answerable from
// there. A partial request (cut by the hook) is not answerable here. Gone once answered anywhere.
const askPops=new Map();   // ask id → {el, key}
/** The terminal's "Do you want to proceed?", said of what the tool does. */
function askPopAsk(tool){return /^Bash$/.test(tool||'')?t('このコマンドを実行します。続けてもいいですか？'):/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool||'')?t('このファイルを変更します。続けてもいいですか？'):t('{tool} を使います。続けてもいいですか？',{tool:tool||t('この操作')})}
function askPopOK(a){return !!a&&!a.questions&&!a.partial}
function askPopBox(){return $('#askpops')}
function askPopId(c){const a=c&&c.permAsk;return a?a.id:(c&&c.column==='approval'?'col:'+c.agent+':'+c.id:null)}
// closed with × : not brought back for the same ask
const askPopShut=new Set();
// an open conversation shows the prompt itself; the terminal view does not
function askPopSeen(key){return panelOpen()&&!!openCard&&openCard.agent+':'+openCard.id===key&&(typeof panelView==='undefined'||panelView!=='term'||!$('#mterm'))}
function askPopShow(c){
  const a=c&&c.permAsk,id=askPopId(c);if(!id||askPops.has(id)||askPopShut.has(id))return;
  const key=c.agent+':'+c.id;
  if(askPopSeen(key))return;
  const el=document.createElement('div');el.className='askpop';el.dataset.ask=id;
  // without a permAsk (the terminal holds the prompt) the card only offers 開く
  const q=a&&a.questions;
  const what=a?(q?String(q[0].question||''):(a.tool||'')+(a.what?' '+String(a.what):'')):'';
  const choices=a&&askPopOK(a)?permChoices(c).filter(x=>x.d!=='automode'):[];
  // no hook held it: the choices read off its terminal, answered by typing the number there
  const dopts=!a&&typeof dlgPermOpts==='function'?(dlgPermOpts(c)||[]):[];
  const label=x=>x.d==='allow'?t('はい'):x.d==='deny'?t('いいえ'):x.d==='rule'?t('はい、今後は聞かない: {rule}',{rule:x.rule})
    :x.mode==='acceptEdits'?t('はい、このセッション中は編集を自動で許可'):x.rules?t('はい、今後は聞かない: {rule}',{rule:x.rules}):t('はい、今後は聞かない');
  el.innerHTML='<div class="aph"><b>'+(q?t('質問が来ています'):t('許可を待っています'))+'</b>'+(a&&a.more?'<span class="apm">'+t('ほかに {n} 件',{n:a.more})+'</span>':'')
    +'<button class="apopen" title="'+t('このセッションを開く')+'">'+t('開く')+'</button><button class="apx" title="'+t('閉じる(プロンプトはカードに残ります)')+'" aria-label="'+t('閉じる')+'">×</button></div>'
    +'<div class="apt">'+esc(c.title||short(c.project))+'</div>'+(a?'<pre class="apw">'+esc(what)+'</pre>':'')
    +(choices.length?'<div class="apq">'+esc(askPopAsk(a.tool))+'</div>':dopts.length?'<div class="apq">'+esc(askPopAsk((c.asking||{}).tool))+'</div>':'')
    +'<div class="apb">'+dopts.map(x=>'<button class="mini apdl'+(x.label===t('はい')?' apyes':x.label===t('いいえ')?' apno':'')+'" data-key="'+esc(x.n)+'" title="'+t('端末で {n} を押します: {raw}',{n:esc(x.n),raw:esc(x.raw)})+'">'+esc(x.label)+'</button>').join('')+choices.map((x,i)=>'<button class="mini apch'+(x.d==='allow'?' apyes':x.d==='deny'?' apno':'')+'" data-i="'+i+'" title="'+esc(label(x))+'">'+esc(label(x))+'</button>').join('')
    +(choices.length||dopts.length?'':'<span class="apn">'+(/^denied without a prompt/.test(c.reason||'')?t('画面なしの実行では許可を確認できずに止まりました。開いて「ここで許可して続ける」を押してください'):a&&a.partial?t('一部しか届いていないので、開いて確認してください'):q?t('開いて答えてください'):c.lastTool?t('{tool} の許可確認は端末に出ています。開いて答えてください',{tool:c.lastTool}):t('許可確認は端末に出ています。開いて答えてください'))+'</span>')+'</div>';
  const card=()=>(live.cards||[]).find(x=>x.agent+':'+x.id===key);
  el.querySelector('.apx').onclick=e=>{e.stopPropagation();askPopShut.add(id);askPopDrop(id)};
  el.querySelector('.apopen').onclick=e=>{e.stopPropagation();const x=card();if(x)openDetail(x);if(live)askPopSync(live)};
  for(const b of el.querySelectorAll('.apch'))b.onclick=e=>{e.stopPropagation();const x=card(),ch=choices[+b.dataset.i];
    askPopShut.add(id);askPopDrop(id);   // answered: not back before the refresh
    if(!x||!x.permAsk||x.permAsk.id!==id)return;
    if(ch.d==='rule')permAnswer(x,'rule',ch.rule);else permAnswer(x,ch.d)};
  for(const b of el.querySelectorAll('.apdl'))b.onclick=e=>{e.stopPropagation();const x=card();askPopShut.add(id);askPopDrop(id);if(x)dlgPress(x,b.dataset.key)};
  el.dataset.dl=dopts.length?'1':'';
  askPopBox().appendChild(el);askPops.set(id,{el,key,bare:!choices.length&&!dopts.length});
}
function askPopDrop(id){const p=askPops.get(id);if(!p)return;askPops.delete(id);p.el.remove()}
// each refresh: drop answered or on-screen prompts, (re)show waiting ones nothing else shows
function askPopSync(s){
  const cs=(s.cards||[]).filter(c=>askPopId(c)&&!c.subagent&&!c.headless);
  const live_=new Map(cs.map(c=>[askPopId(c),c.agent+':'+c.id]));
  for(const [id,p] of [...askPops])if(!live_.has(id)||askPopSeen(p.key))askPopDrop(id);
  for(const id of [...askPopShut])if(!live_.has(id))askPopShut.delete(id);
  // a card shown without buttons gets them once its terminal has been read
  for(const c of cs){const id=askPopId(c),p=askPops.get(id);if(p&&p.bare&&!c.permAsk&&typeof dlgPermOpts==='function'&&dlgPermOpts(c))askPopDrop(id);askPopShow(c)}
}
