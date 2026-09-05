// Docking the 2.5D view — checked without a screen.
//
// Three kinds of test live here, and they are deliberately different from
// the ones in dock-geometry.test.js:
//
//   1. The edges of the drop zones, to the pixel. Not "somewhere near the
//      left" but "220 lands, 220.5 does not" — an off-by-one in a band is
//      invisible in a screenshot and obvious in a number.
//   2. The whole round trip docked -> window -> docked, driven through the
//      real dock-view.js. The file needs a document, so it gets a small
//      pretend one: enough elements, classes and listeners to run it, and a
//      note of every call it makes to the 2.5D view. That is how "something
//      stayed switched on" becomes a failing test instead of a bug report.
//   3. The wiring: every id the two files look up has to be in index.html,
//      and every class and CSS variable they set has to be in the
//      stylesheet. Both halves of a name have to be written twice, in two
//      files, so this is where they drift apart.
//
// Nothing here opens a window, paints a canvas or needs a browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const G = require(path.join(root, 'src', 'js', 'dock-geometry.js'));
const M = require(path.join(root, 'src', 'js', 'dock-model.js'));
const ISO = require(path.join(root, 'src', 'js', 'iso-geometry.js'));

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('src', 'index.html');
const css = read('src', 'css', 'combined.css');
const dockSource = read('src', 'js', 'dock-view.js');
const isoSource = read('src', 'js', 'iso-view.js');

// The one box every measurement in this file refers to. Not at the origin
// on purpose: a rectangle that starts at 0,0 hides every place where a
// client coordinate was used as if it were an offset inside the box.
const BOX = { x: 100, y: 50, w: 1000, h: 600 };

// share .28 of 1000 = 280, capped at bandMax 220; of 600 = 168, which is
// under the cap. Worked out here once so the tests can name real numbers.
const BAND_X = 220;
const BAND_Y = 168;

// ------------------------------------------------------------ the zones

test('the bands are exactly as wide as the numbers say', () => {
  const bands = G.dockBands(BOX);
  assert.equal(bands.bandX, BAND_X, '28 % of 1000 is over the 220 ceiling, so the ceiling wins');
  // 600 * 0.28 is 168.00000000000003 in binary arithmetic. A third of a
  // millionth of a pixel is not a mistake, so this is a near-enough test —
  // but it is written down rather than rounded away, because a band that is
  // out by a whole pixel has to fail here.
  assert.ok(Math.abs(bands.bandY - BAND_Y) < 1e-9, 'expected ' + BAND_Y + ', got ' + bands.bandY);
});

test('the middle of the box is no zone at all', () => {
  assert.equal(G.dockZoneAt(BOX, { x: 600, y: 350 }), 'center');
});

test('each of the four bands ends where it says it ends', () => {
  const midY = BOX.y + BOX.h / 2;
  const midX = BOX.x + BOX.w / 2;
  const cases = [
    ['left', { x: BOX.x + BAND_X, y: midY }, { x: BOX.x + BAND_X + 0.5, y: midY }],
    ['right', { x: BOX.x + BOX.w - BAND_X, y: midY }, { x: BOX.x + BOX.w - BAND_X - 0.5, y: midY }],
    ['top', { x: midX, y: BOX.y + BAND_Y }, { x: midX, y: BOX.y + BAND_Y + 0.5 }],
    ['bottom', { x: midX, y: BOX.y + BOX.h - BAND_Y }, { x: midX, y: BOX.y + BOX.h - BAND_Y - 0.5 }]
  ];
  for (const [side, last, first] of cases) {
    assert.equal(G.dockZoneAt(BOX, last), side, `the last pixel of ${side} still belongs to it`);
    assert.equal(G.dockZoneAt(BOX, first), 'center', `half a pixel further is already the middle`);
  }
});

test('the very edge of the box is still a zone, one step further is nothing', () => {
  const midY = BOX.y + BOX.h / 2;
  const midX = BOX.x + BOX.w / 2;
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x, y: midY }), 'left');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x - 0.5, y: midY }), null);
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w, y: midY }), 'right');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w + 0.5, y: midY }), null);
  assert.equal(G.dockZoneAt(BOX, { x: midX, y: BOX.y }), 'top');
  assert.equal(G.dockZoneAt(BOX, { x: midX, y: BOX.y - 0.5 }), null);
  assert.equal(G.dockZoneAt(BOX, { x: midX, y: BOX.y + BOX.h }), 'bottom');
  assert.equal(G.dockZoneAt(BOX, { x: midX, y: BOX.y + BOX.h + 0.5 }), null);
});

