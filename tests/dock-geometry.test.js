// Tests for the docking arithmetic. No screen, no DOM — plain numbers.
//
// The values are deliberately extreme: a box that is not at the origin, a box
// too narrow for a band, a zero box, points exactly on a border. Middle
// values would pass with almost any implementation and prove nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const G = require(path.join(__dirname, '..', 'src', 'js', 'dock-geometry.js'));

// A box that is NOT at the origin: the whole point of client coordinates.
const BOX = { x: 400, y: 100, w: 900, h: 500 };

test('the box is measured where it is, not where the screen starts', () => {
  const nearLeftEdge = { x: 405, y: 350 };
  assert.equal(G.dockZoneAt(BOX, nearLeftEdge, null), 'left');
  // the very same screen point against a box at the origin is outside it
  assert.equal(G.dockZoneAt({ x: 0, y: 0, w: 200, h: 200 }, nearLeftEdge, null), null);
});

test('bands grow with the box but stop at the ceiling', () => {
  assert.equal(G.dockBands({ x: 0, y: 0, w: 3000, h: 3000 }).bandX, 220);
  // 100 wide: 28% is below the floor of 56, but 45% of the box is less still
  assert.equal(G.dockBands({ x: 0, y: 0, w: 100, h: 100 }).bandX, 45);
});

test('a narrow box keeps a middle — otherwise there is nowhere to say no', () => {
  const narrow = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(G.dockZoneAt(narrow, { x: 50, y: 50 }, null), 'center');
});

test('a box without width or height has no zones and no NaN', () => {
  for (const rect of [{ x: 0, y: 0, w: 0, h: 500 }, { x: 0, y: 0, w: 900, h: 0 }]) {
    assert.deepEqual(G.dockBands(rect), { bandX: 0, bandY: 0 });
    assert.equal(G.dockZoneAt(rect, { x: 0, y: 0 }, null), null);
    assert.equal(G.panelRectFor(rect, 'right', 380), null);
    assert.equal(G.dropAction(rect, { x: 0, y: 0 }, null).kind, 'keep');
    const { size } = G.splitterSize('right', rect, { x: 10, y: 10 });
    assert.ok(Number.isFinite(size), 'no NaN escapes a degenerate box');
  }
});

test('each edge, the middle, and the four corners land where they should', () => {
  const mid = { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 };
  assert.equal(G.dockZoneAt(BOX, mid, null), 'center');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + 5, y: mid.y }, null), 'left');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w - 5, y: mid.y }, null), 'right');
  assert.equal(G.dockZoneAt(BOX, { x: mid.x, y: BOX.y + 5 }, null), 'top');
  assert.equal(G.dockZoneAt(BOX, { x: mid.x, y: BOX.y + BOX.h - 5 }, null), 'bottom');
  // in a corner the nearer edge wins
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + 5, y: BOX.y + 30 }, null), 'left');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + 30, y: BOX.y + 5 }, null), 'top');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w - 5, y: BOX.y + BOX.h - 30 }, null), 'right');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + 30, y: BOX.y + BOX.h - 5 }, null), 'bottom');
});

test('an exact tie always falls the same way', () => {
  const corner = { x: BOX.x + 7, y: BOX.y + 7 };          // left and top equally close
  assert.equal(G.dockZoneAt(BOX, corner, null), 'left');
  assert.equal(G.DOCK_SIDES[0], 'left', 'the order of DOCK_SIDES is the tie-breaker');
});

test('outside the box there is no zone at all', () => {
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x - 1, y: BOX.y + 10 }, null), null);
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w + 1, y: BOX.y + 10 }, null), null);
});

test('hysteresis holds the border in both directions', () => {
  const band = G.dockBands(BOX).bandX;
  const onTheBorder = { x: BOX.x + band, y: BOX.y + BOX.h / 2 };
  assert.equal(G.stableZone(BOX, onTheBorder, 'left', null), 'left', 'stays docked');
  assert.equal(G.stableZone(BOX, onTheBorder, 'center', null), 'center', 'stays free');
  assert.equal(G.dockZoneAt(BOX, onTheBorder, null), 'left', 'without a history the band decides');
});

test('what the preview shows is what the drop would hit', () => {
  const preview = G.dockPreviewRect(BOX, 'right', 380);
  const middleOfPreview = { x: preview.x + preview.w / 2, y: preview.y + preview.h / 2 };
  assert.equal(G.dockZoneAt(BOX, middleOfPreview, null), 'right');
  assert.equal(G.dockPreviewRect(BOX, 'center', 380), null);
  assert.equal(G.dockPreviewRect(BOX, null, 380), null);
});

test('the panel never eats the map, and never vanishes', () => {
  const tooBig = G.panelRectFor(BOX, 'right', 5000);
  assert.equal(tooBig.w, BOX.w * 0.45);
  assert.equal(tooBig.x, BOX.x + BOX.w - BOX.w * 0.45);
  assert.equal(G.panelRectFor(BOX, 'right', -5).w, 220, 'a negative size becomes the minimum');
  // in a box narrower than the minimum the ceiling wins, or the map is gone
  assert.equal(G.panelRectFor({ x: 0, y: 0, w: 200, h: 200 }, 'left', 380).w, 90);
});

