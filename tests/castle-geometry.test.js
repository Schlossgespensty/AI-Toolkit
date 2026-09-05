const assert = require('node:assert/strict');
const test = require('node:test');

const geometry = require('../src/js/castle-geometry.js');

test('Keep footprint includes its forced Stockpile but leaves four middle-row tiles free', () => {
  const footprint = geometry.footprintRectsAtXY(geometry.KEEP_ITEM_TYPE, 20, 50, [7, 15]);

  for (const x of [20, 21, 25, 26]) {
    assert.equal(geometry.footprintContainsTile(footprint, { x, y: 43 }), false, `tile ${x},43 should be free`);
  }
  for (const x of [22, 23, 24]) {
    assert.equal(geometry.footprintContainsTile(footprint, { x, y: 43 }), true, `tile ${x},43 should be occupied`);
  }

  assert.equal(geometry.footprintContainsTile(footprint, { x: 27, y: 48 }), true, 'Stockpile top-left');
  assert.equal(geometry.footprintContainsTile(footprint, { x: 31, y: 44 }), true, 'Stockpile bottom-right');
  assert.equal(geometry.footprintContainsTile(footprint, { x: 31, y: 43 }), false, 'below Stockpile');
});

test('Keep collision follows the shaped footprint instead of its bounding rectangle', () => {
  const keep = geometry.footprintRectsAtXY(geometry.KEEP_ITEM_TYPE, 20, 50, [7, 15]);
  const freeTile = geometry.footprintRectsAtXY(54, 20, 43, [1, 1]);
  const centerTile = geometry.footprintRectsAtXY(54, 23, 43, [1, 1]);
  const stockpileTile = geometry.footprintRectsAtXY(54, 29, 46, [1, 1]);

  assert.equal(geometry.footprintsIntersect(keep, freeTile), false);
  assert.equal(geometry.footprintsIntersect(keep, centerTile), true);
  assert.equal(geometry.footprintsIntersect(keep, stockpileTile), true);
});

test('Keep bounds account for the five-tile Stockpile extension', () => {
  assert.equal(
    geometry.footprintIsInBounds(geometry.footprintRectsAtXY(61, 88, 99, [7, 15]), 100),
    true
  );
  assert.equal(
    geometry.footprintIsInBounds(geometry.footprintRectsAtXY(61, 89, 99, [7, 15]), 100),
    false
  );
  assert.equal(
    geometry.footprintIsInBounds(geometry.footprintRectsAtXY(61, 20, 13, [7, 15]), 100),
    false
  );
});

test('lineTiles creates gapless horizontal, vertical, and diagonal lines', () => {
  assert.deepEqual(
    geometry.lineTiles({ x: 2, y: 4 }, { x: 5, y: 4 }),
    [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }]
  );
  assert.deepEqual(
    geometry.lineTiles({ x: 3, y: 5 }, { x: 3, y: 2 }),
    [{ x: 3, y: 5 }, { x: 3, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 2 }]
  );
  assert.deepEqual(
    geometry.lineTiles({ x: 1, y: 1 }, { x: 4, y: 4 }),
    [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }]
  );
});

test('lineTiles includes both endpoints for shallow and reversed lines', () => {
  const shallow = geometry.lineTiles({ x: 2, y: 2 }, { x: 7, y: 4 });
  assert.deepEqual(shallow[0], { x: 2, y: 2 });
  assert.deepEqual(shallow.at(-1), { x: 7, y: 4 });
  assert.equal(shallow.length, 6);

  const reversed = geometry.lineTiles({ x: 7, y: 4 }, { x: 2, y: 2 });
  assert.deepEqual(reversed, [...shallow].reverse());
});

