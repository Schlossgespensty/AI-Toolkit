// Carrying the panel about — the two functions the free drag rests on,
// checked without a screen.
//
// dock-geometry.test.js asks whether the arithmetic is right for one point
// at a time. This file asks the question the user actually asked for: while
// the hand is moving, does the panel get out of the way at the right moment,
// and does it stay out of the way while the hand is there? That is a
// question about sequences, not about single points, so the tests here feed
// answers back in and sweep whole grids instead of naming three spots.
//
// The two promises under test:
//   dragGhostRect  — the spot the panel was grabbed by stays under the
//                    pointer, wherever the pointer goes, including off the
//                    box entirely.
//   dragVisibility — the panel is invisible exactly while a side would take
//                    the drop, and that decision never oscillates.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const G = require(path.join(__dirname, '..', 'src', 'js', 'dock-geometry.js'));

// The same box as iso-dock.test.js, and not at the origin on purpose: a box
// starting at 0,0 hides every place where a client coordinate was used as if
// it were an offset inside the box.
const BOX = { x: 100, y: 50, w: 1000, h: 600 };
const HYS = G.DEFAULTS.hysteresis;                 // 12
const BANDS = G.dockBands(BOX);                    // 220 across, 168 down

// What the panel remembers per side. Four different numbers, so a preview
// drawn for the wrong side cannot pass by accident.
const OPT = { sizes: { left: 260, right: 380, top: 300, bottom: 240 } };

// Every history the view can hand in: nothing yet, the middle, and each of
// the four sides. `previous` is the only memory in the whole gesture, so
// anything that is true has to be true for all six.
const HISTORIES = [null, 'center', 'left', 'right', 'top', 'bottom'];

const isVertical = side => side === 'left' || side === 'right';
const bandOf = side => (isVertical(side) ? BANDS.bandX : BANDS.bandY);

// A point that is `depth` pixels in from the named edge, centred on it.
function at(side, depth) {
  const midX = BOX.x + BOX.w / 2;
  const midY = BOX.y + BOX.h / 2;
  if (side === 'left') return { x: BOX.x + depth, y: midY };
  if (side === 'right') return { x: BOX.x + BOX.w - depth, y: midY };
  if (side === 'top') return { x: midX, y: BOX.y + depth };
  return { x: midX, y: BOX.y + BOX.h - depth };
}

// Walks anything the drag hands back and insists every number in it is a
// real one. A NaN in a rectangle is invisible in a screenshot — the panel
// simply stops moving — and obvious here.
function everyNumberIsReal(value, where) {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), where + ' came back as ' + value);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) everyNumberIsReal(value[key], where + '.' + key);
  }
}

// ------------------------------------------------- the spot under the hand

test('wherever the hand goes, the grabbed spot of the panel goes with it', () => {
  // The panel as it stands docked on the right of BOX, grabbed 90 px in and
  // 14 px down — a grip is near the top corner, not in the middle.
  const start = { x: BOX.x + BOX.w - 380, y: BOX.y, w: 380, h: BOX.h };
  const grab = { x: start.x + 90, y: start.y + 14 };
  const path = [
    { x: grab.x, y: grab.y },                        // has not moved yet
    { x: BOX.x + 500, y: BOX.y + 300 },              // into the middle
    { x: BOX.x + 3, y: BOX.y + 3 },                  // into the far corner
    { x: BOX.x - 400, y: BOX.y - 400 },              // off the box, up and left
    { x: BOX.x + BOX.w + 900, y: BOX.y + BOX.h + 900 } // and far off the other way
  ];
  // The panel is 600 tall, so it is carried at 360/600 of its size. The grip
  // keeps the same spot OF THE CARD under the pointer, which is that many
  // pixels in - not the 90 it was in the grid, or the card would hang
  // further and further out of the hand the smaller it is drawn.
  const scale = G.carryScale(start);
  assert.equal(scale, 0.6, 'the tall side decides');
  for (const point of path) {
    const box = G.dragGhostRect(start, grab, point);
    const where = 'at ' + point.x + ',' + point.y;
    everyNumberIsReal(box, where);
    // to the pixel, not to the last bit: 14 * 0.6 is 8.399999999999999 the
    // one way round and 8.4 the other, and no eye can tell them apart
    assert.ok(Math.abs((point.x - box.x) - (grab.x - start.x) * scale) < 1e-9,
      where + ': the grip slipped sideways');
    assert.ok(Math.abs((point.y - box.y) - (grab.y - start.y) * scale) < 1e-9,
      where + ': the grip slipped downwards');
    assert.equal(box.w, start.w * scale, where + ': the card changed width in mid-air');
    assert.equal(box.h, start.h * scale, where + ': the card changed height in mid-air');
  }
});

