// The window layout, driven through the real panel-view.js — no screen.
//
// The gestures a user makes are made here instead: press a tab, move the
// hand, let go. What is checked is what the file does with them - which
// window ends up in which box, what the 2.5D view is told, what is written
// to the store. Every one of these used to need the program to be started
// and looked at.
//
// The one thing the test has to do for the browser is lay the boxes out:
// where an area ends up on screen is CSS, and a test cannot copy CSS without
// copying its mistakes as well. So the test says where the boxes are, and
// what is checked is what the view does with those numbers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { makeDocument } = require('./fake-dom.js');

const root = path.join(__dirname, '..');
const G = require(path.join(root, 'src', 'js', 'dock-geometry.js'));
const M = require(path.join(root, 'src', 'js', 'panel-model.js'));

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('src', 'index.html');
const css = read('src', 'css', 'combined.css');
const viewSource = read('src', 'js', 'panel-view.js');

// The box the whole view tree lives in. Not at the origin on purpose: a box
// starting at 0,0 hides every place a screen coordinate was used as if it
// were an offset inside the box.
const BOX = { x: 100, y: 50, w: 1000, h: 600 };
const TAB_HEIGHT = 26;

// Every id panel-view.js asks the document for.
const WINDOW_ELEMENT = { map: 'castleMapWindow', iso: 'castleIsoWindow' };

const IDS = ['castleViewRoot', 'castleWindowStore', 'castleDockOverlay', 'castleDockPreview',
             'castleDockHint', 'castleDragGhost', 'castleMapWindow', 'castleIsoWindow',
             'castleIsoControls', 'castleMapBtn', 'castleIsoBtn'];

