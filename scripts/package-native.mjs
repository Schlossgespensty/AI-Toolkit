import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { zipSync, unzipSync } from 'fflate';
import asar from '@electron/asar';
import { testInstallerHooks } from './test-installer.mjs';
import { packagePolicy, portablePath, validatePackagePolicy } from './package-policy.mjs';
export { portablePath } from './package-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release/native');
const budget = packagePolicy.downloadBudget;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : [];
  }).sort();
}
const relative = (base, file) => path.relative(base, file).split(path.sep).join('/');

/** Follow the installed runtime graph, including nested locked dependency versions. */
export function javascriptPackages(names, from = root) {
  const packages = new Map();
  function visit(name, parent) {
    const resolver = createRequire(path.join(parent, 'package.json'));
    const manifest = resolver.resolve.paths(name)?.map(directory => path.join(directory, name, 'package.json')).find(file => fs.existsSync(file));
    if (!manifest) throw Error(`Missing installed runtime dependency: ${name}`);
    const directory = fs.realpathSync(path.dirname(manifest));
    if (packages.has(directory)) return;
    const pkg = readJson(manifest);
    packages.set(directory, { name: `JavaScript ${pkg.name} ${pkg.version}`, license: pkg.license, directory });
    for (const dependency of Object.keys(pkg.dependencies || {}).sort()) visit(dependency, directory);
  }
  for (const name of names) visit(name, from);
  return [...packages.values()];
}

/** Preserve every packaged image byte and record original dimensions for review. */
export function auditFrontend(directory = path.join(root, 'desktop-dist'), source = root) {
  const images = [];
  for (const file of files(directory)) {
    const name = relative(directory, file);
    if (/^assets\/aiv\/iso\/.*\.png$/.test(name) || /^assets\/aiv\/skins\/(?:[1-9]|1\d|2[01])\.png$/.test(name)) throw Error(`Game artwork packaged: ${name}`);
    if (/^src\/(node|desktop)\//.test(name) || /(?:\.map|\.pdb)$/.test(name)) throw Error(`Development file packaged: ${name}`);
    if (!/\.(png|svg|ico)$/.test(name)) continue;
    const original = fs.readFileSync(path.join(source, name)), packaged = fs.readFileSync(file);
    if (!original.equals(packaged)) throw Error(`Image bytes changed: ${name}`);
    const dimensions = name.endsWith('.png') ? { width: packaged.readUInt32BE(16), height: packaged.readUInt32BE(20) } : {};
    images.push({ file: name, bytes: packaged.length, sha256: sha256(packaged), ...dimensions });
  }
  return images;
}

/** Collect actual locked dependency license texts; combine identical texts once. */
function notices() {
  const cargo = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], {
    cwd: path.join(root, 'src-tauri'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }));
  const registry = new Map(cargo.packages.map(pkg => [pkg.id, pkg]));
  const graph = new Map(cargo.resolve.nodes.map(node => [node.id, node]));
  const used = new Set();
  function visit(id) {
    if (used.has(id)) return;
    used.add(id);
    for (const dependency of graph.get(id)?.deps || []) {
      // Build scripts/proc macros do not execute in the shipped editor, but include
      // their notices as well to preserve notices for generated source components.
      if (dependency.dep_kinds.some(kind => kind.kind !== 'dev')) visit(dependency.pkg);
    }
  }
  visit(cargo.resolve.root);
  const packages = [...used].map(id => registry.get(id)).filter(pkg => pkg.source).map(pkg => ({
    name: `Rust ${pkg.name} ${pkg.version}`, license: pkg.license || 'See supplied license',
    directory: path.dirname(pkg.manifest_path), file: pkg.license_file,
  }));
  // Pixi's distribution embeds its transitive runtime dependencies. node-pkware
  // also supplies the original codec implementation ported to the Rust backend.
  packages.push(...javascriptPackages(['@tauri-apps/api', 'i18next', 'pixi.js', 'node-pkware']));
  const supplemental = readJson(path.join(root, 'scripts/licenses/supplemental.json'));
  const sections = new Map(), missing = [];
  for (const pkg of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidates = fs.readdirSync(pkg.directory).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i.test(name)).map(name => path.join(pkg.directory, name));
    if (pkg.file) candidates.push(path.resolve(pkg.directory, pkg.file));
    const texts = [...new Set(candidates)].filter(file => fs.statSync(file).isFile()).map(file => fs.readFileSync(file, 'utf8').trim()).filter(Boolean);
    if (!texts.length) for (const entry of supplemental.filter(entry => entry.packages.includes(pkg.name))) {
      if (sha256(entry.text) !== entry.sha256) throw Error(`Supplemental license checksum mismatch: ${pkg.name}`);
      texts.push(`Source: ${entry.url}\n${entry.attribution ? entry.attribution + '\n' : ''}\n${entry.text.trim()}`);
    }
    if (!texts.length) missing.push(`${pkg.name}: ${pkg.license}`);
    for (const content of texts) {
      const key = sha256(content);
      if (!sections.has(key)) sections.set(key, { content, packages: [] });
      sections.get(key).packages.push(`${pkg.name} (${pkg.license})`);
    }
  }
  if (missing.length) throw Error(`Missing dependency license texts:\n${missing.join('\n')}`);
  const attribution = ['assets/themes/default/ATTRIBUTION.md', 'assets/themes/ucp/ATTRIBUTION.md'].map(file => fs.readFileSync(path.join(root, file), 'utf8').trim()).join('\n\n');
  const heading = `AI Toolkit — third-party notices\n================================\n\n${attribution}\n\nThe classic 2D editor building tiles are Monsterfish's permitted editor artwork.\nFirefly unit sprites and 2.5D game artwork are read from the user's installation.\n\nThe application icon and editor-owned vector previews remain part of AI Toolkit.\n\nDependency license texts below are collected from the locked build's published\npackages. Identical texts are included once, with every applicable package listed.\n`;
  const body = [...sections.values()].map(section => `${'='.repeat(72)}\n${section.packages.join('\n')}\n\n${section.content}`).join('\n\n');
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), heading + '\n' + body + '\n');
}

