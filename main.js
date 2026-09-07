const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, ipcMain, dialog, globalShortcut, shell, nativeImage } = require('electron');
const {
  normalizeInstallationPath,
  installationLayout,
  scanUcpInstallation,
  cloneAiToManagedPlugin,
  createManagedAi,
  readAiProject,
  resolveAiMediaEntry,
  updateAiCastleMapping,
  updateManagedAi,
  atomicWriteFile,
  isWithin
} = require('./src/node/ucp-library');
const { placeholderPortraitPng, resizeBgraBitmapToPng } = require('./src/node/pixel-image');
const { listGameMaps, readGameMap, readMapTerrain } = require('./src/node/game-map');
const { transferableBytes, writeNativeAiv } = require('./src/node/aiv-file');

const aivCodecPromise = import('./src/node/aiv-codec.mjs');
let aivTemplatesCache = null;

function projectRoot() {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
}

function runtimeConfigDir() {
  return path.join(projectRoot(), 'config');
}

function defaultConfigDir() {
  return path.join(__dirname, 'config');
}

function skinDir() {
  // Use userData so skins remain writable even when the app is installed under Program Files.
  return path.join(app.getPath('userData'), 'aiv-skins');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSettings(settings) {
  atomicWriteFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function savedUcpInstallation() {
  const candidate = readSettings().ucpInstallation;
  if (!candidate) return null;
  try {
    return normalizeInstallationPath(candidate);
  } catch (_) {
    return null;
  }
}

function bundledSkinDir() {
  const candidates = [
    path.join(projectRoot(), 'assets', 'aiv', 'skins'),
    path.join(__dirname, 'assets', 'aiv', 'skins')
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function aivTemplates() {
  if (!aivTemplatesCache) {
    const candidates = [
      path.join(runtimeConfigDir(), 'aiv_templates.json'),
      path.join(defaultConfigDir(), 'aiv_templates.json')
    ];
    const templatePath = candidates.find(candidate => fs.existsSync(candidate));
    if (!templatePath) throw new Error('Native AIV building templates are missing.');
    aivTemplatesCache = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  }
  return aivTemplatesCache;
}

async function readAivDocument(filePath) {
  const codec = await aivCodecPromise;
  const sourceBytes = fs.readFileSync(filePath);
  const document = codec.parseAiv(sourceBytes);
  return { document, path: filePath, source: 'aiv', sourceBytes: transferableBytes(sourceBytes) };
}

function asCastleDocument(value) {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('The castle document is invalid.');
  }
  return document;
}

// Welche Bauschritte gesperrt sind, passt in keine AIV-Datei - das Format
// kennt kein solches Feld. Es liegt deshalb daneben, in <burg>.aiv.locks.json.
// Wer die Burg ohne diese Datei weitergibt, verliert nur die Sperren; die
// Burg selbst bleibt heil, und das Spiel sieht die Datei nie.
function lockSidecarPath(aivPath) { return aivPath + '.locks.json'; }

function writeLockSidecar(aivPath, locks) {
  const datei = lockSidecarPath(aivPath);
  const liste = Array.isArray(locks) ? locks.filter(n => Number.isInteger(n) && n >= 0) : [];
  try {
    // Keine Sperren, keine Datei: eine leere Begleitdatei waere Muell, der
    // beim naechsten Weitergeben Fragen aufwirft.
    if (!liste.length) { if (fs.existsSync(datei)) fs.unlinkSync(datei); return; }
    atomicWriteFile(datei, JSON.stringify({
      zweck: 'Gesperrte Bauschritte der Burg daneben. Nur fuer das AI Toolkit, das Spiel liest das nicht.',
      datei: path.basename(aivPath),
      geschrieben: new Date().toISOString(),
      gesperrt: liste
    }, null, 1), 'utf8');
  } catch (error) {
    console.warn('Sperren konnten nicht abgelegt werden:', error.message);
  }
}

function readLockSidecar(aivPath) {
  try {
    const datei = lockSidecarPath(aivPath);
    if (!fs.existsSync(datei)) return [];
    const gelesen = JSON.parse(fs.readFileSync(datei, 'utf8'));
    const liste = Array.isArray(gelesen && gelesen.gesperrt) ? gelesen.gesperrt : [];
    return liste.filter(n => Number.isInteger(n) && n >= 0);
  } catch { return []; }
}

async function writeAivDocument(document, destination, { sourcePath = null, sourceBytes = null, unchanged = false, locks = null } = {}) {
  const codec = await aivCodecPromise;
  const inputDocument = asCastleDocument(document);
  return writeNativeAiv({
    codec,
    document: inputDocument,
    destination,
    templates: aivTemplates(),
    atomicWriteFile,
    sourcePath,
    sourceBytes,
    unchanged
  }).then(ergebnis => {
    if (locks !== null) writeLockSidecar(destination, locks);
    return ergebnis;
  });
}

function placeholderPortrait(size) {
  return placeholderPortraitPng(size);
}

function ensureRuntimeFiles() {
  const configDir = runtimeConfigDir();
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const defaults = defaultConfigDir();
  if (fs.existsSync(defaults)) {
    for (const file of fs.readdirSync(defaults)) {
      const source = path.join(defaults, file);
      const target = path.join(configDir, file);
      if (!fs.existsSync(target) && fs.statSync(source).isFile()) {
        fs.copyFileSync(source, target);
      }
    }
  }

  if (!fs.existsSync(skinDir())) fs.mkdirSync(skinDir(), { recursive: true });
}

function createWindow() {
  const options = {
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#101416',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) options.icon = iconPath;

  const win = new BrowserWindow(options);
  win.__activeWorkspace = 'ucp';
  win.__closeApproved = false;
  win.__closeProtectionReady = false;
  win.on('close', event => {
    if (win.__closeApproved || !win.__closeProtectionReady || win.webContents.isDestroyed()) return;
    event.preventDefault();
    win.webContents.send('request-window-close');
  });
  win.webContents.once('did-finish-load', () => { win.__closeProtectionReady = true; });
  win.webContents.once('render-process-gone', () => { win.__closeApproved = true; });
  win.on('focus', () => installApplicationMenu(win.__activeWorkspace));
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

function sendToFocused(channel, payload) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel, payload);
}

const WORKSPACES = new Set(['ucp', 'character', 'castle', 'content']);

function fileMenuForWorkspace(workspace) {
  const documentLabel = workspace === 'castle' ? 'Castle' : workspace === 'character' ? 'Character' : '';
  return [
    { label: 'Add Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendToFocused('trigger-new-window') },
    { type: 'separator' },
    {
      label: documentLabel ? `New ${documentLabel}` : 'New',
      accelerator: 'CmdOrCtrl+N',
      enabled: Boolean(documentLabel),
      click: () => sendToFocused('trigger-new-document')
    },
    { label: 'Load', accelerator: 'CmdOrCtrl+O', click: () => sendToFocused('trigger-load') },
    { label: 'Load In New Window', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendToFocused('trigger-load-in-window') },
    { type: 'separator' },
    { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendToFocused('trigger-save') },
    { label: 'Save As', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToFocused('trigger-save-as') }
  ];
}

function editMenuForWorkspace(workspace) {
  const items = [
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendToFocused('trigger-undo') },
    { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => sendToFocused('trigger-redo') }
  ];
  if (workspace === 'character') {
    items.push(
      { type: 'separator' },
      { label: 'Toggle AI OxTethers', accelerator: 'CmdOrCtrl+T', click: () => sendToFocused('trigger-toggle-ox') },
      { label: 'Toggle Running Units', accelerator: 'CmdOrCtrl+U', click: () => sendToFocused('trigger-toggle-running') },
      { type: 'separator' },
      { label: 'Apply Standard Order', accelerator: 'CmdOrCtrl+Shift+1', click: () => sendToFocused('trigger-set-standard-order') },
      { label: 'Apply Ordered Order', accelerator: 'CmdOrCtrl+Shift+2', click: () => sendToFocused('trigger-set-ordered-order') },
      { type: 'separator' },
      { label: 'Expand All/Collapse All', accelerator: 'CmdOrCtrl+Tab', click: () => sendToFocused('trigger-toggle-section') }
    );
  } else if (workspace === 'castle') {
    items.push(
      { type: 'separator' },
      { label: 'Delete Selected', accelerator: 'Delete', click: () => sendToFocused('trigger-delete-selected') },
      { type: 'separator' },
      { label: 'Load/Replace Background…', click: () => sendToFocused('trigger-load-castle-background') },
      { label: 'Clear Background', click: () => sendToFocused('trigger-clear-castle-background') },
      { label: 'Edit Castle Mapping…', click: () => sendToFocused('trigger-edit-castle-mapping') },
      { type: 'separator' },
      { label: 'Customize Castle Shortcuts…', click: () => sendToFocused('trigger-customize-castle-shortcuts') }
    );
  }
  return items;
}

function menuTemplateForWorkspace(workspace = 'ucp') {
  return [
    { label: 'File', submenu: fileMenuForWorkspace(workspace) },
    {
      label: 'Workspace',
      submenu: [
        { label: 'UCP AI Library', accelerator: 'CmdOrCtrl+1', click: () => sendToFocused('trigger-workspace', 'ucp') },
        { label: 'Character', accelerator: 'CmdOrCtrl+2', click: () => sendToFocused('trigger-workspace', 'character') },
        { label: 'Castle', accelerator: 'CmdOrCtrl+3', click: () => sendToFocused('trigger-workspace', 'castle') },
        { label: 'AI Content', accelerator: 'CmdOrCtrl+4', click: () => sendToFocused('trigger-workspace', 'content') }
      ]
    },
    { label: 'Edit', submenu: editMenuForWorkspace(workspace) },
    { role: 'viewMenu' }
  ];
}

function installApplicationMenu(workspace = 'ucp') {
  const selected = WORKSPACES.has(workspace) ? workspace : 'ucp';
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplateForWorkspace(selected)));
}

ipcMain.on('set-active-workspace', (event, workspace) => {
  if (!WORKSPACES.has(workspace)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.__activeWorkspace = workspace;
  if (BrowserWindow.getFocusedWindow() === win) installApplicationMenu(workspace);
});

app.whenReady().then(() => {
  ensureRuntimeFiles();
  installApplicationMenu('ucp');
  createWindow();

  globalShortcut.register('CommandOrControl+=', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.handle('openNewWindow', () => createWindow());

ipcMain.handle('confirm-unsaved', async (event, { documentName = 'document', action = 'continue' } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Unsaved changes',
    message: `${documentName} has unsaved changes.`,
    detail: `Save your changes before ${action}?`,
    buttons: ['Save', 'Discard', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return ['save', 'discard', 'cancel'][result.response] || 'cancel';
});

ipcMain.on('confirm-window-close', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  win.__closeApproved = true;
  win.close();
});

ipcMain.handle('open-file', async (_event, kind = 'json') => {
  const filters = kind === 'aiv'
    ? [{ name: 'Stronghold AIV Castle', extensions: ['aiv', 'aivjson'] }]
    : [{ name: 'JSON', extensions: ['json'] }];
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  if (kind === 'aiv') {
    if (path.extname(filePath).toLowerCase() === '.aiv') {
      const gelesen = await readAivDocument(filePath);
      return Object.assign({}, gelesen, { locks: readLockSidecar(filePath) });
    }
    return { document: JSON.parse(fs.readFileSync(filePath, 'utf8')), path: filePath, source: 'aivjson' };
  }
  return { content: fs.readFileSync(filePath, 'utf-8'), path: filePath };
});

ipcMain.handle('save-file', async (_event, {
  content,
  kind = 'json',
  defaultPath = undefined,
  sourcePath = null,
  sourceBytes = null,
  unchanged = false,
  locks = null
} = {}) => {
  const filters = kind === 'aiv'
    ? [{ name: 'Stronghold AIV Castle', extensions: ['aiv'] }]
    : [{ name: 'JSON', extensions: ['json'] }];
  const result = await dialog.showSaveDialog({ filters, defaultPath });
  if (result.canceled || !result.filePath) return null;
  if (kind === 'aiv') {
    const filePath = result.filePath.toLowerCase().endsWith('.aiv') ? result.filePath : `${result.filePath}.aiv`;
    return writeAivDocument(content, filePath, { sourcePath, sourceBytes, unchanged, locks });
  }
  atomicWriteFile(result.filePath, content, 'utf8');
  return result.filePath;
});

ipcMain.handle('quick-save-file', async (_event, { path: filePath, content, kind = 'json', sourcePath = null, sourceBytes = null, unchanged = false, locks = null }) => {
  if (kind === 'aiv') return writeAivDocument(content, filePath, { sourcePath, sourceBytes, unchanged, locks });
  atomicWriteFile(filePath, content, 'utf8');
  return filePath;
});

ipcMain.handle('get-ucp-installation', () => savedUcpInstallation());

ipcMain.handle('choose-ucp-installation', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose the Stronghold Crusader installation',
    defaultPath: savedUcpInstallation() || undefined,
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const gameRoot = normalizeInstallationPath(result.filePaths[0]);
  writeSettings({ ...readSettings(), ucpInstallation: gameRoot });
  return gameRoot;
});

ipcMain.handle('choose-castle-background', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: 'Choose temporary castle background',
    properties: ['openFile'],
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  const mimeType = mimeTypes[path.extname(filePath).toLowerCase()];
  if (!mimeType) throw new Error('Choose a PNG, JPG, WebP, or BMP image.');
  if (fs.statSync(filePath).size > 128 * 1024 * 1024) {
    throw new Error('The selected background image is too large (maximum 128 MB).');
  }
  return {
    fileName: path.basename(filePath),
    dataUrl: `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`
  };
});

// Die Karten des Spiels. Zwei Kanaele, gebaut wie choose-castle-background:
// erst die Liste (nur Namen und Pfade, das ist billig), dann auf Wunsch eine
// einzelne Karte als fertige data:-Adresse samt ihren Startplaetzen. Gelesen
// wird nur, was in der Liste steht - das Fenster kann darueber keine beliebige
// Datei holen.
ipcMain.handle('list-game-maps', () => listGameMaps(savedUcpInstallation()));

ipcMain.handle('load-game-map', (_event, filePath) => readGameMap(filePath, savedUcpInstallation()));

// Dieselbe Karte als echtes Gelaende. Das Bild ist rund 3 MB und wird darum
// nur auf Verlangen gemalt - die Vorschau liegt schon in der Karte, das
// Gelaende muss aus den gm-Dateien des Spiels zusammengesetzt werden.
// WELCHER Startplatz gilt, sagt das Fenster: es kennt auch den Fall
// "keine Startplaetze, Dorf in die Kartenmitte", und zwei Stellen, die das
// getrennt entscheiden, waeren zwei Stellen zum Auseinanderlaufen.
ipcMain.handle('load-map-terrain', (_event, request) =>
  readMapTerrain(request && request.path, savedUcpInstallation(), request && request.keep));

ipcMain.handle('scan-ucp-ai-library', (_event, gameRoot) => scanUcpInstallation(gameRoot));

ipcMain.handle('load-ucp-ai-project', (_event, request) => readAiProject({
  ...request,
  readAivDocument
}));

ipcMain.handle('update-ai-castle-mapping', (_event, request) => updateAiCastleMapping(request));

ipcMain.handle('clone-ucp-ai', (_event, request) => cloneAiToManagedPlugin(request));

ipcMain.handle('create-ucp-ai', (_event, request) => createManagedAi({
  ...request,
  characterContent: fs.readFileSync(path.join(defaultConfigDir(), 'template.json'), 'utf8'),
  portraitPng: placeholderPortrait(72),
  portraitSmallPng: placeholderPortrait(36),
  writeAivDocument
}));

ipcMain.handle('update-ucp-ai', (_event, request) => updateManagedAi({
  ...request,
  writeAivDocument
}));

ipcMain.handle('open-ucp-path', async (_event, { gameRoot, targetPath = null } = {}) => {
  const layout = installationLayout(gameRoot);
  const target = targetPath ? path.resolve(targetPath) : layout.pluginsRoot;
  if (!isWithin(layout.pluginsRoot, target)) throw new Error('Only folders inside ucp/plugins can be opened here.');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return target;
});

ipcMain.handle('choose-ai-portrait', async (event, { gameRoot, aiRoot, kind = 'portrait' } = {}) => {
  const layout = installationLayout(gameRoot);
  const root = path.resolve(aiRoot || '');
  if (!isWithin(layout.pluginsRoot, root)) throw new Error('The selected AI is outside ucp/plugins.');
  const small = kind === 'portraitSmall';
  const size = small ? 36 : 72;
  const fileName = small ? 'portrait_small.png' : 'portrait.png';
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: `Choose ${fileName}`,
    properties: ['openFile'],
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const source = nativeImage.createFromPath(result.filePaths[0]);
  if (source.isEmpty()) throw new Error('The selected image could not be opened.');
  const dimensions = source.getSize(1);
  const bitmap = source.toBitmap({ scaleFactor: 1 });
  const png = resizeBgraBitmapToPng(bitmap, dimensions.width, dimensions.height, size, size);
  const destination = path.join(root, fileName);
  atomicWriteFile(destination, png);
  return { path: destination, dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: size, height: size };
});

ipcMain.handle('load-ai-media-data', async (_event, request = {}) => {
  const media = resolveAiMediaEntry(request);
  if (media.kind !== 'speech') throw new Error('Bink video cannot be played inside the editor. Use Open externally.');
  if (!media.exists) throw new Error(`The mapped WAV file '${media.fileName}' is missing.`);
  if (media.size > 128 * 1024 * 1024) throw new Error('This WAV file is too large for in-editor playback. Use Open externally.');
  return {
    ...media,
    dataUrl: `data:audio/wav;base64,${fs.readFileSync(media.filePath).toString('base64')}`
  };
});

ipcMain.handle('replace-ai-media', async (event, request = {}) => {
  const media = resolveAiMediaEntry(request);
  const extension = media.kind === 'speech' ? 'wav' : 'bik';
  const label = media.kind === 'speech' ? 'WAV speech' : 'Bink video';
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: `Replace ${media.fileName}`,
    properties: ['openFile'],
    filters: [{ name: label, extensions: [extension] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const sourcePath = result.filePaths[0];
  if (path.extname(sourcePath).toLowerCase() !== `.${extension}`) {
    throw new Error(`Choose a .${extension} file.`);
  }
  atomicWriteFile(media.filePath, fs.readFileSync(sourcePath));
  return resolveAiMediaEntry(request);
});

ipcMain.handle('open-ai-media', async (_event, request = {}) => {
  const media = resolveAiMediaEntry(request);
  if (!media.exists) throw new Error(`The mapped file '${media.fileName}' is missing.`);
  const error = await shell.openPath(media.filePath);
  if (error) throw new Error(error);
  return media.filePath;
});

ipcMain.handle('load-config', async (_event, file) => {
  const safeName = path.basename(String(file));
  const filePath = path.join(runtimeConfigDir(), safeName);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
});

ipcMain.handle('load-file-in-new-window', async (_event, kind = 'json') => {
  const filters = kind === 'aiv'
    ? [{ name: 'Stronghold AIV Castle', extensions: ['aiv', 'aivjson'] }]
    : [{ name: 'JSON', extensions: ['json'] }];
  const result = await dialog.showOpenDialog({ filters, properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const payload = kind === 'aiv'
    ? (path.extname(filePath).toLowerCase() === '.aiv'
      ? await readAivDocument(filePath)
      : { document: JSON.parse(fs.readFileSync(filePath, 'utf8')), path: filePath, source: 'aivjson' })
    : { content: fs.readFileSync(filePath, 'utf-8'), path: filePath, kind };
  const win = createWindow();
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('load-file', { ...payload, kind });
  });
  return true;
});

ipcMain.handle('choose-aiv-skin', async (_event, itemType) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const destination = path.join(skinDir(), `${Number(itemType)}.png`);
  fs.copyFileSync(result.filePaths[0], destination);
  return imageFileToDataUrl(destination);
});

ipcMain.handle('remove-aiv-skin', async (_event, itemType) => {
  const target = path.join(skinDir(), `${Number(itemType)}.png`);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
});

ipcMain.handle('load-aiv-skins', async () => {
  const result = {};
  const customSkinTypes = [];
  // Bundled artwork is the default. Files in userData are loaded second and
  // therefore override a bundled image with the same item number.
  for (const directory of [bundledSkinDir(), skinDir()]) {
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory)) {
      if (!/^\d+\.png$/i.test(file)) continue;
      const key = path.basename(file, path.extname(file));
      result[key] = imageFileToDataUrl(path.join(directory, file));
      if (directory === skinDir()) customSkinTypes.push(key);
    }
  }
  return { skins: result, customSkinTypes };
});

ipcMain.handle('open-aiv-skins-folder', async () => {
  ensureRuntimeFiles();
  await shell.openPath(skinDir());
  return skinDir();
});

function imageFileToDataUrl(filePath) {
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/png;base64,${data}`;
}
