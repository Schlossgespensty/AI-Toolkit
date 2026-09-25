const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateManifest, readVariables, createController } = require('../src/js/theme');

const directory = path.join(__dirname, '../assets/themes');
const manifest = id => JSON.parse(fs.readFileSync(path.join(directory, id, 'theme.json'), 'utf8'));

test('each registered theme is a complete attributed pack with intact image files', () => {
  for (const pack of JSON.parse(fs.readFileSync(path.join(directory, 'registry.json'), 'utf8'))) {
    const definition = validateManifest(manifest(pack.id), pack.id);
    assert.equal(definition.name, pack.name);
    assert.ok(fs.existsSync(path.join(directory, pack.id, 'tokens.json')));
    assert.ok(fs.existsSync(path.join(directory, pack.id, definition.variables)));
    for (const texture of Object.values(definition.textures)) {
      const bytes = fs.readFileSync(path.join(directory, pack.id, texture.file));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    }
  }
});

test('theme manifest rejects path traversal, remote textures, unknown slots and unsafe geometry', () => {
  for (const file of ['../outside.png', 'textures/../outside.png', 'https://example.com/image.png', 'textures/test.css', 'textures/a\\b.png']) {
    const value = manifest('ucp'); value.textures.control.file = file;
    assert.throws(() => validateManifest(value), /texture/);
  }
  const value = manifest('ucp'); value.textures.control.width = 300;
  assert.throws(() => validateManifest(value), /frame/);
  value.textures.control.width = 8; value.textures.script = value.textures.control;
  assert.throws(() => validateManifest(value), /slot/);
});

test('generated variable input cannot load arbitrary CSS or external files', () => {
  for (const css of ['@import "evil.css";', ':root{--primitive-color-x:url(https://example.com)}', '<style>body{display:none}</style>', ':root{--primitive-color-x:expreSSion(x)}', ':root{--primitive-color-x:u\\72l(x)}']) {
    assert.throws(() => readVariables(css, null), /unsupported CSS/);
  }
  const CSSSheet = class { replaceSync() { this.cssRules = [{ selectorText: 'body', style: {} }]; } };
  assert.throws(() => readVariables('body { display:none }', null, CSSSheet), /:root/);
});

test('theme tokens use one shared semantic hierarchy, without a duplicate layout sheet', () => {
  const base = JSON.parse(fs.readFileSync(path.join(directory, 'default/tokens.json'), 'utf8'));
  const variant = JSON.parse(fs.readFileSync(path.join(directory, 'ucp/tokens.json'), 'utf8'));
  assert.deepEqual(Object.keys(base).filter(key => !key.startsWith('$')).sort(), ['component', 'primitive', 'semantic']);
  assert.equal(base.component.button.surface.$value, '{semantic.surface.control}');
  assert.equal(base.component.input.content.$value, base.component.button.content.$value);
  assert.equal(variant.component.button.content.$value, '{semantic.content.onAccent}');
  assert.equal(fs.existsSync(path.join(__dirname, '../src/css/combined-blue.css')), false);
  const css = fs.readFileSync(path.join(__dirname, '../src/css/theme-components.css'), 'utf8');
  assert.match(css, /input\[type="checkbox"\]:checked/);
  assert.match(css, /input\[type="checkbox"\]:indeterminate/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /:focus-visible/);
});

test('toolbar groups expose independent decoration and spacing in every complete pack', () => {
  const read = file => fs.readFileSync(path.join(directory, file), 'utf8');
  const defaults = JSON.parse(read('default/tokens.json')).component;
  const ucp = JSON.parse(read('ucp/tokens.json')).component;
  assert.equal(defaults.toolbarGroup.borderWidth.$value.value, 1);
  assert.equal(defaults.toolbarGroup.accentWidth.$value.value, 3);
  assert.equal(ucp.toolbarGroup.borderWidth.$value.value, 0);
  assert.equal(ucp.toolbarGroup.accentWidth.$value.value, 0);
  assert.equal(ucp.toolbarGroup.surface.$value, 'transparent');
  assert.equal(ucp.toolbarGroup.shadow.$value, 'none');
  const names = css => [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]).sort();
  assert.deepEqual(names(read('ucp/variables.css')), names(read('default/variables.css')));
  const css = fs.readFileSync(path.join(__dirname, '../src/css/theme-components.css'), 'utf8');
  assert.match(css, /\.castleToolbar > \.toolbarGroup\s*\{/);
  assert.doesNotMatch(css, /\.castleToolbarGroup\b/, 'group styles must target the actual shared markup');
  assert.match(css, /gap: var\(--component-toolbar-group-gap\)/);
  assert.match(css, /border: var\(--component-toolbar-group-border-width\)/);
  assert.match(css, /background: var\(--component-toolbar-group-surface\)/);
});

