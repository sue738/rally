// selftest.sh qmark: a line ending in ？ (or ?, ！, 、) near the box's right edge: the box shows all of it
// (its height follows the wrapped text — a CJK mark cannot start a line, so it takes a word with it),
// at every width the text could wrap at.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:false,bad:['no claude card on the fixture board']};
panelView='talk';openDetail(c,false,{focus:false,view:'talk'});await wait(()=>$('#mbody .msg textarea'),5000);
const ta=$('#mbody .msg textarea');const miss=[];
for(const mark of ['？','?','！','、','。']){
  for(let n=8;n<=60;n++){
    ta.value='あ'.repeat(n)+'か'+mark;ta.dispatchEvent(new Event('input'));
    if(ta.scrollHeight>ta.clientHeight+1)miss.push(mark+n);
  }
}
out.miss=miss.slice(0,12);out.width=Math.round(ta.clientWidth);
expect('the box grows to show a line ending in a mark, at every length',miss.length===0);
// the same text typed by an IME: the height is refitted when the composition ends too
ta.value='';ta.dispatchEvent(new Event('input'));
const long='あ'.repeat(Math.floor(ta.clientWidth/13)-1)+'か？';
ta.value=long;ta.dispatchEvent(new CompositionEvent('compositionend',{data:'か？',bubbles:true}));await sleep(100);
expect('after compositionend the box shows all of it',ta.scrollHeight<=ta.clientHeight+1);
ta.value='';ta.dispatchEvent(new Event('input'));
return {ok:bad.length===0,bad,out};
