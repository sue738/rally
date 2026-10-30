// selftest.sh termime: in a terminal, text being composed (IME) is drawn the size the committed text is
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(true);
ptyOpen('shell',{label:'シェル',cwd:term.cwd||''});await wait(()=>[...ptys.values()].some(x=>x.kind==='shell'&&!x.gone),5000);
const sh=[...ptys.values()].find(x=>x.kind==='shell'&&!x.gone);await sleep(1500);
post({type:'ptyin',id:sh.id,data:'clear; printf "\\n日本語の確定\\n"\r'});await wait(()=>{const b=sh.xt.buffer.active;for(let i=0;i<b.length;i++)if(/日本語の確定/.test(b.getLine(i).translateToString(true)))return true},6000).catch(()=>{});
const ta=sh.xt.textarea;ta.focus();
ta.dispatchEvent(new CompositionEvent('compositionstart',{data:''}));
ta.dispatchEvent(new CompositionEvent('compositionupdate',{data:'日本語の入力'}));
ta.value='日本語の入力';ta.dispatchEvent(new InputEvent('input',{data:'日本語の入力',inputType:'insertCompositionText',isComposing:true}));
await sleep(400);
const cv=sh.el.querySelector('.composition-view');const cs=cv&&getComputedStyle(cv);
out.comp=cs&&{display:cs.display,font:cs.fontSize+' '+cs.fontFamily.slice(0,40),lh:cs.lineHeight,h:Math.round(cv.getBoundingClientRect().height),w:Math.round(cv.getBoundingClientRect().width)};
// the committed line: its cells are 2 per wide char; measure the rendered width of 6 wide chars
const core=sh.xt._core;const cellW=core&&core._renderService&&core._renderService.dimensions&&core._renderService.dimensions.css.cell.width;
const cellH=core&&core._renderService&&core._renderService.dimensions&&core._renderService.dimensions.css.cell.height;
out.cell={w:cellW,h:cellH};
out.style=cs&&{bg:cs.backgroundColor,fg:cs.color,ul:cs.borderBottomStyle};
if(cs&&cs.backgroundColor==='rgb(0, 0, 0)')bad.push('composing is a black box, not the terminal colours');
post({type:'selftestshot',name:'ime'});await sleep(800);
if(!cv||cs.display==='none')bad.push('the composition view shows while composing');
else{
  // 6 wide characters committed take 12 cells: composing them should be about as wide
  const want=12*cellW;out.want=Math.round(want);
  if(Math.abs(cv.getBoundingClientRect().width-want)>want*0.12)bad.push('composing is drawn at another size than committed text (composing '+Math.round(cv.getBoundingClientRect().width)+'px vs committed '+Math.round(want)+'px for 6 wide chars)');
}
ta.dispatchEvent(new CompositionEvent('compositionend',{data:''}));ta.value='';
post({type:'ptyin',id:sh.id,data:'\x03exit\r'});
return {ok:bad.length===0,bad,out};