// The controller consumes the browser CSSOM. This tiny DOM stand-in tests its
// asynchronous lifecycle, not CSS parsing (the packaged preview checks that).
function environment({ delay = () => Promise.resolve() } = {}) {
  const properties = new Map();
  const callbacks = {};
  const calls = [];
  let saved = '';
  const sheet = class {
    replaceSync() {
      const style = { 0: '--primitive-color-ink', length: 1, getPropertyPriority: () => '', getPropertyValue: () => '#101416' };
      this.cssRules = [{ selectorText: ':root', style }];
    }
  };
  const document = { currentScript: { src: 'file:///app/src/js/theme.js' }, baseURI: 'file:///app/src/index.html', documentElement: { style: { setProperty: (name, value) => properties.set(name, value) }, dataset: {} } };
  return {
    document, CSSStyleSheet: sheet, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, dispatchEvent() {}, console,
    electronAPI: { getInterfaceSettings: async () => ({ theme: 'default' }), setTheme: async id => { saved = id; }, onThemeChanged: callback => { callbacks.theme = callback; } },
    fetch: async url => {
      calls.push(String(url)); await delay(String(url));
      const id = String(url).includes('/ucp/') ? 'ucp' : 'default';
      return { ok: true, json: async () => manifest(id), text: async () => ':root { --primitive-color-ink: #101416; }' };
    },
    properties, callbacks, calls, saved: () => saved,
  };
}

test('a theme switch persists once and reuses loaded packs without renderer work', async () => {
  const env = environment(); const theme = createController(env);
  await theme.init(); await theme.select('ucp');
  assert.equal(env.saved(), 'ucp');
  assert.equal(env.document.documentElement.dataset.themedCheckboxes, 'true');
  assert.match(theme.texture('backdrop'), /\/default\/textures\/backdrop.png$/);
  assert.match(env.properties.get('--texture-control'), /\/ucp\/textures\/button_ucp.png/);
  const count = env.calls.length;
  await theme.select('default'); await theme.select('ucp');
  assert.equal(env.calls.length, count);
});

test('a late slow theme load cannot replace a newer choice', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const env = environment({ delay: url => url.includes('/ucp/') ? barrier : Promise.resolve() });
  const theme = createController(env); await theme.init();
  const first = theme.apply('ucp'); await theme.apply('default'); release(); await first;
  assert.equal(theme.current, 'default');
  assert.equal(env.document.documentElement.dataset.theme, 'default');
});

test('native theme changes and detached windows share the same pack', async () => {
  const env = environment(); const theme = createController(env); await theme.init();
  const second = environment(); const links = [];
  second.document.createElement = () => ({}); second.document.head = { appendChild: link => links.push(link) };
  theme.attachWindow(second);
  await env.callbacks.theme('ucp');
  assert.equal(second.document.documentElement.dataset.theme, 'ucp');
  assert.match(links[0].href, /\/src\/css\/theme-detached.css$/);
});

test('optional role art never hides functional controls in a minimal custom-style pack', async () => {
  const env = environment(), originalFetch = env.fetch;
  env.fetch = async url => {
    const response = await originalFetch(url);
    if (String(url).includes('/ucp/') && String(url).endsWith('theme.json')) {
      const minimal = manifest('ucp');
      minimal.textures = { control: minimal.textures.control };
      return { ...response, json: async () => minimal };
    }
    return response;
  };
  const theme = createController(env);
  await theme.init(); await theme.apply('ucp');
  assert.equal(env.document.documentElement.dataset.themedControls, 'true');
  for (const role of ['Panels', 'Reorder', 'Stepper', 'Range', 'Scrollbars', 'Tabs', 'Fields']) {
    assert.equal(env.document.documentElement.dataset['themed' + role], 'false', role);
  }
});

