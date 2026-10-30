// selftest.sh termcmd: the コマンド line with commands that take a while or ask something.
// Output shows while the command runs (not only at exit); a question is answered from the
// line, or in a shell pane (シェルで続ける); a program that needs a real terminal goes to one
// by itself; and Claude Code's BROWSER=true does not reach what you run.
// (`read -p` is bash's; in zsh, the login shell here, -p reads a coprocess — so the line's
// question is asked with printf + read, and the literal `read -p` runs under bash in the pane.)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(true);ptyShow('cmd');
const i=document.querySelector('#termin');
const enter=v=>{i.value=v;i.focus();i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))};
const last=()=>{const b=[...term.el.querySelectorAll('.trun')].pop();return b?b.querySelector('.tout').textContent:''};
const scr=p=>{const b=p.xt.buffer.active;let t='';for(let k=0;k<b.length;k++)t+=b.getLine(k).translateToString(true)+'\n';return t};
const newPty=before=>[...ptys.values()].find(x=>!before.has(x.id)&&!x.gone);

// 1. streamed: L1 is on screen while the loop still runs
const t0=Date.now();
enter('for i in 1 2 3; do echo L$i; sleep 1; done');
await wait(()=>/L1/.test(last()),6000).catch(()=>0);
out.stream={l1At:Date.now()-t0,busyAtL1:term.busy,text:last()};
expect('L1 is visible before the command ends',/L1/.test(out.stream.text)&&out.stream.busyAtL1===true);
await wait(()=>!term.busy,10000).catch(()=>0);
expect('…and the whole answer at the end',/L1\s+L2\s+L3/.test(last())&&!term.busy);

// 2. a question on the line: its prompt shows, the note says so, the answer typed into the line gets there
enter('printf "name? "; read x; echo got:$x');
const tq=()=>term.el.querySelector('.tline.asking .tq');
await wait(()=>tq()&&/name\?/.test(tq().textContent)&&term.block&&term.block.querySelector('.task'),6000).catch(()=>0);
{const q=tq(),qr=q&&q.getBoundingClientRect(),ir=i.getBoundingClientRect();
 out.ask={q:q&&q.textContent,out:last(),note:!!(term.block&&term.block.querySelector('.task')),shellBtn:!!(term.block&&term.block.querySelector('.tshell')),busy:term.busy,ph:i.placeholder,sameLine:!!qr&&Math.abs((qr.top+qr.bottom)/2-(ir.top+ir.bottom)/2)<6&&qr.right<=ir.left+2}}
expect('the question stands where the prompt was, with the answer typed right after it on the same line ('+JSON.stringify(out.ask)+')',/name\?/.test(out.ask.q||'')&&out.ask.sameLine&&out.ask.busy);
expect('… with no 実行中 placeholder in the way',!/実行中/.test(out.ask.ph||''));
expect('… not twice (it left the output above)',!/name\?/.test(out.ask.out||''));
expect('a quiet line says the keys, with 本物の端末で続ける',out.ask.note&&out.ask.shellBtn);
post({type:'selftestshot',name:'ask'});await sleep(500);
i.value='sue';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
await wait(()=>!term.busy,6000).catch(()=>0);
out.answered=last();
expect('the answer typed into the line reaches it (got:sue)',/got:sue/.test(out.answered)&&!term.busy);

// 3. シェルで続ける: the same question, answered in a shell pane in the same directory
let before=new Set(ptys.keys());
enter('printf "name? "; read x; echo got2:$x');
await wait(()=>term.block&&term.block.querySelector('.tshell'),6000).catch(()=>0);
const btn=term.block&&term.block.querySelector('.tshell');
expect('シェルで続ける is offered',!!btn);
if(btn)btn.click();
await wait(()=>newPty(before),5000).catch(()=>0);
let sh=newPty(before);
await wait(()=>sh&&/name\? *$/m.test(scr(sh)),15000).catch(()=>0);
out.cont={opened:!!sh,screen:sh?scr(sh).trim().slice(-300):'',lineFree:!term.busy,note:last()};
expect('シェルで続ける runs it in a shell pane, where its prompt shows',!!sh&&/name\?/.test(out.cont.screen));
expect('…and the line is free again, saying where it went',!term.busy&&/シェルで実行し直しました/.test(out.cont.note));
if(sh){
  post({type:'ptyin',id:sh.id,data:'kan\r'});
  await wait(()=>/got2:kan/.test(scr(sh)),6000).catch(()=>0);
  expect('the answer typed in the pane gets there (got2:kan)',/got2:kan/.test(scr(sh)));
  // the literal read -p (bash's), in the pane's real terminal
  post({type:'ptyin',id:sh.id,data:'bash -c \'read -p "name? " x; echo got:$x\'\r'});
  await wait(()=>/name\? *$/m.test(scr(sh).trimEnd()+' ')&&!/got:rp/.test(scr(sh)),6000).catch(()=>0);
  post({type:'ptyin',id:sh.id,data:'rp\r'});
  await wait(()=>/got:rp/.test(scr(sh)),6000).catch(()=>0);
  expect('read -p "name? " in the shell pane: prompt shown, answered (got:rp)',/got:rp/.test(scr(sh)));
  post({type:'ptyin',id:sh.id,data:'exit\r'});await wait(()=>!ptys.has(sh.id)||sh.gone,5000).catch(()=>0);
}