function boot(saved) {
  const doc = makeDocument();
  const els = {};
  for (const id of IDS) els[id] = doc.put(id, doc.createElement('div'));
  els.castleWindowStore.appendChild(els.castleIsoControls);
  els.castleDockOverlay.rect = { left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h };

  const calls = [];
  const store = new Map();
  if (saved !== undefined) store.set('castle.panels.v2', JSON.stringify(saved));
  let writes = 0;
  const windowListeners = new Map();

  const sandbox = {
    console,
    dockGeometry: G,
    panelModel: M,
    document: doc,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { writes += 1; store.set(key, value); },
      removeItem: key => store.delete(key)
    },
    addEventListener(type, fn, options) {
      const key = type + (options === true || (options && options.capture) ? ':capture' : '');
      if (!windowListeners.has(key)) windowListeners.set(key, []);
      windowListeners.get(key).push(fn);
    },
    isoView: {
      mountDock() { calls.push('mountDock'); return true; },
      unmount() { calls.push('unmount'); },
      openWindow() { calls.push('openWindow'); return true; },
      fit() { calls.push('fit'); }
    },
    castleEditor: { onWorkspaceShown() { calls.push('editorResize'); } }
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(viewSource, sandbox, { filename: 'panel-view.js' });

  const app = {
    els, doc, calls,
    view: sandbox.window.castlePanels,
    writes: () => writes,
    saved: () => JSON.parse(store.get('castle.panels.v2')),
    fireWindow(type, event, capture) {
      const key = type + (capture ? ':capture' : '');
      const full = Object.assign({ preventDefault() {}, stopPropagation() {} }, event);
      for (const fn of windowListeners.get(key) || []) fn(full);
      return full;
    },
    // The tabs on screen, per area: 'a1: map+iso*' - the star marks the one
    // being shown. Short enough to write a whole layout in one assertion.
    shape() {
      return app.areas().map(area => {
        const tabs = area.querySelectorAll('.areaTab')
          .map(t => t.dataset.window + (t.classList.contains('active') ? '*' : ''));
        return area.dataset.area + ': ' + (tabs.join('+') || '-');
      }).join(' | ');
    },
    areas() { return els.castleViewRoot.querySelectorAll('.viewArea'); },
    areaOf(win) {
      const holder = WINDOW_ELEMENT[win];
      return app.areas().find(a => a.querySelector('.areaBody').children.some(c => c.id === holder));
    },
    // The area whose ROW OF TABS names this window. Not the same question as
    // areaOf: a window that is only an inactive tab is out of the page, and
    // that is exactly right - it still belongs to this box.
    areaOfTab(win) {
      return app.areas().find(a => a.querySelectorAll('.areaTab').some(t => t.dataset.window === win));
    },
    tab(win) {
      return els.castleViewRoot.querySelectorAll('.areaTab').find(t => t.dataset.window === win);
    },
    // Lay the boxes out the way the browser would: shares along the split,
    // 6 px for each splitter, and a strip of tabs at the top of every area.
    layout() {
      place(app.view.getState().root, BOX);
      function place(node, box) {
        if (node.kind === 'area') {
          const el = app.areas().find(a => a.dataset.area === node.id);
          if (!el) return;
          el.rect = { left: box.x, top: box.y, width: box.w, height: box.h };
          const strip = el.querySelector('.areaTabs');
          if (strip) strip.rect = { left: box.x, top: box.y, width: box.w, height: TAB_HEIGHT };
          return;
        }
        const along = node.dir === 'row' ? box.w : box.h;
        const first = Math.round((along - 6) * node.share);
        const second = along - 6 - first;
        if (node.dir === 'row') {
          place(node.a, { x: box.x, y: box.y, w: first, h: box.h });
          place(node.b, { x: box.x + first + 6, y: box.y, w: second, h: box.h });
        } else {
          place(node.a, { x: box.x, y: box.y, w: box.w, h: first });
          place(node.b, { x: box.x, y: box.y + first + 6, w: box.w, h: second });
        }
      }
      return app;
    },
    // One whole drag: press the tab, move, let go.
    dragTab(win, to, opts) {
      const tab = app.tab(win);
      assert.ok(tab, 'no tab for ' + win);
      const from = opts && opts.from ? opts.from : { x: 200, y: 60 };
      tab.fire('pointerdown', { button: 0, pointerId: 7, clientX: from.x, clientY: from.y });
      app.layout();
      app.fireWindow('pointermove', { pointerId: 7, clientX: to.x, clientY: to.y });
      if (opts && opts.beforeDrop) opts.beforeDrop(app);
      if (opts && opts.cancel) return app;
      app.fireWindow('pointerup', { pointerId: 7, clientX: to.x, clientY: to.y });
      app.layout();
      return app;
    }
  };
  app.layout();
  return app;
}

// Where a point is inside an area, as a fraction of it.
function inArea(app, id, fx, fy) {
  const el = app.areas().find(a => a.dataset.area === id);
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}

// --------------------------------------------------------------- the start

test('it starts with the map alone in one box', () => {
  const app = boot();
  assert.match(app.shape(), /^a\d+: map\*$/);
  assert.equal(app.areaOf('map').dataset.area, app.view.getState().root.id,
    'the map hangs in the one area there is');
  assert.equal(app.els.castleIsoBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(app.els.castleMapBtn.getAttribute('aria-pressed'), 'true');
});

test('the map is a window like any other and can be closed', () => {
  const app = boot();
  app.els.castleMapBtn.fire('click', {});
  assert.match(app.shape(), /: -$/, 'an empty box is left behind');
  assert.equal(app.els.castleMapWindow.parentElement.id, 'castleWindowStore',
    'and the map itself is out of the page, not merely hidden');
  assert.equal(app.els.castleMapBtn.getAttribute('aria-pressed'), 'false');
  app.els.castleMapBtn.fire('click', {});
  assert.match(app.shape(), /: map\*$/, 'and it comes back');
});

test('the empty view says what to do with it', () => {
  const app = boot();
  app.els.castleMapBtn.fire('click', {});
  const hint = app.els.castleViewRoot.querySelector('.areaEmptyHint');
  assert.ok(hint, 'the empty box carries a line of text');
  assert.match(hint.textContent, /open one/i);
});

// ------------------------------------------------------------- opening

test('the 2.5D button opens the view beside the map and mounts it', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  assert.match(app.shape(), /^a\d+: map\* \| a\d+: iso\*$/);
  assert.ok(app.calls.includes('mountDock'), 'the slanted view was told to take its canvas');
  assert.ok(app.calls.includes('editorResize'), 'and the map was told to measure again');
  assert.equal(app.els.castleIsoBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(app.els.castleIsoControls.parentElement, app.areaOf('iso').querySelector('.areaTabs'),
    'the view-specific controls live in the 2.5D title bar');
});

test('closing it through the tab bar unmounts it', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.calls.length = 0;
  const isoArea = app.areaOf('iso');
  const close = isoArea.querySelectorAll('.areaAction').find(b => b.dataset.act === 'close');
  close.fire('click', {});
  assert.match(app.shape(), /^a\d+: map\*$/, 'the box is gone and the map has the room');
  assert.ok(app.calls.includes('unmount'), 'the slanted view let its canvas go');
});

