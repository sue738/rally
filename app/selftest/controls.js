// selftest.sh controls: a view switch (ターミナル | 会話, the header's #pviewseg: one setting for every card) is a segmented control — joined, the chosen one filled — and the
// panel's actions (待ちにする, 完了にする) are squarer buttons with a mark; one height per row, one centre line, segment
// insets even on all sides, a long title keeps 16 characters and nothing on its row is cut off; the header's switches
// look like switches and its actions do not. The screenshot of this run is the thing to look at.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless&&!x.alive&&x.aliveChecked&&!panelPty(x));
if(!c)return {ok:false,bad:['no claude card on the fixture board']};
panelPrefSet('talk');openDetail(c,false,{focus:false});await wait(()=>$('#mbody .mviews button'),8000);await sleep(400);
const seg=$('#pviewseg'),bs=[...seg.querySelectorAll('button')];
const cs=getComputedStyle(seg);out.segBg=cs.backgroundColor;out.segRadii=bs.map(b=>getComputedStyle(b).borderTopLeftRadius);
expect('the view switch is one sunken track with rounded ends',cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&parseFloat(cs.borderTopLeftRadius)>0);
expect('… its segments sit inside it (own radius, no borders)',bs.every(b=>parseFloat(getComputedStyle(b).borderTopWidth)===0&&parseFloat(getComputedStyle(b).borderTopLeftRadius)>0));
// (read without its fade: #pvtalk was turned on just now, and a hidden page's transitions do not advance)
const on=bs.find(b=>b.classList.contains('on'));if(on)on.style.transition='none';out.onBg=on&&getComputedStyle(on).backgroundColor;
expect('… the chosen one filled',!!on&&getComputedStyle(on).backgroundColor!=='rgba(0, 0, 0, 0)');if(on)on.style.transition='';
expect('… and it is the setting in force (会話)',!!on&&on.id==='pvtalk'&&panelView==='talk');
const act=$('#mmeta .ttlrow button#dodone');
if(act){out.actRadius=getComputedStyle(act).borderTopLeftRadius;expect('an action button is squarer than a pill (radius ≤ 8px)',parseFloat(getComputedStyle(act).borderTopLeftRadius)<=8);
  expect('… and carries a mark in front',/✓/.test(getComputedStyle(act,'::before').content))}
else out.act='no 完了にする on this card';
// one size per row: everything in the title row is the same height
const R=e=>e.getBoundingClientRect(),vis=e=>{const b=R(e);return b.width>0&&b.height>0};
const row=$('#mmeta .ttlrow'),ctl=[...row.querySelectorAll('button, .mviews')].filter(e=>!e.closest('.mviews')||e.classList.contains('mviews')).filter(vis);
const hs=ctl.map(e=>Math.round(R(e).height));
out.titleRowHeights=hs;
expect('every control in the title row is 28px tall ('+hs.join(',')+')',hs.length>=4&&hs.every(h=>h===28));
// … and the controls on one line share one centre line
{const lines=new Map();for(const e of ctl){const b=R(e),k=Math.round(b.top/20);(lines.get(k)||lines.set(k,[]).get(k)).push(b.top+b.height/2)}
 const off=[...lines.values()].map(v=>Math.max(...v)-Math.min(...v));out.titleRowCentreOff=off.map(x=>+x.toFixed(1));
 expect('the title row\'s controls sit on one centre line per line ('+off.join(',')+')',off.every(x=>x<=1))}
const sub=[...document.querySelectorAll('#mbody .viewpick, #mbody button.compact')].map(e=>Math.round(R(e).height));
out.subHeights=sub;expect('the filter and /compact are 24px ('+sub.join(',')+')',sub.length>=1&&sub.every(h=>h===24));
// a segmented control's track is as deep on the left as on the right, and above as below
const segs=[...document.querySelectorAll('#mmeta .mviews, #mbody .viewpick, #pviewseg')].filter(vis);out.segInsets=[];
for(const s of segs){const bs=[...s.querySelectorAll('button')].filter(vis);if(!bs.length)continue;const t=R(s),f=R(bs[0]),l=R(bs[bs.length-1]);
  const ins=[f.left-t.left,t.right-l.right,f.top-t.top,t.bottom-f.bottom].map(x=>+x.toFixed(1));out.segInsets.push((s.id||s.className)+':'+ins.join('/'));
  expect('segment insets are even (l/r/t/b '+ins.join('/')+' on '+(s.id||s.className)+')',Math.abs(ins[0]-ins[1])<=.5&&Math.abs(ins[2]-ins[3])<=.5&&Math.abs(ins[0]-ins[2])<=.5)}
expect('the conversation filter is a segmented control',segs.some(s=>s.classList.contains('viewpick')));
// the title comes first: with a long one, at least 16 of its characters show, and nothing in the row is cut off
c.title='ログイン画面の送信先を相対パスに直してテストを追加した作業のまとめと残り';panelPrefSet('term');openDetail(c,false,{focus:false});
await wait(()=>$('#mmeta .ttlrow .mviews'),8000);await sleep(400);
{const tt=$('#clabel'),fs=parseFloat(getComputedStyle(tt).fontSize),w=tt.clientWidth;out.titleShows=+(w/fs).toFixed(1);out.W=innerWidth;
 expect('a long title shows at least 16 characters ('+(w/fs).toFixed(1)+' at '+innerWidth+'px)',w>=16*fs);
 const rr=R($('#mmeta .ttlrow')),pr=R($('#detail'));
 for(const e of [...$('#mmeta .ttlrow').querySelectorAll('button, .mviews, .kbdhint, .tlane')].filter(vis)){const b=R(e);
   if(b.right>Math.min(rr.right,pr.right)+.5||b.left<rr.left-.5)bad.push('cut off in the title row: '+(e.id||e.className)+' '+Math.round(b.left)+'–'+Math.round(b.right)+' in '+Math.round(rr.left)+'–'+Math.round(rr.right));
   if(e.scrollWidth>e.clientWidth+1)bad.push('its words do not fit: '+(e.id||e.className))}}
// the header: all one height; a switch (Completed, 自動実行) shows a switch, an action does not
{const hb=[...document.querySelectorAll('header > button, #pviewseg')].filter(vis),hh=hb.map(e=>Math.round(R(e).height));out.headerHeights=hh;
 expect('the header\'s buttons are one height ('+hh.join(',')+')',hh.length>=4&&hh.every(h=>h===28));
 const cy=hb.map(e=>R(e).top+R(e).height/2);expect('… on one centre line',Math.max(...cy)-Math.min(...cy)<=1);
 const sw=e=>parseFloat(getComputedStyle(e,'::before').width)||0;
 const tg=[...document.querySelectorAll('header button.toggle')].filter(vis),ac=['#jobsbtn','#pendall','#new'].map(s=>$(s)).filter(e=>e&&vis(e));
 out.switchW=tg.map(sw);expect('a header toggle carries a switch',tg.length>0&&tg.every(e=>sw(e)>=18));
 expect('… and a header action none',ac.every(e=>getComputedStyle(e,'::before').content==='none'||sw(e)===0))}
return {ok:bad.length===0,bad,out};
