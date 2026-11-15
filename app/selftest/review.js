// selftest.sh review: another model's findings land in the change viewer as line comments (on the line they name;
// the rest listed above), the summary says how many, the button asks for one with the model picked, and a card worth
// a review says so on its card and in its panel. The review's answer is fed by hand; post is stubbed.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);closeDetail('x');
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!c)return {ok:false,bad:['no claude card']};
const posted=[];const p0=window.post;window.post=m=>{if(m&&(m.type==='review'||m.type==='changes')){posted.push(m);return}return p0(m)};
try{
  openChanges(c);await sleep(300);
  const k=c.agent+':'+c.id;
  const j={agent:c.agent,session:c.id,roots:[],files:[{path:'/tmp/rv/a.js',root:'/tmp/rv',git:true,diff:'@@ -1,2 +1,3 @@\n a\n+b\n c',added:1,removed:0}],
    review:{status:'ok',at:Date.now(),model:'fable',summary:'全体はよい',findings:[{file:'/tmp/rv/a.js',line:2,severity:'high',title:'b が未検証',why:'壊れる',fix:'検証する'},{file:'/tmp/rv/other.js',line:5,severity:'low',title:'別ファイル',why:'',fix:''}]}};
  window.__kanban.changes(j);await sleep(200);
  const notes=[...viewer.box.querySelectorAll('.dnote .dnt')].map(x=>x.textContent);out.notes=notes;
  expect('a finding on a line of the diff is a comment on that line',notes.some(x=>/b が未検証/.test(x)&&/重大/.test(x)));
  const sum=viewer.box.querySelector('.vrevsum');out.sum=sum&&sum.textContent.slice(0,80);
  expect('the summary says how many it found',!!sum&&/2/.test(sum.textContent)&&/全体はよい/.test(sum.textContent));
  expect('… and lists the one with no line in the diff',!!sum&&/other\.js:5/.test(sum.textContent));
  window.__kanban.changes(j);await sleep(150);
  expect('the comments are added once per review, not again on every refresh',[...viewer.box.querySelectorAll('.dnote .dnt')].filter(x=>/b が未検証/.test(x.textContent)).length===1);
  const go=viewer.box.querySelector('.vrevgo'),sel=viewer.box.querySelector('.vrevm');out.def=sel&&sel.value;
  expect('the button and the model are there, the default not the model that wrote it',!!go&&!!sel&&(sel.value==='fable'||sel.value==='opus'));
  sel.value='opus';sel.dispatchEvent(new Event('change'));go.click();await sleep(100);
  const rq=posted.find(m=>m.type==='review');out.rq=rq;
  expect('… which asks for a review of this session with the model picked',!!rq&&rq.session===c.id&&rq.model==='opus');
  expect('… and says it is running',/レビュー中|reviewing/.test(viewer.box.querySelector('.vrev').textContent));
  closeViewer&&closeViewer();
  // the hint: on the card and in the panel
  const was=c.reviewHint;c.reviewHint={why:'big',files:9,lines:420};render();await sleep(100);
  const card=document.querySelector('section.col .card[data-id="'+c.id+'"]');
  expect('a card worth a review says so',!!card&&/別モデル推奨|Review suggested/.test(card.textContent));
  openDetail(c,false,{focus:false,view:'talk'});await sleep(300);
  expect('… and its panel has the button',!!$('#mrevhint'));
  c.reviewHint=was;
  // ターンごと: the switch asks for the newest turn, its words and number show, [ asks for the one before, a file whose
  // line numbers are not today's takes no comments, a late answer for 全体 is not drawn, a review asks for the turn on screen
  closeDetail('x');changesScope='all';posted.length=0;
  openChanges(c);await sleep(200);
  window.__kanban.changes({agent:c.agent,session:c.id,roots:[],files:[{path:'/tmp/rv/a.js',root:'/tmp/rv',git:true,diff:'@@ -1,2 +1,3 @@\n a\n+b\n c',added:1,removed:0}]});await sleep(100);
  const sbtn=s=>viewer.box.querySelector('.vscope button[data-s="'+s+'"]');
  expect('the change viewer has 全体 / ターンごと, 全体 chosen',!!sbtn('all')&&!!sbtn('turn')&&sbtn('all').classList.contains('on'));
  sbtn('turn').click();await sleep(100);
  const cq=()=>posted.filter(m=>m.type==='changes').pop()||{};out.tq=cq();
  expect('… ターンごと asks for the newest turn',viewer.scope==='turn'&&cq().turn==='last');
  const turnAns=(n,now)=>({agent:c.agent,session:c.id,roots:[],turn:{n,of:3,since:Date.now()-60000,text:'まだ直っていない '+n,edits:2,last:n===3},
    files:[{path:'/tmp/rv/a.js',root:'/tmp/rv',git:true,diff:'@@ -1,2 +1,2 @@\n a\n-b\n+B',added:1,removed:1,...(now?{now:true}:{})}]});
  window.__kanban.changes(turnAns(3,true));await sleep(100);
  const vtn=()=>(viewer.box.querySelector('.vtn')||{}).textContent||'';out.vtn=vtn();
  expect('… which says which turn and what you asked',/3\/3/.test(vtn())&&/まだ直っていない 3/.test(viewer.box.querySelector('.vturnmeta').textContent));
  expect('… and its lines take comments (they are today\'s)',!!viewer.box.querySelector('.vsec .dl[data-ln="n2"]'));
  window.__kanban.changes({agent:c.agent,session:c.id,roots:[],files:[{path:'/tmp/rv/z.js',root:'/tmp/rv',git:true,diff:'@@ -1 +1 @@\n-z\n+Z',added:1,removed:1}]});await sleep(100);
  expect('a late answer for 全体 is not drawn over the turn',/3\/3/.test(vtn())&&!viewer.box.querySelector('.vsec .vsh a[data-p="/tmp/rv/z.js"]'));
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'[',bubbles:true,cancelable:true}));await sleep(100);
  expect('[ asks for the turn before',cq().turn==='2');
  window.__kanban.changes(turnAns(2,false));await sleep(100);
  expect('… a past turn whose file changed again has no comment lines, and says why',/2\/3/.test(vtn())&&!viewer.box.querySelector('.vsec .dl')&&/コメントを付けられません|take no comments/.test(viewer.box.querySelector('.vturnmeta').textContent));
  const go2=viewer.box.querySelector('.vrevgo');if(go2)go2.click();await sleep(100);
  const rq2=posted.filter(m=>m.type==='review').pop();out.rq2=rq2;
  expect('a review from ターンごと is of the turn on screen',!!rq2&&rq2.turn==='2');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true,cancelable:true}));await sleep(100);
  expect('t goes back to 全体',viewer.scope==='all'&&!('turn' in cq()));
  changesScopeSet('all');
}finally{window.post=p0;try{closeViewer()}catch(e){}closeDetail('x');for(const k of Object.keys(diffNotes||{}))delete diffNotes[k]}
return {ok:bad.length===0,bad,out};
