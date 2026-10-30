// selftest.sh askq: a question held by the permission hook is asked in the panel, and picking answers it
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];
const held=()=>(live.cards||[]).find(x=>x.permAsk&&x.permAsk.questions);
await wait(()=>!!held(),30000).catch(()=>0);
let c=held();if(!c)return {ok:false,bad:['the held question reached a card']};
panelView='talk';openDetail(c,false,{focus:false,view:'talk'});
await wait(()=>!!document.querySelector('#mhist .askbox.askq'),10000).catch(()=>0);
let box=document.querySelector('#mhist .askbox.askq');
if(!box)return {ok:false,bad:['the question box is drawn in the conversation']};
const t=box.textContent;
if(!/Which color do you prefer\?/.test(t)||!/Red/.test(t)||!/Blue/.test(t))bad.push('the question and its options are shown');
if(box.querySelector('.askyes'))bad.push('a question has no 許可 button');
if(!box.querySelector('.aother'))bad.push('a line for your own answer');
if(!/ほかに 1 件/.test(t))bad.push('the second question waiting is counted');
// a redraw of the panel (a refresh) keeps the buttons answering
openDetail(c,true);await sleep(300);box=document.querySelector('#mhist .askbox.askq');
box.scrollIntoView({block:'end'});await sleep(500);
post({type:'selftestshot',name:'asked'});await sleep(900);
const first=c.permAsk.id;
box.querySelector('.aopt[data-q="0"][data-o="1"]').click();
// the next one comes up: two questions, one of several answers, sent with 答える
await wait(()=>{const x=held();return x&&x.permAsk.id!==first&&document.querySelector('#mhist .askbox.askq[data-perm="'+x.permAsk.id+'"]')},20000).catch(()=>0);
c=held();box=c&&document.querySelector('#mhist .askbox.askq[data-perm="'+c.permAsk.id+'"]');
if(!box)return {ok:false,bad:[...bad,'the second question came up after the first was answered']};
const send=box.querySelector('.askq-send');
if(!send||!send.disabled)bad.push('答える waits until every question has an answer');
box.querySelector('.aopt[data-q="0"][data-o="0"]').click();
box.querySelector('.aopt[data-q="1"][data-o="2"]').click();
box.querySelector('.aopt[data-q="1"][data-o="0"]').click();
await sleep(200);
if(send.disabled)bad.push('答える is ready once every question has an answer');
if(box.querySelectorAll('.aopt.on').length!==3)bad.push('the picks are marked');
box.scrollIntoView({block:'end'});await sleep(400);
post({type:'selftestshot',name:'asked2'});await sleep(900);
send.click();
await wait(()=>!held(),20000).catch(()=>0);
if(held())bad.push('the answered questions leave the card');
await sleep(800);
return {ok:bad.length===0,bad};
