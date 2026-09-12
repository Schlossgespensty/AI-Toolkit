'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const FORMAT = 'ai-toolkit-native-map-v1';
const MODULE = 'ai-toolkit-native-map-renderer-0.1.0';
const MODULE_SOURCE = path.join(__dirname, '../../integrations/native-map-renderer');
const ENGINES = new Set([
  '3bb0a8c1e72331b3a30a5aa93ed94beca0081b476b04c1960e26d5b45387ac5a',
  '0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34'
]);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
let pending = Promise.resolve();

function isolatedExecutable(bytes) {
  const engineHash = sha(bytes);
  if (!ENGINES.has(engineHash)) throw new Error('Native rendering currently supports Crusader 1.41 and its known 4GB-patched build.');
  const original = Buffer.from('Global\\FireflyStrongholdCrusadersExtreme');
  const offset = bytes.indexOf(original);
  if (offset < 0 || bytes.indexOf(original, offset + 1) >= 0) throw new Error('Cannot isolate the game renderer instance.');
  const result = Buffer.from(bytes);
  result.fill(0, offset, offset + original.length);
  result.write('Global\\AIToolkitNativeMapRenderer', offset, 'ascii');
  return { bytes: result, engineHash };
}

function ownedDirectory(root) {
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Native renderer directory must not be a link.');
  const marker = path.join(root, 'toolkit-renderer-owner.json');
  if (!fs.existsSync(marker)) {
    if (fs.readdirSync(root).length) throw new Error('Native renderer directory contains unrelated files.');
    fs.writeFileSync(marker, JSON.stringify({ format: FORMAT }), { flag: 'wx' });
  }
  if (JSON.parse(fs.readFileSync(marker, 'utf8')).format !== FORMAT) throw new Error('Unrecognized renderer directory.');
}

function writeOwned(root, relative, bytes) {
  const destination = path.join(root, relative);
  // Owned output files must never redirect writes into a game installation.
  let parent = destination;
  while (parent !== root) {
    if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Unexpected link in renderer output path.');
    parent = path.dirname(parent);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bytes)) fs.writeFileSync(destination, bytes);
}

function assetLink(root, name, source) {
  const destination = path.join(root, name);
  // Link straight to the assets, not through another junction. Windows game
  // installations often already redirect their shared asset directories.
  const target = fs.realpathSync(source);
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isSymbolicLink()) throw new Error(`Renderer ${name} must be an asset link.`);
    if (fs.existsSync(destination) && fs.realpathSync(destination).toLowerCase() === target.toLowerCase()) return;
    fs.unlinkSync(destination); // the junction itself, never its target
  }
  fs.symlinkSync(target, destination, 'junction');
}

