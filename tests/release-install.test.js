'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
// GitHub's pwsh runner exports PowerShell 7 module paths. These fixtures launch
// Windows PowerShell 5.1, whose Get-FileHash/Compress-Archive modules must come
// from its own installation rather than an incompatible inherited module path.
const childEnv = {...process.env};
if (process.platform === 'win32') childEnv.PSModulePath = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
delete childEnv.ELECTRON_RUN_AS_NODE;
test('Windows release installation preserves custom files, refuses locks and records build identity', {skip:process.platform!=='win32'},()=>{
 const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'release-installer-smoke.ps1'),'-Installer',path.resolve(__dirname,'../src/node/release-install.ps1')],{encoding:'utf8',windowsHide:true,timeout:60000,env:childEnv});
 assert.match(output,/PASS:/);
});

test('installer survives Electron exit, replaces files and restarts the installed program', {skip:process.platform!=='win32'},async t=>{
 const fs=require('node:fs');
 const fixture=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'release-installer-smoke.ps1'),'-Installer',path.resolve(__dirname,'../src/node/release-install.ps1'),'-Handoff'],{encoding:'utf8',windowsHide:true,timeout:60000,env:childEnv}));
 const cleanupRoot=path.resolve(fixture.testRoot);
 assert.equal(path.dirname(cleanupRoot),path.resolve(require('node:os').tmpdir()));
 assert.match(path.basename(cleanupRoot),/^release-install-test-[a-f0-9]+$/);
 // Let exit/I/O callbacks run while Windows releases the restarted executable.
 t.after(()=>fs.promises.rm(cleanupRoot,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const runner=path.join(fixture.testRoot,'runner.cjs');
 fs.writeFileSync(runner,`const {app}=require('electron'); app.whenReady().then(async()=>{try{await require(${JSON.stringify(path.resolve(__dirname,'../src/node/release-download.js'))}).launchInstaller(${JSON.stringify(fixture)});app.exit(0);}catch(e){console.error(e);app.exit(1);}});`);
 const env=childEnv;
 execFileSync(require('electron'),[runner],{windowsHide:true,encoding:'utf8',env,timeout:25000});
 const deadline=Date.now()+20000, marker=path.join(fixture.root,'restarted.txt');
 while(!fs.existsSync(marker) && Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.ok(fs.existsSync(marker),'new executable must restart after the editor exits');
 assert.equal(require('../src/node/release-updates').readInstalledBuild(fixture.root)?.key,'snapshot-test');
 assert.match(fs.readFileSync(path.join(fixture.stage,'installer.log'),'utf16le'),/Installed successfully/);
});

test('startup failure rejects before the editor is allowed to close', {skip:process.platform!=='win32'},async t=>{
 const fs=require('node:fs'),os=require('node:os');
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-failed-helper-'));
 t.after(()=>fs.rmSync(stage,{recursive:true,force:true}));
 const script=path.join(stage,'broken.ps1');fs.writeFileSync(script,'exit 1');
 await assert.rejects(require('../src/node/release-download').launchInstaller({stage,root:stage,script}),/Installer exited before starting/);
});

test('Electron recognizes the physical installed ASAR and does not offer it again', async t=>{
 const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-electron-receipt-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'input'));fs.mkdirSync(path.join(root,'resources'));
 fs.writeFileSync(path.join(root,'input','main.js'),'// fixture');
 await require('@electron/asar').createPackage(path.join(root,'input'),path.join(root,'resources/app.asar'));
 const receipt={repo:'Krarilotus/AI-Toolkit',tag:'snapshot-test',key:'snapshot-test',asarSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'resources/app.asar'))).digest('hex')};
 fs.writeFileSync(path.join(root,'.toolkit-release.json'),JSON.stringify(receipt));
 const runner=path.join(root,'runner.cjs');
 fs.writeFileSync(runner,`const {app}=require('electron');try { const u=require(${JSON.stringify(path.resolve(__dirname,'../src/node/release-updates.js'))});require('node:assert/strict').deepEqual(u.readInstalledBuild(${JSON.stringify(root)}),${JSON.stringify(receipt)});console.log('PASS: physical ASAR receipt');app.exit(0);}catch(e){console.error(e);app.exit(1);}`);
 const env=childEnv;
 const output=execFileSync(require('electron'),[runner],{windowsHide:true,encoding:'utf8',env,timeout:25000});
 assert.match(output,/PASS: physical ASAR receipt/);
});
