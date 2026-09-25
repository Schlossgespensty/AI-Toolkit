const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const source = fs.readFileSync(require.resolve('../src/js/castle-editor.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('clipboard mode keeps Select/Move highlighted without losing copied placements', () => {
  const buttons = ['select', 'replace', 'delete'].map(tool => ({dataset: {tool},
    classList: {toggle(name, enabled) { this[name] = enabled; }}}));
  const buffer = {groups: []}, state = {currentItemType: 25, copyBuffer: buffer};
  const context = vm.createContext({state,
    document: {getElementById: () => ({}), querySelectorAll: () => buttons},
    els: {canvas: {classList: {toggle() {}}}}, isLineSequence: () => false, isPlacementTool: () => false,
    updateToolAvailability() {}, updateBrushSizeUI() {}, updateSelectedItemInfo() {},
    renderPalette() {}, setStatus() {}, scheduleDraw() {}, toolLabel: tool => tool});
  vm.runInContext(section('  function setTool(', '  function normalizeShortcutKey('), context);
  context.setTool('copy');
  assert.equal(state.copyBuffer, buffer);
  assert.equal(state.currentItemType, null);
  assert.deepEqual(buttons.map(button => button.classList.active), [true, false, false]);
  context.setTool('select');
  assert.equal(state.copyBuffer, null, 'explicit Select/Move cancels a held paste');
});

test('2.5D copied-item previews use the same types and offsets as actual paste proposals', () => {
  const state = {tool: 'copy', currentItemType: null, hoverTile: {x: 20, y: 30},
    copyBuffer: {groups: [
      {itemType: 25, kind: 'frame', entries: [{type: 25, dx: -2, dy: 1}, {type: 25, dx: -1, dy: 1}]},
      {itemType: 73, kind: 'frame', entries: [{type: 73, dx: 2, dy: -1}]}
    ]}};
  const context = vm.createContext({state, xyToOffset: (x, y) => y * 100 + x});
  vm.runInContext(section('  function copyProposalAt(', '  function validateCopyAt('), context);
  vm.runInContext('this.editor = {' + section('    getPlacementPreview() {', '    getMarquee() {') + '};', context);
  const preview = () => JSON.parse(JSON.stringify(context.editor.getPlacementPreview()));
  assert.deepEqual(preview(), {tiles: [
    {x: 18, y: 31, itemType: 25}, {x: 19, y: 31, itemType: 25}, {x: 22, y: 29, itemType: 73}
  ]});
  state.hoverTile = {x: 0, y: 0};
  assert.equal(preview().tiles[0].x, -2, 'blocked edge proposals still get a visual preview');
  state.hoverTile = null;
  assert.equal(preview(), null);
  state.hoverTile = {x: 2, y: 3}; state.copyBuffer = null;
  assert.equal(preview(), null);
});

test('import disables pauses and marks paused native castles dirty to prevent byte-for-byte saving', () => {
  const state = {undo: [], redo: [], selected: new Set()}, statuses = [];
  const context = vm.createContext({state, deepClone: structuredClone,
    stripSessionLocks: value => value, normalizeUnitStorage: value => value,
    invalidatePlacementCache() {}, retainSourceBytes: value => value,
    updateToolAvailability() {}, renderPalette() {}, renderBuildList() {}, centerMap() {},
    setDirty: value => { state.dirty = value; }, setStatus: text => statuses.push(text),
    frames: () => state.document.frames, window: {castleFormat: require('../src/js/castle-format')},
    alert: text => assert.fail(text), console});
  vm.runInContext(section('  function normalizeDocument(', '  // Build-step locks'), context);
  vm.runInContext(section('  function loadDocument(', '  function loadFromContent('), context);
  vm.runInContext(section('  function outputDocument(', '  function outputContent('), context);
  const document = {frames: [{itemType: 25, tilePositionOfsets: [100], shouldPause: true}], miscItems: []};
  context.loadDocument(document, 'test.aiv', {source: 'aiv', sourceBytes: [1, 2]});
  assert.equal(state.document.frames[0].shouldPause, false);
  assert.equal(state.dirty, true);
  assert.equal(document.frames[0].shouldPause, true, 'loading must not mutate caller data');
  assert.match(statuses.at(-1), /disabled 1 build-step pause/);
  // Save exports also normalize any legacy in-memory state.
  state.document.frames[0].shouldPause = true;
  assert.equal(context.outputDocument().frames[0].shouldPause, false);
  document.frames[0].shouldPause = false;
  context.loadDocument(document, 'test.aiv', {source: 'aiv'});
  assert.equal(state.dirty, false, 'pause-free files retain the unchanged-save optimization');
});

test('saving a library castle writes its existing path, with no read-only detour', async () => {
  const state = {filePath: 'C:/Game/aiv/Wolf1.aiv', sourcePath: 'C:/Game/aiv/Wolf1.aiv',
    sourceBytes: [1], dirty: true};
  const saves = [], content = {frames: []};
  const context = vm.createContext({state, outputDocument: () => content,
    window: {electronAPI: {quickSaveFile: async request => { saves.push(request); return {sourceBytes: [2]}; }}},
    saveAs: () => assert.fail('Save must not be redirected to Save As'),
    retainSourceBytes: value => value, setDirty: value => { state.dirty = value; },
    setStatus() {}, showSaveNotice() {}, alert: text => assert.fail(text)});
  vm.runInContext(section('  async function saveFile(', '  async function saveAs('), context);
  assert.equal(await context.saveFile(), true);
  assert.equal(saves[0].path, 'C:/Game/aiv/Wolf1.aiv');
  assert.equal(saves[0].content, content);
  assert.equal(saves[0].unchanged, false);
  assert.equal(state.dirty, false);
  for (const file of ['castle-editor', 'character-editor', 'ucp-library']) {
    const editor = fs.readFileSync(require.resolve(`../src/js/${file}.js`), 'utf8');
    assert.doesNotMatch(editor, /readOnly|ReadOnly|\[read-only\]/);
  }
});
