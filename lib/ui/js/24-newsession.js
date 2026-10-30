/** 新規's choices as on screen, kept with its draft (00-core.js) */
function newOpts(){
  const on=s=>{const e=$(s);return !!(e&&e.classList&&e.classList.contains('on'))};
  const m=[...document.querySelectorAll('#mbody .nmode')].find(x=>x.classList.contains('on'));
  return {dir:($('#ndir')||{}).value||'',agent:($('#nagent')||{dataset:{}}).dataset.v||'',model:($('#nmodel')||{dataset:{}}).dataset.model||'',effort:($('#neffort')||{dataset:{}}).dataset.e||'',
    chrome:on('#nchrome'),mode:m?m.dataset.mode:'',wt:on('#nwt'),par:+(($('#npar')||{dataset:{}}).dataset.n)||1,wtcmd:($('#nwtcmd')||{}).value||''};
}
/** put back by clicking each choice, so the preview and the rows follow */
function newOptsSet(o){
  if(!o)return;
  if(o.dir&&$('#ndir'))$('#ndir').value=o.dir;
  const pick=(box,attr,v)=>{const b=box&&[...box.children].find(x=>x.dataset[attr]===v);if(b&&b.onclick)b.onclick()};
  if(o.agent)pick($('#nagent'),'v',o.agent);
  if(o.model!=null)pick($('#nmodel'),'m',o.model);
  if(o.effort!=null)pick($('#neffort'),'e',o.effort);
  const ch=$('#nchrome');if(ch&&ch.classList)ch.classList.toggle('on',!!o.chrome);
  for(const b of document.querySelectorAll('#mbody .nmode'))b.classList.toggle('on',!!o.mode&&b.dataset.mode===o.mode);
  const wt=$('#nwt');if(wt&&wt.classList)wt.classList.toggle('on',!!o.wt);
  if(o.par>1)pick($('#npar'),'n',String(o.par));
  if(o.wtcmd&&$('#nwtcmd'))$('#nwtcmd').value=o.wtcmd;
}
// each start mode as the agent's CLI takes it (lib/dispatch.js MODES / AGENT_MODES)
const NMODE_FLAG={claude:{plan:'--permission-mode plan',acceptEdits:'--permission-mode acceptEdits',auto:'--permission-mode auto'},
  codex:{plan:'-s read-only',acceptEdits:'-s workspace-write',auto:'--approve-for-me'},antigravity:{plan:'--mode plan',acceptEdits:'--mode accept-edits'}};
