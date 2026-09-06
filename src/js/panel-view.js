// The window layout on screen — the hands, not the head.
//
// What the layout IS lives in panel-model.js, what a drop MEANS in
// dock-geometry.js. This file only builds boxes, moves two elements between
// them and listens. If a number is wanted here, it belongs in one of the
// other two, where it can be tested without a screen.
//
// The two windows - the map from above and the slanted 2.5D view - are the
// very elements that were already in the page. They are moved, never copied:
// a second canvas would be a second thing to draw and to keep in step, and
// castle-editor.js holds on to the one it was given at startup.

(() => {
  'use strict';

  const G = (typeof globalThis !== 'undefined' && globalThis.dockGeometry) || null;
  const M = (typeof globalThis !== 'undefined' && globalThis.panelModel) || null;

  const STORAGE_KEY = 'castle.panels.v2';
  const DRAG_THRESHOLD = 4;      // px before a click on a tab becomes a drag
  const AREA_MIN = 120;          // px an area keeps when a splitter is dragged

  // Everything the layout needs to know about a window: what it is called,
  // which element holds it, and who to tell when it comes and goes.
  // `actions` are the buttons the row of tabs offers while this window is
  // the one being shown - the things that belong to the window itself, not
  // to the box it happens to sit in.
  const WINDOWS = {
    map: { title: 'Map', el: 'castleMapWindow', actions: [] },
    iso: { title: '2.5D', el: 'castleIsoWindow', actions: [
      { act: 'fit', glyph: '⤢', title: 'Fit the castle into the view' },
      { act: 'popout', glyph: '⧉', title: 'Show in a window of its own' }
    ] }
  };

  const els = {};
  let current = null;
  let drag = null;
  let sizing = null;
  let listeners = [];

  // ------------------------------------------------------------- storage

  function load() {
    try { return M.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return M.defaultState(); }
  }

  function store() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* private mode */ }
  }

  // ------------------------------------------------------------ measuring

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // One box per area, as the geometry wants them: where it is, and where its
  // row of tabs is. Measured, never worked out - what the user sees is what
  // decides, and a second calculation would be a second chance to disagree.
  function areaBoxes() {
    const boxes = [];
    for (const [id, el] of built) {
      if (!el.isConnected) continue;
      const rect = rectOf(el);
      if (!(rect.w > 0 && rect.h > 0)) continue;
      const strip = el.querySelector('.areaTabs');
      boxes.push({ id, rect, tabs: strip ? rectOf(strip) : null });
    }
    return boxes;
  }

  // ------------------------------------------------------------ building

  // Areas already on screen, by id. Kept so that a layout change moves the
  // boxes that changed and leaves the others exactly where they are - a
  // rebuilt box means a canvas taken out of the page and put back, and that
  // is a redraw the user did not ask for.
  const built = new Map();

  function areaElement(node) {
    let el = built.get(node.id);
    if (!el) {
      el = document.createElement('section');
      el.className = 'viewArea';
      el.dataset.area = node.id;
      const tabs = document.createElement('header');
      tabs.className = 'areaTabs';
      const body = document.createElement('div');
      body.className = 'areaBody';
      el.append(tabs, body);
      built.set(node.id, el);
    }
    fillTabs(el, node);
    fillBody(el, node);
    return el;
  }

  function fillTabs(el, node) {
    const strip = el.querySelector('.areaTabs');
    strip.textContent = '';
    for (const win of node.tabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'areaTab' + (win === node.active ? ' active' : '');
      tab.dataset.window = win;
      tab.dataset.area = node.id;
      tab.textContent = (WINDOWS[win] && WINDOWS[win].title) || win;
      tab.title = 'Click to show, drag to move it somewhere else';
      strip.appendChild(tab);
    }
    const fill = document.createElement('span');
    fill.className = 'areaFill';
    strip.appendChild(fill);
    if (node.tabs.length) {
      const shown = WINDOWS[node.active];
      for (const action of (shown && shown.actions) || []) {
        strip.appendChild(actionButton(action.act, action.glyph, action.title, node.id));
      }
      strip.appendChild(actionButton('close', '✕', 'Close the window shown here', node.id));
    } else {
      const hint = document.createElement('span');
      hint.className = 'areaEmptyHint';
      hint.textContent = 'no window — open one from the toolbar';
      strip.insertBefore(hint, fill);
    }
  }

  function actionButton(act, glyph, title, areaId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'areaAction';
    button.dataset.act = act;
    button.dataset.area = areaId;
    button.title = title;
    button.textContent = glyph;
    return button;
  }

  // The windows themselves. Only the active one hangs in the body; the
  // others wait in the store, out of the page, where they cost nothing to
  // keep and no ResizeObserver fires for them.
  function fillBody(el, node) {
    const body = el.querySelector('.areaBody');
    const wanted = node.active && WINDOWS[node.active] ? els.windows[node.active] : null;
    for (const child of Array.from(body.children)) {
      if (child !== wanted) els.store.appendChild(child);
    }
    if (wanted && wanted.parentElement !== body) body.appendChild(wanted);
  }

  function buildNode(node, path) {
    if (node.kind === 'area') return areaElement(node);
    const box = document.createElement('div');
    box.className = 'viewSplit';
    box.dataset.dir = node.dir;
    const a = buildNode(node.a, path + 'a');
    const b = buildNode(node.b, path + 'b');
    a.style.flex = node.share + ' 1 0';
    b.style.flex = (1 - node.share) + ' 1 0';
    const bar = document.createElement('div');
    bar.className = 'viewSplitter';
    bar.dataset.path = path;
    bar.dataset.dir = node.dir;
    bar.setAttribute('role', 'separator');
    bar.setAttribute('tabindex', '0');
    bar.setAttribute('aria-orientation', node.dir === 'row' ? 'vertical' : 'horizontal');
    bar.setAttribute('aria-label', 'Resize');
    box.append(a, bar, b);
    return box;
  }

  function render() {
    const seen = new Set(M.areas(current.root).map(a => a.id));
    const tree = buildNode(current.root, '');
    if (els.root.firstChild !== tree) {
      els.root.textContent = '';
      els.root.appendChild(tree);
    }
    // Boxes that are no longer in the layout give their windows back and are
    // forgotten, or the map would grow one dead box per drag.
    for (const [id, el] of Array.from(built)) {
      if (seen.has(id)) continue;
      for (const child of Array.from(el.querySelector('.areaBody').children)) {
        els.store.appendChild(child);
      }
      built.delete(id);
    }
    els.root.classList.toggle('isEmpty', M.openWindows(current).length === 0);
    updateButtons();
  }

  function updateButtons() {
    for (const [win, info] of Object.entries(WINDOWS)) {
      const button = els.buttons[win];
      if (button) button.setAttribute('aria-pressed', M.isOpen(current, win) ? 'true' : 'false');
      void info;
    }
  }

  // The two editors, told what happened to them. A window that is not shown
  // is out of the page, so the slanted view lets go of its canvas: an
  // observer watching a box of no size is an observer that measures nothing
  // and redraws for nothing. The map needs no such switch - its resizeCanvas
  // turns back at a box of zero size on its own.
  function syncWindows() {
    const iso = window.isoView;
    if (iso) {
      if (isShown('iso')) { if (iso.mountDock) iso.mountDock(); }
      else if (iso.unmount) iso.unmount();
    }
    const editor = window.castleEditor;
    if (editor && editor.onWorkspaceShown) editor.onWorkspaceShown();
  }

  function isShown(win) {
    if (!current || !M.isOpen(current, win)) return false;
    const holder = M.areaOf(current, win);
    return Boolean(holder) && holder.active === win;
  }

  function announce() {
    for (const fn of listeners) { try { fn(current); } catch { /* a listener must not stop the layout */ } }
  }

  // `how` says what a change is worth: a splitter being dragged only redraws
  // - writing the store and remounting a canvas per frame of a drag is work
  // nobody sees. Everything else is a finished action and is kept.
  function setState(next, how) {
    current = next;
    render();
    if (!how || how.store !== false) store();
    if (!how || how.sync !== false) syncWindows();
    announce();
  }

  // --------------------------------------------------------- the drag

  function tabAt(event) {
    const el = event.target && event.target.closest ? event.target.closest('.areaTab') : null;
    return el && el.dataset.window ? el : null;
  }

  function beginDrag(event) {
    if (drag || event.button !== 0) return;
    const tab = tabAt(event);
    if (!tab) return;
    // Clicking a tab shows its window straight away; the drag, if it turns
    // into one, moves that same window. Waiting for the release to show it
    // would mean every drag started by showing something else.
    setState(M.select(current, tab.dataset.area, tab.dataset.window));
    event.preventDefault();
    try { tab.setPointerCapture(event.pointerId); } catch { /* no real pointer */ }
    drag = { pointerId: event.pointerId, win: tab.dataset.window, tab,
             x0: event.clientX, y0: event.clientY, active: false, target: null };
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!drag.active) {
      if (Math.hypot(point.x - drag.x0, point.y - drag.y0) < DRAG_THRESHOLD) return;
      drag.active = true;
      showGhost(drag.win);
      els.overlay.classList.add('showing');
      els.overlay.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('dockDragging');
    }
    carryGhost(point);
    const target = G.dropTargetAt(areaBoxes(), point, drag.target);
    drag.target = target;
    showTarget(target);
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDragging = drag.active;
    const target = drag.target;
    const win = drag.win;
    drag = null;
    hideGhost();
    hideTarget();
    if (!wasDragging || !target) return;
    setState(M.place(current, win, target.areaId, target.where));
  }

  function cancelDrag() {
    if (!drag) return;
    drag = null;
    hideGhost();
    hideTarget();
  }

  // The card under the hand. A small one on purpose: the window it stands
  // for is as big as the box it came from, and a full-size copy of that can
  // never be seen over the map it is being carried across.
  function showGhost(win) {
    els.ghost.textContent = (WINDOWS[win] && WINDOWS[win].title) || win;
    els.ghost.hidden = false;
  }

  function carryGhost(point) {
    els.ghost.style.setProperty('--ghost-x', point.x + 'px');
    els.ghost.style.setProperty('--ghost-y', point.y + 'px');
  }

  function hideGhost() {
    els.ghost.hidden = true;
    els.overlay.classList.remove('showing');
    els.overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('dockDragging');
  }

  function showTarget(target) {
    const box = G.dropPreviewRect(areaBoxes(), target);
    if (!box) { hideTarget(); return; }
    const host = rectOf(els.overlay);
    els.preview.style.left = (box.x - host.x) + 'px';
    els.preview.style.top = (box.y - host.y) + 'px';
    els.preview.style.width = box.w + 'px';
    els.preview.style.height = box.h + 'px';
    els.preview.hidden = false;
    els.preview.classList.toggle('asTab', target.where === 'tab');
    // Half out of the way while a target is lit, so the outline underneath
    // can be seen. Not gone: a card that disappears is a card the user has
    // to guess the position of.
    els.ghost.classList.add('overTarget');
    const words = target.where === 'tab' ? 'Add as a tab here' : 'Split: ' + target.where;
    els.hint.textContent = words + ' · Esc cancels';
    els.hint.hidden = false;
  }

  function hideTarget() {
    els.preview.hidden = true;
    els.hint.hidden = true;
    els.ghost.classList.remove('overTarget');
  }

  // ------------------------------------------------------- the splitters

  function beginSize(event) {
    const bar = event.target && event.target.closest ? event.target.closest('.viewSplitter') : null;
    if (!bar || event.button !== 0) return;
    event.preventDefault();
    try { bar.setPointerCapture(event.pointerId); } catch { /* no real pointer */ }
    sizing = { pointerId: event.pointerId, path: bar.dataset.path, dir: bar.dataset.dir,
               rect: rectOf(bar.parentElement) };
    document.documentElement.classList.add('dockResizing');
  }

  function moveSize(event) {
    if (!sizing || event.pointerId !== sizing.pointerId) return;
    const share = G.shareFromPoint(sizing.rect, sizing.dir,
                                   { x: event.clientX, y: event.clientY }, AREA_MIN);
    if (share === null) return;
    setState(M.resize(current, sizing.path, share), { store: false, sync: false });
  }

  function endSize(event) {
    if (!sizing || event.pointerId !== sizing.pointerId) return;
    sizing = null;
    document.documentElement.classList.remove('dockResizing');
    store();
  }

  // ------------------------------------------------------------- clicks

  function onClick(event) {
    const act = event.target && event.target.closest ? event.target.closest('.areaAction') : null;
    if (act) { runAction(act.dataset.act, act.dataset.area); return; }
    const tab = tabAt(event);
    if (tab) setState(M.select(current, tab.dataset.area, tab.dataset.window));
  }

  function runAction(act, areaId) {
    const node = M.findArea(current, areaId);
    if (!node || !node.active) return;
    if (act === 'close') { setState(M.close(current, node.active)); return; }
    const iso = window.isoView;
    if (act === 'fit' && iso && iso.fit) iso.fit();
    // A window of its own leaves the tree: it is not in any box any more,
    // and the way back is the button inside that window, which asks for it
    // to be opened again.
    if (act === 'popout' && iso && iso.openWindow) {
      Promise.resolve(iso.openWindow()).then(ok => {
        if (ok !== false) setState(M.close(current, 'iso'));
      }).catch(() => {});
    }
  }

  function onKey(event) {
    if (event.key !== 'Escape' || !drag) return;
    cancelDrag();
    event.preventDefault();
    event.stopPropagation();
  }

  // ---------------------------------------------------------------- boot

  function need(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error('panel-view: #' + id + ' is missing');
    return el;
  }

  function start() {
    if (!G || !M) return;
    els.root = need('castleViewRoot');
    els.store = need('castleWindowStore');
    els.overlay = need('castleDockOverlay');
    els.preview = need('castleDockPreview');
    els.hint = need('castleDockHint');
    els.ghost = need('castleDragGhost');
    els.windows = {};
    for (const [win, info] of Object.entries(WINDOWS)) els.windows[win] = need(info.el);
    els.buttons = { map: document.getElementById('castleMapBtn'),
                    iso: document.getElementById('castleIsoBtn') };

    // The three things a drag shows are put away here, not left to the HTML:
    // whether they start hidden is this file's business, and a page that
    // forgot the attribute would start with a card hanging in the corner.
    hideGhost();
    hideTarget();

    current = load();
    render();

    els.root.addEventListener('pointerdown', event => { beginDrag(event); beginSize(event); });
    els.root.addEventListener('click', onClick);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('pointermove', moveSize);
    window.addEventListener('pointerup', endSize);
    // In the capture phase: a running drag swallows Escape before the editor
    // sees it, or cancelling a drag would also clear the selection.
    window.addEventListener('keydown', onKey, true);

    for (const [win, button] of Object.entries(els.buttons)) {
      if (button) button.addEventListener('click', () => setState(M.toggle(current, win)));
    }
    announce();
  }

  window.castlePanels = {
    start,
    // The castle tab has just been shown: its boxes have a size again, so
    // the windows in them can go back to work.
    onWorkspaceShown: () => { if (current) syncWindows(); },
    getState: () => current,
    isOpen: win => Boolean(current) && M.isOpen(current, win),
    isShown,
    open: win => setState(M.open(current, win)),
    close: win => setState(M.close(current, win)),
    toggle: win => setState(M.toggle(current, win)),
    onChange: fn => { if (typeof fn === 'function') listeners.push(fn); },
    // for the tests: the boxes as the geometry sees them
    boxes: areaBoxes
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
