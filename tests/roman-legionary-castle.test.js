const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const geometry = require('../src/js/castle-geometry');

const root = path.resolve(__dirname, '..');
const aivPath = path.join(root, 'examples', 'RomanLegionary', 'aiv', 'roman_legionary_castrum.aiv');
const constants = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_constants.json'), 'utf8'));

function count(document, itemType) {
  return document.frames
    .filter(frame => Number(frame.itemType) === itemType)
    .reduce((total, frame) => total + frame.tilePositionOfsets.length, 0);
}

test('Roman Legionary Castrum has the requested economy and safe native layout', async () => {
  const { parseAiv } = await import('../src/node/aiv-codec.mjs');
  const castle = parseAiv(fs.readFileSync(aivPath));
  assert.equal(castle.frames[0].itemType, 61);
  assert.deepEqual(castle.frames[0].tilePositionOfsets, [5643]);
  assert.equal(count(castle, 50), 34);
  assert.equal(count(castle, 52), 3);
  assert.equal(count(castle, 81), 3);
  assert.equal(count(castle, 80), 1);

  const occupied = [];
  const blocked = new Set();
  const bounds = { left: 99, bottom: 99, right: 0, top: 0 };
  for (const frame of castle.frames) {
    for (const itemOffset of frame.tilePositionOfsets) {
      const x = itemOffset % 100;
      const y = Math.floor(itemOffset / 100);
      const rects = geometry.footprintRectsAtXY(frame.itemType, x, y, constants[String(frame.itemType)]?.size || [1, 1]);
      const itemBounds = geometry.footprintBounds(rects);
      bounds.left = Math.min(bounds.left, itemBounds.left);
      bounds.bottom = Math.min(bounds.bottom, itemBounds.bottom);
      bounds.right = Math.max(bounds.right, itemBounds.right);
      bounds.top = Math.max(bounds.top, itemBounds.top);
      assert.ok(itemBounds.left >= 14 && itemBounds.bottom >= 14 && itemBounds.right <= 85 && itemBounds.top <= 85);
      for (const previous of occupied) assert.equal(geometry.footprintsIntersect(rects, previous), false);
      occupied.push(rects);
      for (const rect of rects) {
        for (let tileY = rect.bottom; tileY <= rect.top; tileY += 1) {
          for (let tileX = rect.left; tileX <= rect.right; tileX += 1) blocked.add(`${tileX},${tileY}`);
        }
      }
    }
  }
  assert.deepEqual(bounds, { left: 18, bottom: 25, right: 82, top: 80 });

  const reached = new Set(['50,61']);
  const queue = [[50, 61]];
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index];
    for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const key = `${nextX},${nextY}`;
      if (nextX < 14 || nextX > 85 || nextY < 14 || nextY > 85 || blocked.has(key) || reached.has(key)) continue;
      reached.add(key);
      queue.push([nextX, nextY]);
    }
  }
  for (const frame of castle.frames.filter(frame => ![25, 26].includes(Number(frame.itemType)))) {
    for (const itemOffset of frame.tilePositionOfsets) {
      const x = itemOffset % 100;
      const y = Math.floor(itemOffset / 100);
      const rects = geometry.footprintRectsAtXY(frame.itemType, x, y, constants[String(frame.itemType)]?.size || [1, 1]);
      assert.equal(rects.some(rect => {
        for (let tileX = rect.left; tileX <= rect.right; tileX += 1) {
          if (reached.has(`${tileX},${rect.bottom - 1}`) || reached.has(`${tileX},${rect.top + 1}`)) return true;
        }
        for (let tileY = rect.bottom; tileY <= rect.top; tileY += 1) {
          if (reached.has(`${rect.left - 1},${tileY}`) || reached.has(`${rect.right + 1},${tileY}`)) return true;
        }
        return false;
      }), true, `item type ${frame.itemType} is not reachable`);
    }
  }
});
