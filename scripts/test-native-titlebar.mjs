// Opt-in native-window acceptance. This uses standard Tauri window APIs through
// CDP in a fresh portable clone. CDP screenshots contain WEB CONTENT ONLY.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = {port: 9266};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (['--run', '--baseline'].includes(key)) options[key.slice(2)] = true;
  else if (['--archive', '--output', '--port'].includes(key)) options[key.slice(2)] = process.argv[++i];
  else throw Error(`Unknown argument: ${key}`);
}
if (!options.run || !options.archive) throw Error('Usage: node scripts/test-native-titlebar.mjs --archive ZIP --run [--baseline] [--output PARENT] [--port 9266]');
assert.equal(process.platform, 'win32');
options.port = Number(options.port);
assert.ok(Number.isInteger(options.port) && options.port >= 1024 && options.port <= 65535);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 60000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    try {const value = await check(); if (value) return value;} catch (error) {last = error;}
    await delay(100);
  }
  throw last || Error('Timed out waiting for native-window acceptance');
}
async function freePort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve);});
  await new Promise(resolve => probe.close(resolve));
}
async function targets() {return (await fetch(`http://127.0.0.1:${options.port}/json/list`)).json();}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  let next = 0; const pending = new Map();
  socket.onmessage = ({data}) => {
    const response = JSON.parse(data), waiter = pending.get(response.id); if (!waiter) return;
    pending.delete(response.id); clearTimeout(waiter.timer);
    response.error ? waiter.reject(Error(JSON.stringify(response.error))) : waiter.resolve(response.result);
  };
  socket.onclose = () => {for (const waiter of pending.values()) {clearTimeout(waiter.timer); waiter.reject(Error('Fixture window closed'));} pending.clear();};
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => {pending.delete(id); reject(Error(`CDP timeout: ${method}`));}, 30000);
    pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
  });
  return {target, close: () => socket.close(), send, evaluate: async expression => {
    const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }};
}
const nativeWindow = 'window.__TAURI__.window.getCurrentWindow()';
const metadataExpression = `(async()=>{const w=${nativeWindow};return{label:w.label,decorated:await w.isDecorated(),minimized:await w.isMinimized(),maximized:await w.isMaximized(),fullscreen:await w.isFullscreen(),outerSize:await w.outerSize(),innerSize:await w.innerSize(),outerPosition:await w.outerPosition(),innerPosition:await w.innerPosition(),scale:await w.scaleFactor()}})()`;
const titlebarExpression = `(()=>{const group=document.getElementById('windowControls'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{classes:document.documentElement.className,controlsHidden:!group||group.hidden||getComputedStyle(group).display==='none',controls:group?[...group.querySelectorAll('[data-window-action]')].map(e=>({action:e.dataset.windowAction,label:e.getAttribute('aria-label'),title:e.title,rect:rect(e)})):[],bar:rect(document.querySelector('.workspaceTabs')),viewport:{width:innerWidth,height:innerHeight}}})()`;
function verifyControls(ui) {
  assert.equal(ui.controlsHidden, false);
  assert.deepEqual(ui.controls.map(control => control.action), ['minimize', 'maximize', 'close']);
  for (const control of ui.controls) {
    assert.ok(control.label, `${control.action} has an accessible label`);
    assert.ok(control.rect.width > 0 && control.rect.height > 0);
    assert.ok(control.rect.x >= 0 && control.rect.y >= 0);
    assert.ok(control.rect.x + control.rect.width <= ui.viewport.width + 1);
    assert.ok(control.rect.y + control.rect.height <= ui.bar.y + ui.bar.height + 1);
  }
  for (let i = 1; i < ui.controls.length; i++) assert.ok(ui.controls[i].rect.x >= ui.controls[i - 1].rect.x + ui.controls[i - 1].rect.width - 1);
}
function verifyIntegratedFrame(metadata) {
  assert.equal(metadata.decorated, false, 'Editor must remove the operating-system titlebar');
  const topInset = metadata.innerPosition.y - metadata.outerPosition.y;
  assert.ok(topInset < 20 * metadata.scale, `A native caption must not consume the top of the window (${topInset}px inset)`);
}