test('the carried card fits inside the map it is dragged across', () => {
  // The whole point of shrinking it. A panel docked to a side is as tall as
  // the map; carried at that size there is no place to put it that is not
  // half off an edge, and "drag it over the other one" is impossible however
  // steady the hand. As a card there is room to spare in both directions.
  const start = { x: BOX.x + BOX.w - 380, y: BOX.y, w: 380, h: BOX.h };
  const grab = { x: start.x + 40, y: start.y + 10 };
  assert.ok(start.h >= BOX.h, 'docked, the panel is as tall as the whole map');
  // Well inside the middle: no band reaches here, so this is a place the
  // panel is really seen at, not one it would have vanished at.
  const point = { x: BOX.x + 300, y: BOX.y + 220 };
  const view = G.dragVisibility(BOX, point, null, OPT);
  assert.equal(view.zone, 'center');
  assert.equal(view.ghost, 'visible', 'the middle takes no drop, so the card is in sight');
  const card = G.dragGhostRect(start, grab, point);
  assert.ok(card.w < BOX.w && card.h < BOX.h, 'a card, not a slab');
  assert.ok(card.x >= BOX.x && card.y >= BOX.y &&
            card.x + card.w <= BOX.x + BOX.w && card.y + card.h <= BOX.y + BOX.h,
    'and all four of its edges are over the map: ' + JSON.stringify(card));
});

test('a panel small enough already is carried at its own size', () => {
  const small = { x: 0, y: 0, w: 200, h: 100 };
  assert.equal(G.carryScale(small), 1);
  assert.equal(G.dragGhostRect(small, { x: 10, y: 10 }, { x: 500, y: 400 }).w, 200);
});

test('a step back and forth lands on exactly the same place, not near it', () => {
  // Carrying must not accumulate: the box is always the start plus the whole
  // way travelled, never the last box plus one step. Otherwise a long drag
  // drifts away from the hand.
  const start = { x: 300, y: 200, w: 380, h: 600 };
  const grab = { x: 400, y: 250 };
  const scale = G.carryScale(start);
  const there = G.dragGhostRect(start, grab, { x: 1234.5, y: 987.25 });
  const back = G.dragGhostRect(start, grab, grab);
  assert.deepEqual(back, { x: grab.x - (grab.x - start.x) * scale,
                           y: grab.y - (grab.y - start.y) * scale,
                           w: start.w * scale, h: start.h * scale, scale },
    'back at the grab point the card hangs under the pointer exactly as it did at the first pixel');
  assert.deepEqual(G.dragGhostRect(start, grab, { x: 1234.5, y: 987.25 }), there,
    'the same pointer position always means the same box');
});

// ------------------------------------------------------ where it steps aside

test('the middle of a band hides the panel, the middle of the map does not', () => {
  for (const side of G.DOCK_SIDES) {
    const view = G.dragVisibility(BOX, at(side, bandOf(side) / 2), null, OPT);
    assert.equal(view.zone, side, side + ': halfway into the band is that side');
    assert.equal(view.ghost, 'hidden', side + ': the preview under it has to be seen');
    assert.deepEqual(view.preview, G.dockPreviewRect(BOX, side, OPT.sizes[side], OPT),
      side + ': the box shown is not the panel the drop would build');
  }
  const middle = G.dragVisibility(BOX, { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 }, null, OPT);
  assert.equal(middle.zone, 'center');
  assert.equal(middle.ghost, 'visible', 'nothing would be docked here, so it is in nobody’s way');
  assert.equal(middle.preview, null);
});

test('far outside the box the panel stays in sight, on its way to a window', () => {
  const far = [
    { x: BOX.x - 200, y: BOX.y + 300 },
    { x: BOX.x + BOX.w + 200, y: BOX.y + 300 },
    { x: BOX.x + 500, y: BOX.y - 200 },
    { x: BOX.x + 500, y: BOX.y + BOX.h + 200 },
    { x: -5000, y: -5000 }
  ];
  for (const point of far) {
    for (const previous of HISTORIES) {
      const view = G.dragVisibility(BOX, point, previous, OPT);
      const where = point.x + ',' + point.y + ' after ' + previous;
      assert.equal(view.zone, null, where + ': outside the box there is no zone');
      assert.equal(view.ghost, 'visible', where + ': it has to be seen to be thrown out');
      assert.equal(view.preview, null, where);
      // however it got there, being outside is stronger than any history
      assert.equal(G.dropAction(BOX, point, previous, OPT).kind, 'window', where);
    }
  }
});

