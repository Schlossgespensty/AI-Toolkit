const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MANAGED_PLUGIN,
  normalizeInstallationPath,
  compareVersions,
  scanUcpInstallation,
  cloneAiToManagedPlugin,
  createManagedAi,
  defaultLines,
  readAiProject,
  readAiMedia,
  resolveAiMediaEntry,
  replaceAiCharacter,
  addAiCastle,
  updateAiCastleMapping,
  updateManagedAi,
  replaceDirectoryTransaction,
  sanitizeAiId
} = require('../src/node/ucp-library');

function makeFixture() {
  const gameRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-ucp-library-'));
  const pluginsRoot = path.join(gameRoot, 'ucp', 'plugins');
  const pluginRoot = path.join(pluginsRoot, 'sample-pack-2.0.0');
  const aiRoot = path.join(pluginRoot, 'resources', 'ai', 'sample-ai');
  fs.mkdirSync(path.join(aiRoot, 'aiv'), { recursive: true });
  fs.mkdirSync(path.join(aiRoot, 'speech'), { recursive: true });
  fs.mkdirSync(path.join(aiRoot, 'binks'), { recursive: true });
  fs.mkdirSync(path.join(aiRoot, 'lang', 'de', 'speech'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'definition.yml'), [
    'name: sample-pack',
    'display-name: Sample AI Pack',
    'version: 2.0.0',
    'type: plugin',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(gameRoot, 'ucp-config.yml'), [
    'meta:',
    '  version: 1.0.0',
    'config-full:',
    '  load-order:',
    '    - extension: sample-pack',
    '      version: 2.0.0',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(aiRoot, 'meta.json'), JSON.stringify({
    name: 'Sample AI',
    author: 'Tester',
    version: '2.0.0',
    description: 'Fixture',
    defaultLang: 'en',
    supportedLang: ['en'],
    switched: { aic: true, aiv: true }
  }, null, 2));
  fs.writeFileSync(path.join(aiRoot, 'character.json'), JSON.stringify({ aic: { WallDecoration: 1 } }));
  fs.writeFileSync(path.join(aiRoot, 'lines.json'), JSON.stringify({ ai_name: 'Sample AI', taunt_1: 'Hello' }));
  fs.writeFileSync(path.join(aiRoot, 'portrait.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(aiRoot, 'portrait_small.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
  fs.writeFileSync(path.join(aiRoot, 'aiv', 'mapping.json'), JSON.stringify({ castle_1: 'sample1.aiv' }));
  fs.writeFileSync(path.join(aiRoot, 'aiv', 'sample1.aiv'), Buffer.from('original binary'));
  fs.writeFileSync(path.join(aiRoot, 'aiv', 'sample1.aivjson'), JSON.stringify({ frames: [], miscItems: [] }));
  fs.writeFileSync(path.join(aiRoot, 'speech', 'mapping.json'), JSON.stringify({ taunt_1: 'taunt.wav', taunt_2: 'taunt.wav', victory_1: 'victory.wav' }));
  fs.writeFileSync(path.join(aiRoot, 'speech', 'taunt.wav'), Buffer.from('RIFF fixture'));
  fs.writeFileSync(path.join(aiRoot, 'binks', 'mapping.json'), JSON.stringify({ taunt_1: 'face.bik', taunt_2: 'face.bik' }));
  fs.writeFileSync(path.join(aiRoot, 'binks', 'face.bik'), Buffer.from('BIK fixture'));
  fs.writeFileSync(path.join(aiRoot, 'lang', 'de', 'speech', 'mapping.json'), JSON.stringify({ taunt_1: 'taunt-de.wav' }));
  fs.writeFileSync(path.join(aiRoot, 'lang', 'de', 'speech', 'taunt-de.wav'), Buffer.from('RIFF de fixture'));
  return { gameRoot, pluginsRoot, pluginRoot, aiRoot };
}

test('normalizes game, ucp, and plugins folder selections', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  assert.equal(normalizeInstallationPath(fixture.gameRoot), fixture.gameRoot);
  assert.equal(normalizeInstallationPath(path.join(fixture.gameRoot, 'ucp')), fixture.gameRoot);
  assert.equal(normalizeInstallationPath(fixture.pluginsRoot), fixture.gameRoot);
});

test('scans installed AI packages and marks active plugins', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const library = scanUcpInstallation(fixture.gameRoot);
  assert.equal(library.ais.length, 1);
  assert.equal(library.ais[0].name, 'Sample AI');
  assert.equal(library.ais[0].plugin.displayName, 'Sample AI Pack');
  assert.equal(library.ais[0].active, true);
  assert.equal(library.ais[0].owned, false);
  assert.equal(library.ais[0].castles[0].fileName, 'sample1.aiv');
  assert.equal(library.ais[0].portraitDataUrl.startsWith('data:image/png;base64,'), true);
});

test('ignores older installed folders with the exact same plugin name', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const oldPluginRoot = path.join(fixture.pluginsRoot, 'sample-pack-1.9.9');
  const oldAiRoot = path.join(oldPluginRoot, 'resources', 'ai', 'outdated-ai');
  fs.mkdirSync(path.join(oldAiRoot, 'aiv'), { recursive: true });
  fs.writeFileSync(path.join(oldPluginRoot, 'definition.yml'), [
    'name: sample-pack',
    'display-name: Sample AI Pack (Old)',
    'version: 1.9.9',
    'type: plugin',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(oldAiRoot, 'meta.json'), JSON.stringify({ name: 'Outdated AI' }));
  fs.writeFileSync(path.join(oldAiRoot, 'character.json'), JSON.stringify({ aic: {} }));

  const library = scanUcpInstallation(fixture.gameRoot);
  assert.equal(library.plugins.length, 1);
  assert.equal(library.plugins[0].version, '2.0.0');
  assert.deepEqual(library.ais.map(ai => ai.name), ['Sample AI']);
});

test('compares numeric and prerelease plugin versions', () => {
  assert.equal(compareVersions('10.0.0', '2.9.9') > 0, true);
  assert.equal(compareVersions('2.0.0', '2.0.0-beta.3') > 0, true);
  assert.equal(compareVersions('2.0.0-beta.10', '2.0.0-beta.2') > 0, true);
});

test('clones a complete third-party AI into the editor-owned plugin', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const clone = await cloneAiToManagedPlugin({
    gameRoot: fixture.gameRoot,
    sourceAiRoot: fixture.aiRoot,
    aiId: 'sample-custom',
    name: 'Sample Custom',
    version: '1.0.0'
  });
  assert.equal(clone.owned, true);
  assert.equal(clone.name, 'Sample Custom');
  assert.equal(clone.id, 'sample-custom');
  const managedRoot = path.join(fixture.pluginsRoot, MANAGED_PLUGIN.folderName);
  assert.equal(fs.existsSync(path.join(managedRoot, 'definition.yml')), true);
  assert.equal(fs.existsSync(path.join(managedRoot, 'resources', 'ai', 'sample-custom', 'portrait.png')), true);
  assert.equal(fs.existsSync(path.join(managedRoot, 'resources', 'ai', 'sample-custom', 'aiv', 'sample1.aiv')), true);
  assert.equal(fs.readFileSync(path.join(managedRoot, 'definition.yml'), 'utf8').includes('type: plugin'), true);
});

test('creates a complete new AI in My AIs', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const portrait = Buffer.from('portrait-72');
  const portraitSmall = Buffer.from('portrait-36');
  const created = await createManagedAi({
    gameRoot: fixture.gameRoot,
    aiId: 'new-ai',
    name: 'New AI',
    author: 'Tester',
    version: '1.0.0',
    characterContent: JSON.stringify({ aic: { WallDecoration: 0 } }),
    portraitPng: portrait,
    portraitSmallPng: portraitSmall,
    writeAivDocument: async (document, destination) => {
      assert.deepEqual(document, {
        pauseDelayAmount: 100,
        frames: [{ itemType: 61, tilePositionOfsets: [5643], shouldPause: false }],
        miscItems: []
      });
      fs.writeFileSync(destination, Buffer.from('empty castle'));
      return { path: destination };
    }
  });

  assert.equal(created.owned, true);
  assert.equal(created.id, 'new-ai');
  assert.equal(created.name, 'New AI');
  assert.equal(fs.readFileSync(path.join(created.rootPath, 'portrait.png')).equals(portrait), true);
  assert.equal(fs.readFileSync(path.join(created.rootPath, 'portrait_small.png')).equals(portraitSmall), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(created.rootPath, 'aiv', 'mapping.json'), 'utf8')), { castle_1: 'castle1.aiv' });
  assert.equal(fs.readFileSync(path.join(created.rootPath, 'aiv', 'castle1.aiv'), 'utf8'), 'empty castle');
  const lines = JSON.parse(fs.readFileSync(path.join(created.rootPath, 'lines.json'), 'utf8'));
  assert.equal(lines.ai_name, 'New AI');
  assert.deepEqual(lines, defaultLines('New AI'));
});

