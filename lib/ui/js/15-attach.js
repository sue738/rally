// Attachments: pasted/dropped bytes are saved to ~/.rally/attachments/ (granted by --add-dir) and the
// message carries their paths.
const attachDone=new Map();
function attachPaths(box){return [...box.querySelectorAll('.atts .att')].map(a=>a.dataset.path).filter(Boolean)}
// a send waits for files still being saved; one that never saves is marked, not silently dropped
function attachWaiting(box){return [...box.querySelectorAll('.atts .att')].filter(a=>!a.dataset.path&&!a.classList.contains('bad'))}
function attachAfter(box,go){
  if(!attachWaiting(box).length)return false;
  if(box.dataset.attwait)return true;
  box.dataset.attwait='1';toast(box,t('添付を保存しています…保存できたら送ります'));
  const t0=Date.now();
  const tick=()=>{
    const w=attachWaiting(box);
    if(w.length&&Date.now()-t0<20000){setTimeout(tick,150);return}
    for(const a of w){a.classList.add('bad');a.querySelector('.n').textContent=t('保存できませんでした')}
    delete box.dataset.attwait;
    if(w.length)toast(box,t('添付を保存できなかったので送りませんでした(× で外すと送れます)'));else go();
  };
  setTimeout(tick,150);return true;
}
function attachClear(box){const a=box.querySelector('.atts');if(a)a.innerHTML=''}
// attachments in the app's log: where each went and when one left the box (a pasted picture went missing once and
// nothing showed whether it was dropped, replaced or typed into a terminal)
function attachLog(what){if(native)try{post({type:'log',text:'attach '+what+(openCard?' · '+openCard.agent+':'+String(openCard.id).slice(0,8):'')})}catch(e){}}
function attachChip(box,name,preview){
  const row=box.querySelector('.atts');if(!row)return null;
  const el=document.createElement('span');el.className='att';
  el.innerHTML='<span class="n"></span>'+(preview?'<img>':'')+'<button title="'+t('外す')+'">×</button>';
  el.querySelector('.n').textContent=name+' …';
  if(preview){const im=el.querySelector('img');if(im)im.src=preview}
  el.querySelector('button').onclick=()=>{attachLog('removed by ×: '+(el.dataset.path||name).split('/').pop());el.remove();if(box===$('#mbody'))keepUnsent()};
  row.appendChild(el);return el;
}
function attachRestore(box,paths){
  for(const p of paths||[]){const chip=attachChip(box,String(p).split('/').pop());if(!chip)return;
    chip.dataset.path=p;chip.querySelector('.n').textContent=String(p).split('/').pop()}
}
function attachUpload(box,file){
  const name=file.name||('paste-'+Date.now()+'.png');
  const preview=(file.type||'').startsWith('image/')?URL.createObjectURL(file):'';
  const chip=attachChip(box,name,preview);if(!chip)return;
  attachLog('pasted into the '+(box===$('#mbody')?'message box':'new-session box')+': '+name+' ('+Math.round((file.size||0)/1024)+' KB)');
  const fr=new FileReader();
  fr.onload=()=>{
    const b64=String(fr.result||'').split(',').pop();
    const token=String(Date.now())+Math.random();
    attachDone.set(token,chip);
    if(native)post({type:'attach',name,data:b64,token});
    else fetch('api/attach',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,data:b64})})
      .then(r=>r.json()).then(j=>window.__kanban.attached({...j,token})).catch(e=>window.__kanban.attached({token,error:String(e)}));
  };
  fr.onerror=()=>{chip.classList.add('bad');chip.querySelector('.n').textContent=t('{name} 読めません',{name})};
  fr.readAsDataURL(file);
}
// registered on window.__kanban with the bridge's handlers
// an image pasted into a session's terminal (⌘V): saved like an attachment, then its path typed there — codex and
// claude take a pasted image path as the image (a terminal paste carries text only, so ⌘V of a picture did nothing)
const ptyAttachWait=new Map();   // token → pty id
document.addEventListener('paste',e=>{
  if(typeof ptys==='undefined'||!native)return;
  const p=[...ptys.values()].find(x=>!x.gone&&x.el&&x.el.contains(e.target));if(!p)return;
  const files=[...((e.clipboardData||{}).items||[])].filter(it=>it.kind==='file').map(it=>it.getAsFile()).filter(Boolean);
  if(!files.length)return;
  e.preventDefault();e.stopPropagation();attachLog('pasted into the terminal ('+p.kind+'): '+files.length+' file(s), their paths typed there');
  for(const f of files){
    const fr=new FileReader();
    fr.onload=()=>{const token='pty'+Date.now()+Math.random();ptyAttachWait.set(token,p.id);
      post({type:'attach',name:f.name||'pasted.png',data:String(fr.result||'').split(',').pop(),token})};
    fr.readAsDataURL(f);
  }
},true);
function attachedResult(r){
  const pid=ptyAttachWait.get(r.token);
  if(pid!=null){ptyAttachWait.delete(r.token);const q=ptys.get(pid);
    if(!q||q.gone)return;if(r.error||!r.path){flash(t('画像を保存できませんでした'));return}
    q.xt.paste(r.path+' ');q.xt.focus();return}
  const chip=attachDone.get(r.token);attachDone.delete(r.token);if(!chip)return;
  if(r.error||!r.path){chip.classList.add('bad');chip.querySelector('.n').textContent=(r.error||t('保存できません'));return}
  chip.dataset.path=r.path;attachLog('saved: '+r.path.split('/').pop());
  chip.querySelector('.n').textContent=r.name||r.path.split('/').pop();
  if(chip.closest&&chip.closest('#mbody'))keepUnsent();
}
function attachSetup(box){
  const ta=box.querySelector('.msg textarea'),btn=box.querySelector('.attbtn'),inp=box.querySelector('.attinput');
  if(btn&&inp){btn.onclick=()=>inp.click();inp.onchange=()=>{for(const f of inp.files||[])attachUpload(box,f);inp.value=''}}
  if(ta)ta.addEventListener('paste',e=>{
    const items=(e.clipboardData||{}).items||[];let took=false;
    for(const it of items){if(it.kind==='file'){const f=it.getAsFile();if(f){attachUpload(box,f);took=true}}}
    if(took)e.preventDefault();
  });
}
