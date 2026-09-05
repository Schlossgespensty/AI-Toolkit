// Where the 2.5D view lives, as plain data — no DOM, no localStorage.
// Kept separate from dock-view.js so it can be tested with node --test.
//
// Nothing here changes the object it is given; every function hands back a
// new one. That is what makes "cancel the drag" a single assignment instead
// of a list of undo steps.

(function exposeDockModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.dockModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const VERSION = 1;
  const SIDES = ['left', 'right', 'top', 'bottom'];
  const MODES = ['off', 'dock', 'window'];
  const DEFAULT_SIZE = { left: 380, right: 380, top: 300, bottom: 300 };
  const SIZE_MIN = 120;
  const SIZE_MAX = 4000;

  function defaultState() {
    return {
      v: VERSION,
      mode: 'off',
      side: 'right',
      size: Object.assign({}, DEFAULT_SIZE),
      lastMode: 'dock'
    };
  }

  function number(value, fallback) {
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.round(n), SIZE_MIN), SIZE_MAX);
  }

  // Takes anything at all — null, a string, an object from an older version,
  // a size stored as text — and returns a state that every other function
  // here may trust. It never throws, because the alternative is an app that
  // will not start over one bad entry in the browser's store.
  function normalize(raw) {
    const base = defaultState();
    let value = raw;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return base; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    if (value.v !== VERSION) return base;      // an unknown version is not worth guessing at
    const out = defaultState();
    if (MODES.includes(value.mode)) out.mode = value.mode;
    if (SIDES.includes(value.side)) out.side = value.side;
    if (value.lastMode === 'dock' || value.lastMode === 'window') out.lastMode = value.lastMode;
    const size = value.size;
    if (size && typeof size === 'object') {
      for (const side of SIDES) out.size[side] = number(size[side], DEFAULT_SIZE[side]);
    }
    return out;
  }

  // What the app starts with. A saved "window" does not reopen a window:
  // browsers only allow that from a real click, so it would fail silently and
  // leave a pressed button with nothing behind it.
  function bootState(state) {
    const out = normalize(state);
    if (out.mode === 'window') out.mode = 'off';
    return out;
  }

  function withDock(state, side) {
    const out = normalize(state);
    if (SIDES.includes(side)) out.side = side;
    out.mode = 'dock';
    out.lastMode = 'dock';
    return out;
  }

  function withWindow(state) {
    const out = normalize(state);
    out.mode = 'window';
    out.lastMode = 'window';
    return out;
  }

  function withHidden(state) {
    const out = normalize(state);
    out.mode = 'off';
    return out;                                 // lastMode survives: the button reopens where it was
  }

  function withSize(state, side, px) {
    const out = normalize(state);
    if (SIDES.includes(side)) out.size[side] = number(px, out.size[side]);
    return out;
  }

  function sizeOf(state, side) {
    const out = normalize(state);
    return SIDES.includes(side) ? out.size[side] : out.size[out.side];
  }

  // What the one button in the toolbar does next.
  function toggleTarget(state) {
    const out = normalize(state);
    if (out.mode === 'off') {
      return out.lastMode === 'window' ? { kind: 'window' } : { kind: 'dock', side: out.side };
    }
    return { kind: 'off' };
  }

  return {
    VERSION, SIDES, MODES, DEFAULT_SIZE,
    defaultState, normalize, bootState,
    withDock, withWindow, withHidden, withSize, sizeOf, toggleTarget
  };
});
