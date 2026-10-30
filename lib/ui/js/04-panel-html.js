// The session panel's markup (openDetail in 03-panel.js assembles and wires it). HTML only.
// what a redraw (openDetail keep) puts back as it was
function detailPrev(h0){
  return {
    text:($('#mbody .msg textarea')||{}).value||'',
// the panel's terminal had the keys: they go back to it, not to the (hidden) message box
    focus:(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm'))?'__term':(document.activeElement||{}).id||((document.activeElement||{}).tagName==='TEXTAREA'?'__msg':''),
    caret:(document.activeElement||{}).selectionStart,
    hist:h0?h0.innerHTML:'',
    vsig:h0?h0.dataset.vsig:undefined,          // what that html was drawn from: without it the thread is never compared with the state again (histReconcile)
    scroll:h0?h0.scrollTop:0,
    toast:($('#mbody .toast')||{}).textContent||'',
    attsNode:$('#mbody .atts'),
  };
}
function detailMetaHtml(c,sendable,rc,parent){
  const rJa=reasonJa(c);
// Only what the conversation below does not already say, in two dim lines; the rest is a hover away.
  const plain=h=>String(h||'').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  const facts=[(COL_JA[c.column]||c.column)+(rJa?' · '+plain(rJa):''),
    c.project||'',
    (c.firstT?ago(Math.round((Date.now()-c.firstT)/1000))+'前から':''),
    'ツール'+(c.toolCalls||0)+'回',
    c.model||'',
// 入力 includes the cached context read again each turn: a size, not a bill
    c.usage&&c.usage.inTok?('入力 '+tok(c.usage.inTok)+' / 出力 '+tok(c.usage.outTok||0)+(c.usage.turns?' · '+c.usage.turns+'往復':'')+(c.usage.usd!=null?' · API 換算 '+usdText(c.usage):'')):'',
    c.aliveName?('起動中: '+c.aliveName):'',
    c.id].filter(Boolean);
  c.factLine=facts.join(' · ');
  const ctx=c.usage&&c.usage.ctx||0;
// same thresholds as the status bar
  const ctxCls=ctx>=900000?'bad':ctx>=400000?'warn':'';
  const ctxWin=ctxWindow(c,ctx),ctxPct=ctxWin?Math.min(100,Math.round(ctx/ctxWin*100)):0;
  let meta='<div class="mstat" title="'+esc(c.factLine)+'">'
    +'<span class="lane c-'+esc(c.column)+'" title="レーン(カードのいる列)">'+esc(COL_JA[c.column]||c.column)+'</span>'
    +(rJa?'<span class="mi why" title="状態 — このレーンにいる理由"><span class="sdot c-'+esc(c.column)+'" aria-hidden="true"></span>'+rJa+'</span>':'')
    +'<span class="mi dim mproj" title="プロジェクト(作業フォルダ): '+esc(c.project||'不明')+'">'+MSTAT_ICON.folder+'<span>'+esc(short(c.project||'')||'(不明)')+'</span></span>'
    +'<span class="mi dim mago" title="最後に動いたのは '+esc(ago(c.idleS))+'前'+(c.lastT?'('+esc(new Date(c.lastT).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))+')':'')+'">'+MSTAT_ICON.clock+'<span>'+esc(ago(c.idleS))+'前</span></span>'
    +bgNote(c)
    +etaChip(c).replace('class="eta','class="mi eta')
    +(ctx?'<span class="mi ctx '+ctxCls+'" title="文脈 — いまの会話の大きさ(直近のリクエスト) '+tok(ctx)+' トークン'
      +(ctxWin?'。'+(ctxWin===1000000?'1M':tok(ctxWin))+' の窓の '+ctxPct+'%':'。モデルの窓の大きさは記録にないので割合は出しません')+'">'+MSTAT_ICON.ctx+'<span>'+tok(ctx)+'</span>'
      +(ctxWin?'<span class="cbar" aria-hidden="true"><i style="width:'+ctxPct+'%"></i></span>':'')+'</span>':'')
    +(c.usage&&c.usage.inTok?'<span class="mi dim mtotal" title="'+esc(totalTitle(c.usage))+'">'+MSTAT_ICON.total+'<span>'+tok((c.usage.inTok||0)+(c.usage.outTok||0))+'</span></span>':'')
    +(c.usage&&c.usage.usd!=null&&(c.usage.usd>0||c.usage.unpriced)?'<span class="mi dim musd" title="'+esc(usdTitle(c.usage))+'">'+MSTAT_ICON.usd+'<span>'+esc(usdText(c.usage))+'</span></span>':'')
// the branch and its pull request (filled by askPr): shown with the status, not on a line of its own
    +(convAgent(c)&&c.project?'<span id="mpr" class="prbox"'+(prCache.get(c.agent+':'+c.id)?'':' hidden')+'>'+prHtml(prCache.get(c.agent+':'+c.id),c.agent+':'+c.id)+'</span>':'')
    +'</div>'
    +(c.forkOf||(c.forks||[]).length?'<div class="forks">'
      +(c.forkOf?'<span class="dim">複製元</span> '+forkLink(c.forkOf,'forkof'):'')
      +((c.forks||[]).length?'<span class="dim">複製したもの</span> '+c.forks.slice(0,6).map(id=>forkLink(id,'forkkid')).join(''):'')+'</div>':'')
// what the session does, below what it is: /compact, 端末へ, the terminal
    +'<div class="mbtns">'
      +(ctxCls&&c.agent==='claude'?'<button class="mini compact" title="送信欄に /compact を入れます">/compact</button>':'')
      +(canGoTerm(c)?'<button class="mini goterm" title="このセッションが開いている端末へ ('+esc(kmL('panel.goterm'))+')">端末へ ↗</button>':'')
      +(canPty(c)?'<button class="mini ptygo" title="'+(c.alive?'下のターミナルでこのセッションを開きます。タブを閉じてもセッションは動き続けます':'下のターミナルでこのセッションを再開します(claude --resume)')+'">'+(c.alive?'ここで開く':'ここで再開')+'</button>':'')
    +'</div>';
  const kids=(live.cards||[]).filter(x=>x.parentId===c.id&&x.agent===c.agent).sort((x,y)=>y.lastT-x.lastT);
  meta='<div class="ttlrow"><button class="mini mfoldbtn" id="mfold" title="上の情報を畳む / 広げる ([)" aria-expanded="'+(panelFold?'false':'true')+'">'+(panelFold?'▸':'▾')+'</button><div id="clabel" class="ttl" title="クリックで書き換え(空にすると自動の題名に戻ります)">'+ico(c)+esc(c.title||'(題名なし)')+(c.titleMine?'<span class="mine" title="あなたがつけた題名">✎</span>':'')+'</div>'
// 待ち / 完了 live on the title row, the one part every panel view keeps; they wrap under the title when narrow
    +'<div class="tctl">'+(sendable&&!c.subagent?(c.done
      ?'<span class="tlane dim">完了 '+esc(ago(Math.round((Date.now()-c.done.at)/1000)))+'前</span><button id="undone" class="mini tlb" title="完了を取り消します">取り消す</button>'
      :(c.parked?'<span class="tlane dim">待ち中</span><button id="unpark" class="mini tlb" title="待ちから外し、本来のレーンに戻します">待ちを外す</button>'
        :'<button id="dopark" class="mini tlb" title="いったん脇に置いて Waiting に移します。次にこのセッションへ指示すると戻ります。セッションには何も送りません">待ちにする</button>')
       +'<button id="dodone" class="mini tlb primary" title="このカードを完了に移します。セッションには何も送りません">完了にする</button>'):'')+'</div>'
    +'<button class="mini copybtn" id="mcopy" title="セッションIDをコピー ('+esc(kmL('panel.copyid'))+')" aria-label="セッションIDをコピー"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button><button class="mini mx" id="mclose2" title="閉じる (Esc)">×</button></div>'
    +(parent?'<button class="mini back" id="mparent">← 親: '+esc(parent.title||short(parent.project)||parent.id.slice(0,8))+'</button>':'')
    +meta
    +(kids.length?(()=>{
      const run=kids.filter(kidAtWork),fin=kids.filter(k=>!kidAtWork(k));
// a finished one's last word is its result
      const res=k=>{const t=!kidAtWork(k)&&k.last&&k.last.assistant||'';return t?'<span class="kres">'+esc(t.replace(/\s+/g,' ').slice(0,280))+'</span>':''};
      const row=k=>'<button class="kid'+(kidAtWork(k)?' run':'')+'" data-id="'+esc(k.id)+'">'
        +'<span class="dot"></span><span class="kt">'+esc(k.title||k.agentType||k.id.slice(0,14))+res(k)+'</span>'
        +'<span class="dim">'+esc(ago(k.idleS))+'前</span></button>';
// folded by default so a long list does not push the conversation off the panel
      return '<details class="kids"'+(kidsOpen.has(c.agent+':'+c.id)?' open':'')+'><summary class="kh"><b>サブエージェント</b><span class="dim">'+(run.length?'実行中 '+run.length+' / ':'')+kids.length+'件</span></summary>'
        +run.map(row).join('')
        +(fin.length?'<div class="kfin"><div class="kfh dim">結果 '+fin.length+'件</div>'+fin.slice(0,30).map(row).join('')+'</div>':'')
        +'</details>'})():'');
  return meta;
}
/** A codex or antigravity session's --model menu: 既定, the models its CLI offers (live.models: codex's own list), then up to 4 others its sessions ran recently. */
function agentModels(c){
  const offered=((live.models||{})[c.agent]||[]).map(m=>[m.v,m.l,m.d+(typeof rateText==='function'&&rateText(m.v)?' · '+rateText(m.v)+'(100万トークン 入力/出力)':'')]);
  const seen=[];for(const x of [...(live.cards||[])].filter(x=>x.agent===c.agent&&x.model).sort((a,b)=>(b.lastT||0)-(a.lastT||0)))
    if(x.model!==c.model&&!seen.includes(x.model)&&!offered.some(o=>o[0]===x.model)&&seen.length<4)seen.push(x.model);
  return [['','既定'],...offered,...seen.map(m=>[m,m])];
}
function modelPickOf(c){
  const cur=c.model?modelLabel(c.model,c.modelId):'';
  const fv=famVersions();
  const mLabel=(v)=>!v?'既定'+(cur?' '+cur:''):v+(fv[v]?' '+fv[v]:'');
  return {cur,fv,mLabel};
}
// /effort's levels, and the one picked per session (until reload: the CLI does not record it where the board reads)
// when to pick which (Anthropic's guidance for the current models): shown on each choice, and as 新規's presets
const EFFORT_LEVELS=[['low','雑談・単純作業・調べ物の下請け'],['medium','普段のコーディング(Opus 5.5 の初期値)'],['high','頭を使う設計・調査'],['xhigh','大きな実装・長く任せる作業'],['max','正しさ最優先(コストは最大)']];
const MODEL_GUIDE={opus:'普段使いのおすすめ($4/$20)',sonnet:'量の多い作業を安く($2/$10)',haiku:'単純で速く・最安',fable:'難問・厳しいレビューだけ(最も高い $10/$50)'};
// 新規's presets: a situation → model + 考える深さ
// [name, model, effort, when, 精度, 費用] — five picked to span the range (any other pair: the model and 深さ menus);
// 精度 and 費用 out of 5 (½ steps), relative to each other: a rough guide
const RECIPES=[['難問・レビュー','fable','high','ほかで解けない問題・厳しいレビュー',5,5],['大きな実装','opus','xhigh','設計からの実装・長く任せる作業',4.5,4],
  ['普段','opus','medium','普段のコーディング・調べもの',4,3],['量をこなす','sonnet','medium','似た作業の繰り返し・費用を抑えたい調査',3,1.5],
  ['大量に安く','haiku','high','数が多い作業・1件ごとに少し判断が要る分類やチェック・大量の下請け',2,0.5]];   // 精度の高い順