/** The panel in "new session" mode: pick an agent and a directory, type, run. */
function openNew(){
  keepUnsent();   // what you were writing to the card goes with it (unsent), not lost
  $('#mtitle').textContent=t('新しいセッション');$('#detail').classList.remove('sess');
  let dir='';try{dir=localStorage.getItem('lastdir')||''}catch(e){}
// a remembered /tmp or /var/folders path is a leftover scratch dir (the selftest shares this storage)
  if(dir.startsWith('/var/folders/')||dir.startsWith('/tmp/')||dir.startsWith('/private/tmp/'))dir='';
// offered: trusted directories you use first (a background session can only start in one)
  const trusted=live.trusted||[];
  const used=[...new Set(live.cards.filter(c=>c.project&&c.project.startsWith('/')).map(c=>c.project))];
  const dirs=[...new Set([...used.filter(d=>trusted.includes(d)),...trusted,...used])].slice(0,12);
  if(!dir&&dirs.length)dir=dirs[0];
  const AGENTS=[['claude','claude'],['codex','codex'],['antigravity','antigravity']];
  const dirChip=d=>{const h=shortHome(d),i=h.lastIndexOf('/');const par=i>0?h.slice(0,i):'';
    return '<button data-d="'+esc(d)+'" title="'+esc(d)+'"><span class="nsfold" aria-hidden="true"></span>'+esc(short(d))+(par&&par!=='~'?' <span class="dim">'+esc(par)+'</span>':'')+'</button>'};
  $('#mbody').innerHTML='<div class="nsw">'
    +'<div class="nshead"><div class="nsh">'+t('何をしましょうか？')+'</div></div>'
    +'<div class="nsstate" id="nstate" role="status" aria-live="polite" hidden></div>'
    +'<div class="nscomp"><div class="prompt"><textarea id="ntext" rows="3" maxlength="4000" spellcheck="false" placeholder="'+t('頼みたいことを書いてください')+'"></textarea></div>'
      +'<div class="atts"></div>'
      +'<div class="nsbar"><button class="nsicon attbtn" title="'+t('ファイルを添付(貼り付け・ドロップでも)')+'" aria-label="'+t('ファイルを添付')+'">+</button>'
      +'<span class="hint">'+t('/ スキル · @ ファイル · ↑ 前の依頼')+'</span>'
      +'<span class="nskeys">'+t('⏎ 開始 · ⇧⏎ 改行')+'</span>'
      +'<button class="run nsgo" title="'+t('開始 (⏎)')+'" aria-label="'+t('開始')+'" disabled><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>'
    +'</div><div class="toast"></div>'
    +'<div id="mmeta" class="nsopts">'
    +'<div class="nsrow"><span class="nsk">'+t('場所')+'</span><div class="nsv">'
      +(dirs.length?'<div class="chips dirs">'+dirs.slice(0,6).map(dirChip).join('')+'</div>':'')
      +'<input id="ndir" type="text" spellcheck="false" list="ndirs" placeholder="/path/to/repo" value="'+esc(dir)+'" aria-label="'+t('作業ディレクトリ')+'"><datalist id="ndirs">'+dirs.map(d=>'<option value="'+esc(d)+'">').join('')+'</datalist></div></div>'
    +'<div class="nsrow"><span class="nsk">'+t('エージェント')+'</span><div class="nsv"><div class="chips seg" id="nagent" data-v="claude">'+AGENTS.map(([v,l])=>'<button data-v="'+v+'">'+l+'</button>').join('')+'</div></div></div>'
    +'<div class="nsrow"><span class="nsk">'+t('モデル')+'</span><div class="nsv"><div class="chips seg" id="nmodel" data-model="">'+[['',t('既定')],['opus','opus'],['sonnet','sonnet'],['haiku','haiku'],['fable','fable']].map(([v,l])=>'<button data-m="'+v+'">'+l+(v?(famVersions()[v]?' <span class="ver">'+esc(famVersions()[v])+'</span>':''):' <span class="curm"></span>')+'</button>').join('')+'</div></div></div>'
    // --effort: how hard it thinks (claude only; 既定 = the CLI's own setting)
    +'<div class="nsrow" id="neffrow"><span class="nsk">'+t('考える深さ')+'</span><div class="nsv"><div class="chips seg" id="neffort" data-e=""></div></div></div>'
    // おすすめ: a situation picks the model and 考える深さ together (claude)
    +'<div class="nsrow" id="nreciperow"><span class="nsk">'+t('おすすめ')+'</span><div class="nsv"><div class="nrecipes" id="nrecipe"></div></div></div>'
// its own worktree per copy, so parallel runs of the same ask cannot write over each other
    +'<div class="nsrow" id="nwtrow"><span class="nsk">'+t('オプション')+'</span><div class="nsv">'
      +'<button id="nchrome" class="mini toggle nstog" title="'+t('Claude in Chrome(--chrome)。拡張側が操作の前に確認します')+'">'+t('Chrome を操作')+'</button>'
      +'<button id="nplan" class="mini toggle nstog nmode" data-mode="plan" title="'+t('調べて計画だけ立て、ファイルは変えません(--permission-mode plan)')+'">'+t('計画だけ')+'</button>'
      +'<button id="naccept" class="mini toggle nstog nmode" data-mode="acceptEdits" title="'+t('ファイルの編集は確認なしで通します。コマンドは今まで通り確認します(--permission-mode acceptEdits)')+'">'+t('編集は自動で許可')+'</button>'
      +'<button id="nauto" class="mini toggle nstog nmode" data-mode="auto" title="'+t('安全と判断した操作は確認なしで進めます(--permission-mode auto)')+'">auto</button>'
      +'<button id="nwt" class="mini toggle nstog" title="'+t('git worktree を切ってそこで始めます(claude / codex の --worktree)。同じリポジトリで並べても書き込みがぶつかりません')+'">'+t('worktree で分ける')+'</button>'
      +'<div class="chips seg" id="npar" data-n="1" title="'+t('同じ依頼を worktree ごとに並べて走らせる数')+'">'+[1,2,3].map(n=>'<button data-n="'+n+'"'+(n===1?' class="on"':'')+' aria-label="'+t('同じ依頼を {n} 本',{n})+'">×'+n+'</button>').join('')+'</div></div></div>'
// what the new worktree will lack: gitignored config (.env …) and dependencies
    +'<div class="nsrow" id="nwtinfo" hidden><span class="nsk">'+t('準備')+'</span><div class="nsv"><span class="wtmiss"></span><input id="nwtcmd" type="text" spellcheck="false" placeholder="'+t('worktree で最初に走らせるコマンド(例: npm ci)')+'"></div></div>'
    +'</div>'
    +'<div class="tpreview" id="npreview"></div>'
    +'</div>'
    +'<input type="file" class="attinput" multiple hidden>';
  const body=$('#mbody'),ta=$('#ntext');
  const abox=$('#nagent');
  let lastAgent='claude',lastModel='';
  try{lastAgent=localStorage.getItem('lastagent')||'claude';lastModel=localStorage.getItem('lastmodel')||''}catch(e){}
  if(abox){abox.dataset.v=lastAgent;
    for(const b of abox.children){if(b.dataset.v===lastAgent)b.classList.add('on');
      b.onclick=()=>{abox.dataset.v=b.dataset.v;for(const o of abox.children)o.classList.remove('on');b.classList.add('on');skShow();if(typeof nsChoices==='function')nsChoices(b.dataset.v);preview();ta.focus()}}}
  const ch=$('#nchrome'),wt=$('#nwt'),par=$('#npar');
  const modes=[...document.querySelectorAll('#mbody .nmode')];
  for(const b of modes)b.onclick=()=>{const on=!b.classList.contains('on');for(const o of modes)o.classList.remove('on');if(on)b.classList.add('on');preview()};
  const modeOn=()=>{const b=modes.find(x=>x.classList.contains('on'));return b?b.dataset.mode:''};
  const wtOn=()=>!!(wt&&wt.classList.contains('on'));
  const parN=()=>wtOn()?(+((par||{dataset:{}}).dataset.n)||1):1;
  const preview=()=>{
    const pv=$('#npreview');if(!pv)return;
    const agent=(abox||{dataset:{}}).dataset.v||'claude';
    if(mbox)for(const b of mbox.children)b.hidden=agent==='antigravity'&&!!b.dataset.m;
// each CLI's own flag for the mode (lib/dispatch.js AGENT_MODES); agy has no auto
    for(const b of modes){const f=(NMODE_FLAG[agent]||{})[b.dataset.mode];b.hidden=!f;if(b.hidden)b.classList.remove('on');else b.title=b.title.replace(/\([^()]*\)$/,'('+f+')')}
    if(mbox&&agent==='antigravity'&&mbox.dataset.model){mbox.dataset.model='';for(const b of mbox.children)b.classList.toggle('on',!b.dataset.m)}
    {const cm=mbox&&mbox.querySelector('.curm');if(cm){const d0=((live.defaults||{})[agent])||'';const dm=agent==='claude'&&/^(opus|sonnet|haiku|fable)$/.test(d0)?modelLabel(d0,''):d0;cm.textContent=dm;if(cm.parentElement)cm.parentElement.title=dm?t('{agent} の設定の既定モデル',{agent}):t('CLI の既定モデル')}}
    {const ce=$('#neffort [data-e=""] .curm');if(ce){const de=effortDefault(agent,(mbox&&mbox.dataset.model)||((live.defaults||{})[agent])||'');ce.textContent=de;if(ce.parentElement)ce.parentElement.title=de?t('{agent} の設定の {v}',{agent,v:de}):t('CLI の設定のまま(モデルの初期値)')}}
    const m=(mbox||{dataset:{}}).dataset.model||'',d=($('#ndir').value||'').trim();
    const ef=(($('#neffort')||{dataset:{}}).dataset.e)||'',efl=ef?(agent==='codex'?' -c model_reasoning_effort='+ef:agent==='claude'?' --effort '+ef:''):'';
    const mf=((NMODE_FLAG[agent]||{})[modeOn()]||'');
    const cmd=agent==='antigravity'?'agy'+(m?' --model '+m:'')+(mf?' '+mf:'')+' -p':agent==='codex'?'codex exec'+(d?' -C '+shortHome(d):'')+efl+(m?' -m '+m:'')+(mf?' '+mf:'')+(wtOn()?' --enable worktrees --worktree':''):'claude --bg'+(m?' --model '+m:'')+efl+(mf?' '+mf:'')+(ch&&ch.classList.contains('on')?' --chrome':'')+(wtOn()?' --worktree':'');
    const where=(()=>{const h=shortHome(d);const parts=h.split('/').filter(Boolean);return parts.length>3?'…/'+parts.slice(-2).join('/'):h})();
    pv.innerHTML='<span class="pdir" title="'+esc(d)+'">'+esc(where||'?')+'</span> <span class="ps">❯</span> '+esc(cmd)+' -- …'+(parN()>1?' <span class="dim">×'+parN()+'</span>':'');
    for(const b of body.querySelectorAll('.chips.dirs button'))b.classList.toggle('on',b.dataset.d===d);
    if(ch)ch.hidden=agent!=='claude';
// worktree: claude's and codex's --worktree; agy has none
    {const w=$('#nwt');if(w){w.hidden=agent==='antigravity';if(w.hidden)w.classList.remove('on')}if(par)par.hidden=!wtOn()}
    {const wi=$('#nwtinfo');if(wi){wi.hidden=agent==='antigravity'||!wtOn();if(!wi.hidden)wtAsk(d)}}
  };
  if(ch)ch.onclick=()=>{ch.classList.toggle('on');preview()};
  try{if(wt&&localStorage.getItem('lastwt')==='1')wt.classList.add('on')}catch(e){}
  if(wt)wt.onclick=()=>{wt.classList.toggle('on');try{localStorage.setItem('lastwt',wtOn()?'1':'0')}catch(e){}preview();ta.focus()};
  {const wc=$('#nwtcmd');if(wc)wc.onchange=()=>{const d=($('#ndir').value||'').trim();if(d)wtPost({dir:d,setup:wc.value})}}
  if(par)for(const b of par.children)b.onclick=()=>{par.dataset.n=b.dataset.n;for(const o of par.children)o.classList.toggle('on',o===b);preview();ta.focus()};
  attachSetup(body);
  const sk=skillSetup(body,ta,()=>($('#ndir').value||'').trim(),()=>((abox||{dataset:{}}).dataset.v||'claude')==='claude');
  fileSetup(ta,()=>($('#ndir').value||'').trim());
  histSetup(ta);
  const skb=body.querySelector('.skillbtn');
  const skShow=()=>{if(skb)skb.hidden=((abox||{dataset:{}}).dataset.v||'claude')!=='claude';if(skb&&skb.hidden)sk.close()};
  skShow();
// the compose box's textarea is #ntext, not .msg textarea, so attachSetup's paste handler misses it
  ta.addEventListener('paste',e=>{const items=(e.clipboardData||{}).items||[];let took=false;
    for(const it of items){if(it.kind==='file'){const f=it.getAsFile();if(f){attachUpload(body,f);took=true}}}
    if(took)e.preventDefault()});
  for(const b of $('#mbody').querySelectorAll('.chips.dirs button'))b.onclick=()=>{$('#ndir').value=b.dataset.d;preview();ta.focus()};
  $('#ndir').addEventListener('input',()=>preview());
  const mbox=$('#nmodel');if(mbox){mbox.dataset.model=lastModel;
    for(const b of mbox.children){if(b.dataset.m===lastModel)b.classList.add('on');
      b.onclick=()=>{mbox.dataset.model=b.dataset.m;for(const o of mbox.children)o.classList.remove('on');b.classList.add('on');preview();ta.focus()}}}
  const ebox=$('#neffort');
  // 考える深さ and おすすめ follow the agent: claude's /effort levels and recipes, codex's reasoning levels and its models
  const claudeChips=mbox?mbox.innerHTML:'';
  const nsChoices=agent=>{
    // the model chips: claude's aliases, or codex's own list (its /model); 既定 is the CLI's setting
    if(mbox&&(agent==='codex'||agent==='claude')){
      mbox.innerHTML=agent==='codex'?[['',t('既定')],...((live.models||{}).codex||[]).map(m=>[m.v,m.l])].map(([v,l])=>'<button data-m="'+esc(v)+'" title="'+esc(v?((((live.models||{}).codex||[]).find(x=>x.v===v)||{}).d||v):t('codex の設定のまま'))+'">'+esc(v?l:t('既定'))+(v?'':' <span class="curm"></span>')+'</button>').join(''):claudeChips;
      if(!mbox.querySelector('[data-m="'+CSS.escape(mbox.dataset.model||'')+'"]'))mbox.dataset.model='';
      for(const b of mbox.children){b.classList.toggle('on',b.dataset.m===(mbox.dataset.model||''));
        b.onclick=()=>{mbox.dataset.model=b.dataset.m;for(const o of mbox.children)o.classList.remove('on');b.classList.add('on');preview();ta.focus()}}}
    if(ebox){let le='';try{le=localStorage.getItem('lasteffort.'+agent)||''}catch(e){}
      const lv=effortLevelsFor(agent);if(!lv.some(([v])=>v===le))le='';ebox.dataset.e=le;
      const de=effortDefault(agent,(mbox&&mbox.dataset.model)||((live.defaults||{})[agent])||'');
      ebox.innerHTML=[['',t('既定')],...lv].map(([v])=>'<button data-e="'+v+'" class="'+(v===le?'on':'')+'" title="'+(v?(agent==='codex'?'model_reasoning_effort='+v:'--effort '+v):(de?t('{agent} の設定の {v}',{agent,v:de}):t('CLI の設定のまま(モデルの初期値)')))+'">'+(v||t('既定')+' <span class="curm">'+esc(de)+'</span>')+'</button>').join('');
      for(const b of ebox.children)b.onclick=()=>{ebox.dataset.e=b.dataset.e;for(const o of ebox.children)o.classList.remove('on');b.classList.add('on');preview();ta.focus()}}
    const rb=$('#nrecipe');if(rb){rb.innerHTML=recipesFor(agent).map(x=>'<button data-m="'+esc(x.m)+'" data-e="'+x.e+'" title="'+esc(t('{w} → {m} ・ 深さ {e}',{w:x.w,m:x.m,e:x.e})+(x.tip?' ・ '+x.tip:''))+'">'+esc(x.n)+' <span class="dim">'+esc(x.m+'・'+x.e)+'</span>'+recipeBars(x)+'</button>').join('');
      for(const r of rb.children)r.onclick=()=>{
        const pick=(box,attr,v)=>{const b=box&&[...box.children].find(x=>x.dataset[attr]===v);if(b&&b.onclick)b.onclick()};
        pick($('#nmodel'),'m',r.dataset.m);
        pick(ebox,'e',r.dataset.e);
        for(const o of rb.children)o.classList.toggle('on',o===r);ta.focus()}}
    const er=$('#neffrow');if(er)er.hidden=!effortLevelsFor(agent).length;
    const rr=$('#nreciperow');if(rr)rr.hidden=!recipesFor(agent).length;
  };
  nsChoices((abox||{dataset:{}}).dataset.v||'claude');
  preview();
  const go=()=>{
    if(body.dataset.sending)return;                 // a second Enter is not a second session
    if(newRun&&/^(starting|waiting)$/.test(newRun.phase))return;   // nor is one while the first is on its way
    if(attachAfter(body,go))return;
    const txt=(ta.value||'').trim();if(!txt&&!attachPaths(body).length){toast(body,t('内容が空です'));return}
    const d=($('#ndir').value||'').trim();if(!d){toast(body,t('作業ディレクトリを入れてください'));return}
    const model=(mbox||{dataset:{}}).dataset.model||'';
    const effort=(ebox||{dataset:{}}).dataset.e||'';try{localStorage.setItem('lasteffort.'+agent,effort)}catch(e){}
    const agent=(abox||{dataset:{}}).dataset.v||'claude';
    try{localStorage.setItem('lastdir',d);localStorage.setItem('lastagent',agent);localStorage.setItem('lastmodel',model)}catch(e){}
// The Claude CLI starts no background session in the home directory: use a trusted directory
// instead (the last one used, else the first the CLI trusts).
    const home=(live.home||'').replace(/\/$/,'');
    let dir=d,moved='';
    if(agent==='claude'&&home&&(d.replace(/\/$/,'')===home||d==='~'||d==='~/')){
      const trusted=live.trusted||[];let last='';try{last=localStorage.getItem('lastbgdir')||''}catch(e){}
      const alt=trusted.includes(last)?last:(trusted.find(x=>/\/(private|work)$/.test(x))||trusted[0]||'');
      if(alt){dir=alt;moved=alt}
    }
    if(agent==='claude'&&dir!==home){try{localStorage.setItem('lastbgdir',dir)}catch(e){}}
    lastRun={dir,moved};
// ×N: the same ask N times, each in its own worktree; the panel follows the first
    const n=agent!=='antigravity'?parN():1,worktree=agent!=='antigravity'&&wtOn();
    const setup=worktree?(($('#nwtcmd')||{}).value||'').trim():'';
    const at=(()=>{const p=shortHome(dir).split('/').filter(Boolean);return p.length>3?'…/'+p.slice(-2).join('/'):shortHome(dir)})();
    nsState('starting',t('起動中… {at} で {cmd} を始めています',{at,cmd:agent==='claude'?'claude --bg':agent==='antigravity'?'agy -p':'codex exec'})+(n>1?t('(×{n}。パネルは1本目を追います)',{n}):''));
// only the first carries the draft: its answer decides whether the ask stays in the box
    for(let k=0;k<n;k++)dispatch({type:'run',agent,dir,moved,text:wtNote(setup)+txt,model,...((agent==='claude'||agent==='codex')&&effort?{effort}:{}),chrome:!!(ch&&ch.classList.contains('on')),mode:modeOn(),worktree,attachments:attachPaths(body),closeOnDone:k===0},body,undefined,k===0?'new':undefined);
    toast(body,'');{const b=body.querySelector('.nsgo');if(b)b.disabled=true}   // the line above says it; not twice
    rememberSent(txt);
  };
  ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();go()}};
  const gb=body.querySelector('.nsgo');
  const ready=()=>{if(gb&&!body.dataset.sending)gb.disabled=!(ta.value||'').trim()&&!attachPaths(body).length};
  if(gb){gb.onclick=()=>go();ta.addEventListener('input',ready);if(typeof MutationObserver==='function')new MutationObserver(ready).observe(body.querySelector('.atts'),{childList:true,subtree:true,attributes:true})}
  draftWatch(ta,'new');
  {const r=!ta.value?draftTake('new'):null;
    if(r){if(r.e.o)newOptsSet(r.e.o);draftShow('new',body,ta,r.e);preview();
      if(r.why==='failed')toast(body,t('起動できなかった依頼を戻しました'));
      else if(r.why==='unsure')toast(body,t('起動の結果を確かめられなかった依頼を戻しました。始まっていないか作業中の列で確かめてから送ってください'))}}
  autoGrow(ta,320);
  openFor=null;openCard=null;panelKey='new';
  newRun=null;pendingNew=null;delete $('#mbody').dataset.phase;
  delete $('#detail').dataset.color;
  delete $('#mbody').dataset.sending;
  $('#detail').hidden=false;document.body.classList.add('withpanel');
  ta.focus();
}
$('#new').onclick=()=>toggleNew('header button');
