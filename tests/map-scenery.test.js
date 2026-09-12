const test = require('node:test');
const assert = require('node:assert/strict');
const { internals: { upperTilePicture, packMapPictures } } = require('../src/node/game-map');

test('map upper graphics retain GM1 lift, half-tile offset and transparent pixels', () => {
  const raw = Buffer.concat([Buffer.alloc(512), Buffer.from([0, 0xff, 0x7f, 0x80])]);
  const picture = upperTilePicture({ height: 2, lift: 40, direction: 3 }, raw);
  assert.equal(picture.dx, 14);
  assert.equal(picture.dy, -40);
  assert.equal(picture.rgba[3], 255);
  assert.equal(picture.rgba[7], 0);
  assert.equal(picture.rgba[30 * 4 + 3], 0);
  assert.equal(upperTilePicture({ height: 16 }, Buffer.alloc(512)), null);
});

test('map sprite packing preserves blank indices and separates tall sprites', () => {
  const make = (width, height) => ({ width, height, dx: 14, dy: -40, rgba: Buffer.alloc(width * height * 4) });
  const atlas = packMapPictures([make(1500, 10), null, make(700, 100)]);
  assert.equal(atlas.entries[1], null);
  assert.ok(atlas.entries[2].y > atlas.entries[0].y + atlas.entries[0].height);
  assert.equal(atlas.entries[2].dy, -40);
  assert.match(atlas.dataUrl, /^data:image\/png;base64,/);
  assert.throws(() => packMapPictures([make(2048, 1)]), /dimensions/);
});
