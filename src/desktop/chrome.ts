/** Window mechanics stay in the desktop adapter; shared titlebar owns presentation. */
import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowState = { maximized: boolean; fullscreen: boolean };

export function createWindowChrome() {
  const window = getCurrentWindow();
  const getWindowState = async (): Promise<WindowState> => {
    const [maximized, fullscreen] = await Promise.all([window.isMaximized(), window.isFullscreen()]);
    return { maximized, fullscreen };
  };
  return {
    // Other platforms retain native captions but still use the editor's menus.
    getWindowChrome: async () => ({ integrated: true, customControls: !await window.isDecorated() }),
    getWindowState,
    minimizeWindow: () => window.minimize(),
    toggleMaximizeWindow: () => window.toggleMaximize(),
    // This requests closing; the existing native CloseRequested guard decides it.
    closeWindow: () => window.close(),
    onWindowStateChanged: async (callback: (state: WindowState) => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unlisten = await window.onResized(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void getWindowState().then(callback).catch(console.error);
        }, 75);
      });
      return () => { clearTimeout(timer); unlisten(); };
    },
  };
}