// ------------------------------------------------------------- the borders

test('every band border is hit from both directions, to half a pixel', () => {
  // Two borders per side, 24 px apart, and which of them counts depends on
  // where the hand came from. Coming in from the map it takes hold at
  // band − 12; going out again it lets go only past band + 12. That gap is
  // the hysteresis, and it is the whole reason the panel cannot blink.
  for (const side of G.DOCK_SIDES) {
    const band = bandOf(side);
    const hides = (depth, previous) => G.dragVisibility(BOX, at(side, depth), previous, OPT).ghost === 'hidden';

    // arriving from the middle of the map
    assert.equal(hides(band - HYS + 0.5, 'center'), false,
      side + ': half a pixel short of the near border it is still in sight');
    assert.equal(hides(band - HYS, 'center'), true,
      side + ': at the near border it steps aside');

    // and leaving again, from inside the very same band
    assert.equal(hides(band + HYS, side), true,
      side + ': at the far border it is still out of the way');
    assert.equal(hides(band + HYS + 0.5, side), false,
      side + ': half a pixel further it comes back');

    // without any history the plain band decides, and it lies between the two
    assert.equal(hides(band, null), true, side + ': the last pixel of the band still counts');
    assert.equal(hides(band + 0.5, null), false, side + ': half a pixel past it does not');
  }
});

test('the same point can answer two ways, and each answer stays put', () => {
  // This is the flicker case, written out: one point, six pixels past the
  // band. Coming from the map it is the map; coming from the band it is the
  // band. Both are right — what would be wrong is swinging between them
  // while the hand holds still.
  for (const side of G.DOCK_SIDES) {
    const point = at(side, bandOf(side) + 6);
    const fromOutside = G.dragVisibility(BOX, point, 'center', OPT);
    const fromInside = G.dragVisibility(BOX, point, side, OPT);
    assert.equal(fromOutside.ghost, 'visible', side + ': arriving from the map it is not a drop');
    assert.equal(fromInside.ghost, 'hidden', side + ': arriving from the band it holds the band');

    // Hold the hand still and ask again, ten times, feeding each answer back
    // in as the history — which is exactly what a stream of pointermove
    // events at one position does.
    for (const start of [fromOutside, fromInside]) {
      let now = start;
      for (let i = 0; i < 10; i++) {
        const next = G.dragVisibility(BOX, point, now.zone, OPT);
        assert.equal(next.ghost, now.ghost, side + ': the panel blinked on move ' + i);
        assert.equal(next.zone, now.zone, side + ': the zone changed its mind on move ' + i);
        assert.deepEqual(next.preview, now.preview, side + ': the preview jumped on move ' + i);
        now = next;
      }
    }
  }
});

test('nowhere on or around the box does one more move change the answer', () => {
  // The property behind "no flicker", swept rather than sampled: whatever
  // dragVisibility says, saying it again with its own answer as the history
  // has to give the same answer. A single point where that fails is a point
  // where a still hand makes the panel flash on and off.
  //
  // The grid is deliberately off-round (37 and 29) so it walks across band
  // borders and corners at odd offsets instead of landing on the round
  // numbers the code was written with.
  let checked = 0;
  for (let x = BOX.x - 150; x <= BOX.x + BOX.w + 150; x += 37) {
    for (let y = BOX.y - 150; y <= BOX.y + BOX.h + 150; y += 29) {
      const point = { x, y };
      for (const previous of HISTORIES) {
        const first = G.dragVisibility(BOX, point, previous, OPT);
        const again = G.dragVisibility(BOX, point, first.zone, OPT);
        const where = x + ',' + y + ' after ' + previous;
        assert.equal(again.zone, first.zone, where + ': the zone flipped on the second look');
        assert.equal(again.ghost, first.ghost, where + ': the panel flickered');
        assert.deepEqual(again.preview, first.preview, where + ': the preview moved');
        checked++;
      }
    }
  }
  assert.ok(checked > 5000, 'the sweep has to be a sweep: ' + checked + ' points is too few');
});

