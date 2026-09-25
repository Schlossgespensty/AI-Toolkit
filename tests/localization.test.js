'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const i18next = require('i18next');
const yaml = require('js-yaml');
const { build, registry, flatten } = require('../scripts/build-locales');
const { checkReferences } = require('../scripts/check-locale-references');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
function element(key, value = '', tagName = 'SPAN') {
  return {
    tagName,
    childElementCount: 0,
    dataset: key ? { i18n: key } : {},
    value,
    textContent: '',
    style: {},
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelectorAll() { return []; }
  };
}
function harness({ language = 'en', system = 'en-US' } = {}) {
  const nodes = [element('categories:Bad Things'), element('common:actions.save')];
  const input = element(null, 'Unsaved user content', 'INPUT');
  input.dataset.i18nAttrs = 'placeholder=interface:search';
  nodes.push(input);
  const document = {
    currentScript: { src: 'https://toolkit.local/js/i18n.js' },
    readyState: 'complete',
    documentElement: {},
    querySelectorAll: () => nodes
  };
  const saves = [], requests = [], events = [];
  let changed;
  const context = vm.createContext({
    document, navigator: { language: system }, URL,
    i18next, toolkitLocaleBootstrap: { registry, resources: JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8')) },
    electronAPI: {
      getInterfaceSettings: async () => ({ language }),
      setLanguage: async value => saves.push(value),
      onLanguageChanged: callback => { changed = callback; }
    },
    fetch: async url => {
      requests.push(String(url));
      const name = path.basename(new URL(url).pathname);
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, 'src/locales', name), 'utf8')) };
    },
    dispatchEvent: event => events.push(event),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  });
  vm.runInContext(source, context);
  return { api: context.toolkitI18n, document, nodes, input, saves, requests, events, externalChange: value => changed(value) };
}
function visitSyntax(node, visitors) {
  if (!node || typeof node !== 'object') return;
  visitors[node.type]?.(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visitSyntax(child, visitors));
    else if (value?.type) visitSyntax(value, visitors);
  }
}
function editorFunctions(file, names) {
  const text = fs.readFileSync(path.join(root, 'src/js', file), 'utf8');
  const functions = [];
  visitSyntax(acorn.parse(text, { ecmaVersion: 'latest' }), {
    FunctionDeclaration(node) {
      if (names.includes(node.id?.name)) functions.push(text.slice(node.start, node.end));
    }
  });
  assert.equal(functions.length, names.length);
  return functions.join('\n');
}
test('all UCP interface locales have explicit messages and matching interpolation', () => {
  const coverage = build({ check: true, strict: true });
  assert.deepEqual(registry.languages.map(language => language.id), ['en','de','fr','ru','hu','tr','zh-CN','es','fa']);
  for (const result of Object.values(coverage)) assert.equal(result.missing, 0);
});
test('renderer JavaScript and HTML reference existing locale messages', () => {
  assert.ok(checkReferences()>500);
});
test('explicit namespace keys support spaces, punctuation, and nested common actions', async () => {
  const h = harness({ language: 'de' });
  await h.api.ready;
  assert.equal(h.api.t('categories:Bad Things'), 'Schlechte Dinge');
  assert.equal(h.api.t('categories:Walls, Moat & Pitch'), 'Mauern, Graben & Pech');
  assert.equal(h.api.t('common:actions.save'), 'Speichern');
  assert.equal(h.nodes[0].textContent, 'Schlechte Dinge');
});
test('switching language updates labels while preserving user content and serialized values', async () => {
  const h = harness();
  await h.api.ready;
  const configuration = fs.readFileSync(path.join(root, 'config/optionPools.json'), 'utf8');
  const selection = element(null, 'Spearman');
  h.nodes.push(selection);
  let changes = 0;
  const unsubscribe = h.api.onChange(() => changes++);
  await h.api.changeLanguage('tr');
  assert.equal(h.input.value, 'Unsaved user content');
  assert.equal(selection.value, 'Spearman');
  assert.deepEqual(h.saves, ['tr']);
  assert.equal(h.document.documentElement.lang, 'tr');
  assert.equal(changes, 1);
  unsubscribe();
  await h.api.changeLanguage('en');
  assert.equal(changes, 1);
  assert.equal(fs.readFileSync(path.join(root, 'config/optionPools.json'), 'utf8'), configuration);
});
test('loaded castle filename, dirty marker, and live status survive language switching', async () => {
  const h = harness();
  await h.api.ready;
  const fileLabel = element('interface:no_castle_loaded');
  const status = element('interface:ready');
  const sharedStatus = element('interface:ucp_ai_library');
  h.nodes.push(fileLabel, status, sharedStatus);
  const state = { document: null, undo: [], redo: [], selected: new Set() };
  const scope = vm.createContext({
    window: {
      toolkitI18n: h.api,
      castleFormat: { isJsonPath: () => false },
      appWorkspace: { getActive: () => 'castle', setStatus: value => h.api.bindText(sharedStatus, value) }
    },
    document: { getElementById: () => ({ disabled: true }) },
    state, els: { fileLabel, status }, tr: h.api.t,
    deepClone: structuredClone,
    normalizeDocument: value => value, normalizeUnitStorage: value => value, stripSessionLocks: value => value,
    retainSourceBytes: value => value, frames: () => state.document.frames,
    invalidatePlacementCache() {}, updateToolAvailability() {}, renderPalette() {}, renderBuildList() {}, centerMap() {},
    alert: error => assert.fail(error), console
  });
  vm.runInContext(editorFunctions('castle-editor.js', ['setStatus', 'setDirty', 'updateFileLabel', 'loadDocument']), scope);
  const castle = { frames: Array.from({ length: 998 }, () => ({ itemType: 25, tilePositionOfsets: [200] })) };
  scope.loadDocument(castle, 'D:/Gatekeeper/Kratoloros.aiv', { source: 'aiv', projectManaged: true });
  scope.setDirty(true);
  const englishStatus = status.textContent;
  assert.match(englishStatus, /Kratoloros\.aiv/);
  assert.match(englishStatus, /998/);
  await h.api.changeLanguage('de');
  assert.equal(fileLabel.textContent, 'Kratoloros.aiv *');
  assert.equal(fileLabel.title, 'D:/Gatekeeper/Kratoloros.aiv');
  assert.equal(status.textContent, h.api.t('castle:opened_value_value_build_steps_valuevaluevalue', {
    value1: 'Kratoloros.aiv', length: 998, formatNote: h.api.t('details:native_aiv'), legacyNote: '', pauseNote: ''
  }));
  assert.equal(sharedStatus.textContent, status.textContent);
  assert.notEqual(status.textContent, englishStatus);
  assert.equal(state.document.frames.length, 998);
  assert.equal(state.dirty, true);
  await h.api.changeLanguage('en');
  assert.equal(status.textContent, englishStatus);
  scope.setStatus('x=42, y=17');
  await h.api.changeLanguage('de');
  assert.equal(status.textContent, 'x=42, y=17', 'raw user/runtime content replaces the old translation binding');
});
test('character name and path remain document content when interface language changes', async () => {
  const h = harness();
  await h.api.ready;
  const name = element('interface:no_character_loaded');
  const filePath = element('interface:open_a_character_json_file_or_choose_an_ai_from_the_library');
  h.nodes.push(name, filePath);
  const scope = vm.createContext({
    window: { toolkitI18n: h.api }, trCharacter: h.api.t,
    document: { getElementById: id => id === 'filePath' ? filePath : {} },
    currentFilePath: 'D:/Gatekeeper/character.json', isCharacterDirty: () => true
  });
  vm.runInContext(editorFunctions('character-editor.js', ['updateFilePathDisplay']), scope);
  h.api.bindText(name, 'Gatekeeper');
  scope.updateFilePathDisplay();
  await h.api.changeLanguage('de');
  assert.equal(name.textContent, 'Gatekeeper');
  assert.equal(filePath.textContent, 'D:/Gatekeeper/character.json *');
  scope.currentFilePath = null;
  scope.updateFilePathDisplay();
  await h.api.changeLanguage('en');
  assert.equal(filePath.textContent, h.api.t('character:no_file_loadedvalue', { dirtyMarker: ' *' }));
});
test('System preference resolves aliases, persists the preference, and loads each locale once', async () => {
  const h = harness({ language: 'system', system: 'zh-Hans' });
  await h.api.ready;
  assert.equal(h.api.locale, 'zh-CN');
  assert.equal(h.api.preference, 'system');
  assert.deepEqual(h.saves, []);
  assert.equal(h.api.resolveLanguage('ch'), 'zh-CN');
  assert.equal(h.api.resolveLanguage('es-MX'), 'es');
  assert.equal(h.api.resolveLanguage('unknown'), 'en');
  await h.api.changeLanguage('de');
  await h.api.changeLanguage('zh-CN');
  assert.equal(h.requests.length, 2);
  await h.externalChange('fr');
  assert.deepEqual(h.saves, ['de', 'zh-CN']);
});
test('pluralization follows language rules instead of adding English suffixes', async () => {
  const h = harness({ language: 'ru' });
  await h.api.ready;
  assert.equal(h.api.t('details:year', { count: 1 }), '1 год');
  assert.equal(h.api.t('details:year', { count: 2 }), '2 года');
  assert.equal(h.api.t('details:year', { count: 5 }), '5 лет');
  assert.equal(h.api.t('details:year', { count: 21 }), '21 год');
});
test('translated HTML escapes interpolated text and unknown custom names remain unchanged', async () => {
  const h = harness();
  await h.api.ready;
  assert.equal(h.api.html('details:map_name', { name: '<img src=x onerror=alert(1)>' }), ' · map: &lt;img src=x onerror=alert(1)&gt;');
  assert.equal(h.api.t('items:custom-private-id', { defaultValue: 'My custom building' }), 'My custom building');
});
test('Persian changes text direction without mirroring main or detached editor layouts', async () => {
  const h = harness();
  await h.api.ready;
  const label = element('common:actions.save');
  const detached = { document: { documentElement: {}, querySelectorAll: () => [label] }, addEventListener() {}, closed: false };
  const detach = h.api.attachWindow(detached);
  await h.api.changeLanguage('fa');
  assert.equal(h.document.documentElement.dir, 'ltr');
  assert.equal(detached.document.documentElement.dir, 'ltr');
  assert.equal(label.dir, 'auto');
  assert.notEqual(label.textContent, 'Save');
  detach();
  await h.api.changeLanguage('en');
  assert.equal(h.document.documentElement.dir, 'ltr');
});
test('bidi text preparation isolates prose and leaves pane order, numbers, paths and shortcuts LTR', async () => {
  const h = harness();
  await h.api.ready;
  const pane = element(null, '', 'DIV');
  pane.textContent = 'Persian labels and inputs';
  pane.childElementCount = 3;
  const text = element(null, '\u0633\u0644\u0627\u0645', 'TEXTAREA');
  text.selectionStart = 2; text.selectionEnd = 3;
  const number = element(null, '-12.5', 'INPUT'); number.inputMode = 'decimal';
  const path = element(null, 'D:\\Gatekeeper\\\u0642\u0644\u0639\u0647.aiv', 'INPUT'); path.dataset.bidi = 'ltr';
  const shortcut = element(null, 'Ctrl+Shift+V', 'INPUT'); shortcut.readOnly = true;
  const select = element(null, 'Spearman', 'SELECT'); select.childElementCount = 2;
  const summary = element('interface:population', '', 'SUMMARY');
  const children = [text, number, path, shortcut, select];
  h.nodes.push(summary);
  h.nodes.push(pane, ...children);
  await h.api.changeLanguage('fa');
  assert.equal(pane.dir, undefined, 'a layout container never receives RTL or auto direction');
  assert.equal(text.dir, 'auto', 'the browser chooses caret and paragraph direction from editable prose');
  assert.equal(text.value, '\u0633\u0644\u0627\u0645');
  assert.deepEqual([text.selectionStart, text.selectionEnd], [2, 3]);
  for (const control of [number, path, shortcut, select]) assert.equal(control.dir, 'ltr');
  assert.equal(summary.dir, 'ltr', 'disclosure controls stay on their original side');
  assert.deepEqual(children.map(control => control.value), ['\u0633\u0644\u0627\u0645', '-12.5', 'D:\\Gatekeeper\\\u0642\u0644\u0639\u0647.aiv', 'Ctrl+Shift+V', 'Spearman']);
  text.value = 'Latin text';
  await h.api.changeLanguage('en');
  assert.equal(text.dir, 'auto', 'text input direction is content-based rather than locked to the interface language');
  assert.equal(h.document.documentElement.dir, 'ltr');
});
test('Persian interpolation isolates mixed-script filenames and signed numbers without modifying source values', async () => {
  const h = harness({ language: 'fa' });
  await h.api.ready;
  const name = 'Gatekeeper (\u0642\u0644\u0639\u0647 2).aiv';
  const message = h.api.t('feedback:opened', { name });
  assert.ok(message.includes('\u2068' + name + '\u2069'));
  const tiles = h.api.t('details:tile', { count: -12 });
  assert.ok(tiles.includes('\u2066-12\u2069'));
  assert.ok(h.api.t('feedback:opened', { name: '-12.5' }).includes('\u2066-12.5\u2069'));
  assert.equal(name, 'Gatekeeper (\u0642\u0644\u0639\u0647 2).aiv');
  await h.api.changeLanguage('en');
  assert.equal(h.api.t('feedback:opened', { name }), name + ' opened.');
});
test('translating Content labels keeps existing textareas, values and caret ranges', async () => {
  const h = harness();
  await h.api.ready;
  const input = element(null, '\u0633\u0644\u0627\u0645 Castle', 'TEXTAREA');
  input.selectionStart = 1; input.selectionEnd = 3;
  const name = element(null);
  const label = { dataset: { lineKey: 'ai_name' }, querySelector: selector => selector === 'span' ? name : input };
  const form = { querySelectorAll: selector => selector === '.aiLineField' ? [label] : [name, input] };
  const scope = vm.createContext({
    window: { toolkitI18n: h.api }, els: { form },
    friendlyLabel: () => h.api.t('interface:ai_name'), lineHint: () => h.api.t('interface:search')
  });
  vm.runInContext(editorFunctions('ai-content-editor.js', ['translateLineLabels']), scope);
  h.api.onChange(scope.translateLineLabels);
  await h.api.changeLanguage('fa');
  assert.equal(name.textContent, h.api.t('interface:ai_name'));
  assert.equal(input.placeholder, h.api.t('interface:search'));
  assert.equal(label.querySelector('textarea'), input);
  assert.equal(input.value, '\u0633\u0644\u0627\u0645 Castle');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 3]);
  assert.equal(input.dir, 'auto');
});
test('translating Library details never rewrites an in-progress clone draft', async () => {
  const h = harness();
  await h.api.ready;
  let writes = 0;
  const fields = new Map();
  const els = new Proxy({}, { get(_target, key) {
    if (!fields.has(key)) {
      const node = element(null, 'Draft text');
      node.classList = { toggle() {} };
      if (/^clone(?:Name|Id|Version)$/.test(key)) Object.defineProperty(node, 'value', { get: () => 'Draft text', set: () => { writes++; } });
      fields.set(key, node);
    }
    return fields.get(key);
  } });
  const scope = vm.createContext({
    window: { toolkitI18n: h.api }, els, tr: h.api.t, placeholderPortrait: '',
    selectedAi: () => ({ name: 'Gatekeeper', plugin: { displayName: 'Test' }, castles: [] }),
    setButtonAvailable() {}, renderCastleSummary() {}, germanSlug: value => value
  });
  vm.runInContext(editorFunctions('ucp-library.js', ['renderDetails']), scope);
  h.api.onChange(() => scope.renderDetails({ preserveDraft: true }));
  await h.api.changeLanguage('fa');
  assert.equal(writes, 0);
  assert.equal(els.cloneName.value, 'Draft text');
});
test('detached 2.5D title and Dock button follow the selected language', async () => {
  const h = harness({ language: 'de' });
  await h.api.ready;
  const isoSource = fs.readFileSync(path.join(root, 'src/js/iso-view.js'), 'utf8');
  const dockKey = isoSource.match(/id="isoWindowDockBtn"[^>]*data-i18n="([^"]+)"/)?.[1];
  assert.ok(dockKey, 'the detached Dock button has an explicit translation binding');
  const dock = element(dockKey);
  const detached = { document: { documentElement: {}, querySelectorAll: () => [dock] }, addEventListener() {}, closed: false };
  detached.document.title = h.api.t('viewport:2_5d_view_ai_toolkit');
  h.api.attachWindow(detached);
  let languageListener;
  visitSyntax(acorn.parse(isoSource, { ecmaVersion: 'latest' }), {
    CallExpression(node) {
      if (node.callee.property?.name === 'onChange') languageListener = isoSource.slice(node.start, node.end);
    }
  });
  assert.ok(languageListener);
  let refreshes = 0;
  vm.runInNewContext(languageListener, {
    window: { toolkitI18n: h.api }, state: { host: { kind: 'window', win: detached } },
    tr: h.api.t, refresh: () => refreshes++
  });
  assert.equal(dock.textContent, 'Andocken');
  await h.api.changeLanguage('en');
  assert.equal(dock.textContent, 'Dock');
  assert.equal(detached.document.title, h.api.t('viewport:2_5d_view_ai_toolkit'));
  assert.equal(refreshes, 1);
});
test('2.5D toolbar bindings follow locale changes while controls move between documents', async () => {
  const h = harness();
  await h.api.ready;
  const gameMap = element('interface:game_map');
  gameMap.dataset.i18nAttrs = 'title=interface:lay_a_map_of_the_game_under_the_slanted_view_to_scale_one_field_of_the_map_o';
  const selectedStart = element(null, '3', 'SELECT');
  const controls = { querySelectorAll: () => [gameMap, selectedStart], parentElement: null };
  const state = { controls, host: null };
  const store = { appendChild: child => { assert.equal(child, controls); child.parentElement = store; } };
  const scope = vm.createContext({
    window: { toolkitI18n: h.api }, state,
    document: { getElementById: () => store }, tr: h.api.t, refresh() {}
  });
  const isoSource = fs.readFileSync(path.join(root, 'src/js/iso-view.js'), 'utf8');
  visitSyntax(acorn.parse(isoSource, { ecmaVersion: 'latest' }), {
    CallExpression(node) {
      if (node.callee.property?.name === 'onChange') vm.runInContext(isoSource.slice(node.start, node.end), scope);
    }
  });
  vm.runInContext(editorFunctions('iso-view.js', ['parkControls']), scope);
  // During native close/reparenting the controls need not belong to either
  // document's query results; their stable references still own the bindings.
  await h.api.changeLanguage('de');
  const germanLabel = gameMap.textContent;
  assert.equal(germanLabel, h.api.t('interface:game_map'));
  await h.api.changeLanguage('en');
  assert.equal(gameMap.textContent, 'Game map');
  assert.equal(gameMap.attributes.title, h.api.t('interface:lay_a_map_of_the_game_under_the_slanted_view_to_scale_one_field_of_the_map_o'));
  gameMap.textContent = germanLabel;
  scope.parkControls();
  assert.equal(controls.parentElement, store);
  assert.equal(gameMap.textContent, 'Game map', 'parking reconciles a toolbar from a differently localized detached document');
  assert.equal(selectedStart.value, '3', 'translation never recreates or resets the map-start selection');
});

