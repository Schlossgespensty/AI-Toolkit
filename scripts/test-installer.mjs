// Exercise the actual production NSIS hook in a registry-free, silent harness.
// The test installer can only write inside a newly created temporary directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { validatePackagePolicy } from './package-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

export function testInstallerHooks() {
  if (process.platform !== 'win32') throw Error('NSIS installer verification requires Windows.');
  validatePackagePolicy();
  const nsis = path.join(process.env.LOCALAPPDATA, 'tauri/NSIS/makensis.exe');
  if (!fs.existsSync(nsis)) throw Error('Tauri NSIS tools missing; bundle once before running the installer check.');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-installer-test-'));
  const defaults = path.join(base, 'defaults'), install = path.join(base, 'install');
  const write = (name, value) => {
    const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  };
  const original = Buffer.from('{"customValue":64,"unknownProperty":"keep"}\r\n');
  try {
    write('defaults/aiv_constants.json', '{"newDefault":1}');
    write('defaults/new-config.json', '{"added":true}');
    write('install/config/aiv_constants.json', original);
    write('install/config/custom.json', '{"unknownFile":true}');
    write('install/config/my-pack/note.txt', 'Keep unknown nested files too.');
    const snapshot = ['config/aiv_constants.json', 'config/custom.json', 'config/my-pack/note.txt']
      .map(name => [name, fs.readFileSync(path.join(install, name))]);
    for (const [scenario, abort] of [['fresh-install', false], ['reinstall', false], ['aborted-install', true]]) {
      const target = scenario === 'fresh-install' ? path.join(base, 'fresh-install') : install;
      const exe = path.join(base, scenario + '.exe'), source = path.join(base, scenario + '.nsi');
      fs.writeFileSync(source, `Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nName "Toolkit installer verification"\nOutFile "${quote(exe)}"\nInstallDir "${quote(target)}"\n!define TOOLKIT_DEFAULT_CONFIG_DIR "${quote(defaults)}"\n!include "${quote(path.join(root, 'scripts/installer/config.nsh'))}"\nSection\n  !insertmacro NSIS_HOOK_POSTINSTALL\n  ${abort ? 'Abort' : ''}\nSectionEnd\n`);
      execFileSync(nsis, ['/V2', source], { windowsHide: true, stdio: 'pipe' });
      const result = spawnSync(exe, ['/S'], { windowsHide: true, timeout: 20_000, stdio: 'pipe' });
      if (result.error) throw result.error;
      if (!abort) assert.equal(result.status, 0, 'silent test install succeeded');
      else assert.notEqual(result.status, 0, 'test installation aborted');
      if (scenario === 'fresh-install') assert.equal(fs.readFileSync(path.join(target, 'config/aiv_constants.json'), 'utf8'), '{"newDefault":1}');
      else for (const [name, bytes] of snapshot) assert.deepEqual(fs.readFileSync(path.join(target, name)), bytes, `${scenario} preserved ${name}`);
      assert.equal(fs.readFileSync(path.join(target, 'config/new-config.json'), 'utf8'), '{"added":true}');
    }
    console.log('NSIS config preservation: fresh install has all defaults; existing, unknown and nested files intact on reinstall; aborted install preserved originals.');
  } finally {
    // Verify the absolute target before any recursive cleanup on Windows.
    if (path.dirname(path.resolve(base)) !== path.resolve(os.tmpdir()) || !path.basename(base).startsWith('toolkit-installer-test-')) throw Error('Unexpected installer test cleanup path');
    fs.rmSync(base, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) testInstallerHooks();
