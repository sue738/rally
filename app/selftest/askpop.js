// selftest.sh askpop: a permission prompt that just came up shows a small card in the corner — whose,
// the whole request, はい / いいえ / 開く — in the lower right corner, without taking focus; 許可 answers it; it goes once the prompt is gone.
// The arrivals are fed by hand (a copy of a fixture card); post and permAnswer are stubbed.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);closeDetail('x');
const base=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!base)return {ok:false,bad:['no claude card on the fixture board']};
const p0=window.post,pa0=window.permAnswer;const answered=[];
window.post=m=>{if(m&&/^(notify|badge|asks)$/.test(m.type))return;return p0(m)};
window.permAnswer=(c,d)=>{answered.push(d)};
try{
  const c={...base,id:'askpop-selftest',column:'needs-you',title:'askpop selftest'};
  const ask={id:'a'.repeat(32),tool:'Bash',what:'git status'};
  tellArrivals({cards:[c]});tellArrivals({cards:[c]});
  const focus0=document.activeElement;
  tellArrivals({cards:[{...c,column:'approval',permAsk:ask}]});await sleep(250);
  const el=$('#askpops .askpop');out.text=el&&el.textContent;
  expect('a corner card comes up for the new prompt',!!el);
  expect('… saying whose it is and what it asks',!!el&&/askpop selftest/.test(el.textContent)&&/Bash git status/.test(el.textContent));
  expect('… with 開く / 許可 / 拒否',!!el&&!!el.querySelector('.apopen')&&!!el.querySelector('.apyes')&&!!el.querySelector('.apno'));
  expect('… without taking the focus',document.activeElement===focus0);
  const r=el&&el.getBoundingClientRect();out.rect=r&&[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)];
  expect('… in the lower right corner',!!r&&innerWidth-r.right<=20&&innerHeight-r.bottom<=20);
  tellArrivals({cards:[{...c,column:'approval',permAsk:ask}]});
  expect('the same prompt again is one card, not two',document.querySelectorAll('#askpops .askpop').length===1);
  // a long command is shown whole and answered from here; one the hook had to cut is not
  const long='echo '+'x'.repeat(300)+' END';
  tellArrivals({cards:[{...c,column:'approval',permAsk:ask},{...c,id:'askpop-2',column:'approval',permAsk:{id:'b'.repeat(32),tool:'Bash',what:long}},
    {...c,id:'askpop-3',column:'approval',permAsk:{id:'c'.repeat(32),tool:'Bash',what:'y'.repeat(50),partial:true}},
    {...c,id:'askpop-4',column:'approval',permAsk:{id:'d'.repeat(32),tool:'Bash',what:'ls'}},
    {...c,id:'askpop-5',column:'approval',permAsk:{id:'e'.repeat(32),tool:'Bash',what:'pwd'}}]});
  const pop=k=>[...document.querySelectorAll('#askpops .askpop')].find(e=>e.dataset.ask===k.repeat(32));
  const two=pop('b');
  expect('a long request is shown whole',!!two&&two.querySelector('.apw').textContent.endsWith(' END'));
  expect('… with はい / いいえ',!!two&&!!two.querySelector('.apyes')&&!!two.querySelector('.apno'));
  expect('a request the hook cut has 開く only',!!pop('c')&&!pop('c').querySelector('.apyes'));
  out.stack=document.querySelectorAll('#askpops .askpop').length;
  expect('several prompts stack, none dropped',out.stack===5);
  // 許可 answers through the card the board holds (live.cards): stand it in
  const was=live.cards;live.cards=[...was,{...c,column:'approval',permAsk:ask}];
  el.querySelector('.apyes').click();await sleep(100);live.cards=was;
  expect('許可 answers it',answered[0]==='allow');
  expect('… and the card goes',!document.querySelector('#askpops .askpop[data-ask="'+'a'.repeat(32)+'"]'));
  // a card waiting on a permission the board does not hold (the terminal has it): a card too, 開く only
  tellArrivals({cards:[c]});                      // in Your Turn already (waiting on a reply)
  tellArrivals({cards:[{...c,column:'approval',lastTool:'Bash'}]});await sleep(250);
  const t2=$('#askpops .askpop');
  expect('a card in 許可待ち with no held prompt comes up too',!!t2&&/askpop selftest/.test(t2.textContent)&&/Bash の許可確認は端末/.test(t2.textContent));
  expect('… with 開く only',!!t2&&!!t2.querySelector('.apopen')&&!t2.querySelector('.apyes'));
  tellArrivals({cards:[c]});
  expect('a prompt no longer there takes its card with it',!document.querySelector('#askpops .askpop'));
}finally{window.post=p0;window.permAnswer=pa0;for(const e of document.querySelectorAll('#askpops .askpop'))e.remove();askPops.clear();askPopShut.clear()}
return {ok:bad.length===0,bad,out};
