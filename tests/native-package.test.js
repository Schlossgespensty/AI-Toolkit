const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { unzipSync } = require('fflate');

const packaging = import('../scripts/package-native.mjs');
const policy = import('../scripts/package-policy.mjs');
test('native window icons resolve on Windows and Unix with unchanged artwork', () => {
  const config = require('../src-tauri/tauri.conf.json');
  const iconBytes = extension => {
    const relative = config.bundle.icon.find(file => file.endsWith(extension));
    assert.ok(relative, `Missing ${extension} native icon`);
    return fs.readFileSync(path.resolve(__dirname, '../src-tauri', relative));
  };
  const ico = iconBytes('.ico'), png = iconBytes('.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png[25], 6, 'Tauri requires RGBA PNG icons');
  const existingPngs = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + i * 16, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    return ico.subarray(offset, offset + length);
  });
  assert.ok(existingPngs.some(entry => entry.equals(png)), 'Unix icon must reuse existing native icon artwork');
  for (const role of ['installerIcon', 'uninstallerIcon']) {
    assert.deepEqual(fs.readFileSync(path.resolve(__dirname, '../src-tauri', config.bundle.windows.nsis[role])), ico);
  }
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-package-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('toolkit-package-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, write(name, data) {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data); return file;
  } };
}

test('ZIP, updater and installer share the declared package contract', async () => {
  const { portablePath, updatePath, isConfiguration, validatePackagePolicy } = await policy;
  for (const { path: name, portable, update, configuration } of require('./fixtures/package-paths.json')) {
    assert.equal(portablePath(name), portable, `portable: ${JSON.stringify(name)}`);
    assert.equal(updatePath(name), update, `updater: ${JSON.stringify(name)}`);
    assert.equal(isConfiguration(name), configuration, `configuration: ${JSON.stringify(name)}`);
  }
  validatePackagePolicy();
});

