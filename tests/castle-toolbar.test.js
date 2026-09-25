const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
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
  assert.match(deletion, /value="flood"[^>]*data-i18n="interface:flood_fill_2"[^>]*>Flood fill<\/option>/);
  for (const group of ['toolbarFileGroup', 'castleViewGroup', 'castleProjectGroup', 'castlePlacementGroup', 'castleEditGroup', 'castleOverlayGroup']) {
    assert.ok(html.includes(group), group);
  }
});

test('every toolbar menu button is exactly as wide as its panel and the panel hangs directly below it', () => {
  const css = fs.readFileSync(require.resolve('../src/css/combined.css'), 'utf8');
  assert.match(css, /\.toolbarMenuPanel \{[^}]*left: 0; right: 0;/);
  const panel = {style: {width: ''}, getBoundingClientRect: () => ({width: panel.style.width === 'max-content' && menu.open ? 211.4 : 0})};
  const menu = {open: false, style: {minWidth: ''}, getClientRects: () => [{}], querySelector: () => panel};
  const context = vm.createContext({});
  vm.runInContext(section('  function matchMenuWidth(', '  const matchMenuWidths'), context);
  context.matchMenuWidth(menu);
  assert.equal(menu.style.minWidth, '212px');
  assert.equal(menu.open, false, 'measuring does not leave the menu open');
  assert.equal(panel.style.width, '');
  menu.open = true; context.matchMenuWidth(menu);
  assert.equal(menu.open, true, 'an open menu stays open');
  menu.getClientRects = () => []; menu.style.minWidth = '99px';
  context.matchMenuWidth(menu);
  assert.equal(menu.style.minWidth, '99px', 'hidden tabs keep the last measured width');
  assert.match(source, /addEventListener\('toolkit-language-changed', matchMenuWidths\)/);
  for (const id of ['castleFileMenu', 'castleDrawMenu', 'castleOverlayMenu'])
    assert.match(html, new RegExp(`<details id="${id}" class="toolbarMenu[^"]*">`), id);
  const files = html.slice(html.indexOf('id="castleFileMenu"'), html.indexOf('</details>', html.indexOf('id="castleFileMenu"')));
  for (const id of ['castleOpenBtn', 'castleSaveBtn', 'castleExportDeBtn', 'castleNewBtn']) assert.ok(files.includes(`id="${id}"`), id);
});

test('Draw shows the chosen drawing mode, greys out without an item and offers brush size only for Brush', () => {
  const nodes = new Map();
  const node = id => nodes.get(id) || nodes.set(id, {id, textContent: '', hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }}).get(id);
  const summary = {classes: new Set(), classList: {toggle(name, on) { on ? summary.classes.add(name) : summary.classes.delete(name); }}};
  const tools = ['single', 'line', 'brush', 'bucket'].map(tool => ({dataset: {tool}, disabled: false,
    querySelector: selector => ({textContent: selector === 'span' ? `name ${tool}` : `key ${tool}`})}));
  const menu = {open: true, classes: new Set(), classList: {toggle(name, on) { on ? menu.classes.add(name) : menu.classes.delete(name); }},
    querySelector: () => summary, querySelectorAll: () => tools};
  nodes.set('castleDrawMenu', menu);
  const state = {tool: 'brush', drawTool: 'single'};
  const document = {getElementById: node,
    querySelector: selector => tools.find(button => selector.includes(`"${button.dataset.tool}"`))};
  const context = vm.createContext({state, document});
  vm.runInContext(section('  function isPlacementTool(', '  // Was man ohne'), context);
  vm.runInContext(section('  function updateDrawMenu(', '  function loadToolShortcuts('), context);
  context.updateDrawMenu();
  assert.equal(node('castleDrawIcon').attributes.href, '#tool-brush');
  assert.equal(node('castleDrawLabel').textContent, 'name brush');
  assert.equal(node('castleBrushStepper').hidden, false);
  assert.ok(summary.classes.has('active'));
  state.tool = 'select'; context.updateDrawMenu();
  assert.equal(node('castleDrawLabel').textContent, 'name brush', 'Select keeps the last drawing mode on the button');
  assert.ok(!summary.classes.has('active'));
  state.tool = 'bucket'; context.updateDrawMenu();
  assert.equal(node('castleBrushStepper').hidden, true, 'brush size is only offered for Brush');
  for (const tool of tools) tool.disabled = true;
  context.updateDrawMenu();
  assert.ok(menu.classes.has('disabled')); assert.equal(menu.open, false);
  assert.ok(!summary.classes.has('active'), 'a greyed-out Draw is never shown as active');
});

test('floor plan export averages exactly each tile\'s own block of the full picture', () => {
  const cell = 4, GRID = 100, size = GRID * cell;
  // Every tile has its own colour, so any pixel taken from a neighbouring
  // tile would change the result.
  const colour = (x, y, px, py) => {
    if (x === 0 && y === 0) return [0, 0, 0, 0]; // bare ground
    if (x === 5 && y === 5) return px % cell < 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]; // half covered
    if (x === 6 && y === 5) return px % cell < 2 ? [200, 100, 0, 255] : [0, 100, 200, 255]; // two colours
    return [x, y, (x + y) % 256, 255];
  };
  const picture = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++)
    picture.set(colour(Math.floor(px / cell), Math.floor(py / cell), px, py), (py * size + px) * 4);
  let written = null;
  const plan = {getContext: () => ({
    createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}),
    putImageData: data => { written = data; }})};
  const full = {getContext: () => ({getImageData: (x, y, w, h) => ({data: picture.subarray((y * size + x) * 4, ((y + h - 1) * size + x + w) * 4)})})};
  const context = vm.createContext({GRID, document: {createElement: () => plan}});
  vm.runInContext(section('  function floorPlanPixels(', '  function renderCastlePicture('), context);
  assert.equal(context.floorPlanPixels(full, cell), plan);
  assert.equal(plan.width, 100); assert.equal(plan.height, 100);
  const at = (x, y) => [...written.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)];
  for (const [x, y] of [[1, 0], [7, 3], [99, 99], [42, 17], [4, 5], [7, 5], [5, 4], [5, 6]])
    assert.deepEqual(at(x, y), [x, y, (x + y) % 256, 255], `${x},${y}`);
  assert.deepEqual(at(0, 0), [0, 0, 0, 0], 'bare ground stays transparent');
  assert.deepEqual(at(5, 5), [255, 0, 0, 128], 'coverage becomes opacity, the colour stays');
  assert.deepEqual(at(6, 5), [100, 100, 100, 255], 'both halves of one tile are combined');
  assert.match(html, /<select id="castleSnapshotSize">[\s\S]*value="plan"/);
  assert.match(source, /renderCastlePicture\(\{ floorPlan: document\.getElementById\('castleSnapshotSize'\)\.value === 'plan' \}\)/);
});
