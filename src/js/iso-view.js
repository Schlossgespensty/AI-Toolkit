// 2.5D view — the castle drawn the way the game draws it.
//
// Opened from the Castle tab. It is not a second editor: every click is
// turned into a tile and handed to the castle editor, which then does what
// its current tool says. Single, Line, Brush, Select/Move, Copy and Delete
// therefore work exactly as on the top-down map, including undo, previews
// and build steps - there is no second set of rules to keep in step.
//
// The view can live in one of two hosts: the panel inside the castle column
// (#castleIsoWindow) or a window of its own. Only ever one of them, and both
// share this one set of drawing routines - the surface changes, the picture
// does not. Which host is in use is dock-view.js's decision, not this file's.
//
// All the arithmetic lives in iso-geometry.js and is tested without a
// screen (tests/iso-view.test.js).

(() => {
  'use strict';

  const geo = (typeof globalThis !== 'undefined' && globalThis.isoGeometry) || null;
  const CATALOGUE_PATH = '../assets/aiv/iso/verzeichnis.json';
  const SPRITE_PATH = '../assets/aiv/iso/';
  const MAX_RENDER_DPR = 1.5;

  const state = {
    catalogue: null,
    images: new Map(),
    view: { zoom: 1, panX: 0, panY: 0 },
    fitted: false,
    // { kind: 'dock' | 'window', win, box, canvas, statusEl }
    host: null,
    // Counts up on every attempt to take a host. Both attempts wait for the
    // catalogue first, so two clicks in quick succession can both be in the
    // air; without this the slower one would finish last and overwrite the
    // newer host - leaving, in the worst case, a window nobody holds any
    // more: it cannot be closed, it never reports itself closed, and the
    // button no longer belongs to it.
    mountToken: 0,
    observer: null,
    bound: new WeakSet(),
    paintPending: false,
    panning: false,
    panStart: null,
    drawing: false,
    hover: null
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
    img.onload = () => refresh();
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
    const variant = geo.variantFor(sprite, gx, gy);
    const img = image(variant.bild);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const rect = geo.spriteRect(variant, gx, gy, tiles, state.view);
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

  function hostIsGone() {
    const host = state.host;
    if (!host) return true;
    return host.kind === 'window' && (!host.win || host.win.closed);
  }

  // The size comes from the box, never from the canvas: a canvas can push a
  // flex or grid track wider but never let it shrink again, so measuring it
  // would make a docked panel grow on every frame and never come back.
  // Returns null while the box has no size at all - which happens whenever
  // the Castle tab is hidden, and would otherwise refit the view to 0 by 0.
  function surface() {
    const host = state.host;
    if (!host || !host.canvas || !host.box) return null;
    const rect = host.box.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) return null;
    const win = host.win || window;
    const dpr = Math.min(MAX_RENDER_DPR, Math.max(1, win.devicePixelRatio || 1));
    const canvas = host.canvas;
    const bufferWidth = Math.floor(width * dpr);
    const bufferHeight = Math.floor(height * dpr);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    const ctx = canvas.getContext('2d');
    // setting width resets the transform, so this is redone every time
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, ctx };
  }

  function paint() {
    state.paintPending = false;
    if (!geo || hostIsGone()) return;
    const target = surface();
    if (!target) return;
    const { width, height, ctx } = target;

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

    drawSelection(ctx, items);
    drawPreview(ctx);
    drawMarquee(ctx);

    const editor = window.castleEditor;
    const tool = editor && editor.getTool ? editor.getTool() : '—';
    setStatus(items.length + ' items' + (missing ? ', ' + missing + ' without a sprite' : '') +
              ' · tool: ' + tool + ' · middle mouse pans, wheel zooms');
  }

  // Was ein Klick setzen wuerde - mit dem richtigen Bild, halb durchsichtig.
  // Vorher stand hier nur eine leere Raute, und die zeigte weder, WIE das
  // Gebaeude aussieht, noch WIE VIELE Felder ein breiter Pinsel deckt.
  function drawPreview(ctx) {
    const editor = window.castleEditor;
    if (!editor || !editor.getPlacementPreview) return;
    const vorschau = editor.getPlacementPreview();
    if (!vorschau || !vorschau.tiles.length) return;
    const eintrag = state.catalogue && state.catalogue.gegenstaende
      ? state.catalogue.gegenstaende[String(vorschau.itemType)] : null;
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (const feld of vorschau.tiles) {
      const gx = feld.x, gy = geo.GRID - 1 - feld.y;
      const kacheln = eintrag ? eintrag.kacheln : 1;
      if (!eintrag || !drawSprite(ctx, eintrag, gx, gy, kacheln))
        drawDiamond(ctx, gx, gy, kacheln, 'rgba(120,220,140,.45)', 'rgba(150,240,170,.9)');
    }
    ctx.restore();
  }

  // Was ausgewaehlt ist, bekommt einen Rahmen. Der Editor fuehrt die Auswahl,
  // diese Ansicht zeigt sie nur - so kann sie nicht von der Karte abweichen.
  function drawSelection(ctx, items) {
    const editor = window.castleEditor;
    if (!editor || !editor.getSelection) return;
    const selected = editor.getSelection();
    if (!selected || !selected.size) return;
    for (const item of items) {
      if (!selected.has(item.ref)) continue;
      drawDiamond(ctx, item.gx, item.gy, item.tiles, 'rgba(120,190,255,.22)', 'rgba(150,205,255,.95)');
    }
  }

  // Der laufende Auswahlkasten. In der schraegen Ansicht ist ein Rechteck der
  // Karte eine Raute - deshalb kommt der Umriss aus der Geometrie und wird
  // hier nur nachgezogen. Rot, wenn geloescht wird: dieselbe Farbe wie auf
  // der Karte, damit die beiden Ansichten dasselbe sagen.
  function drawMarquee(ctx) {
    const editor = window.castleEditor;
    if (!editor || !editor.getMarquee) return;
    const box = editor.getMarquee();
    const ecken = box && geo.marqueeOutline(box, state.view);
    if (!ecken) return;
    ctx.save();
    ctx.beginPath();
    ecken.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    const loeschen = box.kind === 'delete-marquee';
    ctx.fillStyle = loeschen ? 'rgba(220,90,80,.18)' : 'rgba(120,190,255,.16)';
    ctx.strokeStyle = loeschen ? 'rgba(240,120,110,.95)' : 'rgba(150,205,255,.95)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // One repaint per frame at most. The editor now tells the view about every
  // change it makes, and a build step can be a hundred of them in a row.
  function refresh() {
    if (state.paintPending || hostIsGone()) return;
    state.paintPending = true;
    requestAnimationFrame(paint);
  }

  function setStatus(text) {
    if (state.host && state.host.statusEl) state.host.statusEl.textContent = text;
  }

  function fit() { state.fitted = false; refresh(); }

  // ------------------------------------------------------------- input

  function pointOf(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // A click becomes a tile, and the tile goes to the castle editor. The
  // editor decides what happens - that is the whole point.
  function toEditor(phase, event, tile) {
    const editor = window.castleEditor;
    if (!editor || !editor.pointerFromOutside) return;
    editor.pointerFromOutside(phase, {
      // A release always says "left button", whatever ended the gesture. A
      // pointercancel - the normal way a touch or a pen finishes - carries
      // button -1, and the editor drops anything that is not 0; its brush or
      // marquee would then stay open and the next click would carry on the
      // old stroke.
      button: phase === 'up' ? 0 : event.button,
      pointerId: event.pointerId || 1,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      tileFromOutside: tile,
      preventDefault() {},
      stopPropagation() {}
    });
    refresh();
  }

  // Bound once per canvas, and a canvas belongs to exactly one host for its
  // whole life, so nothing here ever needs unbinding.
  function bindSurface(canvas) {
    if (!canvas || state.bound.has(canvas)) return;
    state.bound.add(canvas);

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('pointerdown', event => {
      // In a narrow docked panel the pointer leaves the canvas mid-stroke.
      // Without capture the matching pointerup goes to another element and
      // state.drawing would stay stuck on.
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events have no pointer */ }
      if (event.button === 1 || event.button === 2) {      // middle or right: pan
        event.preventDefault();
        state.panning = true;
        const p = pointOf(canvas, event);
        state.panStart = { x: p.x, y: p.y, panX: state.view.panX, panY: state.view.panY };
        return;
      }
      const p = pointOf(canvas, event);
      const tile = geo.editorTileFromPoint(p.x, p.y, state.view);
      if (!tile) return;
      state.drawing = true;
      toEditor('down', event, tile);
    });

    canvas.addEventListener('pointermove', event => {
      const p = pointOf(canvas, event);
      if (state.panning && state.panStart) {
        state.view.panX = state.panStart.panX + p.x - state.panStart.x;
        state.view.panY = state.panStart.panY + p.y - state.panStart.y;
        refresh();
        return;
      }
      const tile = geo.editorTileFromPoint(p.x, p.y, state.view);
      const grid = geo.tileFromPoint(p.x, p.y, state.view);
      const moved = !state.hover || !grid || state.hover.gx !== grid.gx || state.hover.gy !== grid.gy;
      state.hover = grid;
      if (tile && (state.drawing || moved)) toEditor('move', event, tile);
      else if (moved) refresh();
    });

    const ende = event => {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
      if (state.panning) { state.panning = false; state.panStart = null; return; }
      if (!state.drawing) return;
      state.drawing = false;
      const p = pointOf(canvas, event);
      const tile = geo.editorTileFromPoint(p.x, p.y, state.view) ||
                   (state.hover ? { x: state.hover.gx, y: geo.GRID - 1 - state.hover.gy } : null);
      if (tile) toEditor('up', event, tile);
    };
    canvas.addEventListener('pointerup', ende);
    canvas.addEventListener('pointercancel', ende);
    canvas.addEventListener('pointerleave', () => { state.hover = null; refresh(); });

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const before = state.view.zoom;
      const next = Math.max(0.15, Math.min(8, before * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const p = pointOf(canvas, event);
      state.view.zoom = next;
      state.view.panX = p.x - (p.x - state.view.panX) * (next / before);
      state.view.panY = p.y - (p.y - state.view.panY) * (next / before);
      refresh();
    }, { passive: false });
  }

  // Everything around the drawing surface, and the one place the two hosts
  // really differ: a window has to be told about its own size and keys, a
  // panel is watched by a ResizeObserver and shares the app's keyboard.
  function bindHostChrome(host) {
    if (host.kind === 'dock') {
      if (!state.observer) state.observer = new ResizeObserver(() => refresh());
      state.observer.disconnect();
      state.observer.observe(host.box);
      return;
    }
    const win = host.win;
    win.addEventListener('resize', refresh);
    win.addEventListener('beforeunload', () => {
      // Only if this window is still the host. Closing it while docking
      // fires this after the panel has taken over, and clearing the host
      // then would leave the panel blank.
      if (state.host !== host) return;
      state.host = null;
      state.panning = false;
      state.panStart = null;
      state.drawing = false;
      state.hover = null;
      window.castlePanels?.open?.('iso');
    });
    // The editor's own key handler listens on the main window and never
    // hears this one, so the window forwards. A docked panel must NOT do
    // this, or every shortcut would arrive twice.
    win.addEventListener('keydown', event => {
      const editor = window.castleEditor;
      if (!editor || !editor.handleKey) return;
      editor.handleKey(event);
      refresh();
    });
  }

  // ------------------------------------------------------------- hosts

  function isMounted() { return Boolean(state.host) && !hostIsGone(); }

  function closeWindow() {
    const host = state.host;
    if (!host || host.kind !== 'window') return;
    state.host = null;
    try { if (host.win && !host.win.closed) host.win.close(); } catch { /* already gone */ }
  }

  function unmount() {
    const host = state.host;
    if (!host || host.kind !== 'dock') return;
    if (state.observer) state.observer.disconnect();
    state.host = null;
  }

  async function mountDock() {
    const box = document.getElementById('isoDockBody');
    const canvas = document.getElementById('isoDockCanvas');
    const statusEl = document.getElementById('isoDockStatus');
    if (!box || !canvas) return false;
    // Already here: do not reset the fit, or every splitter drag would throw
    // away the user's zoom and pan.
    if (state.host && state.host.kind === 'dock') { refresh(); return true; }
    const token = ++state.mountToken;
    closeWindow();
    await loadCatalogue();
    if (token !== state.mountToken) return false;      // somebody else took over meanwhile
    state.host = { kind: 'dock', win: window, box, canvas, statusEl };
    state.fitted = false;
    bindSurface(canvas);
    bindHostChrome(state.host);
    refresh();
    return true;
  }

  async function openWindow() {
    if (state.host && state.host.kind === 'window' && !hostIsGone()) {
      state.host.win.focus();
      refresh();
      return true;
    }
    const token = ++state.mountToken;
    await loadCatalogue();
    if (token !== state.mountToken) return false;      // somebody else took over meanwhile
    const win = window.open('', 'aiToolkitIsoView', 'width=1280,height=860');
    if (!win) return false;                       // blocked, or no user gesture
    unmount();
    win.document.title = '2.5D view — AI Toolkit';
    win.document.body.style.cssText =
      'margin:0;background:#171a14;overflow:hidden;font:12px/1.4 system-ui,sans-serif;color:#cfd6c8';
    win.document.body.innerHTML =
      '<div id="isoWindowHost" style="position:fixed;inset:0">' +
      '<canvas id="isoWindowCanvas" style="display:block;width:100%;height:100%;cursor:crosshair"></canvas>' +
      '</div>' +
      '<button id="isoWindowDockBtn" type="button" style="position:fixed;top:8px;right:8px;padding:4px 10px;' +
      'border:1px solid #4a5346;border-radius:4px;background:#232a1c;color:#cfd6c8;cursor:pointer">Dock</button>' +
      '<div id="isoWindowStatus" style="position:fixed;left:0;right:0;bottom:0;padding:5px 10px;' +
      'background:rgba(0,0,0,.55);pointer-events:none"></div>';
    state.host = {
      kind: 'window',
      win,
      box: win.document.getElementById('isoWindowHost'),
      canvas: win.document.getElementById('isoWindowCanvas'),
      statusEl: win.document.getElementById('isoWindowStatus')
    };
    state.fitted = false;
    // Dragging a panel back over a window border is not possible - the page
    // gets no pointer position outside its own window - so the way back is
    // this button.
    const back = win.document.getElementById('isoWindowDockBtn');
    if (back) back.addEventListener('click', () => window.castlePanels?.open?.('iso'));
    bindSurface(state.host.canvas);
    bindHostChrome(state.host);
    refresh();
    return true;
  }

  function init() {
    // The toolbar button belongs to panel-view.js: it decides where this
    // view is shown, this file only knows how to be shown.
    bindSurface(document.getElementById('isoDockCanvas'));
    window.castleEditor?.addChangeListener?.(refresh);
    loadCatalogue();
  }

  window.isoView = { init, openWindow, closeWindow, mountDock, unmount, refresh, paint, fit, isMounted };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
