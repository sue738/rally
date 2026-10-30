#!/usr/bin/env node
'use strict';
/**
 * eta-backtest.js — how good lib/eta.js's estimate is on the past, and whether a fitted model beats it.
 *
 *   node scripts/eta-backtest.js            last 60 days of this machine's sessions (DAYS=n to change)
 *
 * Every finished turn is replayed at 1, 3, 10 and 30 minutes in, using only the turns that ended before it began.
 * The estimate in use (lib/eta.js) is compared with a ridge regression on log(remaining) over: time in, the pool's
 * median, tools used so far and their pace, the previous turn's length, turn number, time since the last turn and
 * the last tool's kind; fitted on the first 70% of the rows and scored on the last 30%.
 * Before the votes of lib/eta.js were weighted by recency and pace (5019 turns, 2621 test rows): the estimate then in use,
 * half to twice the real time 34% / a third to three times 50% / median |log error| 1.11; this fitted model 33% / 50% / 1.08.
 * The weighted votes now in use scored 35% / 53% / 1.02 on the later half (and no bias, it was 0.87), better than either.
 */
const P = require('path').join(__dirname, '..', 'lib') + '/';
const Scan=require(P+'scan.js'),Eta=require(P+'eta.js');
const now=Date.now(),DAYS=+process.env.DAYS||60;
const {found}=Scan.sessions({sinceMs:now-DAYS*864e5});
const MIN_TURN=10e3,MAX_TURN=3*3600e3;
const turns=[];
for(const f of found)for(const s of f.sessions){if(s.parentId!=null)continue;
  let start=null,last=0,calls=[],idx=0,prevEnd=null,prevMs=null;
  const close=()=>{if(start!=null&&last-start>=MIN_TURN&&last-start<=MAX_TURN){turns.push({start,end:last,ms:last-start,calls,sid:s.agent+s.id,proj:s.project||'',no:idx,prevMs,gap:prevEnd==null?null:start-prevEnd});prevMs=last-start;prevEnd=last;idx++}};
  for(const e of s.events||[]){
    if(e.kind==='user'&&e.human){close();start=e.t;last=e.t;calls=[];continue}
    if(start==null)continue;if(e.t>last)last=e.t;
    if(e.kind==='tool_call')calls.push({dt:e.t-start,tool:e.tool||''});
  }}
turns.sort((a,b)=>a.start-b.start);
console.log('turns',turns.length);
const med=a=>{const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0};
const CH=[1,3,10,30].map(m=>m*60e3);
const cat=t=>/^(Bash)$/.test(t)?'bash':/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)?'edit':/^(Read|Grep|Glob|LS)$/.test(t)?'read':/^(Agent|Task)$/.test(t)?'agent':/^Web/.test(t)?'web':t?'other':'none';
const CATS=['bash','edit','read','agent','web','other'];
const rows=[];
for(let i=0;i<turns.length;i++){const t=turns[i];
  // prior turns only
  const prior=turns.filter(x=>x.end<t.start&&x!==t);
  const own=prior.filter(x=>x.sid===t.sid),proj=prior.filter(x=>x.proj===t.proj);
  const base=own.length>=3?own:proj.length>=5?proj:prior;
  if(base.length<8)continue;
  const bm=Math.log(med(base.map(x=>x.ms)));
  for(const c of CH){if(t.ms<=c+10e3)continue;
    const so=t.calls.filter(k=>k.dt<=c),n=so.length,lastT=so.length?so[so.length-1].tool:'';
    const e=Eta.estimate({now:t.start+c,turnStart:t.start,tools:n,own:own.map(x=>({ms:x.ms,tools:x.calls.length})),proj:proj.map(x=>({ms:x.ms,tools:x.calls.length})),all:prior.map(x=>({ms:x.ms,tools:x.calls.length}))});
    const f=[1,Math.log(c/60e3),bm,Math.log1p(n),Math.log1p(n)-Math.log(c/60e3),t.prevMs?Math.log(t.prevMs/60e3):bm-Math.log(60e3),Math.log1p(Math.min(t.no,50)),t.gap==null?0:Math.log1p(t.gap/3600e3)];
    for(const k of CATS)f.push(cat(lastT)===k?1:0);
    rows.push({t:t.start,f,y:Math.log((t.ms-c)/60e3),cur:Math.log((e.at-(t.start+c))/60e3),c});
  }}
console.log('rows',rows.length);
// time split
rows.sort((a,b)=>a.t-b.t);const cut=Math.floor(rows.length*0.7),tr=rows.slice(0,cut),te=rows.slice(cut);
// ridge normal equations
function solve(A,b){const n=b.length;for(let i=0;i<n;i++){let m=i;for(let r=i+1;r<n;r++)if(Math.abs(A[r][i])>Math.abs(A[m][i]))m=r;[A[i],A[m]]=[A[m],A[i]];[b[i],b[m]]=[b[m],b[i]];for(let r=i+1;r<n;r++){const k=A[r][i]/A[i][i];for(let c=i;c<n;c++)A[r][c]-=k*A[i][c];b[r]-=k*b[i]}}const x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let s=b[i];for(let c=i+1;c<n;c++)s-=A[i][c]*x[c];x[i]=s/A[i][i]}return x}
function ridge(X,y,lam){const d=X[0].length,A=Array.from({length:d},()=>Array(d).fill(0)),b=Array(d).fill(0);for(let r=0;r<X.length;r++)for(let i=0;i<d;i++){b[i]+=X[r][i]*y[r];for(let j=0;j<d;j++)A[i][j]+=X[r][i]*X[r][j]}for(let i=1;i<d;i++)A[i][i]+=lam;return solve(A,b)}
const w=ridge(tr.map(r=>r.f),tr.map(r=>r.y),5);
const pred=(r)=>r.f.reduce((s,v,i)=>s+v*w[i],0);
const rep=(name,get)=>{const L=te.map(r=>get(r)-r.y);const ab=L.map(Math.abs);console.log(name.padEnd(10),'test n',L.length,'×½〜2',(L.filter(l=>Math.abs(l)<=Math.log(2)).length/L.length*100).toFixed(0)+'%','×⅓〜3',(L.filter(l=>Math.abs(l)<=Math.log(3)).length/L.length*100).toFixed(0)+'%','偏り',Math.exp(med(L)).toFixed(2),'中央|log|',med(ab).toFixed(2))};
rep('current',r=>r.cur);rep('ridge',pred);
for(const c of CH){const sub=te.filter(r=>r.c===c);const L1=sub.map(r=>Math.abs(r.cur-r.y)),L2=sub.map(r=>Math.abs(pred(r)-r.y));console.log(c/60e3+'分 n',sub.length,'current |log|',med(L1).toFixed(2),'ridge',med(L2).toFixed(2))}
console.log('weights',w.map(x=>x.toFixed(2)).join(' '));
