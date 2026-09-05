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

  // The one place a box is read off the screen. Two of them are needed - the
  // overlay to decide against, the panel to carry - and they go through the
  // same three lines so a client rectangle can never be turned into geometry
  // coordinates twice, in two ways.
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function hostRect() {
    // #castleDockOverlay: it ends above the status bar, so the bands the user
    // sees and the zone the drop lands in come from the very same box.
    return rectOf(els.overlay);
  }

  // The panel as it stands in the grid, measured before it is lifted out of
  // it. Afterwards it is fixed to the screen and this would only measure the
  // answer we gave ourselves.
  function panelRect() { return rectOf(els.panel); }

  // The remembered widths, plus whatever the running drag has to add: where
  // it was grabbed and whether it has been aimed yet. Everything the
  // geometry is asked goes through here, so no caller can quietly ask with
  // half the picture.
  function dropOptions(extra) { return Object.assign({ sizes: current.size }, extra); }

  // What the geometry needs to know about the gesture in progress: where the
  // panel was taken hold of, and whether the hand has been anywhere else
  // since.
  function dragOptions() {
    return dropOptions({ from: { x: drag.x0, y: drag.y0 }, armed: drag.armed });
  }

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

  // `view` is one answer from G.dragVisibility: the zone, the box the preview
  // draws, what a release would do, and whether the carried panel is in the
  // way. Nothing is worked out again here - two answers to the same question
  // would be two chances to disagree.
  //
  // Every one of the three things the user is told - the lit band, the
  // preview box, the words - comes from view.drop, the very value the
  // release will act on. Lighting a band by the raw zone instead would
  // promise a dock in the moment before the drag is armed, and reading the
  // words off "there is no zone" would promise a window in the 48 px ring
  // beside the box, where letting go in fact changes nothing.
  function showTarget(rect, view) {
    const side = view.drop.kind === 'dock' ? view.drop.side : null;
    for (const el of els.zones) el.classList.toggle('hot', el.dataset.zone === side);
    const box = view.preview;
    if (box) {
      els.preview.style.left = (box.x - rect.x) + 'px';
      els.preview.style.top = (box.y - rect.y) + 'px';
      els.preview.style.width = box.w + 'px';
      els.preview.style.height = box.h + 'px';
      els.preview.hidden = false;
    } else {
      els.preview.hidden = true;
    }
    const words = view.drop.kind === 'dock' ? 'Dock: ' + view.drop.side
                : view.drop.kind === 'window' ? 'Let go for a window of its own'
                : 'Stay where it is';
    els.hint.textContent = words + ' · Esc cancels';
    say(words + ' · Esc cancels');
  }

  // ------------------------------------------------- carrying the panel

  // The panel leaves the grid and is pinned to the screen instead, at the
  // size it had a moment ago and shrunk to a card the hand can carry across
  // the map. The grid track it came from keeps its width, so the map
  // underneath is not resized once per drag - and neither are the three
  // canvas buffers that hang off it. The shrinking is drawing only, never
  // the panel's own box: a box that really got smaller would send the
  // ResizeObserver in iso-view.js to work at the start and the end of every
  // drag.
  function liftPanel(box, carried) {
    els.panel.style.setProperty('--drag-w', box.w + 'px');
    els.panel.style.setProperty('--drag-h', box.h + 'px');
    carryPanel(carried || box);
    els.panel.classList.add('dockFloating');
  }

  // Per move, and on purpose not once per frame like the splitter: this
  // writes two custom properties that only a transform reads, so there is no
  // layout to batch away - and a panel that lags a frame behind the hand is
  // exactly what "it follows the pointer" must not look like.
  function carryPanel(box) {
    if (!box) return;
    els.panel.style.setProperty('--drag-x', box.x + 'px');
    els.panel.style.setProperty('--drag-y', box.y + 'px');
    if (Number.isFinite(box.scale)) els.panel.style.setProperty('--drag-s', box.scale);
  }

  // Out of the way while a side would take the drop. Only the opacity: the
  // panel keeps its size and its place, so nothing is measured or laid out
  // again when it comes back, and the pointer capture on the grip goes on
  // delivering the rest of the stroke either way.
  function ghostPanel(ghost) {
    els.panel.classList.toggle('dockGhostHidden', ghost === 'hidden');
  }

  // Back into the grid. Safe to call when nothing was ever lifted, so every
  // way out of a drag - drop, Escape, lost window - can simply say it.
  function setPanelDown() {
    els.panel.classList.remove('dockFloating');
    els.panel.classList.remove('dockGhostHidden');
    for (const name of ['--drag-x', '--drag-y', '--drag-w', '--drag-h', '--drag-s']) {
      els.panel.style.removeProperty(name);
    }
  }

  // Where the card sits for this pointer position. Asked twice per move at
  // most, and always with the same three arguments, so the lift and the
  // carry can never put it in two different places.
  function carriedRect(point) {
    return G.dragGhostRect(drag.panel, { x: drag.x0, y: drag.y0 }, point, dragOptions());
  }

  // A second finger on the grip must not take the drag over: the first one's
  // moves and its release would be thrown away, and the panel would hang in
  // the air until the second gesture ended.
  function beginDrag(event) {
    if (drag || current.mode !== 'dock' || event.button !== 0) return;
    event.preventDefault();
    try { els.grip.setPointerCapture(event.pointerId); } catch { /* no real pointer */ }
    // Nothing about the state is touched while dragging, so cancelling has
    // nothing to undo - that is why there is no copy of it here.
    drag = { pointerId: event.pointerId, x0: event.clientX, y0: event.clientY,
             active: false, zone: null, panel: null, armed: false };
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!drag.active) {
      if (Math.hypot(point.x - drag.x0, point.y - drag.y0) < DRAG_THRESHOLD) return;
      drag.active = true;
      // Measured here, not on pointerdown: a plain click on the grip never
      // reads the screen at all. The panel has not moved since the press, so
      // the press is still the honest grab point.
      // A box of no size means the panel is not really on screen. Then it is
      // not carried at all - docking goes on working, and nothing is pinned
      // to the screen at zero by zero, where it could never be found again.
      const box = panelRect();
      drag.panel = box.w > 0 && box.h > 0 ? box : null;
      showZones();
      // Lifted straight into the place and the size it is carried at: the
      // class and the two properties are written in the same turn, so the
      // panel is never painted full size at its old spot for one frame.
      if (drag.panel) liftPanel(drag.panel, carriedRect(point));
    }
    const rect = hostRect();
    const view = G.dragVisibility(rect, point, drag.zone, dragOptions());
    drag.zone = view.zone;
    drag.armed = view.armed;
    // Only a panel that was really lifted is carried and stepped aside. A
    // panel that never left the grid must not be marked as out of the way.
    if (drag.panel) {
      carryPanel(carriedRect(point));
      ghostPanel(view.ghost);
    }
    showTarget(rect, view);
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDragging = drag.active;
    const zone = drag.zone;
    const opts = dragOptions();               // read while the drag is still there
    const rect = hostRect();                  // measured before anything is put away
    drag = null;
    setPanelDown();
    hideZones();
    if (!wasDragging) return;                 // a click on the grip, not a drag
    const action = G.dropAction(rect, { x: event.clientX, y: event.clientY }, zone, opts);
    if (action.kind === 'dock') setState(M.withSize(M.withDock(current, action.side), action.side, action.size));
    else if (action.kind === 'window') popOut();
  }

  function cancelDrag() {
    if (!drag) return;
    drag = null;
    setPanelDown();
    hideZones();
  }

  // ------------------------------------------------------- resizing it

  // Same as beginDrag: a second pointer must not replace a resize that is
  // already under way and lose the first one's release with it.
  function beginResize(event) {
    if (resize || current.mode !== 'dock' || event.button !== 0) return;
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
    els.panel = document.getElementById('isoDockPanel');
    els.preview = document.getElementById('castleDockPreview');
    els.hint = document.getElementById('castleDockHint');
    els.splitter = document.getElementById('isoDockSplitter');
    els.grip = document.getElementById('isoDockGrip');
    els.button = document.getElementById('castleIsoBtn');
    els.status = document.getElementById('castleStatus');
    els.fit = document.getElementById('isoFitBtn');
    els.popOut = document.getElementById('isoPopOutBtn');
    els.close = document.getElementById('isoDockCloseBtn');
    // The panel is in the list: without it there is nothing to carry and
    // nothing to dock, so half-wiring it would only fail later and further
    // away from the cause.
    if (!els.column || !els.overlay || !els.panel || !els.splitter || !els.grip || !els.button) return;
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
