// 使い方診断 (lib/diagnose.js): the last 14 days of sessions counted here, then 新規 opens with a prompt for a new session
// that reads them (Opus, 深さ high) — you see what it will be asked, and Enter starts it.
let diagnoseBusy=false;
function diagnoseStart(){
  if(diagnoseBusy)return;diagnoseBusy=true;
  flash(t('過去14日のセッションを集計しています…'));
  if(native)post({type:'diagnose',days:14});
  else fetch('api/diagnose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({days:14})}).then(r=>r.json()).then(j=>window.__kanban.diagnosed(j)).catch(e=>window.__kanban.diagnosed({error:String(e)}));
  setTimeout(()=>{diagnoseBusy=false},120000);
}
window.__kanban.diagnosed=function(j){
  diagnoseBusy=false;
  if(!j||j.error||!j.prompt){flash('✗ '+t('使い方診断を準備できませんでした')+(j&&j.error?': '+j.error:''));return}
  if(typeof toggleNew==='function'&&panelKey!=='new')toggleNew('diagnose');
  setTimeout(()=>{
    if(typeof newOptsSet==='function')newOptsSet({dir:j.dir,agent:'claude',model:j.model||'opus',effort:j.effort||'high'});
    const ta=$('#ntext');if(ta){ta.value=j.prompt;ta.dispatchEvent(new Event('input'));ta.focus();try{ta.setSelectionRange(0,0)}catch(e){}ta.scrollTop=0}
    toast($('#mbody'),t('{n} 件のセッションを集計しました。診断の指示を入れてあるので、Enter で新しいセッションが調べ始めます',{n:j.sessions||0}));
  },120);
};
