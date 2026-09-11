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
    const overlay = navigator.windowControlsOverlay;
    const update = () => document.documentElement.classList.toggle('windowControlsVisible', overlay ? overlay.visible : true);
    update();
    overlay?.addEventListener('geometrychange', update);
  }).catch(error => console.error('Could not initialize title bar:', error));
})();
