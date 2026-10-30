// selftest.sh listdock: リスト docked left, the panel filling the rest (a mail app), in the real page.
// Returns {ok, bad[], ...}; each failed expectation is one line in bad.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const R=e=>{const b=(typeof e==='string'?document.querySelector(e):e);if(!b)return null;const x=b.getBoundingClientRect();return {l:Math.round(x.left),t:Math.round(x.top),r:Math.round(x.right),b:Math.round(x.bottom),w:Math.round(x.width),h:Math.round(x.height)}};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
try{localStorage.removeItem('listw')}catch(e){}document.documentElement.style.removeProperty('--listw');
const key=e=>e.dataset.agent+':'+e.dataset.id;
const hintShown=()=>getComputedStyle($('#listhint')).display!=='none';
if(panelOpen())closeDetail('selftest');termOpen(false);
sel=null;for(const x of document.querySelectorAll('section.col .card.sel'))x.classList.remove('sel');
const you=[...document.querySelectorAll('section.col[data-col="needs-you"] .card')].map(key);
// entering リスト with nothing selected opens the first of your turn (else the first row)
setView('list');await sleep(1500);
out.w=innerWidth;out.main=R('main');out.detail=R('#detail');out.term=R('#term');
{const want=you[0]||(cardEls()[0]&&key(cardEls()[0]));
  expect('entering リスト with nothing selected opens the first Your Turn row, else the first row (open '+openFor+', want '+want+')',panelOpen()&&openFor===want&&sel===want);
  expect('… and the right side is never the hint while there are rows',!hintShown())}
const m=R('main'),d=R('#detail');
expect('the list is at the left edge ('+JSON.stringify(m)+')',m&&m.l===0);
expect('the list is a narrow column (<420px, is '+(m&&m.w)+')',m&&m.w<420&&m.w>=240);
expect('the list runs from the header to the bottom (full height)',m&&Math.abs(m.b-innerHeight)<=2&&m.t<=R('header').b+2);
expect('the list scrolls on its own',['auto','scroll'].includes(getComputedStyle($('main')).overflowY));
expect('the panel is open',panelOpen());
expect('the panel\'s left edge touches the list\'s right edge (list '+(m&&m.r)+', panel '+(d&&d.l)+')',m&&d&&Math.abs(d.l-m.r)<=2);
expect('the panel reaches the folded terminal tab on the right edge ('+(d&&d.r)+', tab '+R('#term').l+')',d&&Math.abs(d.r-R('#term').l)<=2);
expect('the panel runs to the bottom',d&&Math.abs(d.b-innerHeight)<=2);
{const t0=R('#term');expect('the folded terminal is a slim tab on the right edge, full height ('+JSON.stringify(t0)+')',Math.abs(t0.r-innerWidth)<=1&&t0.w<=48&&Math.abs(t0.b-innerHeight)<=1&&t0.t<=R('header').b+2)}
// rows: 看板's own cards, stacked in the column
const rows=[...document.querySelectorAll('section.col .card')].filter(c=>c.getBoundingClientRect().height>0);
out.rows=rows.length;
expect('rows are inside the column',rows.length>0&&rows.every(c=>{const x=c.getBoundingClientRect();return x.left>=m.l-1&&x.right<=m.r+1}));
expect('rows are 看板\'s cards (Your Turn whole, the rest a compact line), no list-only row',rows.every(c=>!c.classList.contains('lrow')&&(c.querySelector('.top .ttl')||c.querySelector('.cline .ct'))));
// subagents at work: one ↳ line each under the parent, as on 看板; the finished ones one line of results; a click opens it
{const pc=rows[0],pk=pc&&key(pc),parent=pk&&(live.cards||[]).find(c=>c.agent+':'+c.id===pk);
  if(parent){const now=Date.now();
    const kid=(n,run)=>({agent:parent.agent,id:parent.id+'-stkid'+n,subagent:true,parentId:parent.id,title:'selftest kid '+n,agentType:'Explore',column:run?'working':'done',subRunning:run,lastTool:run?'Grep':'',lastT:now-n*1000,idleS:n,project:parent.project});
    // the parent's real subagents are left out while it runs (a session at work, this run's own, has some)
    const keep=live.cards;live.cards=[...keep.filter(x=>!(x.subagent&&x.parentId===parent.id)),kid(1,true),kid(2,true),kid(3,false)];render();await sleep(200);
    const pc2=cardEls().find(e=>key(e)===pk),nk=pc2?[...pc2.querySelectorAll('.nest .nk')]:[],done=pc2&&pc2.querySelector('.nk.kdone');
    out.kids={lines:nk.length,text:nk.map(x=>x.textContent)};
    expect('subagents at work: one ↳ line each under the parent card (lines '+nk.length+')',nk.length===2&&nk.every(x=>/↳/.test(x.textContent)&&/selftest kid/.test(x.textContent)&&x.querySelector('b')&&x.querySelector('.idle')));
    expect('… the finished one as one line of results',!!done&&/サブエージェント 1 本の結果/.test(done.textContent));
    expect('… and not rows of their own',!cardEls().some(e=>/-stkid/.test(e.dataset.id)));
    post({type:'selftestshot',name:'listkids'});await sleep(800);
    if(nk[0]){nk[0].click();await sleep(300);expect('clicking a ↳ line opens that subagent (open '+openFor+')',panelOpen()&&openFor===parent.agent+':'+parent.id+'-stkid1')}
    // Esc from a subagent's panel: the keys go to its parent's card, the panel stays
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(200);
    expect('Esc on a subagent\'s panel: the panel stays, the parent card has the keys',panelOpen()&&document.activeElement&&document.activeElement.classList.contains('card')&&key(document.activeElement)===pk);
    live.cards=keep;const e0=cardEls().find(e=>key(e)===pk);if(e0)selectEl(e0);render();await sleep(300);
    if(e0)openSelected({focus:false});await sleep(500)}}
