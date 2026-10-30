// 設定: キーバインド — choosing keys (01-keymap.js holds the table and the rules). A taken,
// reserved or 3+-key combination is refused with the reason while the panel keeps listening.
let keyMsg={t:'',warn:false};
function openKeys(){
  keepUnsent();   // keep the unsent draft
  keyCap='';keyMsg={t:'',warn:false};
  $('#mtitle').textContent=t('キーバインドの設定');$('#detail').classList.remove('sess');
  $('#mbody').innerHTML='<div class="keyset"></div>';
  openFor=null;openCard=null;panelKey='keys';delete $('#detail').dataset.color;$('#detail').classList.remove('hued');
  $('#detail').hidden=false;document.body.classList.add('withpanel');
  keyDraw('');
}
function keyDraw(msg,warn,focusId){
  const box=$('#mbody .keyset');if(!box||panelKey!=='keys')return;
  if(msg!==undefined&&msg!==null)keyMsg={t:msg,warn:!!warn};
  const now=kmPresetNow(),top=box.scrollTop;
  box.innerHTML='<div class="kpre">'+t('配列:')+' <button class="mini kpb'+(now==='jis'?' on':'')+'" data-p="jis" title="'+t('いまの標準の割り当て')+'">'+t('標準(JIS・日本語配列向け)')+'</button>'
    +'<button class="mini kpb'+(now==='us'?' on':'')+'" data-p="us" title="'+t('US配列で ⇧ を押す : を ; に')+'">'+t('US配列向け')+'</button>'
    +'<button class="mini" id="kall"'+(Object.keys(kmOver).length?'':' disabled')+'>'+t('全部を既定に戻す')+'</button>'+(now?'':'<span class="dim">'+t('カスタム')+'</span>')+'</div>'
    +'<div class="kmsg'+(keyMsg.warn?' warn':'')+'" role="status">'+esc(keyCap?(keyMsg.t?keyMsg.t+' — ':'')+t('「{what}」の新しいキーを押してください(Esc でやめる)',{what:KM_DEF.get(keyCap)[2]}):keyMsg.t||t('キーをクリックして、新しいキーを押します。'))+'</div>'
    +KM_GROUPS.map(([g,gl])=>'<section><h3>'+esc(gl)+'</h3>'+KM_DEFS.filter(d=>d[1]===g).map(([id,,what,def])=>{
      const custom=kmKey(id)!==def;
      return '<div class="krow"><span class="kl">'+esc(what)+'</span><button class="kkey'+(custom?' custom':'')+(keyCap===id?' cap':'')+'" data-id="'+id+'" title="'+t('クリックして変更(いまは {now}、既定は {def})',{now:esc(kmL(id)),def:esc(kmLabel(def))})+'">'+esc(keyCap===id?t('キーを押してください'):kmL(id))+'</button>'
        +'<button class="mini kreset" data-id="'+id+'" title="'+t('既定の {def} に戻す',{def:esc(kmLabel(def))})+'"'+(custom?'':' hidden')+'>'+t('既定に戻す')+'</button></div>'}).join('')+'</section>').join('')
    +'<div class="kfix">'+t('変えられないキー: Enter · Space · Esc · ↑↓←→ · PageUp/PageDown · 数字(許可確認の選択・表示の切り替え) · ⌘C / ⌃C · ⌃L · ⌘R · ⌘V など入力欄の編集 · ⌥ + 矢印(文字送り)。ビューワーと入力欄の中のキーも固定です。同時に押すのは2つまで(修飾キー1つ + キー1つ)です。')+'</div>';
  box.scrollTop=top;
  for(const b of box.querySelectorAll('.kkey'))b.onclick=()=>{keyCap=b.dataset.id;keyDraw('',false,b.dataset.id)};
  for(const b of box.querySelectorAll('.kreset'))b.onclick=()=>{const id=b.dataset.id;kmReset(id);keyDraw(t('「{what}」を既定の {key} に戻しました',{what:KM_DEF.get(id)[2],key:kmL(id)}),false,id)};
  for(const b of box.querySelectorAll('.kpb'))b.onclick=()=>{keyCap='';kmPreset(b.dataset.p);keyDraw(t('{name} にしました',{name:b.textContent}))};
  const all=box.querySelector('#kall');if(all)all.onclick=()=>{keyCap='';kmResetAll();keyDraw(t('全部を既定に戻しました'))};
  if(focusId){const f=box.querySelector('.kkey[data-id="'+focusId+'"]');if(f)f.focus({preventScroll:true})}
}
/** The key pressed while a key is being chosen (01-keymap.js calls it first of all handlers). */
function kmCapKey(e){
  // the panel went away mid-choice
  if(panelKey!=='keys'||$('#detail').hidden){keyCap='';return}
  e.preventDefault();e.stopImmediatePropagation();
  if(/^(Shift|Meta|Control|Alt|CapsLock)$/.test(e.key))return;   // the key itself comes next
  const id=keyCap;
  if(e.key==='Escape'){keyCap='';keyDraw('',false,id);return}
  if(e.isComposing||e.keyCode===229){keyDraw(t('日本語入力の途中です。入力をオフにして押してください'),true,id);return}
  if(e.ctrlKey||e.altKey){keyDraw(t('{mod} は使えません(⌥ + 矢印は入力欄の文字送り、⌃ はターミナルのキーです)',{mod:e.altKey?'⌥':'⌃'}),true,id);return}
  const s=kmCanon(e),why=s?kmSet(id,s):t('このキーは使えません');
  if(why){keyDraw((s?t('{key} は使えません — ',{key:kmLabel(s)}):'')+why,true,id);return}
  keyCap='';keyDraw(t('「{what}」を {key} にしました',{what:KM_DEF.get(id)[2],key:kmL(id)}),false,id);
}
// a click elsewhere stops listening
document.addEventListener('mousedown',e=>{
  if(!keyCap||(e.target.closest&&e.target.closest('.kkey.cap')))return;
  keyCap='';const b=document.querySelector('#mbody .kkey.cap');if(b){b.classList.remove('cap');b.textContent=kmL(b.dataset.id)}
},true);
// posted by the app's menu bar item (Rally ▸ キーボードショートカット…)
document.addEventListener('ak-keys',()=>togglePanel('keys',openKeys));

// ⚙ in the header: the settings that otherwise sat only in the macOS menu bar (Rally → Keyboard Shortcuts…), which a
// full-screen window hides
{const b=$('#setbtn'),m=b&&b.parentElement&&b.parentElement.querySelector('.setmenu');
  // the header clips what overflows it: the menu lives on the page itself
  if(b&&m){document.body.appendChild(m);b.onclick=e=>{e.stopPropagation();m.hidden=!m.hidden;if(!m.hidden){const r=b.getBoundingClientRect();m.style.top=Math.round(r.bottom+4)+'px';m.style.right=Math.round(window.innerWidth-r.right)+'px'}};
    for(const x of m.querySelectorAll('button'))x.onclick=e=>{e.stopPropagation();m.hidden=true;const s=x.dataset.s;
      if(s==='keys')togglePanel('keys',openKeys);
      else if(s==='cards'){const c=$('#cardshowbtn')||document.querySelector('[id^="cardshow"]');if(c)c.click()}
      else if(s==='theme'){const t=$('#theme');if(t)t.click()}
      else if(s==='help'){const h=$('#helpbtn');if(h)h.click()}
      else if(s==='lang')langSet(LANG==='en'?'ja':'en')}}}
