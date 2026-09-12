const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const geo = require('../src/js/iso-geometry');
const catalogue = require('../assets/aiv/iso/verzeichnis.json');
const entries = catalogue.gegenstaende;

function item(type, gx, gy, extra = {}) {
  return { itemType: type, gx, gy, tiles: entries[type].kacheln, entry: entries[type], ref: String(type), ...extra };
}

test('drawbridges attach to the complete aligned edge of either gatehouse size', () => {
  for (const size of [5, 7]) for (let side = 0; side < 4; side++) {
    const type = (size === 5 ? 144 : 146) + side % 2;
    const margin = (size - 5) / 2;
    const positions = [[20 - margin, 20 - size], [25, 20 - margin],
      [20 - margin, 25], [20 - size, 20 - margin]];
    const gate = item(type, ...positions[side]);
    const result = geo.attachDrawbridges([item(105, 20, 20), gate])[0];
    assert.equal(result.bridgeDirection, side * 2);
    assert.equal(result.gateRef, gate.ref);
    assert.equal(result.entry.bild, `bridge_direction_${side * 2}.png`);
  }
});

test('a nearby, misaligned, perpendicular or future gate is not an attachment', () => {
  for (const gates of [[], [item(145, 20, 15)], [item(144, 21, 15)], [item(144, 20, 14)]]) {
    const result = geo.attachDrawbridges([item(105, 20, 20), ...gates])[0];
    assert.equal(result.unattachedBridge, true);
    assert.equal(result.entry, null);
  }
});

test('farms contain their native field objects as well as all nine hut tiles', () => {
  for (const [type, variants, count] of [[70, 4, 45], [71, 2, 33], [72, 1, 17], [73, 4, 32]]) {
    assert.equal(entries[type].partsLayouts.length, variants);
    for (const layout of entries[type].partsLayouts) {
      assert.equal(layout.length, count);
      assert.ok(layout.some(p => p.gx > 2 || p.gy > 2));
    }
  }
  const farms = geo.collectItems({ frames: [{ itemType: 73, tilePositionOfsets: [9020, 9040] }] }, catalogue);
  assert.equal(farms[1].layoutIndex, 1);
  assert.deepEqual(geo.buildingParts(farms[1]).map(p => [p.gx - farms[1].gx, p.gy - farms[1].gy]),
    entries[73].partsLayouts[1].map(p => [p.gx, p.gy]));
});

test('native components retain their pixel dimensions and every referenced image is packaged', () => {
  const all = Object.values(entries).flatMap(e => [e, ...(e.platten || []), ...(e.directions || [])]);
  for (const entry of all) for (const layout of entry.partsLayouts || []) for (const part of layout) {
    const png = fs.readFileSync(path.join(__dirname, '../assets/aiv/iso', part.bild));
    assert.equal(png.readUInt32BE(16), part.breite, part.bild);
    assert.equal(png.readUInt32BE(20), part.hoehe, part.bild);
    assert.ok(Number.isInteger(part.dx) && Number.isInteger(part.dy));
  }
});

test('terrain and individual building tiles interleave, including elevated foreground ground', () => {
  const parts = geo.buildingParts(item(50, 10, 10));
  const ground = { gx: 12, gy: 12, tiles: 1, layer: 0 };
  const rock = { gx: 12, gy: 12, tiles: 1, layer: 3 };
  const ordered = [...parts, ground, rock].sort(geo.renderOrder);
  assert.ok(ordered.indexOf(ground) > ordered.indexOf(parts.find(p => p.gx === 10 && p.gy === 10)));
  assert.ok(ordered.indexOf(ground) < ordered.indexOf(parts.find(p => p.gx === 12 && p.gy === 12)));
  assert.ok(ordered.indexOf(rock) < ordered.indexOf(parts.find(p => p.gx === 13 && p.gy === 13)));
});
