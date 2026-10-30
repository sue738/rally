let viewer=null;
function viewerShell(label,title){
  closeViewer();
  const box=document.createElement('div');box.id='viewer';
  box.innerHTML='<div class="vwin"><div class="vbar"><span class="pp">❯</span><span class="vpath" title="'+esc(title)+'"><bdi dir="ltr">'+esc(label)+'</bdi></span>'
    +'<span class="vtabs"></span><span style="flex:1"></span><button class="vfinder" title="'+t('Finder で表示 (o)')+'">Finder</button><button class="vcopy" title="'+t('パスをコピー (y)')+'">'+t('コピー')+'</button><button class="vclose" title="'+t('閉じる (Esc)')+'">✕</button></div>'
    +'<div class="vbody" tabindex="-1"><div class="vempty">'+t('読み込み中…')+'</div></div></div>';
  document.body.appendChild(box);
  box.querySelector('.vclose').onclick=closeViewer;
  box.addEventListener('mousedown',e=>{if(e.target===box){e.preventDefault();closeViewer()}});
  box.querySelector('.vbody').focus({preventScroll:true});
  return box;
}
// 変更をレビュー: every file the session wrote or edited, with its diff, like a PR.
function openChanges(c){
  const box=viewerShell(t('変更')+' · '+(c.title||short(c.project)),c.project||'');
  box.querySelector('.vfinder').hidden=true;box.querySelector('.vcopy').hidden=true;
  viewer={box,path:null,changes:c.agent+':'+c.id,data:null,tab:'',at:0,back:document.activeElement};
  if(native)post({type:'changes',agent:c.agent,session:c.id});
  else fetch('api/changes?agent='+encodeURIComponent(c.agent)+'&session='+encodeURIComponent(c.id)).then(r=>r.json()).then(j=>window.__kanban.changes(j)).catch(e=>window.__kanban.changes({agent:c.agent,session:c.id,files:[],error:String(e)}));
}
function renderChanges(j){
  if(!viewer||viewer.changes!==j.agent+':'+j.session)return;
  viewer.data=j;
  const body=viewer.box.querySelector('.vbody');
  const fs_=j.files||[];
  if(j.error||!fs_.length){body.innerHTML='<div class="vempty">'+esc(j.error||t('このセッションが Edit / Write で触ったファイルはありません'))+'</div>';return}
  let a=0,d=0;for(const f of fs_){a+=f.added||0;d+=f.removed||0}
  const roots=(j.roots||[]).map(r=>esc(shortHome(r.root))+(r.branch?' <span class="vbr">'+esc(r.branch)+'</span>':'')).join(' · ');
  viewer.box.querySelector('.vtabs').innerHTML='<span class="vsum">'+t('{n} ファイル',{n:fs_.length})+' <span class="da">+'+a+'</span> <span class="dd">−'+d+'</span></span>';
  body.innerHTML='<div class="vmeta">'+roots+' · '+((j.roots||[]).some(r=>r.since)?t('{since} から分かれた所からの差分',{since:esc(((j.roots||[]).find(r=>r.since)||{}).since)}):t('最後のコミットからの差分'))+t('(同じファイルを他で変えた分も含みます) · 行をクリックでコメント')+'</div>'
    +'<div class="vfiles">'+fs_.map((f,i)=>'<button class="vf" data-i="'+i+'"><span class="vfn">'+esc(f.path.split('/').pop())+'</span><span class="vfd">'+esc(relDir(f))+'</span>'
      +(f.outside?'<span class="tag">'+t('ホーム外')+'</span>':f.secret?'<span class="tag">'+t('鍵・認証情報')+'</span>':f.error?'<span class="tag bad">'+t('取得できず')+'</span>':f.deleted?'<span class="tag del">'+(LANG==='en'?'Deleted':'削除')+'</span>':f.ignored?'<span class="tag">'+t('git が無視')+'</span>':f.untracked?'<span class="tag new">'+t('新規')+'</span>':f.committed?'<span class="tag">'+t('コミット済み')+'</span>':f.git===false?'<span class="tag">'+t('git 外')+'</span>':'')
      +'<span class="da">+'+(f.added||0)+'</span><span class="dd">−'+(f.removed||0)+'</span></button>').join('')+'</div>'
    +fs_.map((f,i)=>'<section class="vsec" data-i="'+i+'"><div class="vsh"><a class="fpath" href="#" data-p="'+esc(f.path)+'" title="'+esc(f.path)+'">'+esc(relPath(f))+'</a>'
      +'<span class="da">+'+(f.added||0)+'</span><span class="dd">−'+(f.removed||0)+'</span></div>'
      +(f.diff?diffRender(f.diff,true,i):'<div class="vempty">'+(f.outside?t('ホームの外なので表示しません'):f.secret?t('鍵・認証情報なので表示しません'):f.error?esc(f.error):f.deleted?t('このファイルは削除されています'):f.ignored?t('git が無視するファイルなので中身は表示しません'):f.committed?t('差分なし(コミット済み)'):f.git===false?t('git の管理外です'):t('差分なし'))+'</div>')+'</section>').join('');
  for(const b of body.querySelectorAll('.vf'))b.onclick=()=>changesGo(+b.dataset.i);
  // a click on a line comments on it, unless it ended a text selection
  body.onclick=e=>{const sp=e.target&&e.target.closest&&e.target.closest('.dl');if(!sp)return;
    const s=window.getSelection&&window.getSelection();if(s&&String(s)&&!s.isCollapsed)return;openNote(sp)};
  if(!viewer.box.querySelector('.vnotes')){
    const bar=document.createElement('div');bar.className='vnotes';bar.hidden=true;
    bar.innerHTML='<span class="vncount"></span><span class="toast"></span><span style="flex:1"></span><button class="vnsend" title="'+t('コメントを1通のメッセージにしてこのセッションへ送ります (⌘Enter)')+'">'+t('まとめて送る')+'</button>';
    bar.querySelector('.vnsend').onclick=sendNotes;
    viewer.box.querySelector('.vwin').appendChild(bar);
  }
  drawNotes();
  viewer.at=viewer.at||0;
  if(viewer.at)changesGo(viewer.at);
}
function relPath(f){return f.root&&f.path.startsWith(f.root+'/')?f.path.slice(f.root.length+1):shortHome(f.path)}
function relDir(f){const r=relPath(f);const k=r.lastIndexOf('/');return k>0?r.slice(0,k):''}
function changesGo(i){
  if(!viewer||!viewer.changes||!viewer.data)return;
  const n=(viewer.data.files||[]).length;if(!n)return;
  viewer.at=Math.max(0,Math.min(n-1,i));
  const sec=viewer.box.querySelector('.vsec[data-i="'+viewer.at+'"]');if(sec)sec.scrollIntoView({block:'start'});
  for(const b of viewer.box.querySelectorAll('.vf'))b.classList.toggle('on',+b.dataset.i===viewer.at);
}
function openViewer(p){
  if(!p)return;
  // from the review, Esc returns to it
  const from=viewer&&viewer.changes&&viewer.data?{changes:viewer.changes,data:viewer.data,at:viewer.at,back:viewer.back}:null;
  const back0=viewer?viewer.back:document.activeElement;
  const box=viewerShell(shortHome(p),p);
  viewer={box,path:p,data:null,tab:'',back:back0,from};
  box.querySelector('.vfinder').onclick=()=>{if(native)post({type:'reveal',path:p})};
  box.querySelector('.vcopy').onclick=()=>{navigator.clipboard.writeText(p);const b=box.querySelector('.vcopy');b.textContent=t('コピーしました');setTimeout(()=>{b.textContent=t('コピー')},1200)};
  if(native)post({type:'view',path:p});
  else fetch('api/view?path='+encodeURIComponent(p)).then(r=>r.json()).then(j=>window.__kanban.viewed(j)).catch(e=>window.__kanban.viewed({path:p,error:String(e)}));
}
function viewTabs(j){
  const tb=[];
  if(j.kind==='md')tb.push(['preview',t('プレビュー')]);
  if(j.kind==='md'||j.kind==='text')tb.push(['source',t('ソース')]);
  if(j.git&&!j.untracked&&(j.kind==='md'||j.kind==='text')){
    let a=0,d=0;for(const l of String(j.diff||'').split('\n')){if(l[0]==='+'&&!l.startsWith('+++'))a++;else if(l[0]==='-'&&!l.startsWith('---'))d++}
    tb.push(['diff',t('差分')+(a||d?' <span class="da">+'+a+'</span> <span class="dd">−'+d+'</span>':'')]);
  }
  return tb;
}
function viewShow(tab){
  if(!viewer||!viewer.data||viewer.changes)return;
  const j=viewer.data,body=viewer.box.querySelector('.vbody');
  const tabs=viewTabs(j);
  if(!tabs.some(t=>t[0]===tab))tab=tabs.length?tabs[0][0]:'';
  viewer.tab=tab;
  viewer.box.querySelector('.vtabs').innerHTML=tabs.map((t,i)=>'<button data-t="'+t[0]+'" class="'+(t[0]===tab?'on':'')+'" title="'+(i+1)+'">'+t[1]+'</button>').join('');
  for(const b of viewer.box.querySelectorAll('.vtabs button'))b.onclick=()=>viewShow(b.dataset.t);
  const meta='<div class="vmeta">'+(j.size!=null?(j.size<1024?j.size+' B':Math.round(j.size/1024)+' KB'):'')+(j.mtime?' · '+t('{ago}前に更新',{ago:ago(Math.max(0,Math.round((Date.now()-j.mtime)/1000)))}):'')+(j.untracked?' · '+t('git 未追跡'):'')+(j.truncated?' · '+t('先頭 2MB だけ'):'')+'</div>';
  if(j.error){body.innerHTML='<div class="vempty">'+esc(j.error)+'</div>';return}
  if(j.kind==='image'){body.innerHTML=meta+'<div class="vimg"><img src="'+esc(j.data||'')+'" alt=""></div>';return}
  if(j.kind==='binary'){body.innerHTML=meta+'<div class="vempty">'+t('テキストではないので表示できません(Finder で開いてください)')+'</div>';return}
  if(tab==='preview')body.innerHTML=meta+'<div class="md">'+mdRender(j.text)+'</div>';
  else if(tab==='diff')body.innerHTML=meta+diffRender(j.diff);
  else{const lines=String(j.text||'').split('\n');const w=String(lines.length).length;
    body.innerHTML=meta+'<pre class="vsrc">'+lines.map((l,i)=>'<span class="ln">'+String(i+1).padStart(w,' ')+'</span>'+esc(l)).join('\n')+'</pre>'}
  body.scrollTop=0;
}
function closeViewer(){if(!viewer)return;const {box,back,from}=viewer;viewer=null;box.remove();
  if(from){const [agent,...rest]=from.changes.split(':');const b=viewerShell(t('変更'),"");b.querySelector('.vfinder').hidden=true;b.querySelector('.vcopy').hidden=true;
    viewer={box:b,path:null,changes:from.changes,data:null,tab:'',at:from.at,back:from.back};
    const c=(live.cards||[]).find(x=>x.agent+':'+x.id===from.changes);b.querySelector('.vpath bdi').textContent=t('変更')+' · '+(c?(c.title||short(c.project)):'');
    renderChanges({...from.data,agent,session:rest.join(':')});return}
  if(back&&back.focus&&document.contains(back)&&!back.closest('[hidden]'))back.focus({preventScroll:true});else focusHome(openFor)}
