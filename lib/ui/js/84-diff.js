// The read-only file viewer. Text is escaped before any tag is made: it is whatever a session wrote.
function mdInline(s){
  // s is escaped already; code spans are set aside untouched
  const codes=[];
  s=s.replace(/`([^`]+)`/g,(_,c)=>{codes.push(c);return '\u0000'+(codes.length-1)+'\u0000'});
  // links made here are set aside too, so the bare-URL pass does not rewrite their href
  const made=[];const keep=(h)=>{made.push(h);return '\u0001'+(made.length-1)+'\u0001'};
  s=s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,(_,alt)=>'<span class="mdimg">'+t('[画像: {alt}]',{alt})+'</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)[^)]*\)/g,(_,t,u)=>keep('<a class="ext" href="'+u+'" title="'+u+'">'+t+'</a>'))
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/__([^_]+)__/g,'<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>').replace(/~~([^~]+)~~/g,'<s>$1</s>');
  s=s.replace(MD_PATH_RE,(m,pre,p)=>pre+keep('<a class="fpath" href="#" data-p="'+p+'" title="'+t('ビューワーで開く')+'">'+p+'</a>'));
  s=s.replace(/(^|[\s(])(https?:\/\/[^\s<>"'）)】\u0000\u0001]+)/g,(m,p,u)=>p+'<a class="ext" href="'+u+'" title="'+u+'">'+u+'</a>');
  // a code span that is just a path is a link too
  return s.replace(/\u0001(\d+)\u0001/g,(_,i)=>made[+i]).replace(/\u0000(\d+)\u0000/g,(_,i)=>/^\/Users\/\S+\.[A-Za-z0-9]{1,8}$/.test(codes[+i])?'<a class="fpath" href="#" data-p="'+codes[+i]+'" title="'+t('ビューワーで開く')+'"><code>'+codes[+i]+'</code></a>':'<code>'+codes[+i]+'</code>');
}
// opt.breaks: a newline is a line break, as the terminal shows it (an answer's lines — a list written with • — ran
// together into one paragraph in 会話). Files in the viewer keep Markdown's rule (a soft newline is a space).
function mdRender(src,opt){
  const breaks=!!(opt&&opt.breaks);
  const L=String(src||'').replace(/\r\n?/g,'\n').split('\n');
  let out='',i=0;
  if(L[0]==='---'){const e=L.indexOf('---',1);if(e>0){out+='<pre class="fm"><code>'+esc(L.slice(1,e).join('\n'))+'</code></pre>';i=e+1}}
  const para=[];
  // a soft newline is a space, but nothing between two CJK characters
  const soft=(t)=>breaks?t.replace(/\n/g,'<br>'):t.replace(/ {2,}\n/g,'<br>').replace(/([\u3000-\u9fff\uff00-\uffef])\n(?=[\u3000-\u9fff\uff00-\uffef])/g,'$1').replace(/\n/g,' ');
  const flush=()=>{if(para.length){out+='<p>'+soft(mdInline(esc(para.join('\n'))))+'</p>';para.length=0}};
  while(i<L.length){
    const l=L[i];
    let m;
    if((m=l.match(/^\s*(```+|~~~+)\s*([\w+-]*)/))){flush();const fence=m[1];const lang=m[2];const body=[];i++;
      while(i<L.length&&!L[i].trim().startsWith(fence))body.push(L[i++]);i++;
      out+='<div class="codeblk">'+CPY+'<pre'+(lang?' data-lang="'+esc(lang)+'"':'')+'><code>'+esc(body.join('\n'))+'</code></pre></div>';continue}
    if(!l.trim()){flush();i++;continue}
    if((m=l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))){flush();out+='<h'+m[1].length+'>'+mdInline(esc(m[2]))+'</h'+m[1].length+'>';i++;continue}
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){flush();out+='<hr>';i++;continue}
    if(/^\s*>/.test(l)){flush();const q=[];while(i<L.length&&/^\s*>/.test(L[i]))q.push(L[i++].replace(/^\s*>\s?/,''));out+='<blockquote>'+mdRender(q.join('\n'),opt)+'</blockquote>';continue}
    if(/^\s*\|.*\|\s*$/.test(l)&&i+1<L.length&&/^\s*\|?\s*:?-{2,}/.test(L[i+1])){flush();
      const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>mdInline(esc(c.trim())));
      const head=cells(l);i+=2;const rows=[];while(i<L.length&&/^\s*\|.*\|\s*$/.test(L[i]))rows.push(cells(L[i++]));
      out+='<div class="mdtable"><table><thead><tr>'+head.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';continue}
    if(/^\s*([-*+]|\d+[.)])\s+/.test(l)){flush();
      const items=[];while(i<L.length&&(/^\s*([-*+]|\d+[.)])\s+/.test(L[i])||(/^\s{2,}\S/.test(L[i])&&items.length))){
        const mm=L[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if(mm)items.push({ind:mm[1].length,ol:/\d/.test(mm[2]),t:mm[3]});else items[items.length-1].t+='\n'+L[i].trim();i++}
      const build=(from,ind)=>{let h='',k=from;const ol=items[from].ol;h+=ol?'<ol>':'<ul>';
        while(k<items.length&&items[k].ind>=ind){
          if(items[k].ind>ind){const r=build(k,items[k].ind);h=h.replace(/<\/li>$/,'')+r.h+'</li>';k=r.k;continue}
          let t=esc(items[k].t),box='';
          const cb=t.match(/^\[( |x|X)\]\s+/);if(cb){box='<span class="cb">'+(cb[1]===' '?'☐':'☑')+'</span> ';t=t.slice(cb[0].length)}
          h+='<li>'+box+soft(mdInline(t))+'</li>';k++}
        return {h:h+(ol?'</ol>':'</ul>'),k}};
      out+=build(0,items[0].ind).h;continue}
    para.push(l);i++;
  }
  flush();
  return out;
}
// Diff lines with their line numbers: new file's for + and context, old file's for −.
// A new file's diff (lib/changes.js) has no header and starts at 1.
function diffLines(d){
  const out=[],L=String(d||'').replace(/\n$/,'').split('\n');let o=1,n=1;
  // headers only between files: inside a hunk, a removed "--x" is content
  let inHunk=!/^diff /.test(L[0]);
  for(const l of L){
    if(l.startsWith('diff ')){inHunk=false;out.push({t:l,k:'dh'});continue}
    const h=l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if(h){o=+h[1];n=+h[2];inHunk=true;out.push({t:l,k:'dat'});continue}
    if(!inHunk){out.push({t:l,k:'dh'});continue}
    if(l[0]==='+')out.push({t:l,k:'da',n:n++});
    else if(l[0]==='-')out.push({t:l,k:'dd',o:o++});
    else if(l[0]==='\\')out.push({t:l,k:''});             // \ No newline at end of file
    else out.push({t:l,k:'',o:o++,n:n++});
  }
  return out;
}
// fi: the file's index in the review; its lines then take comments
function diffRender(d,bare,fi){
  if(!d)return '<div class="vempty">'+t('最後のコミットから変更はありません')+'</div>';
  let L=diffLines(d);
  if(bare)L=L.filter(l=>l.k!=='dh');
  const at=fi!=null;
  return '<pre class="vdiff">'+L.map(l=>{
    const ln=l.k==='dd'?'o'+l.o:l.n!=null?'n'+l.n:'';
    return at&&ln?'<span class="dl '+l.k+'" data-fi="'+fi+'" data-ln="'+ln+'">'+esc(l.t)+'</span>':'<span class="'+l.k+'">'+esc(l.t)+'</span>'}).join('\n')+'</pre>';
}
// Review comments, sent as one message like a PR review. Kept in the drafts ('dnote:agent:id',
// 00-core.js) because the review is redrawn on every read. Cleared once sent.
const diffNotes=new Map();   // 'agent:id' → [{abs, path, ln, code, note}]
function notesOf(k){
  if(!diffNotes.has(k)){const d=draftGet('dnote:'+k);diffNotes.set(k,((d&&d.o&&d.o.notes)||[]).filter(x=>x&&x.abs&&x.ln))}
  return diffNotes.get(k);
}
function notesSave(k){
  if(!k)return;
  const n=notesOf(k).filter(x=>String(x.note||'').trim()).map(({abs,path,ln,code,note})=>({abs,path,ln,code,note}));
  const ed=viewer&&viewer.changes===k&&viewer.box.querySelector('.dnote.edit');
  const wt=ed&&ed._x?String((ed.querySelector('textarea')||{}).value||''):'';
  const wip=wt.trim()?{abs:ed._x.abs,path:ed._x.path,ln:ed._x.ln,code:ed._x.code,t:wt}:null;
  draftSet('dnote:'+k,{t:[...n.map(x=>x.note),wip?wip.t:''].join('\n'),o:{notes:n,wip}});
}
const notesWipTried=new Set();
function reviewMessage(notes){
  const one=x=>{
    const del=x.ln[0]==='o';
    const code=String(x.code||'').slice(1).trim().replace(/`/g,"'");
    const note=String(x.note||'').trim().replace(/\n/g,'\n  ');
    return '- '+x.path+':'+x.ln.slice(1)+(del?'(削除行)':'')+(code?' `'+(code.length>80?code.slice(0,80)+'…':code)+'`':'')+' — '+note};
  return '変更へのレビューコメントです。\n'+notes.filter(x=>String(x.note||'').trim()).map(one).join('\n');
}
function noteLine(sp){
  if(!viewer||!viewer.data)return null;
  const f=(viewer.data.files||[])[+sp.dataset.fi];if(!f)return null;
  return {abs:f.path,path:relPath(f),ln:sp.dataset.ln,code:sp.textContent};
}
// after the line's own newline, so no empty line is left
function placeAfter(sp,el){if(!sp.parentNode)return;const r=sp.nextSibling;sp.parentNode.insertBefore(el,r&&r.nodeType===3?r.nextSibling:r)}
function lineSpan(x){
  if(!viewer||!viewer.data)return null;
  const i=(viewer.data.files||[]).findIndex(f=>f.path===x.abs);
  return i<0?null:viewer.box.querySelector('.vsec[data-i="'+i+'"] .dl[data-ln="'+x.ln+'"]');
}
function drawNotes(){
  if(!viewer||!viewer.changes)return;
  const notes=notesOf(viewer.changes),editing=(viewer.box.querySelector('.dnote.edit')||{})._x;
  for(const d of viewer.box.querySelectorAll('.dnote:not(.edit)'))d.remove();
  for(const x of notes){
    if(x===editing)continue;
    const sp=lineSpan(x);if(!sp)continue;
    const d=document.createElement('div');d.className='dnote';
    d.innerHTML='<span class="dnt"></span><button class="dne" title="'+t('直す')+'">'+t('直す')+'</button><button class="dnx" title="'+t('消す')+'">×</button>';
    d.querySelector('.dnt').textContent=x.note;
    d.querySelector('.dne').onclick=()=>openNote(sp,x);
    d.querySelector('.dnx').onclick=()=>{notes.splice(notes.indexOf(x),1);drawNotes()};
    placeAfter(sp,d);
  }
  const bar=viewer.box.querySelector('.vnotes');
  if(bar){const n=notes.length;bar.hidden=!n&&!viewer.box.querySelector('.dnote.edit');bar.querySelector('.vncount').textContent=t('コメント {n} 件',{n})}
  notesSave(viewer.changes);
  // reopen a comment left unsaved on reload, once per page
  const k=viewer.changes;
  if(!notesWipTried.has(k)&&!viewer.box.querySelector('.dnote.edit')){const d=draftGet('dnote:'+k),w=d&&d.o&&d.o.wip,sp=w&&lineSpan(w);
    if(sp){notesWipTried.add(k);openNote(sp,notes.find(y=>y.abs===w.abs&&y.ln===w.ln)||null);const ta=viewer.box.querySelector('.dnote.edit textarea');if(ta)ta.value=w.t;notesSave(k)}}
}
function openNote(sp,had){
  const x=had||noteLine(sp);if(!x||!viewer)return;
  const was=viewer.box.querySelector('.dnote.edit');if(was)saveNote(was);
  // one box per line: clicking again edits it
  const notes=notesOf(viewer.changes);
  const cur=had||notes.find(y=>y.abs===x.abs&&y.ln===x.ln);
  const ed=document.createElement('div');ed.className='dnote edit';ed._x=cur||x;
  ed.innerHTML='<textarea rows="2" placeholder="'+t('この行へのコメント(Enter で保存 · ⇧Enter 改行 · Esc で取り消し)')+'"></textarea><div class="dnb"><button class="dns">'+t('保存')+'</button><button class="dnc">'+t('取り消し')+'</button></div>';
  const ta=ed.querySelector('textarea');ta.value=cur?cur.note:'';
  {let t=0;const k=viewer.changes;ta.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>notesSave(k),300)})}
  ed.querySelector('.dns').onclick=()=>{saveNote(ed);drawNotes()};
  ed.querySelector('.dnc').onclick=()=>{ed.remove();drawNotes()};
  ta.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();ed.remove();drawNotes();viewer&&viewer.box.querySelector('.vbody').focus({preventScroll:true})}
    else if(e.key==='Enter'&&!e.shiftKey&&!e.metaKey){e.preventDefault();e.stopPropagation();saveNote(ed);drawNotes();viewer&&viewer.box.querySelector('.vbody').focus({preventScroll:true})}
  });
  placeAfter(sp,ed);drawNotes();
  ta.focus();
}
function saveNote(ed){
  if(!viewer||!ed||!ed._x)return;
  const notes=notesOf(viewer.changes),x=ed._x,t=ed.querySelector('textarea').value.trim();
  const i=notes.indexOf(x);
  if(!t){if(i>=0)notes.splice(i,1)}
  else{x.note=t;if(i<0)notes.push(x)}
  ed.remove();
}
function sendNotes(){
  if(!viewer||!viewer.changes)return;
  const ed=viewer.box.querySelector('.dnote.edit');if(ed)saveNote(ed);
  drawNotes();
  const k=viewer.changes,notes=notesOf(k).filter(x=>x.note);
  const bar=viewer.box.querySelector('.vnotes');
  if(!notes.length||!bar||bar.dataset.sending)return;
  const [agent,...rest]=k.split(':'),session=rest.join(':');
  const c=(live.cards||[]).find(x=>x.agent===agent&&x.id===session);
  const text=reviewMessage(notes);
  // the same route as the panel's box (sendTo)
  bar.onDispatched=r=>{delete bar.dataset.sending;if(r.error)return;
    const left=notesOf(k);for(const x of notes){const i=left.indexOf(x);if(i>=0)left.splice(i,1)}
    notesSave(k);if(viewer&&viewer.changes===k)drawNotes()};
  dispatch({type:'reply',agent,session,text,dir:c?c.project:'',typeInto:native},bar);
  if(panelKey===k)echoSent(text,[]);
}
// comment on the first changed line in sight (keyboard)
function noteHere(){
  if(!viewer||!viewer.changes)return;
  const body=viewer.box.querySelector('.vbody'),top=body.getBoundingClientRect().top;
  const sp=[...body.querySelectorAll('.dl.da,.dl.dd')].find(x=>x.getBoundingClientRect().bottom>top);
  if(sp)openNote(sp);
}