test('the panel is hidden if and only if a side would take the drop', () => {
  // The one rule the whole feature rests on. Checked against dropAction,
  // which is what actually happens on release — if these two ever disagree,
  // the user sees a preview and gets something else, or lets go over a lit
  // band with the panel still lying on top of it.
  for (let x = BOX.x - 80; x <= BOX.x + BOX.w + 80; x += 43) {
    for (let y = BOX.y - 80; y <= BOX.y + BOX.h + 80; y += 31) {
      const point = { x, y };
      for (const previous of HISTORIES) {
        const view = G.dragVisibility(BOX, point, previous, OPT);
        const drop = G.dropAction(BOX, point, previous, OPT);
        const where = x + ',' + y + ' after ' + previous;
        assert.equal(view.ghost === 'hidden', view.preview !== null,
          where + ': hidden and "there is a preview" have to mean the same thing');
        if (drop.kind === 'dock') {
          assert.equal(view.ghost, 'hidden', where + ': it would dock, but the panel is in the way');
          assert.equal(view.zone, drop.side, where + ': aiming and dropping disagree');
          assert.deepEqual(view.preview, G.panelRectFor(BOX, drop.side, drop.size, OPT),
            where + ': the box drawn is not the panel that would be built');
        } else {
          assert.equal(view.ghost, 'visible', where + ': nothing would dock, so nothing may hide');
          assert.equal(view.preview, null, where);
        }
      }
    }
  }
});

test('the outer edge of the box holds the side that is already chosen', () => {
  // The third border that shares the one number. The inner edge of a band
  // and the corner between two sides were already tested; this is the edge
  // of the map itself, which had no hysteresis at all. Without it a hand
  // resting on the very edge of the window swings between "docks left" and
  // "nothing", and the carried panel blinks with it.
  for (const side of G.DOCK_SIDES) {
    const held = G.dragVisibility(BOX, at(side, -HYS), side, OPT);
    assert.equal(held.zone, side, side + ': twelve px outside it still holds on');
    assert.equal(held.ghost, 'hidden', side + ': so the preview underneath stays too');

    const gone = G.dragVisibility(BOX, at(side, -HYS - 0.5), side, OPT);
    assert.equal(gone.zone, null, side + ': half a pixel further it lets go');
    assert.equal(gone.ghost, 'visible', side);

    // and only the side that is holding gets it: outside is outside for
    // every other history, or a pointer beside the map could be caught by a
    // band it never entered
    for (const previous of HISTORIES.filter(p => p !== side)) {
      assert.equal(G.dragVisibility(BOX, at(side, -1), previous, OPT).zone, null,
        side + ': one px outside after ' + previous + ' is outside');
    }
  }
});

// ------------------------------------------------ the spot it was grabbed by

test('a grab in a corner belongs to both of its bands, not to the nearer one', () => {
  // The grip sits a dozen pixels in from the panel's top left corner, and a
  // corner is inside two bands at once. Asking which of the two wins would
  // arm the drag on the four pixels between them — which is precisely the
  // movement that must not count as aiming at anything.
  const corner = { x: BOX.x + 12, y: BOX.y + 12 };
  assert.deepEqual(G.homeSides(BOX, corner), ['left', 'top']);
  assert.equal(G.dockZoneAt(BOX, corner), 'left', 'and one of the two does win, on a tie');

  const opt = Object.assign({ from: corner }, OPT);
  // six px right and four down: a different winner, still the same corner
  const nudged = { x: corner.x + 6, y: corner.y + 4 };
  assert.equal(G.dockZoneAt(BOX, nudged), 'top', 'the winner really does change');
  assert.equal(G.dragVisibility(BOX, nudged, null, opt).armed, false, 'but the drag has not been aimed');
  assert.equal(G.dragVisibility(BOX, nudged, null, opt).ghost, 'visible');

  // a grab in the middle of the map is in no band, so it is armed at once
  assert.deepEqual(G.homeSides(BOX, { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 }), []);
  assert.deepEqual(G.homeSides(BOX, { x: BOX.x - 40, y: BOX.y + 300 }), [],
    'and one outside the box holds nothing back either');
});

