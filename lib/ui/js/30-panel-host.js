// closing the detail panel, Escape, focus after, pendLine
function closeDetail(why){
  // リスト docked: the right side is never left empty (see listKeep)
  if(listDocked()&&openFor&&/^(x|esc|toggle|space|palette)$/.test(why||'')){listKeys();return}
  keepUnsent();
  const was=openFor;
  setTimeout(syncOpened,0);
  panelTermRelease('');document.body.classList.remove('pterm-on');
  openFor=null;openCard=null;panelKey='';
  const d=$('#detail');const inside=!!(d.contains&&d.contains(document.activeElement));d.hidden=true;document.body.classList.remove('withpanel');
// focus was in the panel (or nowhere): back to the card, not <body>
  if(inside||!document.activeElement||document.activeElement===document.body)focusHome(was);
  syncPanelBtns();
  delete d.dataset.color;
  try{if(native)post({type:'log',text:'close('+(why||'?')+') hidden='+d.hidden})}catch(e){}
// a 新規 / jobs panel closed in the docked list: the selected row comes back
  if(listDocked()&&why!=='empty')listKeep();
}
laneDropSetup();
document.addEventListener('click',()=>{for(const m of document.querySelectorAll('.modemenu'))m.hidden=true});
$('#mclose').onclick=()=>closeDetail('x');
// Where focus goes when its holder goes away: the card, else the panel's box — never <body>.
function focusHome(key){
  const k=key||sel;
  const el=k&&cardEls().find(x=>x.dataset.agent+':'+x.dataset.id===k);
  if(el){el.focus({preventScroll:true});return el}
  if(panelOpen()){const b=$('#mbody .msg textarea')||$('#mclose');if(b){b.focus({preventScroll:true});return b}}
  return null;
}
$('#mclose').title='閉じる (Esc)';

// Escape while typing leaves the field first (the draft stays); a second Escape closes the panel.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||e.isComposing||e.keyCode===229)return;
  const t=document.activeElement||{};
  if(inPty())return;                  // Esc in a real terminal is the program's (Claude's interrupt)
  if(listDocked()&&openFor&&$('#detail').contains(t)&&(/^(INPUT|TEXTAREA)$/.test(t.tagName||'')||t.isContentEditable)){t.blur();listKeys();return}   // リスト: out of the field onto the list, the draft kept
  if(/^(INPUT|TEXTAREA)$/.test(t.tagName||'')||t.isContentEditable){t.blur();return}
  if(termSel){setTermSel(false);const el=cardEls().find(x=>x.dataset.agent+':'+x.dataset.id===sel);if(el)selectEl(el);return}
  if(!$('#help').hidden){$('#help').hidden=true;return}
  if(!$('#detail').hidden){closeDetail('esc');return}
  if(sel){sel=null;for(const x of document.querySelectorAll('section.col .card.sel'))x.classList.remove('sel')}
});
// 仕掛かり on a card, only once asked for: a keyword guess over the transcript is too unreliable to say "none".
function pendLine(c){
  const p=c.wip;if(!p)return '';
  if(p.status==='running')return '<div class="pend">棚卸し中…</div>';
  if(p.status==='error')return '';
  const old=c.lastT&&p.at&&c.lastT>p.at+60000;   // the session moved after the reading
  const r=p.remaining||[];
  if(!r.length)return '<div class="pend none">棚卸し時点で残作業なし'+(old?'(その後に動いています)':'')+'</div>';
  return '<div class="pend'+(old?' none':'')+'">残り'+r.length+'件: '+esc(String(r[0].what).slice(0,44))+(r.length>1?' ほか':'')+(old?' (棚卸し後に動いています)':'')+'</div>';
}
