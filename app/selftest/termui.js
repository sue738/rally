// selftest.sh termui: the terminal strip's own controls, in the real page.
// 分割 goes the way the strip is shaped: one above the other in リスト (the
// open strip a tall column on the right), side by side under 看板 — command
// panes and shells alike, each pane the column's full width (or the strip's
// full height). The button says which; ⌘[ / ⌘] and × work either way.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
const R=e=>{const b=(typeof e==='string'?document.querySelector(e):e);if(!b)return null;const x=b.getBoundingClientRect();return {l:Math.round(x.left),t:Math.round(x.top),r:Math.round(x.right),b:Math.round(x.bottom),w:Math.round(x.width),h:Math.round(x.height)}};
const shot=async n=>{for(const light of [false,true]){document.body.classList.toggle('light',light);await sleep(350);post({type:'selftestshot',name:n+(light?'-light':'-dark')});await sleep(900)}document.body.classList.remove('light');await sleep(200)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000).catch(()=>0);
await wait(()=>typeof ptyOpen==='function'&&!!window.Terminal,5000).catch(()=>0);
const tpanes=()=>[...document.querySelectorAll('#tpanes .tpane')].map(R);
const shells=()=>[...document.querySelectorAll('#ptys .pty')].map(R);

// ---- リスト: the strip a column on the right, split one above the other
setView('list');termOpen(true);await sleep(800);
{const b=$('#termsplit');out.listBtn={title:b.title,dir:b.dataset.dir,text:b.textContent.trim(),h:R(b).h};
  expect('リスト: the split button says 上下 ('+JSON.stringify(out.listBtn)+')',/上下に分割/.test(b.title)&&b.dataset.dir==='rows'&&/分割/.test(out.listBtn.text));}
const p=splitPane();await sleep(600);
expect('リスト: ⌘D made a second command pane',!!p&&panes.length===2);
let before=new Set(ptys.keys());
ptyOpen('shell',{label:'termui',cwd:''});
await wait(()=>[...ptys.values()].some(x=>!before.has(x.id)&&x.xt.rows>0),8000).catch(()=>0);
const sh=[...ptys.values()].find(x=>!before.has(x.id));
await sleep(800);
{const col=R('#term'),tp=tpanes(),py=shells();out.list={col,tp,py,cols:sh&&sh.xt.cols,rows:sh&&sh.xt.rows};
  expect('リスト: the strip is the right-hand column',col&&Math.abs(col.r-innerWidth)<=1&&col.w<innerWidth/2);
  expect('リスト: the two command panes are one above the other ('+JSON.stringify(tp)+')',tp.length===2&&tp[1].t>=tp[0].b-1&&Math.abs(tp[0].l-tp[1].l)<=1);
  expect('… each the column\'s full width',tp.every(x=>x.w>=col.w-3));
  expect('… sharing its height',tp.every(x=>x.h>=60)&&Math.abs(tp[0].h-tp[1].h)<=4);
  expect('リスト: the shell is below the command panes, full width ('+JSON.stringify(py)+')',!!sh&&py.length===1&&py[0].t>=tp[1].b-1&&py[0].w>=col.w-3&&py[0].h>=60);
  expect('リスト: the shell fitted its pane (cols '+(sh&&sh.xt.cols)+', rows '+(sh&&sh.xt.rows)+')',!!sh&&sh.xt.cols>=30&&sh.xt.rows>=4&&sh.cols===sh.xt.cols&&sh.rows===sh.xt.rows);
  let saved=[];try{saved=JSON.parse(localStorage.getItem('termpanes')||'[]')}catch(e){}
  expect('リスト: the panes are remembered (termpanes '+JSON.stringify(saved)+')',saved.length===2&&saved.includes(p.id));}
// ⌘[ / ⌘]: through the command panes, then the shell, in the order they stand
{ptyMark('cmd');setActivePane(term);paneStep(1);await sleep(150);const a1=activePane()===p&&ptyOn==='cmd';
  paneStep(1);await sleep(300);const a2=!!sh&&ptyOn===sh.id;
  paneStep(1);await sleep(150);const a3=ptyOn==='cmd'&&activePane()===term;
  out.listStep=[a1,a2,a3];expect('リスト: ⌘] steps top to bottom and round ('+out.listStep+')',a1&&a2&&a3)}
await shot('split-list');

