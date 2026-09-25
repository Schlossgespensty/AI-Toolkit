/** A popup's native initialization runs after window.open() returns. Queue an
 * early dock/close until the native close hook is installed, so Wry's browser
 * close cannot destroy the HWND without updating Tauri's window registry. */
export function prepareViewportWindow(win: Window & { __toolkitNativeViewportReady?: boolean }) {
  if (win.__toolkitNativeViewportReady) return;
  let pending: Promise<void> | undefined;
  win.close = () => pending ||= new Promise<void>((resolve) => {
    win.addEventListener('toolkit-native-viewport-ready', () => resolve(win.close()), { once: true });
  });
}