test('loads binary AIV as the authoritative castle source', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  let loadedPath = null;
  const project = await readAiProject({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    castleFile: 'sample1.aiv',
    readAivDocument: async filePath => {
      loadedPath = filePath;
      return {
        document: { pauseDelayAmount: 100, frames: [], miscItems: [] },
        sourceBytes: Uint8Array.from([1, 2, 3])
      };
    }
  });
  assert.equal(loadedPath, path.join(fixture.aiRoot, 'aiv', 'sample1.aiv'));
  assert.equal(project.castle.source, 'aiv');
  assert.deepEqual(project.castle.sourceBytes, Uint8Array.from([1, 2, 3]));
  assert.deepEqual(project.castle.document.frames, []);
  assert.equal(project.owned, false);
  assert.equal(JSON.parse(project.lines.content).taunt_1, 'Hello');
  assert.equal(project.portraits.portraitSmall.exists, true);
  assert.equal(project.media.speech.length, 3);
  assert.equal(project.media.binks.length, 1);
  assert.deepEqual(project.media.speech.find(item => item.fileName === 'taunt.wav').keys, ['taunt_1', 'taunt_2']);
  assert.equal(project.media.speech.some(item => item.group === 'lang/de/speech'), true);
  assert.equal(project.media.speech.find(item => item.group === 'lang/de/speech').language, 'de');
  assert.equal(project.media.speech.find(item => item.group === 'speech').language, null);
});

