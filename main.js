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
  replaceAiCharacter,
  addAiCastle,
  updateAiCastleMapping,
  updateManagedAi,
  atomicWriteFile,
  isWithin
} = require('./src/node/ucp-library');
const { placeholderPortraitPng, resizeBgraBitmapToPng } = require('./src/node/pixel-image');
const { listGameMaps, readGameMap, readMapTerrain, readMapTiles, internals: mapInternals } = require('./src/node/game-map');
// 17 der 189 Karten haben keinen vorgebauten Bergfried - ihre Startplaetze
// stehen als eigener Marker in der Karte, siehe map-startplaces.js.
const { withStartPlaces } = require('./src/node/map-startplaces');
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

async function writeAivDocument(document, destination, { sourcePath = null, sourceBytes = null, unchanged = false } = {}) {
  const codec = await aivCodecPromise;
  const inputDocument = asCastleDocument(document);
  // writeNativeAiv ist SYNCHRON und gibt ein Ergebnis zurueck, kein Versprechen.
  // Hier stand einmal ein .then() daran - das warf "writeNativeAiv(...).then is
  // not a function", und Speichern wie Schnellspeichern gingen gar nicht mehr.
  const ergebnis = writeNativeAiv({
    codec,
    document: inputDocument,
    destination,
    templates: aivTemplates(),
    atomicWriteFile,
    sourcePath,
    sourceBytes,
    unchanged
  });
  return ergebnis;
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

function createWindow({ restoreProject = false } = {}) {
  const options = {
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#101416',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#101416', symbolColor: '#e8eceb', height: 42 }
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  if (fs.existsSync(iconPath)) options.icon = iconPath;

  const win = new BrowserWindow(options);
  win.__integratedTitlebar = process.platform === 'win32';
  if (win.__integratedTitlebar) {
    win.setAutoHideMenuBar(false);
    win.setMenuBarVisibility(false);
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.control || input.meta) return;
      const key = input.key.toLowerCase();
      const menu = input.alt && !input.shift ? { f: 'file', e: 'edit', v: 'view' }[key] : null;
      if (menu || (key === 'f10' && !input.shift && !input.alt)) {
        event.preventDefault();
        win.webContents.send('focus-titlebar-menu', { menu: menu || 'file', open: Boolean(menu) });
      }
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => (
    url === 'about:blank' ? { action: 'allow' } : { action: 'deny' }
  ));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('did-create-window', child => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (event, url) => {
      if (url !== 'about:blank') event.preventDefault();
    });
  });
  win.__activeWorkspace = 'ucp';
  win.__castleOverviewPreferences = defaultCastleOverviewPreferences();
  win.__closeApproved = false;
  win.__closeProtectionReady = false;
  win.on('close', event => {
    if (win.__closeApproved || !win.__closeProtectionReady || win.webContents.isDestroyed()) return;
    event.preventDefault();
    win.webContents.send('request-window-close');
  });
  win.webContents.once('did-finish-load', () => { win.__closeProtectionReady = true; });
  win.webContents.once('render-process-gone', () => { win.__closeApproved = true; });
  win.on('focus', () => installApplicationMenu(win.__activeWorkspace, win));
  win.loadFile(path.join(__dirname, 'src', 'index.html'), { query: { restoreProject: restoreProject ? '1' : '0' } });
  return win;
}

function sendToFocused(channel, payload) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel, payload);
}

const WORKSPACES = new Set(['ucp', 'character', 'castle', 'content']);

function defaultCastleOverviewPreferences() {
  return {
    population: { visible: true, side: 'left' },
    costs: { visible: true, side: 'left' }
  };
}

function sanitizeCastleOverviewPreferences(value) {
  const defaults = defaultCastleOverviewPreferences();
  for (const key of Object.keys(defaults)) {
    const candidate = value && value[key];
    if (!candidate || typeof candidate !== 'object') continue;
    defaults[key].visible = candidate.visible !== false;
    defaults[key].side = candidate.side === 'right' ? 'right' : 'left';
  }
  return defaults;
}

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

