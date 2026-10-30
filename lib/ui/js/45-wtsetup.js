// ---- worktree setup (lib/wtsetup.js) ------------------------------------
// A worktree gets tracked files only: offer to add the missing gitignored
// config to .worktreeinclude, and keep a per-repo setup command for the first message.
let wtAskFor='',wtTimer=0;
function wtNote(cmd){cmd=String(cmd||'').trim();return cmd?'(このセッションは新しい git worktree で動いています。作業の前に、この worktree で `'+cmd+'` を実行して準備してください)\n\n':''}
function wtAsk(dir){
  const m0=$('#nwtinfo .wtmiss');if(!dir||(dir===wtAskFor&&m0&&m0.dataset.done))return;wtAskFor=dir;clearTimeout(wtTimer);
  // debounced while typing a path
  wtTimer=setTimeout(()=>{if(native)post({type:'wtsetup',dir});
    else fetch('api/wtsetup?dir='+encodeURIComponent(dir)).then(r=>r.json()).then(j=>wtArrived(j)).catch(()=>{})},300);
}
function wtPost(m){
  if(native)post({type:'wtsetup',...m});
  else fetch('api/wtsetup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).then(r=>r.json()).then(j=>wtArrived(j)).catch(()=>{const b=$('#nwtinc');if(b)b.disabled=false});
}
function wtHtml(j){
  if(!j||j.error||!j.root)return '<span class="dim">'+t('git のリポジトリではないので worktree は切れません')+'</span>';
  const names=a=>a.slice(0,4).map(f=>'<code>'+esc(f)+'</code>').join(' ')+(a.length>4?' '+t('ほか {n} 件',{n:a.length-4}):'');
  if((j.missing||[]).length)return '<span class="wtwarn">'+t('worktree に写らない:')+' '+names(j.missing)+'</span> <button id="nwtinc" class="mini" title="'+t('リポジトリ直下の .worktreeinclude に足します。Claude Code が worktree を作るときにこれらを写します')+'">'+t('.worktreeinclude に足す')+'</button>';
  if((j.copied||[]).length)return '<span class="dim">'+t('.worktreeinclude で写すもの:')+' '+names(j.copied)+'</span>';
  return '';
}
function wtArrived(j){
  const wi=$('#nwtinfo');if(!wi||!j)return;
  const d=($('#ndir').value||'').trim();if(j.dir&&j.dir!==d)return;   // the path moved on
  const m=wi.querySelector('.wtmiss');if(m){m.innerHTML=wtHtml(j);m.dataset.done='1'}
  const wc=$('#nwtcmd');if(wc&&document.activeElement!==wc)wc.value=j.setup||'';
  if(j.added&&j.added.length)toast($('#mbody'),t('.worktreeinclude に {n} 件足しました',{n:j.added.length}));
  const b=$('#nwtinc');if(b)b.onclick=()=>{b.disabled=true;wtPost({dir:d,include:j.missing})};
}
