// Skills: a message starting with /<name> runs it (headless too), so the picker only puts the name
// at the front of the box (lib/skills.js lists them).
function skillsFor(dir){
  const k=live.skills||{};
  const seen=new Set(),out=[];
  for(const x of [...((k.byDir||{})[dir]||[]),...(k.common||[])])if(!seen.has(x.name)){seen.add(x.name);out.push(x)}
  return out;
}
/** The box grows with its text, like a wrapping terminal line. */
function autoGrow(ta,max){
  if(!ta||ta.dataset.grow)return;ta.dataset.grow='1';
  const fit=()=>{ta.style.height='auto';ta.style.height=Math.min(max||220,ta.scrollHeight)+'px'};
  ta.addEventListener('input',fit);setTimeout(fit,0);
}
// ↑/↓ recall sent messages like a shell history: one list for every session, kept in localStorage.
function sentHist(){try{return JSON.parse(localStorage.getItem('senthist')||'[]')}catch(e){return []}}
function rememberSent(t){
  t=String(t||'').trim();if(!t||/^[\/／・]$/.test(t))return;
  const h=sentHist().filter(x=>x!==t);h.push(t);
  try{localStorage.setItem('senthist',JSON.stringify(h.slice(-200)))}catch(e){}
}
function histSetup(ta){
  let at=-1,shown=null;
  ta.addEventListener('input',()=>{if(ta.value!==shown){at=-1;shown=null}});
  ta.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229||e.shiftKey||e.altKey||e.metaKey||e.ctrlKey)return;
    if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
    const fresh=!ta.value||(shown!==null&&ta.value===shown);
    if(!fresh)return;                               // your own text: the arrows move the caret
    const h=sentHist();if(!h.length)return;
    if(e.key==='ArrowUp'){if(at===-1)at=h.length;if(at===0){e.preventDefault();return}at--}
    else{if(at===-1)return;at++;if(at>=h.length){at=-1;shown=null;ta.value='';delete ta.dataset.recalled;e.preventDefault();ta.dispatchEvent(new Event('input'));return}}
    e.preventDefault();
    shown=h[at];ta.value=shown;ta.dataset.recalled=shown;ta.dispatchEvent(new Event('input'));
    const end=ta.value.length;ta.setSelectionRange(end,end);
  });
}
// `@` completes a file name under the session's directory (fuzzy, basename weighted double; from git in a work tree).
const filesCache=new Map();
function filesFor(dir,cb){
  const e=filesCache.get(dir);
  if(e&&e.files&&Date.now()-e.at<60000){cb(e.files);return}
// one request per directory at a time, re-asked if no answer came
  if(e&&e.wait&&Date.now()-e.since<15000){e.wait.push(cb);return}
  filesCache.set(dir,{wait:[...((e&&e.wait)||[]),cb],since:Date.now()});
  if(native){post({type:'files',dir});return}
  fetch('api/files?dir='+encodeURIComponent(dir)).then(r=>r.json()).then(j=>window.__kanban.files(j)).catch(()=>window.__kanban.files({dir,files:[]}));
}
function filesArrived(j){
  const e=filesCache.get(j.dir)||{};const files=j.files||[];
  filesCache.set(j.dir,{files,at:Date.now()});
  for(const cb of e.wait||[])cb(files);
}
function fileSetup(ta,getDir){
  let pop=null,items=[],at=0,tok=null;
  const close=()=>{if(pop){pop.remove();pop=null}tok=null};
  const token=()=>{
    const v=ta.value,end=ta.selectionStart;if(end==null||end!==ta.selectionEnd)return null;
    const m=v.slice(0,end).match(/(^|\s)@([^\s@]*)$/);
    return m?{start:end-m[2].length-1,end,q:m[2]}:null;
  };
  const rank=(files,q)=>{
    if(!q)return files.slice().sort((a,b)=>a.split('/').length-b.split('/').length||a.length-b.length).slice(0,12);
    const out=[];
    for(const f of files){const v=fuzzy(q,f);if(!v)continue;out.push([v+fuzzy(q,f.slice(f.lastIndexOf('/')+1))*2,f])}
    return out.sort((a,b)=>b[0]-a[0]||a[1].length-b[1].length).slice(0,12).map(x=>x[1]);
  };
  const draw=()=>{
    if(!pop){pop=document.createElement('div');pop.className='skillpop filepop';(ta.closest('.prompt')||ta.parentElement).appendChild(pop)}
    pop.innerHTML=items.length?items.map((f,i)=>{const k=f.lastIndexOf('/');
      return '<div class="sk'+(i===at?' on':'')+'" data-i="'+i+'"><b>'+esc(f.slice(k+1))+'</b><span class="d">'+esc(k>0?f.slice(0,k):'')+'</span></div>'}).join('')
      :'<div class="dim">'+(tok&&tok.loading?t('読み込み中…'):t('一致するファイルがありません'))+'</div>';
    for(const r of pop.querySelectorAll('.sk'))r.onmousedown=e=>{e.preventDefault();pick(items[+r.dataset.i])};
    const cur=pop.querySelector('.sk.on');if(cur&&cur.scrollIntoView)cur.scrollIntoView({block:'nearest'});
  };
  const update=()=>{
    const t=token();const dir=getDir();
    if(!t||!dir){close();return}
    tok=t;tok.loading=true;
    let got=false;
    filesFor(dir,(files)=>{
      got=true;
      const now=token();if(!now||now.start!==t.start)return;   // moved on while the list was coming
      tok=now;tok.loading=false;items=rank(files,now.q);at=Math.min(at,Math.max(0,items.length-1));draw();
    });
// not here yet: show that, rather than leave a stale list up for Enter to pick from
    if(!got){items=[];draw()}
  };
  const pick=(f)=>{
    if(!f||!tok)return;
    const v=ta.value,ins='@'+f+' ';
    ta.value=v.slice(0,tok.start)+ins+v.slice(tok.end).replace(/^\s+/,'');
    const n=tok.start+ins.length;close();ta.focus();try{ta.setSelectionRange(n,n)}catch(e){}
    ta.dispatchEvent(new Event('input'));
  };
  ta.addEventListener('input',()=>{at=0;update()});
  ta.addEventListener('click',update);
  ta.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==ta)close()},150));
  ta.addEventListener('keydown',e=>{
    if(!pop||e.isComposing||e.keyCode===229)return;
    const k=e.key;
    if(k==='ArrowDown'||k==='ArrowUp'){if(items.length)at=(at+(k==='ArrowDown'?1:-1)+items.length)%items.length;draw()}
    else if((k==='Enter'&&!e.shiftKey)||k==='Tab'){if(!items.length){close();if(k==='Enter')return}else pick(items[at])}
    else if(k==='Escape')close();
    else return;
    e.preventDefault();e.stopImmediatePropagation();
  });
}
function skillSetup(box,ta,getDir,isClaude){
  const btn=box.querySelector('.skillbtn');
// two stages, like shell completion: the command, then its values (/model opus) or its argument hint
  let pop=null,items=[],at=0,mode='cmd',cmd=null,moved=false;
  const close=()=>{if(pop){pop.remove();pop=null}};
  const draw=()=>{
    const row=(x,i)=>mode==='arg'
      ? '<div class="sk'+(i===at?' on':'')+'" data-i="'+i+'"><b>'+esc(x.v)+'</b><span class="d">'+esc(x.d||'')+'</span></div>'
      : '<div class="sk'+(i===at?' on':'')+'" data-i="'+i+'"><b>/'+esc(x.name)+'</b>'
        +(x.scope==='project'?'<span class="sc">'+t('プロジェクト')+'</span>':x.scope==='plugin'?'<span class="sc">'+t('プラグイン')+'</span>':x.scope==='builtin'?'<span class="sc">'+t('組み込み')+'</span>':'')
        +'<span class="d">'+esc(x.desc||'')+'</span></div>';
    pop.innerHTML=mode==='hint'?'<div class="hintrow">/'+esc(cmd.name)+' <span class="d">'+esc(cmd.hint)+'</span></div>'
      :items.length?(mode==='arg'?'<div class="hintrow">/'+esc(cmd.name)+' <span class="d">'+esc(cmd.desc||'')+'</span></div>':'')+items.map(row).join('')
      :'<div class="dim">'+(mode==='arg'?t('候補にありません(そのまま送れます)'):t('該当するスキルがありません'))+'</div>';
    for(const r of pop.querySelectorAll('.sk'))r.onmousedown=e=>{e.preventDefault();pick(items[+r.dataset.i])};
    const cur=pop.querySelector('.sk.on');if(cur&&cur.scrollIntoView)cur.scrollIntoView({block:'nearest'});
  };
  const mount=()=>{if(!pop){pop=document.createElement('div');pop.className='skillpop';(ta.closest('.prompt')||ta.parentElement).appendChild(pop)}};
  const open=(q)=>{
    if(!isClaude()){close();return}
    const all=skillsFor(getDir());
    const qq=String(q||'').toLowerCase();
    mode='cmd';cmd=null;moved=false;
    items=qq?[...all.filter(x=>x.name.toLowerCase().startsWith(qq)),...all.filter(x=>!x.name.toLowerCase().startsWith(qq)&&(x.name+' '+x.desc).toLowerCase().includes(qq))]:all;
    at=0;mount();draw();
  };
  const openArgs=(name,q)=>{
    if(!isClaude()){close();return}
    const c=skillsFor(getDir()).find(x=>x.name===name);
    if(!c||(!c.args&&!c.hint)){close();return}
    cmd=c;
    if(c.args){const qq=String(q||'').toLowerCase();mode='arg';items=c.args.filter(a=>!qq||a.v.toLowerCase().startsWith(qq));at=0}
    else{if(q){close();return}mode='hint';items=[]}   // the hint until you start typing the argument
    mount();draw();
  };
  const pick=(x)=>{
    if(!x)return;
    if(mode==='arg'){ta.value='/'+cmd.name+' '+x.v;close();ta.focus();const n=ta.value.length;try{ta.setSelectionRange(n,n)}catch(e){}return}
    const rest=String(ta.value||'').replace(/^[\/／・][^\s]*\s*/,'');
    ta.value='/'+x.name+' '+rest;
    close();ta.focus();
    const n=x.name.length+2;try{ta.setSelectionRange(n,n)}catch(e){}
    if(!rest)openArgs(x.name,'');       // and straight on to what follows it
  };
  if(btn)btn.onclick=()=>{if(pop){close();return}open('');ta.focus()};
// /xxx at the start filters the list. With Japanese input, / arrives as ／ or ・ and the IME owns the
// arrows until commit, so the list opens on committed text and accepts all three.
  const check=(e)=>{
    if(e&&e.isComposing)return;
    const v=ta.value||'';
// a message recalled with ↑ is sent as is, not completed
    if(ta.dataset.recalled&&ta.dataset.recalled===v){close();return}
    const m=/^[\/／・]([^\s]*)$/.exec(v);
    if(m){open(m[1]);return}
    const a=/^[\/／・]([^\s]+) ([^\s]*)$/.exec(v);   // the command, one space, the start of its argument
    if(a){openArgs(a[1],a[2]);return}
    close();
  };
  ta.addEventListener('input',check);
  ta.addEventListener('compositionend',()=>setTimeout(check,0));
// a click on the list blurs the box first: close only if focus did not come back
  ta.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==ta)close()},150));
