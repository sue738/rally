/**
 * あとで送る: the send row's menu picks a delay (10分後 … 2時間後) or a time of day, and the next message sent from
 * the box is held in the board's queue (lib/queue.js `sendAt`) until then. At that time it goes as an ordinary
 * message: handed over even if the session is at work. Rally has to be open to send it; one whose time passed
 * while it was closed goes when it is next open. The pick is for one send, then the chip is off again. Held ones
 * are drawn at the foot of the thread with 今の作業後に送る's (22-whenfree.js heldHtml), with the same buttons.
 */
const laterPicked=new Map();              // card key → {mins} | {hm:'14:30'}, until the next send
const LATER_MINS=[10,30,60,120];
function laterOK(c){return !!c&&(c.agent==='claude'||c.agent==='codex')&&!c.subagent}
function laterOf(c){return c?laterPicked.get(c.agent+':'+c.id)||null:null}
function laterLabel(p){
  if(!p)return t('あとで');
  if(p.hm)return t('{time} に送る',{time:p.hm});
  return p.mins<60?t('{n}分後',{n:p.mins}):t('{n}時間後',{n:p.mins/60});
}
/** When it goes, counted from the send: N minutes on, or the next time the clock shows hh:mm (tomorrow if it has passed today). */
function laterAt(p,now=Date.now()){
  if(!p)return 0;
  if(p.mins)return now+p.mins*60000;
  const m=/^(\d{1,2}):(\d{2})$/.exec(p.hm||'');if(!m||+m[1]>23||+m[2]>59)return 0;
  const d=new Date(now);d.setHours(+m[1],+m[2],0,0);
  if(d.getTime()<=now)d.setDate(d.getDate()+1);
  return d.getTime();
}
function laterChip(c){
  if(!laterOK(c))return '';
  const p=laterOf(c);
  return '<span class="mmodew laterw"><button class="mini laterbtn toggle tflag'+(p?' on':'')+'" aria-haspopup="menu" title="'+t('次に送るメッセージを、選んだ時刻に送ります(そのとき作業中でも途中で渡します)。Rally を開いている間に送り、閉じていた間に時刻が来たものは次に開いたときに送ります')+'">'+esc(laterLabel(p))+' ▾</button>'
    +'<div class="modemenu latermenu" role="menu" hidden>'
    +LATER_MINS.map(n=>'<button role="menuitem" data-mins="'+n+'" class="'+(p&&p.mins===n?'on':'')+'"><b>'+esc(laterLabel({mins:n}))+'</b></button>').join('')
    +'<div class="laterhm"><input type="time" class="laterinput" aria-label="'+t('送る時刻')+'"'+(p&&p.hm?' value="'+esc(p.hm)+'"':'')+'><button class="mini laterset" type="button">'+t('この時刻に送る')+'</button></div>'
    +(p?'<button role="menuitem" data-off="1"><b>'+t('やめる(ふつうに送る)')+'</b></button>':'')
    +'</div></span>';
}
function laterSync(mb,c){
  const b=mb.querySelector('.laterbtn');if(!b)return;
  const p=laterOf(c);b.classList.toggle('on',!!p);b.textContent=laterLabel(p)+' ▾';
  const ta=mb.querySelector('.msg textarea'),fb=mb.querySelector('.forkbtn');
  if(!ta||(fb&&fb.classList.contains('on')))return;
  if(p){if(!ta.dataset.ph0)ta.dataset.ph0=ta.placeholder;
    ta.placeholder=p.hm?t('{time} に送ります(そのとき作業中でも渡します)',{time:p.hm}):p.mins<60?t('{n}分後に送ります(そのとき作業中でも渡します)',{n:p.mins}):t('{n}時間後に送ります(そのとき作業中でも渡します)',{n:p.mins/60})}
  else if(typeof wfSync==='function')wfSync(mb,c);
}
function laterSet(mb,c,p){
  const k=c.agent+':'+c.id;if(p)laterPicked.set(k,p);else laterPicked.delete(k);
  const w=mb.querySelector('.laterw');if(w){w.outerHTML=laterChip(c);laterWire(mb,c)}
  laterSync(mb,c);
  const ta=mb.querySelector('.msg textarea');if(ta)ta.focus();
}
function laterWire(mb,c){
  const b=mb.querySelector('.laterbtn'),m=mb.querySelector('.latermenu');if(!b||!m)return;
  b.onclick=e=>{e.stopPropagation();m.hidden=!m.hidden;if(!m.hidden&&e.detail===0){const f=m.querySelector('button');if(f)f.focus()}};
  m.onclick=e=>e.stopPropagation();
  m.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&e.target&&e.target.classList&&e.target.classList.contains('laterinput')){e.preventDefault();e.stopPropagation();m.querySelector('.laterset').click();return}
    e.stopPropagation();
    if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();m.hidden=true;b.focus();return}
    if(e.target&&e.target.classList&&e.target.classList.contains('laterinput'))return;
    const it=[...m.querySelectorAll('button[role=menuitem]')],i=it.indexOf(document.activeElement);
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&it.length){e.preventDefault();it[(i+(e.key==='ArrowDown'?1:it.length-1))%it.length].focus()}};
  for(const x of m.querySelectorAll('button[role=menuitem]'))x.onclick=e=>{e.stopPropagation();m.hidden=true;
    laterSet(mb,c,x.dataset.off?null:{mins:+x.dataset.mins})};
  const set=m.querySelector('.laterset'),inp=m.querySelector('.laterinput');
  if(set)set.onclick=e=>{e.stopPropagation();const v=(inp&&inp.value)||'';
    if(!laterAt({hm:v})){toast(mb,t('時刻を入れてください'));if(inp)inp.focus();return}
    m.hidden=true;laterSet(mb,c,{hm:v})};
  laterSync(mb,c);
}
// a click elsewhere closes it with the other menus (30-panel-host.js); one inside it does not

/**
 * The send from the box when a time is picked (05-panel-send.js panelSend). True: handled (sent, or refused
 * with the words left in the box). Not for a /command or `!command` (they are typed into a terminal), nor with 複製.
 */
function laterSend(c,mb,m,box){
  const p=laterOf(c);if(!p)return false;
  if(m.fork){toast(mb,t('複製 と あとで送る は一緒に使えません。どちらかを外してください'));return true}
  if(m.slash||/^\s*[!！]/.test(m.txt)){toast(mb,t('/ や ! で始まるものは、あとで送るにできません'));return true}
  const at=laterAt(p);
  if(!at){toast(mb,t('時刻を選び直してください'));return true}
  const rk=c.agent+':'+c.id;
  sendLog(c,'scheduled '+clock(at),m.wrapped,m.files);
  dispatch({type:'reply',agent:c.agent,session:c.id,text:m.wrapped,model:m.model,attachments:m.files,dir:c.project,sendAt:at},mb,undefined,rk);
  // drawn at once, replaced by the queue's own line on the next refresh (22-whenfree.js wfHeldOf)
  wfLocal.set(rk,[...(wfLocal.get(rk)||[]),{key:'local-'+Date.now()+Math.random().toString(36).slice(2,6),text:String(m.wrapped||'').trim(),at:Date.now(),sendAt:at,local:true}]);
  if(m.wrapped!==m.txt)replyClear(rk);
  rememberSent(m.txt);box.sent();setTimeout(box.clear,120);attachClear(mb);
  laterSet(mb,c,null);
  wfDraw(c);setTimeout(load,1500);
  return true;
}
