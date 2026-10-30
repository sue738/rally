// A session's conversation as HTML, for the detail panel or a focus panel.
function historyHtml(j,own){
  const T=t;   // t() is shadowed below by the turn variables
// at the foot: its permission prompt, then what is held to send when free (22-whenfree.js)
  const ask=askHtml(own)+heldHtml(own);
  const turns=j.turns||[];
  if(!turns.length)return '<div class="more">'+esc(j.error||T('この期間にこのセッションの履歴が見つかりません'))+'</div>'+ask;
  let html=j.dropped?'<div class="more">'+T('これより前の {n} 件は省略',{n:j.dropped})+'</div>':'';
  const line=t=>{
    const who=t.kind==='tool'?esc(t.tool||'tool'):t.waiting?(WHO.user||'')+' <span class="peer" title="'+T('セッションが作業中なので、次の区切りで受け取られます')+'">'+T('届け待ち')+'</span>'
      :t.peer?(WHO.user||'')+' <span class="peer" title="'+T('動いているセッションへ別のセッション({peer})経由で直接届いたメッセージ',{peer:esc(t.peer)})+'">'+T('↪ 直接')+'</span>':(WHO[t.kind]||'');
    const when=t.t?'<span title="'+esc(T('{ago}前',{ago:ago(Math.round((Date.now()-t.t)/1000))}))+'">'+clock(t.t)+'</span>':'';
// ↩ on messages (not a /command, one still waiting, or one relayed by another session)
    const rep=t.t&&(t.kind==='assistant'||(t.kind==='user'&&!t.cmd&&!t.waiting&&!t.peer));
    const head=(who?'<span class="who">'+who+'</span>':'')+'<span class="when">'+when+'</span>'+(rep?'<button class="rbtn" title="'+T('この発言に返信 (最新の回答へは ⇧R)')+'">↩</button>':'');
    const tag=rep?' data-t="'+t.t+'" data-k="'+t.kind+'" data-hm="'+replyHM(t.t)+'"':'';
    const imgs=(t.images||[]).map(im=>'<a class="shot" href="'+esc(im.url||'')+'" title="'+T('クリックで開く')+'"><img src="'+esc(im.url||'')+'" alt="'+T('画像')+'" loading="lazy"></a>').join('');
    if(t.kind==='mark')return '<div class="turn mark">'+esc(t.text||'')+'</div>';
// markdown, escaped before any tag is made
    if(t.kind==='assistant')return '<div class="turn assistant mdturn"'+tag+'>'+head+'<div class="md">'+mdRender(t.text||'',{breaks:true})+'</div>'+imgs+'</div>';
    const rp=t.kind==='user'?replyParse(t.text):null;
    const sa=t.kind==='user'?splitAttach(rp?rp.rest:(t.text||'')):{text:rp?rp.rest:(t.text||''),files:[]};
    return '<div class="turn '+t.kind+(t.cmd?' cmd':'')+'"'+tag+'>'+head+(rp?replyLine(rp):String.fromCharCode(10))+linkify(esc(sa.text))+attachThumbs(sa.files)+imgs+'</div>';
  };
// 未読: the line where what you have not seen begins (38-unread.js unreadFrom): in front of the first reply after the
// time you last looked — or the run folded around it — once, however the turns are drawn
  const fromT=unreadFromOf(j.agent+':'+j.session);
  const isNew=t=>fromT!=null&&(t.t||0)>fromT&&(t.kind==='assistant'||(t.kind==='user'&&t.peer));
  const ui=turns.findIndex(isNew),newN=ui<0?0:turns.filter(isNew).length;
  let divDrawn=false;
  const dv=(a,b)=>{if(divDrawn||ui<a||ui>=b)return '';divDrawn=true;return '<div class="turn mark unreadline">'+T('ここから未読 · 返答 {n} 件',{n:newN})+'</div>'};
// turns[from..] drawn open: messages as they are, each run of tool calls folded into one line
  const openTail=(from)=>{
    let out='';
    for(let i=from;i<turns.length;i++){
      const t=turns[i];
      if(t.kind==='tool'||t.kind==='error'){
        let j2=i;while(j2<turns.length&&(turns[j2].kind==='tool'||turns[j2].kind==='error'))j2++;
        const run=turns.slice(i,j2);
        const names=[...new Set(run.map(x=>x.tool||(x.kind==='error'?T('エラー'):'tool')))].slice(0,4).join(', ');
        const bad=run.some(x=>x.kind==='error');
        out+=dv(i,j2)+'<details class="tools'+(bad?' bad':'')+'"><summary>'+T('実行 {n}件 · ',{n:run.length})+esc(names)+(bad?T(' · エラーあり'):'')+'</summary>'+run.map(line).join('')+'</details>';
        i=j2-1;
      } else out+=dv(i,i+1)+line(t);
    }
    return out;
  };
// a run of tool calls between two messages folds into one line
  if(viewMode==='last'||viewMode==='last3'){
    const want=viewMode==='last3'?3:1;
    let start=0,seen=0;
    for(let i=turns.length-1;i>=0;i--)if(turns[i].kind==='user'&&++seen===want){start=i;break}
// earlier instructions stay (they are what the last exchange answers); only replies fold
    for(let i=0;i<start;){
      if(turns[i].kind==='user'){html+=dv(i,i+1)+line(turns[i]);i++;continue}
      let j2=i;while(j2<start&&turns[j2].kind!=='user')j2++;
      const run=turns.slice(i,j2);
      const said=run.filter(t=>t.kind==='assistant').length,tools=run.length-said;
      html+=dv(i,j2)+'<details class="tools reply"><summary>'+T('返答 {n}件',{n:said})+(tools?T(' · 実行{n}件',{n:tools}):'')+'</summary>'+run.map(line).join('')+'</details>';
      i=j2;
    }
    html+=openTail(start);
  } else
  for(let i=0;i<turns.length;){
    if(turns[i].kind==='tool'||turns[i].kind==='error'){
      let j2=i;while(j2<turns.length&&(turns[j2].kind==='tool'||turns[j2].kind==='error'))j2++;
      const run=turns.slice(i,j2);
      const names=[...new Set(run.map(t=>t.tool||(t.kind==='error'?T('エラー'):'tool')))].slice(0,4).join(', ');
      const bad=run.some(t=>t.kind==='error');
// always folded, even with errors: an auto-opened long run pushes the conversation off screen
      html+=dv(i,j2)+'<details class="tools'+(bad?' bad':'')+'"><summary>'+T('実行 {n}件 · ',{n:run.length})+esc(names)+(bad?T(' · エラーあり'):'')+'</summary>'+run.map(line).join('')+'</details>';
      i=j2;
    } else { html+=dv(i,i+1)+line(turns[i]); i++; }
  }
// typing indicator while mid-turn, unless a prompt is waiting on you
  const st=ask?null:thinkState(turns);
  if(st)html+='<div class="turn think'+(st.count?' running':'')+'" data-since="'+st.since+'"'+(st.start?' data-start="'+st.start+'"':'')+'>'
    +(st.count?'<span class="spin">⠋</span>':'<span class="dots"><i></i><i></i><i></i></span>')
    +'<span class="t">'+esc(st.label)+'</span>'
    +(st.target?'<span class="tgt">'+esc(st.target)+'</span>':'')
    +(st.count?'<span class="cnt" title="'+T('あなたの最後の指示から実行したツールの数')+'">'+T('{n}回目',{n:st.count})+'</span>':'')+'</div>';
  return html+ask;
}
/** What the thread draws from the card's state right now, apart from its turns: the line under it, a prompt, held messages. */
function histViewSig(c,turns){
  return [(thinkState(turns||[])||{}).label||'',askHtml(c).length,((c||{}).permAsk||{}).id||'',heldSig(c)].join('|');
}
/**
 * Level-triggered: the thread is compared with what the state says now, not redrawn only when an event says something
 * changed (a lane that moved with nothing new in the thread left its 作業中 line up for good). Run on a timer.
 */
