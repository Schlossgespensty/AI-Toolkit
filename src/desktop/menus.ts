import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Menu, Submenu, CheckMenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { rpc, tr, state, dispatch } from './runtime';
import { desktopShortcut, type ViewAction } from './shortcuts';
export function createMenus() {
  let popup: Menu | null = null;
  // Interface zoom, like a browser's: the webview scales the whole page, so
  // canvases follow devicePixelRatio and stay sharp. Remembered across starts.
  const ZOOM_KEY = 'toolkit.uiZoom';
  let zoom = (() => {
    try {
      const stored = Number(localStorage.getItem(ZOOM_KEY));
      return stored >= 0.5 && stored <= 2 ? stored : 1;
    } catch {
      return 1;
    }
  })();
  if (zoom !== 1) void getCurrentWebview().setZoom(zoom).catch(console.error);
  const setZoom = async (next: number) => {
    zoom = Math.round(Math.max(0.5, Math.min(2, next)) * 10) / 10;
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // Zoom still applies to this window without storage.
    }
    await getCurrentWebview().setZoom(zoom);
    window.dispatchEvent(new CustomEvent('toolkit-ui-zoom', { detail: zoom }));
  };
  async function performViewAction(action: ViewAction) {
    switch (action) {
      case 'zoom-in':
        return setZoom(zoom + 0.1);
      case 'zoom-out':
        return setZoom(zoom - 0.1);
      case 'reset-zoom':
        return setZoom(1);
      case 'developer-tools':
        await rpc('developer-tools');
        return;
      case 'reload':
        if (await window.unsavedChanges?.confirmAll(tr('native:reload'))) location.reload();
        return;
      case 'fullscreen': {
        const win = getCurrentWindow();
        await win.setFullscreen(!(await win.isFullscreen()));
      }
    }
  }
  function runViewAction(action: ViewAction) {
    void performViewAction(action).catch((error) =>
      window.appWorkspace?.setStatus(String(error.message || error)),
    );
  }
  function viewCommand(key: string, action: ViewAction, shortcut: string) {
    return { text: tr(key) + '\t' + shortcut, action: () => runViewAction(action) };
  }
  async function showMenu(request: { menu: string; x: number; y: number }) {
    await window.toolkitI18n.ready;
    const separator = () => PredefinedMenuItem.new({ item: 'Separator' });
    const command = (key: string, event: string, accelerator?: string, payload?: unknown) => {
      const action: Record<string, string> = {
        'trigger-new-document': 'newCastle',
        'trigger-load': 'openCastle',
        'trigger-save': 'saveCastle',
        'trigger-save-as': 'saveAs',
        'trigger-undo': 'undo',
        'trigger-redo': 'redo',
        'trigger-delete-selected': 'deleteSelected',
      };
      const shortcut =
        state.workspace === 'castle' && action[event]
          ? window.castleShortcuts?.accelerator(state.castleBindings[action[event]]?.[0])
          : accelerator;
      return {
        text: tr(key) + (shortcut ? '\t' + shortcut.replace('CmdOrCtrl', 'Ctrl') : ''),
        action: () => dispatch(event, payload),
      };
    };
    if (popup) {
      const close = async (menu: Menu | Submenu) => {
        for (const item of await menu.items()) {
          if (item instanceof Submenu) await close(item);
          else await item.close();
        }
        await menu.close();
      };
      await close(popup);
      popup = null;
    }
    let items: NonNullable<Parameters<typeof Menu.new>[0]>['items'] = [];
    if (request.menu === 'file')
      items = [
        command('native:new_window', 'trigger-new-window', 'CmdOrCtrl+Shift+N'),
        await separator(),
        command('native:new', 'trigger-new-document', 'CmdOrCtrl+N'),
        command('common:actions.open', 'trigger-load', 'CmdOrCtrl+O'),
        command('native:open_new_window', 'trigger-load-in-window', 'CmdOrCtrl+Shift+O'),
        await separator(),
        command('common:actions.save', 'trigger-save', 'CmdOrCtrl+S'),
        command('native:save_as', 'trigger-save-as', 'CmdOrCtrl+Shift+S'),
      ];
    if (request.menu === 'edit') {
      await window.ToolkitTheme?.refresh?.();
      const settings = await rpc('interface-settings');
      const themeItems = await Promise.all(
        (
          window.ToolkitTheme?.list() || [
            { id: 'default', name: 'Default' },
            { id: 'ucp', name: 'UCP' },
          ]
        ).map((theme) =>
          CheckMenuItem.new({
            text: theme.id === 'default' ? tr('common:preferences.defaultTheme') : theme.name,
            checked: settings.theme === theme.id,
            action: () => {
              void window.ToolkitTheme.select(theme.id).catch((error) =>
                window.appWorkspace?.setStatus(String(error.message || error)),
              );
            },
          }),
        ),
      );
      const registry = await (await fetch('locales/registry.json')).json();
      const languageEntries = Array.isArray(registry) ? registry : registry.languages;
      const languageItems = await Promise.all(
        [{ code: 'system', name: tr('common:preferences.system') }, ...languageEntries].map(
          (language: { code?: string; id?: string; name: string; nativeName?: string }) => {
            const id = language.code || language.id!;
            return CheckMenuItem.new({
              text: language.nativeName || language.name,
              checked: settings.language === id,
              action: () => {
                void rpc('set-language', { language: id });
              },
            });
          },
        ),
      );
      items = [
        command('common:actions.undo', 'trigger-undo', 'CmdOrCtrl+Z'),
        command('common:actions.redo', 'trigger-redo', 'CmdOrCtrl+Y'),
        await separator(),
        await Submenu.new({ text: tr('common:preferences.theme'), items: themeItems }),
        await Submenu.new({ text: tr('common:preferences.language'), items: languageItems }),
      ];
      if (state.workspace === 'castle') {
        const overviewItems = [];
        for (const panel of ['population', 'costs']) {
          const settings = state.overview[panel] as
            { visible?: boolean; side?: string } | undefined;
          overviewItems.push(
            await CheckMenuItem.new({
              text: tr('native:show_' + panel),
              checked: settings?.visible !== false,
              action: () =>
                dispatch('trigger-castle-overview', {
                  panel,
                  property: 'visible',
                  value: settings?.visible === false,
                }),
            }),
          );
          overviewItems.push(
            await Submenu.new({
              text: tr('native:' + panel + '_side'),
              items: await Promise.all(
                ['left', 'right'].map((side) =>
                  CheckMenuItem.new({
                    text: tr('interface:' + side),
                    checked: (settings?.side || 'left') === side,
                    action: () =>
                      dispatch('trigger-castle-overview', { panel, property: 'side', value: side }),
                  }),
                ),
              ),
            }),
          );
        }
        items.push(
          await separator(),
          command('common:actions.delete', 'trigger-delete-selected', 'Delete'),
          await Submenu.new({ text: tr('native:overviews'), items: overviewItems }),
          command('native:clear_background', 'trigger-clear-castle-background'),
          command('native:castle_mapping', 'trigger-edit-castle-mapping'),
          command('native:shortcuts', 'trigger-customize-castle-shortcuts'),
        );
      }
      if (state.workspace === 'character')
        items.push(
          await separator(),
          command('native:toggle_ox', 'trigger-toggle-ox', 'CmdOrCtrl+T'),
          command('native:toggle_running', 'trigger-toggle-running', 'CmdOrCtrl+U'),
          command('native:standard_order', 'trigger-set-standard-order'),
          command('native:ordered_order', 'trigger-set-ordered-order'),
          command('native:toggle_sections', 'trigger-toggle-section'),
        );
    }
    if (request.menu === 'view')
      items = [
        command('interface:ucp_ai_library', 'trigger-workspace', 'CmdOrCtrl+1', 'ucp'),
        command('interface:character', 'trigger-workspace', 'CmdOrCtrl+2', 'character'),
        command('interface:castle', 'trigger-workspace', 'CmdOrCtrl+3', 'castle'),
        command('interface:ai_content', 'trigger-workspace', 'CmdOrCtrl+4', 'content'),
      ];
    if (request.menu === 'view')
      items.push(
        await separator(),
        viewCommand('native:zoom_in', 'zoom-in', 'Ctrl++'),
        viewCommand('native:zoom_out', 'zoom-out', 'Ctrl+-'),
        viewCommand('native:reset_zoom', 'reset-zoom', 'Ctrl+0'),
        await separator(),
        viewCommand('native:reload', 'reload', 'Ctrl+R'),
        viewCommand('native:fullscreen', 'fullscreen', 'F11'),
        viewCommand('native:developer_tools', 'developer-tools', 'Ctrl+Shift+I'),
      );
    popup = await Menu.new({ items });
    await popup.popup(new LogicalPosition(request.x, request.y), getCurrentWindow());
  }
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || state.shortcutCapture || document.querySelector('dialog[open]'))
      return;
    if (
      (event.altKey && ['f', 'e', 'v'].includes(event.key.toLowerCase())) ||
      event.key === 'F10'
    ) {
      event.preventDefault();
      dispatch('focus-titlebar-menu', {
        menu:
          ({ f: 'file', e: 'edit', v: 'view' } as Record<string, string>)[
            event.key.toLowerCase()
          ] || 'file',
        open: event.altKey,
      });
      return;
    }
    const command = desktopShortcut(event, state.workspace);
    if (command) {
      event.preventDefault();
      if ('view' in command) runViewAction(command.view);
      else dispatch(command.event, command.payload);
    }
  });

  return { showMenu, uiZoom: () => zoom, setUiZoom: setZoom };
}
