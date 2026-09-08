const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('the Electron renderer is sandboxed and cannot open external windows', () => {
  const main = read('main.js');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /url === 'about:blank'/);
  assert.match(main, /will-navigate/);
  assert.match(main, /will-attach-webview/);
});

test('the renderer has a restrictive content security policy', () => {
  const html = read('src/index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
});

test('Character search and help text do not inject configuration or JSON as HTML', () => {
  const editor = read('src/js/character-editor.js');
  assert.doesNotMatch(editor, /label\.innerHTML/);
  assert.doesNotMatch(editor, /text\.innerHTML\s*=\s*content/);
  assert.match(editor, /document\.createTextNode/);
  assert.match(editor, /text\.textContent/);
});

test('Castle cost rows render data as text instead of markup', () => {
  const panel = read('src/js/castle-cost-panel.js');
  assert.doesNotMatch(panel, /innerHTML\s*=\s*`[^`]*zeile\./s);
  assert.match(panel, /name\.textContent/);
  assert.match(panel, /value\.textContent/);
});
