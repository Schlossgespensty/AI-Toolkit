// Opt-in acceptance test. All writes, launched editors and synthetic projects
// live in one new fixture directory. The original installed app is read-only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import asar from '@electron/asar';
import {unzipSync} from 'fflate';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function write(file, bytes) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes); }
function within(root, file) { return path.resolve(file).startsWith(path.resolve(root) + path.sep); }

function argumentsFor(argv) {
  const options = {repo: 'Krarilotus/AI-Toolkit', tag: 'snapshot-migration-fixture', electronPort: 9256, nativePort: 9257};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (['--run', '--stage-only', '--published'].includes(key)) options[key.slice(2)] = true;
    else if (['--archive', '--original-root', '--output', '--repo', '--tag', '--electron-port', '--native-port'].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing value for ${key}`);
      options[key.slice(2)] = argv[++i];
    } else throw Error(`Unknown argument: ${key}`);
  }
  for (const name of ['electron', 'native']) if (options[`${name}-port`]) options[`${name}Port`] = Number(options[`${name}-port`]);
  if (!options.run || !options.archive || !options['original-root']) throw Error('Usage: node scripts/test-legacy-native-migration.mjs --archive ZIP --original-root ELECTRON_INSTALL --run [--stage-only] [--published --repo OWNER/REPO --tag EXACT_TAG] [--output PARENT]');
  assert.notEqual(options.electronPort, options.nativePort);
  return options;
}

async function portFree(port) {
  assert.ok(Number.isInteger(port) && port >= 1024 && port < 65536);
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  await new Promise(resolve => server.close(resolve));
}
async function until(check, timeout = 90000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await delay(250);
  }
  throw last || Error('Timed out waiting for isolated migration');
}
async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes('src/index.html'));
  if (!target) throw Error('Isolated editor page is not ready');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  let next = 0; const pending = new Map();
  socket.onmessage = ({data}) => {
    const response = JSON.parse(data), waiter = pending.get(response.id); if (!waiter) return;
    pending.delete(response.id); clearTimeout(waiter.timer);
    response.error ? waiter.reject(Error(JSON.stringify(response.error))) : waiter.resolve(response.result);
  };
  socket.onclose = () => { for (const waiter of pending.values()) {clearTimeout(waiter.timer); waiter.reject(Error('Isolated editor closed'));} pending.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => {pending.delete(id); reject(Error(`CDP timeout: ${method}`));}, 60000);
    pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
  });
  return {target, close: () => socket.close(), send, evaluate: async expression => {
    const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }};
}

async function makeProject(directory) {
  const gameRoot = path.join(directory, 'synthetic-game');
  const pluginRoot = path.join(gameRoot, 'ucp/plugins/migration-fixture-1.0.0');
  const aiRoot = path.join(pluginRoot, 'resources/ai/migration-fixture');
  write(path.join(pluginRoot, 'definition.yml'), 'name: migration-fixture\nversion: 1.0.0\ntype: plugin\n');
  write(path.join(gameRoot, 'ucp-config.yml'), 'meta:\n  version: 1.0.0\nconfig-full:\n  load-order:\n    - extension: migration-fixture\n      version: 1.0.0\n');
  write(path.join(aiRoot, 'meta.json'), JSON.stringify({name: 'Migration Fixture', author: 'Acceptance test', version: '1.0.0', defaultLang: 'en', supportedLang: ['en'], switched: {aic: true, aiv: true}}));
  write(path.join(aiRoot, 'character.json'), JSON.stringify({aic: {WallDecoration: 1}}));
  write(path.join(aiRoot, 'lines.json'), JSON.stringify({ai_name: 'Migration Fixture', taunt_1: 'Synthetic project survives'}));
  write(path.join(aiRoot, 'aiv/mapping.json'), JSON.stringify({castle_1: 'earlier.aiv', castle_2: 'fixture.aiv'}));
  const {encodeAiv} = await import('../src/node/aiv-codec.mjs');
  const document = {pauseDelayAmount: 100, frames: [{itemType: 61, tilePositionOfsets: [4950], shouldPause: false}], miscItems: [{positionOfset: 5050, itemType: 0, number: 0}]};
  const templates = json(path.join(source, 'config/aiv_templates.json'));
  write(path.join(aiRoot, 'aiv/fixture.aiv'), encodeAiv(document, templates));
  write(path.join(aiRoot, 'aiv/earlier.aiv'), encodeAiv({...document, frames: [...document.frames, {itemType: 25, tilePositionOfsets: [4949], shouldPause: false}]}, templates));
  return {gameRoot, aiRoot, castleFile: 'fixture.aiv', workspace: 'castle'};
}

const options = argumentsFor(process.argv.slice(2));
assert.equal(process.platform, 'win32', 'Original helper is Windows only');
// The shipped helper launches Windows PowerShell 5.1, even from a pwsh runner.
process.env.PSModulePath = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
const originalRoot = fs.realpathSync(options['original-root']);
const originalArchive = path.join(originalRoot, 'resources/app.asar');
const originalArchiveHash = sha(fs.readFileSync(originalArchive));
const originalExecutableHash = sha(fs.readFileSync(path.join(originalRoot, 'AI Toolkit.exe')));
const archive = fs.realpathSync(options.archive), archiveBytes = fs.readFileSync(archive), targetFiles = unzipSync(archiveBytes);
assert.ok(targetFiles['AI Toolkit.exe'] && targetFiles['resources/app.asar'], 'Universal package must have native EXE and resource ASAR');
const parent = path.resolve(options.output || path.join(source, '../migration-qa'));
assert.ok(!within(originalRoot, parent) && parent !== originalRoot, 'Fixture parent must be outside original install');
fs.mkdirSync(parent, {recursive: true});
const directory = fs.mkdtempSync(path.join(parent, 'legacy-native-'));
const live = path.join(directory, 'portable'), profile = path.join(directory, 'profile'), helpers = path.join(directory, 'original-helpers');
fs.mkdirSync(live); fs.mkdirSync(profile);
const report = {startedAt: new Date().toISOString(), directory, originalRoot, originalArchiveHash, originalExecutableHash, archive, archiveSha256: sha(archiveBytes), fixtureNetwork: !options.published, stageOnly: Boolean(options['stage-only']), originalHelperHashes: {}};
const save = () => write(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
let server, client, child;
try {
  if (!options['stage-only']) await Promise.all([portFree(options.electronPort), portFree(options.nativePort)]);
  for (const name of ['release-updates.js', 'release-download.js', 'release-install.ps1']) {
    const bytes = asar.extractFile(originalArchive, path.normalize(`src/node/${name}`));
    report.originalHelperHashes[name] = sha(bytes); write(path.join(helpers, name), bytes);
  }
  // Copy runtime files only. Never bring over the user's external config or projects.
  for (const entry of fs.readdirSync(originalRoot, {withFileTypes: true})) if (entry.isFile() && /^(AI Toolkit\.exe|[\w.-]+\.(?:dll|pak|bin|dat)|vk_swiftshader_icd\.json|LICENSE[\w.-]*\.(?:txt|html))$/.test(entry.name)) fs.copyFileSync(path.join(originalRoot, entry.name), path.join(live, entry.name));
  for (const name of ['resources', 'locales']) fs.cpSync(path.join(originalRoot, name), path.join(live, name), {recursive: true});
  const baseline = {};
  for (const name of asar.listPackage(originalArchive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')).filter(name => /^config\/[\w-]+\.json$/.test(name))) {
    const bytes = asar.extractFile(originalArchive, path.normalize(name)); baseline[name] = sha(bytes); write(path.join(live, name), bytes);
  }
  const custom = path.join(live, 'config/displayNames.json');
  write(custom, JSON.stringify({...json(custom), migrationAcceptance: {label: 'Benutzerdefiniert — 中文 für Ritter', unknownExtension: {preserve: true}}}));
  report.customConfigurationSha256 = sha(fs.readFileSync(custom));
  write(path.join(live, 'user-project.json'), '{"migrationAcceptance":"user project survives"}');
  const project = await makeProject(directory);
  report.project = project;
  const settings = {migrationAcceptance: 'settings survive', ucpInstallation: project.gameRoot, mainWindow: {bounds: {x: 50, y: 50, width: 1100, height: 800}, maximized: false}};
  write(path.join(profile, 'settings.json'), JSON.stringify(settings));
  write(path.join(profile, 'update-source.json'), JSON.stringify({repo: options.repo}));
  report.projectSha256 = sha(fs.readFileSync(path.join(project.aiRoot, 'aiv', project.castleFile)));
  const checker = require(path.join(helpers, 'release-updates.js'));
  let release;
  if (options.published) {
    const response = await fetch(`https://api.github.com/repos/${options.repo}/releases/tags/${encodeURIComponent(options.tag)}`, {headers: {'User-Agent': 'AI-Toolkit-migration-acceptance', Accept: 'application/vnd.github+json'}});
    assert.equal(response.ok, true, `Release metadata HTTP ${response.status}`); release = await response.json();
    const asset = checker.releaseAsset(release, options.repo); assert.ok(asset); assert.equal(asset.sha256, sha(archiveBytes)); assert.equal(asset.size, archiveBytes.length);
  } else release = {id: 810001, tag_name: options.tag, published_at: '2026-09-22T23:00:00Z', prerelease: true, draft: false, assets: [{id: 810002, name: 'AI-Toolkit-migration-windows-x64.zip', size: archiveBytes.length, digest: `sha256:${sha(archiveBytes)}`}]};
  const asset = checker.releaseAsset(release, options.repo);
  const key = `${options.repo.toLowerCase()}:${release.id}:${asset.id}:${asset.sha256}`;
  report.release = {repo: options.repo, tag: release.tag_name, key, asset};
  server = http.createServer((request, response) => {
    if (request.url !== '/artifact.zip') {response.writeHead(404); response.end(); return;}
    response.writeHead(200, {'content-type': 'application/zip', 'content-length': archiveBytes.length}); response.end(archiveBytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${server.address().port}/artifact.zip`;
  if (options['stage-only']) {
    const cache = path.join(profile, 'release-updates'); fs.mkdirSync(cache);
    // Execute unchanged shipped download/hash/Prepare logic against a real local
    // HTTP response. This mode performs no app launch or external network request.
    const prepared = await require(path.join(helpers, 'release-download.js')).prepareRelease({repo: options.repo, latest: release.tag_name, key, asset: {...asset, url: localUrl}}, {root: live, cache, baseline});
    report.stage = prepared.stage;
    const env = {...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')}; delete env.ELECTRON_RUN_AS_NODE;
    report.installerOutput = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', prepared.script, '-Mode', 'Install', '-Stage', prepared.stage, '-InstallRoot', live, '-NoRestart'], {encoding: 'utf8', windowsHide: true, timeout: 120000, env});
    assert.equal(sha(fs.readFileSync(path.join(live, 'AI Toolkit.exe'))), sha(targetFiles['AI Toolkit.exe']));
    assert.equal(sha(fs.readFileSync(custom)), report.customConfigurationSha256);
    assert.equal(json(path.join(live, 'user-project.json')).migrationAcceptance, 'user project survives');
    assert.equal(json(path.join(live, '.toolkit-release.json')).key, key);
    report.nativeStartupVerified = false;
  } else {
    const unpacked = path.join(directory, 'original-application'); asar.extractAll(originalArchive, unpacked);
    const pkg = json(path.join(unpacked, 'package.json')); const originalMain = pkg.main; pkg.main = 'migration-qa-bootstrap.cjs';
    write(path.join(unpacked, 'package.json'), JSON.stringify(pkg));
    const fixture = {profile, directory, originalMain, repo: options.repo, release, localUrl, published: Boolean(options.published), electronPort: options.electronPort};
    // Test plumbing changes only the clone entry point and network fixtures.
    // All three shipped updater files and original main.js remain byte-identical.
    const bootstrap = `const fixture=${JSON.stringify(fixture)};\nconst fs=require('node:fs'), path=require('node:path'), electron=require('electron');\nelectron.app.setPath('userData',fixture.profile);\nelectron.app.commandLine.appendSwitch('remote-debugging-port',String(fixture.electronPort));\nconst originalFetch=global.fetch;\nif(!fixture.published)global.fetch=async(url,options)=>{const u=String(url);const api='https://api.github.com/repos/';const official='Schlossgespensty/AI-Toolkit';const reply=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}}));if(u.startsWith(api)){const endpoint=u.slice(api.length);if(endpoint===fixture.repo)return reply({fork:true,full_name:fixture.repo,source:{full_name:official}});if(endpoint.startsWith(official+'/forks?'))return reply([{full_name:fixture.repo}]);if(endpoint.startsWith(official+'/releases?'))return reply([{id:1,tag_name:'official-fixture',draft:false,prerelease:false,published_at:'2026-01-01T00:00:00Z',assets:[]}]);if(endpoint.startsWith(fixture.repo+'/releases?'))return reply([fixture.release]);throw Error('Unexpected fixture API request '+u)}if(u.startsWith('https://github.com/'+fixture.repo+'/releases/download/'))return originalFetch(fixture.localUrl,options);return originalFetch(url,options)};\nelectron.app.whenReady().then(()=>fs.writeFileSync(path.join(fixture.directory,'original-running.json'),JSON.stringify({pid:process.pid,userData:electron.app.getPath('userData'),exe:electron.app.getPath('exe')})));\nrequire('./'+fixture.originalMain);\n`;
    write(path.join(unpacked, 'migration-qa-bootstrap.cjs'), bootstrap);
    await asar.createPackage(unpacked, path.join(live, 'resources/app.asar'));
    for (const name of Object.keys(report.originalHelperHashes)) assert.equal(sha(asar.extractFile(path.join(live, 'resources/app.asar'), path.normalize(`src/node/${name}`))), report.originalHelperHashes[name]);
    const receipt = fs.existsSync(path.join(originalRoot, '.toolkit-release.json')) ? json(path.join(originalRoot, '.toolkit-release.json')) : {repo: options.repo, tag: 'original-fixture', key: 'original-fixture'};
    receipt.asarSha256 = sha(fs.readFileSync(path.join(live, 'resources/app.asar'))); write(path.join(live, '.toolkit-release.json'), JSON.stringify(receipt));
    report.originalFixtureArchiveHash = receipt.asarSha256;
    const env = {...process.env, AI_TOOLKIT_USER_DATA: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.nativePort}`, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')}; delete env.ELECTRON_RUN_AS_NODE;
    const log = fs.openSync(path.join(directory, 'original-process.log'), 'a');
    child = spawn(path.join(live, 'AI Toolkit.exe'), [], {cwd: live, env, windowsHide: true, stdio: ['ignore', log, log]}); fs.closeSync(log);
    report.originalPid = child.pid; child.on('error', error => {report.launchError = error.message; save();});
    await until(() => fs.existsSync(path.join(directory, 'original-running.json')));
    const running = json(path.join(directory, 'original-running.json'));
    assert.equal(path.resolve(running.userData), profile); assert.equal(path.resolve(running.exe), path.join(live, 'AI Toolkit.exe'));
    client = await until(() => connect(options.electronPort));
    assert.ok(client.target.url.startsWith('file:///') && decodeURIComponent(client.target.url).replaceAll('\\', '/').toLowerCase().includes(live.replaceAll('\\', '/').toLowerCase()));
    await until(() => client.evaluate(`Boolean(window.electronAPI&&window.unsavedChanges&&document.getElementById('releaseUpdateButton')?.classList.contains('releaseAvailable')&&!document.getElementById('releaseUpdateButton').disabled)`));
    report.before = await client.evaluate(`electronAPI.checkReleaseUpdate(true)`); assert.equal(report.before.key, key);
    await client.evaluate(`(()=>{localStorage.setItem('aiv.lastProject.v1',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('migration.acceptance.preference','local preference survives');document.getElementById('releaseUpdateButton').click();return true})()`);
    await until(() => child.exitCode === 0, 180000); client.close(); client = undefined;
    const stages = fs.readdirSync(path.join(profile, 'release-updates')).filter(name => name.startsWith('release-'));
    assert.equal(stages.length, 1); report.stage = path.join(profile, 'release-updates', stages[0]); save();
    client = await until(() => connect(options.nativePort), 180000);
    const quotedExecutable = "'" + path.join(live, 'AI Toolkit.exe').replaceAll("'", "''") + "'";
    const processQuery = `Get-CimInstance Win32_Process -Filter "Name = 'AI Toolkit.exe'" | Where-Object { $_.ExecutablePath -eq ${quotedExecutable} } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`;
    const processes = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', processQuery], {encoding: 'utf8', windowsHide: true, timeout: 15000}));
    const nativeProcesses = (Array.isArray(processes) ? processes : [processes]).filter(process => process.ProcessId !== report.originalPid);
    assert.equal(nativeProcesses.length, 1, 'The restarted native process must belong to this exact fixture executable');
    report.nativeProcess = nativeProcesses[0];
    assert.equal(sha(fs.readFileSync(path.join(report.stage, 'install.ps1'))), report.originalHelperHashes['release-install.ps1']);
    assert.equal(sha(fs.readFileSync(path.join(report.stage, 'backup/AI Toolkit.exe'))), originalExecutableHash);
    assert.equal(sha(fs.readFileSync(path.join(report.stage, 'backup/resources/app.asar'))), report.originalFixtureArchiveHash);
    assert.deepEqual(fs.readFileSync(path.join(report.stage, 'manifest.json')), fs.readFileSync(path.join(live, 'installed-release.json')));
    report.installerOutput = fs.readFileSync(path.join(report.stage, 'installer.log'), 'utf16le');
    assert.match(report.installerOutput, /Installed successfully/);
    await until(() => client.evaluate(`Boolean(window.electronAPI&&window.ucpLibrary?.getState().loadedProject&&localStorage.getItem('migration.acceptance.preference'))`), 120000);
    const after = await client.evaluate(`(()=>({preference:localStorage.getItem('migration.acceptance.preference'),project:ucpLibrary.getState().loadedProject,frames:castleEditor.getDocument()?.frames?.length,path:castleEditor.getPath(),workspace:appWorkspace.getActive(),button:document.getElementById('releaseUpdateButton').textContent,buttonClass:document.getElementById('releaseUpdateButton').className}))()`);
    assert.equal(after.preference, 'local preference survives'); assert.equal(path.resolve(after.project.aiRoot), project.aiRoot); assert.equal(after.project.castleFile, project.castleFile); assert.equal(after.frames, 1);
    assert.equal(after.workspace, project.workspace); assert.equal(path.resolve(after.path), path.join(project.aiRoot, 'aiv', project.castleFile));
    assert.equal(sha(fs.readFileSync(custom)), report.customConfigurationSha256);
    assert.equal(json(path.join(profile, 'settings.json')).migrationAcceptance, 'settings survive');
    assert.equal(json(path.join(profile, 'update-source.json')).repo, options.repo);
    assert.equal(sha(fs.readFileSync(path.join(project.aiRoot, 'aiv', project.castleFile))), report.projectSha256);
    const nativeReceipt = await until(() => {const value = json(path.join(live, '.toolkit-release.json')); return value.exeSha256 && value;});
    assert.equal(nativeReceipt.exeSha256, sha(targetFiles['AI Toolkit.exe'])); assert.equal(nativeReceipt.key, key);
    // The old helper replaced this same physical path; discard the test reader's
    // cached Electron header before inspecting the newly installed native capsule.
    asar.uncache(path.join(live, 'resources/app.asar'));
    const capsule = JSON.parse(asar.extractFile(path.join(live, 'resources/app.asar'), 'migration.json'));
    for (const resource of capsule.files) assert.equal(sha(fs.readFileSync(path.join(live, resource.path))), resource.sha256);
    report.nativeStartupVerified = true; report.receipt = nativeReceipt; report.after = after;
    if (options.published) {
      const current = await client.evaluate('electronAPI.checkReleaseUpdate(true)');
      assert.equal(current.status, 'current', JSON.stringify(current));
      assert.equal(current.key, key);
      const currentUI = await until(async () => {
        const value = await client.evaluate(`(()=>{const button=document.getElementById('releaseUpdateButton');return{source:document.getElementById('releaseSourceSelect').value,text:button.textContent,className:button.className,disabled:button.disabled}})()`);
        return value.source.toLowerCase() === options.repo.toLowerCase() && value.className.includes('releaseCurrent') && !value.disabled && value;
      });
      report.current = current; report.currentUI = currentUI; report.liveCurrentVerified = true;
    } else report.liveCurrentVerified = false;
    const screenshot = await client.send('Page.captureScreenshot', {format: 'png'}); write(path.join(directory, 'native-restored.png'), Buffer.from(screenshot.data, 'base64'));
    await client.evaluate('setTimeout(()=>electronAPI.confirmWindowClose(),100);true');
    client.close(); client = undefined;
  }
  assert.equal(sha(fs.readFileSync(originalArchive)), originalArchiveHash, 'Original installation remains byte-identical');
  assert.equal(sha(fs.readFileSync(path.join(originalRoot, 'AI Toolkit.exe'))), originalExecutableHash, 'Original executable remains byte-identical');
  report.passed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({passed: true, result: path.join(directory, 'result.json'), nativeStartupVerified: report.nativeStartupVerified, liveCurrentVerified: Boolean(report.liveCurrentVerified)}, null, 2));
} catch (error) {
  report.passed = false; report.error = error.stack; save(); console.error(JSON.stringify({passed: false, result: path.join(directory, 'result.json'), error: error.message})); process.exitCode = 1;
} finally {
  client?.close(); if (server) await new Promise(resolve => server.close(resolve));
  // A failed fixture is retained. Never kill by name or reach into the user's app.
  child?.unref();
}
