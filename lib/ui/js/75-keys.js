// The terminal strip is selectable like a card below the last one: ↑ goes back, Enter / i go in.
let termSel=false;
function setTermSel(on){termSel=on;document.body.classList.toggle('termsel',on);const t=$('#term');if(t)t.classList.toggle('sel',on)}
function goTerminal(focus,unfold){
  const i=paneIn(activePane());if(!i||i.disabled||window.innerWidth<1011)return false;
  // ↓ past the last card selects the strip only when it is showing: folded, it is not unfolded by a key that only moves
  if(!unfold&&document.body.classList.contains('termclosed'))return false;
  if(document.body.classList.contains('termclosed'))termOpen(true);
  setTermSel(true);if(focus){if(ptyOn!=='cmd')ptyShow(ptyOn);else i.focus()}else if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return true;
}
// stripTouched: a click on the strip outside any field leaves focus on the page; Enter then goes to the strip
let stripTouched=false;
document.addEventListener('mousedown',e=>{const inT=!!(e.target.closest&&e.target.closest('#term'));stripTouched=inT;if(termSel&&!inT)setTermSel(false)},true);
document.addEventListener('focusin',e=>{const t=e.target;if(!t||!t.closest)return;if(t.closest('#term'))stripTouched=true;else if(t.closest('#detail,section.col,#q'))stripTouched=false},true);
function openSelected(how){
  const c=(live.cards||[]).find(x=>x.agent+':'+x.id===sel);
  if(c)openDetail(c,false,how);
}
function panelOpen(){return !$('#detail').hidden}
/** The … menu from the keyboard: ↑↓ walk it, Enter presses, Esc closes. */
// one-line fields count too (a title being renamed, a question's answer)
function typingInPanel(){const a=document.activeElement;return !!(a&&(a.tagName==='TEXTAREA'||a.tagName==='INPUT'&&/^(text|search|)$/.test(a.type||''))&&a.closest&&a.closest('#mbody'))}
let redrawLater=null;
document.addEventListener('focusout',e=>{
  if(!redrawLater||!e.target||!e.target.closest||!e.target.closest('#mbody'))return;
  setTimeout(()=>{const c=redrawLater;if(!c||typingInPanel())return;redrawLater=null;
    if(openFor===c.agent+':'+c.id){openSig=cardSig(c);openDetail(c,true)}},0);
});
function msgBox(){return $('#mbody .msg textarea')||$('#ntext')}
// When a terminal or field last lost focus: keys typed just after were meant for it, and a digit
// must not answer a permission prompt. (A removed pane fires no focusout: ptyDrop calls keysLeft.)
const KEYS_LEFT_MS=10000;let keysLeftAt=0;
function keysLeft(){keysLeftAt=Date.now()}
document.addEventListener('focusout',e=>{const t=e.target;if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||'')||t.isContentEditable||(t.closest&&t.closest('.xterm'))))keysLeft()},true);
// digits answer a held prompt only while it is visible (会話 view) and focus did not just leave a field
function permKeysOk(box){
  const mb=$('#mbody');if(!box||box.hidden||(mb&&mb.classList.contains('pterm')))return false;
  const a=document.activeElement;if(a&&a!==document.body&&box.contains&&box.contains(a))return true;
  return Date.now()-keysLeftAt>KEYS_LEFT_MS;
}
// in the terminal view the box is hidden: keys meant for it (i, Enter, /) go to the terminal
function panelLivePty(){if(!panelOpen()||!openCard||!$('#mbody').classList.contains('pterm'))return null;const p=panelPty(openCard);return p&&!p.gone&&p.el.closest('#mterm')?p:null}
document.addEventListener('keydown',e=>{
  const t=e.target||{};const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||'')||t.isContentEditable
    // in a terminal the keys are the program's
    ||!!(t.closest&&t.closest('.xterm'));
  if(typing||e.metaKey||e.ctrlKey||e.altKey||e.isComposing||e.keyCode===229)return;
  const k=e.key,A=kmAct(e);
  const hist=$('#mhist');
  if((e.shiftKey&&(k==='ArrowDown'||k==='ArrowUp')||A==='hist.down'||A==='hist.up')&&panelOpen()&&hist){e.preventDefault();const dn=k==='ArrowDown'||A==='hist.down';if(!dn)histStick=false;hist.scrollBy({top:dn?80:-80});return}
  if((k==='PageDown'||k==='PageUp')&&panelOpen()&&hist){e.preventDefault();if(k==='PageUp')histStick=false;hist.scrollBy({top:(k==='PageDown'?1:-1)*hist.clientHeight*.85});return}
  // with a panel open, / starts a command in the message box; the filter is f
  if(A==='filter.slash'&&panelOpen()){const tp=panelLivePty();if(tp){e.preventDefault();tp.xt.focus();post({type:'ptyin',id:tp.id,data:'/'});return}
    const b=msgBox();if(b&&!b.disabled){e.preventDefault();b.focus();
    if(!b.value){b.value='/';b.dispatchEvent(new Event('input'))}return}}
  if(A==='filter.slash'||A==='filter.f'){e.preventDefault();openPalette();return}
  if(termSel){
    const i=paneIn(activePane());
    if(k==='ArrowUp'){e.preventDefault();setTermSel(false);const el=cardEls().find(x=>x.dataset.agent+':'+x.dataset.id===sel);if(el)selectEl(el);else moveSel(0,0);return}
    if(k==='ArrowDown'){e.preventDefault();return}
    if(k==='Enter'){e.preventDefault();if(ptyOn!=='cmd')ptyShow(ptyOn);else if(i&&!i.disabled)i.focus();return}
    if(ptyOn!=='cmd'&&k.length===1){e.preventDefault();ptyShow(ptyOn);return}
    // a letter starts a command (j, k… are text here)
    if(k.length===1&&i&&!i.disabled){e.preventDefault();i.focus();i.value+=k;const n=i.value.length;try{i.setSelectionRange(n,n)}catch(x){}return}
  }
  if(A==='nav.down'||k==='ArrowDown'){e.preventDefault();moveSel(1,0);return}
  if(A==='nav.up'||k==='ArrowUp'){e.preventDefault();moveSel(-1,0);return}
  if(A==='nav.right'||k==='ArrowRight'){e.preventDefault();moveSel(0,1);return}
  if(A==='nav.left'||k==='ArrowLeft'){e.preventDefault();moveSel(0,-1);return}
  if(A==='nav.top'){e.preventDefault();selectCard(0);return}
  if(A==='nav.bottom'){e.preventDefault();selectCard(cardEls().length-1);return}
  if(k==='Enter'&&stripTouched&&!document.body.classList.contains('termclosed')&&goTerminal(true)){e.preventDefault();return}
  if(k==='Enter'||A==='open.o'){
    e.preventDefault();
    if(!sel){moveSel(0,0);return}
    if(panelOpen()&&openFor===sel){const tp=panelLivePty();if(tp){tp.xt.focus();return}const b=msgBox();if(b)b.focus();return}
    openSelected({focus:false});return}
  if(k===' '){e.preventDefault();if(panelOpen())closeDetail('space');else if(sel)openSelected({focus:false});else moveSel(0,0);return}
  if(A==='panel.input'&&panelOpen()){e.preventDefault();const tp=panelLivePty();if(tp){tp.xt.focus();return}const b=msgBox();if(b)b.focus();return}
  if(A==='panel.copyid'&&panelOpen()&&openCard){e.preventDefault();copyId(openCard);return}
  if(A==='panel.fold'&&panelOpen()&&$('#mfold')){e.preventDefault();panelFoldSet(!panelFold);return}
  if(A==='panel.parent'&&panelOpen()){const pb=$('#mparent');if(pb){e.preventDefault();pb.click()}return}
  if(A==='done.toggle'){e.preventDefault();$('#showdone').click();return}
  if(A==='subs.toggle'){e.preventDefault();$('#subs').click();return}
  // digits pick a held prompt's choices, as in the terminal (see permKeysOk)
  if(/^[1-9]$/.test(k)&&panelOpen()&&openCard&&openCard.permAsk&&!openCard.permAsk.questions){
    const box=$('#mhist .askbox.held');
    if(box&&box.dataset.perm===openCard.permAsk.id){if(!permKeysOk(box))return;const b=box.querySelectorAll('.askch')[+k-1];e.preventDefault();if(b&&!b.disabled)permPick(openCard,b);return}}
  if((k==='1'||k==='2'||k==='3')&&panelOpen()){
    const b=document.querySelector('#mbody .viewpick button[data-v="'+({1:'all',2:'last3',3:'last'})[k]+'"]');
    if(b){e.preventDefault();b.click()}return}
  if(A==='reload.key'){e.preventDefault();load();return}
  if(A==='panel.reply'&&panelOpen()){if(replyLatest())e.preventDefault();return}
  if(A==='panel.changes'&&panelOpen()&&openCard&&openCard.agent==='claude'){e.preventDefault();openChanges(openCard);return}
  if(A==='panel.goterm'&&panelOpen()&&openCard&&canGoTerm(openCard)){e.preventDefault();goTerm(openCard);return}
  if(A==='panel.editor'&&panelOpen()&&openCard){e.preventDefault();openEditor(openCard);return}
  if(A==='panel.ptygo'&&panelOpen()){const b=$('#mbody .mbtns .ptygo');if(b){e.preventDefault();b.click()}return}
  if(A==='term.key'){e.preventDefault();termOpen(document.body.classList.contains('termclosed'));
    if(!document.body.classList.contains('termclosed')){const i=paneIn(activePane());if(i&&!i.disabled)i.focus()}return}
  if(A==='help.key'){e.preventDefault();toggleHelp();return}
  if(A==='pending.key'){e.preventDefault();togglePanel('pending',openPendingAll);return}
  if(A==='theme.key'){e.preventDefault();$('#theme').click();return}
  if(A==='hours.up'||A==='hours.up2'||A==='hours.down'){e.preventDefault();hoursStep(A==='hours.down'?-1:1);return}
});