// j moves the selection, the open panel follows, and the row stays in view
{const els=cardEls();const i0=selIndex();
  if(els.length>1&&i0<els.length-1){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));await sleep(700);
    const k1=els[i0+1].dataset.agent+':'+els[i0+1].dataset.id;
    expect('j moves the selection to the next row',sel===k1);
    expect('… and the open panel follows it (open '+openFor+')',panelOpen()&&openFor===k1);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',bubbles:true}));await sleep(700);
    expect('k moves back, the panel with it',sel===els[i0].dataset.agent+':'+els[i0].dataset.id&&openFor===sel)}
  // to the last row: it is scrolled into the column's view
  selectCard(cardEls().length-1);await sleep(700);
  const last=document.querySelector('section.col .card.sel'),lr=R(last),mr=R('main');
  expect('the selected row stays visible in the column (row '+JSON.stringify(lr)+' column '+JSON.stringify(mr)+')',lr&&lr.t>=mr.t-1&&lr.b<=mr.b+1);
  expect('… and the panel shows it',openFor===sel);
  selectCard(0);await sleep(500)}
// the grip on the panel's edge sizes the list
{setListWidth(400);await sleep(200);const m2=R('main'),d2=R('#detail');
  expect('the grip sizes the list and the panel keeps touching it',m2.w===400&&Math.abs(d2.l-m2.r)<=2&&Math.abs(d2.r-R('#term').l)<=2);
  try{localStorage.removeItem('listw')}catch(e){}document.documentElement.style.removeProperty('--listw');await sleep(100)}