test('the surviving window forgets its old split share and fills the root again', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  const mapArea = app.areaOf('map');
  assert.equal(mapArea.style.flex, '0.6 1 0', 'the split gives the map its adjustable share');

  app.els.castleIsoBtn.fire('click', {});
  assert.equal(app.view.getState().root.kind, 'area');
  assert.equal(app.els.castleViewRoot.firstChild, mapArea, 'the surviving area is reused');
  assert.equal(mapArea.style.flex, undefined, 'but its stale split share is cleared');
});

// --------------------------------------------------------- dragging tabs

test('a tab dragged into the middle of the other box joins it as a tab', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const mapId = app.areaOf('map').dataset.area;
  app.dragTab('iso', inArea(app, mapId, 0.5, 0.5));
  assert.match(app.shape(), /^a\d+: map\+iso\*$/, 'one box, two tabs, the dropped one shown');
  assert.equal(app.areaOfTab('iso').dataset.area, app.areaOfTab('map').dataset.area,
    'both tabs name the same box');
  assert.equal(app.areaOf('iso').dataset.area, app.areaOfTab('iso').dataset.area,
    'and the window that is shown really hangs in it');
  assert.equal(app.els.castleMapWindow.parentElement.id, 'castleWindowStore',
    'while the one behind it is out of the page, costing nothing');
});

test('a tab dragged onto the row of tabs joins it there too', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const mapArea = app.areaOf('map');
  const strip = mapArea.querySelector('.areaTabs').getBoundingClientRect();
  app.dragTab('iso', { x: strip.left + strip.width / 2, y: strip.top + 10 });
  assert.match(app.shape(), /^a\d+: map\+iso\*$/);
});

test('a tab dragged to an edge cuts that box in two', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const mapId = app.areaOf('map').dataset.area;
  // 2 % in from the left edge of the map: well inside its band
  app.dragTab('iso', inArea(app, mapId, 0.02, 0.5));
  assert.match(app.shape(), /^a\d+: iso\* \| a\d+: map\*$/, 'the slanted view took the left half');
  assert.equal(app.view.getState().root.dir, 'row');
});

test('a tab can be carried anywhere, including right over the other window', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const ghost = app.els.castleDragGhost;
  const tab = app.tab('iso');
  tab.fire('pointerdown', { button: 0, pointerId: 9, clientX: 900, clientY: 60 });
  assert.equal(ghost.hidden, true, 'a press alone carries nothing');

  app.fireWindow('pointermove', { pointerId: 9, clientX: 902, clientY: 61 });
  assert.equal(ghost.hidden, true, 'and neither does a twitch of two pixels');

  const middle = inArea(app, app.areaOf('map').dataset.area, 0.5, 0.5);
  app.fireWindow('pointermove', { pointerId: 9, clientX: middle.x, clientY: middle.y });
  assert.equal(ghost.hidden, false, 'past the threshold it is carried');
  assert.equal(ghost.style.props['--ghost-x'], middle.x + 'px', 'and it is where the hand is');
  assert.equal(ghost.style.props['--ghost-y'], middle.y + 'px');

  // over the far corner of the map, and out of the column altogether
  for (const point of [{ x: BOX.x + 5, y: BOX.y + BOX.h - 5 }, { x: -400, y: -300 },
                       { x: BOX.x + BOX.w + 900, y: BOX.y + BOX.h + 900 }]) {
    app.fireWindow('pointermove', { pointerId: 9, clientX: point.x, clientY: point.y });
    assert.equal(ghost.hidden, false, 'still carried at ' + point.x + ',' + point.y);
    assert.equal(ghost.style.props['--ghost-x'], point.x + 'px', 'and still under the hand');
  }
  app.fireWindow('pointerup', { pointerId: 9, clientX: -400, clientY: -300 });
  assert.equal(ghost.hidden, true, 'let go, the card is gone');
  assert.match(app.shape(), /iso/, 'and a drop on nothing leaves the layout alone');
});