await freePort(options.port);
const bytes = fs.readFileSync(path.resolve(options.archive));
const parent = path.resolve(options.output || path.join(source, '../titlebar-qa'));
fs.mkdirSync(parent, {recursive: true});
const directory = fs.mkdtempSync(path.join(parent, 'native-titlebar-'));
const portable = path.join(directory, 'portable'), profile = path.join(directory, 'profile');
fs.mkdirSync(portable); fs.mkdirSync(profile);
for (const [name, data] of Object.entries(unzipSync(bytes))) {
  const file = path.resolve(portable, name); assert.ok(file.startsWith(portable + path.sep));
  fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data);
}
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({titlebarAcceptance: true, mainWindow: {bounds: {x: 100, y: 100, width: options.baseline ? 1200 : 800, height: 850}, maximized: false}}));
const report = {startedAt: new Date().toISOString(), directory, archive: path.resolve(options.archive), archiveSha256: sha(bytes), baseline: Boolean(options.baseline), verification: {nativeWindowMetadata: true, rendererScreenshotOnly: true, outerWindowScreenshot: false, physicalDrag: false, nativeSnapHover: false, nativeUnsavedDialogRendering: false}};
const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
const clients = []; let processHandle;
const screenshot = async (client, name) => {const {data} = await client.send('Page.captureScreenshot', {format: 'png'}); fs.writeFileSync(path.join(directory, name), Buffer.from(data, 'base64'));};
try {
  const env = {...process.env, AI_TOOLKIT_USER_DATA: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.port}`}; delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(path.join(directory, 'process.log'), 'a');
  processHandle = spawn(path.join(portable, 'AI Toolkit.exe'), [], {cwd: portable, env, windowsHide: true, stdio: ['ignore', log, log]}); fs.closeSync(log);
  report.pid = processHandle.pid; save();
  const mainTarget = await until(async () => (await targets()).find(target => target.type === 'page' && target.url.includes('restoreProject=1')));
  const main = await connect(mainTarget); clients.push(main);
  await until(() => main.evaluate('Boolean(window.electronAPI&&window.castleEditor&&window.unsavedChanges&&window.__TAURI__)'));
  report.main = await main.evaluate(metadataExpression); assert.equal(report.main.label, 'main');
  report.chrome = await main.evaluate('electronAPI.getWindowChrome()');
  if (options.baseline) {
    assert.equal(report.main.decorated, true, 'Baseline should demonstrate the duplicate native frame');
    await screenshot(main, 'baseline-renderer-only.png');
    await main.evaluate('setTimeout(()=>electronAPI.confirmWindowClose(),100);true');
  } else {
    verifyIntegratedFrame(report.main);
    assert.equal(report.chrome.integrated, true); assert.equal(report.chrome.customControls, true);
    await until(() => main.evaluate(`Boolean(document.getElementById('windowControls')&&!document.getElementById('windowControls').hidden)`));
    report.normalUI = await main.evaluate(titlebarExpression); verifyControls(report.normalUI);
    await screenshot(main, 'normal-renderer-only.png');
    report.themeControls = {};
    report.themeTabs = {};
    for (const theme of ['default', 'ucp']) {
      await main.evaluate(`ToolkitTheme.select(${JSON.stringify(theme)})`);
      await until(() => main.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));
      const paint = await main.evaluate(`(()=>[...document.querySelectorAll('.windowControl')].map(button=>{const css=getComputedStyle(button);return{action:button.dataset.windowAction,backgroundImage:css.backgroundImage,borderImageSource:css.borderImageSource,borderRadius:css.borderRadius}}))()`);
      for (const button of paint) {
        assert.equal(button.backgroundImage, 'none', `${theme} caption buttons must not use themed button artwork`);
        assert.equal(button.borderImageSource, 'none'); assert.equal(button.borderRadius, '0px');
      }
      report.themeControls[theme] = paint;
      const tabs = await main.evaluate(`(()=>[...document.querySelectorAll('.workspaceTab')].map(button=>{const css=getComputedStyle(button),range=document.createRange();range.selectNodeContents(button);return{id:button.id,whiteSpace:css.whiteSpace,textOverflow:css.textOverflow,overflowX:css.overflowX,display:css.display,textLineCount:new Set([...range.getClientRects()].filter(rect=>rect.height>0).map(rect=>Math.round(rect.y))).size}}))()`);
      assert.equal(tabs.length, 4);
      for (const tab of tabs) {
        assert.equal(tab.whiteSpace, 'nowrap', `${theme} narrow ${tab.id} must keep its label on one line`);
        assert.equal(tab.textOverflow, 'ellipsis', `${theme} narrow ${tab.id} must deliberately truncate long labels`);
        assert.equal(tab.overflowX, 'hidden'); assert.equal(tab.display, 'block');
        assert.equal(tab.textLineCount, 1);
      }
      report.themeTabs[theme] = tabs;
      verifyControls(await main.evaluate(titlebarExpression));
      await screenshot(main, `${theme}-controls-renderer-only.png`);
    }
    await main.evaluate(`ToolkitTheme.select('default')`);
    report.dragRegions = await main.evaluate(`(()=>({inert:[...document.querySelectorAll('.workspaceTabs [data-tauri-drag-region]')].map(e=>e.className),interactive:[...document.querySelectorAll('.workspaceTabs button[data-tauri-drag-region],.workspaceTabs select[data-tauri-drag-region]')].map(e=>e.id)}))()`);
    assert.ok(report.dragRegions.inert.length > 0); assert.deepEqual(report.dragRegions.interactive, []);

    await main.evaluate(`document.querySelector('[data-window-action="maximize"]').click();true`);
    await until(() => main.evaluate(`(async()=>await ${nativeWindow}.isMaximized()&&document.documentElement.classList.contains('windowMaximized'))()`));
    report.maximized = await main.evaluate(metadataExpression);
    report.maximizedUI = await main.evaluate(titlebarExpression); verifyControls(report.maximizedUI);
    assert.ok(report.maximized.outerSize.width >= report.main.outerSize.width);
    await screenshot(main, 'maximized-renderer-only.png');
    await main.evaluate(`document.querySelector('[data-window-action="maximize"]').click();true`);
    await until(() => main.evaluate(`(async()=>!(await ${nativeWindow}.isMaximized())&&!document.documentElement.classList.contains('windowMaximized'))()`));
    report.restored = await main.evaluate(metadataExpression);
    assert.ok(Math.abs(report.restored.outerSize.width - report.main.outerSize.width) <= 2);
    assert.ok(Math.abs(report.restored.outerSize.height - report.main.outerSize.height) <= 2);

    await main.evaluate(`document.querySelector('[data-window-action="minimize"]').click();true`);
    await until(() => main.evaluate(`${nativeWindow}.isMinimized()`));
    report.minimizePassed = true;
    // Restore using an already-authorized normal Window API. No OS input,
    // foreground-window guessing, or extra permission is required by the test.
    await main.evaluate(`${nativeWindow}.maximize()`);
    await until(() => main.evaluate(`(async()=>!(await ${nativeWindow}.isMinimized())&&await ${nativeWindow}.isMaximized())()`));
    await main.evaluate(`${nativeWindow}.unmaximize()`);
    await until(() => main.evaluate(`(async()=>!(await ${nativeWindow}.isMaximized()))()`));
    report.restoreFromMinimizePassed = true;

    await main.evaluate(`${nativeWindow}.setFullscreen(true)`);
    await until(() => main.evaluate(`(async()=>await ${nativeWindow}.isFullscreen()&&document.documentElement.classList.contains('windowFullscreen'))()`));
    report.fullscreenUI = await main.evaluate(titlebarExpression);
    assert.equal(report.fullscreenUI.controlsHidden, true, 'Fullscreen hides the native caption controls');
    await main.evaluate(`${nativeWindow}.setFullscreen(false)`);
    await until(() => main.evaluate(`(async()=>!(await ${nativeWindow}.isFullscreen())&&!document.documentElement.classList.contains('windowFullscreen'))()`));
    report.fullscreenStatePassed = true;

    const editorLabel = await main.evaluate('electronAPI.openNewWindow()');
    const editorTarget = await until(async () => (await targets()).find(target => target.type === 'page' && target.url.includes('restoreProject=0')));
    const editor = await connect(editorTarget); clients.push(editor);
    await until(() => editor.evaluate('Boolean(window.castleEditor&&window.isoView&&window.unsavedChanges&&window.__TAURI__)'));
    await until(() => editor.evaluate(`Boolean(document.getElementById('windowControls')&&!document.getElementById('windowControls').hidden)`));
    report.secondary = await editor.evaluate(metadataExpression); assert.equal(report.secondary.label, editorLabel); verifyIntegratedFrame(report.secondary);
    report.secondaryUI = await editor.evaluate(titlebarExpression); verifyControls(report.secondaryUI);
    await editor.evaluate(`appWorkspace.setActive('castle');isoView.openWindow()`);
    let child = await until(() => main.evaluate(`(async()=>{for(const w of await __TAURI__.window.getAllWindows())if(w.label.startsWith('viewport-'))return{label:w.label,decorated:await w.isDecorated(),title:await w.title()};return null})()`));
    assert.equal(child.decorated, true, 'Detached viewport retains its usable system frame'); report.detached = child;
    const popupTarget = await until(async () => (await targets()).find(target => target.type === 'page' && target.url === 'about:blank'));
    const popup = await connect(popupTarget); clients.push(popup);
    assert.equal(await popup.evaluate('window.__TAURI_INTERNALS__.metadata.currentWindow.label'), child.label);
    await until(() => popup.evaluate(`Boolean(document.getElementById('isoWindowDockBtn'))`));
    await screenshot(popup, 'detached-renderer-only.png');
    await popup.evaluate(`setTimeout(()=>document.getElementById('isoWindowDockBtn').click(),100);true`);
    await until(() => main.evaluate(`(async()=>!(await __TAURI__.window.Window.getByLabel(${JSON.stringify(child.label)})))()`));
    report.detachedDockPassed = true;
    await editor.evaluate('isoView.openWindow()');
    child = await until(() => main.evaluate(`(async()=>{for(const w of await __TAURI__.window.getAllWindows())if(w.label.startsWith('viewport-'))return{label:w.label,decorated:await w.isDecorated()};return null})()`));
    assert.equal(child.decorated, true); report.reopenedDetached = child;

    // Make a genuine document edit, then substitute only the dialog's answer.
    // The titlebar button, native CloseRequested event, dirty checks and editor
    // survival are real. Native modal rendering/input is explicitly not claimed.
    const dirty = await editor.evaluate(`(()=>{castleEditor.loadDocument({frames:[{itemType:61,tilePositionOfsets:[4950]},{itemType:25,tilePositionOfsets:[4949]}],miscItems:[]},'titlebar-unsaved.aiv');const wall=castleEditor.extras.placementRefs().find(item=>item.type===25);if(!wall)throw Error('Fixture wall missing');castleEditor.extras.state.selected.add(wall.ref);castleEditor.deleteSelected();window.__titlebarClosePrompts=[];window.__titlebarCloseAnswer='cancel';electronAPI.confirmUnsaved=async request=>{__titlebarClosePrompts.push(request);return __titlebarCloseAnswer;};return castleEditor.isDirty()})()`);
    assert.equal(dirty, true);
    await editor.evaluate(`document.querySelector('[data-window-action="close"]').click();true`);
    await until(() => editor.evaluate('__titlebarClosePrompts.length===1'));
    assert.equal(await editor.evaluate('castleEditor.isDirty()'), true);
    assert.equal(await main.evaluate(`(async()=>Boolean(await __TAURI__.window.Window.getByLabel(${JSON.stringify(editorLabel)})))()`), true);
    assert.equal(await main.evaluate(`(async()=>Boolean(await __TAURI__.window.Window.getByLabel(${JSON.stringify(child.label)})))()`), true, 'Cancel must preserve the editor-owned viewport too');
    report.unsavedCancelGuardPassed = true;
    await editor.evaluate(`__titlebarCloseAnswer='discard';setTimeout(()=>document.querySelector('[data-window-action="close"]').click(),100);true`);
    await until(() => main.evaluate(`(async()=>{const labels=(await __TAURI__.window.getAllWindows()).map(w=>w.label);return !labels.includes(${JSON.stringify(editorLabel)})&&!labels.includes(${JSON.stringify(child.label)})&&labels.includes('main')})()`));
    report.unsavedDiscardAndOwnedViewportClosePassed = true;

    // The main window remains open and still exposes one integrated bar.
    report.finalMain = await main.evaluate(metadataExpression); assert.equal(report.finalMain.decorated, false);
    await screenshot(main, 'final-renderer-only.png');
    await main.evaluate(`setTimeout(()=>document.querySelector('[data-window-action="close"]').click(),100);true`);
  }
  await until(() => processHandle.exitCode === 0, 30000);
  report.passed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({passed: true, result: path.join(directory, 'result.json'), outerWindowScreenshot: false, physicalDrag: false}, null, 2));
} catch (error) {
  report.passed = false; report.error = error.stack; save(); console.error(JSON.stringify({passed: false, result: path.join(directory, 'result.json'), error: error.message})); process.exitCode = 1;
} finally {
  for (const client of clients) client.close();
  // Failed clones remain available for diagnosis; never kill an editor by name.
  processHandle?.unref();
}