test('updates all eight castle mapping slots and permits repeated castle files', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.aiRoot, 'aiv', 'sample2.aiv'), Buffer.from('second binary'));

  const updated = updateAiCastleMapping({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    slots: ['sample2.aiv', 'sample1.aiv', 'sample1.aiv', '', '', '', '', 'sample2.aiv']
  });
  assert.equal(updated.rootPath, fixture.aiRoot);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.aiRoot, 'aiv', 'mapping.json'), 'utf8')), {
    castle_1: 'sample2.aiv',
    castle_2: 'sample1.aiv',
    castle_3: 'sample1.aiv',
    castle_8: 'sample2.aiv'
  });
  assert.throws(() => updateAiCastleMapping({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    slots: ['missing.aiv']
  }), /does not exist/);
});

test('adds Character and castle files directly to the loaded AI project', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));

  const replacement = JSON.stringify({ aic: { WallDecoration: 7 } }, null, 2);
  const character = replaceAiCharacter({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    content: replacement
  });
  assert.equal(character.path, path.join(fixture.aiRoot, 'character.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(character.path, 'utf8')), JSON.parse(replacement));

  const castleDocument = { pauseDelayAmount: 100, frames: [], miscItems: [] };
  const savedBytes = Uint8Array.from([7, 8, 9]);
  const castle = await addAiCastle({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    fileName: 'imported.aiv',
    document: castleDocument,
    sourcePath: 'C:\\Castles\\imported.aiv',
    sourceBytes: Uint8Array.from([1, 2, 3]),
    writeAivDocument: async (document, destination, options) => {
      assert.deepEqual(document, castleDocument);
      assert.equal(destination, path.join(fixture.aiRoot, 'aiv', 'imported.aiv'));
      assert.equal(options.sourcePath, 'C:\\Castles\\imported.aiv');
      fs.writeFileSync(destination, Buffer.from('imported castle'));
      return { path: destination, sourceBytes: savedBytes };
    }
  });
  assert.equal(castle.fileName, 'imported.aiv');
  assert.deepEqual(castle.sourceBytes, savedBytes);
  assert.equal(fs.readFileSync(castle.path, 'utf8'), 'imported castle');
  assert.ok(scanUcpInstallation(fixture.gameRoot).ais[0].castles.some(item => item.fileName === 'imported.aiv'));
});

