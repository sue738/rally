let sel=null;
// ---- keyboard ------------------------------------------------------------
// Board keys never fire while typing; the bindings are in 92-keyset.js and the help.
function lanes(){
  return [...document.querySelectorAll('section.col')].filter(x=>getComputedStyle(x).display!=='none')
    .map(x=>[...x.querySelectorAll('.card')]);
}
function cardEls(){return lanes().flat()}
function selPos(){
  const L=lanes();
  for(let i=0;i<L.length;i++){const j=L[i].findIndex(e=>e.dataset.agent+':'+e.dataset.id===sel);if(j>=0)return [i,j]}
  return null;
}
function selectEl(el){
  if(!el)return;
  if(termSel)setTermSel(false);
  for(const e of cardEls())e.classList.remove('sel');
  el.classList.add('sel');sel=el.dataset.agent+':'+el.dataset.id;
  el.scrollIntoView({block:'nearest'});
  // the panel follows the selection without taking focus
  if(!$('#detail').hidden&&openFor&&openFor!==sel)openSelected({focus:false});
  else if(listDocked()&&$('#detail').hidden)openSelected({focus:false});
}
/** j k / h l / arrows: the next card, in the lane or across (in リスト one list, top to bottom) */
function moveSel(dy,dx){
  const L=lanes();if(!L.some(l=>l.length))return;
  const p=selPos();
  if(!p){const first=L.find(l=>l.length);selectEl(first[0]);return}
  let [i,j]=p;
  // one list: ↑↓ run on through the lanes
  if(dy&&boardView!=='board'){const F=L.flat();const k=F.findIndex(e=>e.dataset.agent+':'+e.dataset.id===sel);
    if(dy>0&&k===F.length-1&&goTerminal())return;
    selectEl(F[Math.max(0,Math.min(F.length-1,k+dy))]);return}
  if(dx){
    for(let k=i+dx;k>=0&&k<L.length;k+=dx)if(L[k].length){selectEl(L[k][Math.min(j,L[k].length-1)]);return}
    return;
  }
  // ↓ past the last card goes into the terminal strip
  if(dy>0&&j===L[i].length-1&&goTerminal())return;
  selectEl(L[i][Math.max(0,Math.min(L[i].length-1,j+dy))]);
}
/** ⌘[ ⌘] go to the strip's panes when the keys are in the strip, or no panel is open */
function stripOrPanel(){const a=document.activeElement;return !panelOpen()||!!(a&&a.closest&&a.closest('#term'))}
/** ⌘[ / ⌘]: the previous / next card, wrapping; focus returns to the same place (box or terminal) */
function cardStep(d){
  const F=lanes().flat();if(!F.length)return;
  const cur=openCard?openCard.agent+':'+openCard.id:sel;
  const k=F.findIndex(e=>e.dataset.agent+':'+e.dataset.id===cur);
  const a=document.activeElement,where=a&&a.closest?(a.closest('#mterm')?'term':a.closest('#mbody .msg')?'box':''):'';
  selectEl(F[k<0?0:(k+d+F.length)%F.length]);if(!panelOpen())openSelected({focus:false});
  requestAnimationFrame(()=>{
    const p=where==='term'&&openCard&&panelPty(openCard);
    if(p&&!p.gone&&p.el.closest('#mterm')){p.xt.focus();return}
    if(where){const b=$('#mbody .msg textarea');if(b&&!b.disabled)b.focus()}});
}
