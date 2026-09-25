/** Desktop shortcuts shared by all workspaces. Castle editing keeps its own bindings. */
export type ViewAction =
  'reload' | 'fullscreen' | 'developer-tools' | 'zoom-in' | 'zoom-out' | 'reset-zoom';
export type Shortcut = { view: ViewAction } | { event: string; payload?: string };
type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

const globalShortcuts: Record<string, Shortcut> = {
  'shift+n': { event: 'trigger-new-window' },
  'shift+o': { event: 'trigger-load-in-window' },
  '1': { event: 'trigger-workspace', payload: 'ucp' },
  '2': { event: 'trigger-workspace', payload: 'character' },
  '3': { event: 'trigger-workspace', payload: 'castle' },
  '4': { event: 'trigger-workspace', payload: 'content' },
  r: { view: 'reload' },
  'shift+r': { view: 'reload' },
  'shift+i': { view: 'developer-tools' },
  '0': { view: 'reset-zoom' },
  '-': { view: 'zoom-out' },
  '=': { view: 'zoom-in' },
  '+': { view: 'zoom-in' },
  'shift++': { view: 'zoom-in' },
};
const fileShortcuts: Record<string, Shortcut> = {
  n: { event: 'trigger-new-document' },
  o: { event: 'trigger-load' },
  s: { event: 'trigger-save' },
  'shift+s': { event: 'trigger-save-as' },
};
const characterShortcuts: Record<string, Shortcut> = {
  t: { event: 'trigger-toggle-ox' },
  u: { event: 'trigger-toggle-running' },
  'shift+1': { event: 'trigger-set-standard-order' },
  'shift+2': { event: 'trigger-set-ordered-order' },
  tab: { event: 'trigger-toggle-section' },
};

export function desktopShortcut(event: KeyInput, workspace: string): Shortcut | undefined {
  if (event.altKey) return;
  if (!event.ctrlKey && !event.metaKey) {
    if (event.shiftKey) return;
    if (event.key === 'F11') return { view: 'fullscreen' };
    if (event.key === 'F5') return { view: 'reload' };
    return;
  }
  if (event.ctrlKey && event.metaKey && event.key.toLowerCase() === 'f') {
    return { view: 'fullscreen' };
  }
  const key = (event.shiftKey ? 'shift+' : '') + event.key.toLowerCase();
  return (
    globalShortcuts[key] ||
    (workspace !== 'castle' ? fileShortcuts[key] : undefined) ||
    (workspace === 'character' ? characterShortcuts[key] : undefined)
  );
}