test('the bands the panel was grabbed in have to be left before they count', () => {
  // `from` is the grab point; the bands around it are worth nothing until
  // the hand has been somewhere else - otherwise the panel disappears on the
  // first pixel of every drag and a wiggle docks it.
  for (const side of G.DOCK_SIDES) {
    const grabbed = at(side, 12);
    const opt = Object.assign({ from: grabbed }, OPT);

    const held = G.dragVisibility(BOX, grabbed, null, opt);
    assert.equal(held.zone, side, side + ': the zone is still named');
    assert.equal(held.armed, false, side + ': but nothing has been aimed at yet');
    assert.equal(held.ghost, 'visible', side + ': so the panel stays under the hand');
    assert.equal(held.preview, null, side + ': and nothing is offered');
    assert.deepEqual(held.drop, { kind: 'keep' }, side + ': a release here changes nothing');

    // going somewhere else arms it ...
    const away = G.dragVisibility(BOX, { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 }, held.zone, opt);
    assert.equal(away.armed, true, side + ': the hand went elsewhere');

    // ... for good, or the side it was grabbed in could never be aimed at
    const back = G.dragVisibility(BOX, grabbed, away.zone, Object.assign({ armed: true }, opt));
    assert.equal(back.armed, true, side + ': it must not disarm itself on the way back');
    assert.equal(back.ghost, 'hidden', side + ': and now it answers like any other side');
    assert.equal(back.drop.kind, 'dock', side);
    assert.equal(back.drop.side, side, side);
  }

  // a drag that never said where it was grabbed was armed from the start
  assert.equal(G.dragVisibility(BOX, at('left', 12), null, OPT).armed, true);
});

// --------------------------------------------------- boxes that are not boxes

test('a box without width or height carries nothing and offers nothing', () => {
  const broken = [
    { x: 100, y: 50, w: 0, h: 600 },
    { x: 100, y: 50, w: 1000, h: 0 },
    { x: 100, y: 50, w: 0, h: 0 },
    { x: 100, y: 50, w: -1000, h: 600 },
    { x: 100, y: 50, w: 1000, h: -600 },
    { x: 100, y: 50, w: NaN, h: 600 },
    { x: 100, y: 50, w: 1000, h: Infinity },
    null,
    undefined
  ];
  const point = { x: 120, y: 300 };
  for (const rect of broken) {
    const label = JSON.stringify(rect);
    const view = G.dragVisibility(rect, point, 'left', OPT);
    assert.equal(view.zone, null, label + ': nothing can be aimed at');
    assert.equal(view.ghost, 'visible', label + ': and nothing may be hidden behind it');
    assert.equal(view.preview, null, label);
    everyNumberIsReal(view, label);
    assert.equal(G.dropAction(rect, point, 'left', OPT).kind, 'keep',
      label + ': a box that is not there must not swallow the panel');
    // and the panel is not carried into a box of that shape either
    assert.equal(G.dragGhostRect(rect, point, { x: 500, y: 500 }), null, label);
  }
});

test('a panel of no size is never lifted, whatever the pointer does', () => {
  for (const start of [{ x: 0, y: 0, w: 0, h: 300 }, { x: 0, y: 0, w: 380, h: 0 },
                       { x: 0, y: 0, w: NaN, h: 300 }, null, undefined]) {
    assert.equal(G.dragGhostRect(start, { x: 10, y: 10 }, { x: 900, y: 900 }), null,
      JSON.stringify(start) + ': there is nothing to pin to the screen');
  }
});

test('a pointer with no readable position never docks anything', () => {
  // Belongs next to the degenerate boxes because it fails the same way and
  // is far nastier: NaN slips through every comparison unnoticed, so before
  // the guard in dock-geometry.js an unreadable pointer looked like a hit on
  // every band at once and was handed to the first side in the list. The
  // panel would have frozen — dragGhostRect refuses such a point — while the
  // left band lit up, and letting go would have docked it there.
  const nonsense = [{ x: NaN, y: 300 }, { x: 500, y: NaN }, { x: NaN, y: NaN },
                    { x: undefined, y: 300 }, {}, null, undefined];
  for (const point of nonsense) {
    const label = JSON.stringify(point);
    const view = G.dragVisibility(BOX, point, 'left', OPT);
    assert.equal(view.zone, null, label + ': an unreadable pointer is not aimed anywhere');
    assert.equal(view.ghost, 'visible', label + ': and it must not hide the panel');
    assert.equal(view.preview, null, label);
    assert.equal(G.dropAction(BOX, point, 'left', OPT).kind, 'keep',
      label + ': letting go with no position changes nothing');
    // the two halves of one move have to agree: neither of them acts on it
    assert.equal(G.dragGhostRect({ x: 0, y: 0, w: 380, h: 600 }, { x: 10, y: 10 }, point), null, label);
    assert.equal(G.outsideDistance(BOX, point), 0, label + ': and no distance is invented');
  }
});

