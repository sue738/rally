// Language: Japanese (the words written in the code) or English. The page's strings go through t(); the English for each
// is in lib/ui/js/00-b-i18n-*.js, keyed by the Japanese. Picked from the ⚙ menu, else the system's language.
var LANG=(()=>{try{const v=localStorage.getItem('lang');if(v==='ja'||v==='en')return v}catch(e){}
  // no navigator (the page's tests run it bare): Japanese, the words as written
  if(typeof navigator==='undefined'||!navigator.language)return 'ja';
  return /^ja\b/i.test(navigator.language)?'ja':'en'})();
var I18N=(typeof I18N==='object'&&I18N)||{};
function i18nAdd(d){for(const k in d)I18N[k]=d[k]}
/** The words in the chosen language. `v` fills {name} slots: t('{n}件',{n:3}). Unknown words stay as written. */
function t(s,v){let o=String(s);if(LANG==='en'&&Object.prototype.hasOwnProperty.call(I18N,o))o=I18N[o];
  if(v)o=o.replace(/\{(\w+)\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(v,k)?String(v[k]):m);return o}
function langSet(v){v=v==='ja'?'ja':'en';try{localStorage.setItem('lang',v)}catch(e){}
  try{if(typeof post==='function'&&typeof native!=='undefined'&&native)post({type:'lang',lang:v})}catch(e){}
  location.reload()}
/** The page's static HTML (index.html): its text and title / placeholder / aria-label, looked up whole. */
function i18nStatic(root){
  if(LANG!=='en'||!root||!root.querySelectorAll)return;
  const tr=s=>{const k=String(s).trim();return k&&Object.prototype.hasOwnProperty.call(I18N,k)?String(s).replace(k,I18N[k]):null};
  const walk=n=>{for(const c of (n.childNodes||[])){if(c.nodeType===3){const x=tr(c.nodeValue);if(x!=null)c.nodeValue=x}else if(c.nodeType===1&&c.tagName!=='SCRIPT'&&c.tagName!=='STYLE')walk(c)}};
  walk(root);
  for(const el of root.querySelectorAll('[title],[placeholder],[aria-label]'))for(const a of ['title','placeholder','aria-label']){const v=el.getAttribute&&el.getAttribute(a);if(v){const x=tr(v);if(x!=null)el.setAttribute(a,x)}}
  if(document.documentElement)document.documentElement.lang=LANG;
}