test('the four corners belong to the nearer side, and a tie never flickers', () => {
  // 40 px in from both edges: the same distance, so the fixed order decides.
  const inset = 40;
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + inset, y: BOX.y + inset }), 'left');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w - inset, y: BOX.y + inset }), 'right');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + inset, y: BOX.y + BOX.h - inset }), 'left');
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + BOX.w - inset, y: BOX.y + BOX.h - inset }), 'right');
  // No tie: 10 from the top, 200 from the left — top has to win.
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + 200, y: BOX.y + 10 }), 'top');
  // and the same the other way round, so the answer is not simply "left".
  assert.equal(G.dockZoneAt(BOX, { x: BOX.x + 10, y: BOX.y + 160 }), 'left');
});

test('opposite bands never meet — there is always somewhere to say no', () => {
  // The 45 % ceiling is what guarantees this: two bands of at most 45 %
  // cannot cover 100 %. Checked across sizes, from tiny to huge, because a
  // box small enough for the bands to touch would leave the user no way to
  // cancel a drag other than Escape.
  for (const w of [20, 60, 120, 300, 800, 1600, 4000]) {
    for (const h of [20, 60, 120, 300, 800, 1600, 4000]) {
      const box = { x: 0, y: 0, w, h };
      const { bandX, bandY } = G.dockBands(box);
      assert.ok(bandX * 2 < w, `bands of ${bandX} meet in a box ${w} wide`);
      assert.ok(bandY * 2 < h, `bands of ${bandY} meet in a box ${h} high`);
      assert.equal(G.dockZoneAt(box, { x: w / 2, y: h / 2 }), 'center',
        `no middle left in ${w} by ${h}`);
    }
  }
});

test('a pointer sitting on a band edge does not change its mind', () => {
  const edge = { x: BOX.x + BAND_X + 6, y: BOX.y + BOX.h / 2 };   // 6 px past the band
  assert.equal(G.dockZoneAt(BOX, edge), 'center', 'without a history it is outside');
  assert.equal(G.stableZone(BOX, edge, 'left'), 'left', 'coming from left it stays left');
  assert.equal(G.stableZone(BOX, edge, null), 'center');
  // ... but not for ever: 12 px of hysteresis, so 13 past the band lets go.
  assert.equal(G.stableZone(BOX, { x: BOX.x + BAND_X + 13, y: edge.y }, 'left'), 'center');
});

test('what the preview draws is the panel the drop would build', () => {
  for (const side of G.DOCK_SIDES) {
    const preview = G.dockPreviewRect(BOX, side, 380);
    const drop = G.dropAction(BOX, insideBand(side), null, { sizes: { [side]: 380 } });
    assert.equal(drop.kind, 'dock');
    assert.equal(drop.side, side);
    const panel = G.panelRectFor(BOX, side, drop.size);
    assert.deepEqual(preview, panel, `the ${side} preview and the ${side} panel are the same box`);
  }
  assert.equal(G.dockPreviewRect(BOX, 'center', 380), null, 'the middle previews nothing');
  assert.equal(G.dockPreviewRect(BOX, null, 380), null, 'outside previews nothing');
});

// A point safely inside the given band, in the middle of that edge.
function insideBand(side) {
  const midX = BOX.x + BOX.w / 2;
  const midY = BOX.y + BOX.h / 2;
  if (side === 'left') return { x: BOX.x + 10, y: midY };
  if (side === 'right') return { x: BOX.x + BOX.w - 10, y: midY };
  if (side === 'top') return { x: midX, y: BOX.y + 10 };
  return { x: midX, y: BOX.y + BOX.h - 10 };
}

// ------------------------------------------------------ a pretend window

// Just enough of a document to run dock-view.js: elements that remember
// their classes, attributes and listeners, and a note of everything the
// file asks the 2.5D view to do.
function element(id) {
  const classes = new Set();
  const listeners = new Map();
  const el = {
    id,
    dataset: {},
    attributes: {},
    textContent: '',
    hidden: false,
    children: [],
    rect: { left: 0, top: 0, width: 0, height: 0 },
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = value; },
      getPropertyValue(name) { return this.props[name]; }
    },
    classList: {
      add(...names) { for (const n of names) classes.add(n); },
      remove(...names) { for (const n of names) classes.delete(n); },
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { el.attributes[name] = String(value); },
    getAttribute(name) { return name in el.attributes ? el.attributes[name] : null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    querySelectorAll(selector) {
      const wanted = selector.replace('.', '');
      return el.children.filter(child => child.classList.contains(wanted));
    },
    getBoundingClientRect() { return el.rect; },
    setPointerCapture() {},
    releasePointerCapture() {},
    // what a real event does, minus the browser
    fire(type, event) {
      const found = listeners.get(type) || [];
      assert.ok(found.length > 0, `nothing listens for ${type} on #${id}`);
      for (const fn of found) fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, event));
    },
    has(type) { return (listeners.get(type) || []).length > 0; }
  };
  return el;
}

