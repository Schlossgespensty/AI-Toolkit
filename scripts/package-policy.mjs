// One file policy for the portable ZIP, native updater and NSIS installer.
// Resources are replaceable application files; configuration is editable user
// data. The updater may refresh unchanged defaults, but the installer only adds
// missing defaults. Neither deletes unknown files in the configuration folder.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Reject policy mistakes before generating files or deciding the release gate. */
export function validateManifest(policy) {
  const record = (value, keys, label) => {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
    if (keys) assert.deepEqual(Object.keys(value).sort(), keys.sort(), `${label} has unexpected or missing fields`);
  };
  const relative = value => typeof value === 'string' && value.split('/').every(part =>
    /^[A-Za-z0-9_. -]+$/.test(part) && part !== '.' && part !== '..' && !/[. ]$/.test(part));
  const outside = (file, directory) => file !== directory && !file.startsWith(directory + '/') && !directory.startsWith(file + '/');
  record(policy, ['downloadBudget', 'legacyResourceArchive', 'executable', 'files', 'configuration', 'legacyUpdatePatterns'], 'Package policy');
  assert.equal(policy.legacyResourceArchive, 'resources/app.asar', 'Legacy updater requires resources/app.asar');
  assert.ok(Number.isSafeInteger(policy.downloadBudget) && policy.downloadBudget > 0, 'downloadBudget must be a positive safe integer');
  const { executable, configuration, files, legacyUpdatePatterns } = policy;
  record(executable, ['path', 'aliases'], 'executable');
  assert.ok(Array.isArray(executable.aliases) && executable.aliases.length > 0, 'executable.aliases must be nonempty');
  for (const name of [executable.path, ...executable.aliases]) {
    assert.ok(relative(name) && !name.includes('/') && /\.exe$/i.test(name), 'Executable names must be plain ASCII .exe filenames');
  }
  assert.ok(executable.aliases.includes(executable.path), 'executable.path must be included in aliases');
  assert.equal(new Set(executable.aliases.map(name => name.toLowerCase())).size, executable.aliases.length, 'Executable aliases must be unique ignoring case');
  record(configuration, ['directory', 'source', 'stemPattern', 'extension'], 'configuration');
  assert.ok(relative(configuration.directory) && relative(configuration.source), 'Configuration paths must be safe relative paths');
  // Keep the grammar flat and ASCII in both JS and Rust. NSIS installs JSON
  // defaults, and the updater compares them semantically as JSON.
  assert.equal(configuration.extension, '.json', 'Configuration defaults must be JSON');
  assert.match(configuration.stemPattern, /^\[[A-Za-z0-9_-]+\]\+$/, 'Configuration stems must use a nonempty ASCII filename character class');
  const stem = new RegExp(`^(?:${configuration.stemPattern})$`);
  for (let code = 0; code < 128; code++) {
    const character = String.fromCharCode(code);
    assert.ok(!stem.test(character) || /^[A-Za-z0-9_-]$/.test(character), 'Configuration stem ranges must not include separators or punctuation');
  }
  record(files, null, 'files');
  const destinations = new Set([...executable.aliases, policy.legacyResourceArchive].map(name => name.toLowerCase()));
  const sources = new Set();
  for (const [target, source] of Object.entries(files)) {
    assert.ok(relative(target) && relative(source), 'Resource paths must be safe relative paths');
    const normalized = target.toLowerCase();
    assert.ok(!destinations.has(normalized), `Duplicate resource destination: ${target}`);
    assert.ok(!sources.has(source.toLowerCase()), `Duplicate resource source: ${source}`);
    assert.ok(outside(normalized, configuration.directory.toLowerCase()) && outside(source.toLowerCase(), configuration.source.toLowerCase()), 'Editable configuration cannot be a replaceable resource');
    destinations.add(normalized);
    sources.add(source.toLowerCase());
  }
  assert.ok(Array.isArray(legacyUpdatePatterns) && legacyUpdatePatterns.length > 0, 'legacyUpdatePatterns must be nonempty');
  for (const pattern of legacyUpdatePatterns) {
    // This deliberately small common regex subset excludes Unicode classes,
    // lookarounds and backreferences whose JS/Rust behavior can differ.
    assert.match(pattern, /^(?:[A-Za-z0-9_/-]|\\\.|\[[A-Za-z0-9_.-]+\]|[()*+|])+$/, 'Legacy patterns must use the shared ASCII regex subset');
    assert.ok(!new RegExp(`^(?:${pattern})$`).test(''), 'Legacy patterns must not match an empty filename');
  }
  return policy;
}
export const packagePolicy = validateManifest(JSON.parse(fs.readFileSync(path.join(root, 'scripts/manifests/native-package.json'), 'utf8')));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { configuration, executable, files, legacyUpdatePatterns } = packagePolicy;
const resources = Object.fromEntries(Object.entries(files).map(([target, file]) => [`../${file}`, target]));
const configurationPath = new RegExp(`^${escape(configuration.directory)}/${configuration.stemPattern}${escape(configuration.extension)}$`);
const legacyPath = new RegExp(`^(?:${legacyUpdatePatterns.join('|')})$`);
const matches = (expression, name) => expression.exec(name)?.[0] === name;
export const isConfiguration = name => matches(configurationPath, name);
export const isExecutable = name => executable.aliases.some(alias => alias.toLowerCase() === name.toLowerCase());
export const portablePath = name => name === executable.path || name === packagePolicy.legacyResourceArchive || Object.hasOwn(files, name) || isConfiguration(name);
export const updatePath = name => isExecutable(name) || portablePath(name) || matches(legacyPath, name);

/** Checked in for Tauri/NSIS; generate from the policy instead of hand editing. */
export function installerHook() {
  return `; Generated by node scripts/package-policy.mjs --write. Do not hand edit.
; Editable configuration is user data: add missing defaults, never replace or delete.
!ifndef TOOLKIT_DEFAULT_CONFIG_DIR
  !define TOOLKIT_DEFAULT_CONFIG_DIR "\${__FILEDIR__}\\..\\..\\${configuration.source.replaceAll('/', '\\')}"
!endif

!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR\\${configuration.directory.replaceAll('/', '\\')}"
  SetOverwrite off
  File "\${TOOLKIT_DEFAULT_CONFIG_DIR}\\*${configuration.extension}"
  SetOverwrite lastused
  SetOutPath "$INSTDIR"
!macroend
`;
}

/** Fail packaging if a platform's resource list or generated hook has drifted. */
export function validatePackagePolicy(source = root) {
  const bundle = JSON.parse(fs.readFileSync(path.join(source, 'src-tauri/tauri.conf.json'), 'utf8')).bundle;
  assert.equal(bundle.windows.nsis.installerHooks, '../scripts/installer/config.nsh');
  assert.deepEqual(bundle.resources, resources, 'Native bundle resources differ from scripts/manifests/native-package.json');
  const hook = fs.readFileSync(path.join(source, 'scripts/installer/config.nsh'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(hook, installerHook(), 'Regenerate the NSIS hook with node scripts/package-policy.mjs --write');
  for (const entry of fs.readdirSync(path.join(source, configuration.source), { withFileTypes: true })) {
    assert.ok(entry.isFile() && isConfiguration(`${configuration.directory}/${entry.name}`), `Unexpected packaged configuration: ${entry.name}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(path.join(root, 'scripts/installer/config.nsh'), installerHook());
    const file = path.join(root, 'src-tauri/tauri.conf.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.bundle.resources = resources;
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
  validatePackagePolicy();
}
