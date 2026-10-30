// selftest.sh agynew: an Antigravity session from 新規. The agent row offers antigravity; Enter runs
// agy -p (the fake: it names a conversation and answers "fake antigravity: PONG"), the panel moves onto
// that conversation's card, which the board reads from its own log of the run, and the thread shows the
// ask and the answer. A second message from the panel's box goes on with the same conversation.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
openNew();await sleep(300);
const ab=$('#nagent [data-v="antigravity"]');
expect('新規 offers antigravity',!!ab);
if(!ab)return {ok:false,bad,out};
ab.click();await sleep(100);
const dir=(live.trusted||[])[0]||ST_ENV.cwd||live.home;
$('#ndir').value=dir;$('#ndir').dispatchEvent(new Event('input'));
$('#ntext').value='selftest: say PONG';
$('#ntext').onkeydown({key:'Enter',shiftKey:false,isComposing:false,keyCode:13,preventDefault(){}});
await wait(()=>/^antigravity:/.test(panelKey||''),20000).catch(()=>0);
out.panel=panelKey;
expect('the panel moves onto the antigravity conversation ('+panelKey+')',/^antigravity:[0-9a-f-]{36}$/.test(panelKey||''));
await wait(()=>/fake antigravity: PONG/.test(($('#mhist')||{}).textContent||''),15000).catch(()=>0);
out.thread=(($('#mhist')||{}).textContent||'').replace(/\s+/g,' ').slice(0,200);
expect('its thread shows the ask and the answer',/say PONG/.test(out.thread)&&/fake antigravity: PONG/.test(out.thread));
const c=(live.cards||[]).find(x=>'antigravity:'+x.id===panelKey);
out.card=c&&{column:c.column,reason:c.reason};
expect('the card is answered once the run ended',!!c&&c.column==='answered');
expect('the panel has a send box',!!$('#mbody .msg textarea'));
closeDetail('selftest');
return {ok:bad.length===0,bad,out};
