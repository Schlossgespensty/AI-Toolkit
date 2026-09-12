'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const geometry = require('../src/js/castle-geometry');
const camera = require('../src/js/castle-camera');
const palette = require('../src/js/castle-palette');
const categories = require('../config/aiv_categories.json').categories;
const allowed = [...categories.Walls, ...categories.Moat, 99];
const step = (itemType, offsets, shouldPause = false) => ({ itemType, tilePositionOfsets: offsets, shouldPause });

test('merge keeps earliest position, unrelated steps, offset order and any pause without mutating input', () => {
  const source = [step(61, [5643]), step(25, [0, 1]), step(54, [400]), step(25, [1, 2], true)];
  const original = structuredClone(source);
  const result = geometry.mergeBuildSteps(source, [3, 1, 3], allowed);
  assert.equal(result.index, 1);
  assert.deepEqual(result.frames, [source[0], step(25, [0, 1, 2], true), source[2]]);
  assert.deepEqual(source, original);
});

test('merge requires complete same-type wall, moat or pitch steps and refuses locks', () => {
  for (const type of allowed) {
    assert.equal(geometry.mergeBuildSteps([step(type, [0]), step(type, [1])], [0, 1], allowed).frames.length, 1);
  }
  assert.throws(() => geometry.mergeBuildSteps([step(25, [0]), step(26, [1])], [0, 1], allowed), /same item type/);
  assert.throws(() => geometry.mergeBuildSteps([step(106, [0]), step(99, [1])], [0, 1], allowed), /same item type/);
  assert.throws(() => geometry.mergeBuildSteps([step(54, [0]), step(54, [1])], [0, 1], allowed), /Only wall/);
  assert.throws(() => geometry.mergeBuildSteps([step(25, [0]), { ...step(25, [1]), locked: true }], [0, 1], allowed), /Unlock/);
  assert.throws(() => geometry.mergeBuildSteps([step(25, [0])], [0], allowed), /at least two/);
});

function placement(ref, x, y, type = 25, size = [1, 1]) { return { ref, x, y, type, size }; }
function flood(start, placements, locked = []) {
  return geometry.floodPlacementRefs(start, placements,
    p => geometry.footprintRectsAtXY(p.type, p.x, p.y, p.size), ref => locked.includes(ref));
}

test('flood delete crosses build steps but not gaps, diagonal corners, types or locks', () => {
  const items = [placement('a', 0, 0), placement('b', 1, 0), placement('locked', 2, 0),
    placement('beyond', 3, 0), placement('diagonal', 2, 1), placement('other', 0, 1, 26)];
  assert.deepEqual(flood(items[0], items, ['locked']), new Set(['a', 'b']));
  assert.deepEqual(flood(items[2], items, ['locked']), new Set());
  assert.deepEqual(flood(null, items), new Set());
});

test('flood delete uses whole building footprints and protects the Keep', () => {
  const items = [placement('a', 0, 1, 54, [2, 2]), placement('b', 2, 0, 54), placement('gap', 4, 0, 54)];
  assert.deepEqual(flood(items[0], items), new Set(['a', 'b']));
  const keep = placement('keep', 43, 56, 61);
  assert.deepEqual(flood(keep, [keep]), new Set());
});

test('flood delete covers the full map rather than silently truncating at fill-tool limit', () => {
  const items = Array.from({ length: 10000 }, (_, off) => placement(String(off), off % 100, Math.floor(off / 100), 106));
  assert.equal(flood(items[0], items).size, 10000);
});

test('camera preferences round-trip, reject conflicts and leave modified shortcuts alone', () => {
  const preferences = camera.validate(JSON.parse(JSON.stringify(camera.arrows)), { single: ['1', 's'] });
  assert.deepEqual(preferences, camera.arrows);
  assert.deepEqual(camera.keyDelta({ key: 'ArrowRight' }, preferences), { x: -40, y: 0 });
  assert.deepEqual(camera.keyDelta({ key: 'ArrowUp', shiftKey: true }, preferences), { x: 0, y: 120 });
  assert.equal(camera.keyDelta({ key: 'ArrowRight', ctrlKey: true }, preferences), null);
  assert.equal(camera.keyDelta({ key: 'ArrowRight' }, camera.defaults), null);
  assert.throws(() => camera.validate({ ...camera.arrows, left: 's' }, { single: ['s'] }), /already assigned/);
  assert.throws(() => camera.validate({ ...camera.arrows, left: 'c' }), /reserved/);
  assert.throws(() => camera.validate({ ...camera.arrows, left: 'ArrowUp' }), /already assigned/);
  assert.throws(() => camera.validate({ ...camera.arrows, panSpeed: 0 }), /speed/);
  assert.equal(camera.validate({ ...camera.defaults, left: 'A' }).left, 'a');
});