function editMenuForWorkspace(workspace, overviewPreferences = defaultCastleOverviewPreferences()) {
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
    const overview = sanitizeCastleOverviewPreferences(overviewPreferences);
    const overviewCommand = (panel, property, value) => () => {
      sendToFocused('trigger-castle-overview', { panel, property, value });
    };
    items.push(
      { type: 'separator' },
      { label: 'Delete Selected', accelerator: 'Delete', click: () => sendToFocused('trigger-delete-selected') },
      {
        label: 'Castle Overviews',
        submenu: [
          { label: 'Show Population', type: 'checkbox', checked: overview.population.visible, click: item => overviewCommand('population', 'visible', item.checked)() },
          { label: 'Show Castle Costs', type: 'checkbox', checked: overview.costs.visible, click: item => overviewCommand('costs', 'visible', item.checked)() },
          { type: 'separator' },
          {
            label: 'Population Side',
            submenu: [
              { label: 'Left', type: 'radio', checked: overview.population.side === 'left', click: overviewCommand('population', 'side', 'left') },
              { label: 'Right', type: 'radio', checked: overview.population.side === 'right', click: overviewCommand('population', 'side', 'right') }
            ]
          },
          {
            label: 'Castle Costs Side',
            submenu: [
              { label: 'Left', type: 'radio', checked: overview.costs.side === 'left', click: overviewCommand('costs', 'side', 'left') },
              { label: 'Right', type: 'radio', checked: overview.costs.side === 'right', click: overviewCommand('costs', 'side', 'right') }
            ]
          }
        ]
      },
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

function menuTemplateForWorkspace(workspace = 'ucp', overviewPreferences = defaultCastleOverviewPreferences()) {
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
    { label: 'Edit', submenu: editMenuForWorkspace(workspace, overviewPreferences) },
    { role: 'viewMenu' }
  ];
}

function installApplicationMenu(workspace = 'ucp', win = BrowserWindow.getFocusedWindow()) {
  const selected = WORKSPACES.has(workspace) ? workspace : 'ucp';
  const overview = win && win.__castleOverviewPreferences
    ? win.__castleOverviewPreferences
    : defaultCastleOverviewPreferences();
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplateForWorkspace(selected, overview)));
  // Keep native accelerators registered without restoring a second menu row.
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.__integratedTitlebar) window.setMenuBarVisibility(false);
  }
}

ipcMain.handle('get-window-chrome', event => ({
  integrated: Boolean(BrowserWindow.fromWebContents(event.sender)?.__integratedTitlebar)
}));

ipcMain.handle('show-titlebar-menu', (event, request) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win?.__integratedTitlebar || event.senderFrame !== event.sender.mainFrame) return;
  const index = { file: 0, edit: 2, view: 3 }[request?.menu];
  if (!Number.isInteger(index) || !Number.isFinite(request?.x) || !Number.isFinite(request?.y)) return;
  const menu = Menu.buildFromTemplate(menuTemplateForWorkspace(win.__activeWorkspace, win.__castleOverviewPreferences));
  const popup = menu.items[index]?.submenu;
  if (!popup) return;
  const [width, height] = win.getContentSize();
  const zoom = win.webContents.getZoomFactor();
  return new Promise(resolve => popup.popup({
    window: win,
    x: Math.round(Math.max(0, Math.min(width - 1, request.x * zoom))),
    y: Math.round(Math.max(0, Math.min(height - 1, request.y * zoom))),
    callback: () => resolve(true)
  }));
});