// registered before the textarea's Enter-to-send: keys the list takes stop here (stopImmediatePropagation)
  ta.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
// a bare "/" is never a message: Enter opens the list
    if(!pop&&e.key==='Enter'&&!e.shiftKey&&/^[\/／・]$/.test(ta.value||'')&&isClaude()){e.preventDefault();e.stopImmediatePropagation();open('');return}
    if(!pop)return;
    const k=e.key;
    if(k==='ArrowDown'||k==='ArrowUp'){at=(at+(k==='ArrowDown'?1:-1)+items.length)%Math.max(1,items.length);moved=true;draw()}
    else if(k==='Enter'||k==='Tab'){
// a hint, or no match: the list steps aside and Enter sends
      if(!items.length){close();if(k==='Enter')return;e.preventDefault();return}
// Enter on a typed name that no row starts with sends it as typed (a row matched only by description must not replace it)
      const typed=((/^[\/／・]([^\s]*)/.exec(ta.value||'')||[])[1]||'').toLowerCase();
      if(k==='Enter'&&mode==='cmd'&&!moved&&typed&&!items[at].name.toLowerCase().startsWith(typed)){close();return}
      pick(items[at])}
    else if(k==='Escape')close();
    else return;
    e.preventDefault();e.stopImmediatePropagation();
  });
  return {close};
}
document.addEventListener('dragover',e=>{if(!$('#detail')||$('#detail').hidden)return;e.preventDefault();document.body.classList.add('dropping')});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dropping')});
document.addEventListener('drop',e=>{
  const panel=$('#detail');if(!panel||panel.hidden)return;
  document.body.classList.remove('dropping');
  const box=$('#mbody');if(!box||!box.querySelector('.atts'))return;
  const files=(e.dataTransfer||{}).files||[];
  if(files.length){e.preventDefault();for(const f of files)attachUpload(box,f)}
});

// Holding ⌫ (or ⌦) in a box speeds up as in the terminal: past 0.5s each key repeat erases 2, past 1.5s 4, past 3s 8.
// Done with execCommand so ⌘Z still brings the words back; a composing IME keeps its own keys.
{let eraseAt=0;
  document.addEventListener('keydown',ev=>{
    if(ev.key!=='Backspace'&&ev.key!=='Delete'){return}
    const el=ev.target;if(!el||!(el.tagName==='TEXTAREA'||(el.tagName==='INPUT'&&/^(text|search|)$/.test(el.type||''))))return;
    if(ev.isComposing||ev.keyCode===229||ev.metaKey||ev.altKey||ev.ctrlKey)return;
    if(!ev.repeat){eraseAt=Date.now();return}
    const held=Date.now()-eraseAt,n=held>3000?8:held>1500?4:held>500?2:1;if(n===1)return;
    ev.preventDefault();for(let i=0;i<n;i++)document.execCommand(ev.key==='Backspace'?'delete':'forwardDelete');
  },true);
  document.addEventListener('keyup',ev=>{if(ev.key==='Backspace'||ev.key==='Delete')eraseAt=0},true)}
