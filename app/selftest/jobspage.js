// selftest.sh jobspage: 定期実行 lists your launchd jobs with their schedule, last / next run and
// what the log said last; a job's action asks twice, and the second press reaches the app — which,
// under the selftest, only records it (launchd is never touched: main.swift jobact, lib/jobs.js act)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
termOpen(false);
const asked=[];const post0=post;post=m=>{asked.push(m);return post0(m)};
try{
  $('#jobsbtn').click();
  await wait(()=>document.querySelector('#mbody .job')||/見つかりません|読めません/.test(($('#mbody .jobs')||{}).textContent||''),15000);
  const jobs=[...document.querySelectorAll('#mbody .jobs > .job')];out.jobs=jobs.length;
  if(!jobs.length)return {ok:true,skipped:'no launchd jobs of yours on this Mac'};
  expect('each shows its schedule and state',jobs.every(j=>j.querySelector('.jsch')&&j.querySelector('.jst')));
  const sched=jobs.filter(j=>/^(平日|毎日|週末|[日月火水木金土]|\d+(分|時間|秒)ごと)/.test(j.querySelector('.jsch').textContent)&&!/停止中|未登録/.test(j.querySelector('.jst').textContent));
  out.scheduled=sched.length;out.withNext=sched.filter(j=>/次 /.test(j.querySelector('.jl2').textContent)).length;
  expect('a scheduled, loaded job says when it runs next',out.withNext===sched.length);
  out.said=jobs.filter(j=>j.querySelector('.jsaid')).length;
  expect('the list carries the log\'s last line where there is one',out.said>0||jobs.every(j=>!j.querySelector('.jlog')));
  // the first job with 今すぐ実行 (or any action): armed, then pressed
  const b=document.querySelector('#mbody .jobs > .job .jact[data-a="run"]')||document.querySelector('#mbody .jobs > .job .jact');
  if(b){const label=b.closest('.job').dataset.label,a=b.dataset.a;out.pressed=[label,a];
    b.click();await sleep(150);
    expect('the first press only arms it',!!b.dataset.armed&&/もう一度押すと/.test(b.textContent)&&!asked.some(m=>m.type==='jobact'));
    b.click();await sleep(1200);
    const sent=asked.filter(m=>m.type==='jobact');
    expect('the second press asks the app for that one job',sent.length===1&&sent[0].label===label&&sent[0].action===a);
    expect('… and its answer came back (the selftest app records it, nothing runs)',jobAsked===null);
  }
  const other=document.querySelector('#mbody details.jother');
  if(other)expect('the app\'s own entries have no actions',!other.querySelector('.jact'));
  await wait(()=>document.querySelector('#mbody .jobs > .job'),5000).catch(()=>0);
}finally{post=post0}
return {ok:bad.length===0,bad,...out};