// the terminal strip open: the list and the panel end above it
{termOpen(true);await sleep(400);const t=R('#term'),m3=R('main'),d3=R('#detail');out.termOpen=t;
  // open in リスト, the strip stands on the right edge: list · panel · terminal, each full height
  expect('terminal open: a column on the right edge (term '+JSON.stringify(t)+')',Math.abs(t.r-innerWidth)<=1&&t.t<=R('header').b+2&&Math.abs(t.b-innerHeight)<=1&&t.w>=280&&t.w<innerWidth/2);
  expect('terminal open: the panel ends at its left edge (panel r '+d3.r+', term l '+t.l+')',Math.abs(d3.r-t.l)<=2);
  expect('terminal open: the list and the panel run to the bottom',Math.abs(m3.b-innerHeight)<=2&&Math.abs(d3.b-innerHeight)<=2);
  const pb=document.querySelector('#term .tpane,#term .tscroll,#tpanes');const pr=pb&&R(pb);
  expect('terminal open: its body has room (w '+(pr&&pr.w)+', h '+(pr&&pr.h)+')',pr&&pr.w>=250&&pr.h>=300);
  // the grip drags the width
  {const g=document.querySelector('#termgrip'),gr=R(g),w0=t.w;
   g.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:gr.l+6,clientY:gr.t+gr.h/2}));
   document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:gr.l+6-80,clientY:gr.t+gr.h/2}));
   document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await sleep(200);
   const w1=R('#term').w;expect('terminal grip widens it ('+w0+' → '+w1+')',Math.abs(w1-w0-80)<=4);
   g.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await sleep(200)}
  post({type:'selftestshot',name:'listterm'});await sleep(800);
  termOpen(false);await sleep(300)}
// nothing closes it: Esc / × / a click on the open row give the list the keys, the panel stays
{const k0=openFor;
  const ta=$('#mbody .msg textarea');if(ta){ta.focus();ta.value='下書き listdock';
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(200);
    expect('Esc in the message box: the panel stays open on the same row',panelOpen()&&openFor===k0);
    expect('… the keys are on the list (the selected row has the focus)',document.activeElement&&document.activeElement.classList.contains('card')&&key(document.activeElement)===k0);
    expect('… and the draft is kept',($('#mbody .msg textarea')||{}).value==='下書き listdock');
    $('#mbody .msg textarea').value=''}
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(200);
  expect('Esc on the list: the panel stays, the row stays selected',panelOpen()&&openFor===k0&&sel===k0&&!hintShown());
  expect('the panel has no × in the docked list',['#mclose','#mclose2'].every(s=>!$(s)||getComputedStyle($(s)).display==='none'));
  closeDetail('x');closeDetail('toggle');closeDetail('space');await sleep(200);
  expect('× / a click on the open row / Space do not close it',panelOpen()&&openFor===k0);
  // j / k still move the panel
  const els=cardEls(),i=els.findIndex(e=>key(e)===k0);
  if(els.length>1){const d=i<els.length-1?'j':'k',t=els[i+(d==='j'?1:-1)];
    document.dispatchEvent(new KeyboardEvent('keydown',{key:d,bubbles:true}));await sleep(600);
    expect(d+' after Esc moves the selection and the panel with it (open '+openFor+')',sel===key(t)&&openFor===key(t))}}
// the open row leaves the board: the next row takes the panel (the one before, for the last)
{const keep=live.cards;
  const drop=k=>{live.cards=live.cards.filter(c=>c.agent+':'+c.id!==k);render()};
  let els=cardEls();
  if(els.length>2){selectEl(els[0]);await sleep(300);const k0=key(els[0]),k1=key(els[1]);
    drop(k0);await sleep(300);
    expect('the open row vanishes: the next row opens (open '+openFor+', want '+k1+')',panelOpen()&&openFor===k1&&sel===k1);
    els=cardEls();const kl=key(els[els.length-1]),kp=key(els[els.length-2]);selectEl(els[els.length-1]);await sleep(300);
    drop(kl);await sleep(300);
    expect('the last row vanishes: the one before it opens (open '+openFor+', want '+kp+')',panelOpen()&&openFor===kp&&sel===kp)}
  // a board with no rows at all: only then the hint
  live.cards=[];render();await sleep(300);
  const h=$('#listhint');
  expect('an empty board: the panel closes and the hint says so',!panelOpen()&&hintShown()&&/開くセッションがありません/.test(h.textContent));
  const hr=R(h);expect('… filling the space right of the list',Math.abs(hr.l-R('main').r)<=2&&Math.abs(hr.r-R('#term').l)<=2);
  live.cards=keep;render();await sleep(400);
  expect('rows back: a row opens again',panelOpen()&&!!openFor&&!hintShown())}
await sleep(300);
await sleep(1500);
return {ok:bad.length===0,bad,...out};
