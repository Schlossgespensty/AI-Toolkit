// Asset conversion, not a game simulation. Reads the installed game's GM1s
// and farm placement tables. See docs/farm-graphics.md for provenance.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const gm = require('../src/node/gm1');
const { virtualToFile } = require('../src/node/pe-addresses');
const { encodeRgbaPng } = require('../src/node/pixel-image');
const { packMapPictures } = require('../src/node/pixel-atlas');
if (!process.argv[2]) throw new Error('Usage: node scripts/export-farm-parts.js GAME_FOLDER');
const game = path.resolve(process.argv[2]);
const output = path.join(__dirname, '../assets/aiv/iso');
const exe = fs.readFileSync(path.join(game, 'Stronghold Crusader.exe'));
// These placement-table addresses belong to this researched executable.
// Refuse another layout instead of silently exporting unrelated data.
const crypto = require('node:crypto');
if (crypto.createHash('sha256').update(exe).digest('hex') !==
    '0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34')
  throw new Error('This exporter needs the researched Crusader 1.41 executable; verify tables before adding another version.');
const address = virtualToFile(exe);
const integer = va => {
  const at = address(va);
  if (at < 0 || at + 4 > exe.length) throw new Error('Unsupported farm table location.');
  return exe.readInt32LE(at);
};
const stocks = new Map(), pictures = new Map();
function stock(name) {
  if (!stocks.has(name)) stocks.set(name, gm.readGm1(fs.readFileSync(path.join(game, 'gm', `${name}.gm1`))));
  return stocks.get(name);
}
function composite(target, width, height, source, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const at = (y * sw + x) * 4, tx = x + dx, ty = y + dy;
    if (source[at + 3] && tx >= 0 && ty >= 0 && tx < width && ty < height)
      source.copy(target, (ty * width + tx) * 4, at, at + 4);
  }
}
function picture(name, index, palette = null) {
  const key = `${name}-${index}-${palette ?? 'tile'}`;
  if (pictures.has(key)) return pictures.get(key).part;
  const file = stock(name), entry = file.pictures[index];
  if (!entry) throw new Error(`Missing game picture ${name} #${index}`);
  const raw = file.buffer.subarray(file.picturesAt + entry.offset, file.picturesAt + entry.offset + entry.size);
  let rgba, width, height, dx, dy;
  if (palette !== null) {
    width = entry.width; height = entry.height;
    rgba = gm.tgxToRgba(raw, width, height, file.palettes[palette]);
    dx = -1 - file.buffer.readInt32LE(0x48);
    dy = 6 - file.buffer.readInt32LE(0x4c);
  } else {
    const upper = gm.upperTilePicture(entry, raw);
    const top = Math.min(0, upper?.dy || 0);
    width = Math.max(30, upper ? upper.dx + upper.width : 0);
    height = Math.max(16, upper ? upper.dy + upper.height : 0) - top;
    dx = -15; dy = top;
    rgba = Buffer.alloc(width * height * 4);
    composite(rgba, width, height, gm.diamondToRgba(raw.subarray(0, 512)), 30, 16, 0, -top);
    if (upper) composite(rgba, width, height, upper.rgba, upper.width, upper.height, upper.dx, upper.dy - top);
  }
  const bild = `parts/${key}.png`;
  const part = { bild, breite: width, hoehe: height, dx, dy };
  pictures.set(key, { part, rgba });
  return part;
}
function offsets(va, count, stride = 8) {
  return Array.from({ length: count }, (_, i) => {
    const gx = integer(va + i * stride), gy = integer(va + i * stride + 4);
    if (gx < 0 || gy < 0 || gx > 10 || gy > 10) throw new Error('Unsupported farm footprint table.');
    return [gx, gy, stride === 12 ? integer(va + i * stride + 8) : null];
  });
}
function hut(first) {
  return group('tile_buildings2', first, 3);
}
function group(name, first, n) {
  const parts = [];
  let index = first;
  const file = stock(name), heads = 88 + 5120 + file.count * 8;
  if (file.buffer[heads + first * 16 + 8] !== 0 || file.buffer[heads + first * 16 + 9] !== n * n)
    throw new Error(`Not a ${n}x${n} GM1 group: ${name} #${first}`);
  // Original GM1 group order, from the front tip towards the rear tip.
  for (let sum = 2 * (n - 1); sum >= 0; sum--) for (let gx = Math.max(0, sum - n + 1); gx <= Math.min(n - 1, sum); gx++)
    parts.push({ gx, gy: sum - gx, ...picture(name, index++) });
  return parts;
}
const catalogueFile = path.join(output, 'verzeichnis.json');
const catalogue = JSON.parse(fs.readFileSync(catalogueFile, 'utf8'));
function fallback(entry, parts) {
  const top = Math.min(...parts.map(p => (p.gx + p.gy) * 8 + p.dy));
  const half = Math.ceil(Math.max((32 * entry.kacheln - 2) / 2, ...parts.flatMap(p => {
    const x = (p.gx - p.gy) * 16 + p.dx;
    return [Math.abs(x), Math.abs(x + p.breite)];
  })));
  const bottom = Math.max(16 * entry.kacheln, ...parts.map(p => (p.gx + p.gy) * 8 + p.dy + p.hoehe));
  const width = half * 2, height = bottom - top;
  const rgba = Buffer.alloc(width * height * 4);
  for (const part of [...parts].sort((a, b) => a.gx + a.gy - b.gx - b.gy)) {
    const source = [...pictures.values()].find(p => p.part.bild === part.bild);
    composite(rgba, width, height, source.rgba, part.breite, part.hoehe,
      half + (part.gx - part.gy) * 16 + part.dx, (part.gx + part.gy) * 8 + part.dy - top);
  }
  fs.writeFileSync(path.join(output, entry.bild), encodeRgbaPng(width, height, rgba));
  entry.breite = width; entry.hoehe = height;
}
// Existing catalogue filenames identify the original GM1 group, including
// its zero-based first picture. Preserve these proven selections, but retain
// the per-tile graphics instead of flattening each building into one layer.
for (const entry of Object.values(catalogue.gegenstaende).flatMap(entry => [entry, ...(entry.platten || [])])) {
  const match = entry.bild.match(/^(tile_\w+)_(\d+)\.png$/);
  if (match) entry.partsLayouts = [group(match[1], Number(match[2]), entry.kacheln)];
}
const definitions = [[70, 390, 4, 0xb49870, 36, 8], [71, 399, 2, 0xb49cf0, 24, 8],
  [72, 408, 1, 0xb49e70, 8, 8], [73, 417, 4, 0xb49eb0, 27, 12]];