test('limitedLineTiles grows with the drag and stops at the stair sequence length', () => {
  assert.deepEqual(
    geometry.limitedLineTiles({ x: 10, y: 10 }, { x: 30, y: 10 }, 5),
    [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
      { x: 13, y: 10 },
      { x: 14, y: 10 }
    ]
  );
  assert.deepEqual(
    geometry.limitedLineTiles({ x: 10, y: 10 }, { x: 8, y: 8 }, 5),
    [{ x: 10, y: 10 }, { x: 9, y: 9 }, { x: 8, y: 8 }]
  );
  assert.deepEqual(
    geometry.limitedLineTiles({ x: 10, y: 10 }, { x: 10, y: 10 }, 5),
    [{ x: 10, y: 10 }]
  );
});

test('routedLineTiles preserves a straight line when it is unobstructed', () => {
  const start = { x: 1, y: 2 };
  const end = { x: 7, y: 5 };
  assert.deepEqual(
    geometry.routedLineTiles(start, end, () => false, 10),
    geometry.lineTiles(start, end)
  );
});

test('routedLineTiles flows around occupied tiles without creating gaps', () => {
  const occupied = new Set(['3:3', '3:4', '3:5']);
  const route = geometry.routedLineTiles(
    { x: 1, y: 4 },
    { x: 6, y: 4 },
    point => occupied.has(`${point.x}:${point.y}`),
    10
  );

  assert.deepEqual(route[0], { x: 1, y: 4 });
  assert.deepEqual(route.at(-1), { x: 6, y: 4 });
  assert.equal(route.some(point => occupied.has(`${point.x}:${point.y}`)), false);
  for (let index = 1; index < route.length; index++) {
    assert.ok(Math.abs(route[index].x - route[index - 1].x) <= 1);
    assert.ok(Math.abs(route[index].y - route[index - 1].y) <= 1);
  }
});

test('routedLineTiles stops next to a blocked destination', () => {
  const target = { x: 5, y: 5 };
  const route = geometry.routedLineTiles(
    { x: 1, y: 1 },
    target,
    point => point.x === target.x && point.y === target.y,
    10
  );
  const last = route.at(-1);
  assert.ok(last);
  assert.equal(Math.max(Math.abs(last.x - target.x), Math.abs(last.y - target.y)), 1);
});

test('new build steps insert after the selected step and advance the anchor', () => {
  const frames = [{ itemType: 1 }, { itemType: 2 }, { itemType: 3 }];
  const first = geometry.insertBuildSteps(frames, [{ itemType: 10 }], 0);
  assert.deepEqual(frames.map(frame => frame.itemType), [1, 10, 2, 3]);
  assert.deepEqual(first, { startIndex: 1, endIndex: 1 });

  const second = geometry.insertBuildSteps(frames, [{ itemType: 11 }], first.endIndex);
  assert.deepEqual(frames.map(frame => frame.itemType), [1, 10, 11, 2, 3]);
  assert.deepEqual(second, { startIndex: 2, endIndex: 2 });
});

test('new build steps append when no build step is selected', () => {
  const frames = [{ itemType: 1 }];
  const inserted = geometry.insertBuildSteps(frames, [{ itemType: 2 }, { itemType: 3 }]);
  assert.deepEqual(frames.map(frame => frame.itemType), [1, 2, 3]);
  assert.deepEqual(inserted, { startIndex: 1, endIndex: 2 });
});

test('several selected build steps move together while retaining their prior order', () => {
  const frames = [1, 2, 3, 4, 5, 6].map(itemType => ({ itemType }));
  const moved = geometry.moveBuildSteps(frames, [1, 3, 4], 5);
  assert.deepEqual(frames.map(frame => frame.itemType), [1, 3, 6, 2, 4, 5]);
  assert.deepEqual(moved, { moved: true, startIndex: 3, endIndex: 5 });
});

test('selected build steps can move upward as one ordered block', () => {
  const frames = [1, 2, 3, 4, 5].map(itemType => ({ itemType }));
  const moved = geometry.moveBuildSteps(frames, [2, 4], 0);
  assert.deepEqual(frames.map(frame => frame.itemType), [3, 5, 1, 2, 4]);
  assert.deepEqual(moved, { moved: true, startIndex: 0, endIndex: 1 });
});