test('malformed package policies fail before generating or accepting artifacts', async () => {
  const { validateManifest, packagePolicy } = await policy;
  const rejects = (mutate, message) => {
    const value = structuredClone(packagePolicy);
    mutate(value);
    assert.throws(() => validateManifest(value), message);
  };
  for (const budget of [undefined, null, 0, -1, 1.5, '8000000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(p => { p.downloadBudget = budget; }, /positive safe integer/);
  }
  rejects(p => { delete p.downloadBudget; }, /missing fields/);
  rejects(p => { p.executable.path = 'Other.exe'; }, /included in aliases/);
  rejects(p => { p.executable.aliases = []; }, /nonempty/);
  rejects(p => { p.executable.aliases.push('ai toolkit.EXE'); }, /unique ignoring case/);
  rejects(p => { p.executable.aliases.push('../Other.exe'); }, /plain ASCII/);
  rejects(p => { p.executable.aliases.push('Töölkit.exe'); }, /plain ASCII/);
  rejects(p => { p.configuration.directory = '../config'; }, /safe relative/);
  rejects(p => { p.configuration.source = '$INSTDIR'; }, /safe relative/);
  rejects(p => { p.configuration.extension = '.dll'; }, /must be JSON/);
  rejects(p => { p.configuration.stemPattern = '\\w+'; }, /ASCII filename/);
  rejects(p => { p.configuration.stemPattern = '[z-a]+'; }, /regular expression/);
  rejects(p => { p.configuration.stemPattern = '[--z]+'; }, /must not include separators/);
  rejects(p => { p.files['config/default.json'] = 'defaults.json'; }, /Editable configuration/);
  rejects(p => { p.files['defaults.json'] = 'config/default.json'; }, /Editable configuration/);
  rejects(p => { p.files['readme.TXT'] = 'another.txt'; }, /Duplicate resource destination/);
  rejects(p => { p.files['extra.txt'] = p.files['README.txt']; }, /Duplicate resource source/);
  rejects(p => { p.files['AI Toolkit.exe'] = 'another.exe'; }, /Duplicate resource destination/);
  rejects(p => { p.files['resources/app.asar'] = 'another.asar'; }, /Duplicate resource destination/);
  rejects(p => { p.legacyResourceArchive = 'other.asar'; }, /Legacy updater/);
  rejects(p => { p.files['../outside.txt'] = 'another.txt'; }, /safe relative/);
  rejects(p => { p.legacyUpdatePatterns = ['(?=README)README']; }, /shared ASCII regex subset/);
  rejects(p => { p.legacyUpdatePatterns = ['[A-Z]*']; }, /empty filename/);
  rejects(p => { p.legacyUpdatePatterns = ['(broken']; }, /regular expression/);
  assert.equal(validateManifest(structuredClone(packagePolicy)).downloadBudget, 8_000_000);
});

test('packaging rejects generic config replacement and stale installer hooks', async t => {
  const { installerHook, validatePackagePolicy } = await policy, f = fixture(t);
  const config = structuredClone(require('../src-tauri/tauri.conf.json'));
  f.write('config/aiv_constants.json', '{}');
  f.write('scripts/installer/config.nsh', installerHook());
  config.bundle.resources['../config/'] = 'config/';
  f.write('src-tauri/tauri.conf.json', JSON.stringify(config));
  assert.throws(() => validatePackagePolicy(f.directory), /bundle resources differ/);
  delete config.bundle.resources['../config/'];
  f.write('src-tauri/tauri.conf.json', JSON.stringify(config));
  f.write('scripts/installer/config.nsh', installerHook().replace('SetOverwrite off', 'SetOverwrite on'));
  assert.throws(() => validatePackagePolicy(f.directory), /Regenerate the NSIS hook/);
  f.write('scripts/installer/config.nsh', installerHook());
  f.write('config/nested/unsupported.json', '{}');
  assert.throws(() => validatePackagePolicy(f.directory), /Unexpected packaged configuration/);
});

test('portable artifact retains every config and exact original file bytes', async t => {
  const { archivePortable, portablePath } = await packaging, f = fixture(t);
  const expected = {
    'config/aiv.json': '{"extraCategory":111}',
    'config/user-values.json': '{"myCustomDefault":12}',
    'assets/aiv/iso/verzeichnis.json': '{"61":{"frames":2}}',
    'THIRD_PARTY_NOTICES.txt': 'Complete license notice',
  };
  for (const [name, text] of Object.entries(expected)) f.write(name, text);
  const executable = f.write('native.exe', Buffer.from([77, 90, 0, 255, 1, 2]));
  f.write('docs/native-preview-readme.txt', 'Native setup instructions');
  const destination = path.join(f.directory, 'preview.zip');
  const names = await archivePortable(executable, destination, f.directory);
  const actual = unzipSync(fs.readFileSync(destination));
  assert.ok(names.every(portablePath));
  for (const [name, text] of Object.entries(expected)) assert.equal(Buffer.from(actual[name]).toString(), text);
  assert.deepEqual(Buffer.from(actual['AI Toolkit.exe']), fs.readFileSync(executable));
  assert.equal(Buffer.from(actual['README.txt']).toString(), 'Native setup instructions');
  const capsule = f.write('capsule.asar', Buffer.from(actual['resources/app.asar']));
  const asar = require('@electron/asar');
  const manifest = JSON.parse(asar.extractFile(capsule, 'migration.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.runtime, 'tauri');
  const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(manifest.executable, { path: 'AI Toolkit.exe', sha256: hash(actual['AI Toolkit.exe']) });
  const resourceNames = Object.keys((await policy).packagePolicy.files);
  assert.deepEqual(manifest.files.map(file => file.path).sort(), resourceNames.sort());
  for (const file of manifest.files) {
    const bytes = asar.extractFile(capsule, path.normalize(file.path));
    assert.deepEqual(bytes, Buffer.from(actual[file.path]));
    assert.equal(hash(bytes), file.sha256);
  }
  assert.throws(() => asar.extractFile(capsule, 'config/aiv.json'), /not found/);
  for (const unsafe of ['../AI Toolkit.exe', 'node_modules/pixi.js/index.js', 'cache/map.png', 'config/../../outside.json']) assert.equal(portablePath(unsafe), false);
});

test('artwork audit rejects changed originals and bundled game sprites', async t => {
  const { auditFrontend } = await packaging, f = fixture(t);
  const png = Buffer.alloc(24); png.write('\x89PNG', 0, 'binary'); png.writeUInt32BE(96, 16); png.writeUInt32BE(64, 20);
  f.write('source/assets/themes/test/textures/control.png', png);
  const packaged = f.write('dist/assets/themes/test/textures/control.png', png);
  const result = auditFrontend(path.join(f.directory, 'dist'), path.join(f.directory, 'source'));
  assert.deepEqual([result[0].width, result[0].height], [96, 64]);
  const changed = Buffer.from(png); changed[12] = 1; fs.writeFileSync(packaged, changed);
  assert.throws(() => auditFrontend(path.join(f.directory, 'dist'), path.join(f.directory, 'source')), /Image bytes changed/);
  fs.writeFileSync(packaged, png);
  f.write('dist/assets/aiv/iso/tower.png', png);
  assert.throws(() => auditFrontend(path.join(f.directory, 'dist'), path.join(f.directory, 'source')), /Game artwork packaged/);
});

test('license inventory follows nested runtime dependencies but excludes development tools', async t => {
  const { javascriptPackages } = await packaging, f = fixture(t);
  const manifest = (name, data) => f.write(name + '/package.json', JSON.stringify(data));
  manifest('node_modules/renderer', { name: 'renderer', version: '1', license: 'MIT', dependencies: { color: '1', nested: '1' }, devDependencies: { unused: '1' } });
  manifest('node_modules/color', { name: 'color', version: '1', license: 'MIT' });
  manifest('node_modules/nested', { name: 'nested', version: '1', license: 'MIT', dependencies: { color: '2' } });
  manifest('node_modules/nested/node_modules/color', { name: 'color', version: '2', license: 'MIT' });
  assert.deepEqual(javascriptPackages(['renderer'], f.directory).map(p => p.name).sort(), [
    'JavaScript color 1', 'JavaScript color 2', 'JavaScript nested 1', 'JavaScript renderer 1',
  ]);
});
