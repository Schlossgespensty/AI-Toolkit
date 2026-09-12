const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const constants = require('../config/aiv_constants.json');
const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
const method = source.slice(source.indexOf('  function placementBrushTiles('), source.indexOf('  function brushAddOne('));

test('remembered brush width applies to tile objects, not building footprints or stair sequences', () => {
  const state = { tool: 'brush', brushSize: 4, currentItemType: 73 };
  const context = { state, itemInfo: type => constants[type] || {},
    isUnitType: type => type === 1,
    isLineSequence: type => Boolean(constants[type]?.lineSequence?.length),
    geometry: { brushTiles: (tile, size) => Array.from({ length: size * size }, () => tile) } };
  vm.runInNewContext(method + '\nthis.tiles = placementBrushTiles;', context);
  const tile = { x: 30, y: 30 };
  for (const [type, entry] of Object.entries(constants)) {
    state.currentItemType = Number(type);
    const area = entry.size?.[0] === 1 && entry.size?.[1] === 1 && Number(type) !== 1 && !entry.lineSequence?.length;
    assert.equal(context.tiles(tile).length, area ? 16 : 1, entry.name);
    assert.equal(state.brushSize, 4, 'item changes must preserve the remembered width');
  }
  state.currentItemType = 99999;
  assert.equal(context.tiles(tile).length, 1, 'unknown items default to one placement');
  state.tool = 'single'; state.currentItemType = 99;
  assert.equal(context.tiles(tile).length, 1);
});