const PANEL_IDS = ['castleCanvasColumn', 'castleDockOverlay', 'castleDockPreview', 'castleDockHint',
                   'isoDockSplitter', 'isoDockGrip', 'castleIsoBtn', 'castleStatus',
                   'isoFitBtn', 'isoPopOutBtn', 'isoDockCloseBtn'];

function boot(saved) {
  const els = {};
  for (const id of PANEL_IDS) els[id] = element(id);
  for (const side of G.DOCK_SIDES) {
    const zone = element('zone-' + side);
    zone.classList.add('dockZone');
    zone.dataset.zone = side;
    els.castleDockOverlay.children.push(zone);
  }
  els.castleDockPreview.classList.add('dockPreview');
  els.castleDockOverlay.children.push(els.castleDockPreview, els.castleDockHint);
  els.castleDockOverlay.rect = { left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h };

  const calls = [];
  const frames = [];
  const store = new Map();
  if (saved !== undefined) store.set('castle.isoDock.v1', JSON.stringify(saved));
  const documentElement = element('html');
  const windowListeners = new Map();

  const sandbox = {
    console,
    dockGeometry: G,
    dockModel: M,
    document: {
      readyState: 'complete',
      documentElement,
      getElementById: id => els[id] || null,
      addEventListener() {}
    },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key)
    },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    isoView: {
      mountDock() { calls.push('mountDock'); },
      unmount() { calls.push('unmount'); },
      openWindow() { calls.push('openWindow'); },
      closeWindow() { calls.push('closeWindow'); },
      refresh() { calls.push('refresh'); },
      fit() { calls.push('fit'); }
    },
    castleEditor: { onWorkspaceShown() { calls.push('editorResize'); } }
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(dockSource, sandbox, { filename: 'dock-view.js' });

  return {
    els, calls, sandbox, store, documentElement,
    view: sandbox.dockView,
    dock: () => els.castleCanvasColumn.dataset.dock,
    size: () => els.castleCanvasColumn.style.props['--dock-size'],
    pressed: () => els.castleIsoBtn.getAttribute('aria-pressed'),
    dragging: () => documentElement.classList.contains('dockDragging'),
    resizing: () => documentElement.classList.contains('dockResizing'),
    zonesShown: () => els.castleDockOverlay.classList.contains('showing'),
    hot: () => els.castleDockOverlay.children.filter(c => c.classList.contains('hot')).map(c => c.dataset.zone),
    saved: () => JSON.parse(store.get('castle.isoDock.v1')),
    fireWindow(type, event) {
      for (const fn of windowListeners.get(type) || []) {
        fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, event));
      }
    },
    flush() { const due = frames.splice(0); for (const fn of due) fn(); }
  };
}

test('the pretend window is close enough: dock-view actually starts in it', () => {
  const app = boot();
  assert.ok(app.view, 'dock-view published its commands');
  assert.equal(app.dock(), 'off', 'nothing is docked before the first click');
  assert.equal(app.pressed(), 'false');
  assert.ok(app.els.castleIsoBtn.has('click'), 'the toolbar button is wired');
  assert.ok(app.els.isoDockGrip.has('pointerdown'), 'the grip can be dragged');
  assert.ok(app.els.isoDockSplitter.has('keydown'), 'the splitter can be moved by keyboard');
});

// --------------------------------------------------- docked, window, docked

test('docked -> window -> docked, and nothing stays behind', () => {
  const app = boot();

  app.view.dockTo('right');
  assert.equal(app.dock(), 'right');
  assert.equal(app.pressed(), 'true');
  assert.equal(app.size(), '380px');
  assert.ok(app.calls.includes('mountDock'), 'the view was asked into the panel');
  const docked = app.view.getState();

  app.calls.length = 0;
  app.view.popOut();
  assert.equal(app.dock(), 'off', 'the panel column is gone while the window is up');
  assert.equal(app.pressed(), 'true', 'the button still reads as on — the view is visible');
  assert.deepEqual(app.calls.filter(c => c !== 'editorResize'), ['openWindow']);
  assert.equal(app.view.getState().mode, 'window');
  assert.equal(app.view.getState().side, 'right', 'the side is remembered while it floats');

  app.calls.length = 0;
  app.view.dockTo();
  assert.equal(app.dock(), 'right', 'it comes back to the side it left');
  assert.deepEqual(app.calls.filter(c => c !== 'editorResize'), ['mountDock']);
  assert.deepEqual(app.view.getState(), docked, 'exactly the state it started from');

  app.calls.length = 0;
  app.view.hide();
  assert.equal(app.dock(), 'off');
  assert.equal(app.pressed(), 'false');
  assert.deepEqual(app.calls.filter(c => c !== 'editorResize').sort(), ['closeWindow', 'unmount'],
    'both hosts are let go, not just the one that was in use');
});

