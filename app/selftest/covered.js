// selftest.sh covered: what the page shows is not drawn under something else, in either view. For
// 看板 / リスト × the panel open or not × the side terminal open or not, with the notification bar up
// (it sat under リスト's fixed list and panel: seen only in 看板), each thing that should be seen is
// hit at its middle by the point test (elementFromPoint), not a layer over it.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={combos:{}};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
const view0=boardView;let snooze=null;try{snooze=localStorage.getItem('notifysnooze');localStorage.removeItem('notifysnooze')}catch(e){}
const st0=notifyStatus;
const c=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent);
const hit=el=>{if(!el)return 'missing';const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return 'not shown';
  const x=Math.min(innerWidth-1,Math.max(0,r.left+Math.min(r.width/2,40))),y=Math.min(innerHeight-1,Math.max(0,r.top+r.height/2));
  if(x>=innerWidth||y>=innerHeight||r.bottom<0||r.right<0)return 'off screen';
  const at=document.elementFromPoint(x,y);if(!at)return 'nothing at its point';
  if(at===el||el.contains(at))return '';
  return 'under '+(at.id?'#'+at.id:at.tagName.toLowerCase()+(at.className&&typeof at.className==='string'?'.'+at.className.split(' ')[0]:''))+(at.closest('[id]')?' in #'+at.closest('[id]').id:'')};
try{
  notifyBar({status:'off'});await sleep(200);
  for(const v of ['list'])for(const panel of [false,true])for(const term of [false,true]){
    setView(v);termOpen(term);if(panel&&c)openDetail(c,false,{focus:false});else closeDetail('x');await sleep(500);
    const key=v+(panel?'+panel':'')+(term?'+term':'');
    const targets={'the notification bar':$('#notifybar .nb-t'),'its button':$('#notifygo'),'表示':$('#cardshowbtn'),'＋ 新規':$('#new'),
      'the first lane title':$('main section.col h2'),'the first card':[...document.querySelectorAll('main section.col .card:not(.skel)')].find(e=>e.getBoundingClientRect().height>0)};
    // リスト's panel is docked beside the list: no × there on purpose (Esc gives the keys back to the list)
    if(panel)Object.assign(targets,{'the panel title':$('#clabel')},v==='board'?{'the panel ×':$('#mclose2')}:{});
    if(term)targets['the terminal bar']=$('#term .tbar')||$('#term');
    const res={};for(const [k,el] of Object.entries(targets)){const why=hit(el);if(why){res[k]=why;expect(key+': '+k+' is '+why,false)}}
    out.combos[key]=Object.keys(res).length?res:'ok'}
}finally{notifyBar({status:st0});try{if(snooze!=null)localStorage.setItem('notifysnooze',snooze)}catch(e){}closeDetail('x');termOpen(false);setView(view0)}
return {ok:bad.length===0,bad,out};
