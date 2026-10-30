#!/usr/bin/env node
'use strict';
/**
 * eta-features.js — does the wording of a request, its length or the size of the context say how long the turn takes?
 * Compares each turn with its own session's median (60 days). Last run (4948 turns): correlation of the length, the
 * context size and the turn number with the log-ratio all within ±0.02; keyword groups (tests, fixes, questions, research,
 * short replies) shift the median by 0.9x to 2x, but the spread is about 3x, so correcting by them took the typical error
 * from 1.14 to 1.12. Nothing there to use; lib/eta.js stays with the durations alone.
 *   node scripts/eta-features.js
 */
const fs=require('fs');
const P=require('path').join(__dirname, '..', 'lib') + '/';
const Scan=require(P+'scan.js'),Eta=require(P+'eta.js');
const now=Date.now(),DAYS=60;
const {found}=Scan.sessions({sinceMs:now-DAYS*864e5});
const turns=[];
const textOf=(file)=>{const m=new Map();let raw='';try{raw=fs.readFileSync(file,'utf8')}catch(e){return m}
  for(const l of raw.split('\n')){if(!l||l.indexOf('"type":"user"')<0)continue;let j;try{j=JSON.parse(l)}catch(e){continue}
    const c=j.message&&j.message.content;const t=typeof c==='string'?c:Array.isArray(c)?c.filter(x=>x.type==='text').map(x=>x.text).join(' '):'';
    if(t&&j.timestamp)m.set(Date.parse(j.timestamp),t)}return m};
for(const f of found)for(const s of f.sessions){if(s.parentId!=null||!s.file)continue;
  const tm=textOf(s.file);let start=null,last=0,calls=[],idx=0,prevEnd=null,prevMs=null,ctx=0,text='';
  const close=()=>{if(start!=null&&last-start>=10e3&&last-start<=3*3600e3){turns.push({start,end:last,ms:last-start,calls,sid:s.agent+s.id,proj:s.project||'',no:idx,prevMs,ctx,text});prevMs=last-start;prevEnd=last;idx++}};
  for(const e of s.events||[]){
    if(e.kind==='user'&&e.human){close();start=e.t;last=e.t;calls=[];text=tm.get(e.t)||'';continue}
    if(e.kind==='assistant'&&e.tokens&&start==null||e.kind==='assistant'&&e.tokens&&start!=null&&calls.length===0)ctx=(e.tokens.in||0)+(e.tokens.cacheRead||0)+(e.tokens.cacheWrite||0);
    if(start==null)continue;if(e.t>last)last=e.t;
    if(e.kind==='tool_call')calls.push({dt:e.t-start,tool:e.tool||''});
  }}
turns.sort((a,b)=>a.start-b.start);
const withText=turns.filter(t=>t.text).length;
console.log('turns',turns.length,'with text',withText,'with ctx',turns.filter(t=>t.ctx).length);
const med=a=>{const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0};
// 1) at turn START (c=0 info only): correlation of log(ms) with features, within-session residual after removing the session's median
const bySid=new Map();for(const t of turns){if(!bySid.has(t.sid))bySid.set(t.sid,[]);bySid.get(t.sid).push(t)}
const rows=[];for(const [sid,L] of bySid){if(L.length<6)continue;const m=Math.log(med(L.map(t=>t.ms)));for(const t of L)rows.push({r:Math.log(t.ms)-m,t})}
console.log('rows',rows.length);
const corr=(xs,ys)=>{const n=xs.length,mx=xs.reduce((a,b)=>a+b)/n,my=ys.reduce((a,b)=>a+b)/n;let sx=0,sy=0,sxy=0;for(let i=0;i<n;i++){sx+=(xs[i]-mx)**2;sy+=(ys[i]-my)**2;sxy+=(xs[i]-mx)*(ys[i]-my)}return sxy/Math.sqrt(sx*sy)};
const R=rows.map(x=>x.r);
const rp=(name,f,filt=()=>true)=>{const S=rows.filter(x=>filt(x.t));console.log(name.padEnd(22),'n',S.length,'相関',corr(S.map(x=>f(x.t)),S.map(x=>x.r)).toFixed(3))};
rp('文字数(log)',t=>Math.log1p(t.text?t.text.length:0),t=>t.text);
rp('文脈の大きさ(log)',t=>Math.log1p(t.ctx),t=>t.ctx);
rp('ターン番号(log)',t=>Math.log1p(t.no));
const KW={'テスト/検証':/テスト|test|E2E|検証|確認して/i,'実装/修正':/実装|修正|直して|作って|追加|変更|リファクタ|入れて/,'質問':/[?？]|教えて|なに|何|どう|ですか|かな$/,'調査/一覧':/調査|調べ|探して|一覧|まとめて|分析|レポート/,'短い応答':/^(はい|ok|OK|うん|お願い|いいよ|それで|続けて|進めて)/};
for(const k in KW){const a=rows.filter(x=>x.t.text&&KW[k].test(x.t.text)),b=rows.filter(x=>x.t.text&&!KW[k].test(x.t.text));console.log(k.padEnd(10),'あり n',a.length,'比 '+Math.exp(med(a.map(x=>x.r))).toFixed(2),'| なし n',b.length,'比 '+Math.exp(med(b.map(x=>x.r))).toFixed(2))}
// 2) how much of the spread could text explain: simple grouped means, test split
rows.sort((a,b)=>a.t.start-b.t.start);const cut=Math.floor(rows.length*0.7),tr=rows.slice(0,cut),te=rows.filter((x,i)=>i>=cut&&x.t.text);
const feat=t=>Object.keys(KW).map(k=>KW[k].test(t.text)?1:0).join('')+(t.text.length>200?'L':t.text.length>40?'M':'S');
const g=new Map();for(const x of tr){if(!x.t.text)continue;const k=feat(x.t);if(!g.has(k))g.set(k,[]);g.get(k).push(x.r)}
let e0=[],e1=[];for(const x of te){const gm=g.get(feat(x.t));e0.push(Math.abs(x.r));e1.push(Math.abs(x.r-(gm&&gm.length>=8?med(gm):0)))}
console.log('開始時点の誤差(セッション中央値からの対数ずれ) 文言なし |log|',med(e0).toFixed(2),'文言の群の中央値で補正',med(e1).toFixed(2),'(n',te.length+')');
