(() => {
  'use strict';
  const api = window.electronAPI;
  const group = document.getElementById('titlebarMenus');
  if (!group || !api?.getWindowChrome) return;
  const buttons = [...group.querySelectorAll('[data-app-menu]')];
  let busy = false;
  let returnFocus = null;

  async function openMenu(button) {
    if (busy || group.hidden) return;
    busy = true;
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    try {
      await api.showTitlebarMenu({ menu: button.dataset.appMenu, x: rect.left, y: rect.bottom });
    } catch (error) {
      console.error('Could not open application menu:', error);
    } finally {
      button.setAttribute('aria-expanded', 'false');
      busy = false;
      // A command may have opened a dialog: never steal its focus.
      if (document.activeElement === button && returnFocus?.isConnected && !document.querySelector('dialog[open]')) {
        returnFocus.focus({ preventScroll: true });
      }
    }
  }

  for (const button of buttons) {
    button.addEventListener('pointerdown', () => { returnFocus = document.activeElement; });
    button.addEventListener('click', () => openMenu(button));
    button.addEventListener('keydown', event => {
      const index = buttons.indexOf(button);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu(button);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        returnFocus?.focus?.({ preventScroll: true });
      }
    });
  }

  // Interface zoom as a visible control: Ctrl+scroll pans the maps, so
  // nobody finds the browser-style zoom otherwise. Ctrl +/-/0 still work.
  const zoomControls = document.getElementById('uiZoomControls');
  if (zoomControls && api.setUiZoom && api.getUiZoom) {
    const value = zoomControls.querySelector('.uiZoomValue');
    const show = zoom => { value.textContent = `${Math.round(zoom * 100)} %`; };
    show(api.getUiZoom());
    api.onUiZoomChanged?.(show);
    zoomControls.addEventListener('click', event => {
      const step = Number(event.target.closest('[data-ui-zoom]')?.dataset.uiZoom);
      if (Number.isNaN(step)) return;
      api.setUiZoom(step ? api.getUiZoom() + step / 10 : 1).catch(console.error);
    });
    zoomControls.hidden = false;
  }

  api.onFocusTitlebarMenu?.(request => {
    if (group.hidden || document.querySelector('dialog[open]')) return;
    const button = buttons.find(item => item.dataset.appMenu === request?.menu);
    if (!button) return;
    if (!buttons.includes(document.activeElement)) returnFocus = document.activeElement;
    button.focus({ preventScroll: true });
    if (request.open) openMenu(button);
  });

  api.getWindowChrome().then(chrome => {
    if (!chrome?.integrated) return;
    document.documentElement.classList.add('integratedTitlebar');
    group.hidden = false;
    if (chrome.customControls) {
      const controls = document.getElementById('windowControls');
      const maximize = controls.querySelector('[data-window-action="maximize"]');
      document.documentElement.classList.add('customWindowControls');
      controls.hidden = false;
      // Tauri handles native dragging/double-click only on these inert regions.
      // Interactive descendants never inherit the drag attribute.
      document.querySelectorAll('.workspaceTabs, .workspaceSpacer, .appIcon, .workspaceStatus, .appIdentity, .appIdentity span')
        .forEach(region => region.setAttribute('data-tauri-drag-region', ''));
      const actions = { minimize: api.minimizeWindow, maximize: api.toggleMaximizeWindow, close: api.closeWindow };
      controls.addEventListener('click', event => {
        const action = event.target.closest('[data-window-action]')?.dataset.windowAction;
        if (actions[action]) actions[action]().catch(console.error);
      });
      const update = state => {
        document.documentElement.classList.toggle('windowMaximized', state.maximized);
        document.documentElement.classList.toggle('windowFullscreen', state.fullscreen);
        const key = state.maximized ? 'shell:restore_window' : 'shell:maximize_window';
        maximize.setAttribute('data-i18n-attrs', `title=${key};aria-label=${key}`);
        const label = window.toolkitI18n.t(key);
        maximize.title = label; maximize.setAttribute('aria-label', label);
      };
      api.onWindowStateChanged(update).catch(console.error);
      api.getWindowState().then(update).catch(console.error);
      return;
    }
    const overlay = navigator.windowControlsOverlay;
    const update = () => document.documentElement.classList.toggle('windowControlsVisible', overlay ? overlay.visible : true);
    update();
    overlay?.addEventListener('geometrychange', update);
  }).catch(error => console.error('Could not initialize title bar:', error));
})();
