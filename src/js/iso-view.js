// 2.5D view — the castle in its own window, drawn the way the game draws it.
//
// Opened from the Castle tab. It is not a second editor: every click is
// turned into a tile and handed to the castle editor, which then does what
// its current tool says. Single, Line, Brush, Select/Move, Copy and Delete
// therefore work exactly as on the top-down map, including undo, previews
// and build steps - there is no second set of rules to keep in step.
//
// All the arithmetic lives in iso-geometry.js and is tested without a
// screen (tests/iso-view.test.js).

(() => {
  'use strict';

  const geo = (typeof globalThis !== 'undefined' && globalThis.isoGeometry) || null;
  const CATALOGUE_PATH = '../assets/aiv/iso/verzeichnis.json';
  const SPRITE_PATH = '../assets/aiv/iso/';

  const state = {
    catalogue: null,
    images: new Map(),
    view: { zoom: 1, panX: 0, panY: 0 },
    fitted: false,
    win: null,
    canvas: null,
    statusEl: null,
    panning: false,
    panStart: null,
    drawing: false
  };

  // ---------------------------------------------------------- sprites

  async function loadCatalogue() {
    if (state.catalogue) return state.catalogue;
    try {
      const response = await fetch(CATALOGUE_PATH);
      if (!response.ok) throw new Error(String(response.status));
      state.catalogue = await response.json();
    } catch {
      state.catalogue = { gegenstaende: {} };
    }
    return state.catalogue;
  }

  function image(filename) {
    if (!filename) return null;
    let img = state.images.get(filename);
    if (img) return img;
    img = new Image();
    img.onload = () => paint();
    img.src = SPRITE_PATH + filename;
    state.images.set(filename, img);
    return img;
  }

  // ---------------------------------------------------------- drawing

  function currentDocument() {
    const editor = window.castleEditor;
    return (editor && editor.hasDocument && editor.hasDocument()) ? editor.getDocument() : null;
  }

  function drawSprite(ctx, sprite, gx, gy, tiles) {
    const img = image(sprite.bild);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const rect = geo.spriteRect(sprite, gx, gy, tiles, state.view);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    return true;
  }

  function drawDiamond(ctx, gx, gy, tiles, fill, stroke) {
    ctx.beginPath();
    [[gx, gy], [gx + tiles, gy], [gx + tiles, gy + tiles], [gx, gy + tiles]]
      .forEach(([cx, cy], index) => {
        const [px, py] = geo.isoPoint(cx, cy, state.view);
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function paint() {
    if (!state.canvas || !state.win || state.win.closed || !geo) return;
    const width = state.win.innerWidth;
    const height = state.win.innerHeight;
    const canvas = state.canvas;
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    if (!state.fitted) { state.view = geo.fitView(width, height); state.fitted = true; }
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = state.view.zoom < 1;

    ctx.fillStyle = '#232a1c';
    ctx.beginPath();
    [[0, 0], [geo.GRID, 0], [geo.GRID, geo.GRID], [0, geo.GRID]].forEach(([cx, cy], index) => {
      const [px, py] = geo.isoPoint(cx, cy, state.view);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();

    const items = geo.collectItems(currentDocument(), state.catalogue);
    for (const plate of geo.collectPlates(items).sort(geo.byDepth))
      drawSprite(ctx, plate.sprite, plate.gx, plate.gy, plate.tiles);

    let missing = 0;
    for (const item of items.sort(geo.byDepth)) {
      if (item.entry && drawSprite(ctx, item.entry, item.gx, item.gy, item.tiles)) continue;
      drawDiamond(ctx, item.gx, item.gy, item.tiles, 'rgba(210,170,90,.55)');
      missing++;
    }

    // where the mouse is
    if (state.hover) drawDiamond(ctx, state.hover.gx, state.hover.gy, 1, null, 'rgba(255,255,255,.5)');

    const editor = window.castleEditor;
    const tool = editor && editor.getTool ? editor.getTool() : '—';
    setStatus(items.length + ' items' + (missing ? ', ' + missing + ' without a sprite' : '') +
              ' · tool: ' + tool + ' · middle mouse pans, wheel zooms');
  }

  function setStatus(text) { if (state.statusEl) state.statusEl.textContent = text; }

  // ------------------------------------------------------------- input

  function pointOf(event) {
    const rect = state.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // A click becomes a tile, and the tile goes to the castle editor. The
  // editor decides what happens - that is the whole point.
  function toEditor(phase, event, tile) {
    const editor = window.castleEditor;
    if (!editor || !editor.pointerFromOutside) return;
    editor.pointerFromOutside(phase, {
      button: event.button,
      pointerId: event.pointerId || 1,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      tileFromOutside: tile,
      preventDefault() {},
      stopPropagation() {}
    });
    paint();
  }

  function bindWindow(win, canvas) {
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('pointerdown', event => {
      if (event.button === 1 || event.button === 2) {      // middle or right: pan
        event.preventDefault();
        state.panning = true;
        const p = pointOf(event);
        state.panStart = { x: p.x, y: p.y, panX: state.view.panX, panY: state.view.panY };
        return;
      }
      const p = pointOf(event);
      const tile = geo.editorTileFromPoint(p.x, p.y, state.view);
      if (!tile) return;
      state.drawing = true;
      toEditor('down', event, tile);
    });

    canvas.addEventListener('pointermove', event => {
      const p = pointOf(event);
      if (state.panning && state.panStart) {
        state.view.panX = state.panStart.panX + p.x - state.panStart.x;
        state.view.panY = state.panStart.panY + p.y - state.panStart.y;
        paint();
        return;
      }
      const tile = geo.editorTileFromPoint(p.x, p.y, state.view);
      const grid = geo.tileFromPoint(p.x, p.y, state.view);
      const moved = !state.hover || !grid || state.hover.gx !== grid.gx || state.hover.gy !== grid.gy;
      state.hover = grid;
      if (tile && (state.drawing || moved)) toEditor('move', event, tile);
      else if (moved) paint();
    });

    const ende = event => {
      if (state.panning) { state.panning = false; state.panStart = null; return; }
      if (!state.drawing) return;
      state.drawing = false;
      const p = pointOf(event);
      const tile = geo.editorTileFromPoint(p.x, p.y, state.view) ||
                   (state.hover ? { x: state.hover.gx, y: geo.GRID - 1 - state.hover.gy } : null);
      if (tile) toEditor('up', event, tile);
    };
    canvas.addEventListener('pointerup', ende);
    canvas.addEventListener('pointerleave', () => { state.hover = null; paint(); });

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const before = state.view.zoom;
      const next = Math.max(0.15, Math.min(8, before * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const p = pointOf(event);
      state.view.zoom = next;
      state.view.panX = p.x - (p.x - state.view.panX) * (next / before);
      state.view.panY = p.y - (p.y - state.view.panY) * (next / before);
      paint();
    }, { passive: false });

    win.addEventListener('resize', paint);
    win.addEventListener('beforeunload', () => { state.win = null; state.canvas = null; });

    // keyboard: the tool shortcuts of the editor, forwarded
    win.addEventListener('keydown', event => {
      const editor = window.castleEditor;
      if (!editor || !editor.handleKey) return;
      editor.handleKey(event);
      paint();
    });
  }

  // ------------------------------------------------------------ window

  async function open() {
    if (state.win && !state.win.closed) { state.win.focus(); paint(); return; }
    await loadCatalogue();
    const win = window.open('', 'aiToolkitIsoView', 'width=1280,height=860');
    if (!win) return;
    state.win = win;
    state.fitted = false;
    win.document.title = '2.5D view — AI Toolkit';
    win.document.body.style.cssText =
      'margin:0;background:#171a14;overflow:hidden;font:12px/1.4 system-ui,sans-serif;color:#cfd6c8';
    win.document.body.innerHTML =
      '<canvas id="isoWindowCanvas" style="display:block;cursor:crosshair"></canvas>' +
      '<div id="isoWindowStatus" style="position:fixed;left:0;right:0;bottom:0;padding:5px 10px;' +
      'background:rgba(0,0,0,.55);pointer-events:none"></div>';
    state.canvas = win.document.getElementById('isoWindowCanvas');
    state.statusEl = win.document.getElementById('isoWindowStatus');
    bindWindow(win, state.canvas);
    paint();
  }

  function refresh() { if (state.win && !state.win.closed) paint(); }

  function init() {
    const button = document.getElementById('castleIsoBtn');
    if (button) button.addEventListener('click', open);
    loadCatalogue();
  }

  window.isoView = { init, open, refresh, paint };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