test('a discovered renamed UCP pack uses shared roles and its scoped local artwork', async () => {
  const env = environment(), originalFetch = env.fetch;
  env.electronAPI.listThemes = async () => [
    { id: 'my-theme', name: 'My theme', baseUrl: 'http://asset.localhost/C%3A/users/test/themes/my-theme/' },
    { id: 'remote', name: 'Remote', baseUrl: 'https://example.com/themes/remote/' },
  ];
  env.electronAPI.getInterfaceSettings = async () => ({ theme: 'my-theme' });
  env.fetch = async url => String(url).includes('/my-theme/')
    ? { ok: true, json: async () => ({ ...manifest('ucp'), id: 'my-theme', name: 'My theme' }), text: async () => ':root { --primitive-color-ink: #101416; }' }
    : originalFetch(url);
  const theme = createController(env); await theme.init();
  assert.equal(theme.current, 'my-theme');
  assert.equal(env.document.documentElement.dataset.themedReorder, 'true');
  assert.equal(env.document.documentElement.dataset.themedCheckboxes, 'true');
  assert.match(theme.texture('moveUp'), /^http:\/\/asset\.localhost\/.*\/my-theme\/textures\//);
  assert.equal(theme.list().some(pack => pack.id === 'remote'), false);
});

test('a native menu choice discovers a pack added after the window was opened', async () => {
  const env = environment(), originalFetch = env.fetch;
  let available = [];
  env.electronAPI.listThemes = async () => available;
  env.fetch = async url => String(url).includes('/new-theme/')
    ? { ok: true, json: async () => ({ ...manifest('ucp'), id: 'new-theme', name: 'New theme' }), text: async () => ':root { --primitive-color-ink: #101416; }' }
    : originalFetch(url);
  const theme = createController(env); await theme.init();
  available = [{ id: 'new-theme', name: 'New theme', baseUrl: 'http://asset.localhost/themes/new-theme/' }];
  await env.callbacks.theme('new-theme');
  assert.equal(theme.current, 'new-theme');
  assert.equal(env.document.documentElement.dataset.themedReorder, 'true');
});


test('UCP keeps dark shell tokens distinct from framed paper and original reorder proportions', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(directory, 'ucp/tokens.json'), 'utf8'));
  assert.equal(pack.primitive.color.ink.$value.hex, '#212529');
  assert.equal(pack.component.panel.surface.$value.hex, '#e4dbc3');
  assert.equal(pack.component.panel.content.$value.hex, '#292720');
  assert.equal(pack.component.input.content.$value, '{component.panel.content}');
  // Numbers wear the same light field as text on paper, not a dark inlay.
  assert.equal(pack.component.value.content.$value, '{component.input.content}');
  assert.equal(pack.component.value.surface.$value, '{component.input.surface}');
  assert.equal(manifest('ucp').textures.value.file, manifest('ucp').textures.input.file);
  for (const slot of ['moveUp', 'moveDown', 'moveUpHover', 'moveDownPressed']) {
    const bytes = fs.readFileSync(path.join(directory, 'ucp', manifest('ucp').textures[slot].file));
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [12, 7]);
  }
  const css = fs.readFileSync(path.join(__dirname, '../src/css/theme-components.css'), 'utf8');
  assert.match(css, /var\(--step-arrow\) center \/ auto no-repeat/);
  assert.match(css, /scrollbar-track-piece:start:vertical/);
  assert.match(css, /scrollbar-thumb:vertical/);
  assert.match(css, /border-bottom: calc\(var\(--component-scrollbar-cap-height\) \/ 2\)/);
  assert.match(css, /background: var\(--texture-scroll-thumb\) center \/ auto no-repeat/);
  assert.doesNotMatch(css, /var\(--texture-scroll-thumb\), var\(--texture-scroll-track\)/);
  assert.doesNotMatch(css, /radial-gradient\(40% 100%/);
  assert.doesNotMatch(css, /html\[data-theme=["']ucp/);
});


test('shared layers keep component paint below packs and accessibility above packs', () => {
  const cssDirectory = path.join(__dirname, '../src/css');
  const css = fs.readFileSync(path.join(cssDirectory, 'combined.css'), 'utf8');
  assert.match(css, /@layer tokens, layout, components, theme, accessibility;/);
  assert.match(css, /@import url\("\.\.\/\.\.\/assets\/themes\/default\/variables\.css"\) layer\(tokens\);/);
  assert.match(css, /@layer layout \{/);
  assert.match(css, /@layer components \{/);
  // Late-loaded panels stay below the pack too: source order is not an override API.
  for (const name of ['castle-sidebar.css', 'castle-cost-panel.css', 'editor-extras.css']) {
    assert.match(fs.readFileSync(path.join(cssDirectory, name), 'utf8'), /^@layer components \{/);
  }
  const theme = fs.readFileSync(path.join(cssDirectory, 'theme-components.css'), 'utf8');
  assert.match(theme, /@layer theme \{/);
  assert.match(theme, /@layer accessibility \{/);
  assert.doesNotMatch(theme, /#characterWorkspace \.field (?:input|select|:is\(input)/,
    'field roles must work in all workspaces without ID specificity patches');
  assert.doesNotMatch(theme, /(?:background|border-color|color):[^;\n]*!important/,
    'pack paint must win by its layer, not important declarations');
  // Parse every sheet through the already-shipped build tool, catching malformed
  // wrappers/imports while preserving browser-native layers and nesting.
  const { transformSync } = require('esbuild');
  for (const name of fs.readdirSync(cssDirectory).filter(name => name.endsWith('.css'))) {
    const result = transformSync(fs.readFileSync(path.join(cssDirectory, name), 'utf8'), { loader: 'css', target: 'chrome110' });
    assert.deepEqual(result.warnings, [], name);
  }
});

test('detached viewport chrome belongs to shared CSS, not a second inline theme', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/js/iso-view.js'), 'utf8');
  const detached = fs.readFileSync(path.join(__dirname, '../src/css/theme-detached.css'), 'utf8');
  assert.doesNotMatch(source, /chromeStyle|document\.body\.style\.cssText|id="isoWindow(?:Canvas|Status)" style=/);
  assert.match(source, /ToolkitTheme\?\.attachWindow\(win\)/);
  assert.match(detached, /@import url\('combined\.css'\);/);
  assert.match(detached, /@layer layout \{/);
  assert.match(detached, /#isoWindowHost \{ position: fixed; inset: 34px 0 0; \}/);
  assert.doesNotMatch(detached, /!important|#[a-f\d]{6}\b/i,
    'detached chrome inherits role colors without its own palette or specificity overrides');
});

test('growing panels and lists keep room for their scrollbar, so their boxes keep one width', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'combined.css'), 'utf8');
  const rule = css.match(/:is\(([^)]*)\) \{\s*scrollbar-gutter: stable;/);
  assert.ok(rule, 'scrollbar-gutter rule');
  for (const name of ['.castleBuildList', '.castleSidebarOverviews', '.castlePalette', '.characterForm', '.ucpAiList'])
    assert.ok(rule[1].includes(name), name);
});

test('the overviews share one frame like the build list, so their scrollbar runs inside it', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'theme-components.css'), 'utf8');
  assert.match(css, /:is\([^)]*\.castleBuildList, \.castleOverviewPanel, \.castleSidebarOverviews,[^)]*\) \{\s*--text-main/);
  assert.match(css, /\.castleSidebarOverviews > \.castleOverviewPanel \{ margin: 0; border: 0; border-image: none; background: transparent; \}/);
});

test('view toolbars keep their scrollbar room, so a splitter drag does not move the view below', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'combined.css'), 'utf8');
  const theme = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'theme-components.css'), 'utf8');
  const rule = layout.match(/\n\.isoViewControls \{([^}]*)\}/);
  assert.ok(rule, '.isoViewControls rule');
  assert.match(rule[1], /overflow-x: scroll;/);
  assert.match(rule[1], /scrollbar-width: auto;/);
  assert.match(theme, /\.isoViewControls::-webkit-scrollbar-track:horizontal:disabled \{ border-image: none; background: transparent; \}/);
});
