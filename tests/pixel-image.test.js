const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');

const {
  placeholderPortraitPng,
  resizeBgraBitmapToPng
} = require('../src/node/pixel-image');

function decodeSimpleRgbaPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const scanlines = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    assert.equal(scanlines[y * (stride + 1)], 0);
    scanlines.copy(rgba, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, rgba };
}

test('default AI portraits are valid, exact-size, fully opaque PNGs', () => {
  for (const size of [36, 72]) {
    const decoded = decodeSimpleRgbaPng(placeholderPortraitPng(size));
    assert.equal(decoded.width, size);
    assert.equal(decoded.height, size);
    for (let offset = 3; offset < decoded.rgba.length; offset += 4) assert.equal(decoded.rgba[offset], 255);
  }
});

test('portrait resizing is nearest-neighbor with binary alpha', () => {
  const source = Buffer.from([
    20, 40, 60, 127,
    25, 50, 100, 128
  ]);
  const decoded = decodeSimpleRgbaPng(resizeBgraBitmapToPng(source, 2, 1, 4, 2));
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 2);

  for (let y = 0; y < 2; y += 1) {
    assert.deepEqual([...decoded.rgba.subarray((y * 4) * 4, (y * 4 + 1) * 4)], [0, 0, 0, 0]);
    assert.deepEqual([...decoded.rgba.subarray((y * 4 + 1) * 4, (y * 4 + 2) * 4)], [0, 0, 0, 0]);
    assert.deepEqual([...decoded.rgba.subarray((y * 4 + 2) * 4, (y * 4 + 3) * 4)], [199, 100, 50, 255]);
    assert.deepEqual([...decoded.rgba.subarray((y * 4 + 3) * 4, (y * 4 + 4) * 4)], [199, 100, 50, 255]);
  }
  for (let offset = 3; offset < decoded.rgba.length; offset += 4) {
    assert.ok(decoded.rgba[offset] === 0 || decoded.rgba[offset] === 255);
  }
});
