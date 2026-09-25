/* Shared by Map and detached 2.5D canvases. No pointer lock or focus stealing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.castlePieMenu = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const tr = (key, options) => (globalThis.toolkitI18n || require('./i18n')).t(key, options);
  function direction(dx, dy) {
    if (Math.hypot(dx, dy) < 24) return 'deselect';
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'replace' : 'groups') : (dy > 0 ? 'cut' : 'merge');
  }
  const bound = new WeakSet();
  function bind(canvas, run, getShortcut = () => '', neutralAction = () => 'deselect') {
    if (bound.has(canvas)) return;
    bound.add(canvas);
    const doc = canvas.ownerDocument, win = doc.defaultView;
    let menu = null, gesture = null, swallowMenuUntil = 0;
    const labels = {merge:'common:actions.merge', groups:'castle:groups', replace:'common:actions.replace', cut:'castle:cut_and_copy', deselect:'castle:deselect'};
    function close() {
      const pointer = gesture?.id;
      gesture = null; menu?.remove(); menu = null;
      if (pointer != null && canvas.hasPointerCapture?.(pointer)) canvas.releasePointerCapture(pointer);
    }
    function open(x, y, id) {
      if (!gesture || gesture.id !== id) close();
      menu = doc.createElement('div');
      menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', tr("castle:castle_actions"));
      menu.className = 'castlePieMenu';
      const cx = Math.max(114, Math.min(x, win.innerWidth-114)), cy = Math.max(114, Math.min(y, win.innerHeight-114));
      menu.style.left = (cx-112)+'px'; menu.style.top = (cy-112)+'px';
      const positions = {merge:[70,20], groups:[3,92], replace:[153,92], cut:[70,165], deselect:[80,92]};
      for (const [action,label] of Object.entries(labels)) {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = tr(label);
        const shortcut = getShortcut(action);
        if (shortcut) {
          const key = doc.createElement('small'); key.textContent = shortcut.toUpperCase();
          button.appendChild(key);
        }
        button.dataset.action = action; button.setAttribute('role', 'menuitem');
        if (action === 'groups' || action === 'replace' || action === 'deselect') button.style.width = '68px';
        button.style.left = positions[action][0]+'px'; button.style.top = positions[action][1]+'px';
        button.addEventListener('click', () => { close(); run(action, {x, y, document:doc}); }); menu.appendChild(button);
      }
      doc.body.appendChild(menu);
      // Gesture coordinates remain at the click, even when the visual menu is clamped at an edge.
      gesture = id == null ? null : {x, y, id, center:'deselect'};
      if (id == null) menu.querySelector('button').focus();
      else highlight('deselect');
    }
    function highlight(action) {
      const sectors = ['replace', 'cut', 'groups', 'merge'];
      menu.style.background = 'conic-gradient(from 45deg,' + sectors.map((name, i) => 'var(--line-strong) '+(i*90)+'deg '+(i*90+1)+'deg,'+(name === action ? 'var(--accent-soft)' : 'var(--component-menu-surface)')+' '+(i*90+1)+'deg '+((i+1)*90)+'deg').join(',') + ')';
      for (const button of menu.children) button.style.background = button.dataset.action === 'deselect' ? (action === 'deselect' ? 'var(--accent-soft)' : 'var(--component-menu-surface)') : 'transparent';
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 2) return;
      event.preventDefault(); event.stopImmediatePropagation();
      canvas.focus?.({preventScroll:true});
      close();
      gesture = {x:event.clientX, y:event.clientY, id:event.pointerId, center:neutralAction()};
      if (gesture.center !== 'groups') open(gesture.x, gesture.y, gesture.id);
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (gesture.center === 'groups') return;
      const action = direction(event.clientX-gesture.x, event.clientY-gesture.y);
      if (menu) highlight(action);
    }, true);
    canvas.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const action = gesture.center === 'groups' ? 'groups' : direction(event.clientX-gesture.x, event.clientY-gesture.y);
      const position = {x:gesture.x, y:gesture.y, document:doc};
      // Windows sends contextmenu after the release, to whatever now lies
      // under the pointer - e.g. the groups dialog this gesture opens. The
      // browser must not add its own menu on top of ours.
      swallowMenuUntil = performance.now() + 500;
      close(); run(action, position);
    }, true);
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); });
    doc.addEventListener('contextmenu', event => {
      if (performance.now() < swallowMenuUntil) { swallowMenuUntil = 0; event.preventDefault(); }
    }, true);
    canvas.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); const rect = canvas.getBoundingClientRect();
        const x = rect.left+rect.width/2, y = rect.top+rect.height/2;
        if (neutralAction() === 'groups') run('groups', {x,y,document:doc});
        else open(x,y);
      }
    });
    canvas.addEventListener('pointercancel', close);
    canvas.addEventListener('lostpointercapture', close);
    win.addEventListener('blur', close);
    doc.addEventListener('keydown', event => { if (event.key === 'Escape' && (menu || gesture)) { event.preventDefault(); close(); } });
    doc.addEventListener('pointerdown', event => { if (menu && !gesture && !menu.contains(event.target)) close(); }, true);
  }
  return {direction, bind};
});