test('camera wheel presets preserve both original views and support wheel zoom with modifier panning', () => {
  assert.equal(camera.wheelAction({}, camera.defaults), 'panY');
  assert.equal(camera.wheelAction({ altKey: true }, camera.defaults), 'zoom');
  assert.equal(camera.wheelAction({ ctrlKey: true }, camera.defaults), 'panX');
  assert.equal(camera.wheelAction({}, camera.defaults, true), 'zoom');
  for (const iso of [false, true]) {
    assert.equal(camera.wheelAction({}, camera.arrows, iso), 'zoom');
    assert.equal(camera.wheelAction({ shiftKey: true }, camera.arrows, iso), 'panY');
    assert.equal(camera.wheelAction({ ctrlKey: true }, camera.arrows, iso), 'panX');
  }
});

// Exercise the editor's actual control function without starting Electron.
test('brush size controls work for every tool, retaining size limits', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
  const start = source.indexOf('  function updateBrushSizeUI()');
  const end = source.indexOf('\n  function ', start + 10);
  const state = { tool: 'select', brushSize: 5 };
  const els = { brushSizeOut: { parentElement: { classList: { remove() {} } } }, brushMinus: {}, brushPlus: {} };
  const context = vm.createContext({ state, els, geometry });
  vm.runInContext(source.slice(start, end), context);
  for (const tool of ['single', 'brush', 'select', 'delete', 'copy', 'replace', 'line', 'bucket']) {
    state.tool = tool;
    vm.runInContext('updateBrushSizeUI()', context);
    assert.equal(els.brushMinus.disabled, false, tool);
    assert.equal(els.brushPlus.disabled, false, tool);
  }
  state.brushSize = 1;
  vm.runInContext('updateBrushSizeUI()', context);
  assert.equal(els.brushMinus.disabled, true);
  state.brushSize = 100;
  vm.runInContext('updateBrushSizeUI()', context);
  assert.equal(els.brushPlus.disabled, true);
});

test('every configured item has a readable name and every category has a persistent color', () => {
  const constants = require('../config/aiv_constants.json');
  for (const [type, info] of Object.entries(constants)) {
    assert.ok(typeof info.name === 'string' && info.name.trim(), `missing name for ${type}`);
    assert.equal(palette.itemName(constants, type), info.name.trim());
  }
  for (const category of Object.keys(categories)) {
    assert.match(palette.colors[category], /^#[0-9a-f]{6}$/i, category);
  }
  assert.equal(palette.itemName({ 25: { name: '  ' } }, 25), 'Item 25');
  assert.equal(palette.itemName({}, 123456), 'Item 123456');
  assert.equal(palette.itemName({ 25: { name: ' Wall ' } }, 25), 'Wall');
  assert.equal(palette.categoryStyle('Food').background, '#f8f8c0');
  assert.equal(palette.categoryStyle('Bad Things').background, '#f88080');
  assert.equal(palette.categoryStyle('Military').background, palette.categoryStyle('Weapons').background);
});

test('hover names include units and one-tile items, with a safe fallback for unknown types', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
  const start = source.indexOf('  function itemLabelAtTile(');
  const end = source.indexOf('\n  function ', start + 10);
  const constants = require('../config/aiv_constants.json');
  const context = vm.createContext({
    topmostRefAtTile: tile => tile.x === 0 ? null : 'placement',
    refType: () => 25,
    itemName: type => palette.itemName(constants, type)
  });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(vm.runInContext('itemLabelAtTile(null)', context), '');
  assert.equal(vm.runInContext('itemLabelAtTile({x: 0, y: 0})', context), '');
  for (const type of [25, 106, 1, 123456]) {
    context.refType = () => type;
    assert.equal(vm.runInContext('itemLabelAtTile({x: 1, y: 1})', context), `${palette.itemName(constants, type)} [${type}]`);
  }
});
