// ▶ 実行 beside a ! command in an answer (`! gcloud auth login`, or a fenced block of one such line): a click types it
// into the session's own terminal in Claude Code's bash mode, as a ! typed in the message box goes (panelSlash), and its
// output lands in the conversation. Drawn only where this app can open the session's terminal (historyHtml); never in the
// file viewer, which shares mdRender.
/** The command after the mark, or null: one line, a space after ! (`!==`, `!isReady` are code, not commands), not an
 * example (`! <command>`). */
function bangCmd(s){
  const m=String(s||'').trim().match(/^[!！][ \t]+(\S[^\n]*)$/);if(!m)return null;
  const cmd=m[1].trim();
  if(/<[A-Za-z][\w .-]*>/.test(cmd)||/^(\.\.\.|…)$/.test(cmd))return null;
  // what is typed must be what is read: a control character (an escape ends a bracketed paste) or an invisible / bidi mark
  // would run something the line on screen does not say
  if(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/.test(cmd))return null;
  return cmd;
}
/** mdRender's HTML for one answer, with ▶ 実行 after each ! command. The code is escaped already (esc). */
function bangMark(html){
  const unesc=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  const btn=cmd=>'<button class="bangrun" type="button" title="'+esc(t('このセッションのターミナルで実行: ! {cmd}',{cmd}))+'">'+t('▶ 実行')+'</button>';
  // a fenced block: the button beside its copy button; its code is marked so the inline pass leaves it alone
  html=html.replace(/<div class="codeblk">([\s\S]*?<pre[^>]*>)<code>([^<]*)<\/code><\/pre><\/div>/g,(m,head,body)=>{
    const c=bangCmd(unesc(body));return c?'<div class="codeblk bang">'+btn(c)+head+'<code class="bangc">'+body+'</code></pre></div>':m});
  return html.replace(/<code>([^<]*)<\/code>/g,(m,body)=>{const c=bangCmd(unesc(body));return c?'<span class="bangw">'+m+btn(c)+'</span>':m});
}
/** Type `! cmd` into c's terminal (opened or resumed here if need be), shown in the thread as typed. false: it cannot be. */
function bangRun(c,cmd,b){
  const line='! '+cmd;let res=null,el=null;
  sendLog(c,'bang',line);
  if(b)b.disabled=true;
  const fin=ok=>{res=!!ok;
    if(ok){if(b){b.classList.add('done');b.textContent=t('送信済み')}return}
    echoDrop(el);el=null;if(b)b.disabled=false};
  if(!panelSlash(c,'!'+cmd,fin)){
    if(b)b.disabled=false;
    // open in a terminal this app does not own: the command is copied for there
    copyText(line);toast($('#mbody'),t('このセッションはこのアプリのターミナルでは開けないので、コマンドをコピーしました。開いている端末に貼って実行してください'));return false}
  if(res!==false)el=echoTyped(line);
  return true;
}
// capture: a click on the button must not also fold the answer it sits in
document.addEventListener('click',e=>{
  const b=e.target&&e.target.closest&&e.target.closest('.bangrun');if(!b)return;
  e.preventDefault();e.stopPropagation();
  const blk=b.closest('.codeblk'),src=blk?blk.querySelector('pre'):b.previousElementSibling;
  const cmd=bangCmd(src&&src.textContent);
  if(!cmd||!openCard||!b.closest('#mhist'))return;
  bangRun(openCard,cmd,b);
},true);