for (const [type, first, variants, table, count, stride] of definitions) {
  const layouts = [];
  for (let variant = 0; variant < variants; variant++) {
    const parts = hut(first);
    const fields = offsets(table + variant * count * stride, count, stride);
    fields.forEach(([gx, gy, property], index) => {
      if (type === 73 && index < 4) return; // Four cow destinations, not fence graphics.
      let asset;
      if (type === 73) {
        const fence = { 81: 0, 80: 1, 1: 2, 3: 3, 5: 4, 7: 5 }[property];
        if (fence === undefined) throw new Error('Unsupported dairy fence property.');
        asset = picture('tile_farmland', 55 + fence);
      } else if (type === 72) {
        // Newly placed orchard, animation frame 0, RandomLayer value 0.
        const frame = exe.readUInt8(address(0xb47e14 + 0xc74));
        asset = picture('tree_apple', frame - 1, 2);
      } else asset = picture('tile_farmland', type === 70 ? 0 : 37);
      parts.push({ gx, gy, ...asset });
    });
    layouts.push(parts);
  }
  const entry = catalogue.gegenstaende[type];
  entry.partsLayouts = layouts;
  entry.previewState = 'Initial field state; layout sequence assumes a new castle. Growth and tile randomness come from the running game.';
  delete entry.fieldFootprint;
  // Keep a complete fallback image for consumers that do not support parts.
  fallback(entry, layouts[0]);
}
const bridge = catalogue.gegenstaende[105];
bridge.attachmentOffsets = Array.from({ length: 4 }, (_, d) =>
  Array.from({ length: 9 }, (_, i) => [integer(0xb4ae20 + (d * 9 + i) * 8), integer(0xb4ae24 + (d * 9 + i) * 8)]));
bridge.directions = Array.from({ length: 4 }, (_, d) => {
  // The GM1 preview groups run around the camera in the reverse order to
  // checkDrawbridgePlacement's world-space attachment sides.
  const variant = { kacheln: 5, bild: `bridge_direction_${d * 2}.png`, partsLayouts: [group('tile_castle', 1332 + [0, 3, 2, 1][d] * 25, 5)] };
  fallback(variant, variant.partsLayouts[0]);
  return variant;
});
const values = [...pictures.values()];
const atlas = packMapPictures(values.map(({ part, rgba }) => ({
  width: part.breite, height: part.hoehe, dx: part.dx, dy: part.dy, rgba
})));
const locations = new Map(values.map(({ part }, i) => [part.bild, atlas.entries[i]]));
fs.writeFileSync(path.join(output, 'building-parts.png'), Buffer.from(atlas.dataUrl.split(',')[1], 'base64'));
for (const entry of Object.values(catalogue.gegenstaende).flatMap(e => [e, ...(e.platten || []), ...(e.directions || [])])) {
  for (const layout of entry.partsLayouts || []) for (const part of layout) {
    const location = locations.get(part.bild);
    part.bild = 'building-parts.png';
    part.sx = location.x; part.sy = location.y;
  }
}
fs.writeFileSync(catalogueFile, JSON.stringify(catalogue, null, 1) + '\n');
process.stdout.write(`Exported ${pictures.size} original building and farm components.\n`);
