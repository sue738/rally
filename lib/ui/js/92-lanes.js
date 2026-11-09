// ⚙ → 列が移るまでの時間 (lib/lanehours.js): how long a quiet card takes to move to Waiting, then to Completed.
// The choices match lib/lanehours.js STALE_CHOICES / DONE_CHOICES; a value set from the CLI is shown among them.
const LANE_STALE=[6,12,24,48],LANE_DONE=[24,48,72,168];
function laneHoursNow(){const l=live&&live.lanes;return{staleH:(l&&l.staleH)||24,doneH:(l&&l.doneH)||72}}
function laneDur(h){return h%24===0?t('{n}日',{n:h/24}):t('{n}時間',{n:h})}
/** The Waiting and Completed headers say the hours that are set. */
function laneTitles(){
  const {staleH,doneH}=laneHoursNow();
  const w=document.querySelector('section.col[data-col="stale"] h2'),d=document.querySelector('section.col[data-col="done"] h2');
  const cl=' · '+t('クリックで畳む / 広げる');
  const tail=h=>String(h.title||'').endsWith(cl)?cl:'';
  if(w)w.title=t('{a}〜{b}動いていないもの・あなたが待ちにしたもの(カードをここへドラッグ)',{a:laneDur(staleH),b:laneDur(doneH)})+tail(w);
  if(d)d.title=t('完了にしたもの・自動実行・{b}以上動いていないもの',{b:laneDur(doneH)})+tail(d);
}
function laneSummary(){const {staleH,doneH}=laneHoursNow();return t('Waiting へ {a}・Completed へ {b}',{a:laneDur(staleH),b:laneDur(doneH)})}
function lanePopOpen(on){
  const pop=$('#lanepop');if(!pop)return;
  // like the ⚙ menu, it lives on the page itself: the header clips what overflows it
  if(!pop.dataset.wired){pop.dataset.wired='1';if(pop.parentElement!==document.body)document.body.appendChild(pop);
    pop.addEventListener('mousedown',e=>e.stopPropagation());
    document.addEventListener('mousedown',()=>{if(!pop.hidden)pop.hidden=true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pop.hidden){pop.hidden=true;e.stopPropagation()}},true)}
  if(on==null)on=pop.hidden;
  if(!on){pop.hidden=true;return}
  const {staleH,doneH}=laneHoursNow();
  const opts=(base,cur)=>[...new Set([...base,cur])].sort((a,b)=>a-b);
  const row=(k,list,cur,dis)=>'<div class="chips lrow">'+list.map(h=>'<button type="button" data-k="'+k+'" data-h="'+h+'"'+(h===cur?' class="on" aria-pressed="true"':' aria-pressed="false"')+(dis(h)?' disabled':'')+'>'+esc(laneDur(h))+'</button>').join('')+'</div>';
  pop.innerHTML='<div class="csh">'+t('Waiting に移るまで')+'</div>'+row('stale',opts(LANE_STALE,staleH),staleH,()=>false)
    +'<div class="csh">'+t('Completed に移るまで')+'</div>'+row('done',opts(LANE_DONE,doneH),doneH,h=>h<staleH)
    +'<div class="csn dim">'+t('最後に動いてからの時間で数えます')+'</div>';
  for(const b of pop.querySelectorAll('button[data-h]'))b.onclick=e=>{e.stopPropagation();if(b.disabled)return;
    const h=+b.dataset.h,cur=laneHoursNow();let s=cur.staleH,d=cur.doneH;
    if(b.dataset.k==='stale'){s=h;if(d<s)d=LANE_DONE.find(x=>x>=s)||s}else d=h;
    if(s===cur.staleH&&d===cur.doneH)return;
    post({type:'lanehours',staleH:s,doneH:d});
    if(native){live.lanes={staleH:s,doneH:d};laneTitles();lanePopOpen(true)}};
  const sb=$('#setbtn'),r=sb?sb.getBoundingClientRect():{bottom:40,right:window.innerWidth-16};
  pop.style.top=Math.round(r.bottom+4)+'px';pop.style.right=Math.max(8,Math.round(window.innerWidth-r.right))+'px';
  pop.hidden=false;
}
// the app's answer: saved, so the lanes are read again with the new hours
window.__kanban.laneHours=function(r){
  if(r&&r.ok){flash(t('列が移るまでの時間を変えました: {s}',{s:laneSummary()}));load()}
  else{flash(t('変えられませんでした: {e}',{e:(r&&r.error)||'?'}));load()}
};
