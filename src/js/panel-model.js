// The layout of the castle view area — pure state, no DOM, no canvas.
//
// Both views are windows now: the map seen from above and the slanted 2.5D
// view are the same kind of thing, and neither of them is the floor the
// other stands on. What holds them is a tree:
//
//   area   { kind: 'area', id, tabs: ['map', 'iso'], active: 'map' }
//   split  { kind: 'split', dir: 'row' | 'col', share, a, b }
//
// An area is one box with a row of tabs; only the active tab is shown. A
// split cuts a box in two, `share` being how much of it the first half gets.
// 'row' puts a beside b, 'col' puts a above b.
//
// Shares, not pixels: the whole tree has to survive the window being resized,
// and a pixel size remembered on a wide screen squeezes a narrow one to
// nothing. What a splitter drags is a share; how few pixels an area may end
// up with is a question about the screen, and it is answered where the screen
// is measured, not here.
//
// Every function returns a NEW state. Nothing is edited in place, so the view
// can compare what it has against what it is given and the undo of a bad drag
// is simply not using the answer.

(function exposePanelModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.panelModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const VERSION = 2;

  // The windows that exist. Anything not on this list is dropped when a
  // stored layout is read back - a tab naming a window that is gone would be
  // a tab that can be clicked and shows nothing.
  const WINDOWS = ['map', 'iso'];

  // Where a window can be let go over an area.
  const SIDES = ['left', 'right', 'top', 'bottom'];
  const PLACES = ['tab'].concat(SIDES);

  const MIN_SHARE = 0.08;
  const MAX_SHARE = 0.92;

  function clamp(value, low, high) { return Math.min(Math.max(value, low), high); }

  function isArea(node) { return Boolean(node) && node.kind === 'area'; }
  function isSplit(node) { return Boolean(node) && node.kind === 'split'; }

  // ------------------------------------------------------------ building

  function area(tabs, active, id) {
    const list = (tabs || []).filter(w => WINDOWS.includes(w));
    const unique = list.filter((w, i) => list.indexOf(w) === i);
    return {
      kind: 'area',
      id: id || nextId(),
      tabs: unique,
      active: unique.includes(active) ? active : (unique[0] || null)
    };
  }

  function split(dir, a, b, share) {
    return {
      kind: 'split',
      dir: dir === 'col' ? 'col' : 'row',
      share: Number.isFinite(share) ? clamp(share, MIN_SHARE, MAX_SHARE) : 0.5,
      a, b
    };
  }

  // Ids are only ever used to point at an area from the outside - a drop
  // target, the box a drag is aiming at, the row of tabs the view draws.
  // They never leave the machine, so a counter is enough.
  let counter = 0;
  function nextId() { counter += 1; return 'a' + counter; }

  // An id that is already in the tree is kept. Every move ends in normalize,
  // so handing out fresh ids there would rename every box on every drag: a
  // drag holds the id of the box it is aiming at, and the view tells what
  // changed by it. The counter is pushed past what it reads, so a new box
  // can never be given a name that is already taken.
  function takeId(raw, taken) {
    const wanted = typeof raw === 'string' && raw ? raw : null;
    const id = wanted && !taken.has(wanted) ? wanted : nextId();
    const number = /^a(\d+)$/.exec(id);
    if (number) counter = Math.max(counter, Number(number[1]));
    taken.add(id);
    return id;
  }

  function defaultState() {
    return { v: VERSION, root: area(['map'], 'map'), closed: ['iso'], last: {} };
  }

  // ------------------------------------------------------------- walking

  function areas(node, out) {
    const list = out || [];
    if (isArea(node)) list.push(node);
    else if (isSplit(node)) { areas(node.a, list); areas(node.b, list); }
    return list;
  }

  function findArea(state, id) {
    return areas(state && state.root).find(a => a.id === id) || null;
  }

  function areaOf(state, win) {
    return areas(state && state.root).find(a => a.tabs.includes(win)) || null;
  }

  function openWindows(state) {
    return areas(state && state.root).reduce((all, a) => all.concat(a.tabs), []);
  }

  function isOpen(state, win) { return openWindows(state).includes(win); }

  // Rebuild the tree with one area replaced. The parts that are not on the
  // way to it are handed back as they are: an area the user is not touching
  // keeps its identity, and the view can tell what actually changed.
  function replaceArea(node, id, make) {
    if (isArea(node)) return node.id === id ? make(node) : node;
    if (!isSplit(node)) return node;
    const a = replaceArea(node.a, id, make);
    const b = replaceArea(node.b, id, make);
    return a === node.a && b === node.b ? node : split(node.dir, a, b, node.share);
  }

  // Take a window out of the tree wherever it is. Areas left with no tabs are
  // marked, not removed - tidying up is normalize's one job, and doing it in
  // two places is how the two disagree.
  function withoutWindow(node, win) {
    if (isArea(node)) {
      if (!node.tabs.includes(win)) return node;
      const tabs = node.tabs.filter(w => w !== win);
      const active = node.active === win ? (tabs[0] || null) : node.active;
      return { kind: 'area', id: node.id, tabs, active };
    }
    if (!isSplit(node)) return node;
    const a = withoutWindow(node.a, win);
    const b = withoutWindow(node.b, win);
    return a === node.a && b === node.b ? node : split(node.dir, a, b, node.share);
  }

  // ------------------------------------------------------------- tidying

  // An empty area vanishes and its other half takes the whole box - except
  // for the last one, which stays: with every window closed the user still
  // needs a box to drop one into, and an area with no tabs is exactly the
  // empty view Daniel asked for.
  function prune(node) {
    if (isArea(node)) return node.tabs.length ? node : null;
    if (!isSplit(node)) return null;
    const a = prune(node.a);
    const b = prune(node.b);
    if (a && b) return a === node.a && b === node.b ? node : split(node.dir, a, b, node.share);
    return a || b || null;
  }

  // Never throws, whatever comes out of the store. A layout that cannot be
  // read is not half-repaired: it is replaced, because half a tree is worse
  // than the default one.
  function normalize(raw) {
    const fallback = defaultState();
    if (!raw || typeof raw !== 'object') return fallback;
    const tree = readNode(raw.root, new Set(), new Set());
    // Nothing readable at all is a broken store, and the answer to that is
    // the layout the program starts with - not an empty view, which looks
    // exactly like a program that failed to draw anything.
    // An area that IS readable and simply has no tabs is a different thing:
    // that is the user having closed everything, and it is kept.
    if (!tree) return fallback;
    const root = prune(tree) || area([], null);
    const open = areas(root).reduce((all, a) => all.concat(a.tabs), []);
    const closed = WINDOWS.filter(w => !open.includes(w));
    const last = {};
    for (const win of WINDOWS) {
      const place = raw.last && raw.last[win];
      if (place && PLACES.includes(place.where)) last[win] = { where: place.where };
    }
    return { v: VERSION, root, closed, last };
  }

  // One window may hang in one place only. Read twice - a store written by
  // hand, or a layout from an older version - it keeps its first place, or
  // clicking one tab would show a canvas that is somewhere else on screen.
  function readNode(raw, seen, taken) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind === 'split') {
      const a = readNode(raw.a, seen, taken);
      const b = readNode(raw.b, seen, taken);
      if (!a && !b) return null;
      if (!a || !b) return a || b;
      return split(raw.dir, a, b, raw.share);
    }
    const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter(w => {
      if (!WINDOWS.includes(w) || seen.has(w)) return false;
      seen.add(w);
      return true;
    }) : [];
    return area(tabs, raw.active, takeId(raw.id, taken));
  }

  // ---------------------------------------------------------- the moves

  // Put a window into an area, either as another tab or by cutting the area
  // in two. Taking it out first is what makes "drag it somewhere else" and
  // "drag it here from nowhere" the same move, and it is why dropping a
  // window back on its own area is quietly nothing.
  function place(state, win, targetId, where) {
    if (!WINDOWS.includes(win) || !PLACES.includes(where)) return state;
    const target = findArea(state, targetId);
    if (!target) return state;

    // Alone in its area and dropped on itself: nothing to do, and doing it
    // anyway would drop the area and build a new one with a new id, which
    // the view would see as "everything changed".
    const from = areaOf(state, win);
    if (from && from.id === target.id && where === 'tab') {
      return activate({ ...state, closed: without(state.closed, win) }, win);
    }

    const stripped = withoutWindow(state.root, win);
    // The target may have been emptied by taking the window out of it; it is
    // still the box we mean, so pruning waits until after the drop.
    const grown = replaceArea(stripped, targetId, node => {
      if (where === 'tab') {
        return { kind: 'area', id: node.id, tabs: node.tabs.concat([win]), active: win };
      }
      const dir = (where === 'left' || where === 'right') ? 'row' : 'col';
      const fresh = area([win], win);
      const first = (where === 'left' || where === 'top');
      return first ? split(dir, fresh, node, 0.4) : split(dir, node, fresh, 0.6);
    });

    const root = prune(grown) || area([win], win);
    const next = normalize({ v: VERSION, root, last: state.last });
    return remember(next, win, where);
  }

  function without(list, win) { return (list || []).filter(w => w !== win); }

  // Where a window was last put, so opening it again puts it back there
  // instead of always on the right.
  function remember(state, win, where) {
    return { ...state, last: { ...state.last, [win]: { where } } };
  }

  function activate(state, win) {
    const holder = areaOf(state, win);
    if (!holder || holder.active === win) return state;
    return { ...state, root: replaceArea(state.root, holder.id, node => ({ ...node, active: win })) };
  }

  // Show a window that is closed. It goes back where it last was; the very
  // first time - or when that place is gone - it is docked to the right of
  // the biggest area there is, which with one area is simply beside the map.
  function open(state, win, fallbackWhere) {
    if (isOpen(state, win)) return activate(state, win);
    const list = areas(state.root);
    const host = list.find(a => a.tabs.length) || list[0];
    if (!host) return { ...state, root: area([win], win), closed: without(state.closed, win) };
    const remembered = state.last && state.last[win] && state.last[win].where;
    const where = PLACES.includes(fallbackWhere) ? fallbackWhere
                : PLACES.includes(remembered) ? remembered : 'right';
    return place(state, win, host.id, where);
  }

  function close(state, win) {
    if (!isOpen(state, win)) return state;
    const root = prune(withoutWindow(state.root, win)) || area([], null);
    return normalize({ v: VERSION, root, last: state.last });
  }

  function toggle(state, win) {
    return isOpen(state, win) ? close(state, win) : open(state, win);
  }

  // Click a tab.
  function select(state, areaId, win) {
    const target = findArea(state, areaId);
    if (!target || !target.tabs.includes(win)) return state;
    return { ...state, root: replaceArea(state.root, areaId, node => ({ ...node, active: win })) };
  }

  // Drag a splitter. `path` is the way down the tree to it, as a string of
  // 'a' and 'b' - the same way the view names them when it draws them, so a
  // splitter on screen and the split it moves cannot come apart.
  function resize(state, path, share) {
    if (typeof path !== 'string') return state;
    const next = setShare(state.root, path, share);
    return next === state.root ? state : { ...state, root: next };
  }

  function setShare(node, path, share) {
    if (!isSplit(node)) return node;
    if (path === '') return split(node.dir, node.a, node.b, share);
    const step = path[0];
    const rest = path.slice(1);
    if (step === 'a') {
      const a = setShare(node.a, rest, share);
      return a === node.a ? node : split(node.dir, a, node.b, node.share);
    }
    if (step === 'b') {
      const b = setShare(node.b, rest, share);
      return b === node.b ? node : split(node.dir, node.a, b, node.share);
    }
    return node;
  }

  // Every split in the tree with the path that names it, so the view can draw
  // one handle per split and hand the path straight back to resize().
  function splits(node, path, out) {
    const list = out || [];
    if (!isSplit(node)) return list;
    list.push({ path: path || '', dir: node.dir, share: node.share });
    splits(node.a, (path || '') + 'a', list);
    splits(node.b, (path || '') + 'b', list);
    return list;
  }

  return {
    VERSION, WINDOWS, SIDES, PLACES, MIN_SHARE, MAX_SHARE,
    defaultState, normalize,
    area, split, areas, findArea, areaOf, openWindows, isOpen, splits,
    place, open, close, toggle, select, activate, resize
  };
});