// 4. a program that needs a real terminal goes straight to a shell pane (here: bash itself, bare)
out.detect={npmLogin:termInteractive('npm login --registry https://registry.npmjs.org'),ghAuth:termInteractive('gh auth login'),ssh:termInteractive('ssh host'),sudo:termInteractive('cd /tmp && sudo ls'),
  python:termInteractive('python3'),pyScript:termInteractive('python3 x.py'),ls:termInteractive('ls -la'),npmLs:termInteractive('npm ls'),commitM:termInteractive('git commit -m x'),commit:termInteractive('git commit'),claudeP:termInteractive('claude -p hi'),ak:termInteractive('ak list')};
const d=out.detect;
expect('npm login / gh auth login / ssh / sudo / a bare REPL / git commit (editor) are taken for interactive',d.npmLogin&&d.ghAuth&&d.ssh&&d.sudo&&d.python&&d.commit);
expect('…and ls / npm ls / python3 x.py / git commit -m / claude -p / ak are not',!d.pyScript&&!d.ls&&!d.npmLs&&!d.commitM&&!d.claudeP&&!d.ak);
before=new Set(ptys.keys());
enter('bash');
await wait(()=>newPty(before),5000).catch(()=>0);
sh=newPty(before);
expect('a bare `bash` typed in the line opens in a shell pane, not the line',!!sh&&!term.busy&&/シェルに切り替えて実行しました/.test(last()));
expect('…in the line\'s own place: the line is hidden, no second column',!!sh&&term.el.hidden&&$('#tpanes').hidden&&sh.el.parentNode===$('#ptys')&&$('#ptys').firstElementChild===sh.el);
if(sh){
  await wait(()=>/\S/.test(scr(sh)),10000).catch(()=>0);await sleep(1500);
  post({type:'ptyin',id:sh.id,data:'echo "IN_BASH=$BASH_VERSION"; exit\r'});
  await wait(()=>/IN_BASH=\d/.test(scr(sh)),8000).catch(()=>0);
  expect('…where it runs for real (IN_BASH)',/IN_BASH=\d/.test(scr(sh)));
  post({type:'ptyin',id:sh.id,data:'exit\r'});await wait(()=>!ptys.has(sh.id)||sh.gone,5000).catch(()=>0);
  await wait(()=>!ptys.has(sh.id),5000).catch(()=>0);
  expect('exit in that shell brings the command line back in its place',!ptys.has(sh.id)&&!term.el.hidden&&!$('#tpanes').hidden);
}
ptyShow('cmd');

// 4b. exit closes a strip tab even when the last command failed (the shell exits with its status)
{const before=new Set(ptys.keys());ptyOpen('shell',{label:'exit-test',cwd:''});
  await wait(()=>newPty(before),5000).catch(()=>0);const s2=newPty(before);
  if(s2){await wait(()=>/\S/.test(scr(s2)),10000).catch(()=>0);await sleep(800);
    post({type:'ptyin',id:s2.id,data:'false; exit\r'});
    await wait(()=>!ptys.has(s2.id),8000).catch(()=>0)}
  expect('`false; exit` in a shell tab closes the tab (exit status 1)',!!s2&&!ptys.has(s2.id))}
ptyShow('cmd');

// 5. BROWSER=true (Claude Code's) is not what a command sees
enter('echo "B=[${BROWSER-}]"');
await wait(()=>!term.busy&&/B=\[/.test(last()),8000).catch(()=>0);
out.browser=last();
expect('BROWSER=true does not reach the command line',/B=\[/.test(out.browser)&&!/B=\[true\]/.test(out.browser));

post({type:'selftestshot',name:'termcmd'});await sleep(400);
return {ok:bad.length===0,bad,out};