test('the drag hands out no NaN, whatever it is asked', () => {
  const boxes = [BOX, { x: 0, y: 0, w: 3, h: 3 }, { x: -400, y: -400, w: 60, h: 4000 },
                 { x: 0.5, y: 0.5, w: 1.5, h: 1.5 }];
  const points = [{ x: 0, y: 0 }, { x: BOX.x, y: BOX.y }, { x: 1e6, y: -1e6 },
                  { x: 0.1, y: 0.2 }, { x: -0.5, y: 4000 }];
  for (const rect of boxes) {
    for (const point of points) {
      for (const previous of HISTORIES) {
        const where = JSON.stringify(rect) + ' at ' + point.x + ',' + point.y;
        everyNumberIsReal(G.dragVisibility(rect, point, previous, OPT), where + ' view');
        everyNumberIsReal(G.dragGhostRect(rect, { x: rect.x, y: rect.y }, point), where + ' carried');
        everyNumberIsReal(G.dropAction(rect, point, previous, OPT), where + ' drop');
      }
    }
  }
});

test('a size the store lost or spoiled becomes the minimum, never NaN', () => {
  // `sizes` comes out of localStorage, where anything can be sitting.
  const spoiled = { sizes: { left: NaN, right: null, top: 'wide', bottom: Infinity } };
  for (const side of G.DOCK_SIDES) {
    const view = G.dragVisibility(BOX, at(side, 5), null, spoiled);
    assert.equal(view.zone, side);
    everyNumberIsReal(view, side);
    assert.deepEqual(view.preview, G.dockPreviewRect(BOX, side, G.DEFAULTS.panelMin, spoiled),
      side + ': a spoiled size has to fall back to the smallest panel');
  }
  const none = G.dragVisibility(BOX, at('top', 5), null, {});
  assert.deepEqual(none.preview, G.dockPreviewRect(BOX, 'top', G.DEFAULTS.panelMin));
});

// -------------------------------------------------------------- a whole drag

test('one long drag: out of the grid, across the map, hidden and back', () => {
  // The gesture end to end, the way the view runs it: the history is always
  // the answer the move before gave. Nothing here may need a screen.
  const start = { x: BOX.x + BOX.w - 380, y: BOX.y, w: 380, h: BOX.h };
  const grab = { x: start.x + 40, y: start.y + 10 };
  const steps = [
    [{ x: BOX.x + 700, y: BOX.y + 300 }, 'visible', 'center'],
    [{ x: BOX.x + 340, y: BOX.y + 300 }, 'visible', 'center'],
    [{ x: BOX.x + 10, y: BOX.y + 300 }, 'hidden', 'left'],
    [{ x: BOX.x + BANDS.bandX + 6, y: BOX.y + 300 }, 'hidden', 'left'],   // held by hysteresis
    [{ x: BOX.x + BANDS.bandX + 13, y: BOX.y + 300 }, 'visible', 'center'], // and let go
    [{ x: BOX.x + 500, y: BOX.y + 5 }, 'hidden', 'top'],
    [{ x: BOX.x - 300, y: BOX.y + 300 }, 'visible', null]                  // off the box
  ];
  let previous = null;
  for (const [point, ghost, zone] of steps) {
    const view = G.dragVisibility(BOX, point, previous, OPT);
    const where = point.x + ',' + point.y;
    assert.equal(view.zone, zone, where + ': wrong zone');
    assert.equal(view.ghost, ghost, where + ': wrong visibility');
    const carried = G.dragGhostRect(start, grab, point);
    assert.equal(point.x - carried.x, (grab.x - start.x) * carried.scale, where + ': the panel lost the hand');
    assert.equal(carried.w, start.w * G.carryScale(start), where + ': and it must not change size on the way');
    previous = view.zone;
  }
  // let go out there: a window, and only because the last step was far enough
  assert.deepEqual(G.dropAction(BOX, { x: BOX.x - 300, y: BOX.y + 300 }, previous, OPT), { kind: 'window' });
});
