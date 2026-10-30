// selftest.sh shellenv: a ＋シェル pane gets your environment, not that of a Claude session the app was started from
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
ptyOpen('shell',{label:'シェル',cwd:term.cwd||''});await wait(()=>[...ptys.values()].some(x=>x.kind==='shell'&&!x.gone),5000);
const sh=[...ptys.values()].find(x=>x.kind==='shell'&&!x.gone);await sleep(1200);
const txt=()=>{const b=sh.xt.buffer.active;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true)+'\n';return t};
post({type:'ptyin',id:sh.id,data:'clear; echo "ENV_B=[${BROWSER-}] ENV_C=[${CLAUDECODE-}]"\r'});
await wait(()=>/ENV_B=\[[^\]]*\] ENV_C=/.test(txt()),8000).catch(()=>0);
const m=txt().match(/ENV_B=\[([^\]]*)\] ENV_C=\[([^\]]*)\]/);
if(!m)bad.push('the shell never answered');
else{if(m[1]==='true')bad.push('BROWSER=true reached the shell (npm login / gh auth could never open a browser)');if(m[2])bad.push('CLAUDECODE reached the shell')}
post({type:'ptyin',id:sh.id,data:'exit\r'});
return {ok:bad.length===0,bad,got:m&&m[0]};