test('project imports reject invalid Character JSON and accidental castle overwrites', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const originalCharacter = fs.readFileSync(path.join(fixture.aiRoot, 'character.json'), 'utf8');

  assert.throws(() => replaceAiCharacter({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    content: '{broken'
  }), /JSON/);
  assert.equal(fs.readFileSync(path.join(fixture.aiRoot, 'character.json'), 'utf8'), originalCharacter);

  await assert.rejects(addAiCastle({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    fileName: 'sample1.aiv',
    document: { frames: [], miscItems: [] },
    writeAivDocument: async () => assert.fail('writer must not run before overwrite is approved')
  }), /already exists/);
});

test('resolves only mapped WAV and Bink files inside the selected AI', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const media = readAiMedia(fixture.aiRoot);
  assert.equal(media.diagnostics.length, 0);
  const speech = resolveAiMediaEntry({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    kind: 'speech',
    mappingRelativePath: 'speech/mapping.json',
    fileName: 'taunt.wav'
  });
  assert.equal(speech.exists, true);
  assert.equal(speech.size, Buffer.byteLength('RIFF fixture'));
  assert.deepEqual(speech.keys, ['taunt_1', 'taunt_2']);
  assert.throws(() => resolveAiMediaEntry({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    kind: 'speech',
    mappingRelativePath: '../outside/mapping.json',
    fileName: 'taunt.wav'
  }), /outside/);
  assert.throws(() => resolveAiMediaEntry({
    gameRoot: fixture.gameRoot,
    aiRoot: fixture.aiRoot,
    kind: 'binks',
    mappingRelativePath: 'binks/mapping.json',
    fileName: 'unmapped.bik'
  }), /not present/);
});

test('updates a managed Character and castle through a plugin transaction', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  await cloneAiToManagedPlugin({
    gameRoot: fixture.gameRoot,
    sourceAiRoot: fixture.aiRoot,
    aiId: 'sample-custom',
    name: 'Sample Custom',
    version: '1.0.0'
  });
  const characterContent = JSON.stringify({ aic: { WallDecoration: 9 } }, null, 2);
  const castleDocument = { pauseDelayAmount: 100, frames: [], miscItems: [] };
  const castleSourceBytes = Uint8Array.from([1, 2, 3]);
  const savedCastleSourceBytes = Uint8Array.from([4, 5, 6]);
  const updated = await updateManagedAi({
    gameRoot: fixture.gameRoot,
    aiId: 'sample-custom',
    characterContent,
    castleFile: 'sample1.aiv',
    castleDocument,
    castleSourceBytes,
    writeAivDocument: async (document, destination, options) => {
      assert.deepEqual(document, castleDocument);
      assert.equal(options.sourcePath, destination);
      assert.deepEqual(options.sourceBytes, castleSourceBytes);
      fs.writeFileSync(destination, Buffer.from('updated binary'));
      return { path: destination, sourceBytes: savedCastleSourceBytes };
    }
  });
  assert.equal(updated.owned, true);
  assert.deepEqual(updated.savedCastleSourceBytes, savedCastleSourceBytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(updated.characterPath, 'utf8')), JSON.parse(characterContent));
  assert.equal(fs.readFileSync(path.join(updated.rootPath, 'aiv', 'sample1.aiv'), 'utf8'), 'updated binary');
  assert.equal(fs.readdirSync(fixture.pluginsRoot).some(name => name.includes('.stage-') || name.includes('.backup-')), false);
});

