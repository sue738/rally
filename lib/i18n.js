'use strict';
/**
 * i18n.js — the node side's language: Japanese (the words written in the code) or English.
 * Same as the page (lib/ui/js/00-a-i18n.js): t('日本語', {slot}) is the Japanese as written
 * under 'ja', and its English from lib/i18n-en.js under 'en'. Unknown words stay as written.
 *
 * LANG: RALLY_LANG (ja|en), else LC_ALL / LC_MESSAGES / LANG, else (macOS) the first of
 * AppleLanguages, else English. The app sets RALLY_LANG from the page's choice.
 */
const Env = require('./env.js');

function decide() {
  const set = String(Env.get('LANG') || '').toLowerCase();
  if (set === 'ja' || set === 'en') return set;
  const loc = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  if (loc && !/^(C|POSIX)(\.|$)/i.test(loc)) return /^ja/i.test(loc) ? 'ja' : 'en';
  if (process.platform === 'darwin') {
    try {
      const r = require('child_process').spawnSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 2000 });
      const first = /"?([A-Za-z]{2,3}[\w-]*)"?/.exec(String(r.stdout || '').replace(/^\s*\(/, ''));
      if (first) return /^ja/i.test(first[1]) ? 'ja' : 'en';
    } catch (e) { /* English then */ }
  }
  return 'en';
}

// decided on first use: a hook that never says anything never asks macOS
let lang = null;
const LANG = () => lang || (lang = decide());
const DICT = {};
function add(d) { for (const k in d) DICT[k] = d[k]; }
let loaded = false;
const dict = () => { if (!loaded) { loaded = true; add(Object.assign({}, require('./i18n-en.js'), DICT)); } return DICT; };

/** The words in the chosen language. `v` fills {name} slots: t('{n}件', { n: 3 }). */
function t(s, v) {
  let o = String(s);
  if (LANG() === 'en' && Object.prototype.hasOwnProperty.call(dict(), o)) o = DICT[o];
  if (v) o = o.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
  return o;
}

module.exports = { t, add, get LANG() { return LANG(); } };
