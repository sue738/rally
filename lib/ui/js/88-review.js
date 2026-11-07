// 別のモデルで見てもらう (lib/review.js): from the change viewer, one review of what a session changed by a model that did
// not write it. Its findings land as line comments (the viewer's own), to keep or drop and send with まとめて送る.
// The card and the panel say when one is worth asking for (c.reviewHint): a big change, files where a slip costs
// most, or you saying it is still not fixed.
const REVIEW_MODELS=[['fable','Fable'],['opus','Opus'],['sonnet','Sonnet']];
function reviewHintText(h){
  if(!h)return '';
  return h.why==='stuck'?t('「まだ直っていない」のあとです。別のモデルなら同じ見落としをしにくいです')
    :h.why==='risky'?t('影響の大きいファイルを変えました: {f}',{f:String(h.file||'').split('/').slice(-2).join('/')})
    :t('大きな変更です: {n} ファイル・{l} 行',{n:h.files||0,l:h.lines||0});
}
function reviewChip(c){
  if(!c||!c.reviewHint||(c.review&&c.review.status==='running'))return '';
  return '<span class="rvh" title="'+esc(t('別のモデルでの確認をおすすめ')+': '+reviewHintText(c.reviewHint))+'">🔍 '+esc(t('別モデル推奨'))+'</span>';
}
/** The reviewer offered first: not the model that wrote it (Fable, unless it was Fable). */
function reviewDefault(c){return /fable/i.test(String((c&&(c.modelId||c.model))||''))?'opus':'fable'}
function reviewStart(model){
  if(!viewer||!viewer.changes)return;
  const k=viewer.changes,i=k.indexOf(':'),agent=k.slice(0,i),session=k.slice(i+1);
  viewer.reviewPending={model,at:Date.now()};
  const m={type:'review',agent,session,model};
  if(native)post(m);
  else fetch('api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).then(r=>r.json()).then(j=>{if(j&&j.error)reviewAcked({op:'review',error:j.error})}).catch(e=>reviewAcked({op:'review',error:String(e)}));
  reviewPoll();reviewDraw(viewer.data||{});
}
/** The start was refused (no diff, too many at once): said in the viewer, the button back. */
function reviewAcked(r){
  if(!r||r.op!=='review'||!r.error||!viewer)return;
  viewer.reviewPending=null;viewer.reviewError=r.error;reviewDraw(viewer.data||{});
}
// while it runs: the viewer asks again for the changes, which carry the review's state
function reviewPoll(){
  clearTimeout(viewer&&viewer.reviewTimer);
  if(!viewer||!viewer.changes||!viewer.reviewPending)return;
  viewer.reviewTimer=setTimeout(()=>{
    if(!viewer||!viewer.reviewPending)return;
    const k=viewer.changes,i=k.indexOf(':'),agent=k.slice(0,i),session=k.slice(i+1);
    if(native)post({type:'changes',agent,session});
    else fetch('api/changes?agent='+encodeURIComponent(agent)+'&session='+encodeURIComponent(session)).then(r=>r.json()).then(j=>window.__kanban.changes(j)).catch(()=>{});
    reviewPoll()},5000);
}
/** Findings to line comments: on the line it names when that line is in the diff; the rest listed above. */
function reviewNotes(j,rv){
  const files=j.files||[],out={notes:[],loose:[]};
  const sev={high:t('重大'),medium:t('中'),low:t('軽微')};
  for(const f of rv.findings||[]){
    const text='🔍 ['+(sev[f.severity]||f.severity)+'] '+f.title+(f.why?' — '+f.why:'')+(f.fix?' / '+t('直し方')+': '+f.fix:'');
    const fi=files.findIndex(x=>x.path===f.file||x.path.endsWith('/'+String(f.file).replace(/^\/+/,''))||String(f.file).endsWith(relPath(x)));
    const sp=fi>=0&&f.line?viewer.box.querySelector('.vsec[data-i="'+fi+'"] .dl[data-ln="n'+f.line+'"]'):null;
    if(sp)out.notes.push({abs:files[fi].path,path:relPath(files[fi]),ln:'n'+f.line,code:sp.textContent,note:text});
    else out.loose.push({file:fi>=0?relPath(files[fi]):String(f.file||''),line:f.line,text});
  }
  return out;
}
function reviewDraw(j){
  if(!viewer||!viewer.changes)return;
  const c=(live.cards||[]).find(x=>x.agent+':'+x.id===viewer.changes)||{};
  const rv=j.review||null;
  if(viewer.reviewPending&&rv&&rv.status!=='running'&&(rv.at||0)>=viewer.reviewPending.at){viewer.reviewPending=null;clearTimeout(viewer.reviewTimer)}
  const running=!!viewer.reviewPending||(rv&&rv.status==='running');
  if(running&&!viewer.reviewPending)viewer.reviewPending={model:rv.model,at:rv.at||Date.now()},reviewPoll();
  // the controls, after the totals
  const tabs=viewer.box.querySelector('.vtabs');if(!tabs)return;
  let ctl=tabs.querySelector('.vrev');if(!ctl){ctl=document.createElement('span');ctl.className='vrev';tabs.appendChild(ctl)}
  const def=viewer.reviewModel||reviewDefault(c);
  ctl.innerHTML=running?'<span class="dim">🔍 '+esc(t('{m} がレビュー中…(1〜3分)',{m:(REVIEW_MODELS.find(x=>x[0]===(viewer.reviewPending||{}).model)||[0,(viewer.reviewPending||{}).model||''])[1]}))+'</span>'
    :'<button class="mini vrevgo" title="'+esc(t('この変更を、書いたのとは別のモデルに1回読ませて、問題を行ごとのコメントにします(利用枠を1回分使います)'))+'">🔍 '+esc(t('別のモデルに見てもらう'))+'</button>'
      +'<select class="vrevm" aria-label="'+esc(t('レビューするモデル'))+'">'+REVIEW_MODELS.map(([v,l])=>'<option value="'+v+'"'+(v===def?' selected':'')+'>'+l+'</option>').join('')+'</select>';
  const go=ctl.querySelector('.vrevgo');if(go)go.onclick=()=>reviewStart(ctl.querySelector('.vrevm').value);
  const sel=ctl.querySelector('.vrevm');if(sel)sel.onchange=()=>{viewer.reviewModel=sel.value};
  // what it found: on the lines, once per review; the summary and what has no line above the files
  const body=viewer.box.querySelector('.vbody');
  let sum=body&&body.querySelector('.vrevsum');
  if(viewer.reviewError&&!running){if(!sum&&body){sum=document.createElement('div');sum.className='vrevsum';body.prepend(sum)}if(sum)sum.innerHTML='<span class="bad">✗ '+esc(viewer.reviewError)+'</span>';viewer.reviewError=null;return}
  if(!rv||rv.status==='running'){if(sum)sum.remove();return}
  if(!sum&&body){sum=document.createElement('div');sum.className='vrevsum';body.prepend(sum)}
  if(!sum)return;
  if(rv.status==='error'){sum.innerHTML='<span class="bad">✗ '+esc(t('レビューできませんでした'))+': '+esc(rv.error||'')+'</span>';return}
  const r=reviewNotes(j,rv);
  if(viewer.reviewApplied!==rv.at){
    viewer.reviewApplied=rv.at;
    const ns=notesOf(viewer.changes);
    for(const n of r.notes)if(!ns.some(x=>x.abs===n.abs&&x.ln===n.ln&&x.note===n.note))ns.push(n);
    drawNotes();
  }
  const name=(REVIEW_MODELS.find(x=>x[0]===rv.model)||[0,rv.model||''])[1];
  sum.innerHTML='<b>🔍 '+esc(t('{m} の指摘 {n} 件',{m:name,n:(rv.findings||[]).length}))+'</b>'+(rv.summary?' — '+esc(rv.summary):'')
    +(r.notes.length?'<div class="dim">'+esc(t('行についた指摘はコメントとして並べました。要らないものを消して「まとめて送る」で、このセッションに直させます'))+'</div>':'')
    +(r.loose.length?'<ul>'+r.loose.map(x=>'<li><code>'+esc(x.file+(x.line?':'+x.line:''))+'</code> '+esc(x.text)+'</li>').join('')+'</ul>':'')
    +(rv.cut?'<div class="dim">'+esc(t('差分が大きいので、途中までを読ませました'))+'</div>':'');
  // asked for from the card's hint: started once the changes are on screen
  if(viewer.autoReview){viewer.autoReview=false;if(!running&&(j.files||[]).length)reviewStart(def)}
}
