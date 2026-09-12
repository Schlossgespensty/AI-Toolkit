'use strict';
const fs = require('node:fs');
const path = require('node:path');
const names = require('./building-cost-names.json');
// Same table locator used by rebalancer. Its origin is Hovel (runtime type 1),
// not the unused runtime type 0 row at 0x005C21D0 in Crusader 1.41.
const SIGNATURE = Buffer.from('06000000000000000000000000000000000000000600000000000000', 'hex');
function readCostTable(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a Windows game executable.');
  const pe = bytes.readUInt32LE(60);
  if (pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Invalid PE executable.');
  const sections = bytes.readUInt16LE(pe + 6), headers = pe + 24 + bytes.readUInt16LE(pe + 20);
  const matches = [];
  for (let i = 0; i < sections; i++) {
    const h = headers + i * 40;
    if (h + 40 > bytes.length) throw new Error('Truncated PE sections.');
    // Initialized data only: never match bytes in code or an overlay.
    if (!(bytes.readUInt32LE(h + 36) & 0x40)) continue;
    const start = bytes.readUInt32LE(h + 20), end = start + bytes.readUInt32LE(h + 16);
    if (end > bytes.length) throw new Error('Truncated PE data.');
    for (let at = bytes.indexOf(SIGNATURE, start); at >= start && at < end; at = bytes.indexOf(SIGNATURE, at + 1)) {
      if (at + names.length * 20 > end) continue;
      const rows = names.map((_, n) => Array.from({ length: 5 }, (_, r) => bytes.readInt32LE(at + n * 20 + r * 4)));
      if (rows.every(row => row.every(n => n >= 0 && n <= 1000000))) matches.push(rows);
    }
  }
  if (matches.length !== 1) throw new Error(`Game cost table matched ${matches.length} locations; unsupported or modified executable.`);
  const buildings = {};
  names.forEach((name, i) => { if (!buildings[name]) buildings[name] = { cost: matches[0][i] }; });
  return buildings;
}
function readExeCosts(root) {
  const filePath = path.join(root, 'Stronghold Crusader.exe');
  if (!fs.existsSync(filePath)) return null;
  return { filePath, buildings: readCostTable(fs.readFileSync(filePath)) };
}
module.exports = { readCostTable, readExeCosts, SIGNATURE };
