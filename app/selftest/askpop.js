// selftest.sh askpop: a permission prompt that just came up shows a small card in the corner — whose,
// the whole request, はい / いいえ / 開く — in the lower right corner, without taking focus; 許可 answers it; it goes once the prompt is gone.
// A question shows its whole form there (every question, option and description, uncut) and is answered from it.
// The arrivals are fed by hand (a copy of a fixture card); post and permAnswer are stubbed.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);closeDetail('x');
const base=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!base)return {ok:false,bad:['no claude card on the fixture board']};
const p0=window.post,pa0=window.permAnswer;const answered=[],answers=[];
window.post=m=>{if(m&&/^(notify|badge|asks)$/.test(m.type))return;return p0(m)};
window.permAnswer=(c,d,x)=>{answered.push(d);answers.push(x)};
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
  // a question: every question and option in the card, nothing cut, answered from there
  const longLabel='いまの枝のまま続けて、終わったら main に取り込む前にもう一度確認する(長い選択肢 END)';
  const qa={id:'f'.repeat(32),tool:'AskUserQuestion',what:'q',questions:[
    {question:'どちらで進めますか？',header:'進め方',multiSelect:false,options:[{label:'このまま',description:'いまの設定で続けます'},{label:longLabel,description:'説明も最後まで読めること END2'}]},
    {question:'どれを足しますか？',header:'追加',multiSelect:true,options:[{label:'テスト'},{label:'ドキュメント'},{label:'リリースノート'}]}]};
  const focus1=document.activeElement;
  tellArrivals({cards:[{...c,column:'needs-you',permAsk:qa}]});await sleep(250);
  const qp=pop('f');out.qtext=qp&&qp.textContent;
  expect('a question comes up in the corner',!!qp);
  expect('… with every question',!!qp&&/どちらで進めますか？/.test(qp.textContent)&&/どれを足しますか？/.test(qp.textContent));
  expect('… every option and its description',!!qp&&qp.querySelectorAll('.aopt').length===5&&/いまの設定で続けます/.test(qp.textContent)&&/END2/.test(qp.textContent));
  expect('… a line for your own answer per question, and 答える',!!qp&&qp.querySelectorAll('.aother').length===2&&!!qp.querySelector('.askq-send'));
  expect('… not "open it to answer"',!!qp&&!qp.querySelector('.apn'));
  expect('… without taking the focus',document.activeElement===focus1);
  const cut=qp?[...qp.querySelectorAll('.aopt,.aqt,.adesc')].filter(e=>e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().right>qp.getBoundingClientRect().right+1).map(e=>e.textContent):['no card'];
  out.qcut=cut;expect('… none of it cut at the edge',cut.length===0);
  const lb=qp&&[...qp.querySelectorAll('.aopt')].find(b=>b.textContent===longLabel);
  expect('… a long option shown whole',!!lb&&lb.getBoundingClientRect().height>0);
  if(!qp)return {ok:false,bad,out};
  qp.scrollIntoView({block:'end'});await sleep(300);post({type:'selftestshot',name:'askform'});await sleep(900);
  const send=qp.querySelector('.askq-send');
  expect('答える waits for every question',!!send&&send.disabled);
  qp.querySelector('.aopt[data-q="0"][data-o="1"]').click();
  qp.querySelector('.aopt[data-q="1"][data-o="0"]').click();qp.querySelector('.aopt[data-q="1"][data-o="2"]').click();
  expect('… and is ready once each has one',!send.disabled);
  const n0=answered.length;
  live.cards=[...was,{...c,column:'needs-you',permAsk:qa}];
  send.click();await sleep(100);live.cards=was;
  out.qans=answers[n0];
  expect('答える answers from the corner',answered[n0]==='answer'&&!!answers[n0]&&answers[n0]['どちらで進めますか？']===longLabel&&answers[n0]['どれを足しますか？']==='テスト, リリースノート');
  expect('… and the card goes',!pop('f'));
  tellArrivals({cards:[c]});
  // a permission choice with a long rule is read whole, not cut with …
  const rule='Bash(node scripts/some-long-tool-name.js --with-a-long-flag --and-another-one:*) END3';
  tellArrivals({cards:[{...c,column:'approval',permAsk:{id:'g'.repeat(32),tool:'Bash',what:'node scripts/some-long-tool-name.js',choices:[{d:'allow'},{d:'rule',rule,where:'.claude/settings.local.json'},{d:'deny'}]}}]});await sleep(250);
  const rp=pop('g'),rb=rp&&[...rp.querySelectorAll('.apch')].find(b=>/END3/.test(b.textContent));
  expect('a long rule choice is shown whole',!!rb&&rb.scrollWidth<=rb.clientWidth+1&&rb.getBoundingClientRect().right<=rp.getBoundingClientRect().right+1);
  rp&&rp.scrollIntoView({block:'end'});await sleep(300);post({type:'selftestshot',name:'askrule'});await sleep(900);
  tellArrivals({cards:[c]});
}finally{window.post=p0;window.permAnswer=pa0;for(const e of document.querySelectorAll('#askpops .askpop'))e.remove();askPops.clear();askPopShut.clear()}
return {ok:bad.length===0,bad,out};