test('the card steps half aside over a target so the outline can be read', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const ghost = app.els.castleDragGhost;
  const mapId = app.areaOf('map').dataset.area;
  app.dragTab('iso', inArea(app, mapId, 0.5, 0.5), {
    beforeDrop(a) {
      assert.equal(ghost.classList.contains('overTarget'), true, 'half out of the way');
      assert.equal(ghost.hidden, false, 'but never gone - a card nobody can see is a card to guess at');
      assert.equal(a.els.castleDockPreview.hidden, false, 'and the outline is drawn');
      assert.equal(a.els.castleDockPreview.classList.contains('asTab'), true,
        'a tab is outlined differently from a split');
      assert.match(a.els.castleDockHint.textContent, /tab/i);
    }
  });
});

test('the outline sits exactly where the geometry says it does', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const mapId = app.areaOf('map').dataset.area;
  const point = inArea(app, mapId, 0.02, 0.5);
  app.dragTab('iso', point, {
    cancel: true,
    beforeDrop(a) {
      const boxes = a.view.boxes();
      const target = G.dropTargetAt(boxes, point, null);
      const want = G.dropPreviewRect(boxes, target);
      const overlay = a.els.castleDockOverlay.getBoundingClientRect();
      const preview = a.els.castleDockPreview.style.props;
      assert.equal(preview.left, undefined, 'left is written as a style, not a property');
      assert.equal(a.els.castleDockPreview.style.left, (want.x - overlay.left) + 'px');
      assert.equal(a.els.castleDockPreview.style.top, (want.y - overlay.top) + 'px');
      assert.equal(a.els.castleDockPreview.style.width, want.w + 'px');
    }
  });
});

test('Escape during a drag puts everything back and changes nothing', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const before = app.shape();
  const mapId = app.areaOf('map').dataset.area;
  app.dragTab('iso', inArea(app, mapId, 0.02, 0.5), { cancel: true });
  const event = app.fireWindow('keydown', { key: 'Escape' }, true);
  assert.equal(app.els.castleDragGhost.hidden, true, 'the card is put down');
  assert.equal(app.els.castleDockPreview.hidden, true, 'the outline is gone');
  // and a release afterwards must not still drop it somewhere
  app.fireWindow('pointerup', { pointerId: 7, clientX: 150, clientY: 300 });
  assert.equal(app.shape(), before, 'the layout is exactly as it was');
  void event;
});

// -------------------------------------------------------------- keeping it

test('a finished move is stored, a splitter being dragged is not', () => {
  const app = boot();
  app.els.castleIsoBtn.fire('click', {});
  app.layout();
  const saved = app.saved();
  assert.equal(M.openWindows(M.normalize(saved)).length, 2, 'both windows are in the store');

  const splitter = app.els.castleViewRoot.querySelector('.viewSplitter');
  assert.ok(splitter, 'there is a splitter between the two boxes');
  const parent = splitter.parentElement;
  parent.rect = { left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h };
  const before = app.writes();
  splitter.fire('pointerdown', { button: 0, pointerId: 3, clientX: 600, clientY: 300 });
  let last = 600;
  for (let x = 580; x >= 400; x -= 20) {
    app.fireWindow('pointermove', { pointerId: 3, clientX: x, clientY: 300 });
    last = x;
  }
  assert.equal(last, 400);
  assert.equal(app.writes(), before, 'not one write while the hand is moving');
  app.fireWindow('pointerup', { pointerId: 3, clientX: last, clientY: 300 });
  assert.equal(app.writes(), before + 1, 'exactly one when it is let go');
  // 400 is 300 px into a box 1000 wide that starts at 100
  assert.equal(app.view.getState().root.share, 0.3, 'the share is where the hand left it');
});

