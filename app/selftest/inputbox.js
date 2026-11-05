// selftest.sh inputbox: Claude Code's input box read off a real xterm as 2.1.31x draws it — the top rule carries the
// session's name, an empty box shows a dim 'Try "…"', a shell line starts with "! ". The named rule was missed, so a
// lost Enter was never pressed again; words already in the box got ours added and ran as one shell command.
const bad=[];const out={};const expect=(what,cond)=>{if(!cond)bad.push(what)};
if(!window.Terminal)return {ok:false,bad:['no xterm']};
const host=document.createElement('div');host.style.cssText='position:fixed;left:-2000px;top:0;width:900px;height:400px';document.body.appendChild(host);
const xt=new Terminal({cols:100,rows:12});xt.open(host);
const R='\x1b[38;5;244m'+'─'.repeat(70)+' rally-session-log-reading ─\x1b[39m',R2='\x1b[38;5;244m'+'─'.repeat(100)+'\x1b[39m';
const draw=line=>new Promise(r=>xt.write('\x1b[2J\x1b[H'+'Claude Code v2.1.318\r\n\r\n'+R+'\r\n'+line+'\r\n'+R2+'\r\n  …/tmp · Opus 5.5 high\r\n',r));
const p={xt};
try{
  await draw('\x1b[39m❯ \x1b[2mTry "how do I log an error?"\x1b[0m');
  let b=ptyInputBox(p);out.empty=b;
  expect('the box is found under a rule with the session name in it',!!b);
  expect('an empty box with its dim example reads as empty',!!b&&b.text===''&&!b.bash);
  await draw('❯ テストの文です');
  b=ptyInputBox(p);out.words=b;
  expect('words in the box are read',!!b&&b.text==='テストの文です'&&!b.bash);
  expect('… and ptyInputHas sees them (a lost Enter is pressed again)',ptyInputHas(p,'テストの文です'));
  await draw('\x1b[38;5;211m! \x1b[39mgh api -X PATCH repos/x');
  b=ptyInputBox(p);out.bash=b;
  expect('a shell line is told apart',!!b&&b.bash&&/gh api/.test(b.text));
  await draw('\x1b[38;5;211m! \x1b[39m');
  b=ptyInputBox(p);
  expect('an empty shell mode is still shell mode',!!b&&b.bash);
}finally{xt.dispose();host.remove()}
return {ok:bad.length===0,bad,out};
