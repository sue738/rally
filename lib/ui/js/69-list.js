/** リスト with the list docked left and the panel filling the rest (a desktop-wide window). */
function listDocked(){return boardView==='list'&&window.innerWidth>=1011}
// the open terminal strip stands on the right edge in the docked list
function termSide(){return listDocked()&&!document.body.classList.contains('termclosed')}
function listWidth(){const m=document.querySelector('main');return listDocked()&&m?m.getBoundingClientRect().width:0}
// The docked list works like a mail app: a row is always selected and shown on the right.
// A row that leaves the board hands the panel to its neighbour.
const rowKey=e=>e.dataset.agent+':'+e.dataset.id;
let listAuto=false,listRows=[];
function listFirst(){
  const els=cardEls();
  return (sel&&els.find(e=>rowKey(e)===sel))||document.querySelector('section.col[data-col="needs-you"] .card')||els[0]||null;
}
function listKeep(){
  const prev=listRows;listRows=cardEls().map(rowKey);
  if(!gotState)return;
  const entering=listAuto;listAuto=false;
  if(!listDocked())return;
  const els=cardEls();
  if(!panelOpen()){const el=listFirst();if(el)selectEl(el);return}
  if(!openFor)return;                      // a non-card panel (new session, jobs…) stays
  const here=els.find(e=>rowKey(e)===openFor);
  if(here){if(entering&&sel!==openFor)selectEl(here);return}
  const i=prev.indexOf(openFor);if(i<0)return;   // it was never a row (a subagent, a search hit)
  const now=new Set(listRows);
  const nb=prev.slice(i+1).find(k=>now.has(k))||prev.slice(0,i).reverse().find(k=>now.has(k));
  const el=nb?els.find(e=>rowKey(e)===nb):listFirst();
  if(el)selectEl(el);else closeDetail('empty');
  if(el&&openFor!==rowKey(el))openSelected({focus:false});
}
/** Esc / × in the docked list: the keys go back to the list, the panel stays. */
function listKeys(){
  const a=document.activeElement;if(a&&$('#detail').contains(a)&&a.blur)a.blur();
  // a subagent's panel: the keys go to the parent's card
  const kid=openCard&&openCard.subagent&&openCard.parentId?openCard.agent+':'+openCard.parentId:null;
  const k=[sel,openFor,kid].find(x=>x&&cardEls().some(e=>rowKey(e)===x));
  if(k)focusHome(k);
}
/** In the docked list a card panel has no ×: there is nothing to close it to. */
function syncKeep(){document.body.classList.toggle('lkeep',listDocked()&&panelOpen()&&!!openFor)}
window.addEventListener('resize',()=>{if(gotState&&boardView==='list'){listKeep();syncKeep()}});
function selectCard(i){const els=cardEls();if(els.length)selectEl(els[Math.max(0,Math.min(els.length-1,i))])}
function selIndex(){const els=cardEls();return els.findIndex(e=>e.dataset.agent+':'+e.dataset.id===sel)}
// Only リスト remains; a stored 'board' / 'focus' view opens as リスト.
const VIEWS=[['list','リスト']];
let boardView='list';
function setView(){
  boardView='list';listAuto=true;
  document.body.classList.add('vlist');document.body.classList.remove('vboard');
  try{localStorage.setItem('view','list')}catch(e){}
  if(typeof render==='function'&&typeof live!=='undefined'&&live)render();
}
/** The header's 表示: what a card shows (CARD_FIELDS, 00-core.js), each a switch ticked when on; the
 * badge-shaped ones (CHIP_FIELDS) also carry a handle (⠿) to drag their left-to-right order (cardOrder). */
let cdragKey=null;
function cardShowBtn(k,l){
  const chip=CHIP_FIELDS.includes(k);
  return '<button class="mini toggle tflag'+(cshow(k)?' on':'')+(chip?' cdrag':'')+'" data-k="'+k+'" aria-pressed="'+(cshow(k)?'true':'false')+'"'+(chip?' draggable="true"':'')+'>'
    +(chip?'<i class="cgrip" aria-hidden="true">⠿</i>':'')+esc(l)+'</button>';
}
function cardShowOpen(on){
  const pop=$('#cardshow'),b=$('#cardshowbtn');if(!pop||!b)return;
  if(on==null)on=pop.hidden;
  if(on){
    const byKey=new Map(CARD_FIELDS.map(x=>[x[0],x]));
    const fixed=k=>cardShowBtn(k,byKey.get(k)[1]);
    pop.innerHTML='<div class="csh">カードに出すもの</div>'
      +fixed('proj')+fixed('agent')+fixed('model')
      +'<div class="cgroup">'+chipOrder().map(k=>cardShowBtn(k,byKey.get(k)[1])).join('')+'</div>'
      +fixed('last')+fixed('idle')
      +'<div class="csn dim">題名と状態はいつも出ます。文脈が 400k を超えたときの警告も出ます。'+(JSON.stringify(chipOrder())!==JSON.stringify(CHIP_FIELDS)?' <button type="button" class="linklike" id="cordreset">並び順を既定に戻す</button>':'')+'</div>';
    for(const x of pop.querySelectorAll('button[data-k]'))x.onclick=e=>{if(e.target.closest('.cgrip'))return;e.stopPropagation();const v=!cshow(x.dataset.k);setCardShow(x.dataset.k,v);x.classList.toggle('on',v);x.setAttribute('aria-pressed',v?'true':'false')};
    const grp=pop.querySelector('.cgroup');
    for(const x of pop.querySelectorAll('.cdrag')){
      x.ondragstart=e=>{cdragKey=x.dataset.k;x.classList.add('dragging');e.dataTransfer.effectAllowed='move'};
      x.ondragend=()=>{cdragKey=null;x.classList.remove('dragging')};
      x.ondragover=e=>{if(!cdragKey)return;e.preventDefault();e.dataTransfer.dropEffect='move';
        if(x.dataset.k===cdragKey)return;
        const r=x.getBoundingClientRect(),before=e.clientY<r.top+r.height/2;
        grp.insertBefore(pop.querySelector('[data-k="'+cdragKey+'"]'),before?x:x.nextSibling)};
      x.ondrop=e=>{e.preventDefault();if(!cdragKey)return;
        setCardOrder([...grp.querySelectorAll('.cdrag')].map(y=>y.dataset.k));cardShowOpen(true)};
    }
    const rb=pop.querySelector('#cordreset');if(rb)rb.onclick=e=>{e.stopPropagation();setCardOrder(CHIP_FIELDS.slice());cardShowOpen(true)};
  }
  pop.hidden=!on;b.setAttribute('aria-expanded',on?'true':'false');
}
document.addEventListener('click',e=>{const pop=$('#cardshow');if(pop&&!pop.hidden&&!e.target.closest('.cswrap'))cardShowOpen(false)});
document.addEventListener('keydown',e=>{const pop=$('#cardshow');if(e.key==='Escape'&&pop&&!pop.hidden){e.stopPropagation();cardShowOpen(false);$('#cardshowbtn').focus()}},true);
