'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const source = fs.readFileSync(path.join(__dirname, '../src-tauri/src/viewport-close.js'), 'utf8');
const moduleContext = { module: { exports: {} } };
vm.runInNewContext(transformSync(fs.readFileSync(path.join(__dirname, '../src/desktop/viewports.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, moduleContext);
const { prepareViewportWindow } = moduleContext.module.exports;

function popupWindow(label, windows, lookedUp) {
  const events = new EventTarget();
  return {
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    __TAURI_INTERNALS__: { metadata: { currentWindow: { label } } },
    opener: { __TAURI__: { window: { Window: { getByLabel: async label => { lookedUp.push(label); return windows.get(label); } } } } },
    close: () => { throw Error('Must not bypass the native-window registry'); },
  };
}

test('browser popup close uses the opener native API for exactly that popup', async () => {
  const closed = [], lookedUp = [];
  const nativeWindows = new Map(['main', 'viewport-1', 'editor-2', 'viewport-3'].map(label => [label, { close: async () => { closed.push(label); nativeWindows.delete(label); } }]));
  function popup(label) {
    const window = popupWindow(label, nativeWindows, lookedUp);
    vm.runInNewContext(source, { window, console, Event });
    return window;
  }
  const first = popup('viewport-1');
  await Promise.all([first.close(), first.close()]);
  assert.deepEqual(lookedUp, ['viewport-1']);
  assert.deepEqual(closed, ['viewport-1']);
  assert.deepEqual([...nativeWindows.keys()], ['main', 'editor-2', 'viewport-3']);
  const orphan = popup('viewport-3');
  orphan.opener.closed = true;
  await orphan.close();
  assert.deepEqual(closed, ['viewport-1'], 'native owner destruction handles orphan cleanup');
});

test('an early dock waits for native initialization and closes the popup exactly once', async () => {
  const lookedUp = [], windows = new Map([['main', {}], ['viewport-1', { close: async () => { windows.delete('viewport-1'); } }]]);
  const window = popupWindow('viewport-1', windows, lookedUp);
  prepareViewportWindow(window);
  const first = window.close(), second = window.close();
  assert.equal(first, second, 'multiple early closes share one pending request');
  assert.deepEqual(lookedUp, [], 'native registry is not queried before the close hook is ready');
  vm.runInNewContext(source, { window, console, Event });
  await first;
  assert.deepEqual(lookedUp, ['viewport-1']);
  assert.deepEqual([...windows.keys()], ['main']);
  const nativeClose = window.close;
  prepareViewportWindow(window);
  assert.equal(window.close, nativeClose, 'already initialized popups retain their native close hook');
});
