// Where a dragged window would land: the arithmetic between the pointer and
// the layout, with no screen anywhere near it.
//
// The view measures the boxes off the screen and hands them in; everything
// after that is decided here, and every one of these cases is a hand
// movement that used to have to be tried by opening the program.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const G = require(path.join(__dirname, '..', 'src', 'js', 'dock-geometry.js'));

// Two areas side by side, as after docking the slanted view on the right:
// the map 700 wide, the 2.5D view 300, both 600 tall, and each with a strip
// of tabs 26 px deep at the top.
const MAP = { id: 'a1', rect: { x: 100, y: 50, w: 700, h: 600 },
              tabs: { x: 100, y: 50, w: 700, h: 26 } };
const ISO = { id: 'a2', rect: { x: 800, y: 50, w: 300, h: 600 },
              tabs: { x: 800, y: 50, w: 300, h: 26 } };
const BOXES = [MAP, ISO];

const at = (x, y) => ({ x, y });

test('the pointer picks the area it is actually over', () => {
  assert.equal(G.areaAt(BOXES, at(400, 300)).id, 'a1');
  assert.equal(G.areaAt(BOXES, at(900, 300)).id, 'a2');
  assert.equal(G.areaAt(BOXES, at(50, 300)), null, 'left of everything');
  assert.equal(G.areaAt(BOXES, at(400, 900)), null, 'below everything');
  assert.equal(G.areaAt(BOXES, at(NaN, 300)), null, 'a pointer that cannot be read hits nothing');
  assert.equal(G.areaAt([], at(400, 300)), null);
  assert.equal(G.areaAt(null, at(400, 300)), null);
});

test('the middle of an area means: lay it in as another tab', () => {
  const target = G.dropTargetAt(BOXES, at(450, 320), null);
  assert.deepEqual(target, { areaId: 'a1', where: 'tab' });
});

test('near an edge it means: cut this box in two', () => {
  assert.deepEqual(G.dropTargetAt(BOXES, at(120, 320), null), { areaId: 'a1', where: 'left' });
  assert.deepEqual(G.dropTargetAt(BOXES, at(780, 320), null), { areaId: 'a1', where: 'right' });
  // below the row of tabs, which reaches to y = 76, but still in the top band
  assert.deepEqual(G.dropTargetAt(BOXES, at(450, 120), null), { areaId: 'a1', where: 'top' });
  assert.deepEqual(G.dropTargetAt(BOXES, at(450, 630), null), { areaId: 'a1', where: 'bottom' });
});

test('the row of tabs is always a tab, whatever the bands would say', () => {
  // 12 px below the top edge of the map area is inside the top band, and the
  // bands alone would call it "cut it in half and put the window above".
  const bare = [{ id: MAP.id, rect: MAP.rect }, ISO];
  assert.deepEqual(G.dropTargetAt(bare, at(450, 62), null), { areaId: 'a1', where: 'top' },
    'with no row of tabs given, the band decides');
  assert.deepEqual(G.dropTargetAt(BOXES, at(450, 62), null), { areaId: 'a1', where: 'tab' },
    'over the row of tabs it is a tab - that row is what "side by side" means on screen');
});

test('a narrow area still has a middle to drop into', () => {
  // The 2.5D box is 300 wide. Bands of 220 - the number meant for the whole
  // map - would leave no middle at all and every drop would be a split.
  const middle = G.dropTargetAt(BOXES, at(950, 320), null);
  assert.deepEqual(middle, { areaId: 'a2', where: 'tab' });
  assert.deepEqual(G.dropTargetAt(BOXES, at(810, 320), null), { areaId: 'a2', where: 'left' });
});

test('the history holds a side across a shaking hand, but not across a border', () => {
  const inside = G.dropTargetAt(BOXES, at(120, 320), null);
  assert.equal(inside.where, 'left');
  // six pixels past the band, which without a history is the middle
  const bandX = G.dockBands(MAP.rect).bandX;
  const held = G.dropTargetAt(BOXES, at(MAP.rect.x + bandX + 6, 320), inside);
  assert.equal(held.where, 'left', 'a hand shaking on the edge of the band keeps the side');
  const crossed = G.dropTargetAt(BOXES, at(950, 320), inside);
  assert.deepEqual(crossed, { areaId: 'a2', where: 'tab' },
    'but in the next box the old side counts for nothing');
});

test('outside every area there is no target at all', () => {
  assert.equal(G.dropTargetAt(BOXES, at(50, 300), null), null);
  assert.equal(G.dropTargetAt(BOXES, at(1200, 300), { areaId: 'a1', where: 'left' }), null,
    'and a history cannot conjure one up');
});

// -------------------------------------------------------- what is drawn

test('the outline drawn is the half the drop really takes', () => {
  const whole = G.dropPreviewRect(BOXES, { areaId: 'a1', where: 'tab' });
  assert.deepEqual(whole, MAP.rect, 'a tab lights up the whole box');

  const left = G.dropPreviewRect(BOXES, { areaId: 'a1', where: 'left' });
  assert.deepEqual(left, { x: 100, y: 50, w: 280, h: 600 }, 'four tenths, on the left');

  const bottom = G.dropPreviewRect(BOXES, { areaId: 'a1', where: 'bottom' });
  assert.deepEqual(bottom, { x: 100, y: 50 + 360, w: 700, h: 240 });

  const narrow = G.dropPreviewRect(BOXES, { areaId: 'a2', where: 'right' });
  assert.deepEqual(narrow, { x: 800 + 180, y: 50, w: 120, h: 600 },
    'in a narrow box it is four tenths of THAT box, not the 220 px of a map-wide panel');

  assert.equal(G.dropPreviewRect(BOXES, null), null);
  assert.equal(G.dropPreviewRect(BOXES, { areaId: 'nope', where: 'left' }), null);
});

// ------------------------------------------------------- the splitters

test('a splitter turns a pointer into a share, and keeps both halves alive', () => {
  const rect = { x: 100, y: 50, w: 1000, h: 600 };
  assert.equal(G.shareFromPoint(rect, 'row', at(600, 300), 0), 0.5, 'halfway is a half');
  assert.equal(G.shareFromPoint(rect, 'row', at(350, 300), 0), 0.25);
  assert.equal(G.shareFromPoint(rect, 'col', at(600, 350), 0), 0.5, 'down the other way');

  // dragged right out of the box, with 120 px demanded for each half
  assert.equal(G.shareFromPoint(rect, 'row', at(5000, 300), 120), 1 - 0.12,
    'the far half keeps its 120 px');
  assert.equal(G.shareFromPoint(rect, 'row', at(-5000, 300), 120), 0.12,
    'and so does the near one');
});

test('a box too small for two halves is simply halved', () => {
  const tiny = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(G.shareFromPoint(tiny, 'row', at(10, 50), 120), 0.5,
    '120 px twice does not fit in 100, and pushing past the edges is worse than a half');
});

test('a splitter cannot be moved by a pointer that cannot be read', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(G.shareFromPoint(rect, 'row', at(NaN, 5), 0), null);
  assert.equal(G.shareFromPoint(rect, 'row', null, 0), null);
  assert.equal(G.shareFromPoint({ x: 0, y: 0, w: 0, h: 100 }, 'row', at(5, 5), 0), null);
});
