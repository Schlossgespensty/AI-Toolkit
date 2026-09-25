const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const shortcuts = require('../src/js/castle-shortcuts');
const camera = require('../src/js/castle-camera');
const source = fs.readFileSync(require.resolve('../src/js/castle-editor.js'), 'utf8');
const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');

test('one binding per action, ordered like the toolbar, with native File/Edit defaults', () => {
  assert.deepEqual(shortcuts.actions.slice(0, 8).map(row => row[0]),
    ['openCastle', 'saveCastle', 'newCastle', 'map', 'iso', 'single', 'line', 'brush']);
  for (const keys of Object.values(shortcuts.defaults)) assert.equal(keys.length, 1);
  assert.deepEqual(shortcuts.validate(shortcuts.defaults), shortcuts.defaults);
  assert.equal(shortcuts.defaults.saveCastle[0], 'ctrl+s');
  for (const id of ['merge', 'overlays', 'groups', 'paste', 'names', 'units', 'guides', 'paths', 'fire', 'gameMap']) {
    assert.ok(Object.hasOwn(shortcuts.defaults, id), id);
  }
  const migrated = shortcuts.migrate({ saveCastle: ['f1'], openCastle: ['f2'], brush: ['9', 'b'], copy: ['5'] });
  assert.deepEqual(migrated.brush, ['9']);
  assert.deepEqual(migrated.copy, ['ctrl+c']);
  assert.deepEqual(migrated.saveCastle, ['ctrl+s']);
  assert.equal(shortcuts.actionFor('f1', migrated), null);
  assert.ok(!shortcuts.actions.some(action => action[0] === 'ground'));
});

test('combinations normalize consistently in Electron and DOM events and validate conflicts', () => {
  assert.equal(shortcuts.fromEvent({key: 'S', ctrlKey: true, shiftKey: true}), 'ctrl+shift+s');
  assert.equal(shortcuts.fromEvent({key: 'S', control: true, shift: true}), 'ctrl+shift+s');
  assert.equal(shortcuts.fromEvent({key: 'F6', altKey: true}), 'alt+f6');
  assert.equal(shortcuts.fromEvent({key: 'Control', ctrlKey: true}), '');
  assert.equal(shortcuts.normalize('SHIFT+CTRL+K'), 'ctrl+shift+k');
  assert.equal(shortcuts.accelerator('ctrl+shift+s'), 'CmdOrCtrl+SHIFT+S');
  assert.throws(() => shortcuts.validate({...shortcuts.defaults, merge: ['ctrl+s']}), /assigned more than once/);
  assert.throws(() => shortcuts.validate({...shortcuts.defaults, merge: ['alt+f']}), /reserved/);
  assert.throws(() => shortcuts.validate({...shortcuts.defaults, merge: ['ctrl+f99']}), /Invalid/);
  const remapped = shortcuts.validate({...shortcuts.defaults, saveCastle: ['alt+s']});
  assert.equal(shortcuts.actionFor('ctrl+s', remapped), null);
  assert.equal(shortcuts.actionFor({key: 's', altKey: true}, remapped), 'saveCastle');
  assert.deepEqual(shortcuts.validate({...shortcuts.defaults, saveCastle: ['']}).saveCastle, ['']);
  assert.throws(() => camera.validate({...camera.defaults, left: 'a'}, {single: ['shift+a']}), /already assigned/);
});

