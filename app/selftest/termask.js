// selftest.sh termask: a permission prompt the hook holds is not on the session's terminal, so the
// panel's ターミナル view shows it above the screen with its choices (it showed only in 会話, and a cut
// request had 開く only in the corner: no way to answer it from ターミナル).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);termOpen(false);closeDetail('x');
const base=(live.cards||[]).find(x=>x.agent==='claude'&&!x.subagent&&!x.headless);
if(!base)return {ok:false,bad:['no claude card on the fixture board']};
const was=panelView;
try{
  const c={...base,column:'approval',reason:'waiting for permission: Bash',permAsk:{id:'f'.repeat(32),tool:'Bash',what:'mkdir -p /tmp/x && cat > /tmp/x/r.md <<EOF',partial:true,bg:true,agentType:'general-purpose'}};
  panelPrefSet('term');openDetail(c,false,{focus:false});await sleep(1200);
  const mb=$('#mbody'),box=$('#mtask .askbox.held');
  out.pterm=!!mb&&mb.classList.contains('pterm');out.text=box&&box.textContent.slice(0,120);
  expect('the panel is on ターミナル',out.pterm);
  expect('the held prompt is shown there',!!box&&box.offsetParent!==null&&box.getBoundingClientRect().height>0);
  expect('… with its choices',!!box&&box.querySelectorAll('.askch').length>=2);
  const r=box&&box.getBoundingClientRect(),tr=$('#mterm')&&$('#mterm').getBoundingClientRect();
  expect('… above the terminal',!!r&&!!tr&&r.bottom<=tr.top+2);
  panelPrefSet('talk');await sleep(300);
  expect('on 会話 the copy over the terminal is hidden (the conversation has its own)',!$('#mtask')||$('#mtask').offsetParent===null);
}finally{panelPrefSet(was);closeDetail('x')}
return {ok:bad.length===0,bad,out};
