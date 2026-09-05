(() => {
  const callbacks = {};
  const cloneRoot = 'C:\\Mock Crusader\\ucp\\plugins\\aiv-mod-editor-local-1.0.0\\resources\\ai\\jeanne-custom';
  let cloned = false;

  function aiRecord(owned = false) {
    const rootPath = owned ? cloneRoot : 'C:\\Mock Crusader\\ucp\\plugins\\sample-pack-1.0.0\\resources\\ai\\jeanne';
    return {
      key: `${owned ? 'aiv-mod-editor-local' : 'sample-pack'}:jeanne:${rootPath.replaceAll('\\', '/')}`,
      id: owned ? 'jeanne-custom' : 'jeanne',
      folderName: owned ? 'jeanne-custom' : 'Jeanne',
      rootPath,
      name: owned ? "Jeanne d'Arc (Custom)" : "Jeanne d'Arc",
      author: 'Schlossgespenst',
      version: '1.0.0',
      description: 'de Orléans',
      defaultLang: 'de',
      supportedLang: ['de', 'en'],
      characterPath: `${rootPath}\\character.json`,
      characterExists: true,
      linesPath: `${rootPath}\\lines.json`,
      linesExists: true,
      mappingPath: `${rootPath}\\aiv\\mapping.json`,
      mappingExists: true,
      portraitDataUrl: '../examples/Jeanne/portrait.png',
      portraitSmallPath: `${rootPath}\\portrait_small.png`,
      portraitSmallDataUrl: '../examples/Jeanne/portrait_small.png',
      active: !owned,
      owned,
      plugin: {
        name: owned ? 'aiv-mod-editor-local' : 'sample-pack',
        displayName: owned ? 'AI Toolkit - My AIs' : 'Sample AI Pack',
        version: '1.0.0',
        rootPath: rootPath.split('\\resources\\ai')[0],
        active: !owned,
        owned
      },
      castles: [1, 2, 3].map(slot => ({
        slot,
        fileName: `jeanne${slot}.aiv`,
        filePath: `${rootPath}\\aiv\\jeanne${slot}.aiv`,
        exists: true,
        jsonPath: `${rootPath}\\aiv\\jeanne${slot}.aivjson`,
        jsonExists: true,
        valid: true
      })),
      diagnostics: []
    };
  }

  async function loadJson(relativePath) {
    const response = await fetch(relativePath);
    if (!response.ok) throw new Error(`Mock file failed: ${relativePath}`);
    return response.text();
  }

  window.electronAPI = {
    loadConfig: async file => JSON.parse(await loadJson(`../config/${file}`)),
    openFile: async () => null,
    saveFile: async () => null,
    quickSaveFile: async request => request.path,
    openNewWindow: async () => null,
    loadFileInNewWindow: async () => null,
    chooseAivSkin: async () => null,
    removeAivSkin: async () => true,
    loadAivSkins: async () => ({ skins: {}, customSkinTypes: [] }),
    openAivSkinsFolder: async () => null,
    confirmUnsaved: async () => 'discard',
    confirmWindowClose: () => {},
    getUcpInstallation: async () => 'C:\\Mock Crusader',
    chooseUcpInstallation: async () => 'C:\\Mock Crusader',
    scanUcpAiLibrary: async () => ({
      gameRoot: 'C:\\Mock Crusader',
      pluginsRoot: 'C:\\Mock Crusader\\ucp\\plugins',
      configExists: true,
      activeExtensions: ['sample-pack'],
      plugins: [],
      ais: cloned ? [aiRecord(false), aiRecord(true)] : [aiRecord(false)],
      diagnostics: [],
      managedPlugin: cloned ? aiRecord(true).plugin : null
    }),
    loadUcpAiProject: async request => ({
      aiRoot: request.aiRoot,
      owned: request.aiRoot === cloneRoot,
      character: {
        path: `${request.aiRoot}\\character.json`,
        content: await loadJson('../examples/Jeanne/character.json')
      },
      lines: {
        path: `${request.aiRoot}\\lines.json`,
        exists: true,
        content: await loadJson('../examples/Jeanne/lines.json')
      },
      portraits: {
        portrait: { path: `${request.aiRoot}\\portrait.png`, exists: true, dataUrl: '../examples/Jeanne/portrait.png' },
        portraitSmall: { path: `${request.aiRoot}\\portrait_small.png`, exists: true, dataUrl: '../examples/Jeanne/portrait_small.png' }
      },
      media: {
        speech: [{
          kind: 'speech',
          mappingPath: `${request.aiRoot}\\speech\\mapping.json`,
          mappingRelativePath: 'speech/mapping.json',
          group: 'speech',
          fileName: 'je_taunt_01.wav',
          filePath: `${request.aiRoot}\\speech\\je_taunt_01.wav`,
          exists: true,
          size: 2048,
          keys: ['taunt_1']
        }],
        binks: [{
          kind: 'binks',
          mappingPath: `${request.aiRoot}\\binks\\mapping.json`,
          mappingRelativePath: 'binks/mapping.json',
          group: 'binks',
          fileName: 'philip_natural.bik',
          filePath: `${request.aiRoot}\\binks\\philip_natural.bik`,
          exists: true,
          size: 4096,
          keys: ['taunt_1', 'taunt_2']
        }],
        diagnostics: []
      },
      castle: request.castleFile ? {
        path: `${request.aiRoot}\\aiv\\${request.castleFile}`,
        fileName: request.castleFile,
        document: JSON.parse(await loadJson(`../examples/Jeanne/aiv/${request.castleFile}json`)),
        source: 'aiv'
      } : null
    }),
    updateAiCastleMapping: async request => {
      const ai = aiRecord(request.aiRoot === cloneRoot);
      ai.castles = request.slots
        .map((fileName, index) => fileName ? ({
          slot: index + 1,
          fileName,
          filePath: `${request.aiRoot}\\aiv\\${fileName}`,
          exists: true,
          jsonPath: `${request.aiRoot}\\aiv\\${fileName}json`,
          jsonExists: false,
          valid: true
        }) : null)
        .filter(Boolean);
      return ai;
    },
    cloneUcpAi: async request => {
      cloned = true;
      const clone = aiRecord(true);
      clone.id = request.aiId;
      clone.name = request.name;
      return clone;
    },
    createUcpAi: async request => {
      cloned = true;
      const created = aiRecord(true);
      created.id = request.aiId;
      created.folderName = request.aiId;
      created.name = request.name;
      created.author = request.author;
      created.version = request.version;
      return created;
    },
    chooseAiPortrait: async request => {
      const small = request.kind === 'portraitSmall';
      const size = small ? 36 : 72;
      return {
        path: `${request.aiRoot}\\${small ? 'portrait_small.png' : 'portrait.png'}`,
        dataUrl: small ? '../examples/Jeanne/portrait_small.png' : '../examples/Jeanne/portrait.png',
        width: size,
        height: size
      };
    },
    loadAiMediaData: async request => ({ ...request, dataUrl: 'data:audio/wav;base64,UklGRg==' }),
    replaceAiMedia: async request => ({
      ...request,
      mappingPath: `${request.aiRoot}\\${request.mappingRelativePath.replaceAll('/', '\\')}`,
      group: request.kind,
      filePath: `${request.aiRoot}\\${request.kind}\\${request.fileName}`,
      exists: true,
      size: 8192,
      keys: ['taunt_1']
    }),
    openAiMedia: async request => `${request.aiRoot}\\${request.kind}\\${request.fileName}`,
    updateUcpAi: async () => aiRecord(true),
    openUcpPath: async request => request.targetPath,
    setActiveWorkspace: workspace => { callbacks.activeWorkspace = workspace; },
    onLoadFile: callback => { callbacks.loadFile = callback; },
    onTriggerLoad: callback => { callbacks.load = callback; },
    onTriggerNewDocument: callback => { callbacks.newDocument = callback; },
    onTriggerSave: callback => { callbacks.save = callback; },
    onTriggerSaveAs: callback => { callbacks.saveAs = callback; },
    onTriggerNewWindow: callback => { callbacks.newWindow = callback; },
    onTriggerLoadInWindow: callback => { callbacks.loadInWindow = callback; },
    onTriggerToggleOx: callback => { callbacks.toggleOx = callback; },
    onTriggerToggleRunning: callback => { callbacks.toggleRunning = callback; },
    onTriggerStandardOrder: callback => { callbacks.standardOrder = callback; },
    onTriggerOrderedOrder: callback => { callbacks.orderedOrder = callback; },
    onTriggerToggleSections: callback => { callbacks.toggleSections = callback; },
    onTriggerWorkspace: callback => { callbacks.workspace = callback; },
    onTriggerUndo: callback => { callbacks.undo = callback; },
    onTriggerRedo: callback => { callbacks.redo = callback; },
    onTriggerDeleteSelected: callback => { callbacks.deleteSelected = callback; },
    onTriggerLoadCastleBackground: callback => { callbacks.loadCastleBackground = callback; },
    onTriggerClearCastleBackground: callback => { callbacks.clearCastleBackground = callback; },
    onTriggerEditCastleMapping: callback => { callbacks.editCastleMapping = callback; },
    onTriggerCustomizeCastleShortcuts: callback => { callbacks.customizeCastleShortcuts = callback; },
    onRequestWindowClose: callback => { callbacks.close = callback; }
  };
})();
