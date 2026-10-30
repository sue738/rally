// Key log for debugging input (~/.rally/keylog.jsonl, owner-only). It can hold text typed in a
// terminal, passwords included, so it is off unless turned on from the palette, and only for 24h.
const KL_HOURS=24;
function klUntil(){try{return +localStorage.getItem('keylogUntil4')||0}catch(e){return 0}}
function klOn(){return native&&!window.__akSelftest&&Date.now()<klUntil()}
function klSet(on){try{localStorage.setItem('keylogUntil4',on?String(Date.now()+KL_HOURS*3600000):'0')}catch(e){}}
{
  const buf=[];let t0=performance.now();
  const where=t=>{if(!t||!t.closest)return '?';
    if(t.closest('.xterm'))return t.closest('#mterm')?'panel-term':t.closest('#ptys')?'strip-term':'term';
    if(t.closest('#detail .msg'))return 'msgbox';if(t.closest('#ntext,#nsbox'))return 'new-session';
    if(t.id==='q')return 'filter';if(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))return t.tagName.toLowerCase()+(t.id?'#'+t.id:'');
    return t.tagName?t.tagName.toLowerCase()+(t.id?'#'+t.id:''):'?'};
  const rec=e=>{
    if(!klOn())return;
    const t=e.target;
    if(t&&t.type==='password')return;
    const o={t:Math.round(performance.now()-t0),k:e.type,w:where(t)};
    if(e.key!==undefined){o.key=e.key;o.code=e.code;o.kc=e.keyCode;
      const m=(e.shiftKey?'S':'')+(e.ctrlKey?'C':'')+(e.altKey?'A':'')+(e.metaKey?'M':'');if(m)o.mod=m;if(e.repeat)o.rep=1}
    if(e.isComposing)o.comp=1;
    if(e.inputType!==undefined){o.it=e.inputType;if(e.data!=null)o.data=e.data}
    else if(e.type.indexOf('composition')===0)o.data=e.data;
    if(e.defaultPrevented)o.dp=1;
    buf.push(o);
  };
  for(const ty of ['keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend'])document.addEventListener(ty,rec,true);
  // bubble phase: was the key prevented by the page's own handlers?
  document.addEventListener('keydown',e=>{if(klOn()&&e.defaultPrevented&&e.key&&e.key.length===1)buf.push({t:Math.round(performance.now()-t0),k:'taken',w:where(e.target),key:e.key})},false);
  // what the terminal was sent (window.post is the page's only way out)
  const p0=window.post;
  if(typeof p0==='function')window.post=function(m){if(klOn()&&m&&m.type==='ptyin'&&!m.reply&&typeof m.data==='string'&&!/^\x1b\[(\?[\d;]*\$y|[?>]?[\d;]*[cRnIO])$/.test(m.data))buf.push({t:Math.round(performance.now()-t0),k:'ptyin',data:m.data.length>40?m.data.slice(0,40)+'…':m.data});return p0.apply(this,arguments)};
  setInterval(()=>{if(!buf.length||!native)return;const lines=buf.splice(0,400).map(o=>JSON.stringify(o));try{p0({type:'keylog',at:Date.now(),lines})}catch(e){}},1500);
}