ipcMain.on('set-active-workspace', (event, workspace) => {
  if (!WORKSPACES.has(workspace)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.__activeWorkspace = workspace;
  if (BrowserWindow.getFocusedWindow() === win) installApplicationMenu(workspace, win);
});

ipcMain.on('set-castle-overview-preferences', (event, preferences) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.__castleOverviewPreferences = sanitizeCastleOverviewPreferences(preferences);
  if (BrowserWindow.getFocusedWindow() === win && win.__activeWorkspace === 'castle') {
    installApplicationMenu('castle', win);
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('de.schlossgespenst.aitoolkit');
  ensureRuntimeFiles();
  installApplicationMenu('ucp');
  createWindow({ restoreProject: true });

  globalShortcut.register('CommandOrControl+=', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ restoreProject: true });
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

ipcMain.handle('choose-ai-document-action', async (event, {
  kind = 'character',
  operation = 'open',
  aiName = 'the loaded AI'
} = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const isCastle = kind === 'castle';
  const creating = operation === 'new';
  const documentName = isCastle ? 'castle' : 'Character';
  const result = await dialog.showMessageBox(win, {
    type: isCastle ? 'question' : 'warning',
    title: `Add ${documentName} to ${aiName}?`,
    message: `${creating ? 'Create' : 'Open'} this ${documentName} as part of ${aiName}?`,
    detail: isCastle
      ? `Add to AI copies the castle into ${aiName}'s aiv folder and keeps the AI project open. Edit separately leaves the AI project and saves the castle wherever you choose.`
      : `Add to AI replaces ${aiName}'s current character.json. The old Character file will be permanently lost. Edit separately leaves the AI project and saves this Character wherever you choose.`,
    buttons: ['Add to AI', 'Edit separately', 'Cancel'],
    defaultId: 1,
    cancelId: 2,
    noLink: true
  });
  return ['project', 'separate', 'cancel'][result.response] || 'cancel';
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
      return readAivDocument(filePath);
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
  unchanged = false
} = {}) => {
  const filters = kind === 'aiv'
    ? [{ name: 'Stronghold AIV Castle', extensions: ['aiv'] }]
    : [{ name: 'JSON', extensions: ['json'] }];
  const result = await dialog.showSaveDialog({ filters, defaultPath });
  if (result.canceled || !result.filePath) return null;
  if (kind === 'aiv') {
    const filePath = result.filePath.toLowerCase().endsWith('.aiv') ? result.filePath : `${result.filePath}.aiv`;
    return writeAivDocument(content, filePath, { sourcePath, sourceBytes, unchanged });
  }
  atomicWriteFile(result.filePath, content, 'utf8');
  return result.filePath;
});

ipcMain.handle('quick-save-file', async (_event, { path: filePath, content, kind = 'json', sourcePath = null, sourceBytes = null, unchanged = false }) => {
  if (kind === 'aiv') return writeAivDocument(content, filePath, { sourcePath, sourceBytes, unchanged });
  atomicWriteFile(filePath, content, 'utf8');
  return filePath;
});

ipcMain.handle('get-ucp-installation', () => savedUcpInstallation());
ipcMain.handle('read-installed-balance', () => require('./src/node/castle-balance').readInstalledBalance(savedUcpInstallation()));

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

ipcMain.handle('load-game-map', (_event, filePath) =>
  withStartPlaces(readGameMap(filePath, savedUcpInstallation()), mapInternals));

// Dieselbe Karte als echtes Gelaende. Das Bild ist rund 3 MB und wird darum
// nur auf Verlangen gemalt - die Vorschau liegt schon in der Karte, das
// Gelaende muss aus den gm-Dateien des Spiels zusammengesetzt werden.
// WELCHER Startplatz gilt, sagt das Fenster: es kennt auch den Fall
// "keine Startplaetze, Dorf in die Kartenmitte", und zwei Stellen, die das
// getrennt entscheiden, waeren zwei Stellen zum Auseinanderlaufen.
// Die ganze Karte als Kachelvorrat - kein fertiges Bild, sondern das, was
// die Ansicht braucht, um selbst zu malen (siehe readMapTiles).
ipcMain.handle('load-map-tiles', (_event, filePath) => readMapTiles(filePath, savedUcpInstallation()));
ipcMain.handle('load-map-terrain', (_event, request) =>
  readMapTerrain(request && request.path, savedUcpInstallation(), request && request.keep));

ipcMain.handle('scan-ucp-ai-library', (_event, gameRoot) => scanUcpInstallation(gameRoot));

ipcMain.handle('load-ucp-ai-project', (_event, request) => readAiProject({
  ...request,
  readAivDocument
}));

ipcMain.handle('add-ai-document', async (event, request = {}) => {
  if (request.kind === 'character') {
    return replaceAiCharacter(request);
  }
  if (request.kind !== 'castle') throw new Error('Only Character and castle files can be added to an AI.');

  const layout = installationLayout(request.gameRoot);
  const root = path.resolve(String(request.aiRoot || ''));
  if (!isWithin(layout.pluginsRoot, root)) throw new Error('The selected AI is outside ucp/plugins.');
  const aivRoot = path.join(root, 'aiv');
  let fileName = '';

  if (request.suggestedFileName || request.sourcePath) {
    const sourceName = path.basename(String(request.suggestedFileName || request.sourcePath));
    fileName = sourceName.replace(/\.aivjson$/i, '.aiv');
    if (!/\.aiv$/i.test(fileName)) throw new Error('The selected castle does not have an AIV filename.');
  } else {
    fs.mkdirSync(aivRoot, { recursive: true });
    const win = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showSaveDialog(win, {
      title: 'Name the castle in the loaded AI',
      defaultPath: path.join(aivRoot, 'New Castle.aiv'),
      filters: [{ name: 'Stronghold AIV Castle', extensions: ['aiv'] }]
    });
    if (selection.canceled || !selection.filePath) return null;
    const selectedPath = selection.filePath.toLowerCase().endsWith('.aiv')
      ? selection.filePath
      : `${selection.filePath}.aiv`;
    if (path.resolve(path.dirname(selectedPath)).toLowerCase() !== path.resolve(aivRoot).toLowerCase()) {
      throw new Error(`Choose a filename directly inside ${aivRoot}.`);
    }
    fileName = path.basename(selectedPath);
  }

  const destination = path.join(aivRoot, fileName);
  const sameFile = request.sourcePath &&
    path.resolve(request.sourcePath).toLowerCase() === path.resolve(destination).toLowerCase();
  if (fs.existsSync(destination) && !sameFile) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Replace castle file?',
      message: `${fileName} already exists in this AI.`,
      detail: 'Replacing it permanently removes the existing castle file.',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return null;
  }

  return addAiCastle({
    ...request,
    fileName,
    overwrite: true,
    writeAivDocument
  });
});

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