function lockDirectory(root) {
  const name = path.join(root, 'renderer.lock');
  try { fs.writeFileSync(name, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(fs.readFileSync(name, 'utf8'));
    if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('Invalid native renderer lock.');
    try { process.kill(previous.pid, 0); }
    catch (probe) {
      if (probe.code === 'ESRCH') { fs.unlinkSync(name); return lockDirectory(root); }
      throw probe;
    }
    throw new Error('Another Toolkit process is rendering a map. Retry after it finishes.');
  }
  return () => fs.unlinkSync(name);
}

function prepare(root, gameRoot) {
  const game = isolatedExecutable(fs.readFileSync(path.join(gameRoot, 'Stronghold Crusader.exe')));
  const sources = [];
  for (const name of fs.readdirSync(gameRoot).filter(name => /\.dll$/i.test(name))) sources.push([name, path.join(gameRoot, name)]);
  for (const name of ['cr.tex', 'faces.bmp', 'extremeTrail.csv']) sources.push([name, path.join(gameRoot, name)]);
  for (const name of ['code.zip', 'ucp-version.yml']) sources.push([`ucp/${name}`, path.join(gameRoot, 'ucp', name)]);
  for (const name of ['winProcHandler-1.0.0.zip', 'graphicsApiReplacer-1.3.0.zip'])
    sources.push([`ucp/modules/${name}`, path.join(gameRoot, 'ucp/modules', name)]);
  for (const name of ['definition.yml', 'init.lua']) sources.push([`ucp/modules/${MODULE}/${name}`, path.join(MODULE_SOURCE, name)]);
  const hashes = [game.engineHash];
  // Check every input before updating the owned helper installation.
  const loaded = sources.map(([target, source]) => {
    if (!fs.existsSync(source)) throw new Error(`Native renderer needs ${path.basename(source)} in the selected UCP game installation.`);
    const bytes = fs.readFileSync(source); hashes.push(target + ':' + sha(bytes)); return [target, bytes];
  });
  for (const name of fs.readdirSync(path.join(gameRoot, 'gm')).sort()) {
    const stat = fs.statSync(path.join(gameRoot, 'gm', name));
    if (stat.isFile()) hashes.push(`gm/${name}:${stat.size}:${stat.mtimeMs}`);
  }
  writeOwned(root, 'Stronghold Crusader.exe', game.bytes);
  for (const [name, bytes] of loaded) writeOwned(root, name, bytes);
  for (const name of ['gm', 'gfx', 'fx', 'binks', 'aiv']) assetLink(root, name, path.join(gameRoot, name));
  for (const name of ['maps', 'userdata', 'ucp/plugins']) fs.mkdirSync(path.join(root, name), { recursive: true });
  writeOwned(root, 'configpath.txt', Buffer.from(path.join(root, 'userdata') + '\r\n'));
  writeOwned(root, 'ucp-config.yml', Buffer.from(`meta:\n  version: 1.0.0\nactive: true\nconfig-full: &config\n  modules:\n    winProcHandler:\n      config: {}\n    graphicsApiReplacer:\n      config:\n        window:\n          type:\n            contents:\n              value: window\n          width:\n            contents:\n              value: 800\n          height:\n            contents:\n              value: 600\n    ai-toolkit-native-map-renderer:\n      config: {}\n  plugins: {}\n  load-order:\n    - extension: winProcHandler\n      version: 1.0.0\n    - extension: graphicsApiReplacer\n      version: 1.3.0\n    - extension: ai-toolkit-native-map-renderer\n      version: 0.1.0\nconfig-sparse: *config\n`));
  return { engineHash: game.engineHash, sourceHash: sha(hashes.join('\n')) };
}

function readResult(root, request) {
  const result = JSON.parse(fs.readFileSync(path.join(root, 'renderer-result.json'), 'utf8'));
  if (result.format !== FORMAT || result.id !== request.id) throw new Error('Native renderer returned a stale result.');
  if (result.error) throw new Error(result.error);
  if (!result.complete || result.mapHash !== request.mapHash || result.engineHash !== request.engineHash)
    throw new Error('Native renderer output does not match this map and executable.');
  const read = (name, length) => {
    const file = path.join(root, name);
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size !== length) throw new Error(`Invalid native renderer layer: ${name}`);
    return fs.readFileSync(file);
  };
  return { mapHash: request.mapHash, heights: read('height.bin', 80400), baseHeights: read('base-height.bin', 80400), cameras: [0, 2, 4, 6].map(orientation => ({
    orientation, gfx: read(`camera-${orientation}-gfx.bin`, 160800), pillars: read(`camera-${orientation}-pillar.bin`, 160800)
  })) };
}

function launch(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'Stronghold Crusader.exe'), ['--ucp-no-security', '--ucp-no-console'],
      { cwd: root, windowsHide: true, stdio: 'ignore' });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout);
      if (timedOut) reject(new Error('The native game renderer did not finish within 45 seconds.'));
      else code === 0 ? resolve() : reject(new Error(`The native game renderer exited with code ${code}.`));
    });
  });
}

async function render({ gameRoot, mapPath, cacheRoot }) {
  if (process.platform !== 'win32') throw new Error('Native game rendering requires Windows.');
  const root = path.resolve(cacheRoot);
  ownedDirectory(root);
  const unlock = lockDirectory(root);
  try {
    const source = prepare(root, path.resolve(gameRoot));
    const bytes = fs.readFileSync(mapPath);
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Map is too large for the native renderer.');
    const mapHash = sha(bytes), cached = path.join(root, 'completed-request.json');
    try {
      const request = JSON.parse(fs.readFileSync(cached, 'utf8'));
      if (request.sourceHash === source.sourceHash && request.mapHash === mapHash) return readResult(root, request);
    } catch { /* A missing or partial cache must be regenerated. */ }
    const request = { format: FORMAT, id: crypto.randomUUID(), mapName: 'maps/preview.map', mapHash, ...source };
    writeOwned(root, request.mapName, bytes);
    writeOwned(root, 'renderer-request.json', Buffer.from(JSON.stringify(request)));
    await launch(root);
    const result = readResult(root, request);
    writeOwned(root, 'completed-request.json', Buffer.from(JSON.stringify(request)));
    return result;
  } finally { unlock(); }
}

function renderNativeMap(options) {
  const result = pending.then(() => render(options));
  pending = result.catch(() => {});
  return result;
}
module.exports = { renderNativeMap, internals: { FORMAT, sha, isolatedExecutable, ownedDirectory, readResult } };
