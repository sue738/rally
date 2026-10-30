// selftest.sh rename: the board says Rally, and "AgentKanban" is nowhere on the page. What the
// data-directory move did (~/.agentkanban → ~/.rally in the fixture home, before the app ran) is
// checked by selftest.sh afterwards, from the files and the app's log.
const bad=[];const out={};
const expect=(what,cond)=>{if(!cond)bad.push(what)};
await wait(()=>document.querySelectorAll('section.col .card:not(.skel)').length>0,15000);
expect('the page title says Rally (got "'+document.title+'")',/Rally/.test(document.title));
// everything the page carries: its whole source (markup, styles, script), then what shows on the board
const seen=[];
const scan=(s,where)=>{const m=/agentkanban/i.exec(String(s||''));if(m)seen.push(where+': …'+String(s).slice(Math.max(0,m.index-20),m.index+30))};
scan(document.documentElement.outerHTML,'source');
for(const e of document.querySelectorAll('[title],[placeholder],[aria-label],[alt]'))for(const a of ['title','placeholder','aria-label','alt'])if(e.hasAttribute(a))scan(e.getAttribute(a),a);
out.seen=seen.slice(0,5);
expect('"AgentKanban" appears nowhere on the page',seen.length===0);
return {ok:bad.length===0,bad,out};