test('the toolbar button alone gets through all three states', () => {
  const app = boot();
  app.view.toggle();
  assert.equal(app.dock(), 'right', 'first press docks where it last was');
  app.view.toggle();
  assert.equal(app.dock(), 'off', 'second press puts it away');
  assert.equal(app.view.getState().lastMode, 'dock');
  app.view.toggle();
  assert.equal(app.dock(), 'right', 'third press brings the panel back, not a window');

  // after a window it has to come back as a window
  app.view.popOut();
  app.view.toggle();
  assert.equal(app.view.getState().mode, 'off');
  app.calls.length = 0;
  app.view.toggle();
  assert.equal(app.view.getState().mode, 'window');
  assert.ok(app.calls.includes('openWindow'));
});

test('a window closed by its own button leaves no ghost behind', () => {
  const app = boot();
  app.view.popOut();
  app.calls.length = 0;
  app.view.onViewClosed();
  assert.equal(app.view.getState().mode, 'off');
  assert.equal(app.pressed(), 'false');
  assert.deepEqual(app.calls, [], 'nobody is asked to close a window that is already gone');
  assert.equal(app.saved().mode, 'off', 'and it is written down, so a reload agrees');
});

test('a saved dock comes back, a saved window does not open by itself', () => {
  const docked = boot({ v: 1, mode: 'dock', side: 'bottom', size: { left: 380, right: 380, top: 300, bottom: 260 }, lastMode: 'dock' });
  assert.equal(docked.dock(), 'bottom');
  assert.equal(docked.size(), '260px');
  assert.equal(docked.els.isoDockSplitter.getAttribute('aria-orientation'), 'horizontal');

  const floated = boot({ v: 1, mode: 'window', side: 'left', size: M.DEFAULT_SIZE, lastMode: 'window' });
  assert.equal(floated.view.getState().mode, 'off', 'a browser only opens windows on a real click');
  assert.deepEqual(floated.calls, [], 'and nothing is opened behind the user’s back');
  floated.view.toggle();
  assert.equal(floated.view.getState().mode, 'window', 'one press and it is back where it was');
});

test('each side keeps its own width across a round trip', () => {
  const app = boot();
  app.view.dockTo('right');
  app.els.isoDockSplitter.fire('dblclick', {});
  assert.equal(app.size(), '380px');
  app.view.dockTo('bottom');
  assert.equal(app.view.getState().size.bottom, 300, 'bottom is a height, not a width');
  assert.equal(app.size(), '270px', 'and 300 does not fit a 600 px box, so 45 % of it goes out');
  app.view.dockTo('right');
  assert.equal(app.size(), '380px', 'the right side did not learn the height');
  assert.equal(app.view.getState().size.bottom, 300, 'and the trip through bottom changed nothing');
});

// ------------------------------------------------------------ the gesture

test('dragging the grip to an edge docks it there', () => {
  const app = boot();
  app.view.dockTo('right');
  const grip = app.els.isoDockGrip;

  grip.fire('pointerdown', { button: 0, pointerId: 7, clientX: 900, clientY: 100 });
  assert.equal(app.zonesShown(), false, 'a press alone shows nothing');

  grip.fire('pointermove', { pointerId: 7, clientX: 700, clientY: 350 });
  assert.equal(app.zonesShown(), true, 'moving far enough opens the zones');
  assert.equal(app.dragging(), true);

  grip.fire('pointermove', { pointerId: 7, clientX: BOX.x + 10, clientY: 350 });
  assert.deepEqual(app.hot(), ['left'], 'the left band lights up');
  assert.equal(app.els.castleDockPreview.hidden, false);
  assert.equal(app.els.castleDockPreview.style.left, '0px', 'the preview is drawn inside the overlay, not on the screen');
  assert.equal(app.els.castleDockPreview.style.width, '380px');

  grip.fire('pointerup', { pointerId: 7, clientX: BOX.x + 10, clientY: 350 });
  assert.equal(app.dock(), 'left');
  assert.equal(app.zonesShown(), false, 'the zones are put away');
  assert.equal(app.dragging(), false, 'and the grabbing cursor with them');
  assert.deepEqual(app.hot(), [], 'no band stays lit');
  assert.equal(app.els.castleDockPreview.hidden, true);
});

test('a drag into the middle changes nothing, a drag outside makes a window', () => {
  const middle = boot();
  middle.view.dockTo('right');
  middle.els.isoDockGrip.fire('pointerdown', { button: 0, pointerId: 1, clientX: 900, clientY: 100 });
  middle.els.isoDockGrip.fire('pointermove', { pointerId: 1, clientX: 600, clientY: 350 });
  middle.els.isoDockGrip.fire('pointerup', { pointerId: 1, clientX: 600, clientY: 350 });
  assert.equal(middle.dock(), 'right', 'dropped in the middle it stays where it was');
  assert.equal(middle.zonesShown(), false);

  const torn = boot();
  torn.view.dockTo('right');
  torn.calls.length = 0;
  torn.els.isoDockGrip.fire('pointerdown', { button: 0, pointerId: 2, clientX: 900, clientY: 100 });
  torn.els.isoDockGrip.fire('pointermove', { pointerId: 2, clientX: 1400, clientY: 350 });
  torn.els.isoDockGrip.fire('pointerup', { pointerId: 2, clientX: 1400, clientY: 350 });
  assert.equal(torn.view.getState().mode, 'window', 'let go well outside and it tears off');
  assert.ok(torn.calls.includes('openWindow'));
  assert.equal(torn.dragging(), false);
});

