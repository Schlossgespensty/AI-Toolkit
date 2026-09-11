'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function setup(integrated = true) {
  const classes = new Set();
  const requests = [];
  let focusCallback, finishPopup;
  const document = { activeElement: null, querySelector: () => null,
    documentElement: { classList: { add: name => classes.add(name), toggle: (name, value) => value ? classes.add(name) : classes.delete(name) } } };
  const buttons = ['file', 'edit', 'view'].map(name => ({
    dataset: { appMenu: name }, listeners: {}, attributes: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getBoundingClientRect: () => ({ left: 12, bottom: 42 }),
    focus() { document.activeElement = this; }
  }));
  const group = { hidden: true, querySelectorAll: () => buttons };
  document.getElementById = () => group;
  const overlay = { visible: true, addEventListener(_name, callback) { this.update = callback; } };
  const api = {
    getWindowChrome: async () => ({ integrated }),
    onFocusTitlebarMenu: callback => { focusCallback = callback; },
    showTitlebarMenu: request => { requests.push(request); return new Promise(resolve => { finishPopup = resolve; }); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/titlebar.js'), 'utf8'), {
    document, window: { electronAPI: api }, navigator: { windowControlsOverlay: overlay }, console
  });
  return { document, buttons, group, classes, requests, overlay,
    focus: request => focusCallback(request), finish: () => finishPopup(true) };
}

test('Windows titlebar uses native caption controls, hides duplicate menu and preserves close protection', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/css/combined.css'), 'utf8');
  assert.match(main, /process\.platform === 'win32' \? \{\s*titleBarStyle: 'hidden'/);
  assert.match(main, /titleBarOverlay: \{[^}]*height: 42/);
  assert.match(main, /setMenuBarVisibility\(false\)/);
  assert.match(main, /webContents\.send\('request-window-close'\)/);
  assert.match(css, /-webkit-app-region: drag/);
  assert.match(css, /\.workspaceTabs button\s*\{\s*-webkit-app-region: no-drag/);
  assert.match(css, /env\(titlebar-area-width/);
});

test('menus remain hidden on platforms using the native titlebar', async () => {
  const app = setup(false);
  await Promise.resolve();
  assert.equal(app.group.hidden, true);
  app.focus({ menu: 'file', open: true });
  assert.equal(app.requests.length, 0);
});

test('titlebar menu opens once, restores editor focus, and follows fullscreen safe area', async () => {
  const app = setup();
  await Promise.resolve();
  assert.equal(app.group.hidden, false);
  assert.ok(app.classes.has('windowControlsVisible'));
  app.overlay.visible = false;
  app.overlay.update();
  assert.equal(app.classes.has('windowControlsVisible'), false);
  const input = { isConnected: true, focus() { app.document.activeElement = this; } };
  app.document.activeElement = input;
  app.focus({ menu: 'file', open: true });
  app.focus({ menu: 'edit', open: true });
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].menu, 'file');
  assert.equal(app.requests[0].y, 42);
  // A newly opened dialog must retain focus when the popup closes.
  app.document.activeElement = input;
  app.finish();
  // The popup promise crosses the VM realm; drain promise adoption as well.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.document.activeElement, input);
  assert.equal(app.buttons[0].attributes['aria-expanded'], 'false');
});

test('F10 focuses menus without opening and arrows move between buttons', async () => {
  const app = setup();
  await Promise.resolve();
  app.focus({ menu: 'file', open: false });
  assert.equal(app.document.activeElement, app.buttons[0]);
  assert.equal(app.requests.length, 0);
  app.buttons[0].listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(app.document.activeElement, app.buttons[2]);
});
