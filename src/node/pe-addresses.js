'use strict';
function virtualToFile(exe) {
  const pe = exe.readUInt32LE(0x3c);
  const sections = exe.readUInt16LE(pe + 6);
  const optionalSize = exe.readUInt16LE(pe + 20);
  const imageBase = exe.readUInt32LE(pe + 24 + 28);
  const table = pe + 24 + optionalSize;
  const parts = [];
  for (let index = 0; index < sections; index += 1) {
    const at = table + index * 40;
    parts.push({
      virtualAt: exe.readUInt32LE(at + 12),
      rawSize: exe.readUInt32LE(at + 16),
      rawAt: exe.readUInt32LE(at + 20)
    });
  }
  return (address) => {
    const relative = address - imageBase;
    for (const part of parts) {
      if (relative >= part.virtualAt && relative < part.virtualAt + part.rawSize) {
        return part.rawAt + (relative - part.virtualAt);
      }
    }
    return -1;
  };
}

module.exports = { virtualToFile };