// API rates per million tokens (input, output), as shown on each おすすめ
const MODEL_RATES={opus:[4,20],sonnet:[2,10],haiku:[0.1,0.5],fable:[10,50]};
// codex's models (OpenAI's standard tier, developers.openai.com/api/docs/pricing, checked 2026-10-10)
const CODEX_RATES={'gpt-6-astra':[10,50],'gpt-6.1-sol':[2,10],'gpt-6-sol':[2,10],'gpt-6-luna':[0.1,0.5],'gpt-5.6-sol':[4,20],'gpt-5.6-terra':[2,12],'gpt-5.6-luna':[0.2,1.2]};
const rateOf=m=>MODEL_RATES[m]||CODEX_RATES[m]||null;
function rateText(m){const r=rateOf(m);return r?'$'+r[0]+' / $'+r[1]:''}
// the 費用 bar's full length: the dearest output price of either (fable and astra, $50)
const RATE_MAX=50;
// codex: its reasoning levels (~/.codex/models_cache.json lists them per model; ultra is not on every one)
const CODEX_EFFORTS=[['low','速い・軽い'],['medium','普段の作業(多くのモデルの初期値)'],['high','頭を使う設計・調査'],['xhigh','大きな実装・長く任せる作業'],['max','最大'],['ultra','最上(対応モデルのみ)']];
function effortLevelsFor(agent){return agent==='codex'?CODEX_EFFORTS:agent==='claude'?EFFORT_LEVELS:[]}
/** codex's models by role, from its own list: the frontier one (astra), the workhorse (sol), the fast one (luna) */
function codexRoles(){const ms=((live.models||{}).codex||[]).map(m=>m.v),f=re=>ms.find(v=>re.test(v));return {top:f(/astra/i),work:f(/sol/i),fast:f(/luna/i)}}
/** おすすめ for an agent: {n, m, e, w, q (精度 /5), cost (0–1 of the dearest), tip} — claude's from RECIPES and the API
 *  rates; codex's by its models' roles, 費用 relative only (OpenAI's rates are not checked here) */