window.__kanban.changes=function(j){renderChanges(j||{})};
window.__kanban.viewed=function(j){if(!viewer||!j||j.path!==viewer.path)return;viewer.data=j;viewShow(viewer.tab)};
// the viewer has the keys while it is open
document.addEventListener('keydown',e=>{
  if(viewer&&viewer.changes&&e.metaKey&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopImmediatePropagation();sendNotes();return}
  if(viewer&&e.target&&e.target.tagName==='TEXTAREA'&&viewer.box.contains(e.target))return;
  if(!viewer||pal||e.isComposing||e.metaKey||e.ctrlKey||e.altKey)return;
  const k=e.key,body=viewer.box.querySelector('.vbody');
  const tabs=viewer.data&&!viewer.changes?viewTabs(viewer.data):[];
  let done=true;
  if(k==='Escape'||k==='q')closeViewer();
  else if(viewer.changes&&(k==='n'||k==='p'))changesGo(viewer.at+(k==='n'?1:-1));
  else if(viewer.changes&&k==='D')closeViewer();
  else if(viewer.changes&&k==='c')noteHere();
  else if(viewer.changes&&k==='Enter'){const f=viewer.data&&(viewer.data.files||[])[viewer.at];if(f)openViewer(f.path)}
  else if(/^[1-3]$/.test(k)&&tabs[+k-1])viewShow(tabs[+k-1][0]);
  else if(k==='Tab'&&tabs.length){const i=tabs.findIndex(t=>t[0]===viewer.tab);viewShow(tabs[(i+(e.shiftKey?-1:1)+tabs.length)%tabs.length][0])}
  else if(k==='j'||k==='ArrowDown')body.scrollBy({top:60});
  else if(k==='k'||k==='ArrowUp')body.scrollBy({top:-60});
  else if(k===' '||k==='PageDown'||k==='d')body.scrollBy({top:(e.shiftKey?-1:1)*body.clientHeight*.85});
  else if(k==='PageUp'||k==='u')body.scrollBy({top:-body.clientHeight*.85});
  else if(k==='g')body.scrollTop=0;
  else if(k==='G')body.scrollTop=body.scrollHeight;
  else if(k==='o')viewer.box.querySelector('.vfinder').click();
  else if(k==='y')viewer.box.querySelector('.vcopy').click();
  // swallow everything else so the board behind does not act on it
  else if(k.length===1||k==='Tab'||k==='Enter'||k==='Backspace')done=true;
  else done=false;
  if(done){e.preventDefault();e.stopImmediatePropagation()}
},true);

