'use strict';
/**
 * page.js — the board's HTML, assembled at require time from lib/ui/.
 * lib/ui/js/*.js and lib/ui/css/*.css are joined in filename order into one <script>
 * and one <style>: pieces of one file sharing a top-level scope, not modules.
 * Vendored: xterm.js (lib/ui/vendor/, MIT, copied as published).
 */
const fs = require('fs');
const path = require('path');

const NAME = 'rally';
/** What the page calls itself (the tab, the window): the command is NAME. */
const TITLE = require('./names.js').DISPLAY;
const UI = path.join(__dirname, 'ui');

function read(f) { return fs.readFileSync(path.join(UI, f), 'utf8'); }

/** The pieces of lib/ui/<dir>/ with this extension, in the order they are joined. */
function pieces(dir, ext) {
  return fs.readdirSync(path.join(UI, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => path.join(dir, f));
}

/** The page's own script, joined. */
function script() { return pieces('js', '.js').map(read).join(''); }
/** The page's own stylesheet, joined. */
function style() { return pieces('css', '.css').map(read).join(''); }

/** `replace` takes functions on purpose: a string would have `$&` / `$'` in the CSS or script read as patterns. */
function build() {
  return read('index.html')
    .replace('<!--STYLE-->', () => `<style>\n${read('vendor/xterm.css')}\n${style().replace(/\n+$/, '\n')}</style>`)
    .replace('<!--SCRIPT-->', () => `<script>\n${read('vendor/xterm.js')}\n${read('vendor/addon-fit.js')}\n${read('vendor/addon-webgl.js')}\n</script>\n<script>\n${script().replace(/\n+$/, '\n')}</script>`)
    .split('__NAME__').join(TITLE);
}

module.exports = { NAME, build, pieces, script, style, PAGE: build() };
