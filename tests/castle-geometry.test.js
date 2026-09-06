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

// ------------------------------------------- Pinselgroesse und Farbeimer

test('a brush of size 1 is one tile, size 3 a square of nine', () => {
  assert.deepEqual(geometry.brushTiles({ x: 5, y: 5 }, 1), [{ x: 5, y: 5 }]);
  const drei = geometry.brushTiles({ x: 5, y: 5 }, 3);
  assert.equal(drei.length, 9);
  assert.ok(drei.some(t => t.x === 4 && t.y === 4), 'die linke untere Ecke gehoert dazu');
  assert.ok(drei.some(t => t.x === 6 && t.y === 6), 'die rechte obere auch');
});

test('the brush is cut off at the edge of the map, never wrapped', () => {
  const ecke = geometry.brushTiles({ x: 0, y: 0 }, 3);
  assert.equal(ecke.length, 4, 'in der Ecke bleibt ein Viertel uebrig');
  assert.ok(ecke.every(t => t.x >= 0 && t.y >= 0));
  const gegenueber = geometry.brushTiles({ x: 99, y: 99 }, 5);
  assert.ok(gegenueber.every(t => t.x < 100 && t.y < 100));
});

test('the brush never grows past the map and never shrinks below one tile', () => {
  assert.equal(geometry.brushTiles({ x: 50, y: 50 }, 0).length, 1);
  assert.equal(geometry.brushTiles({ x: 50, y: 50 }, -7).length, 1);
  assert.equal(geometry.brushTiles({ x: 50, y: 50 }, 1000).length,
               geometry.brushTiles({ x: 50, y: 50 }, 100).length,
               'groesser als die Karte gibt es nicht');
});

test('the bucket fills up to a wall and stops there', () => {
  // Eine Kammer 3x3, umschlossen von belegten Feldern.
  const wand = new Set(['1,1','2,1','3,1','1,2','3,2','1,3','2,3','3,3','1,4','2,4','3,4','4,4']);
  const blockiert = (x, y) => wand.has(x + ',' + y);
  const gefuellt = geometry.floodTiles({ x: 2, y: 2 }, blockiert, 100);
  assert.deepEqual(gefuellt, [{ x: 2, y: 2 }], 'die Kammer ist genau ein Feld gross');
});

test('the edge of the map counts as a wall', () => {
  // Eine Ecke, abgeriegelt durch zwei Felder: der Rand schliesst den Rest.
  const blockiert = (x, y) => (x === 2 && y <= 1) || (y === 2 && x <= 1);
  const ecke = geometry.floodTiles({ x: 0, y: 0 }, blockiert, 100);
  assert.equal(ecke.length, 4, 'nur die vier Felder in der Ecke');
  assert.ok(ecke.every(t => t.x <= 1 && t.y <= 1));
});

test('the bucket does not leak through a diagonal gap', () => {
  // Zwei Kammern, die sich nur an einer Ecke beruehren.
  const blockiert = (x, y) => (x === 1 && y === 0) || (x === 0 && y === 1)
                           || (x === 2 && y === 1) || (x === 1 && y === 2);
  const links = geometry.floodTiles({ x: 0, y: 0 }, blockiert, 100);
  assert.deepEqual(links, [{ x: 0, y: 0 }], 'diagonal ist kein Durchgang');
});

test('a click on something solid fills nothing', () => {
  assert.deepEqual(geometry.floodTiles({ x: 5, y: 5 }, () => true, 100), []);
});

test('the bucket has a brake, so a slip does not build half the map', () => {
  const frei = geometry.floodTiles({ x: 50, y: 50 }, () => false, 100, 250);
  assert.equal(frei.length, 250, 'bei der Grenze ist Schluss');
  const ganz = geometry.floodTiles({ x: 50, y: 50 }, () => false, 100, 100000);
  assert.equal(ganz.length, 10000, 'ohne Hindernis ist die ganze Karte erreichbar');
});