/** Carry actual resources through the already-shipped Electron file allowlist. */
async function legacyResources(entries) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-legacy-resources-'));
  const input = path.join(scratch, 'input'), archive = path.join(scratch, 'app.asar');
  const resources = Object.keys(packagePolicy.files).map(name => ({ path: name, sha256: sha256(entries[name]) }));
  const manifest = {
    schemaVersion: 1, runtime: 'tauri',
    executable: { path: packagePolicy.executable.path, sha256: sha256(entries[packagePolicy.executable.path]) },
    files: resources,
  };
  try {
    for (const resource of resources) {
      const target = path.join(input, resource.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entries[resource.path]);
    }
    fs.writeFileSync(path.join(input, 'migration.json'), JSON.stringify(manifest));
    await asar.createPackage(input, archive);
    assert.deepEqual(JSON.parse(asar.extractFile(archive, 'migration.json')), manifest);
    for (const { path: name } of resources) assert.deepEqual(asar.extractFile(archive, path.normalize(name)), entries[name]);
    return fs.readFileSync(archive);
  } finally {
    asar.uncache(archive);
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('toolkit-legacy-resources-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function archivePortable(executable, destination, source = root) {
  const entries = { [packagePolicy.executable.path]: fs.readFileSync(executable) };
  const { configuration } = packagePolicy;
  const configSource = path.join(source, configuration.source);
  for (const file of files(configSource)) entries[`${configuration.directory}/${relative(configSource, file)}`] = fs.readFileSync(file);
  for (const [target, file] of Object.entries(packagePolicy.files)) entries[target] = fs.readFileSync(path.join(source, file));
  entries[packagePolicy.legacyResourceArchive] = await legacyResources(entries);
  for (const name of Object.keys(entries)) if (!portablePath(name)) throw Error(`Unexpected portable entry: ${name}`);
  const archive = zipSync(Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, [bytes, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') }]])));
  // Verify the actual artifact, not just the staging directory.
  const unpacked = unzipSync(archive);
  if (Object.keys(unpacked).length !== Object.keys(entries).length) throw Error('Portable archive entry count differs');
  for (const [name, bytes] of Object.entries(entries)) if (!Buffer.from(unpacked[name]).equals(bytes)) throw Error(`Portable archive differs: ${name}`);
  fs.writeFileSync(destination, archive);
  return Object.keys(entries);
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows x64 packaging must run on Windows x64.');
  const args = new Set(process.argv.slice(2));
  validatePackagePolicy();
  run(process.execPath, [path.join(root, 'scripts/build-locales.js'), '--check', '--strict']);
  notices();
  if (args.has('--prepare')) return;
  fs.mkdirSync(output, { recursive: true });
  if (!args.has('--skip-build')) {
    run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--bundles', 'nsis', '--', '--locked']);
  }
  testInstallerHooks();
  const version = readJson(path.join(root, 'src-tauri/tauri.conf.json')).version;
  const name = `AI-Toolkit-${version}-windows-x64`;
  const executable = path.join(root, 'src-tauri/target/release/ai-toolkit.exe');
  const images = auditFrontend();
  const zip = path.join(output, name + '.zip');
  const entries = await archivePortable(executable, zip);
  const installers = files(path.join(root, 'src-tauri/target/release/bundle/nsis')).filter(file => file.endsWith('-setup.exe'));
  const sourceSetup = installers.find(file => path.basename(file).includes(`_${version}_`));
  if (!sourceSetup) throw Error('Expected an NSIS installer for the current version');
  const setup = path.join(output, name + '-setup.exe');
  fs.copyFileSync(sourceSetup, setup);
  const artifacts = [zip, setup].map(file => ({ file: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) }));
  const report = { version, budget, engine: 'Tauri/system WebView2', bundledWebViewRuntime: false, imagePolicy: 'original bytes; no resizing or lossy compression', artifacts, portableEntries: entries, images };
  fs.writeFileSync(path.join(output, 'package-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), artifacts.map(artifact => `${artifact.sha256}  ${artifact.file}`).join('\n') + '\n');
  console.log(JSON.stringify({ artifacts, originalImages: images.length, portableFiles: entries.length }, null, 2));
  const oversized = artifacts.filter(artifact => artifact.bytes >= budget);
  if (oversized.length) throw Error(`Download budget exceeded: ${oversized.map(artifact => `${artifact.file}: ${artifact.bytes} bytes`).join(', ')}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
