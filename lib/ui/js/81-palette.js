// The palette (`:` or ⌘K): fuzzy-find any session or action. Most entries click the real
// button, so its behaviour (and any two-press confirmation) stays the button's; `when`
// offers an entry only while that button is on screen.
function palHas(sel,visible){return ()=>{const b=$(sel);return !!b&&!b.disabled&&!(visible&&b.hidden)}}
function palClick(sel){return ()=>{const b=$(sel);if(b&&!b.disabled)b.click()}}
/** A two-press button: the first press arms it; it keeps focus so Enter is the second. */
function palArm(sel){return ()=>{const b=$(sel);if(!b||b.disabled)return;if(!b.classList.contains('arm'))b.click();b.focus()}}
function palFin(){return [...document.querySelectorAll('#mpr .prfin')].find(b=>!b.dataset.merge&&!b.disabled)||null}
const PAL_ACTIONS=[
  {t:'新規セッション',k:'{new.meta}',run:()=>toggleNew('palette')},
  {t:'Completed を表示 / 隠す',k:'{done.toggle}',run:()=>$('#showdone').click()},
  {t:'キーバインドの設定(ショートカットのキーを変える)',run:()=>togglePanel('keys',openKeys)},
  {t:'設定メニューを開く',run:palClick('#setbtn')},
  {t:'Your Turn の並びを切り替える(古い順 ⇄ 新しい順)',run:palClick('#yourorder')},
  {t:'自動実行を表示 / 隠す',k:'{subs.toggle}',run:()=>$('#subs').click()},
  {t:'ターミナルを表示',k:'{term.key} / {term.meta}',when:()=>document.body.classList.contains('termclosed'),run:()=>{termOpen(true);const i=paneIn(activePane());if(i&&!i.disabled)i.focus()}},
  {t:'ターミナルを隠す',k:'{term.key} / {term.meta}',when:()=>!document.body.classList.contains('termclosed'),run:()=>termOpen(false)},
  {get t(){return termStacked()?'ターミナルを上下に分割':'ターミナルを左右に分割'},k:'{split.meta}',run:()=>splitPane()},
  {t:'ターミナルを消去 (clear)',k:'⌃L',run:()=>{termOpen(true);termClearFocused()}},
  {t:'シェルを開く',k:'{shell.meta}',when:()=>native&&!!window.Terminal,run:()=>ptyOpen('shell',{label:'シェル',cwd:term.cwd||''})},
  {t:'右の場所へ(リスト → パネル → ターミナル)',k:'{go.right}',run:()=>paneMove(1)},
  {t:'左の場所へ',k:'{go.left}',run:()=>paneMove(-1)},
  {t:'前のカードへ(パネルごと)',k:'{card.up} / {card.prev}',panel:true,run:()=>cardStep(-1)},
  {t:'次のカードへ(パネルごと)',k:'{card.down} / {card.next}',panel:true,run:()=>cardStep(1)},
  {t:'ターミナルの次の区画へ',k:'{card.next}(ターミナル帯の中で)',when:()=>stripPanes().length>1,run:()=>paneStep(1)},
  {t:'ターミナルの前の区画へ',k:'{card.prev}(ターミナル帯の中で)',when:()=>stripPanes().length>1,run:()=>paneStep(-1)},
  {t:'ターミナルの区画を閉じる',k:'{close.meta}',when:()=>(ptyOn!=='cmd'&&ptys.has(ptyOn))||panes.length>1,run:()=>paneCloseFocused()},
  {t:'表示する時間を広げる',k:'{hours.up}',run:()=>hoursStep(1)},
  {t:'表示する時間を狭める',k:'{hours.down}',run:()=>hoursStep(-1)},
  {t:'未読を開く',when:()=>unreadCount()>0,run:unreadNext},
  {t:'すべて既読にする',when:()=>unreadCount()>0,run:unreadAllRead},
  {t:'残作業: 手前の件を棚卸し',when:palHas('#pscanall'),run:palClick('#pscanall')},
  {t:'ライト / ダーク',run:()=>$('#theme').click()},
  {t:'カードに出す項目を選ぶ',run:()=>$('#cardshowbtn').click()},
  {t:'Claude の利用枠を出す(設定のしかた)',when:palHas('#limset'),run:palClick('#limset')},
  {t:'Claude の利用枠の設定をコピー',when:palHas('#limcopy'),run:palClick('#limcopy')},
  {t:'カードに出す項目の並び順を既定に戻す',when:palHas('#cordreset'),run:palClick('#cordreset')},
  {t:'残作業を見る / 閉じる',run:()=>$('#pendall').click()},
  {t:'定期実行の一覧',run:()=>$('#jobsbtn').click()},
  {t:'読み直す',k:'{reload.key}',run:()=>load()},
  {t:'通知を許可する / 通知の設定',when:()=>native,run:()=>{post({type:'notifyperm'})}},
  {t:'ショートカット一覧',k:'{help.meta}',run:()=>{const h=$('#help');if(h&&h.hidden)toggleHelp()}},
  {t:'設定: キーバインド',run:()=>togglePanel('keys',openKeys)},
  // the open panel's own
  ...PERM_MODES.map(([v,l])=>({t:'権限モードを '+l+' に',panel:true,when:()=>!!$('#mmode')&&$('#mmode').dataset.m!==v,run:()=>{if(openCard)panelMode(openCard,v)}})),
  {t:'最新の回答に返信',k:'{panel.reply}',panel:true,when:()=>!!$('#mbody .msg textarea'),run:()=>replyLatest()},
  {t:'このセッションを完了にする',panel:true,run:()=>{const b=$('#dodone');if(b)b.click()}},
  {t:'おすすめ(場面からモデルと深さを選ぶ)',panel:true,when:palHas('#mrecipe'),run:palClick('#mrecipe')},
  {t:'考える深さ(/effort)を選ぶ',panel:true,when:palHas('#meffort'),run:palClick('#meffort')},
  {t:'このセッションを待ちにする (Waiting へ)',panel:true,when:palHas('#dopark'),run:palClick('#dopark')},
  {t:'このセッションの待ちを外す',panel:true,when:palHas('#unpark'),run:palClick('#unpark')},
  {t:'このセッションを棚卸し',panel:true,run:()=>{const b=$('#pscan');if(b)b.click()}},
  {t:'/compact を入力欄に',panel:true,run:()=>{const b=$('#mbody .mbtns .compact');if(b)b.click()}},
  {t:'このセッションのフォルダをエディタで開く',k:'{panel.editor}',panel:true,when:()=>native&&!!openCard&&!!openCard.project&&openCard.project!==(live.home||''),run:()=>openEditor(openCard)},
  {t:'セッションIDをコピー',k:'{panel.copyid}',panel:true,run:()=>{if(openCard)copyId(openCard)}},
  {t:'このセッションの変更をレビュー',k:'{panel.changes}',panel:true,when:()=>openCard&&openCard.agent==='claude',run:()=>openChanges(openCard)},
  {t:'送ったものを取り消す / 止める',k:'⌘C',panel:true,when:()=>!!openCard,run:()=>cancelSend(openCard)},
  {t:'このセッションの端末へ',k:'{panel.goterm}',panel:true,when:()=>openCard&&canGoTerm(openCard),run:()=>goTerm(openCard)},
  // two presses, as the button: this one arms it, Enter does it
  {t:'ここで開き直す(ほかの端末の claude を閉じて、パネルで再開)…',panel:true,when:palHas('#mtakeover'),run:palArm('#mtakeover')},
  {t:'パネルを閉じる',k:'Esc',panel:true,run:()=>closeDetail('palette')},
  {t:'完了を取り消す',panel:true,when:palHas('#undone'),run:palClick('#undone')},
  {t:'親セッションへ',k:'{panel.parent}',panel:true,when:palHas('#mparent'),run:palClick('#mparent')},
  {t:'表示: 全部',k:'1',panel:true,when:palHas('#mbody .viewpick button[data-v="all"]'),run:palClick('#mbody .viewpick button[data-v="all"]')},
  {t:'表示: 直前3つ',k:'2',panel:true,when:palHas('#mbody .viewpick button[data-v="last3"]'),run:palClick('#mbody .viewpick button[data-v="last3"]')},
  {t:'表示: 直前のみ',k:'3',panel:true,when:palHas('#mbody .viewpick button[data-v="last"]'),run:palClick('#mbody .viewpick button[data-v="last"]')},
  // the prompt in the conversation
  {t:'許可する',k:'{perm.allow}',panel:true,when:palHas('#mhist .askbox.held .askyes'),run:palClick('#mhist .askbox.held .askyes')},
  {t:'拒否する',k:'{perm.deny}',panel:true,when:palHas('#mhist .askbox.held .askno'),run:palClick('#mhist .askbox.held .askno')},
  {t:'許可確認に端末で答える',panel:true,when:()=>palHas('#mhist .askpass')()||palHas('#mhist .askgo')(),run:()=>{(palHas('#mhist .askpass')()?palClick('#mhist .askpass'):palClick('#mhist .askgo'))()}},
  {t:'送信待ちを端末で開いて届ける',panel:true,when:palHas('#qattach'),run:palClick('#qattach')},
  {t:'通知を許可する(システム設定)',when:()=>{const b=$('#notifybar');return !!b&&!b.hidden},run:palClick('#notifygo')},
  {t:'通知のお知らせをしばらく出さない',when:()=>{const b=$('#notifybar');return !!b&&!b.hidden},run:palClick('#notifyx')},
  {t:'送信待ちをもう一度送る',panel:true,when:palHas('#qretry'),run:palClick('#qretry')},
  {t:'送信待ちを取り消す',panel:true,when:palHas('#qcancel'),run:palClick('#qcancel')},
  {t:'パネルで再開する(claude --resume)',panel:true,when:palHas('#mresume'),run:palClick('#mresume')},
  {t:'パネル上部を畳む / 広げる',k:'{panel.fold}',panel:true,when:()=>!!$('#mfold'),run:()=>panelFoldSet(!panelFold)},
  {t:'カードを開いたらターミナルUIを出す',k:'{viewswap.meta}',when:()=>panelPref()!=='term',run:palClick('#pvterm')},
  {t:'カードを開いたら会話UIを出す',k:'{viewswap.meta}',when:()=>panelPref()!=='talk',run:palClick('#pvtalk')},
  {t:'このセッションをターミナルで開く(ここで開く / ここで再開)',k:'{panel.ptygo}',panel:true,when:palHas('#mbody .mbtns .ptygo'),run:palClick('#mbody .mbtns .ptygo')},
  // the send box and the new-session form
  {t:'ファイルを添付',panel:true,when:palHas('#mbody .attbtn'),run:palClick('#mbody .attbtn')},
  {t:'複製して送る を切り替え(この会話を複製した別のセッションに送る)',panel:true,when:palHas('#mbody .forkbtn'),run:palClick('#mbody .forkbtn')},
  {t:'入力ログ: 24時間だけ取る(キーの動きを ~/.rally/keylog.jsonl へ。変な入力の調査用)',when:()=>!klOn(),run:()=>{klSet(true);toast(document.body,'入力ログを取り始めました(24時間)')}},
  {t:'入力ログ: 止める(いま取っています)',when:()=>klOn(),run:()=>{klSet(false);toast(document.body,'入力ログを止めました')}},
  {t:'今の作業後に送る を切り替え(作業中のセッションには途中で渡さず、手が空いたら届ける。⌥⏎ で1回だけ逆の送り方)',panel:true,when:palHas('#mbody .wfbtn'),run:palClick('#mbody .wfbtn')},
  {t:'今の作業後に送る を取り消す(いちばん古いもの)',panel:true,when:palHas('#mhist .heldq .hcancel'),run:palClick('#mhist .heldq .hcancel')},
  {t:'今の作業後に送る を今すぐ送る(いちばん古いもの)',panel:true,when:palHas('#mhist .heldq .hnow'),run:palClick('#mhist .heldq .hnow')},
  {t:'複製した側の --worktree を切り替え',panel:true,when:palHas('#mbody .forkwt',true),run:palClick('#mbody .forkwt')},
  ...[['','既定'],['opus','opus'],['sonnet','sonnet'],['haiku','haiku'],['fable','fable']].map(([v,l])=>({t:'モデル: '+l,panel:true,when:palHas('#mbody [data-m="'+v+'"]',true),run:palClick('#mbody [data-m="'+v+'"]')})),
  {t:'エージェント: claude',panel:true,when:palHas('#nagent [data-v="claude"]'),run:palClick('#nagent [data-v="claude"]')},
  {t:'エージェント: codex',panel:true,when:palHas('#nagent [data-v="codex"]'),run:palClick('#nagent [data-v="codex"]')},
  {t:'--chrome を切り替え',panel:true,when:palHas('#nchrome',true),run:palClick('#nchrome')},
  {t:'計画だけ(--permission-mode plan)を切り替え',panel:true,when:palHas('#nplan',true),run:palClick('#nplan')},
  {t:'編集は自動で許可(--permission-mode acceptEdits)を切り替え',panel:true,when:palHas('#naccept',true),run:palClick('#naccept')},
  {t:'auto(--permission-mode auto)を切り替え',panel:true,when:palHas('#nauto',true),run:palClick('#nauto')},
  {t:'--worktree を切り替え',panel:true,when:palHas('#nwt',true),run:palClick('#nwt')},
  {t:'.worktreeinclude に足す',panel:true,when:palHas('#nwtinc'),run:palClick('#nwtinc')},
  // the pull request box
  {t:'PR: マージして片付け…',panel:true,when:palHas('#mpr .prfin[data-merge]'),run:palArm('#mpr .prfin[data-merge]')},
  {t:'PR: 片付け…',panel:true,when:()=>!!palFin(),run:()=>{const b=palFin();if(b&&!b.classList.contains('arm'))b.click();if(b)b.focus()}},
  // the change viewer
  {t:'レビューコメントをまとめて送る',k:'⌘Enter',when:palHas('.vnsend'),run:palClick('.vnsend')},
];
/** fzf's idea, small: every character in order, runs and word starts score. */
function fuzzy(q,s){
  q=fold(q);s=fold(s);
  if(!q)return 1;
  let i=0,score=0,run=0,last=-2;
  for(let j=0;j<s.length&&i<q.length;j++){
    if(s[j]!==q[i])continue;
    run=j===last+1?run+1:1;score+=run*3+(j===0||/[\s\/·:_\-.]/.test(s[j-1])?2:0);last=j;i++;
  }
  return i===q.length?score-s.length*0.01:0;
}
function palItems(subs){
  const out=[];
  const order={'approval':0,'needs-you':1,'answered':1,'working':2,'stale':3,'done':4,'idle':5};
  const cards=(live.cards||[]).filter(c=>!c.subagent).slice()
    .sort((a,b)=>(order[a.column]??9)-(order[b.column]??9)||(a.idleS||0)-(b.idleS||0));
  // sessions with the same title (a copy carries its parent's name) cannot be told apart by it: they get the icon, a
  // short id (複製 for a copy) and the words they last said, as the cards do
  const same=new Map();for(const c of cards){if(c.headless)continue;const t=c.title||short(c.project);same.set(t,(same.get(t)||0)+1)}
  for(const c of cards){
    const name=c.title||short(c.project),dup=!c.headless&&(same.get(name)||0)>1;
    const tag=dup?((c.copyOf||c.forkOf)?'複製 ':'')+'#'+String(c.id).slice(0,4):'';
    const snip=dup?String((c.last&&(c.last.assistant||c.last.human))||'').replace(/\s+/g,' ').slice(0,36):'';
    out.push({kind:'s',c,t:name,ic:c.icon||'',tag,sub:c.agent+' · '+short(c.project)+' · '+(COL_JA[c.column]||c.column)+' · '+ago(c.idleS||0)+'前'+(c.headless?' · ⚙':'')+(snip?' · '+snip:''),
      hay:name+' '+tag+' '+c.project+' '+c.agent+' '+(COL_JA[c.column]||'')+' '+((c.last&&c.last.assistant)||'').slice(0,200)+' '+c.id});
  }
  // subagents only when asked for (is:sub), by task, with the session they belong to
  if(subs)for(const k of (live.cards||[]).filter(x=>x.subagent).sort((a,b)=>(a.idleS||0)-(b.idleS||0))){
    const name=k.title||k.agentType||k.id.slice(0,14),par=(live.cards||[]).find(x=>!x.subagent&&x.id===k.parentId&&x.agent===k.agent),pn=par?(par.title||short(par.project)):'';
    out.push({kind:'s',c:k,t:'サブエージェント: '+name,sub:(pn?pn+' · ':'')+(kidAtWork(k)?'実行中':'結果')+' · '+ago(k.idleS||0)+'前',hay:'サブエージェント subagent '+name+' '+pn+' '+((k.last&&k.last.assistant)||'').slice(0,200)});
  }
  for(const a of PAL_ACTIONS)if((!a.panel||panelOpen())&&(!a.when||a.when()))out.push({kind:'a',a,t:a.t,sub:kmText(a.k||''),hay:a.t});
  // parked terminals: each back into its card's panel
  {const pk=typeof ptys!=='undefined'?ptyParked():[];
    for(const p of pk){const t='裏で動いているターミナル ('+pk.length+'): '+p.label;out.push({kind:'a',a:{run:()=>ptyUnpark(p)},t,sub:'パネルに出す',hay:t+' parked terminal'})}}
  return out;
}
let pal=null;
/** ⌘K: the words searched in what was said (lib/search.js), over the sessions on the board's hours */
function palConvo(q){
  const hours=boardHours();
  if(native)post({type:'search',q,hours});
  else fetch('api/search?q='+encodeURIComponent(q)+'&hours='+hours).then(r=>r.json()).then(j=>window.__kanban.searched({q,...j})).catch(()=>window.__kanban.searched({q,hits:{}}));
}
function openPalette(){
  if(pal){pal.inp.focus();pal.inp.select();return}
  const box=document.createElement('div');box.id='palette';
  box.innerHTML='<div class="pline"><span class="pp">❯</span><input spellcheck="false" autocomplete="off" placeholder="セッション・操作を検索"></div><div class="psug" hidden></div><div class="plist" role="listbox"></div>';
  document.body.appendChild(box);
  const inp=box.querySelector('input'),list=box.querySelector('.plist'),sug=box.querySelector('.psug');
  const back=document.activeElement;
  pal={box,inp,list,at:0,shown:[],back};pal.redraw=()=>draw();
  const draw=()=>{
    const q=inp.value.trim();
    const toks0=inp.value.match(/"[^"]*"|\S+/g)||[];
    const all=palItems(toks0.some(x=>/^is:(sub|subagents?)$/i.test(x)));
    let shown;
    // title: is: before: … narrow the sessions; what is left is matched as before
    const toks=q.match(/"[^"]*"|\S+/g)||[];
    const isOp=(x)=>/^(title|project|in|dir|agent|is|pr|before|after):./i.test(x)||/^#\d+$/.test(x);
    const opq=parseQuery(toks.filter(isOp).join(' ')),ws=toks.filter(x=>!isOp(x)).map(x=>x.replace(/^"|"$/g,''));
    const lift=(x)=>x.kind!=='s'?0:(YOU.has(x.c.column)?3:x.c.column==='working'?2:x.c.column==='stale'?1:0)+Math.max(0,2-(x.c.idleS||0)/43200);
    if(!q)shown=all.filter(x=>x.kind==='s').slice(0,40).concat(all.filter(x=>x.kind==='a'));
    else{
      // every word must match; sessions and actions compete on score (an operator leaves the sessions only)
      // ties favour your turn, then working, then recent
      shown=all.filter(x=>!opq.any||(x.kind==='s'&&matchQuery(opq,x.c))).map(x=>{let sc=0;for(const w of ws){const v=fuzzy(w,x.hay);if(!v)return null;sc+=v+fuzzy(w,x.t)}return {x,sc:sc+lift(x)}}).filter(Boolean)
        .sort((a,b)=>b.sc-a.sc).slice(0,60).map(y=>y.x);
      // what was said in the sessions: searched once the typing pauses, the sessions found there follow the title matches
      const cq=ws.join(' ').trim();
      if(cq.length>=2&&pal.cq!==cq){pal.cq=cq;pal.hits=null;clearTimeout(pal.ct);pal.ct=setTimeout(()=>palConvo(cq),350)}
      if(pal.hits&&pal.hitsQ===cq){
        // order: the words as written in the title, then the sessions that said them, then the looser (fuzzy) matches
        const lw=ws.map(w=>w.normalize('NFKC').toLowerCase()),exact=x=>x.kind==='s'&&lw.every(w=>String(x.t).normalize('NFKC').toLowerCase().includes(w));
        const said=[];
        for(const [k,sn] of Object.entries(pal.hits)){
          const c=(live.cards||[]).find(x=>x.agent+':'+x.id===k);if(!c||c.subagent||(opq.any&&!matchQuery(opq,c)))continue;
          said.push({kind:'s',c,t:c.title||short(c.project),ic:c.icon||'',tag:'会話の中',sub:sn});}
        const saidK=new Set(said.map(x=>x.c.agent+':'+x.c.id));
        const head=shown.filter(exact),rest=shown.filter(x=>!exact(x)&&!(x.kind==='s'&&saidK.has(x.c.agent+':'+x.c.id)));
        shown=[...head,...said.filter(x=>!head.some(h=>h.c===x.c)),...rest];
      }
      if(cq.length>=2&&!pal.hits)pal.searching=true;else pal.searching=false;
    }
    // the filter words that can be typed here; → takes the first
    const sg=searchSuggest(inp.value,live&&live.cards);pal.sug=sg;
    sug.hidden=!(sg.items.length||!q);
    sug.innerHTML=sg.items.length?'<span class="sgl">絞り込み</span>'+sg.items.slice(0,8).map((x,i)=>'<button type="button" class="sg" data-i="'+i+'" title="'+esc(x.desc)+'"><b>'+esc(x.label)+'</b>'+(x.desc?'<span>'+esc(x.desc)+'</span>':'')+'</button>').join('')+'<span class="sgk">→ で補完</span>'
      :!q?'<span class="sgl">絞り込み</span><span class="sgh">title: project: agent: is: before: after: pr: — 打つと候補が出ます</span>':'';
    pal.shown=shown;pal.at=Math.min(pal.at,Math.max(0,shown.length-1));
    list.innerHTML=(shown.length?shown.map((x,i)=>'<div class="pi'+(i===pal.at?' on':'')+(x.kind==='s'?' ps':' pa')+'" data-i="'+i+'">'
      +(x.kind==='s'?'<span class="dot '+(YOU.has(x.c.column)?'you':x.c.column==='working'?'work':x.c.column==='stale'?'stale':'')+(unreadShown(x.c)?' un':'')+'" style="'+(x.c.color?'background:'+esc(x.c.color):'')+'"></span>':'<span class="pk">›</span>')
      +(x.ic?'<span class="ico" aria-hidden="true">'+esc(x.ic)+'</span>':'')+'<b>'+esc(x.t)+'</b>'+(x.tag?'<span class="ptag">'+esc(x.tag)+'</span>':'')+'<span class="d">'+esc(x.sub)+'</span></div>').join(''):'<div class="dim">'+(pal.searching?'会話の中を探しています…':'該当なし')+'</div>')+(shown.length&&pal.searching?'<div class="dim psearching">会話の中も探しています…</div>':'');
    const on=list.querySelector('.pi.on');if(on)on.scrollIntoView({block:'nearest'});
  };
  const go=(i)=>{const x=pal.shown[i];if(!x)return;const pal0=pal.back;closePalette(true);
    if(x.kind==='a'){const back=pal0;x.a.run();setTimeout(()=>{const a=document.activeElement;if(!a||a===document.body){if(back&&document.contains(back)&&!back.closest('[hidden]'))back.focus({preventScroll:true});else focusHome()}},0);return}
    const k=x.c.agent+':'+x.c.id;
    const el=cardEls().find(e=>e.dataset.agent+':'+e.dataset.id===k);
    if(el)selectEl(el);
    openDetail(x.c,false,{focus:false});
    if(el)el.focus({preventScroll:true});};
  const takeSug=(i)=>{const x=pal.sug&&pal.sug.items[i];if(!x)return false;
    const t=pal.sug.tok;inp.value=inp.value.slice(0,inp.value.length-t.length)+x.insert;pal.at=0;draw();inp.focus();return true};
  sug.addEventListener('mousedown',e=>{const b=e.target.closest('.sg');if(b){e.preventDefault();takeSug(+b.dataset.i)}});
  inp.addEventListener('input',()=>{pal.at=0;draw()});
  inp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    const k=e.key;
    if(k==='Escape'){e.preventDefault();e.stopPropagation();closePalette();return}
    if(k==='ArrowDown'||(e.ctrlKey&&(k==='n'||k==='j'))||(k==='Tab'&&!e.shiftKey)){e.preventDefault();pal.at=Math.min(pal.shown.length-1,pal.at+1);draw();return}
    if(k==='ArrowUp'||(e.ctrlKey&&(k==='p'||k==='k'))||(k==='Tab'&&e.shiftKey)){e.preventDefault();pal.at=Math.max(0,pal.at-1);draw();return}
    if(k==='ArrowRight'&&inp.selectionStart===inp.value.length&&inp.selectionEnd===inp.value.length&&takeSug(0)){e.preventDefault();return}
    if(k==='Enter'){e.preventDefault();e.stopPropagation();go(pal.at);return}
  });
  list.addEventListener('mousedown',e=>{const r=e.target.closest('.pi');if(r){e.preventDefault();go(+r.dataset.i)}});
  box.addEventListener('mousedown',e=>{if(e.target===box){e.preventDefault();closePalette()}});
  draw();inp.focus();
}
function closePalette(acting){
  if(!pal)return;const {box}=pal;let {back}=pal;pal=null;box.remove();
  // a card keeps DOM focus after the keys moved the selection on: going back to it would jump to that stale card
  if(back&&back.closest&&back.closest('.card')&&sel){const el=cardEls().find(x=>x.dataset.agent+':'+x.dataset.id===sel);if(el)back=el}
  if(!acting&&back&&back.focus&&document.contains(back))back.focus({preventScroll:true});
}
// ⌘K reaches it from anywhere, the message box included; `:` from the board
document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  // ⌘C / ⌃C: cancel what was just sent to the open session — unless there is text to copy
  if((e.key==='c'||e.key==='C')&&!e.altKey&&!e.shiftKey&&(e.metaKey!==e.ctrlKey)&&panelOpen()&&openCard&&!viewer&&!pal&&e.keyCode!==229){
    const a=document.activeElement||{};
    // only from the board or this panel's own box
    const inBox=a.tagName==='TEXTAREA'&&a.closest&&a.closest('#mbody .msg');
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName||'')&&!inBox)return;
    const fieldSel=typeof a.selectionStart==='number'&&a.selectionStart!==a.selectionEnd;
    const pageSel=String((window.getSelection&&window.getSelection())||'').length>0;
    if(e.metaKey&&(fieldSel||pageSel))return;             // a copy
    if(e.ctrlKey&&fieldSel)return;
    e.preventDefault();e.stopImmediatePropagation();cancelSend(openCard);return}
  if(kmAct(e,true)==='palette.meta'){e.preventDefault();e.stopImmediatePropagation();pal?closePalette():openPalette();return}
  const t=e.target||{};const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||'')||t.isContentEditable||!!(t.closest&&t.closest('.xterm'));
  if(!typing&&!viewer&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&kmAct(e)==='palette.colon'){e.preventDefault();e.stopImmediatePropagation();openPalette()}
},true);
