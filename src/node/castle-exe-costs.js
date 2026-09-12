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
  const ranges = [];
  for (let i = 0; i < sections; i++) {
    const h = headers + i * 40;
    if (h + 40 > bytes.length) throw new Error('Truncated PE sections.');
    ranges.push({ start: bytes.readUInt32LE(h + 20), size: bytes.readUInt32LE(h + 16),
      rva: bytes.readUInt32LE(h + 12), flags: bytes.readUInt32LE(h + 36) });
  }
  // The game copies five cost columns per building into player data at startup.
  // Follow that initializer's source pointer rather than guessing from prices:
  // the short Hovel signature also occurs in unrelated tables in vanilla 1.41.
  const copies = [];
  const copyLoop = Buffer.from('8b50fc8951fc8b1089118b50048951048b50088951088b500c89510c83c01483c1143d', 'hex');
  if (bytes.readUInt16LE(pe + 20) >= 32 && bytes.readUInt16LE(pe + 24) === 0x10b) {
    const imageBase = bytes.readUInt32LE(pe + 52);
    for (const section of ranges.filter(s => s.flags & 0x20)) {
      const end = section.start + section.size;
      if (end > bytes.length) throw new Error('Truncated PE code.');
      for (let at = bytes.indexOf(copyLoop, section.start); at >= section.start && at + copyLoop.length + 7 <= end; at = bytes.indexOf(copyLoop, at + 1)) {
        if (at < section.start + 16 || bytes[at - 16] !== 0xb8 || bytes[at + copyLoop.length + 4] !== 0x7c || bytes[at + copyLoop.length + 6] !== 0xc3) continue;
        const origin = bytes.readUInt32LE(at - 15);
        const limit = bytes.readUInt32LE(at + copyLoop.length);
        if (limit <= origin || (limit - origin) % 20 || (limit - origin) / 20 < names.length + 1) continue;
        const rva = origin - imageBase + 16; // source starts at unused row 0, column 1; return Hovel row 1
        const data = ranges.find(s => (s.flags & 0x40) && rva >= s.rva && rva + names.length * 20 <= s.rva + s.size);
        if (!data) continue;
        const offset = data.start + rva - data.rva;
        if (offset + names.length * 20 > bytes.length) throw new Error('Truncated PE cost table.');
        copies.push(offset);
      }
    }
  }
  if (new Set(copies).size > 1) throw new Error('Multiple game cost initializers; unsupported executable.');
  const matches = [];
  for (let i = 0; i < sections; i++) {
    const h = headers + i * 40;
    if (h + 40 > bytes.length) throw new Error('Truncated PE sections.');
    // Initialized data only: never match bytes in code or an overlay.
    if (!(bytes.readUInt32LE(h + 36) & 0x40)) continue;
    const start = bytes.readUInt32LE(h + 20), end = start + bytes.readUInt32LE(h + 16);
    if (end > bytes.length) throw new Error('Truncated PE data.');
    const offsets = copies.length ? [...new Set(copies)].filter(at => at >= start && at < end) : [];
    if (!copies.length) for (let at = bytes.indexOf(SIGNATURE, start); at >= start && at < end; at = bytes.indexOf(SIGNATURE, at + 1)) offsets.push(at);
    for (const at of offsets) {
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