function histReconcile(){
  if(!openCard||typeof wfEditing!=='undefined'&&wfEditing.size)return false;
  const h=$('#mhist');if(!h||!h.innerHTML||h.dataset.vsig==null)return false;
  const sel=window.getSelection&&window.getSelection();if(sel&&!sel.isCollapsed&&h.contains(sel.anchorNode))return false;   // not under a selection being made
  const hc=histCache.get(openCard.agent+':'+openCard.id);if(!hc)return false;
  const fresh=(live.cards||[]).find(x=>x.agent===openCard.agent&&x.id===openCard.id)||openCard;
  if(h.dataset.vsig===histViewSig(fresh,hc.j.turns))return false;
  histSig='';renderHistory(hc.j);return true;
}
function renderHistory(j){
  const el=$('#mhist');if(!el)return;
  const prevTop=el.scrollTop;
  const turns0=j.turns||[];
  const own=openCard&&openCard.agent+':'+openCard.id===j.agent+':'+j.session?openCard:null;
  const ask=askHtml(own);
  const sig=(j.agent||'')+':'+(j.session||'')+':'+turns0.length+':'+(turns0.length?turns0[turns0.length-1].t:0)+':'+(j.dropped||0)+':'+(j.error||'')+':'+histViewSig(own,turns0);
  if(sig===histSig&&el.children.length)return;     // nothing new to draw
  histSig=sig;
  if(openFor!==j.agent+':'+j.session)return; // the panel moved on to another card, or to 新規 (openFor null)
  const turns=j.turns||[];
  el.dataset.vsig=histViewSig(own,turns0);
  if(!turns.length){el.innerHTML=historyHtml(j,own);echoRestore(el,j);if(own)wireAsk(own);return}
  const html=historyHtml(j,own);
  el.innerHTML=html;
  echoRestore(el,j);
  if(own)wireAsk(own);
  histPut(j);
  tickThinking();
// follow the bottom only if already there, so reading older turns is not yanked away
  wireHist(el);
  if(histStick)stickBottom(el);
  else{el.scrollTop=prevTop}
  syncLatest(el);
  unreadJump(el,j.agent+':'+j.session);
}