test('a click on the grip is not a drag', () => {
  const app = boot();
  app.view.dockTo('right');
  app.els.isoDockGrip.fire('pointerdown', { button: 0, pointerId: 3, clientX: 900, clientY: 100 });
  app.els.isoDockGrip.fire('pointermove', { pointerId: 3, clientX: 901, clientY: 101 });
  app.els.isoDockGrip.fire('pointerup', { pointerId: 3, clientX: 901, clientY: 101 });
  assert.equal(app.dock(), 'right');
  assert.equal(app.zonesShown(), false, 'a click never opened the zones');
});

test('Escape during a drag puts everything back', () => {
  const app = boot();
  app.view.dockTo('right');
  app.els.isoDockGrip.fire('pointerdown', { button: 0, pointerId: 4, clientX: 900, clientY: 100 });
  app.els.isoDockGrip.fire('pointermove', { pointerId: 4, clientX: BOX.x + 5, clientY: 350 });
  assert.equal(app.zonesShown(), true);

  app.fireWindow('keydown', { key: 'Escape' });
  assert.equal(app.zonesShown(), false, 'the zones are gone');
  assert.equal(app.dragging(), false, 'the cursor is normal again');
  assert.deepEqual(app.hot(), []);

  // and the release that follows the Escape must not still dock it
  app.els.isoDockGrip.fire('pointerup', { pointerId: 4, clientX: BOX.x + 5, clientY: 350 });
  assert.equal(app.dock(), 'right', 'it stayed on the right');
});

test('losing the window in mid-drag clears the zones too', () => {
  const app = boot();
  app.view.dockTo('right');
  app.els.isoDockGrip.fire('pointerdown', { button: 0, pointerId: 5, clientX: 900, clientY: 100 });
  app.els.isoDockGrip.fire('pointermove', { pointerId: 5, clientX: BOX.x + 5, clientY: 350 });
  app.fireWindow('blur', {});
  assert.equal(app.zonesShown(), false);
  assert.equal(app.dragging(), false);
});

test('a stray pointer from another finger is ignored', () => {
  const app = boot();
  app.view.dockTo('right');
  app.els.isoDockGrip.fire('pointerdown', { button: 0, pointerId: 6, clientX: 900, clientY: 100 });
  app.els.isoDockGrip.fire('pointermove', { pointerId: 99, clientX: BOX.x + 5, clientY: 350 });
  assert.equal(app.zonesShown(), false, 'the second finger does not drive the first drag');
  app.els.isoDockGrip.fire('pointerup', { pointerId: 99, clientX: BOX.x + 5, clientY: 350 });
  assert.equal(app.dock(), 'right');
});

// ----------------------------------------------------------- the splitter

test('the splitter writes while it is dragged and stores when it is let go', () => {
  const app = boot();
  app.view.dockTo('left');
  const splitter = app.els.isoDockSplitter;

  splitter.fire('pointerdown', { button: 0, pointerId: 8, clientX: 480, clientY: 300 });
  assert.equal(app.resizing(), true);
  splitter.fire('pointermove', { pointerId: 8, clientX: BOX.x + 400, clientY: 300 });
  app.flush();
  assert.equal(app.size(), '400px', 'the panel follows the hand');
  assert.equal(app.saved().size.left, 380, 'but nothing is written down yet');

  splitter.fire('pointerup', { pointerId: 8, clientX: BOX.x + 400, clientY: 300 });
  assert.equal(app.resizing(), false, 'the no-select lock is lifted');
  assert.equal(app.saved().size.left, 400);
  assert.equal(app.view.getState().size.left, 400);
});

test('the splitter cannot squeeze the map away', () => {
  const app = boot();
  app.view.dockTo('left');
  const splitter = app.els.isoDockSplitter;
  splitter.fire('pointerdown', { button: 0, pointerId: 9, clientX: 480, clientY: 300 });
  splitter.fire('pointermove', { pointerId: 9, clientX: BOX.x + 4000, clientY: 300 });
  splitter.fire('pointerup', { pointerId: 9, clientX: BOX.x + 4000, clientY: 300 });
  assert.equal(app.view.getState().size.left, 450, 'never more than 45 % of the box');

  splitter.fire('pointerdown', { button: 0, pointerId: 10, clientX: 480, clientY: 300 });
  splitter.fire('pointermove', { pointerId: 10, clientX: BOX.x - 500, clientY: 300 });
  splitter.fire('pointerup', { pointerId: 10, clientX: BOX.x - 500, clientY: 300 });
  assert.equal(app.view.getState().size.left, 220, 'and never less than the minimum');
});

