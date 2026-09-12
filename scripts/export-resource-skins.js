'use strict';
// node scripts/export-resource-skins.js "path/to/Village Editor/gm/colour tiles.gm1"
// Reuses the existing GM1/TGX decoder and the original clockwise tile layout.
const fs = require('node:fs');
const path = require('node:path');
const { internals: { readGm1, tgxToRgba } } = require('../src/node/game-map');
const { encodeRgbaPng } = require('../src/node/pixel-image');
const file = process.argv[2];
if (!file) throw new Error('Provide the original colour tiles.gm1 path.');
const bytes = fs.readFileSync(file), stock = readGm1(bytes);
for (const [id, n, colour] of [[70,9,4],[71,9,4],[72,11,4],[73,10,4],[56,6,2],[90,4,2],[91,4,2]]) {
  const width=32*n, rgba=Buffer.alloc(width*width*4);
  for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
    // Corners TL/TR/BR/BL: 40/60/80/100. Edges T/R/B/L: 120/140/160/180.
    const index=(y===0 ? (x===0?40:x===n-1?60:120) : y===n-1 ? (x===0?100:x===n-1?80:160) : x===0?180:x===n-1?140:200)+colour;
    const p=stock.pictures[index];
    if (p.width!==32 || p.height!==32) throw new Error('Expected original 32-pixel tiles.');
    const pixels=tgxToRgba(bytes.subarray(stock.picturesAt+p.offset,stock.picturesAt+p.offset+p.size),32,32,null);
    for(let row=0;row<32;row++) pixels.copy(rgba,((y*32+row)*width+x*32)*4,row*128,(row+1)*128);
  }
  fs.writeFileSync(path.join(__dirname,`../assets/aiv/skins/${id}.png`),encodeRgbaPng(width,width,rgba));
}