test('a layout out of the store is used, and rubbish in it is not fatal', () => {
  const good = boot({ v: 2, root: { kind: 'split', dir: 'col', share: 0.7,
                                    a: { kind: 'area', id: 'x1', tabs: ['iso'], active: 'iso' },
                                    b: { kind: 'area', id: 'x2', tabs: ['map'], active: 'map' } } });
  assert.equal(good.shape(), 'x1: iso* | x2: map*', 'read back exactly as it was left');

  const broken = boot({ v: 2, root: { kind: 'split', a: null, b: 'nonsense' } });
  assert.match(broken.shape(), /map/, 'and a broken one starts on the default layout');
});

// ------------------------------------------------------------ the wiring

test('every id the view looks up is really in index.html', () => {
  const wanted = [...viewSource.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const needed = [...viewSource.matchAll(/need\('([^']+)'\)/g)].map(m => m[1]);
  const all = new Set(wanted.concat(needed));
  assert.ok(all.size >= 8, 'found the lookups at all: ' + [...all].join(', '));
  for (const id of all) {
    assert.ok(html.includes('id="' + id + '"'), 'index.html has no #' + id);
  }
  // The two window elements are asked for through the WINDOWS table, not by
  // a literal, so they are read from there.
  for (const win of viewSource.matchAll(/el: '([^']+)'/g)) all.add(win[1]);
  for (const id of IDS) {
    assert.ok(all.has(id), 'the test boots an id the file never asks for: ' + id);
  }
});

test('every class the view switches on exists in the stylesheet', () => {
  const used = new Set();
  for (const call of viewSource.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)) used.add(call[1]);
  for (const call of viewSource.matchAll(/className = '([^']+)'/g)) {
    for (const name of call[1].split(/\s+/)) if (name) used.add(name);
  }
  assert.ok(used.size >= 6, 'found the classes at all: ' + [...used].join(', '));
  for (const name of used) {
    assert.ok(new RegExp('\\.' + name + '\\b').test(css), 'combined.css never mentions .' + name);
  }
});

test('every custom property the view writes is read by the stylesheet', () => {
  const written = new Set([...viewSource.matchAll(/setProperty\('(--[a-z-]+)'/g)].map(m => m[1]));
  assert.deepEqual([...written].sort(), ['--ghost-x', '--ghost-y']);
  for (const name of written) {
    assert.ok(css.includes('var(' + name), 'combined.css never reads var(' + name + ')');
  }
});

test('nothing is left of the old one-panel docking', () => {
  for (const gone of ['data-dock', 'isoDockPanel', 'dockZone', 'dockFloating', 'isoDockGrip']) {
    assert.ok(!css.includes(gone), 'combined.css still has ' + gone);
    assert.ok(!html.includes(gone), 'index.html still has ' + gone);
  }
  assert.ok(!fs.existsSync(path.join(root, 'src', 'js', 'dock-view.js')));
  assert.ok(!fs.existsSync(path.join(root, 'src', 'js', 'dock-model.js')));
  for (const script of ['panel-model.js', 'panel-view.js']) {
    assert.ok(html.includes('js/' + script), 'index.html does not load ' + script);
  }
});

test('a drag binds no listener and builds no second window', () => {
  const from = viewSource.indexOf('function beginDrag');
  const to = viewSource.indexOf('the splitters');
  assert.ok(from > 0 && to > from, 'found the drag section');
  const region = viewSource.slice(from, to);
  assert.ok(!region.includes('addEventListener'), 'the drag binds nothing of its own');
  assert.ok(!region.includes('createElement') || region.indexOf('createElement') > region.length,
    'the window is moved, never copied');
});