test('Escape during a resize gives the old width back', () => {
  const app = boot();
  app.view.dockTo('left');
  const splitter = app.els.isoDockSplitter;
  splitter.fire('pointerdown', { button: 0, pointerId: 11, clientX: 480, clientY: 300 });
  splitter.fire('pointermove', { pointerId: 11, clientX: BOX.x + 300, clientY: 300 });
  app.flush();
  assert.equal(app.size(), '300px');
  app.fireWindow('keydown', { key: 'Escape' });
  assert.equal(app.size(), '380px', 'back to where it started');
  assert.equal(app.resizing(), false);
  assert.equal(app.view.getState().size.left, 380);
});

test('the arrow keys move the splitter the right way on every side', () => {
  const app = boot();
  const splitter = app.els.isoDockSplitter;

  app.view.dockTo('right');
  splitter.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(app.view.getState().size.right, 396, 'on the right, left is wider');
  splitter.fire('keydown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(app.view.getState().size.right, 332, 'and shift takes bigger steps');

  app.view.dockTo('left');
  splitter.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(app.view.getState().size.left, 364, 'on the left, left is narrower');

  app.view.dockTo('bottom');
  // The box is only 600 high, so the ceiling for a bottom panel is 270 and
  // the remembered 300 is already above it: the first press downwards is a
  // clamp, not a step. That is the honest number, not 316.
  splitter.fire('keydown', { key: 'ArrowUp' });
  assert.equal(app.view.getState().size.bottom, 270, 'a low box will not give a bottom panel more');
  splitter.fire('keydown', { key: 'ArrowDown' });
  assert.equal(app.view.getState().size.bottom, 254, 'down still makes it smaller');
  splitter.fire('keydown', { key: 'Home' });
  assert.equal(app.view.getState().size.bottom, 220, 'Home is as small as it may get');
  splitter.fire('keydown', { key: 'End' });
  assert.equal(app.view.getState().size.bottom, 270, 'End is 45 % of the 600 px box');
});

test('a width remembered from a bigger screen cannot hide the map', () => {
  // 4000 is a size the model calls valid — its upper limit. Written into a
  // 1000 px column it would leave the map nothing at all, and a map of no
  // width has no splitter the user could drag back.
  const app = boot({ v: 1, mode: 'dock', side: 'right', size: { left: 380, right: 4000, top: 300, bottom: 300 }, lastMode: 'dock' });
  assert.equal(app.size(), '450px', 'what reaches the screen fits the box');
  assert.equal(app.view.getState().size.right, 4000, 'but the remembered width is kept for the wide screen');
});

test('while the castle tab is hidden the width is passed through untouched', () => {
  // Every rectangle in a hidden tab is zero. Clamping against that box would
  // write 0 px and the panel would come back collapsed.
  const app = boot({ v: 1, mode: 'dock', side: 'right', size: { left: 380, right: 500, top: 300, bottom: 300 }, lastMode: 'dock' });
  app.els.castleDockOverlay.rect = { left: 0, top: 0, width: 0, height: 0 };
  app.view.dockTo('right');
  assert.equal(app.size(), '500px', 'nothing measurable, so nothing is changed');
  app.els.castleDockOverlay.rect = { left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h };
  app.view.onWorkspaceShown();
  assert.equal(app.size(), '450px', 'and the tab becoming visible puts it right');
});

// ------------------------------------------------------------- the wiring

// Ids the docking code looks up in the main document. The window builds its
// own body, so ids fetched from win.document are checked against that body
// instead — the same split tests/iso-view.test.js already makes.
function lookedUp(source) {
  const own = [...source.matchAll(/win\.document\.getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const main = [...source.matchAll(/(?<!win\.)document\.getElementById\('([^']+)'\)/g)]
    .map(m => m[1]).filter(id => !own.includes(id));
  return { own, main };
}

test('every id the docking code asks for is in index.html', () => {
  const wanted = new Set([...lookedUp(dockSource).main, ...lookedUp(isoSource).main]);
  assert.ok(wanted.size >= 12, 'both files were read, not just one: ' + wanted.size);
  for (const id of wanted) assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  // the test harness above stands in for the real page, so it has to know
  // the same ids — otherwise it would prove something about a page that
  // does not exist
  for (const id of lookedUp(dockSource).main) {
    assert.ok(PANEL_IDS.includes(id), `the harness does not know #${id} — add it to PANEL_IDS`);
  }
});

test('the four drop zones are in the html, one per side, and no more', () => {
  const zones = [...html.matchAll(/class="dockZone" data-zone="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(zones.slice().sort(), G.DOCK_SIDES.slice().sort());
  assert.equal(zones.length, new Set(zones).size, 'no side is listed twice');
});

test('every class the code switches on exists in the stylesheet', () => {
  const used = new Set();
  for (const call of dockSource.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)) used.add(call[1]);
  for (const call of dockSource.matchAll(/querySelectorAll\('\.([A-Za-z0-9_-]+)'\)/g)) used.add(call[1]);
  assert.ok(used.size >= 4, 'found the classes at all: ' + [...used].join(', '));
  for (const name of used) {
    assert.ok(new RegExp('\\.' + name + '\\b').test(css), `combined.css never mentions .${name}`);
  }
});

test('every custom property the code writes is read by the stylesheet', () => {
  const written = new Set([...dockSource.matchAll(/setProperty\('(--[a-z-]+)'/g)].map(m => m[1]));
  assert.deepEqual([...written].sort(), ['--band-x', '--band-y', '--dock-size']);
  for (const name of written) {
    assert.ok(css.includes('var(' + name), `combined.css never reads var(${name})`);
  }
});

test('data-dock knows all four sides plus off, in the html and in the css', () => {
  assert.ok(html.includes('data-dock="off"'), 'the column starts undocked');
  for (const side of [...G.DOCK_SIDES, 'off']) {
    assert.ok(css.includes(`[data-dock="${side}"]`), `combined.css has no layout for ${side}`);
  }
});

// ------------------------------------------------- the box changes size

test('Escape after the column got narrower does not write the wide width back', () => {
  // Nothing is stored while the splitter is dragged, so a cancel only has to
  // put the picture back - but the picture has to fit the box it goes into.
  // Writing the remembered number straight out would push the map, and with
  // it the splitter, out of a column that has shrunk in the meantime.
  const app = boot();
  app.view.dockTo('left');
  assert.equal(app.size(), '380px');
  app.els.castleDockOverlay.rect = { left: BOX.x, top: BOX.y, width: 400, height: BOX.h };
  const splitter = app.els.isoDockSplitter;
  splitter.fire('pointerdown', { button: 0, pointerId: 21, clientX: 480, clientY: 300 });
  splitter.fire('pointermove', { pointerId: 21, clientX: BOX.x + 300, clientY: 300 });
  app.flush();
  app.fireWindow('keydown', { key: 'Escape' });
  assert.equal(app.size(), '180px', '45 % of the 400 px column, not the remembered 380');
  assert.equal(app.view.getState().size.left, 380, 'and the wide screen keeps its width');
});

test('the app window getting narrower puts the panel back inside the column', () => {
  // Only setState and a tab change used to re-apply the width. Dragging the
  // Electron window narrower does neither, so the panel kept its old width,
  // the map was squeezed to nothing, and only a trip through another tab put
  // it right again.
  const app = boot();
  app.view.dockTo('right');
  assert.equal(app.size(), '380px');
  app.els.castleDockOverlay.rect = { left: BOX.x, top: BOX.y, width: 500, height: BOX.h };
  app.fireWindow('resize', {});
  assert.equal(app.size(), '225px', '45 % of what is left of the column');
});

test('a window the browser refuses falls back to the panel', async () => {
  // A blocked window used to leave a pressed button with nothing behind it,
  // and since the next press toggles it off and the one after that asks for a
  // window again, the panel could not be reached by that button any more.
  const app = boot();
  app.sandbox.isoView.openWindow = () => { app.calls.push('openWindow'); return false; };
  app.view.popOut();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.view.getState().mode, 'dock', 'it comes back as a panel');
  assert.equal(app.dock(), 'right');
  assert.equal(app.pressed(), 'true', 'and the button tells the truth about it');
  assert.ok(app.calls.includes('mountDock'), 'the view really was asked into the panel');
});

test('the arrow keys still move when the remembered width is over the ceiling', () => {
  // bottom remembers 300, the box is 600 high, so the ceiling is 270. A step
  // taken from the remembered 300 lands at 284 and is clamped back to 270 -
  // the key would look dead. The step has to start from what is on screen.
  const app = boot();
  app.view.dockTo('bottom');
  assert.equal(app.size(), '270px', 'the ceiling is what the user sees');
  app.els.isoDockSplitter.fire('keydown', { key: 'ArrowDown' });
  assert.equal(app.view.getState().size.bottom, 254, 'one press, one step smaller');
});

// ------------------------------------------ the 2.5D view in a pretend page

// The same idea as the pretend window above, one floor down: enough of a
// canvas and a window for iso-view.js to run, and a note of every gesture it
// hands to the castle editor.
function pretendContext() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 0, imageSmoothingEnabled: false,
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, fill() {}, stroke() {}, drawImage() {}
  };
}

function pretendWindow() {
  const inner = {};
  const win = {
    closed: false,
    devicePixelRatio: 1,
    document: {
      title: '',
      body: { style: {}, innerHTML: '' },
      getElementById(id) {
        if (!inner[id]) {
          inner[id] = element(id);
          inner[id].getContext = () => pretendContext();
        }
        return inner[id];
      }
    },
    addEventListener() {},
    focus() {},
    close() { win.closed = true; }
  };
  return win;
}

const SURFACE = { left: 0, top: 0, width: 800, height: 600 };

function bootIso() {
  const els = {};
  for (const id of ['isoDockBody', 'isoDockCanvas', 'isoDockStatus']) els[id] = element(id);
  els.isoDockBody.rect = SURFACE;
  els.isoDockCanvas.rect = SURFACE;
  els.isoDockCanvas.getContext = () => pretendContext();

  const frames = [];
  const gestures = [];
  const opened = [];
  const sandbox = {
    console,
    isoGeometry: ISO,
    devicePixelRatio: 1,
    document: {
      readyState: 'complete',
      getElementById: id => els[id] || null,
      addEventListener() {}
    },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    ResizeObserver: class { observe() {} disconnect() {} },
    Image: class {},
    castleEditor: {
      pointerFromOutside(phase, event) { gestures.push({ phase, event }); },
      hasDocument: () => false,
      getTool: () => 'brush',
      addChangeListener() { return () => {}; }
    },
    dockView: { dockTo() {}, onViewClosed() {} },
    open() { const win = pretendWindow(); opened.push(win); return win; }
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(isoSource, sandbox, { filename: 'iso-view.js' });

  return {
    els, sandbox, gestures, opened,
    view: sandbox.isoView,
    flush() { const due = frames.splice(0); for (const fn of due) fn(); }
  };
}

test('the pretend page is close enough: iso-view actually starts in it', async () => {
  const app = bootIso();
  assert.ok(app.view, 'the view published its commands');
  assert.equal(await app.view.mountDock(), true, 'and it takes the panel');
  assert.equal(app.view.isMounted(), true);
});

test('a cancelled stroke still reaches the editor as a left-button release', async () => {
  // A pointercancel - how a touch or a pen normally ends - carries button -1,
  // and the editor drops anything that is not 0. Its brush or marquee would
  // stay open and the next click would carry on the old stroke.
  const app = bootIso();
  await app.view.mountDock();
  app.flush();                       // the first paint fits the view to the box
  const canvas = app.els.isoDockCanvas;
  const middle = { clientX: SURFACE.width / 2, clientY: SURFACE.height / 2 };

  canvas.fire('pointerdown', Object.assign({ button: 0, pointerId: 5 }, middle));
  assert.equal(app.gestures.at(-1).phase, 'down', 'the press got through');
  assert.deepEqual(app.gestures.at(-1).event.tileFromOutside, { x: 50, y: 49 },
    'and it names the tile in the middle of the map');

  canvas.fire('pointercancel', Object.assign({ button: -1, pointerId: 5 }, middle));
  const release = app.gestures.at(-1);
  assert.equal(release.phase, 'up', 'the cancel arrives as a release');
  assert.equal(release.event.button, 0, 'as the left button, or the editor throws it away');
});

test('two hosts asked for at once: the older attempt gives up its place', async () => {
  // Both ways in wait for the sprite catalogue first, so two clicks in a row
  // can be in the air together. Whichever finished last used to win, which
  // could leave a window open that nobody holds any more: it cannot be
  // closed, it never reports itself closed, and the button has forgotten it.
  const app = bootIso();
  const floating = app.view.openWindow();
  const panel = app.view.mountDock();
  assert.equal(await floating, false, 'the window attempt steps aside');
  assert.equal(await panel, true, 'the panel gets the view');
  assert.equal(app.opened.length, 0, 'and no window was opened for nobody');
  assert.equal(app.view.isMounted(), true);

  const other = bootIso();
  const late = other.view.mountDock();
  const wins = other.view.openWindow();
  assert.equal(await late, false, 'and it works the other way round too');
  assert.equal(await wins, true);
  assert.equal(other.opened.length, 1, 'exactly one window, and it is the held one');
});

// -------------------------------------------------------- the old tests

test('the 17 tests of the 2.5D view still pass, docking and all', () => {
  // The reporter is named on purpose. A run started from inside another run
  // inherits NODE_TEST_CONTEXT and then reports back to its parent in a
  // format meant for machines, which is why reading the output failed the
  // first time. The variable is dropped and the format is asked for.
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(process.execPath,
                           ['--test', '--test-reporter=tap', 'tests/iso-view.test.js'],
                           { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const number = word => {
    const hit = out.match(new RegExp('^# ' + word + ' (\\d+)$', 'm'));
    assert.ok(hit, `could not read "${word}" out of the run:\n` + out.slice(-400));
    return Number(hit[1]);
  };
  assert.equal(number('fail'), 0, out);
  assert.equal(number('tests'), 17, 'still seventeen of them');
  assert.equal(number('pass'), 17);
});
