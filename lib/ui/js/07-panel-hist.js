// The panel's conversation: the range picker and what is drawn or re-read on open (called by openDetail).
function wireViewPick(){
  for(const b of $('#mbody').querySelectorAll('.viewpick button')){
    b.classList.toggle('on',b.dataset.v===viewMode);
    b.onclick=()=>{
      viewMode=b.dataset.v;
      try{localStorage.setItem('histview',viewMode)}catch(e){}
      for(const o of b.parentElement.children)o.classList.toggle('on',o===b);
      histSig='';const c2=openCard;if(c2){const hc=histCache.get(c2.agent+':'+c2.id);if(hc)renderHistory(hc.j);askHistory(c2)}
    };
  }
}
function detailHistory(c,keep){
  if(!keep)histSig='';
  if(convAgent(c)){
// draw what is cached, then decide whether to re-read
    const hc=histCache.get(c.agent+':'+c.id);
    if(hc&&!keep){histSig='';renderHistory(hc.j)}
// a kept pane is redrawn only when what it shows of the card's state differs from the state (histReconcile: the 作業中 line,
// a prompt, held messages); a redraw otherwise keeps opened folds
    else if(hc&&keep)histReconcile();
    const moved=!hc||(c.lastT||0)>(hc.lastT||0)||Date.now()-hc.at>60000;
    if(moved)askHistory(c);
  }
  else $('#mhist').innerHTML='<div class="more">この種類のセッションは履歴の読み取りに対応していません(claude / codex のみ)</div>';
}
