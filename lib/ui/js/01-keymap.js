/**
 * Every rebindable key: id → [group, description, default]. Handlers, the ? list, the palette and
 * tooltips all read from here. Overrides live in localStorage 'keymap' (versioned); an unreadable or
 * conflicting set falls back to the defaults. ⌥ and ⌃ are never bound (text field / terminal).
 */
const KM_GROUPS=[['board','ボード'],['panel','パネルを開いているとき'],['meta','どこでも(⌘)']];
const KM_DEFS=[
  ['nav.down','board','カードを下へ','j'],['nav.up','board','カードを上へ','k'],['nav.right','board','右の列へ','l'],['nav.left','board','左の列へ','h'],
  ['nav.top','board','先頭のカードへ','g'],['nav.bottom','board','末尾のカードへ','G'],['open.o','board','開く(Enter でも開く)','o'],
  ['filter.slash','board','探す(パレット)(パネルを開いているときは入力欄でコマンド)','/'],['filter.f','board','探す(パレット)','f'],
  ['palette.colon','board','パレット',':'],['reload.key','board','読み直す','r'],
  ['pending.key','board','残作業',''],['theme.key','board','ライト / ダーク',''],
  ['hours.up','board','表示する時間を広げる','+'],['hours.up2','board','表示する時間を広げる(もう1つ)','='],
  ['hours.down','board','表示する時間を狭める','-'],['done.toggle','board','終わったものを表示 / 隠す',''],['subs.toggle','board','自動実行を表示 / 隠す',''],
  ['term.key','board','ターミナルを表示 / 隠す',''],['help.key','board','ショートカット一覧','?'],
  ['panel.input','panel','入力欄へ','i'],['panel.copyid','panel','セッションIDをコピー','y'],
  ['panel.fold','panel','パネル上部を畳む / 広げる','['],['panel.parent','panel','親セッションへ','b'],['panel.reply','panel','最新の回答に返信','R'],
  ['panel.changes','panel','変更をレビュー','D'],['panel.goterm','panel','このセッションの端末へ','T'],['panel.editor','panel','フォルダをエディタで開く','E'],
  ['panel.ptygo','panel','ターミナルで開く / 再開','O'],['hist.down','panel','会話を下へスクロール','J'],['hist.up','panel','会話を上へスクロール','K'],
  ['palette.meta','meta','パレット','⌘k'],['new.meta','meta','新規セッション','⌘n'],['filter.meta','meta','探す(パレット)','⌘f'],
  ['term.meta','meta','ターミナルを表示して入る / 隠す','⌘j'],['split.meta','meta','ターミナルを分割','⌘d'],['shell.meta','meta','シェルを開く','⌘t'],
  ['close.meta','meta','キーのある区画を閉じる','⌘w'],['card.prev','meta','前のカードへ(ターミナル帯の中では前の区画へ)','⌘['],
  ['card.next','meta','次のカードへ(ターミナル帯の中では次の区画へ)','⌘]'],['card.up','meta','前のカードへ(パネルごと)','⌘ArrowUp'],
  ['card.down','meta','次のカードへ(パネルごと)','⌘ArrowDown'],['go.right','meta','右の場所へ(リスト → パネル → ターミナル)','⌘ArrowRight'],
  ['go.left','meta','左の場所へ','⌘ArrowLeft'],['viewswap.meta','meta','パネルのターミナル ⇄ 会話','⌘\\'],
  ['help.meta','meta','ショートカット一覧','⌘/'],['help.meta2','meta','ショートカット一覧(もう1つ)','⌘?'],
  ['perm.allow','meta','許可確認に 許可','⌘y'],['perm.deny','meta','許可確認に 拒否','⌘⇧y'],
];
const KM_DEF=new Map(KM_DEFS.map(d=>[d[0],d]));
// On a US keyboard `:` needs ⇧, so the palette gets `;`.
const KM_PRESETS={jis:{},us:{'palette.colon':';'}};
// ⌘ keys owned by the system or text editing
const KM_RESERVED_META=new Set(['q','h','m',',','x','c','v','a','z','r','w','s','p','`',' ']);
const KM_NAMED=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
const KM_ARROW={ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓'};
/** Full-width forms (IME left on) and the yen key fold to what they stand for. */
// a Japanese keyboard's ¥ is the \\ key: seen once (or a Japanese Mac), keys are labelled ¥ so they match the keycap
let kmYen=(()=>{try{return localStorage.getItem('kmyen')==='1'}catch(e){return false}})()||/^ja/i.test(navigator.language||'');
function kmFold(k){
  if(k==='・')return '/';if(k==='¥'||k==='￥'){if(!kmYen){kmYen=true;try{localStorage.setItem('kmyen','1')}catch(e){}}return '\\'}if(k==='　')return ' ';
  const c=k.length===1?k.charCodeAt(0):0;
  return c>=0xFF01&&c<=0xFF5E?String.fromCharCode(c-0xFEE0):k;
}
/** '' for what can never be bound (⌃ ⌥, a bare modifier). ctrlAsMeta: ⌃ counts as ⌘. */
function kmCanon(e,ctrlAsMeta){
  const meta=e.metaKey||(ctrlAsMeta&&e.ctrlKey&&!e.metaKey);
  if((e.ctrlKey&&!meta)||e.altKey||(e.ctrlKey&&e.metaKey))return '';
  const k=kmFold(e.key||'');
  if(!k||/^(Shift|Meta|Control|Alt|CapsLock|Dead|Process|Unidentified)$/.test(k))return '';
  const letter=/^[a-z]$/i.test(k);
  if(meta)return '⌘'+(e.shiftKey&&(letter||k.length>1)?'⇧':'')+(letter?k.toLowerCase():k);
  return k.length===1?k:(e.shiftKey?'⇧':'')+k;
}
function kmParse(s){
  if(typeof s!=='string'||!s)return null;
  let meta=false,shift=false,k=s;
  if(k[0]==='⌘'){meta=true;k=k.slice(1);if(k[0]==='⇧'){shift=true;k=k.slice(1)}}
  return k&&(k.length===1||KM_NAMED.has(k))?{meta,shift,k}:null;
}
/** Why a key cannot be this action's ('' if it can). Conflicts are kmHolder's. */
function kmBad(id,s){
  const d=KM_DEF.get(id);if(!d)return '不明な操作です';
  if(s===d[3])return '';
  const p=kmParse(s);
  if(!p)return 'このキーは使えません';
  if(p.meta&&p.shift)return '同時押しは2つまでです(修飾キー1つ + キー1つ)';
  if(!p.meta){
    if(p.k.length>1)return '矢印などのキーは、⌘ と組み合わせたときだけ使えます';
    if(p.k===' ')return 'Space は開く / 閉じるに使っています';
    if(/^[0-9]$/.test(p.k))return '数字は許可確認の選択と表示の切り替えに使っています';
    return '';
  }
  if(p.k.length>1)return '⌘ + 矢印は入力欄の行頭・行末への移動です(移動の4つの操作だけが使います)';
  if(KM_RESERVED_META.has(p.k))return '⌘'+p.k.toUpperCase()+' はシステムか入力欄の編集に使われます';
  return '';
}
function kmHolder(id,s,map){if(!s)return '';for(const [k,v] of (map||kmMap))if(k!==id&&v===s)return k;return ''}
function kmMerge(over){const m=new Map(KM_DEFS.map(d=>[d[0],d[3]]));for(const [id,s] of Object.entries(over))m.set(id,s);return m}
// '' is unbound (pressed by mistake, s / a / t / p / L changed the view): never a clash
function kmDupes(m){const v=[...m.values()].filter(Boolean);return new Set(v).size!==v.length}
/** A bad entry or a clash gives the defaults back. */
function kmLoad(){
  let o=null;
  try{o=JSON.parse(localStorage.getItem('keymap')||'null')}catch(e){}
  if(!o||o.v!==1||!o.keys||typeof o.keys!=='object'||Array.isArray(o.keys))return {};
  const over={};
  for(const [id,s] of Object.entries(o.keys)){if(KM_DEF.has(id)&&typeof s==='string'&&!kmBad(id,s)&&s!==KM_DEF.get(id)[3])over[id]=s}
  return kmDupes(kmMerge(over))?{}:over;
}
function kmSave(){
  try{if(Object.keys(kmOver).length)localStorage.setItem('keymap',JSON.stringify({v:1,keys:kmOver}));else localStorage.removeItem('keymap')}catch(e){}
}
let kmOver=kmLoad(),kmMap=kmMerge(kmOver),kmRev=new Map();
function kmBuild(){kmMap=kmMerge(kmOver);kmRev=new Map([...kmMap].filter(([,s])=>s).map(([id,s])=>[s,id]))}
kmBuild();
function kmSet(id,s){
  const why=kmBad(id,s);if(why)return why;
  const h=kmHolder(id,s);if(h)return 'すでに「'+KM_DEF.get(h)[2]+'」に使われています';
  if(s===KM_DEF.get(id)[3])delete kmOver[id];else kmOver[id]=s;
  kmChanged();return '';
}
function kmReset(id){delete kmOver[id];kmChanged()}
function kmResetAll(){kmOver={};kmChanged()}
function kmPreset(name){
  const p=KM_PRESETS[name];if(!p)return '不明なプリセットです';
  kmOver={...p};kmChanged();return '';
}
function kmPresetNow(){for(const [n,p] of Object.entries(KM_PRESETS)){if(JSON.stringify(Object.entries(p).sort())===JSON.stringify(Object.entries(kmOver).sort()))return n}return ''}
function kmChanged(){kmBuild();kmSave();kmApply()}
function kmAct(e,ctrlAsMeta){const c=kmCanon(e,ctrlAsMeta);return c&&kmRev.get(c)||''}
function kmKey(id){return kmMap.get(id)||''}
function kmLabel(s){
  if(s==='')return 'なし';   // an unbound action (Keyboard Shortcuts shows it so)
  const p=kmParse(s);if(!p)return s===' '?'Space':s;
  const k=KM_ARROW[p.k]||(p.k===' '?'Space':p.k==='\\'&&kmYen?'¥':p.k);
  if(p.meta)return '⌘'+(p.shift?'⇧':'')+(k.length===1?k.toUpperCase():k);
  return /^[A-Z]$/.test(k)?'⇧'+k:k;
}
function kmL(id){return kmLabel(kmKey(id))}
/** `{id}` inside a string becomes that action's key. */
function kmText(s){return String(s).replace(/ \(\{([\w.]+)\}\)/g,(m,id)=>KM_DEF.has(id)&&!kmKey(id)?'':m).replace(/\{([\w.]+)\} \/ /g,(m,id)=>KM_DEF.has(id)&&!kmKey(id)?'':m).replace(/ \/ \{([\w.]+)\}/g,(m,id)=>KM_DEF.has(id)&&!kmKey(id)?'':m).replace(/\{([\w.]+)\}/g,(m,id)=>KM_DEF.has(id)?(kmKey(id)?kmL(id):''):m)}
// titles keep their {id} template in data-kt so they are refilled when a key changes
function kmApply(){
  for(const el of document.querySelectorAll('[title*="{"],[data-kt]')){if(!el.dataset.kt)el.dataset.kt=el.getAttribute('title')||'';el.title=kmText(el.dataset.kt)}
  const nk=document.querySelector('#new .kk');if(nk)nk.textContent=kmL('new.meta');
  for(const el of document.querySelectorAll('.yaynew .kk'))el.textContent=kmL('new.meta');
  // the ターミナルUI / 会話UI switch shows the key that flips it
  for(const el of document.querySelectorAll('.pvkk'))el.textContent=kmL('viewswap.meta');   // in the button you would switch to
}
kmApply();
// capture phase, first: while a key is being chosen (92-keyset.js) the press is the choice, not a command
let keyCap='';
document.addEventListener('keydown',e=>{if(keyCap)kmCapKey(e)},true);
