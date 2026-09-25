'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const asar = require('@electron/asar');
const {zipSync} = require('fflate');

const installer = path.resolve(__dirname, '../src/node/release-install.ps1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const childEnv = {...process.env, PSModulePath: path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/Modules')};
delete childEnv.ELECTRON_RUN_AS_NODE;

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-legacy-native-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('toolkit-legacy-native-'));
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  });
  const live = path.join(root, 'live'), stage = path.join(root, 'profile/release-updates/release-fixture');
  const capsuleRoot = path.join(root, 'capsule'), capsule = path.join(root, 'app.asar');
  const write = (base, name, bytes) => {
    const file = path.join(base, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
  };
  const resources = {'README.txt': 'native instructions', 'THIRD_PARTY_NOTICES.txt': 'native notices', 'assets/aiv/iso/verzeichnis.json': '{"fixture":true}'};
  const manifest = {schemaVersion: 1, runtime: 'tauri', executable: {path: 'AI Toolkit.exe', sha256: sha('new native executable')}, files: Object.entries(resources).map(([name, bytes]) => ({path: name, sha256: sha(bytes)}))};
  for (const [name, bytes] of Object.entries(resources)) write(capsuleRoot, name, bytes);
  write(capsuleRoot, 'migration.json', JSON.stringify(manifest));
  await asar.createPackage(capsuleRoot, capsule);
  for (const [name, bytes] of Object.entries({'AI Toolkit.exe': 'original electron executable', 'resources/app.asar': 'original electron archive', 'config/template.json': '{"default":"old"}', 'config/custom.json': '{"custom":"keep"}', 'project.json': '{"project":"keep"}', '.toolkit-release.json': '{"original":true}'})) write(live, name, bytes);
  const entries = {'AI Toolkit.exe': Buffer.from('new native executable'), 'resources/app.asar': fs.readFileSync(capsule), 'new-runtime.dll': Buffer.from('new file'), 'config/template.json': Buffer.from('{"default":"new"}'), 'config/custom.json': Buffer.from('{"custom":"overwrite"}'), ...Object.fromEntries(Object.entries(resources).map(([name, bytes]) => [name, Buffer.from(bytes)]))};
  write(stage, 'release.zip', zipSync(entries));
  write(stage, 'config-baseline.json', JSON.stringify({'config/template.json': sha(fs.readFileSync(path.join(live, 'config/template.json'))), 'config/custom.json': sha('bundled original default')}));
  write(stage, 'release.json', JSON.stringify({repo: 'Krarilotus/AI-Toolkit', tag: 'migration-fixture', key: 'migration-fixture-key'}));
  const original = Object.fromEntries(['AI Toolkit.exe', 'resources/app.asar', 'config/template.json', 'config/custom.json', 'project.json', '.toolkit-release.json'].map(name => [name, sha(fs.readFileSync(path.join(live, name)))]));
  const run = (mode, extra = []) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installer, '-Mode', mode, '-Stage', stage, '-InstallRoot', live, '-NoRestart', ...extra], {encoding: 'utf8', windowsHide: true, timeout: 60000, env: childEnv});
  const prepared = run('Prepare'); assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  return {root, live, stage, original, manifest, run};
}

test('unchanged Electron installer accepts the native resource ASAR and preserves custom data', {skip: process.platform !== 'win32'}, async t => {
  const f = await fixture(t);
  const staged = JSON.parse(fs.readFileSync(path.join(f.stage, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.ok(staged.some(entry => entry.file === 'resources/app.asar'));
  assert.ok(!staged.some(entry => entry.file === 'config/custom.json'));
  assert.ok(!staged.some(entry => entry.file === 'assets/aiv/iso/verzeichnis.json'));
  const installed = f.run('Install'); assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  for (const entry of staged) assert.equal(sha(fs.readFileSync(path.join(f.live, entry.file))), entry.sha256.toLowerCase());
  for (const name of ['config/custom.json', 'project.json']) assert.equal(sha(fs.readFileSync(path.join(f.live, name))), f.original[name]);
  for (const name of ['AI Toolkit.exe', 'resources/app.asar', 'config/template.json', '.toolkit-release.json']) assert.equal(sha(fs.readFileSync(path.join(f.stage, 'backup', name))), f.original[name]);
  const actual = JSON.parse(asar.extractFile(path.join(f.live, 'resources/app.asar'), 'migration.json'));
  assert.deepEqual(actual, f.manifest);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.live, '.toolkit-release.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(receipt.key, 'migration-fixture-key');
  assert.equal(receipt.asarSha256, sha(fs.readFileSync(path.join(f.live, 'resources/app.asar'))));
  assert.equal(receipt.exeSha256, undefined, 'Native startup must finalize the legacy receipt after successful launch');
});

test('original Electron helper rolls back native files after a failure following partial writes', {skip: process.platform !== 'win32'}, async t => {
  const f = await fixture(t);
  // Delete only a fixture input after validation and backups. The original helper
  // remains byte-identical; its normal catch must undo the preceding EXE/ASAR writes.
  const line = fs.readFileSync(installer, 'utf8').split(/\r?\n/).findIndex(value => value.trim() === '$changed=$true') + 1;
  assert.ok(line > 0);
  const injection = `Set-PSBreakpoint -Script ${quote(installer)} -Line ${line} -Action { Remove-Item -LiteralPath ${quote(path.join(f.stage, 'incoming/.toolkit-release.json'))} -Force } | Out-Null\n& ${quote(installer)} -Mode Install -Stage ${quote(f.stage)} -InstallRoot ${quote(f.live)} -NoRestart`;
  const failed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', injection], {encoding: 'utf8', windowsHide: true, timeout: 60000, env: childEnv});
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  for (const [name, hash] of Object.entries(f.original)) assert.equal(sha(fs.readFileSync(path.join(f.live, name))), hash, `${name} restored`);
  assert.equal(fs.existsSync(path.join(f.live, 'new-runtime.dll')), false, 'New destination removed on rollback');
  assert.ok(fs.existsSync(path.join(f.stage, 'backup/AI Toolkit.exe')));
  assert.match(fs.readFileSync(path.join(f.stage, 'error.txt'), 'utf8'), /\.toolkit-release\.json/);
});
