const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'Stronghold Crusader Extreme', 'ucp', 'modules', 'aiEditor-1.2.0');

function loadBridge(hostFunctions) {
  const listeners = {};
  const sandboxFunctions = {};
  const context = {
    console,
    structuredClone,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Blob,
    FileReader: class FileReader {
      readAsDataURL(file) {
        file.arrayBuffer().then(arrayBuffer => {
          const mime = file.type || 'application/octet-stream';
          this.result = `data:${mime};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
          this.onload?.();
        }, error => {
          this.error = error;
          this.onerror?.();
        });
      }
    },
    Date,
    setTimeout,
    clearTimeout,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    addEventListener: (name, callback) => { listeners[name] = callback; },
    HOST_FUNCTIONS: hostFunctions,
    SANDBOX_FUNCTIONS: sandboxFunctions
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const bundle = fs.readFileSync(path.join(moduleRoot, 'menu', 'ai-editor.js'), 'utf8')
    .split('/* MAIN_EDITOR_SCRIPTS */')[0];
  vm.runInContext(bundle, context, { filename: 'ai-editor-bridge.js' });
  return { context, listeners, sandboxFunctions };
}

test('full AI Toolkit UCP menu contains all four editor workspaces', () => {
  for (const relativePath of [
    'definition.yml',
    'options.yml',
    'locale/en.yml',
    'locale/description-en.md',
    'menu/ai-editor.html',
    'menu/ai-editor.css',
    'menu/ai-editor.js'
  ]) {
    const file = path.join(moduleRoot, relativePath);
    assert.ok(fs.existsSync(file), `${relativePath} is missing`);
    assert.ok(fs.statSync(file).size > 0, `${relativePath} is empty`);
  }

  const html = fs.readFileSync(path.join(moduleRoot, 'menu', 'ai-editor.html'), 'utf8');
  assert.match(html, /id="ucpWorkspace"/);
  assert.match(html, /id="characterWorkspace"/);
  assert.match(html, /id="castleWorkspace"/);
  assert.match(html, /id="aiContentWorkspace"/);
  assert.match(html, /id="ucpLibrarySearch"/);
  assert.match(html, /id="aiSpeechLanguage"/);
  assert.match(html, /<script id="aiToolkitRuntime">/);
  assert.match(html, /MAIN_EDITOR_SCRIPTS/);
  assert.ok(
    html.indexOf('id="aiToolkitRuntime"') > html.indexOf('id="aiContentWorkspace"'),
    'the editor runtime must run after the menu DOM exists'
  );

  const css = fs.readFileSync(path.join(moduleRoot, 'menu', 'ai-editor.css'), 'utf8');
  assert.match(css, /\.ucpModuleNotice/);
  assert.match(css, /\.aiContent/);

  const js = fs.readFileSync(path.join(moduleRoot, 'menu', 'ai-editor.js'), 'utf8');
  assert.ok(Buffer.byteLength(js) < 1024 * 1024, 'menu JavaScript should keep large PNG assets external');
  assert.match(js, /receivePluginPaths/);
  assert.match(js, /scanUcpAiLibrary/);
  assert.match(js, /loadUcpAiProject/);
  assert.match(js, /loadAiMediaData/);
  assert.match(js, /function createZip/);
  assert.match(js, /function parseAiv/);
  assert.match(js, /function encodeAiv/);
  assert.match(js, /MAIN_EDITOR_SCRIPTS/);
  assert.ok(fs.existsSync(path.join(moduleRoot, 'menu', 'assets', 'aiv', 'background.png')));
  assert.ok(fs.existsSync(path.join(moduleRoot, 'menu', 'assets', 'aiv', 'skins', '61.png')));
});

test('full AI Toolkit UCP package uses split menu assets and keeps a distributable archive', () => {
  const definition = fs.readFileSync(path.join(moduleRoot, 'definition.yml'), 'utf8');
  const options = fs.readFileSync(path.join(moduleRoot, 'options.yml'), 'utf8');
  assert.match(definition, /^name: aiEditor$/m);
  assert.match(definition, /^version: 1\.2\.0$/m);
  assert.match(definition, /^\s+aiSwapper: ">= 1\.2\.0"$/m);
  assert.match(options, /^\s+html: ai-editor\.html$/m);
  assert.match(options, /^\s+css: ai-editor\.css$/m);
  assert.doesNotMatch(options, /^\s+js:/m);

  const archive = path.join(root, 'ucp-ai-editor', 'dist', 'aiEditor-1.2.0.zip');
  assert.ok(fs.existsSync(archive), 'aiEditor-1.2.0.zip is missing');
  assert.ok(fs.statSync(archive).size > 0, 'aiEditor-1.2.0.zip is empty');
});

test('UCP bridge supports version filtering, native castles and edited-file export', () => {
  const bridge = fs.readFileSync(path.join(root, 'ucp-ai-editor', 'src', 'bridge.mjs'), 'utf8');
  assert.match(bridge, /compareVersions\(plugin\.version, current\.version\) > 0/);
  assert.match(bridge, /await availablePluginPaths\('\*\*\/meta\.json'\)/);
  assert.match(bridge, /webkitdirectory/);
  assert.match(bridge, /pickedPluginFiles/);
  assert.ok(bridge.indexOf('resolveHostReady();') < bridge.indexOf('HOST_FUNCTIONS.getCurrentConfig()'));
  assert.match(bridge, /Reading UCP plugin paths/);
  assert.match(bridge, /return \{ document: parseAiv\(bytes\), source: 'aiv'/);
  assert.match(bridge, /const bytes = encodeAiv\(documentValue, aivTemplates/);
  assert.match(bridge, /edited-files\.zip/);
  assert.match(bridge, /portrait_small\.png/);
  assert.match(bridge, /MAX_STAGED_MEDIA_BYTES/);
});

test('built UCP bridge discovers only the newest installed version of an AI plugin', async () => {
  const files = new Map([
    ['ucp/plugins/sample-ai-2.0.0/resources/ai/keeper/meta.json', JSON.stringify({ name: 'Keeper', version: '1.0.0', author: 'Tester' })],
    ['ucp/plugins/sample-ai-2.0.0/resources/ai/keeper/character.json', '{}'],
    ['ucp/plugins/sample-ai-2.0.0/resources/ai/keeper/lines.json', '{}'],
    ['ucp/plugins/sample-ai-2.0.0/resources/ai/keeper/aiv/mapping.json', JSON.stringify({ castle_1: 'castle1.aiv' })]
  ]);
  const extensions = [
    {
      description: { name: 'sample-ai', 'display-name': 'Sample AI', version: '1.0.0' },
      path: 'ucp/plugins/sample-ai-1.0.0',
      paths: ['ucp/plugins/sample-ai-1.0.0/resources/ai/old/meta.json']
    },
    {
      description: { name: 'sample-ai', 'display-name': 'Sample AI', version: '2.0.0' },
      path: 'ucp/plugins/sample-ai-2.0.0',
      paths: ['ucp/plugins/sample-ai-2.0.0/resources/ai/keeper/meta.json']
    }
  ];
  const host = {
    getCurrentConfig: async () => ({ baseline: {}, user: {} }),
    receivePluginPaths: async (_base, pattern) => pattern === '**/meta.json' ? extensions : [],
    getTextFile: async filePath => files.get(filePath) || null,
    getAssetUrl: async filePath => `asset://localhost/${encodeURIComponent(filePath)}`
  };
  const { context, listeners, sandboxFunctions } = loadBridge(host);
  await listeners.INIT_DONE();
  const library = await context.electronAPI.scanUcpAiLibrary();
  assert.equal(library.ais.length, 1);
  assert.equal(library.ais[0].name, 'Keeper');
  assert.equal(library.ais[0].plugin.version, '2.0.0');
  assert.equal(library.ais[0].castles[0].fileName, 'castle1.aiv');
  assert.equal(library.ais[0].castles[0].requiresFileAccess, true);
  assert.equal(library.fullFileAccess, false);
  assert.equal(typeof sandboxFunctions.getConfig, 'function');
});

test('built UCP bridge can include an inactive plugins folder and open its binary castle', async () => {
  const castleBytes = fs.readFileSync(path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aiv'));
  const makeFile = (relativePath, content) => {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    return {
      name: path.posix.basename(relativePath),
      webkitRelativePath: relativePath,
      size: bytes.length,
      type: relativePath.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream',
      text: async () => bytes.toString('utf8'),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  };
  const files = [
    makeFile('plugins/Inactive-AI-1.4.0/definition.yml', 'name: Inactive-AI\ndisplay-name: Inactive AI Pack\nversion: 1.4.0\ntype: plugin\n'),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/meta.json', JSON.stringify({ name: 'Inactive Keeper', version: '1.0.0' })),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/character.json', '{}'),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/lines.json', '{}'),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/aiv/mapping.json', JSON.stringify({ castle_1: 'castle1.aiv' })),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/aiv/castle1.aiv', castleBytes),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/lang/en/speech/mapping.json', JSON.stringify({ taunt_1: 'keeper_taunt.wav' })),
    makeFile('plugins/Inactive-AI-1.4.0/resources/ai/keeper/lang/en/speech/keeper_taunt.wav', Buffer.from('RIFF-test-wave'))
  ];
  const host = {
    getCurrentConfig: async () => ({ baseline: {}, user: {} }),
    receivePluginPaths: async () => [],
    getTextFile: async () => null,
    getAssetUrl: async filePath => `asset://localhost/${encodeURIComponent(filePath)}`
  };
  const { context, listeners } = loadBridge(host);
  context.document = {
    body: { appendChild() {} },
    createElement() {
      const handlers = {};
      return {
        files,
        setAttribute() {},
        addEventListener(name, callback) { handlers[name] = callback; },
        click() { handlers.change(); },
        remove() {}
      };
    }
  };
  await listeners.INIT_DONE();
  const label = await context.electronAPI.chooseUcpInstallation();
  assert.match(label, /Full AI access enabled/);
  const library = await context.electronAPI.scanUcpAiLibrary();
  assert.equal(library.ais.length, 1);
  assert.equal(library.ais[0].active, false);
  assert.equal(library.ais[0].plugin.version, '1.4.0');
  assert.equal(library.ais[0].castles[0].requiresFileAccess, false);
  assert.equal(library.fullFileAccess, true);
  const project = await context.electronAPI.loadUcpAiProject({
    aiRoot: library.ais[0].rootPath,
    castleFile: 'castle1.aiv'
  });
  assert.equal(project.castle.source, 'aiv');
  assert.ok(project.castle.document.frames.length > 0);
  assert.equal(project.media.speech.length, 1);
  assert.equal(project.media.speech[0].exists, true);
  const speech = await context.electronAPI.loadAiMediaData({
    mappingRelativePath: project.media.speech[0].mappingRelativePath,
    fileName: project.media.speech[0].fileName
  });
  assert.match(speech.dataUrl, /^data:audio\/wav;base64,/);
});
