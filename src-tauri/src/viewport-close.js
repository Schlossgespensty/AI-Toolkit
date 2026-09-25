// Wry's browser window.close() destroys the WebView HWND directly on Windows,
// bypassing Tauri's native-window registry. Close through the trusted opener's
// standard Tauri API instead. Only detached about:blank viewports receive this.
(() => {
  let closing = false;
  window.close = () => {
    if (closing) return;
    const owner = window.opener;
    if (!owner || owner.closed) return; // Native owner-destroy cleanup owns this case.
    const label = window.__TAURI_INTERNALS__.metadata.currentWindow.label;
    closing = true;
    return owner.__TAURI__.window.Window.getByLabel(label)
      .then(target => target?.close())
      .catch(error => { closing = false; console.error('Detached window close:', error); });
  };
  window.__toolkitNativeViewportReady = true;
  window.dispatchEvent(new Event('toolkit-native-viewport-ready'));
})();
