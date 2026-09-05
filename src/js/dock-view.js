// Docking the 2.5D view — the hands, not the head.
//
// Where the panel may go and how wide it may be is decided in
// dock-geometry.js; what state that leaves behind is dock-model.js. This
// file only listens, sets attributes and hands the answers on. It draws
// nothing and it works out nothing of its own - if a number is needed here,
// it belongs in one of the other two files, where it can be tested without
// a screen.
//
// The reference rectangle for everything is #castleDockOverlay: it ends
// above the status bar, so the four bands the user sees and the zone the
// drop lands in are measured from the very same box.

(() => {
  'use strict';

  const G = (typeof globalThis !== 'undefined' && globalThis.dockGeometry) || null;
  const M = (typeof globalThis !== 'undefined' && globalThis.dockModel) || null;

  const STORAGE_KEY = 'castle.isoDock.v1';
  const DRAG_THRESHOLD = 4;          // px before a click becomes a drag
  const KEY_STEP = 16;
  const KEY_STEP_BIG = 64;

  const els = {};
  let current = null;
  let drag = null;
  let resize = null;
  let borrowedStatus = null;

  // ------------------------------------------------------------- storage

  function load() {
    try { return M.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return M.defaultState(); }
  }

  // Only ever after a finished action, never per frame.
  function store() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* private mode */ }
  }

  // ------------------------------------------------------------ measuring

  function hostRect() {
    const r = els.overlay.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function dropOptions() { return { sizes: current.size }; }

  function isVertical(side) { return side === 'left' || side === 'right'; }

  // -------------------------------------------------------------- output

  // The single road from state to screen. It paints nothing and measures
  // nothing: setting --dock-size changes a grid track, the castle canvas's
  // own ResizeObserver notices and redraws itself. Reading a width back in
  // here would make the observer feed itself.
  // The remembered width has to fit the box it is put into. A size stored on
  // a wide screen - or a stray number in the store, where anything up to
  // 4000 counts as valid - would otherwise squeeze the map to nothing, and a
  // map of zero width is a map the user cannot drag back.
  // Only what is written to the screen is clamped, never the stored state:
  // the wide screen gets its width back untouched.
  // While the castle tab is hidden the box measures nothing; then the stored
  // value goes out unchanged and onWorkspaceShown does this again for real.
  function appliedSize() {
    const stored = M.sizeOf(current, current.side);
    const rect = hostRect();
    if (!(rect.w > 0 && rect.h > 0)) return stored;
    return G.panelSize(rect, current.side, stored, dropOptions());
  }

  function applyLayout() {
    els.column.dataset.dock = current.mode === 'dock' ? current.side : 'off';
    els.column.style.setProperty('--dock-size', appliedSize() + 'px');
    els.splitter.setAttribute('aria-orientation', isVertical(current.side) ? 'vertical' : 'horizontal');
    els.button.setAttribute('aria-pressed', current.mode === 'off' ? 'false' : 'true');
  }

  function syncHost() {
    const iso = window.isoView;
    if (!iso) return;
    if (current.mode === 'dock') { iso.mountDock(); return; }
    if (current.mode === 'window') {
      // A window the browser refuses to open would otherwise leave a pressed
      // button with nothing behind it - and since the button then toggles off
      // and back to "window", the panel would be out of reach for good. So a
      // refusal falls back to the panel.
      // "No" can also mean "a newer attempt has taken the view over" - then
      // there is something on screen and nothing to fall back from.
      Promise.resolve(iso.openWindow()).then(ok => {
        if (ok !== false || !current || current.mode !== 'window') return;
        if (iso.isMounted && iso.isMounted()) return;
        dockTo(current.side);
      }).catch(() => {});
      return;
    }
    iso.unmount();
    iso.closeWindow();
  }

  function setState(next) {
    current = next;
    applyLayout();
    store();
    syncHost();
    // the map has a different width now; the guard inside resizeCanvas makes
    // this free when it has not
    window.castleEditor?.onWorkspaceShown?.();
  }

  function say(text) {
    if (!els.status) return;
    if (borrowedStatus === null) borrowedStatus = els.status.textContent;
    els.status.textContent = text;
  }

  function giveStatusBack() {
    if (els.status && borrowedStatus !== null) els.status.textContent = borrowedStatus;
    borrowedStatus = null;
  }

  // --------------------------------------------------------- moving it

  // The bands the user sees come from the same call that will judge the
  // drop, so a band that looks like a hit is a hit.
  function showZones() {
    const bands = G.dockBands(hostRect(), dropOptions());
    els.overlay.style.setProperty('--band-x', bands.bandX + 'px');
    els.overlay.style.setProperty('--band-y', bands.bandY + 'px');
    els.overlay.classList.add('showing');
    els.overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('dockDragging');
  }

  function hideZones() {
    els.overlay.classList.remove('showing');
    els.overlay.setAttribute('aria-hidden', 'true');
    els.preview.hidden = true;
    for (const zone of els.zones) zone.classList.remove('hot');
    document.documentElement.classList.remove('dockDragging');
    giveStatusBack();
  }

  function showTarget(rect, zone) {
    for (const el of els.zones) el.classList.toggle('hot', el.dataset.zone === zone);
    const size = M.sizeOf(current, G.DOCK_SIDES.includes(zone) ? zone : current.side);
    const box = G.dockPreviewRect(rect, zone, size, dropOptions());
    if (box) {
      els.preview.style.left = (box.x - rect.x) + 'px';
      els.preview.style.top = (box.y - rect.y) + 'px';
      els.preview.style.width = box.w + 'px';
      els.preview.style.height = box.h + 'px';
      els.preview.hidden = false;
    } else {
      els.preview.hidden = true;
    }
    const words = box ? 'Dock: ' + zone : zone === 'center' ? 'Stay where it is' : 'Let go outside for a window';
    els.hint.textContent = words + ' · Esc cancels';
    say(words + ' · Esc cancels');
  }

  function beginDrag(event) {
    if (current.mode !== 'dock' || event.button !== 0) return;
    event.preventDefault();
    try { els.grip.setPointerCapture(event.pointerId); } catch { /* no real pointer */ }
    // Nothing about the state is touched while dragging, so cancelling has
    // nothing to undo - that is why there is no copy of it here.
    drag = { pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, active: false, zone: null };
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < DRAG_THRESHOLD) return;
      drag.active = true;
      showZones();
    }
    const rect = hostRect();
    drag.zone = G.stableZone(rect, { x: event.clientX, y: event.clientY }, drag.zone, dropOptions());
    showTarget(rect, drag.zone);
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDragging = drag.active;
    const zone = drag.zone;
    const rect = hostRect();                  // measured before anything is put away
    drag = null;
    hideZones();
    if (!wasDragging) return;                 // a click on the grip, not a drag
    const action = G.dropAction(rect, { x: event.clientX, y: event.clientY }, zone, dropOptions());
    if (action.kind === 'dock') setState(M.withSize(M.withDock(current, action.side), action.side, action.size));
    else if (action.kind === 'window') popOut();
  }

  function cancelDrag() {
    if (!drag) return;
    drag = null;
    hideZones();
  }

  // ------------------------------------------------------- resizing it

  function beginResize(event) {
    if (current.mode !== 'dock' || event.button !== 0) return;
    event.preventDefault();
    try { els.splitter.setPointerCapture(event.pointerId); } catch { /* no real pointer */ }
    resize = {
      pointerId: event.pointerId,
      start: M.sizeOf(current, current.side),
      size: M.sizeOf(current, current.side),
      pending: false
    };
    document.documentElement.classList.add('dockResizing');
  }

  function moveResize(event) {
    if (!resize || event.pointerId !== resize.pointerId) return;
    const result = G.splitterSize(current.side, hostRect(), { x: event.clientX, y: event.clientY },
                                  { sizes: current.size, remembered: resize.start });
    resize.size = result.size;
    resize.snapped = result.snapped;
    if (resize.pending) return;
    // One write per frame. The value written is always the newest one, not
    // the one this move carried, so the panel never lags behind the hand.
    resize.pending = true;
    const running = resize;
    requestAnimationFrame(() => {
      if (resize !== running) return;
      resize.pending = false;
      els.column.style.setProperty('--dock-size', running.size + 'px');
      say(Math.round(running.size) + ' px' + (running.snapped ? ' · snapped' : ''));
    });
  }

  function endResize(event) {
    if (!resize || event.pointerId !== resize.pointerId) return;
    const size = resize.size;
    resize = null;
    document.documentElement.classList.remove('dockResizing');
    giveStatusBack();
    setState(M.withSize(current, current.side, size));
  }

  // Nothing was stored while dragging, so putting the old picture back is the
  // same as painting the untouched state again - and that way the width goes
  // through the same clamp as everywhere else. Writing the remembered number
  // straight out could put a width from a wide screen into a narrow one and
  // push the map, and with it the splitter, out of the column.
  function cancelResize() {
    if (!resize) return;
    resize = null;
    document.documentElement.classList.remove('dockResizing');
    giveStatusBack();
    applyLayout();
  }

  function keyResize(event) {
    if (current.mode !== 'dock') return;
    const rect = hostRect();
    if (!(rect.w > 0 && rect.h > 0)) return;     // hidden tab: there is nothing to measure against
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const grows = isVertical(current.side)
      ? { ArrowLeft: current.side === 'right' ? step : -step, ArrowRight: current.side === 'right' ? -step : step }
      : { ArrowUp: current.side === 'bottom' ? step : -step, ArrowDown: current.side === 'bottom' ? -step : step };
    let size = null;
    // The step starts from the width on screen, not from the remembered one.
    // If the remembered width is above the ceiling of this box, a step away
    // from it would still land above the ceiling and the key would look dead.
    if (grows[event.key]) size = G.panelSize(rect, current.side, M.sizeOf(current, current.side), dropOptions()) + grows[event.key];
    else if (event.key === 'Home') size = 0;                                   // clamps to the minimum
    else if (event.key === 'End') size = isVertical(current.side) ? rect.w : rect.h;   // clamps to the ceiling
    else return;
    event.preventDefault();
    setState(M.withSize(current, current.side, G.panelSize(rect, current.side, size, dropOptions())));
  }

  // ---------------------------------------------------------- commands

  function dockTo(side) { setState(M.withDock(current, side || current.side)); }
  function popOut() { setState(M.withWindow(current)); }
  function hide() { setState(M.withHidden(current)); }

  function toggle() {
    const target = M.toggleTarget(current);
    if (target.kind === 'dock') dockTo(target.side);
    else if (target.kind === 'window') popOut();
    else hide();
  }

  // The window was closed by its own close button: remember that it is gone
  // without asking it to close again.
  function onViewClosed() {
    if (current.mode !== 'window') return;
    current = M.withHidden(current);
    applyLayout();
    store();
  }

  // The castle tab has just become visible. Before that every rectangle in
  // it is zero, so this is the first moment a saved dock can be applied.
  function onWorkspaceShown() {
    if (!current) return;
    applyLayout();
    syncHost();
    window.isoView?.refresh?.();
  }

  function getState() { return M.normalize(current); }

  // -------------------------------------------------------------- wiring

  function init() {
    if (!G || !M) return;
    els.column = document.getElementById('castleCanvasColumn');
    els.overlay = document.getElementById('castleDockOverlay');
    els.preview = document.getElementById('castleDockPreview');
    els.hint = document.getElementById('castleDockHint');
    els.splitter = document.getElementById('isoDockSplitter');
    els.grip = document.getElementById('isoDockGrip');
    els.button = document.getElementById('castleIsoBtn');
    els.status = document.getElementById('castleStatus');
    els.fit = document.getElementById('isoFitBtn');
    els.popOut = document.getElementById('isoPopOutBtn');
    els.close = document.getElementById('isoDockCloseBtn');
    if (!els.column || !els.overlay || !els.splitter || !els.grip || !els.button) return;
    els.zones = Array.from(els.overlay.querySelectorAll('.dockZone'));

    current = M.bootState(load());
    applyLayout();

    els.button.addEventListener('click', toggle);
    els.close?.addEventListener('click', hide);
    els.popOut?.addEventListener('click', popOut);
    els.fit?.addEventListener('click', () => window.isoView?.fit?.());

    els.grip.addEventListener('pointerdown', beginDrag);
    els.grip.addEventListener('pointermove', moveDrag);
    els.grip.addEventListener('pointerup', endDrag);
    els.grip.addEventListener('pointercancel', cancelDrag);

    els.splitter.addEventListener('pointerdown', beginResize);
    els.splitter.addEventListener('pointermove', moveResize);
    els.splitter.addEventListener('pointerup', endResize);
    els.splitter.addEventListener('pointercancel', cancelResize);
    els.splitter.addEventListener('keydown', keyResize);
    els.splitter.addEventListener('dblclick', () => {
      setState(M.withSize(current, current.side, M.DEFAULT_SIZE[current.side]));
    });

    // In the capture phase, so an Escape that cancels a drag is used up here
    // and does not also clear the editor's selection - that handler listens
    // on the same window, but in the bubble phase.
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!drag && !resize) return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
      cancelResize();
    }, true);
    // Alt+Tab in the middle of a drag must not leave the zones on screen.
    window.addEventListener('blur', () => { cancelDrag(); cancelResize(); });

    // The app window itself can get narrower, and the width that fitted a
    // moment ago then does not any more. Without this the panel keeps its old
    // width, the map is squeezed to nothing, and only switching tabs and back
    // puts it right. Not while the splitter is being dragged: that writes the
    // width itself, per frame, and would only be fought over.
    window.addEventListener('resize', () => {
      if (!current || resize) return;
      applyLayout();
    });

    if (window.appWorkspace?.getActive?.() === 'castle') onWorkspaceShown();
  }

  window.dockView = { init, dockTo, popOut, hide, toggle, onWorkspaceShown, onViewClosed, getState };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
