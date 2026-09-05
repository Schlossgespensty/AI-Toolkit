// Docking arithmetic — pure functions, no DOM, no canvas.
// Kept separate from dock-view.js so it can be tested with node --test.
//
// Every rectangle is {x, y, w, h} and every point is {x, y}, both in client
// coordinates (what getBoundingClientRect and event.clientX give). Mixing
// the two systems was the one mistake worth designing away: the same numbers
// that decide the drop also size the visible bands, so what the user sees is
// what gets computed.
//
// Two option names look alike and are not: `bandMin` is how narrow a drop
// band may get, `panelMin` is how narrow the docked panel may get. The plan
// called both of them `min`; one object carries both, so they need two names.

(function exposeDockGeometry(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.dockGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Also the order that breaks a tie, so an exact corner always lands on the
  // same side instead of flickering between two equally close ones.
  const DOCK_SIDES = ['left', 'right', 'top', 'bottom'];

  const DEFAULTS = {
    share: 0.28,        // band width as a share of the box
    bandMin: 56,        // ... but never thinner than this
    bandMax: 220,       // ... and never wider than this
    maxShare: 0.45,     // hard ceiling for band and panel: the map keeps the rest
    hysteresis: 12,     // how much the active zone's band grows while dragging
    panelMin: 220,
    tearOff: 48,        // drop this far outside the box and it becomes a window
    tolerance: 12,      // snapping reach of the splitter
    carryMax: 360       // longest side of the panel while it is being carried
  };

  // Extras the caller adds (`sizes`, `remembered`) are carried through; only
  // the known numbers are repaired, so a stray null cannot poison the maths.
  function options(opt) {
    if (!opt) return DEFAULTS;
    const out = Object.assign({}, DEFAULTS, opt);
    for (const key of Object.keys(DEFAULTS)) {
      if (!Number.isFinite(out[key])) out[key] = DEFAULTS[key];
    }
    return out;
  }

  function usable(rect) {
    return Boolean(rect) && Number.isFinite(rect.w) && Number.isFinite(rect.h) &&
           rect.w > 0 && rect.h > 0;
  }

  // A point counts only when both of its numbers are real. NaN is the one
  // value that walks through every comparison unnoticed: `NaN > band` is
  // false, so an unreadable pointer would look like a hit on every band and
  // be handed to whichever side is checked first. dragGhostRect already
  // turns such a point down, so without this one guard the same move would
  // leave the carried panel standing still and light up a drop zone at the
  // same time - and letting go would dock.
  function readable(point) {
    return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  function clamp(value, low, high) { return Math.min(Math.max(value, low), high); }

  const isVertical = side => side === 'left' || side === 'right';

  // How deep the four drop bands reach into the box. A degenerate box has no
  // bands at all, which is what keeps every other function free of NaN.
  function dockBands(rect, opt) {
    if (!usable(rect)) return { bandX: 0, bandY: 0 };
    const o = options(opt);
    return {
      bandX: Math.min(clamp(rect.w * o.share, o.bandMin, o.bandMax), rect.w * o.maxShare),
      bandY: Math.min(clamp(rect.h * o.share, o.bandMin, o.bandMax), rect.h * o.maxShare)
    };
  }

  function edgeDistances(rect, point) {
    return {
      left: point.x - rect.x,
      right: rect.x + rect.w - point.x,
      top: point.y - rect.y,
      bottom: rect.y + rect.h - point.y
    };
  }

  // The one decision: closest edge wins if the pointer is inside its band.
  // `bands` carries a reach per side so hysteresis can bend a single one, and
  // `pull` shortens the way to a side by the same amount. Both are needed:
  // the reach decides whether a side is in the running at all (side against
  // middle), the pull decides which of two sides in the running wins (side
  // against side). With the reach alone a pointer in a corner would sit
  // inside two bands and be handed to whichever raw edge is a hair closer -
  // that is, it would flicker on the least movement of the hand.
  // `slack` is the third of the trio: how far past the outer edge of the box
  // a side may still be held. Without it the outside of the box is the one
  // border of the whole gesture with no hysteresis at all - a hand shaking
  // two pixels across it switches between "docks left" and "nothing", and
  // the carried panel blinks on and off with the answer. Only the side that
  // is already chosen gets any, and it gets exactly as much as its band
  // reaches further in, so the panel cannot be held by a side the pointer
  // has left the box beside.
  function zoneFromBands(rect, point, bands, pull, slack) {
    if (!usable(rect) || !readable(point)) return null;
    const d = edgeDistances(rect, point);
    for (const side of DOCK_SIDES) {
      if (d[side] < -(slack ? slack(side) : 0)) return null;
    }
    const reachOf = side => d[side] - (pull ? pull(side) : 0);
    let best = null;
    for (const side of DOCK_SIDES) {
      if (!(bands[side] > 0) || d[side] > bands[side]) continue;
      // strict <: ties keep DOCK_SIDES order
      if (best === null || reachOf(side) < reachOf(best)) best = side;
    }
    return best || 'center';
  }

  function bandsPerSide(rect, opt, bias) {
    const { bandX, bandY } = dockBands(rect, opt);
    const of = side => (isVertical(side) ? bandX : bandY) + (bias ? bias(side) : 0);
    return { left: of('left'), right: of('right'), top: of('top'), bottom: of('bottom') };
  }

  function dockZoneAt(rect, point, opt) {
    return zoneFromBands(rect, point, bandsPerSide(rect, opt));
  }

  // Every band the given point already lies in - not the one that would win,
  // all of them. Used for the spot the panel was grabbed by: the grip sits a
  // dozen pixels from the panel's own corner, and a corner belongs to two
  // bands at once. Asking for the winning zone alone would arm the drag on
  // the four pixels between those two, which is exactly the movement that
  // must not count as aiming.
  function homeSides(rect, from, opt) {
    if (!usable(rect) || !readable(from)) return [];
    const bands = bandsPerSide(rect, options(opt));
    const d = edgeDistances(rect, from);
    return DOCK_SIDES.filter(side => bands[side] > 0 && d[side] >= 0 && d[side] <= bands[side]);
  }

  // Same decision, but the zone the pointer already sits in reaches further
  // than the others and counts as nearer than it is. Without this a pointer
  // resting on a border flips between two answers on every jitter of the
  // hand - on the border of a band between that side and the middle, in a
  // corner between two sides, and on the outer edge of the box between one
  // side and nothing at all. One number, three borders: the chosen side's
  // band grows by it, its distance shrinks by it, and the box itself gives
  // way by it - but only for that side.
  function stableZone(rect, point, previous, opt) {
    const o = options(opt);
    const bias = side => {
      if (!previous) return 0;
      return previous === side ? o.hysteresis : -o.hysteresis;
    };
    const slack = side => Math.max(bias(side), 0);
    return zoneFromBands(rect, point, bandsPerSide(rect, o, bias), bias, slack);
  }

  // The panel never grows past maxShare even when the remembered size is
  // bigger: the upper bound wins over panelMin, so the map cannot be squeezed
  // out of existence in a narrow window.
  function panelSize(rect, side, size, opt) {
    if (!usable(rect) || !DOCK_SIDES.includes(side)) return 0;
    const o = options(opt);
    const extent = isVertical(side) ? rect.w : rect.h;
    const wanted = Number.isFinite(size) ? size : o.panelMin;
    return Math.min(Math.max(wanted, o.panelMin), extent * o.maxShare);
  }

  function panelRectFor(rect, side, size, opt) {
    if (!usable(rect) || !DOCK_SIDES.includes(side)) return null;
    const s = panelSize(rect, side, size, opt);
    if (side === 'left') return { x: rect.x, y: rect.y, w: s, h: rect.h };
    if (side === 'right') return { x: rect.x + rect.w - s, y: rect.y, w: s, h: rect.h };
    if (side === 'top') return { x: rect.x, y: rect.y, w: rect.w, h: s };
    return { x: rect.x, y: rect.y + rect.h - s, w: rect.w, h: s };
  }

  function dockPreviewRect(rect, zone, size, opt) {
    if (!DOCK_SIDES.includes(zone)) return null;
    return panelRectFor(rect, zone, size, opt);
  }

  function outsideDistance(rect, point) {
    if (!usable(rect) || !readable(point)) return 0;
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
    const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
    return Math.hypot(dx, dy);
  }

  function nearestTarget(value, targets, tolerance) {
    let hit = null;
    let best = tolerance;
    for (const target of targets || []) {
      if (!Number.isFinite(target)) continue;
      const distance = Math.abs(value - target);
      if (distance <= best) { best = distance; hit = target; }
    }
    return hit;
  }

  function snapTo(value, targets, tolerance) {
    const hit = nearestTarget(value, targets, tolerance);
    return hit === null ? value : hit;
  }

  // Pointer position -> panel size. Clamped first so a snap target outside
  // the allowed range cannot drag the panel past its bounds, and clamped
  // again after the snap so `snapped` never lies about where the edge ended.
  function splitterSize(side, rect, point, opt) {
    if (!usable(rect) || !DOCK_SIDES.includes(side) || !readable(point)) return { size: 0, snapped: false };
    const o = options(opt);
    const vertical = isVertical(side);
    const extent = vertical ? rect.w : rect.h;
    const raw = side === 'left' ? point.x - rect.x
              : side === 'right' ? rect.x + rect.w - point.x
              : side === 'top' ? point.y - rect.y
              : rect.y + rect.h - point.y;
    const clamped = panelSize(rect, side, raw, o);
    const targets = [extent / 4, extent / 3, extent / 2];
    if (Number.isFinite(o.remembered)) targets.push(o.remembered);
    const hit = nearestTarget(clamped, targets, o.tolerance);
    const size = panelSize(rect, side, hit === null ? clamped : hit, o);
    return { size, snapped: hit !== null && size === hit };
  }

  // How much smaller the panel is drawn while it is carried. A panel docked
  // to a side is as tall as the whole map (or, top and bottom, as wide), so
  // at full size it can never be over the map: one edge always hangs off,
  // whatever the hand does. Shrunk to a card it fits, and the whole gesture
  // - pick up, carry across, let go - is one the user can see from start to
  // end. One number for the whole drag, worked out from the size the panel
  // had in the grid, so the card does not change size in mid-air.
  function carryScale(start, opt) {
    if (!usable(start)) return 1;
    const o = options(opt);
    const longest = Math.max(start.w, start.h);
    if (!(o.carryMax > 0) || !(longest > o.carryMax)) return 1;
    return o.carryMax / longest;
  }

  // Where the floating panel sits while it is being carried, and how big it
  // is drawn: the box it started in, shrunk to a card, put so that the spot
  // the user grabbed stays under the pointer for the whole drag - the same
  // spot of the card, not the same number of pixels, or the card would drift
  // out from under the hand the smaller it is.
  // Nothing here clamps it - the panel is allowed off the box and off the
  // map, because "let go outside" is a gesture of its own (see dropAction).
  function dragGhostRect(start, from, point, opt) {
    if (!usable(start) || !readable(from) || !readable(point)) return null;
    const scale = carryScale(start, opt);
    const x = point.x - (from.x - start.x) * scale;
    const y = point.y - (from.y - start.y) * scale;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, w: start.w * scale, h: start.h * scale, scale };
  }

  // The whole picture of one moment of the drag: which side is being aimed
  // at, the box the preview should draw, what a release would do, and
  // whether the carried panel is in the way. It hides itself exactly when a
  // side would take the drop - that is the moment the user needs to see the
  // map and the preview under it, and the moment the panel is a lid over
  // both.
  //
  // The visibility rides on stableZone rather than on a rule of its own, so
  // a hand shaking on a band edge cannot make the panel blink: the zone that
  // is already chosen keeps its extra reach, and the panel follows the zone.
  // A second, differently sized rule here would be a second border to wobble
  // across, which is precisely the flicker this avoids.
  //
  // `from` and `armed` are the drag's memory of where it started. The grip
  // sits a dozen pixels from the panel's own corner, so on a docked panel
  // the grab point is already inside a band - two of them, in a corner -
  // before the hand has gone anywhere. Without this the panel would vanish
  // and a side would light up on the very first pixel of every drag, and a
  // wiggle and a release would dock it where nobody aimed. So the bands the
  // panel was grabbed in count for nothing until the pointer has left them
  // once; after that the drag stays armed, or the side it was grabbed in
  // could never be aimed at at all.
  function dragVisibility(rect, point, previous, opt) {
    const o = options(opt);
    const zone = stableZone(rect, point, previous, o);
    const armed = o.armed === true || !homeSides(rect, o.from, o).includes(zone);
    const remembered = o.sizes && Number.isFinite(o.sizes[zone]) ? o.sizes[zone] : o.panelMin;
    // Same call as the preview the view draws and the size the drop uses, so
    // "the panel got out of the way", "a side is being aimed at" and "this
    // is what letting go does" can never come apart.
    const preview = armed ? dockPreviewRect(rect, zone, remembered, o) : null;
    const drop = preview ? { kind: 'dock', side: zone, size: panelSize(rect, zone, remembered, o) }
               : armed && outsideDistance(rect, point) > o.tearOff ? { kind: 'window' }
               : { kind: 'keep' };
    return { ghost: preview ? 'hidden' : 'visible', zone, preview, drop, armed };
  }

  // What a release of the dragged panel means. One question, one answer:
  // this is the same value the moment before the release already carried, so
  // the words on screen and the outcome cannot promise different things.
  function dropAction(rect, point, previous, opt) {
    return dragVisibility(rect, point, previous, opt).drop;
  }

  return {
    DOCK_SIDES, DEFAULTS, dockBands, dockZoneAt, stableZone, homeSides,
    panelSize, panelRectFor, dockPreviewRect, outsideDistance,
    snapTo, splitterSize, carryScale, dragGhostRect, dragVisibility, dropAction
  };
});
