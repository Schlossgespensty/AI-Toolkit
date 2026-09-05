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
    tolerance: 12       // snapping reach of the splitter
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
  function zoneFromBands(rect, point, bands, pull) {
    if (!usable(rect) || !point) return null;
    const d = edgeDistances(rect, point);
    if (d.left < 0 || d.right < 0 || d.top < 0 || d.bottom < 0) return null;
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

  // Same decision, but the zone the pointer already sits in reaches further
  // than the others and counts as nearer than it is. Without this a pointer
  // resting on a border flips between two answers on every jitter of the
  // hand - on the border of a band between that side and the middle, and in
  // a corner between two sides.
  function stableZone(rect, point, previous, opt) {
    const o = options(opt);
    const bias = side => {
      if (!previous) return 0;
      return previous === side ? o.hysteresis : -o.hysteresis;
    };
    return zoneFromBands(rect, point, bandsPerSide(rect, o, bias), bias);
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
    if (!usable(rect) || !point) return 0;
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
    if (!usable(rect) || !DOCK_SIDES.includes(side) || !point) return { size: 0, snapped: false };
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

  // What a release of the dragged panel means. The only place that turns a
  // gesture into an outcome, so the view never has to decide anything.
  function dropAction(rect, point, previous, opt) {
    const o = options(opt);
    const zone = stableZone(rect, point, previous, o);
    if (zone && zone !== 'center') {
      const remembered = o.sizes && Number.isFinite(o.sizes[zone]) ? o.sizes[zone] : o.panelMin;
      return { kind: 'dock', side: zone, size: panelSize(rect, zone, remembered, o) };
    }
    if (outsideDistance(rect, point) > o.tearOff) return { kind: 'window' };
    return { kind: 'keep' };
  }

  return {
    DOCK_SIDES, DEFAULTS, dockBands, dockZoneAt, stableZone,
    panelSize, panelRectFor, dockPreviewRect, outsideDistance,
    snapTo, splitterSize, dropAction
  };
});
