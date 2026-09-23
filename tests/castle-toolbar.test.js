const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/js/castle-editor.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
const constants = require('../config/aiv_constants.json');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function editor(store = new Map()) {
  const state = {itemTools: Object.create(null), selected: new Set(), currentItemType: null};
  const context = vm.createContext({state, ITEM_TOOL_STORAGE_KEY: 'itemTools',
    localStorage: {getItem: key => store.get(key), setItem: (key, value) => store.set(key, value)},
    document: {getElementById: () => ({}), querySelectorAll: () => []}, els: {canvas: {classList: {toggle() {}}}},
    isLineSequence: type => type === 10001, itemInfo: type => constants[String(type)] || {},
    updateToolAvailability() {}, updateBrushSizeUI() {}, updateSelectedItemInfo() {}, renderPalette() {},
    renderBuildList() {}, setStatus() {}, scheduleDraw() {}, toolLabel: tool => tool, itemName: type => String(type)});
  vm.runInContext(section('  function isPlacementTool(', '  // Was man ohne'), context);
  vm.runInContext(section('  function isUnitType(', '  function allowsMultiplePerStep('), context);
  vm.runInContext(section('  function renumberUnits(', '  function refExists('), context);
  vm.runInContext(section('  function loadItemTools(', '  function normalizeShortcutKey('), context);
  vm.runInContext(section('  function selectItem(', '  function updateSelectedItemInfo('), context);
  context.loadItemTools();
  return {context, state, store};
}

test('placement tools are remembered independently for each item and across restarts', () => {
  const h = editor();
  h.context.selectItem(25); assert.equal(h.state.tool, 'line');
  h.context.setTool('brush');
  h.context.selectItem(54); assert.equal(h.state.tool, 'single');
  h.context.setTool('line');
  h.context.selectItem(25); assert.equal(h.state.tool, 'brush');
  h.context.selectItem(54); assert.equal(h.state.tool, 'line');
  h.context.setTool('delete'); h.context.setTool('select'); h.context.setTool('copy');
  h.context.selectItem(54); assert.equal(h.state.tool, 'line', 'editing modes do not replace placement preferences');
  const reopened = editor(h.store);
  reopened.context.selectItem(25); assert.equal(reopened.state.tool, 'brush');
  reopened.context.selectItem(54); assert.equal(reopened.state.tool, 'line');
  reopened.context.selectItem(99); reopened.context.setTool('bucket');
  reopened.context.selectItem(54); reopened.context.selectItem(99);
  assert.equal(reopened.state.tool, 'bucket');
});

test('regrouping all items leaves placement defaults and unit storage unchanged', () => {
  const h = editor();
  h.state.categories = { Walls: ['54'], Buildings: ['6', '25', '181', '10001'] };
  for (const [id, tool] of [[25, 'line'], [26, 'line'], [35, 'line'], [46, 'line'], [54, 'single'], [181, 'single'], [10001, 'line']]) {
    h.context.selectItem(id);
    assert.equal(h.state.tool, tool, `item ${id}`);
  }
  const doc = { frames: [
    { itemType: 6, tilePositionOfsets: [101, 102] },
    { itemType: 54, tilePositionOfsets: [303] }
  ], miscItems: [] };
  h.context.normalizeUnitStorage(doc);
  assert.deepEqual(Array.from(doc.frames, frame => frame.itemType), [54]);
  assert.deepEqual(Array.from(doc.miscItems, item => [item.itemType, item.positionOfset, item.number]), [[6, 101, 0], [6, 102, 1]]);
  for (let id = 1; id <= 21; id++) assert.equal(h.context.isUnitType(id), true);
  assert.equal(h.context.isUnitType(54), false);
});

test('Misk retains the single Pause step and groups all three outposts beside Bedouins', () => {
  const state = { constants, categories: require('../config/aiv_categories.json').categories };
  const context = vm.createContext({ state, itemInfo: type => constants[String(type)] || {} });
  vm.runInContext(section('  function getPaletteGroups(', '  function renderPalette('), context);
  const groups = Array.from(context.getPaletteGroups(), ([name, ids]) => [name, Array.from(ids)]);
  assert.deepEqual(groups.map(([name]) => name), ['Castle', 'Gatehouses', 'Military', 'Walls, Moat & Pitch',
    'Town', 'Stairs', 'Industry', 'Food', 'Good Things', 'Bad Things', 'Arabians', 'Europeans', 'Bedouins', 'Misk']);
  assert.deepEqual(state.categories.Arabians, ['16','13','14','15','17','18','19','20','21','5']);
  assert.deepEqual(state.categories.Europeans, ['6','7','8','9','10','11','12','1','2','3','4']);
  assert.deepEqual(state.categories.Misk, ['200', '178', '179', '53']);
  assert.ok(state.categories.Military.includes('79'));
  const available = groups.flatMap(([, ids]) => ids).sort();
  assert.deepEqual(available, Object.keys(constants).sort(), 'every item remains available exactly once');
  assert.doesNotMatch(html, /id="castlePauseBtn"/);
  const h = editor(); h.context.selectItem(200);
  assert.equal(h.state.currentItemType, 200);
  assert.equal(h.state.tool, 'single');
});

test('tool preferences reject corrupt data and preserve line-only item constraints', () => {
  for (const value of ['null', '[]', '{broken', '{"__proto__":"brush","54":"delete","25":"brush"}']) {
    const h = editor(new Map([['itemTools', value]]));
    h.context.selectItem(54); assert.equal(h.state.tool, 'single');
    assert.equal(Object.hasOwn(h.state.itemTools, '__proto__'), false);
  }
  const h = editor(new Map([['itemTools', '{"10001":"brush"}']]));
  h.context.selectItem(10001); assert.equal(h.state.tool, 'line');
  h.context.setTool('single'); assert.equal(h.state.tool, 'line');
  h.context.localStorage.setItem = () => { throw new Error('Unavailable'); };
  h.context.selectItem(54); h.context.setTool('brush');
  h.context.selectItem(25); h.context.selectItem(54);
  assert.equal(h.state.tool, 'brush', 'in-memory preferences work without localStorage');
});

test('toolbar groups expose New and all existing overlay controls without duplicate shortcuts or Save As buttons', () => {
  assert.equal((html.match(/id="castleNewBtn"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="castleSaveAsBtn"/);
  assert.doesNotMatch(source, /getElementById\('castleSaveAsBtn'\)/);
  const extras = fs.readFileSync(require.resolve('../src/js/editor-extras.js'), 'utf8');
  assert.doesNotMatch(extras, /castleShortcutsBtn/);
  assert.match(source, /showShortcutDialog,/);
  assert.match(source, /saveAs,/);
  const overlays = html.slice(html.indexOf('id="castleOverlayMenu"'), html.indexOf('</details>', html.indexOf('id="castleOverlayMenu"')));
  for (const id of ['castleShowNames', 'castleShowUnitNumbers', 'castleShowCompatibility', 'castleShowRoutes', 'castleShowFire']) {
    assert.ok(overlays.includes(`id="${id}"`), id);
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  const deletion = html.slice(html.indexOf('id="castleDeleteMode"'), html.indexOf('</select>', html.indexOf('id="castleDeleteMode"')));
  assert.match(deletion, /value="flood">Flood fill<\/option>/);
  for (const group of ['toolbarFileGroup', 'castleViewGroup', 'castleProjectGroup', 'castlePlacementGroup', 'castleEditGroup', 'castleOverlayGroup']) {
    assert.ok(html.includes(group), group);
  }
});