test('panels are placed on the side they belong to', () => {
  assert.deepEqual(G.panelRectFor(BOX, 'left', 300), { x: 400, y: 100, w: 300, h: 500 });
  // 300 tall would be more than 45% of a 500 tall box, so the ceiling cuts it
  assert.deepEqual(G.panelRectFor(BOX, 'top', 300), { x: 400, y: 100, w: 900, h: 225 });
  assert.deepEqual(G.panelRectFor(BOX, 'bottom', 225), { x: 400, y: 375, w: 900, h: 225 });
});

test('distance outside the box is zero inside and real outside', () => {
  assert.equal(G.outsideDistance(BOX, { x: BOX.x + 10, y: BOX.y + 10 }), 0);
  assert.equal(G.outsideDistance(BOX, { x: BOX.x - 30, y: BOX.y + 10 }), 30);
  assert.equal(G.outsideDistance(BOX, { x: BOX.x - 30, y: BOX.y - 40 }), 50);
});

test('the splitter clamps below and above, with snapping switched off', () => {
  // tolerance 0 so nothing but the clamp can move the number
  const hard = { tolerance: 0 };
  const low = G.splitterSize('right', BOX, { x: BOX.x + BOX.w - 5, y: 300 }, hard);
  assert.equal(low.size, 220, 'never thinner than the minimum');
  assert.equal(low.snapped, false);
  const high = G.splitterSize('right', BOX, { x: BOX.x + 5, y: 300 }, hard);
  assert.equal(high.size, BOX.w * 0.45, 'never wider than the ceiling');
  // dragged far past the ceiling and then offered a snap target beyond it:
  // the size still has to stay inside the box
  const beyond = G.splitterSize('right', BOX, { x: BOX.x + 5, y: 300 }, { remembered: 800 });
  assert.ok(beyond.size <= BOX.w * 0.45, 'a snap target outside the range cannot win');
  assert.equal(beyond.snapped, false, 'and it must not claim it snapped');
});

test('the splitter snaps to the quarter and lets go 13 px away', () => {
  const quarter = G.splitterSize('right', BOX, { x: BOX.x + BOX.w - BOX.w / 4, y: 300 });
  assert.equal(quarter.size, BOX.w / 4);
  assert.equal(quarter.snapped, true);
  // 13 px away is one more than the reach of 12
  const beside = G.splitterSize('right', BOX, { x: BOX.x + BOX.w - BOX.w / 4 - 13, y: 300 });
  assert.equal(beside.snapped, false);
  assert.equal(beside.size, BOX.w / 4 + 13);
});

test('the splitter also snaps to the size the user last chose', () => {
  const near = G.splitterSize('right', BOX, { x: BOX.x + BOX.w - 372, y: 300 }, { remembered: 380 });
  assert.equal(near.size, 380);
  assert.equal(near.snapped, true);
});

test('snapTo leaves a value alone when nothing is near', () => {
  assert.equal(G.snapTo(300, [100, 500], 12), 300);
  assert.equal(G.snapTo(295, [100, 300], 12), 300);
  assert.equal(G.snapTo(300, [], 12), 300);
});

test('the drop decides: dock, keep, or tear off into a window', () => {
  const opt = { sizes: { right: 380, left: 260, top: 300, bottom: 300 } };
  const onEdge = G.dropAction(BOX, { x: BOX.x + BOX.w - 5, y: 300 }, null, opt);
  assert.deepEqual(onEdge, { kind: 'dock', side: 'right', size: 380 });

  const inTheMiddle = G.dropAction(BOX, { x: BOX.x + BOX.w / 2, y: 300 }, 'center', opt);
  assert.deepEqual(inTheMiddle, { kind: 'keep' });

  // just beside the box is a slip of the hand, not a wish for a window
  assert.deepEqual(G.dropAction(BOX, { x: BOX.x - 10, y: 300 }, null, opt), { kind: 'keep' });
  assert.deepEqual(G.dropAction(BOX, { x: BOX.x - 60, y: 300 }, null, opt), { kind: 'window' });
});

test('a drop remembers a size per side, clamped to the box', () => {
  const opt = { sizes: { top: 9000 } };
  const action = G.dropAction(BOX, { x: 800, y: BOX.y + 5 }, null, opt);
  assert.equal(action.side, 'top');
  assert.equal(action.size, BOX.h * 0.45, 'the remembered size is clamped, not taken on trust');
});

test('hysteresis holds a corner between two sides, and still lets go', () => {
  // In a corner the pointer is inside two bands at once. Deciding by the raw
  // distance alone means the two sides swap places whenever the hand shakes
  // by a pixel, so the side that is already chosen counts as 12 px nearer
  // than it is - the same 12 px that widens its band.
  const near = { x: BOX.x + 60, y: BOX.y + 50 };        // 60 from the left, 50 from the top
  assert.equal(G.dockZoneAt(BOX, near, null), 'top', 'without a history the nearer edge wins');
  assert.equal(G.stableZone(BOX, near, 'left', null), 'left', 'coming from the left it stays left');
  assert.equal(G.stableZone(BOX, near, 'top', null), 'top', 'and coming from the top it stays top');
  // 12 px of lead each way, so a real move of more than 24 px changes it
  const further = { x: BOX.x + 60, y: BOX.y + 20 };
  assert.equal(G.stableZone(BOX, further, 'left', null), 'top', 'moving 30 px towards the top does switch');
});