function renderer(bindings = shortcuts.defaults) {
  const calls = [], controls = new Map();
  for (const [, , , id] of shortcuts.actions) if (id) controls.set(id, {click: () => calls.push(id)});
  const context = {shortcutConfig: shortcuts, state: {toolShortcuts: bindings, camera: camera.defaults}, camera,
    window: {castleEditor:{runContextAction: action => calls.push(action)}, appWorkspace: {getActive: () => 'castle'}, dispatchEvent: event => calls.push(event.type), isoView: {turnView: delta => calls.push(delta)}},
    document: {querySelector: () => null, getElementById: id => controls.get(id)}, Event: class {constructor(type) {this.type = type;}},
    overlayMenu: {open: false}, setTool: action => calls.push(action), runFileShortcut: async action => calls.push(action),
    copySelection: () => calls.push('copy'), cutSelection: () => calls.push('cut'), pasteCopy: () => calls.push('paste'),
    undo: () => calls.push('undo'), redo: () => calls.push('redo'), deleteSelected: () => calls.push('deleteSelected'),
    clearSelectionAndItem: () => calls.push('deselect'), setBrushSize: value => calls.push(value)};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function toolForShortcut('), source.indexOf('  let fileShortcutPending')), context);
  vm.runInContext(source.slice(source.indexOf('  function runShortcutAction('), source.indexOf("  window.addEventListener('keydown', handleCastleKey)")), context);
  const key = (key, extra = {}) => context.handleCastleKey({key, target: {tagName: 'CANVAS'}, preventDefault() {}, ...extra});
  return {context, calls, controls, key};
}

test('remapping removes old bindings, guards input/dialogs/repeats and routes controls once', () => {
  const h = renderer(shortcuts.validate({...shortcuts.defaults, saveCastle: ['alt+s'], map: ['alt+m'], merge: ['shift+m']}));
  h.key('s', {ctrlKey: true}); assert.deepEqual(h.calls, []);
  h.key('s', {altKey: true}); assert.deepEqual(h.calls, ['saveCastle']);
  h.key('s', {altKey: true, repeat: true}); assert.equal(h.calls.length, 1);
  h.key('s', {altKey: true, target: {tagName: 'INPUT'}}); assert.equal(h.calls.length, 1);
  h.context.document.querySelector = () => ({});
  h.key('s', {altKey: true}); assert.equal(h.calls.length, 1);
  h.context.document.querySelector = () => null;
  h.key('m', {altKey: true}); h.key('M', {shiftKey: true});
  assert.deepEqual(h.calls.slice(1), ['castleMapBtn', 'merge']);
  h.key('z', {ctrlKey: true, shiftKey: true}); assert.equal(h.calls.length, 3, 'old alternate redo removed');
});

test('custom copy/cut/paste keys use the shared clipboard, including detached-view dispatch', () => {
  const h = renderer(shortcuts.validate({...shortcuts.defaults, copy: ['ctrl+alt+c'], cut: ['ctrl+alt+x'], paste: ['ctrl+alt+v']}));
  for (const key of ['c', 'x', 'v']) h.key(key, {ctrlKey: true});
  assert.deepEqual(h.calls, []);
  for (const key of ['c', 'x', 'v']) h.key(key, {ctrlKey: true, altKey: true});
  assert.deepEqual(h.calls, ['copy', 'castle-clipboard-changed', 'cut', 'castle-clipboard-changed', 'castle-prepare-paste', 'paste']);
});

test('File/Edit menu labels use custom bindings without changing other workspaces', () => {
  const context = {castleShortcuts: shortcuts, sendToFocused() {}};
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf('function defaultCastleOverviewPreferences()'), main.indexOf('function installApplicationMenu(')), context);
  const custom = shortcuts.validate({...shortcuts.defaults, saveCastle: ['alt+s'], undo: ['f6'], deleteSelected: ['']});
  const castle = context.menuTemplateForWorkspace('castle', undefined, custom);
  assert.equal(castle[0].submenu.find(item => item.label === 'Save').accelerator, 'ALT+S');
  assert.equal(castle[2].submenu.find(item => item.label === 'Undo').accelerator, 'F6');
  assert.equal(castle[2].submenu.find(item => item.label === 'Delete Selected').accelerator, undefined);
  const character = context.menuTemplateForWorkspace('character', undefined, custom);
  assert.equal(character[0].submenu.find(item => item.label === 'Save').accelerator, 'CmdOrCtrl+S');
});

test('native accelerators defer to Castle dispatch and capture, but not other workspaces', () => {
  const win = {__activeWorkspace: 'castle', __castleShortcuts: shortcuts.defaults};
  const values = []; let handler;
  const contents = {on: (_name, callback) => {handler = callback;}, setIgnoreMenuShortcuts: value => values.push(value)};
  const context = {win, castleShortcuts: shortcuts};
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf('  function routeCastleShortcuts('), main.indexOf('  routeCastleShortcuts(win.webContents)')), context);
  context.routeCastleShortcuts(contents);
  handler({}, {key: 's', control: true}); assert.equal(values.pop(), true);
  handler({}, {key: '1', control: true}); assert.equal(values.pop(), false);
  win.__castleShortcutCapture = true;
  handler({}, {key: '1', control: true}); assert.equal(values.pop(), true);
  win.__castleShortcutCapture = false; win.__activeWorkspace = 'character';
  handler({}, {key: 's', control: true}); assert.equal(values.pop(), false);
  assert.match(main, /routeCastleShortcuts\(child.webContents\)/);
});

