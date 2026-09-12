const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all added resource plan skins preserve 32-pixel tiles at native footprint size', () => {
  for(const [type,n] of [[56,6],[70,9],[71,9],[72,11],[73,10],[90,4],[91,4]]) {
    const png=fs.readFileSync(path.join(__dirname,`../assets/aiv/skins/${type}.png`));
    assert.equal(png.readUInt32BE(16),32*n);
    assert.equal(png.readUInt32BE(20),32*n);
  }
});