test('failed plugin replacement restores the original folder', async t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.gameRoot, { recursive: true, force: true }));
  const marker = path.join(fixture.pluginRoot, 'marker.txt');
  fs.writeFileSync(marker, 'original');
  await assert.rejects(
    replaceDirectoryTransaction(fixture.pluginRoot, async stage => {
      fs.writeFileSync(path.join(stage, 'marker.txt'), 'changed');
      throw new Error('stop');
    }),
    /stop/
  );
  assert.equal(fs.readFileSync(marker, 'utf8'), 'original');
});

test('managed AI IDs reject traversal and nested paths', () => {
  assert.equal(sanitizeAiId('valid-ai_1.0'), 'valid-ai_1.0');
  assert.throws(() => sanitizeAiId('../outside'), /folder ID/);
  assert.throws(() => sanitizeAiId('nested/ai'), /folder ID/);
});

test('Electron shell exposes the Library and AI Content workspaces', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'src', 'js', 'app-shell.js'), 'utf8');
  assert.match(html, /data-workspace="ucp"/);
  assert.match(html, /id="ucpWorkspace"/);
  assert.match(html, /id="tabUcp" class="workspaceTab active"/);
  assert.equal(html.indexOf('id="tabUcp"') < html.indexOf('id="tabCharacter"'), true);
  assert.match(html, /id="ucpCastleSelect"[^>]*disabled/);
  assert.match(html, /id="ucpCreateAiBtn"/);
  assert.match(html, /id="ucpLibrarySearch"/);
  assert.match(html, /id="aiContentWorkspace"/);
  assert.match(html, /id="aiSpeechList"/);
  assert.match(html, /id="aiBinkList"/);
  assert.equal(html.indexOf('id="tabCastle"') < html.indexOf('id="tabAiContent"'), true);
  assert.match(
    html,
    /<\/section>\s*<\/div>\s*<dialog id="ucpCastleMappingDialog"/,
    'the Castle mapping modal must be outside the hidden UCP workspace'
  );
  assert.match(html, /js\/ai-content-editor\.js/);
  assert.match(html, /js\/ucp-library\.js/);
  assert.match(preload, /scanUcpAiLibrary/);
  assert.match(preload, /cloneUcpAi/);
  assert.match(preload, /updateUcpAi/);
  assert.match(preload, /createUcpAi/);
  assert.match(preload, /chooseAiPortrait/);
  assert.match(preload, /loadAiMediaData/);
  assert.match(preload, /chooseAiDocumentAction/);
  assert.match(preload, /addAiDocument/);
  assert.match(preload, /replaceAiMedia/);
  assert.match(preload, /openAiMedia/);
  assert.match(shell, /ucp:\s*document\.getElementById\('ucpWorkspace'\)/);
  assert.match(shell, /content:\s*document\.getElementById\('aiContentWorkspace'\)/);
  assert.match(shell, /let active = 'ucp'/);
});

test('new and opened documents can join the loaded AI or detach for standalone editing', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'src', 'js', 'ucp-library.js'), 'utf8');
  const character = fs.readFileSync(path.join(root, 'src', 'js', 'character-editor.js'), 'utf8');
  const castle = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');

  assert.match(main, /buttons: \['Add to AI', 'Edit separately', 'Cancel'\]/);
  assert.match(main, /old Character file will be permanently lost/);
  assert.match(main, /copies the castle into .*aiv folder/);
  assert.match(library, /function chooseDocumentDisposition\(kind, operation\)/);
  assert.match(library, /function addCharacterDocument\(content\)/);
  assert.match(library, /function addCastleDocument\(/);
  assert.match(character, /chooseDocumentDisposition\?\.\('character', 'open'\)/);
  assert.match(character, /chooseDocumentDisposition\?\.\('character', 'new'\)/);
  assert.match(character, /loadFromContent\(content, added\.path, \{ projectManaged: true \}\)/);
  assert.match(castle, /chooseDocumentDisposition\?\.\('castle', 'open'\)/);
  assert.match(castle, /chooseDocumentDisposition\?\.\('castle', 'new'\)/);
  assert.match(castle, /projectManaged: true/);
});
