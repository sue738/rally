// selftest.sh takeover: ここで開き直す. The card is a fixture conversation that the fake `claude agents`
// (selftest.sh) lists as open in another terminal, idle, with the pid of a stand-in claude that
// selftest.sh runs. Busy / waiting offer no button (and say why); idle does, two presses (the first
// says the other terminal's claude will be closed); then the app closes that claude (lib/takeover.js,
// the real one-shot: pid checked, SIGTERM) and the panel resumes the session. selftest.sh checks in
// argv.log that no resume came before the stand-in was gone.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
panelView='term';
let c=null;
for(let k=0;k<30&&!c;k++){c=(live.cards||[]).find(x=>x.alive&&x.aliveKind==='interactive'&&x.agent==='claude');if(!c){load();await sleep(1000)}}
if(!c)return {ok:false,bad:['the card stubbed as open in another terminal is not on the board']};
out.card=c.id.slice(0,8);
openDetail(c,false,{focus:false});await sleep(600);
expect('idle in another terminal: ここで開き直す beside 端末へ',!!$('#mtakeover')&&!!$('#mgoterm'));
// busy, then waiting on a prompt: not offered, and it says why (drawn from a copy: the board's own card is left as it is)
mountPanelTerm({...c,aliveStatus:'busy'},false);
expect('busy: no ここで開き直す, and 作業中なので移せません',!$('#mtakeover')&&/作業中なので移せません/.test($('#mterm').textContent));
mountPanelTerm({...c,aliveStatus:'waiting',aliveWaitingFor:'permission prompt'},false);
expect('waiting on a prompt: no ここで開き直す, and why',!$('#mtakeover')&&/確認待ち/.test($('#mterm').textContent));
mountPanelTerm(openCard,false);
expect('the palette offers it',palItems().some(x=>/^ここで開き直す/.test(x.t)));
// the first press only says what will happen
$('#mtakeover').click();
const b=$('#mtakeover');out.armed=b&&b.textContent;
expect('the first press asks: the other terminal\'s claude is closed, the conversation kept',!!b&&b.classList.contains('arm')&&/閉じて/.test(b.textContent)&&/会話は残ります/.test(b.textContent));
expect('… and the session is still not resumed here',!panelPty(c));
b.click();
const got=await wait(()=>{const p=panelPty(c);if(!p||p.gone)return false;const q=p.xt.buffer.active;let t='';for(let i=0;i<q.length;i++)t+=q.getLine(i).translateToString(true);return /fake claude (--resume|attach) /.test(t)},25000).then(()=>true,()=>false);
const p=panelPty(c);out.pty=p&&{kind:p.kind,session:p.session,gone:!!p.gone};
out.toast=($('#mbody .toast')||{}).textContent;
expect('the second press closes it there and resumes it in the panel',got&&!!p&&!!p.el.closest('#mterm'));
return {ok:bad.length===0,bad,...out};