test('palette entries and both mode dropdowns override generic button/select sizing', () => {
  const css = fs.readFileSync(require.resolve('../src/css/combined.css'), 'utf8');
  const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
  assert.match(css, /\.castlePanel \.paletteItem\s*\{\s*width: 100%/);
  assert.match(css, /#castleDeleteMode, #castleSelectMode \{ width: auto; min-width: 0/);
  assert.match(html, /value="area"[^>]*data-i18n="interface:border"[^>]*>Border<\/option>/);
  assert.match(html, /value="flood"[^>]*data-i18n="interface:flood_fill"[^>]*>Flood Fill<\/option>/);
});


test('new defaults cover every action and use arrow pan plus wheel zoom', () => {
  for (const [id] of shortcuts.actions) assert.ok(shortcuts.defaults[id][0], id);
  assert.deepEqual(camera.defaults, camera.arrows);
  assert.deepEqual(camera.keyDelta({key:'ArrowRight'}, camera.defaults), {x:-40,y:0});
  assert.equal(camera.wheelAction({}, camera.defaults), 'zoom');
  assert.equal(camera.wheelAction({}, camera.legacy), 'panY');
});

test('upgrading fills free bindings while preserving custom shortcuts and camera keys', () => {
  const old = {...shortcuts.defaults, groups:[''], merge:[''], brush:['g']};
  const next = shortcuts.upgrade(old, ['m']);
  assert.deepEqual(next.groups,['']);
  assert.deepEqual(next.merge,['']);
  assert.deepEqual(next.brush,['g']);
  assert.deepEqual(shortcuts.upgrade({...old,brush:['3']}).groups,['g']);
  assert.deepEqual(shortcuts.validate({...next,groups:['']}).groups,[''],'explicitly cleared v3 keys remain empty');
});

test('group and merge keys dispatch the same actions as the pie menu', () => {
  const h = renderer(); h.key('g'); h.key('m'); h.key('r');
  assert.deepEqual(h.calls, ['groups','merge','replace']);
  h.key('g',{repeat:true}); assert.equal(h.calls.length,3);
});

test('new installs start with the number-row tool layout and -/+ brush size', () => {
  const fresh = shortcuts.migrate(null);
  assert.deepEqual(Object.fromEntries(['single','line','brush','bucket','select','replace','delete','brushSmaller','brushLarger'].map(id => [id, fresh[id][0]])),
    {single:'1', line:'2', brush:'3', bucket:'4', select:'5', replace:'r', delete:'d', brushSmaller:'-', brushLarger:'plus'});
  assert.equal(shortcuts.actionFor({key:'+'}, fresh), 'brushLarger');
});

test('profiles that saved the old tool defaults untouched move to the number row, customised ones stay', () => {
  const old = {...shortcuts.defaults, line: ['6'], brush: ['2'], brushSmaller: ['['], brushLarger: [']'], bucket: ['7'], select: ['3'], replace: ['8'], delete: ['4']};
  assert.deepEqual(shortcuts.validate(shortcuts.refreshDefaults(old)), shortcuts.defaults);
  const custom = {...old, select: ['v']};
  assert.equal(shortcuts.refreshDefaults(custom), custom, 'one changed tool key keeps the whole set');
  const taken = {...old, rotateLeft: ['r']};
  assert.equal(shortcuts.refreshDefaults(taken), taken, 'a new key held by another action keeps the old set');
  assert.equal(shortcuts.refreshDefaults(shortcuts.defaults), shortcuts.defaults);
  assert.match(source, /const saved = stored && shortcutConfig\.refreshDefaults\(stored\);/);
  assert.match(source, /if \(saved !== stored \|\| \(!stored && \(previous \|\| first\)\)\) localStorage\.setItem\(SHORTCUT_STORAGE_KEY/);
});
