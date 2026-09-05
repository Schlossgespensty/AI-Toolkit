const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('static web build contains only the Character and Castle editors', () => {
  const output = path.join(root, 'dist', 'web');
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  const bridge = fs.readFileSync(path.join(output, 'js', 'web-bridge.js'), 'utf8');
  assert.match(html, /id="characterWorkspace"/);
  assert.match(html, /id="castleWorkspace"/);
  assert.match(html, /AI Toolkit — Web Editor/);
  assert.doesNotMatch(html, /id="ucpWorkspace"/);
  assert.doesNotMatch(html, /id="aiContentWorkspace"/);
  assert.match(html, /id="webLoadBlueprintBtn"/);
  assert.match(bridge, /showOpenFilePicker/);
  assert.match(bridge, /encodeAiv/);
  assert.equal(fs.existsSync(path.join(output, 'assets', 'aiv', 'background.png')), true);
  assert.equal(fs.existsSync(path.join(output, 'assets', 'aiv', 'skins', '61.png')), true);
});

test('web build source embeds configuration and browser-native file handling', () => {
  const build = fs.readFileSync(path.join(root, 'web', 'build.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'web', 'src', 'web-bridge.mjs'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'web', 'src', 'web-shell.js'), 'utf8');
  assert.match(build, /sectionBetween\(source, '<section id="characterWorkspace"'/);
  assert.match(build, /sectionBetween\(source, '<section id="castleWorkspace"'/);
  assert.match(bridge, /import \{ encodeAiv, parseAiv \}/);
  assert.match(bridge, /showSaveFilePicker/);
  assert.match(bridge, /input\.addEventListener\('change'/);
  assert.match(bridge, /input\.addEventListener\('cancel'/);
  assert.doesNotMatch(bridge, /window\.addEventListener\('focus'[\s\S]*?finish\(input\.files/);
  assert.match(shell, /workspaces\s*=\s*\{[\s\S]*?character:[\s\S]*?castle:/);
  assert.doesNotMatch(shell, /ucpLibrary|aiContentEditor/);
});

test('single-file web build embeds every runtime dependency', () => {
  const build = fs.readFileSync(path.join(root, 'web', 'build-single.js'), 'utf8');
  assert.match(build, /window\.AIToolkitEmbeddedAssets = Object\.freeze/);
  assert.match(build, /data:\$\{mimeType\};base64/);
  assert.match(build, /css\/combined\.css/);
  assert.match(build, /js\/web-bridge\.js/);

  const output = path.join(root, 'dist', 'AI-Toolkit-Web.html');
  if (!fs.existsSync(output)) return;
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /id="characterWorkspace"/);
  assert.match(html, /id="castleWorkspace"/);
  assert.match(html, /window\.AIToolkitEmbeddedAssets = Object\.freeze/);
  assert.match(html, /data:image\/png;base64,/);
  assert.doesNotMatch(html, /<link\s+rel="stylesheet"/);
  assert.doesNotMatch(html, /<script\s+src=/);
});