// ---- × and exit close either way; the last pane stays
if(sh){ptyClose(sh.id);await wait(()=>!ptys.has(sh.id),6000).catch(()=>0)}
setView('list');termOpen(true);await sleep(400);
if(p){p.el.querySelector('.tpx').click();await sleep(300)}
{let saved=[];try{saved=JSON.parse(localStorage.getItem('termpanes')||'[]')}catch(e){}
  expect('× closes the pane in リスト, the first stays (panes '+panes.length+', saved '+JSON.stringify(saved)+')',panes.length===1&&saved.length===1&&document.querySelectorAll('#tpanes .tpane').length===1);
  const one=R('#tpanes .tpane'),col=R('#term');expect('… and it fills the column again',one&&one.h>=col.h-80&&one.w>=col.w-3)}
// ---- `clear` / ⌃L in the コマンド line clear the pane, as a terminal's do; there is no 消去 button
setView('list');termOpen(true);ptyShow('cmd');await sleep(300);
{const i=$('#termin'),runs=()=>term.el.querySelectorAll('.tlog .trun').length;
  const enter=v=>{i.value=v;i.focus();i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))};
  enter('echo AK_CLR_1');await wait(()=>!term.busy&&/AK_CLR_1/.test(term.el.querySelector('.tlog').textContent),8000).catch(()=>0);
  const n0=runs();enter('clear');await sleep(400);
  let saved='?';try{saved=localStorage.getItem('termlog')}catch(e){}
  out.clear={before:n0,after:runs(),busy:term.busy,saved,hist:term.hist.slice(-1)[0]};
  expect('`clear` empties the コマンド log ('+JSON.stringify(out.clear)+')',n0>=1&&runs()===0&&!term.busy&&saved==='[]'&&out.clear.hist==='clear');
  enter('echo AK_CLR_2');await wait(()=>!term.busy&&/AK_CLR_2/.test(term.el.querySelector('.tlog').textContent),8000).catch(()=>0);
  i.value='half typed';i.dispatchEvent(new KeyboardEvent('keydown',{key:'l',ctrlKey:true,bubbles:true,cancelable:true}));await sleep(200);
  out.ctrlL={after:runs(),line:i.value};
  expect('⌃L empties it too, and keeps what is typed on the line ('+JSON.stringify(out.ctrlL)+')',runs()===0&&i.value==='half typed');
  i.value='';
  expect('no 消去 button in the strip\'s head',!$('#termclear')&&![...document.querySelectorAll('#termhead button')].some(b=>/消去/.test(b.textContent)));
  expect('the palette still has ターミナルを消去 (clear)',PAL_ACTIONS.some(a=>a.t==='ターミナルを消去 (clear)'))}
// ---- the toggle: a chevron and ⌘J, titled for what it does (no しまう / 出す)
{const b=$('#termtoggle'),look=()=>({title:b.title,label:b.getAttribute('aria-label'),text:b.textContent.trim(),svg:!!b.querySelector('svg'),path:(b.querySelector('svg path')||{getAttribute:()=>''}).getAttribute('d'),h:R(b).h,fs:getComputedStyle(b).fontSize});
  termOpen(true);await sleep(200);out.toggleOpen=look();
  termOpen(false);await sleep(300);out.toggleClosed=look();
  const o=out.toggleOpen,c=out.toggleClosed,small=getComputedStyle(document.documentElement).getPropertyValue('--fs-small').trim();
  expect('open: the toggle says ターミナルを隠す (⌘J), a chevron down and ⌘J ('+JSON.stringify(o)+')',o.title==='ターミナルを隠す (⌘J)'&&o.label==='ターミナルを隠す'&&o.svg&&o.text==='⌘J'&&/^M4 6/.test(o.path));
  expect('closed: ターミナルを表示 (⌘J), a chevron up ('+JSON.stringify(c)+')',c.title==='ターミナルを表示 (⌘J)'&&c.label==='ターミナルを表示'&&c.svg&&c.text==='⌘J'&&/^M4 10/.test(c.path));
  expect('… the standard button height (28px) and small text',o.h===28&&c.h===28&&(!small||o.fs===small||parseFloat(o.fs)<=13.5));
  expect('no しまう / 出す left in the strip\'s head',!/しまう|出す/.test($('#termhead').textContent+$('#termhead').innerHTML));
  b.click();await sleep(300);expect('pressing it opens the strip',!document.body.classList.contains('termclosed'));
  b.click();await sleep(300);expect('… and again folds it',document.body.classList.contains('termclosed'))}
await sleep(200);
return {ok:bad.length===0,bad,...out};
