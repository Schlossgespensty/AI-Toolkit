// 2.5D view — the castle as the game draws it.
//
// The castle editor works top-down: every item is a rectangle on a 100x100
// grid. This view takes the very same document and paints it slanted, with
// the real building sprites from the game's own .gm1 archives (exported
// beforehand into assets/aiv/iso by Village Studio's _exportiere_iso.js).
//
// All the arithmetic lives in iso-geometry.js so it can be tested without a
// screen; this file only talks to the canvas and to the app shell.

(() => {
  'use strict';

  const geo = (typeof globalThis !== 'undefined' && globalThis.isoGeometry) || null;
  const CATALOGUE_PATH = '../assets/aiv/iso/verzeichnis.json';
  const SPRITE_PATH = '../assets/aiv/iso/';
  const DETACHED_CANVAS_ID = 'isoDetachedCanvas';

  const state = {
    catalogue: null,
    images: new Map(),
    view: { zoom: 1, panX: 0, panY: 0 },
    fitted: false,
    document: null,
    detached: null
  };

  const els = {};

  // ---------------------------------------------------------- sprites

  async function loadCatalogue() {
    if (state.catalogue) return state.catalogue;
    try {
      const response = await fetch(CATALOGUE_PATH);
      if (!response.ok) throw new Error(String(response.status));
      state.catalogue = await response.json();
    } catch {
      state.catalogue = { gegenstaende: {} };
      setStatus('No sprites found — run _exportiere_iso.js from Village Studio.');
    }
    return state.catalogue;
  }

  function image(filename) {
    if (!filename) return null;
    let img = state.images.get(filename);
    if (img) return img;
    img = new Image();
    img.onload = () => draw();
    img.src = SPRITE_PATH + filename;
    state.images.set(filename, img);
    return img;
  }

  // ---------------------------------------------------------- drawing

  function drawSprite(ctx, sprite, gx, gy, tiles) {
    const img = image(sprite.bild);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const rect = geo.spriteRect(sprite, gx, gy, tiles, state.view);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    return true;
  }

  function drawDiamond(ctx, gx, gy, tiles, fill) {
    ctx.beginPath();
    [[gx, gy], [gx + tiles, gy], [gx + tiles, gy + tiles], [gx, gy + tiles]]
      .forEach(([cx, cy], index) => {
        const [px, py] = geo.isoPoint(cx, cy, state.view);
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function paint(canvas, width, height) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = state.view.zoom < 1;

    // ground
    ctx.fillStyle = '#232a1c';
    ctx.beginPath();
    [[0, 0], [geo.GRID, 0], [geo.GRID, geo.GRID], [0, geo.GRID]].forEach(([cx, cy], index) => {
      const [px, py] = geo.isoPoint(cx, cy, state.view);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();

    const items = geo.collectItems(state.document, state.catalogue);
    if (!items.length) return { items: 0, missing: 0 };

    for (const plate of geo.collectPlates(items).sort(geo.byDepth))
      drawSprite(ctx, plate.sprite, plate.gx, plate.gy, plate.tiles);

    let missing = 0;
    for (const item of items.sort(geo.byDepth)) {
      if (item.entry && drawSprite(ctx, item.entry, item.gx, item.gy, item.tiles)) continue;
      drawDiamond(ctx, item.gx, item.gy, item.tiles, 'rgba(210,170,90,.55)');
      missing++;
    }
    return { items: items.length, missing };
  }

  function draw() {
    if (!els.canvas || !geo) return;
    const host = els.canvas.parentElement;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!state.fitted) { state.view = geo.fitView(rect.width, rect.height); state.fitted = true; }
    const result = paint(els.canvas, rect.width, rect.height);
    if (els.zoom) els.zoom.textContent = Math.round(state.view.zoom * 100) + ' %';
    setStatus(result.items
      ? result.items + ' items' + (result.missing ? ', ' + result.missing + ' without a sprite' : '')
      : (state.document ? 'Nothing placed yet.' : 'Open a castle in the Castle tab.'));
    paintDetached();
  }

  function setStatus(text) { if (els.status) els.status.textContent = text; }

  // ------------------------------------------------------ detached window

  function paintDetached() {
    const win = state.detached;
    if (!win || win.closed) return;
    const canvas = win.document.getElementById(DETACHED_CANVAS_ID);
    if (!canvas) return;
    const width = win.innerWidth, height = win.innerHeight;
    const keep = state.view;
    state.view = geo.fitView(width, height);
    try { paint(canvas, width, height); } finally { state.view = keep; }
  }

  function detach() {
    const win = window.open('', 'aiToolkitIsoView', 'width=1200,height=820');
    if (!win) { setStatus('The window could not be opened.'); return; }
    state.detached = win;
    win.document.title = '2.5D view';
    win.document.body.style.cssText = 'margin:0;background:#171a14;overflow:hidden';
    win.document.body.innerHTML =
      '<canvas id="' + DETACHED_CANVAS_ID + '" style="display:block"></canvas>';
    win.addEventListener('resize', paintDetached);
    setTimeout(paintDetached, 100);
  }

  // ------------------------------------------------------------- wiring

  function refresh() {
    const editor = window.castleEditor;
    state.document = (editor && editor.hasDocument && editor.hasDocument()) ? editor.getDocument() : null;
    draw();
  }

  function fit() { state.fitted = false; draw(); }

  function bind() {
    els.canvas = document.getElementById('isoCanvas');
    els.status = document.getElementById('isoStatus');
    els.zoom = document.getElementById('isoZoomValue');
    if (!els.canvas) return;

    let dragging = false, lastX = 0, lastY = 0;
    els.canvas.addEventListener('pointerdown', event => {
      dragging = true; lastX = event.clientX; lastY = event.clientY;
      els.canvas.setPointerCapture(event.pointerId);
    });
    els.canvas.addEventListener('pointermove', event => {
      if (!dragging) return;
      state.view.panX += event.clientX - lastX;
      state.view.panY += event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
      draw();
    });
    els.canvas.addEventListener('pointerup', () => { dragging = false; });
    els.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const before = state.view.zoom;
      const next = Math.max(0.15, Math.min(8, before * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const rect = els.canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left, my = event.clientY - rect.top;
      state.view.zoom = next;
      state.view.panX = mx - (mx - state.view.panX) * (next / before);
      state.view.panY = my - (my - state.view.panY) * (next / before);
      draw();
    }, { passive: false });

    const on = (id, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    };
    on('isoRefresh', refresh);
    on('isoFit', fit);
    on('isoDetach', detach);
    window.addEventListener('resize', () => draw());
  }

  async function init() {
    bind();
    await loadCatalogue();
  }

  window.isoView = {
    init,
    refresh,
    onWorkspaceShown() { refresh(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