test('validation errors use the selected language without translating document fields', async () => {
  const h = harness({ language: 'de' });
  await h.api.ready;
  function validator(file) {
    const context = vm.createContext({ module: { exports: {} }, toolkitI18n: h.api });
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js', file), 'utf8'), context);
    return context.module.exports;
  }
  const balance = { buildings: { Farm: { health: -1 } } };
  assert.throws(() => validator('castle-balance.js').validate(balance), error => {
    assert.match(error.message, /Farm/);
    assert.match(error.message, /health/);
    assert.doesNotMatch(error.message, /must be/);
    return true;
  });
  assert.deepEqual(balance, { buildings: { Farm: { health: -1 } } });
  const castle = { frames: [{ itemType: 61, tilePositionOfsets: [-1] }] };
  assert.throws(() => validator('castle-format.js').validate(castle), error => {
    assert.match(error.message, /Schritt 1/);
    assert.doesNotMatch(error.message, /invalid tile offset/);
    return true;
  });
  assert.deepEqual(castle, { frames: [{ itemType: 61, tilePositionOfsets: [-1] }] });
});
test('English catalog entries are data, never dynamic HTML or executable templates', () => {
  for (const file of fs.readdirSync(path.join(root, 'locales/en')).filter(file => file.endsWith('.yaml'))) {
    const data = yaml.load(fs.readFileSync(path.join(root, 'locales/en', file), 'utf8'));
    for (const value of Object.values(flatten(data))) {
      assert.doesNotMatch(value, /<(?:script|iframe|button|div)\b/i, file);
      assert.doesNotMatch(value, /\$\{/, file);
    }
  }
});
