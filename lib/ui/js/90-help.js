// Every shortcut in one table; the ? list is drawn from it.
const SHORTCUTS=[
  ['どこでも',[['⌘+ ⌘- ⌘0','画面を拡大 / 縮小 / 元の大きさ(メニューの View)'],['{palette.meta} / {palette.colon}','パレット(セッション・操作を検索。画面のボタンはすべてここからも押せます)'],['{new.meta}','新規セッション(もう一度で閉じる)'],['{filter.meta} / {filter.f} / {filter.slash}','絞り込み(パネルを開いているときの {filter.slash} は入力欄でコマンド)'],['{term.meta} / {term.key}','ターミナルを表示して入る / 隠す(ターミナルの中では隠す)'],['{split.meta}','ターミナルを分割(右の列なら上下、下の帯なら左右。exit か × で閉じる)'],['{shell.meta}','シェルを開く(区画が並ぶ)'],['{close.meta}','キーのある区画を閉じる(セッションの区画は切り離すだけ)'],['{card.prev} / {card.next}','パネルを開いているとき: 前 / 次のカードへ(入力中の欄・パネルのターミナルからでも。書きかけは残ります)。下のターミナル帯の中では: その区画を移る'],['clear / ⌃L','ターミナルの区画を消去(コマンドの行でもシェルでも)'],['{help.meta} / {help.meta2} / {help.key}','このショートカット一覧'],['⌘C / ⌃C','送ったものを取り消す(文字選択中はコピー)'],['⌘R','読み直す'],['{perm.allow} / {perm.deny}','開いているセッションの許可確認に 許可 / 拒否']]],
  ['ボード',[['↑↓ / {nav.down} {nav.up}','カードを移る(ターミナルが出ていれば、一番下で ↓ はターミナルへ)'],['←→ / {nav.left} {nav.right}','隣の列へ'],['{nav.top} / {nav.bottom}','先頭 / 末尾'],['Enter / {open.o}','開く(開いていれば入力欄へ)'],['Space','開く / 閉じる'],['クリック','開く(もう一度で閉じる)・ダブルクリックで入力欄へ'],['{done.toggle}','終わったものを表示 / 隠す'],['{subs.toggle}','自動実行を表示 / 隠す'],['{pending.key}','残作業(もう一度で閉じる)'],['{theme.key}','ライト / ダーク'],['{hours.up} {hours.up2} / {hours.down}','表示する時間を広げる / 狭める'],['{reload.key}','読み直す'],['Esc','入力を抜ける → パネルを閉じる → 選択を外す']]],
  ['パネル',[['{panel.input} / Enter','ターミナルへ(開いていれば)・それ以外は入力欄へ'],['{term.meta}','ターミナルから抜ける(パネルのものは抜けるだけ)'],['1 2 3','全部 / 直前3つ / 直前のみ(許可確認が出ているときは、端末と同じ番号の選択肢)'],['PageUp/Down・⇧↑↓ / {hist.down} {hist.up}','会話をスクロール'],['{panel.changes}','変更をレビュー(n p ファイル移動、行クリックか c でコメント、⌘Enter でまとめて送る、もう一度 {panel.changes} で閉じる)'],['{panel.goterm}','このセッションの端末へ(対話中のもの)'],['{panel.ptygo}','このセッションをターミナルで開く(ここで開く / ここで再開)'],['{panel.editor}','このセッションのフォルダをエディタで開く'],['{viewswap.meta}','ターミナル ⇄ 会話(ターミナルの中からでも)'],['{go.right} / {go.left}','右 / 左の場所へ: リスト → パネル → ターミナル。画面に並んでいる順に1つずつ(⌥ + 矢印は文字送りのまま)'],['{card.down} / {card.up}','パネルごと次 / 前のカードへ({card.next} {card.prev} と同じ)'],['{panel.copyid}','セッションIDをコピー'],['{panel.fold}','パネル上部を畳む / 広げる'],['{panel.parent}','親セッションへ(サブエージェント)'],['{panel.reply}','最新の回答に返信(会話の ↩、選んだ文字の「ここに返信」でも)']]],
  ['入力欄',[['Enter / ⇧Enter','送信 / 改行'],['⌥Enter','今の作業後に送る(チップがオンなら今すぐ)を1回だけ'],['/','スキル(↑↓ Tab Enter)'],['@','ファイル名を補完'],['↑↓(空のとき)','送った履歴'],['Esc','入力を抜ける(返信中で空なら、まず返信をやめる)']]],
  ['ビューワー',[['1 2 3 / Tab','プレビュー / ソース / 差分'],['j k Space','スクロール'],['o / y','Finder で表示 / パスをコピー'],['Esc / q','閉じる']]],
];
function drawHelp(){
  const h=$('#help');if(!h)return;
  h.innerHTML='<div class="hwin"><div class="hbar"><span class="pp">❯</span> ショートカット<span style="flex:1"></span><button class="hkeys" title="キーバインドを設定">設定</button><button class="hclose" title="閉じる (Esc)">✕</button></div><div class="hbody">'
    +SHORTCUTS.map(([g,rows])=>'<section><h3>'+esc(g)+'</h3>'+rows.filter(([k])=>kmText(k).trim()).map(([k,w])=>'<div class="hrow"><kbd>'+esc(kmText(k))+'</kbd><span>'+esc(kmText(w))+'</span></div>').join('')+'</section>').join('')+'</div></div>';
  h.querySelector('.hclose').onclick=()=>{h.hidden=true};
  h.querySelector('.hkeys').onclick=()=>{h.hidden=true;if(!panelOpen()||panelKey!=='keys')togglePanel('keys',openKeys)};
  h.onmousedown=e=>{if(e.target===h){e.preventDefault();h.hidden=true}};
}
function toggleHelp(){const h=$('#help');if(!h)return;if(h.hidden)drawHelp();h.hidden=!h.hidden}
{const hb=$('#helpbtn');if(hb)hb.onclick=toggleHelp}
// ⌘ shortcuts: from anywhere, the message box included
document.addEventListener('keydown',e=>{
  if(!e.metaKey||e.ctrlKey||e.altKey||e.isComposing||e.keyCode===229)return;
  const A=kmAct(e);
  // ⌘Y / ⌘⇧Y answer the open card's prompt, only the one the panel shows (never one unseen)
  if(A==='perm.allow'||A==='perm.deny'){
    if(!openCard||!openCard.permAsk||openCard.permAsk.questions)return;
    e.preventDefault();e.stopImmediatePropagation();
    const box=$('#mhist .askbox.held');
    if(box&&box.dataset.perm===openCard.permAsk.id&&!box.querySelector('button:disabled'))permAnswer(openCard,A==='perm.deny'?'deny':'allow');
    return}
  const act={
    'new.meta':()=>toggleNew('⌘N'),
    'filter.meta':()=>openPalette(),
    // ⌘J in the terminal hides it; elsewhere it opens it and goes in
    'term.meta':()=>{const i=paneIn(activePane());
      if(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm')){document.activeElement.blur();return}
      const inTerm=document.activeElement===i||inPty();if(inTerm){document.activeElement.blur();termOpen(false);return}if(!goTerminal(true,true)){termOpen(true);if(ptyOn!=='cmd')ptyShow(ptyOn);else if(i&&!i.disabled)i.focus()}},
    'help.meta':toggleHelp,'help.meta2':toggleHelp,
    'viewswap.meta':()=>panelPrefSet(panelPref()==='term'?'talk':'term'),
    'split.meta':()=>splitPane(),
    // in the strip: its panes; elsewhere: the card before / after
    'card.prev':()=>stripOrPanel()?paneStep(-1):cardStep(-1),
    'card.next':()=>stripOrPanel()?paneStep(1):cardStep(1),
    'shell.meta':()=>{if(!ptyOpen('shell',{label:'シェル',cwd:term.cwd||''}))toast(document.body,'シェルはアプリの中でだけ開けます')},
    'close.meta':()=>{if(!paneCloseFocused())toast(document.body,'閉じる区画がありません(最後のコマンド行は閉じません)')},
  }[A];
  if(!act)return;
  e.preventDefault();e.stopImmediatePropagation();act();
},true);

// ⌘←/→: between list, panel and terminal as laid out; ⌘↑/↓ in the panel: previous / next card.
// ⌘ only: ⌥+arrows stay the text field's.
function paneWhere(){
  const a=document.activeElement;
  if(a&&a.closest){if(a.closest('#term'))return 'strip';if(a.closest('#detail'))return 'panel'}
  return termSel?'strip':'list';
}
function paneGo(to){
  if(to==='strip')return goTerminal(true,true);
  setTermSel(false);
  if(to==='panel'){
    if(!panelOpen())return false;
    const tp=panelLivePty();if(tp){tp.xt.focus();return true}
    const b=msgBox();if(b&&!b.disabled){b.focus();return true}return false}
  const k=sel||openFor;if(k)focusHome(k);return true;
}
function paneMove(dx){
  const at=paneWhere();
  const next=dx>0?(at==='list'?(panelOpen()?'panel':'strip'):at==='panel'?'strip':null)
    :(at==='strip'?(panelOpen()?'panel':'list'):at==='panel'?'list':null);
  return next?paneGo(next):false;
}
document.addEventListener('keydown',e=>{
  if(e.shiftKey||e.ctrlKey||e.altKey||e.isComposing||e.keyCode===229||!e.metaKey)return;
  const A=kmAct(e);
  if(A==='card.up'||A==='card.down'){
    if(!panelOpen()||stripOrPanel())return;
    e.preventDefault();e.stopImmediatePropagation();cardStep(A==='card.down'?1:-1);return}
  if(A!=='go.right'&&A!=='go.left')return;
  // no step possible: the key stays the field's
  const at=paneWhere(),dx=A==='go.right'?1:-1;
  const can=dx>0?(at==='list'||at==='panel'):(at==='strip'||at==='panel');
  if(!can)return;
  if(dx>0&&at==='panel'&&window.innerWidth<1011)return;
  e.preventDefault();e.stopImmediatePropagation();paneMove(dx);
},true);