function recipesFor(agent){
  const priced=(x)=>{const r=rateOf(x.m);return {...x,cost:r?r[1]/RATE_MAX:x.cost,tip:r?'API 単価 '+rateText(x.m)+'(100万トークンあたり 入力 / 出力)。バーは $50(fable・astra)を最大にした比率':x.tip}};
  if(agent==='claude')return RECIPES.map(([n,m,e,w,q])=>priced({n,m,e,w,q,cost:null,tip:''}));
  if(agent==='codex'){const r=codexRoles(),out=[],tip='相対的な目安(このモデルの単価は未確認)';
    if(r.top)out.push({n:'難問・レビュー',m:r.top,e:'high',w:'ほかで解けない問題・厳しいレビュー',q:5,cost:1,tip});
    if(r.work){out.push({n:'大きな実装',m:r.work,e:'xhigh',w:'設計からの実装・長く任せる作業',q:4.5,cost:0.6,tip});
      out.push({n:'普段',m:r.work,e:'medium',w:'普段のコーディング・調べもの',q:4,cost:0.4,tip})}
    if(r.fast)out.push({n:'大量に安く',m:r.fast,e:'high',w:'数が多い作業・簡単な作業',q:2.5,cost:0.15,tip});
    return out.map(priced)}
  return [];
}
/** 精度 and 費用 as two short bars */
function recipeBars(x){
  const qw=Math.round(x.q/5*100),cw=x.cost==null?0:Math.max(2,Math.round(x.cost*100));
  return '<span class="rbars"><span class="rbar" title="精度の目安(5段階で '+x.q+')"><span class="rbl">精度</span><span class="rtrack"><span class="rfill rfq" style="width:'+qw+'%"></span></span></span>'
    +'<span class="rbar" title="'+esc(x.tip||'')+'"><span class="rbl">費用</span><span class="rtrack"><span class="rfill rfc" style="width:'+cw+'%"></span></span>'+(rateText(x.m)?'<span class="rnum">'+esc(rateText(x.m))+'</span>':'')+'</span></span>';
}
const effortPicked=new Map();
function detailSendBox(c,key){
// A headless resume starts a second process replaying the transcript, so a live session's
// message is queued instead. (Not named `live`: that is the board's global state.)
  const isLive=!!c.alive;
// an idle background session is between turns: the board stops and continues it, so the message lands now
  const wakeable=isLive&&c.aliveKind==='background'&&c.aliveStatus==='idle';
  const holds=isLive&&!wakeable;
// non-claude agents are offered the models their own sessions ran, not Claude's
  const MODELS=c.agent!=='claude'?agentModels(c):[['','既定'],...['opus','sonnet','haiku','fable'].map(m=>[m,m+(famVersions()[m]?' '+famVersions()[m]:''),MODEL_GUIDE[m]])];
  const {cur,fv,mLabel}=modelPickOf(c);
  const modelPick=(sel)=>'<span class="mmodew mmodelw"><button class="mini tflag mmodel" data-model="'+esc(sel||'')+'" aria-haspopup="menu" title="この送信で使うモデル'+(cur?'(既定 = このセッションがいま使っている '+esc(c.modelId||c.model)+')':'')+'">'+esc(mLabel(sel))+' ▾</button>'
    +'<div class="modemenu modelmenu" role="menu" hidden>'+MODELS.map(([v,l,d])=>'<button role="menuitem" data-m="'+v+'" class="'+((sel||'')===v?'on':'')+'"><b>'+esc(l)+'</b><span class="dim">'
      +(d?esc(d)+(v&&v===c.model?'(いま使っている)':''):!v?(cur?'このセッションがいま使っている '+esc(cur)+'。変えなければこのまま続きます':'このセッションの設定のまま'):fv[v]?esc(v)+' '+esc(fv[v])+'(この Mac の最近のセッションで使われた版)':c.agent!=='claude'?esc(v)+'(この Mac の最近の '+esc(c.agent)+' セッションで使われたモデル)':esc(v))+'</span></button>').join('')+'</div></span>';
  const sendBox='<div class="row msg tbox">'
    +'<div class="prompt"><span class="ps">❯</span><textarea maxlength="4000" spellcheck="false" placeholder="'+(holds?(c.agent==='claude'&&c.aliveName?'動いているこのセッションへ':'空き次第このセッションへ'):'このセッションへ')+'"></textarea></div>'
    +'<div class="atts"></div>'
    +'<div class="foot">'
    // おすすめ: a situation picks the model and 考える深さ together (claude), left of both
    +((c.agent==='claude'||c.agent==='codex')&&!c.subagent&&recipesFor(c.agent).length?'<span class="mmodew mrecw"><button id="mrecipe" class="mini tflag mrecipe" aria-haspopup="menu" title="場面からモデルと考える深さを一緒に選ぶ">おすすめ ▾</button><div class="modemenu recipemenu" role="menu" hidden>'
      +recipesFor(c.agent).map(x=>'<button role="menuitem" data-m="'+esc(x.m)+'" data-e="'+x.e+'"><b>'+esc(x.n)+' <span class="dim">'+esc(x.m+'・'+x.e)+'</span></b>'+recipeBars(x)+'<span class="dim">'+esc(x.w)+'</span></button>').join('')+'</div></span>':'')
    +modelPick(modelPicked.get(key)||'')
    // 考える深さ: /effort for this session, sent when picked (claude only)
    +((c.agent==='claude'||c.agent==='codex')&&!c.subagent?'<span class="mmodew meffw"><button id="meffort" class="mini tflag meffort" aria-haspopup="menu" title="'+(c.agent==='claude'?'このセッションの考える深さ(/effort)。選ぶとすぐ切り替えます':'codex の考える深さ(reasoning effort)。次の送信から使います')+(effortPicked.get(key)?'':'。いまは未指定: '+((effortDefault(c.agent,c.modelId||c.model))?c.agent+' の設定の '+effortDefault(c.agent,c.modelId||c.model)+(c.agent==='claude'?'(ターミナルで /effort を変えていればそちら)':''):'CLI の設定のまま(モデルの初期値)'))+'">'+esc(effortPicked.get(key)?'深さ '+effortPicked.get(key):'深さ 既定'+((effortDefault(c.agent,c.modelId||c.model))?' '+effortDefault(c.agent,c.modelId||c.model):''))+' ▾</button><div class="modemenu effortmenu" role="menu" hidden>'
      +effortLevelsFor(c.agent).map(([v,d])=>'<button role="menuitem" data-e="'+v+'" class="'+(effortPicked.get(key)===v?'on':'')+'"><b>'+v+(!effortPicked.get(key)&&effortDefault(c.agent,c.modelId||c.model)===v?' <span class="dim">(既定)</span>':'')+'</b><span class="dim">'+esc(d)+'</span></button>').join('')+'</div></span>':'')
    +(panelTermOK(c)?'<span class="mmodew"><button id="mmode" class="mini tflag mmode" data-m="'+esc(c.permMode||'default')+'" title="権限モード — いまのモード。選ぶとそのセッションのターミナルで切り替えます(Shift+Tab と同じ)">'+esc(((PERM_MODES.find(x=>x[0]===(c.permMode||'default'))||[,c.permMode||'確認あり'])[1]))+' ▾</button><div class="modemenu" hidden>'
      +PERM_MODES.map(([v,l,d])=>'<button data-m="'+v+'"><b>'+esc(l)+'</b><span class="dim">'+esc(d)+'</span></button>').join('')+'</div></span>':'')
    +'<button class="mini attbtn tflag" title="ファイルを添付(貼り付け・ドロップでも)">+file</button>'
// 複製 (--fork): the message starts a new session carrying this conversation, instead of going here
    +(c.agent==='claude'&&!c.subagent?'<button class="mini forkbtn toggle tflag" title="この会話を複製して、別のセッション(別のカード)として送ります。元のセッションはそのままです(claude --fork-session)">複製</button><button class="mini forkwt toggle tflag" hidden title="複製した側を git worktree で始めます。元と並べて書き込んでもぶつかりません">--worktree</button>':'')
    +(!c.subagent?wfChip(c):'')
    +'</div></div>'
    +'<input type="file" class="attinput" multiple hidden><div class="toast"></div>';
  return sendBox;
}
function detailPendBox(c){
// Read by a model call over the conversation's tail (lib/pending.js), only on 棚卸し, so an unread
// session says so instead of claiming nothing is left.
  const p=c.wip;
  const pWhen=p&&p.at?ago(Math.round((Date.now()-p.at)/1000))+'前':'';
  let pInner;
  if(!p)pInner='';
  else if(p.status==='running')pInner='<div class="dim">棚卸し中…(数十秒)</div>';
  else if(p.status==='error')pInner='<div class="dim">'+esc(p.error||'棚卸しに失敗しました')+'</div>';
  else if(!(p.remaining||[]).length)pInner='<div class="dim">'+esc(pWhen)+'の棚卸しでは、残っていることは見つかりませんでした</div>';
  else pInner='<ul>'+p.remaining.map(r=>'<li>'+esc(r.what)+(r.evidence?'<div class="ev">'+esc(r.evidence)+'</div>':'')+'</li>').join('')
    +'</ul>'+((p.blocked||[]).length?'<div class="ev">判断待ち: '+esc(p.blocked.join(' / '))+'</div>':'');
  const pStale=p&&p.at&&c.lastT&&c.lastT>p.at+60000;
  const pCount=p&&p.status==='ok'?(p.remaining||[]).length:null;
  const pSum=!p?'未確認':p.status==='running'?'棚卸し中…':p.status==='error'?'失敗':pCount?pCount+'件':'残りなし';
  // open again after a redraw only if you had it open on this same session (it is a modal now, not a remembered fold)
  const pOpen=pendOpenKey===c.agent+':'+c.id;
  const pendBox='<details class="pendbox"'+(pOpen&&pInner?' open':'')+'><summary class="ph"><b>残作業</b>'
    +'<span class="'+(pCount?'pn':'dim')+'">'+esc(pSum)+'</span>'
    +(p&&p.status==='ok'?'<span class="dim">'+esc(pWhen)+(pStale?' · その後に動いています':'')+'</span>':'')
    +'<button id="pscan" class="mini tflag"'+(p&&p.status==='running'?' disabled':'')+'>'+(p?'棚卸しし直す':'棚卸しする')+'</button></summary>'+pInner+'</details>';
  return pendBox;
}
function detailQueuedNote(c){
  const qText=c.held&&c.held.length?(c.queuedPlain||''):(c.queued||'');
// 今の作業後に送る messages are shown in the thread (heldHtml); this note covers the rest
  return (qText?'<div class="mnote queued">送信待ち: '+esc(qText)
// the CLI refused and kept it itself
      +(c.queuedFails&&/保存され/.test(c.queuedError||'')?'<div class="qerr">'+esc(c.agent)+' 側で保留中(次にこのセッションが起動したときに届きます)'+(native&&c.agent==='claude'?' <button id="qattach">端末で開いて届ける</button>':'')+'</div>'
        :c.queuedFails?'<div class="qerr">'+qerrText(c)+(native&&c.agent==='claude'&&/not trusted|状態を確認できず/i.test(c.queuedError||'')?' <button id="qattach">端末で開いて届ける</button>':'')+(c.queuedFails>=5?' <button id="qretry">もう一度送る</button>':'')+'</div>':'')
      +(!c.queuedFails?'<div class="qwhy dim">'+(c.alive&&c.aliveKind==='interactive'?'ターミナルで開いているセッションなので、閉じたら送ります'+(native?'(今すぐなら「端末で開いて届ける」)':'')
        :c.alive&&c.aliveStatus==='busy'&&c.background?'ターンは終わっていますが、裏でタスクが動いているので預かっています。止まったら自動で送ります'
        :c.alive&&c.aliveStatus==='busy'?'作業中なので預かっています。手が空いたら自動で送ります'
        :'次の更新(30秒ごと)で送ります')+'</div>':'')
      +(!c.queuedFails&&native&&c.agent==='claude'&&c.alive&&c.aliveKind==='interactive'?' <button id="qattach">端末で開いて届ける</button>':'')
      +' <button id="qcancel">取り消す</button></div>':'');
}
