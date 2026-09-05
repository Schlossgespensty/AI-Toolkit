const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');
const characterJs = fs.readFileSync(path.join(root, 'src', 'js', 'character-editor.js'), 'utf8');

test('all editor workspaces use the shared application visual language', () => {
  assert.match(html, /class="workspaceHeader characterHeader"/);
  assert.match(html, /class="castleToolbar workspaceCommandBar"/);
  assert.match(html, /class="workspaceHeader aiContentHeader"/);
  assert.match(html, /class="workspaceHeader ucpLibraryHeader"/);
  assert.match(html, /class="appIdentity"/);
  assert.match(css, /--accent:\s*(?:#b98542|rgba?\(185,\s*133,\s*66(?:,\s*1)?\))/);
  assert.match(css, /\.workspaceHeader\s*\{/);
  assert.match(css, /\.workspaceEyebrow,/);
});

test('Character editor uses the integrated header, sidebar cards, and editor panel', () => {
  const start = html.indexOf('<section id="characterWorkspace"');
  const end = html.indexOf('<section id="castleWorkspace"', start);
  const character = html.slice(start, end);

  assert.match(character, /class="characterApp"/);
  assert.match(character, /class="characterSidebar"/);
  assert.match(character, /class="editorCard characterOptionsCard"/);
  assert.match(character, /class="editorCard populationCard"/);
  assert.match(character, /class="characterEditorPanel"/);
  assert.match(character, /id="form" class="characterForm"/);
  assert.doesNotMatch(character, /class="(?:container|mainContainer|sidebarSection|formBox|searchbar)"/);
});

test('shared hidden state wins over workspace layout display rules', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('Character population panel shows the combined castle and character remainder', () => {
  assert.match(html, /Left after castle \+ character/);
  assert.match(html, /id="characterCastlePopulationAfterCharacter"/);
  assert.match(characterJs, /afterCastleAndCharacter\s*=\s*availablePopulation\s*-\s*castleRequired\s*-\s*characterNeeded/);
  assert.match(css, /\.castlePopulationCharacterRow strong,[\s\S]*?\.characterCombinedPopulationRow strong\s*\{[\s\S]*?color:\s*var\(--valid\)/);
});

test('Character population input has eight-person step controls and no native spinner', () => {
  assert.match(html, /id="populationMinusEight"/);
  assert.match(html, /id="populationPlusEight"/);
  assert.match(html, /id="availablePopulation"[^>]*value="10"[^>]*min="10"/);
  assert.match(characterJs, /getAvailablePopulationValue\(\)\s*-\s*8/);
  assert.match(characterJs, /getAvailablePopulationValue\(\)\s*\+\s*8/);
  assert.match(characterJs, /Math\.max\(10,\s*Math\.round\(Number\(value\)\s*\|\|\s*10\)\)/);
  assert.match(css, /\.numberInput::\-webkit-inner-spin-button/);
});

test('AI Content uses two panels and pairs media cards at 1080p size', () => {
  assert.match(html, /class="aiPortraitGrid"/);
  assert.match(css, /\.aiContentEditor\s*\{[\s\S]*?grid-template-columns:\s*minmax\([^;]+\)\s*minmax\([^;]+\)/);
  assert.match(css, /\.aiPortraitGrid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.aiMediaList\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media\s*\(min-width:\s*1800px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.aiPortraitGrid,[\s\S]*?\.aiMediaList\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
});
