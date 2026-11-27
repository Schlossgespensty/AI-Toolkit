const test = require('node:test');
const assert = require('node:assert/strict');
const floorPlan = require('../src/js/castle-floor-plan.js');
const geometry = require('../src/js/castle-geometry.js');
const {assignColours, bandDistance, fitBand, regions, offset, FORECOURTS, TYPE_GAP} = floorPlan;

const distance = (a, b) => Math.max(...a.map((value, c) => Math.abs(value - b[c])));
const colours = (pick, count) => Array.from({length: count}, (_, i) => pick(i));

test('instances spread one brightness level around the original colour', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(offset), [0, 1, -1, 2, -2]);
  const pick = assignColours([{key: '32', base: [120, 90, 60], count: 5}]).get('32');
  assert.deepEqual(colours(pick, 5), [[120, 90, 60], [121, 91, 61], [119, 89, 59], [122, 92, 62], [118, 88, 58]]);
});

test('different colours keep their original values even when they are close', () => {
  const result = assignColours([
    {key: 'a', base: [120, 90, 60], count: 3},
    {key: 'b', base: [100, 140, 60], count: 3},
    {key: 'c', base: [126, 94, 66], count: 2},
  ]);
  assert.deepEqual(result.get('a')(0), [120, 90, 60]);
  assert.deepEqual(result.get('b')(0), [100, 140, 60]);
  assert.deepEqual(result.get('c')(0), [126, 94, 66], 'no shared colours, so no shift');
});

test('kinds sharing a base colour spread in whole gaps; others only avoid exact clashes', () => {
  const groups = [
    {key: 'fletcher', base: [120, 90, 60], count: 4},
    {key: 'poleturner', base: [120, 90, 60], count: 3},
    {key: 'armourer', base: [120, 90, 60], count: 2},
    {key: 'tanner', base: [121, 91, 61], count: 2},
  ];
  const result = assignColours(groups);
  assert.deepEqual(result.get('fletcher')(0), [120, 90, 60]);
  assert.deepEqual(result.get('poleturner')(0), [130, 100, 70], 'one gap brighter first');
  assert.deepEqual(result.get('armourer')(0), [110, 80, 50], 'then one gap darker');
  assert.deepEqual(result.get('tanner')(0), [123, 93, 63], 'a different colour moves only past the shared levels');
  const all = groups.map(group => colours(result.get(group.key), group.count).map(String));
  assert.equal(new Set(all.flat()).size, all.flat().length, 'no colour is shared between buildings');
});

test('bands stay inside the byte range with every instance distinct', () => {
  const band = fitBand([250, 10, 128], 200);
  assert.ok(Math.min(...band.centre) + band.low >= 0 && Math.max(...band.centre) + band.high <= 255);
  const pick = assignColours([{key: '9', base: [250, 10, 128], count: 200}]).get('9');
  assert.equal(new Set(colours(pick, 200).map(String)).size, 200);
  const bright = assignColours([{key: 'w', base: [255, 255, 255], count: 3}]).get('w');
  assert.deepEqual(colours(bright, 3), [[254, 254, 254], [255, 255, 255], [253, 253, 253]]);
});

test('band distance measures the closest pair of colours between two bands', () => {
  assert.equal(bandDistance(fitBand([2, 2, 2], 5), fitBand([10, 10, 10], 1)), 6);
  assert.equal(bandDistance(fitBand([0, 0, 0], 1), fitBand([0, 30, 0], 1)), 30);
});

test('the keep splits into keep, forecourt with entrance, and a stockpile', () => {
  const rects = geometry.footprintRectsAtXY(61, 40, 60, [7, 15]);
  const parts = regions(61, rects);
  assert.deepEqual(parts.map(part => part.key), ['61', '61:forecourt', '52']);
  assert.deepEqual(parts[0].rects, [{left: 40, right: 46, top: 60, bottom: 54, part: 'keep'}]);
  assert.deepEqual(parts[1].rects.map(r => [r.left, r.right, r.bottom, r.top]), [[42, 44, 53, 53], [40, 46, 46, 52]]);
  assert.deepEqual(parts[2].rects.map(r => [r.left, r.right, r.bottom, r.top]), [[47, 51, 54, 58]]);
});

test('training buildings and the oil smelter colour their grounds separately', () => {
  const [building, ground] = regions(87, [{left: 10, right: 19, top: 50, bottom: 41}]);
  assert.deepEqual(building, {key: '87', rects: [{left: 10, right: 14, top: 50, bottom: 46}]});
  assert.equal(ground.key, '87:forecourt');
  const tiles = new Set();
  for (const r of [building, ground].flatMap(part => part.rects))
    for (let y = r.bottom; y <= r.top; y++) for (let x = r.left; x <= r.right; x++) tiles.add(`${x},${y}`);
  assert.equal(tiles.size, 100, 'building and grounds cover the whole footprint once');
  assert.deepEqual(regions(180, [{left: 0, right: 3, top: 99, bottom: 92}]).map(part => part.rects),
    [[{left: 0, right: 3, top: 99, bottom: 96}], [{left: 0, right: 3, top: 95, bottom: 92}]]);
  assert.deepEqual(regions(50, [{left: 1, right: 4, top: 9, bottom: 6}]), [{key: '50', rects: [{left: 1, right: 4, top: 9, bottom: 6}]}]);
});

test('forecourt layouts match the native ground plates of the iso catalogue', () => {
  const catalogue = require('../assets/aiv/iso/verzeichnis.json').gegenstaende;
  for (const [type, layout] of Object.entries(FORECOURTS)) {
    assert.equal(catalogue[type].kacheln, layout.size, `building block of ${type}`);
    assert.deepEqual(catalogue[type].platten.map(plate => [plate.dx, plate.dy, plate.kacheln]), layout.plates, `plates of ${type}`);
  }
  const withPlates = Object.entries(catalogue).filter(([, entry]) => entry.platten?.length).map(([type]) => Number(type)).sort((a, b) => a - b);
  assert.deepEqual(withPlates, [61, ...Object.keys(FORECOURTS).map(Number)].sort((a, b) => a - b));
});

test('regions covering more tiles keep their original colour first', () => {
  const result = assignColours([
    {key: '180', base: [71, 71, 71], count: 2, area: 32},
    {key: '61', base: [72, 72, 72], count: 1, area: 49},
  ]);
  assert.deepEqual(result.get('61')(0), [72, 72, 72]);
  assert.notDeepEqual(result.get('180')(0), [71, 71, 71]);
});
