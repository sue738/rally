// Filter: words plus title: project:(in: dir:) agent: is: before: after: pr:/#123.
// Compared NFKC-folded: macOS file names store ダ decomposed (タ+゛).
function fold(x){return String(x||'').normalize('NFKC').toLowerCase()}
function when(v){
  const m=String(v).match(/^(\d+)([mhdw])$/);
  if(m)return Date.now()-(+m[1])*({m:60e3,h:36e5,d:864e5,w:6048e5})[m[2]];
  const t=Date.parse(v);return isNaN(t)?null:t;
}
function parseQuery(q){
  const out={words:[],title:[],project:[],agent:[],is:[],pr:[],before:null,after:null};
  for(const tok of (String(q).match(/"[^"]*"|\S+/g)||[])){
    const h=tok.match(/^#(\d+)$/);if(h){out.pr.push(+h[1]);continue}
    const m=tok.match(/^(title|project|in|dir|agent|is|pr|before|after):(.+)$/i);
    const v=(m?m[2]:tok).replace(/^"|"$/g,'');
    if(!m){if(v)out.words.push(fold(v));continue}
    const k=m[1].toLowerCase();
    if(k==='before'||k==='after')out[k]=when(v);
    else if(k==='pr')out.pr.push(+String(v).replace(/^#/,'')||-1);
    else (out[k==='in'||k==='dir'?'project':k]).push(fold(v));
  }
  out.any=!!(out.words.length||out.title.length||out.project.length||out.agent.length||out.is.length||out.pr.length||out.before||out.after);
  return out;
}
var IS={turn:['needs-you','approval','answered'],yours:['needs-you','approval','answered'],waiting:['stale'],working:['working'],completed:['done','idle'],done:['done','idle']};
function matchQuery(p,c){
  if(!p.any)return true;
  if(p.title.length&&!p.title.every(w=>fold(c.title).includes(w)))return false;
  if(p.project.length&&!p.project.every(w=>fold(c.project).includes(w)))return false;
  if(p.agent.length&&!p.agent.some(w=>fold(c.agent).startsWith(w)))return false;
  // is:sub asks for subagents (the palette leaves them out otherwise); the other is: words are states
  const subQ=p.is.some(w=>w==='sub'||w==='subagent'||w==='subagents'),st=p.is.filter(w=>!/^subagents?$|^sub$/.test(w));
  if(subQ&&!c.subagent)return false;
  if(st.length&&!st.some(w=>w==='unread'?unreadShown(c):(IS[w]||[w]).includes(c.column)))return false;
  if(p.pr.length&&!p.pr.includes(prNumOf(c)))return false;
  if(p.before&&!((c.lastT||0)<p.before))return false;
  if(p.after&&!((c.lastT||0)>=p.after))return false;
  if(!p.words.length)return true;
  const hay=fold([c.title,c.project,c.reason,c.id,c.agent,c.model,(c.last||{}).assistant,(c.last||{}).human,(c.last||{}).first,c.queued].join(' '));
  if(p.words.every(w=>hay.includes(w)))return true;
  return !!(convo&&convo.hits[c.agent+':'+c.id]);
}
// What to offer while a filter is typed: the operator names for a word start, the values for `is:` and the like.
var SEARCH_OPS=[['title:','タイトルに含む'],['project:','フォルダ名に含む(in: dir: も可)'],['agent:','claude / codex など'],['is:','状態(turn working waiting done)'],['before:','この時より前(1d 3h 2026-09-01)'],['after:','この時より後(1d 3h 2026-09-01)'],['pr:','PR 番号(#123 でも可)']];
var SEARCH_WHEN=[['1h','1時間前'],['1d','1日前'],['1w','1週間前'],['30d','30日前']];
var SEARCH_IS=[['turn','あなたの番'],['working','作業中'],['waiting','待ち'],['done','完了'],['unread','未読'],['sub','サブエージェントを探す(なしは本体だけ)']];
/** {tok, items: [{label, insert, desc}]} for the word being typed at the end of `text`; items is empty when there is nothing to offer. */
function searchSuggest(text,cards){
  text=String(text||'');
  const m=text.match(/(?:^|\s)(\S*)$/),tok=m?m[1]:'';
  const t=fold(tok),v=t.match(/^(title|project|in|dir|agent|is|before|after|pr):(.*)$/);
  const q=(x)=>/\s/.test(x)?'"'+x+'"':x;
  let items=[];
  if(v){
    const op=v[1],part=v[2].replace(/^"/,'');
    const pool=op==='is'?SEARCH_IS:op==='before'||op==='after'?SEARCH_WHEN:op==='agent'?[...new Set((cards||[]).map(c=>c.agent))].filter(Boolean).map(a=>[a,'']):
      op==='project'||op==='in'||op==='dir'?(()=>{const n=new Map();for(const c of cards||[]){const k=short(c.project);if(k)n.set(k,(n.get(k)||0)+1)}return [...n].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,c])=>[k,c+'件'])})():[];
    items=pool.filter(([k])=>fold(k).includes(part)&&fold(k)!==part).map(([k,d])=>({label:k,insert:tok.slice(0,tok.indexOf(':')+1)+q(k)+' ',desc:d}));
  }else if(!/^["#]/.test(tok)){
    items=SEARCH_OPS.filter(([k])=>k.startsWith(t)&&k!==t).map(([k,d])=>({label:k,insert:k,desc:d}));
  }
  return {tok,items};
}
var convo=null,searchWd=0;   // {q, hits: {'agent:id': snippet}} from the last Enter
function searchConvo(){
  const q=($('#q').value||'').trim();const p=parseQuery(q);
  // an after: older than the hours window widens it
  if(p.after){const need=Math.ceil((Date.now()-p.after)/36e5)+1;const hi=$('#hours');if(need>(+hi.value||24)){hi.value=HOUR_STEPS.find(x=>x>=need)||720;load()}}
  if(!p.words.length){render();return}
  const words=p.words.join(' ');const hours=boardHours();
  $('#q').classList.add('busy');clearTimeout(searchWd);searchWd=setTimeout(()=>$('#q').classList.remove('busy'),30000);
  if(native)post({type:'search',q:words,hours});
  else fetch('api/search?q='+encodeURIComponent(words)+'&hours='+hours).then(r=>r.json()).then(j=>window.__kanban.searched({q:words,...j})).catch(()=>window.__kanban.searched({q:words,hits:{}}));
}
window.__kanban.searched=function(j){
  // the palette's own search (palConvo): its results go there
  if(typeof pal!=='undefined'&&pal&&j&&pal.cq===j.q){pal.hits=j.hits||{};pal.hitsQ=j.q;if(pal.redraw)pal.redraw();return}
  $('#q').classList.remove('busy');
  if(!j||fold(parseQuery($('#q').value).words.join(' '))!==fold(j.q||''))return;   // the box moved on
  convo={q:j.q,hits:j.hits||{}};render();
  const n=Object.keys(convo.hits).length;$('#q').title=n?'会話の中で見つかったもの '+n+' 件':'会話の中には見つかりませんでした';
};
