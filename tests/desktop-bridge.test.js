'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const yaml = require('js-yaml');
const root = path.join(__dirname, '..');

test('desktop IPC types reject mismatched operations, payloads and result assertions', () => {
  const { execFileSync } = require('node:child_process');
  const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  execFileSync(process.execPath, [compiler, '--project', path.join(__dirname, 'types/tsconfig.json')], {
    cwd: root, encoding: 'utf8', stdio: 'pipe',
  });
});

function loadModule(name, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, 'src/desktop', name + '.ts'), 'utf8');
  const result = esbuild.transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const context = vm.createContext({
    Uint8Array, atob, btoa, module: { exports: {} },
    require: id => {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected import ${id}`);
      return dependencies[id];
    },
    ...globals,
  });
  vm.runInContext(result.code, context);
  return context.module.exports;
}

function chromeHarness() {
  const calls = [];
  let decorated = false;
  const window = {
    isDecorated: async () => decorated,
    isMaximized: async () => false, isFullscreen: async () => false,
    minimize: async () => calls.push('minimize'),
    toggleMaximize: async () => calls.push('toggleMaximize'),
    close: async () => calls.push('close-requested'),
  };
  const module = loadModule('chrome', { '@tauri-apps/api/window': { getCurrentWindow: () => window } });
  return { module, calls, decorated: value => { decorated = value; } };
}

test('native caption adapter follows actual decorations and requests guarded close', async () => {
  const h = chromeHarness(), api = h.module.createWindowChrome();
  assert.equal((await api.getWindowChrome()).customControls, true);
  h.decorated(true);
  assert.equal((await api.getWindowChrome()).customControls, false);
  assert.equal((await api.getWindowChrome()).integrated, true, 'menus remain available on native-caption platforms');
  await api.minimizeWindow(); await api.toggleMaximizeWindow(); await api.closeWindow();
  assert.deepEqual(h.calls, ['minimize', 'toggleMaximize', 'close-requested']);
});

function documentHarness(responses = {}) {
  const calls = [];
  const state = { projectRoot: 'D:\\Games\\Crusader\\ucp\\plugins\\TestAI' };
  const rpc = async (operation, payload) => {
    calls.push({ operation, payload });
    const response = responses[operation];
    return typeof response === 'function' ? response(payload) : response;
  };
  const api = loadModule('documents', {
    './runtime': { state, rpc, tr: key => key },
    '../node/aiv-codec.mjs': {
      parseAiv: () => ({ frames: [] }),
      encodeAiv: () => Uint8Array.of(1, 2, 3),
    },
  }, { window: { castleFormat: { classicIssues: () => [], stringify: JSON.stringify } } });
  return { api, calls, state };
}

test('Save As uses the current AI folder and distinct Classic/DE filters', async () => {
  const h = documentHarness({ 'pick-path': null });
  await h.api.save({ content: '{}', kind: 'aivjson', defaultPath: 'C:\\Old\\Castle.aivjson' });
  const pick = h.calls[0].payload;
  assert.equal(pick.defaultPath, h.state.projectRoot + '/Castle.aivjson');
  assert.deepEqual(Array.from(pick.filters, f => Array.from(f.extensions)), [['aivjson'], ['aiv']]);
  assert.equal(h.calls.length, 1, 'cancel must not write anything');
  h.state.projectRoot = null;
  assert.equal(h.api.projectDialogPath('/tmp/Castle.aiv'), '/tmp/Castle.aiv');
});

test('an explicit DE extension controls output even when starting from classic Save As', async () => {
  const h = documentHarness({ 'pick-path': '/tmp/Test.AIVJSON' });
  const document = { frames: [{ itemType: 61, tilePositionOfsets: [10] }] };
  const saved = await h.api.save({ content: document, kind: 'aiv' });
  assert.equal(saved.native, false);
  assert.equal(saved.path, '/tmp/Test.AIVJSON');
  assert.equal(h.calls.at(-1).payload.content, JSON.stringify(document));
  assert.equal(h.calls.filter(c => c.operation === 'confirm').length, 0);
});

test('extensionless export asks for format and cancellation leaves documents untouched', async () => {
  const h = documentHarness({ 'pick-path': '/tmp/Castle', confirm: null });
  assert.equal(await h.api.save({ content: '{}', kind: 'aiv' }), null);
  assert.equal(h.calls.filter(c => c.operation === 'write-file').length, 0);
});

test('unchanged classic saves retain source bytes without re-encoding', async () => {
  const h = documentHarness();
  const source = Uint8Array.of(21, 42, 63);
  const result = await h.api.save({ path: '/tmp/Castle.aiv', content: '{}', kind: 'aiv', sourceBytes: source, unchanged: true });
  assert.deepEqual(Array.from(result.sourceBytes), Array.from(source));
  assert.deepEqual(Array.from(h.calls, c => c.operation), ['write-file']);
  assert.equal(h.calls[0].payload.base64, Buffer.from(source).toString('base64'));
});

test('JSON documents serialize once while existing content strings remain byte-for-byte intact', async () => {
  const h = documentHarness();
  const document = { unknownPlugin: { value: [null, false, 'فارسی', 9007199254740991] } };
  await h.api.save({ path: '/tmp/character.json', content: document });
  assert.deepEqual(JSON.parse(h.calls[0].payload.content), document);
  const exact = '{\n  "opaque-plugin": [null, 42]\n}\n';
  await h.api.save({ path: '/tmp/character.json', content: exact });
  assert.equal(h.calls[1].payload.content, exact);
});

test('failed configuration loads can retry instead of poisoning the cache', async () => {
  let attempts = 0;
  const h = documentHarness({ 'load-config': () => { if (++attempts === 1) throw new Error('temporary'); return { custom: true }; } });
  await assert.rejects(h.api.loadConfig('template.json'), /temporary/);
  assert.equal((await h.api.loadConfig('template.json')).custom, true);
  await h.api.loadConfig('template.json');
  assert.equal(attempts, 2);
});

test('desktop shortcuts restore view controls without taking castle editing bindings', () => {
  const { desktopShortcut } = loadModule('shortcuts');
  const key = (key, overrides = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides });
  assert.equal(desktopShortcut(key('F11'), 'castle').view, 'fullscreen');
  assert.equal(desktopShortcut(key('F5'), 'character').view, 'reload');
  assert.equal(desktopShortcut(key('+', { ctrlKey: true, shiftKey: true }), 'castle').view, 'zoom-in');
  assert.equal(desktopShortcut(key('0', { metaKey: true }), 'content').view, 'reset-zoom');
  assert.equal(desktopShortcut(key('s', { ctrlKey: true }), 'castle'), undefined);
  assert.equal(desktopShortcut(key('s', { ctrlKey: true }), 'character').event, 'trigger-save');
  assert.equal(desktopShortcut(key('s', { altKey: true, ctrlKey: true }), 'character'), undefined);
  assert.equal(desktopShortcut(key('1', { ctrlKey: true, shiftKey: true }), 'character').event, 'trigger-set-standard-order');
});

test('native bridge preserves the preload API and distinguishes destructive Character replacement', () => {
  const calls = [];
  const messages = yaml.load(fs.readFileSync(path.join(root, 'locales/en/native.yaml'), 'utf8'));
  const tr = (key, args = {}) => String(messages[key.replace(/^native:/, '')] || key)
    .replace(/\{\{(\w+)\}\}/g, (_, name) => args[name]);
  const window = { __TAURI_INTERNALS__: {} };
  loadModule('api', {
    '@tauri-apps/api/core': {},
    './runtime': { rpc: (operation, payload) => { calls.push({ operation, payload }); }, tr, on: () => {}, state: {} },
    './documents': {}, './chrome': chromeHarness().module, './assets': {}, './portraits': {}, './menus': { createMenus: () => ({}) }, './viewports': loadModule('viewports'),
  }, { window, document: { addEventListener() {} } });
  const legacy = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  for (const [, name] of legacy.matchAll(/^  (\w+):/gm)) {
    assert.ok(Object.hasOwn(window.electronAPI, name), `Missing legacy API: ${name}`);
  }
  window.electronAPI.chooseAiDocumentAction({ aiName: 'Test', kind: 'character', operation: 'open' });
  assert.match(calls.at(-1).payload.message, /permanently replaces.*character\.json/);
  window.electronAPI.chooseAiDocumentAction({ aiName: 'Test', kind: 'castle', operation: 'open' });
  assert.match(calls.at(-1).payload.message, /copies.*aiv folder/);
  assert.doesNotMatch(calls.at(-1).payload.message, /character\.json/);
  window.electronAPI.chooseAiDocumentAction({ aiName: 'Test', kind: 'castle', operation: 'new' });
  assert.match(calls.at(-1).payload.message, /Create a new castle in Test/);
});

test('replacing the load-file consumer does not dispatch the same document twice', async () => {
  const registrations = [], notifications = [], requests = [];
  const runtime = loadModule('runtime', {
    '@tauri-apps/api/core': { invoke: async (command, payload) => requests.push({ command, payload }) },
    '@tauri-apps/api/webviewWindow': { getCurrentWebviewWindow: () => ({ listen: async (channel, handler) => registrations.push({ channel, handler }) }) },
  }, { window: {} });
  runtime.on('load-file', () => notifications.push('old'));
  runtime.on('load-file', () => notifications.push('current'));
  runtime.dispatch('load-file', { path: 'test.aiv' });
  await Promise.resolve();
  assert.deepEqual(notifications, ['current']);
  assert.equal(registrations.length, 1);
  assert.equal(requests[0].payload.request.operation, 'document-ready');
});

test('the typed transport sends the native enum envelope and preserves errors and nullable responses', async () => {
  const requests = [];
  const runtime = loadModule('runtime', {
    '@tauri-apps/api/core': { invoke: async (command, payload) => {
      requests.push({ command, payload });
      if (payload.request.operation === 'set-theme') throw { code: 'nativeErrors:unknown_theme', arguments: { name: 'x' }, details: 'detail' };
      return null;
    } },
    '@tauri-apps/api/webviewWindow': {},
  }, { window: { toolkitI18n: { t: (key, args) => key + ':' + args.name } } });
  assert.equal(await runtime.rpc('pick-path', {}), null);
  assert.equal(await runtime.game('map', { path: 'GreekSea.map' }), null);
  await runtime.rpc('document-ready');
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { command: 'desktop_request', payload: { request: { operation: 'pick-path', payload: {} } } },
    { command: 'game_request', payload: { request: { operation: 'map', payload: { path: 'GreekSea.map' } } } },
    { command: 'desktop_request', payload: { request: { operation: 'document-ready' } } },
  ]);
  await assert.rejects(runtime.rpc('set-theme', { theme: 'unknown' }), /nativeErrors:unknown_theme:x\ndetail/);
});

test('idle unit assets only convert native URLs, preserving anchors and dimensions', async () => {
  const sprite = { path: 'C:\\Game\\unit.png', width: 31, height: 52, dx: -15, dy: -47, frame: 12, source: 'archer', playerPalette: 1 };
  let result = { assetRevision: 'revision', sprites: {}, idleSprites: { 1: sprite }, warnings: [] };
  const api = loadModule('assets', {
    '@tauri-apps/api/core': { convertFileSrc: value => 'asset:' + value },
    './runtime': { game: async () => result },
  });
  const converted = await api.gameUnitSprites();
  assert.equal(converted.assetRevision, 'revision');
  assert.deepEqual(JSON.parse(JSON.stringify(converted.idleSprites[1])), { ...sprite, path: 'asset:' + sprite.path });
  assert.equal(sprite.path, 'C:\\Game\\unit.png', 'cached extraction metadata remains immutable');
  result = {};
  assert.equal((await api.gameUnitSprites()).idleSprites, undefined, 'no installation has no extracted poses');
});

test('castle IPC transfers encoded bytes once and accepts an absent library refresh result', async () => {
  const calls = [];
  const window = { __TAURI_INTERNALS__: {} };
  loadModule('api', {
    '@tauri-apps/api/core': {},
    './runtime': { rpc: async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'castle-destination') return { path: 'ai/aiv/Castle.aiv', exists: false };
      if (operation === 'add-castle') return { path: 'ai/aiv/Castle.aiv', fileName: 'Castle.aiv' };
      return null;
    }, tr: key => key, on: () => {}, state: {} },
    './documents': { encodeCastle: async () => Uint8Array.of(1, 2, 255), toBase64: bytes => Buffer.from(bytes).toString('base64') },
    './chrome': chromeHarness().module, './assets': {}, './portraits': {}, './menus': { createMenus: () => ({}) }, './viewports': loadModule('viewports'),
  }, { window, document: { addEventListener() {} } });
  const document = { frames: [{ itemType: 61, tilePositionOfsets: [5643] }] };
  const project = { gameRoot: 'game', aiRoot: 'ai' };
  const saved = await window.electronAPI.addAiDocument({ ...project, kind: 'castle', suggestedFileName: 'Castle.aiv', document, sourceBytes: Uint8Array.of(42) });
  assert.deepEqual(Array.from(saved.sourceBytes), [1, 2, 255]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { operation: 'castle-destination', payload: { ...project, fileName: 'Castle.aiv' } },
    { operation: 'add-castle', payload: { ...project, fileName: 'Castle.aiv', overwrite: false, castleBase64: 'AQL/' } },
  ]);
  assert.equal(await window.electronAPI.updateUcpAi({ gameRoot: 'game', aiId: 'ai', characterContent: '{}', castleFile: 'Castle.aiv', castleDocument: document, castleSourceBytes: Uint8Array.of(42), castleUnchanged: true }), null);
  assert.deepEqual(Object.keys(calls.at(-1).payload).sort(), ['aiId', 'castleBase64', 'castleFile', 'characterContent', 'gameRoot']);
});

test('document delivery and close requests stay in their editor while settings broadcast', async () => {
  const registrations = [], requests = [];
  function editor(label) {
    const runtime = loadModule('runtime', {
      '@tauri-apps/api/core': { invoke: async (command, payload) => requests.push({ label, command, payload }) },
      '@tauri-apps/api/webviewWindow': { getCurrentWebviewWindow: () => ({
        listen: async (channel, handler) => registrations.push({ target: label, channel, handler }),
      }) },
      // Tauri's global listener defaults to EventTarget::Any, which also receives
      // emit_to events. Keeping this mock catches accidental reintroduction.
      '@tauri-apps/api/event': { listen: async (channel, handler) => registrations.push({ target: null, channel, handler }) },
    }, { window: {} });
    const state = { project: 'Gatekeeper', document: 'Original.aiv', closes: 0, theme: 'default', language: 'en' };
    runtime.on('load-file', payload => { state.project = null; state.document = payload.path; });
    runtime.on('request-window-close', () => state.closes++);
    runtime.on('theme-changed', theme => { state.theme = theme; });
    runtime.on('language-changed', language => { state.language = language; });
    return state;
  }
  function emit(target, channel, payload) {
    for (const registration of registrations) {
      if (registration.channel === channel && (target === null || registration.target === null || registration.target === target)) registration.handler({ payload });
    }
  }
  const main = editor('main'), second = editor('editor-2');
  await Promise.resolve();
  emit('editor-2', 'load-file', { path: 'Standalone.aiv' });
  assert.equal(main.project, 'Gatekeeper'); assert.equal(main.document, 'Original.aiv');
  assert.equal(second.project, null); assert.equal(second.document, 'Standalone.aiv');
  emit('editor-2', 'request-window-close');
  assert.equal(main.closes, 0); assert.equal(second.closes, 1);
  emit(null, 'theme-changed', 'ucp'); emit(null, 'language-changed', 'de');
  assert.equal(main.theme, 'ucp'); assert.equal(second.theme, 'ucp');
  assert.equal(main.language, 'de'); assert.equal(second.language, 'de');
  assert.deepEqual(requests.filter(r => r.payload.request.operation === 'document-ready').map(r => r.label), ['main', 'editor-2']);
});
