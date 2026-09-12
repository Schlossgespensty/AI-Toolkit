'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { internals: { readGm1, tgxToRgba } } = require('./game-map');
const { encodeRgbaPng } = require('./pixel-image');
// Original unhighlighted HUD goods symbols, zero-based interface_icons2 indices.
const GOODS = { wood: 45, stone: 49, iron: 53, pitch: 57, gold: 71,
  hop: 47, wheat: 59, bread: 61, cheese: 63, meat: 65, fruit: 67 };
function readResourceIcons(root) {
  if (!root) return {};
  const file = path.join(root, 'gm', 'interface_icons2.gm1');
  if (!fs.existsSync(file)) return {};
  const buffer = fs.readFileSync(file);
  if (buffer.readUInt32LE(20) !== 1) throw new Error('Unsupported HUD icon format.');
  const stock = readGm1(buffer);
  return Object.fromEntries(Object.entries(GOODS).map(([name, index]) => {
    const p = stock.pictures[index];
    if (!p || p.width < 1 || p.height < 1 || p.width > 128 || p.height > 128) throw new Error('Invalid resource icon.');
    const bytes = buffer.subarray(stock.picturesAt + p.offset, stock.picturesAt + p.offset + p.size);
    const rgba = tgxToRgba(bytes, p.width, p.height, null);
    return [name, `data:image/png;base64,${encodeRgbaPng(p.width, p.height, rgba).toString('base64')}`];
  }));
}
module.exports = { readResourceIcons, GOODS };
