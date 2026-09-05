const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { promisify } = require('node:util');
const luaparse = require('luaparse');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'ucp-module', 'aivModEditor-0.2.1');
const bundlePath = path.join(moduleRoot, 'menu', 'aiv-mod-editor.js');
const converter = path.join(root, 'plugins', 'aivconverter.exe');

function loadCodecBundle() {
  const context = {
    console,
    structuredClone,
    addEventListener: () => {},
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  const bridgeBundle = fs.readFileSync(bundlePath, 'utf8').split('/* ORIGINAL_EDITOR_SCRIPTS */')[0];
  vm.runInContext(bridgeBundle, context, { filename: bundlePath });
  return context.AIVModEditorTest;
}

function comparable(value) {
  return {
    pauseDelayAmount: Number(value?.pauseDelayAmount) || 0,
    frames: (value?.frames || []).filter(frame => (
      frame && Number.isInteger(Number(frame.itemType)) &&
      Array.isArray(frame.tilePositionOfsets) && frame.tilePositionOfsets.length > 0
    )).map(frame => ({
      itemType: Number(frame.itemType),
      tilePositionOfsets: frame.tilePositionOfsets.map(Number),
      shouldPause: Boolean(frame.shouldPause)
    })),
    miscItems: (value?.miscItems || []).map(item => ({
      positionOfset: Number(item.positionOfset),
      itemType: Number(item.itemType),
      number: Number(item.number)
    }))
  };
}

test('literal UCP module package contains its required extension files', () => {
  for (const relativePath of [
    'definition.yml', 'options.yml', 'init.lua', 'locale/en.yml',
    'menu/aiv-mod-editor.html', 'menu/aiv-mod-editor.css', 'menu/aiv-mod-editor.js'
  ]) {
    const file = path.join(moduleRoot, relativePath);
    assert.ok(fs.existsSync(file), `${relativePath} is missing`);
    assert.ok(fs.statSync(file).size > 0, `${relativePath} is empty`);
  }
  assert.ok(fs.existsSync(path.join(root, 'ucp-module', 'dist', 'aivModEditor-0.2.1.zip')));
  const menuHtml = fs.readFileSync(path.join(moduleRoot, 'menu', 'aiv-mod-editor.html'), 'utf8');
  assert.match(menuHtml, /id="characterWorkspace"/);
  assert.match(menuHtml, /id="castleWorkspace"/);
  assert.match(menuHtml, /id="castlePalette"/);
  assert.match(menuHtml, /id="ucpSourceAi"/);
});

test('UCP runtime loader is valid Lua 5.1 syntax', () => {
  const source = fs.readFileSync(path.join(moduleRoot, 'init.lua'), 'utf8');
  assert.doesNotThrow(() => luaparse.parse(source, { luaVersion: '5.1' }));
  assert.doesNotMatch(source, /modules\.aiSwapper:SetAI/);
  assert.match(source, /modules\.aiSwapper\.SetAI\(targetIndex/);
});

test('UCP plugin-relative resource paths include their plugin root', () => {
  const { bridge } = loadCodecBundle();
  assert.equal(
    bridge.pathInsidePlugin(
      { path: 'ucp/plugins/example-ai-1.2.3' },
      'resources/ai/Jeanne/meta.json'
    ),
    'ucp/plugins/example-ai-1.2.3/resources/ai/Jeanne/meta.json'
  );
  assert.equal(
    bridge.versionFreePluginPath('ucp/plugins/example-ai-1.2.3/resources/ai/Jeanne/'),
    'ucp/plugins/example-ai/resources/ai/Jeanne/'
  );
  assert.equal(bridge.isUcpAssetUrl('https://asset.localhost/C%3A/game/ai.aiv'), true);
  assert.equal(bridge.isUcpAssetUrl('asset://localhost/C:/game/ai.aiv'), true);
  assert.equal(bridge.isUcpAssetUrl('http://127.0.0.1/example.aiv'), false);
});

test('bundled browser codec opens every legacy Hyaene binary AIV', () => {
  const { codec } = loadCodecBundle();
  const sourceDir = path.join(root, 'examples', 'Hyaene', 'aiv');
  const paths = fs.readdirSync(sourceDir).filter(name => name.endsWith('.aiv')).sort();
  assert.equal(paths.length, 8);
  for (const name of paths) {
    const encoded = fs.readFileSync(path.join(sourceDir, name)).toString('base64');
    const document = codec.parseAiv(codec.base64ToBytes(encoded));
    assert.ok(document.frames.length > 0, `${name} has no build frames`);
    assert.ok(document.frames.every(frame => frame.tilePositionOfsets.length > 0), `${name} still contains empty legacy steps`);
    assert.ok(Array.isArray(document.miscItems), `${name} has no rallypoint list`);
  }
});

test('browser codec output is accepted by the standalone converter', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(converter)) {
    t.skip('Bundled Windows converter is unavailable on this platform.');
    return;
  }
  const { codec, templates } = loadCodecBundle();
  const source = fs.readFileSync(path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aiv'));
  const parsed = codec.parseAiv(codec.base64ToBytes(source.toString('base64')));
  const encoded = codec.encodeAiv(parsed, templates);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-ucp-module-test-'));
  const aivPath = path.join(tempDir, 'module-output.aiv');
  try {
    fs.writeFileSync(aivPath, Buffer.from(codec.bytesToBase64(encoded), 'base64'));
    const { stdout } = await execFileAsync(converter, [aivPath, '-'], {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    const expected = JSON.parse(JSON.stringify(comparable(parsed)));
    assert.deepEqual(comparable(JSON.parse(stdout)), expected);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
