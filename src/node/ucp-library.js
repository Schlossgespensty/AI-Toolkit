const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANAGED_PLUGIN = Object.freeze({
  name: 'aiv-mod-editor-local',
  displayName: 'AI Toolkit - My AIs',
  version: '1.0.0',
  folderName: 'aiv-mod-editor-local-1.0.0'
});

const DEFAULT_LINE_KEYS = Object.freeze([
  'ai_name',
  'title_1', 'title_2', 'title_3', 'title_4', 'title_5', 'title_6', 'title_7', 'title_8',
  'description', 'unknown_1',
  'taunt_1', 'taunt_2', 'taunt_3', 'taunt_4',
  'anger_1', 'anger_2', 'plead', 'nervous_1', 'nervous_2',
  'victory_1', 'victory_2', 'victory_3', 'victory_4',
  'request', 'thanks', 'ally_death', 'congrats', 'boast', 'help', 'extra',
  'kick_player', 'add_player', 'siege',
  'no_attack_1', 'no_attack_2', 'no_help_1', 'no_help_2',
  'no_sent', 'sent', 'team_winning', 'team_losing', 'help_sent', 'will_attack'
]);

function defaultLines(aiName) {
  return Object.fromEntries(DEFAULT_LINE_KEYS.map(key => [key, key === 'ai_name' ? String(aiName || '') : '']));
}

function asForwardSlashes(value) {
  return String(value || '').replaceAll('\\', '/');
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireWithin(parent, child, label = 'Path') {
  if (!isWithin(parent, child)) throw new Error(`${label} is outside the selected UCP installation.`);
  return path.resolve(child);
}

function stripYamlValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const withoutComment = trimmed.replace(/\s+#.*$/, '').trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
      (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function readYamlScalar(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, 'm'));
  return match ? stripYamlValue(match[1]) : '';
}

function parseDefinition(filePath, fallbackName) {
  if (!fs.existsSync(filePath)) {
    return {
      name: fallbackName,
      displayName: fallbackName,
      version: '',
      type: 'plugin',
      error: 'definition.yml is missing'
    };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const name = readYamlScalar(content, 'name') || fallbackName;
  return {
    name,
    displayName: readYamlScalar(content, 'display-name') || name,
    version: readYamlScalar(content, 'version'),
    type: readYamlScalar(content, 'type') || 'plugin',
    error: null
  };
}

function parseComparableVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(
    /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;
  return {
    core: match[1].split('.').map(part => Number(part)),
    prerelease: match[2] ? match[2].split('.') : []
  };
}

function compareVersions(one, two) {
  const first = parseComparableVersion(one);
  const second = parseComparableVersion(two);
  if (!first || !second) {
    return String(one || '').localeCompare(String(two || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  const coreLength = Math.max(first.core.length, second.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const difference = (first.core[index] || 0) - (second.core[index] || 0);
    if (difference) return Math.sign(difference);
  }
  if (!first.prerelease.length && second.prerelease.length) return 1;
  if (first.prerelease.length && !second.prerelease.length) return -1;
  const prereleaseLength = Math.max(first.prerelease.length, second.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const left = first.prerelease[index];
    const right = second.prerelease[index];
    if (left == null) return -1;
    if (right == null) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return Math.sign(left.localeCompare(right));
  }
  return 0;
}

function normalizeInstallationPath(selectedPath) {
  if (!selectedPath) throw new Error('Choose the Stronghold Crusader installation folder.');
  const selected = path.resolve(selectedPath);
  if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
    throw new Error('The selected folder does not exist.');
  }

  const candidates = [
    selected,
    path.basename(selected).toLowerCase() === 'ucp' ? path.dirname(selected) : null,
    path.basename(selected).toLowerCase() === 'plugins' && path.basename(path.dirname(selected)).toLowerCase() === 'ucp'
      ? path.dirname(path.dirname(selected))
      : null
  ].filter(Boolean);

  for (const gameRoot of candidates) {
    const ucpRoot = path.join(gameRoot, 'ucp');
    const pluginsRoot = path.join(ucpRoot, 'plugins');
    if (fs.existsSync(ucpRoot) && fs.statSync(ucpRoot).isDirectory() &&
        fs.existsSync(pluginsRoot) && fs.statSync(pluginsRoot).isDirectory()) {
      return path.resolve(gameRoot);
    }
  }
  throw new Error('This is not a UCP installation. Expected to find an ucp/plugins folder.');
}

function installationLayout(gameRoot) {
  const root = normalizeInstallationPath(gameRoot);
  return {
    gameRoot: root,
    ucpRoot: path.join(root, 'ucp'),
    pluginsRoot: path.join(root, 'ucp', 'plugins'),
    configPath: path.join(root, 'ucp-config.yml'),
    managedPluginRoot: path.join(root, 'ucp', 'plugins', MANAGED_PLUGIN.folderName)
  };
}

function readActiveExtensions(configPath) {
  if (!fs.existsSync(configPath)) return [];
  const content = fs.readFileSync(configPath, 'utf8');
  const names = new Set();
  const regex = /^\s*-\s*extension\s*:\s*([^\r\n#]+?)(?:\s+#.*)?$/gm;
  let match;
  while ((match = regex.exec(content))) {
    const name = stripYamlValue(match[1]);
    if (name) names.add(name);
  }
  return [...names];
}

function findMetaFiles(root, maxDepth = 8) {
  const found = [];
  function visit(directory, depth) {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(fullPath, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === 'meta.json') found.push(fullPath);
    }
  }
  if (fs.existsSync(root)) visit(root, 0);
  return found;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function imageDataUrl(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const AI_MEDIA_KINDS = Object.freeze({
  speech: Object.freeze({ folder: 'speech', extension: '.wav', mime: 'audio/wav' }),
  binks: Object.freeze({ folder: 'binks', extension: '.bik', mime: 'video/bink' })
});

function findAiMediaMappings(aiRoot, maxDepth = 6) {
  const found = [];
  function visit(directory, depth) {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name.toLowerCase() !== 'mapping.json') continue;
      const folder = path.basename(directory).toLowerCase();
      const kind = Object.keys(AI_MEDIA_KINDS).find(name => AI_MEDIA_KINDS[name].folder === folder);
      if (kind) found.push({ kind, mappingPath: fullPath });
    }
  }
  if (fs.existsSync(aiRoot)) visit(aiRoot, 0);
  return found;
}

function mediaDescriptor(root, kind, mappingPath, fileName, keys) {
  const filePath = path.join(path.dirname(mappingPath), fileName);
  const stats = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? fs.statSync(filePath) : null;
  const group = asForwardSlashes(path.relative(root, path.dirname(mappingPath)));
  const groupParts = group.split('/').filter(Boolean);
  return {
    kind,
    mappingPath,
    mappingRelativePath: asForwardSlashes(path.relative(root, mappingPath)),
    group,
    language: groupParts[0]?.toLowerCase() === 'lang' && groupParts.length >= 3
      ? groupParts[1]
      : null,
    fileName,
    filePath,
    exists: Boolean(stats),
    size: stats?.size || 0,
    keys
  };
}

function readAiMedia(aiRoot) {
  const root = path.resolve(aiRoot);
  const result = { speech: [], binks: [], diagnostics: [] };
  for (const { kind, mappingPath } of findAiMediaMappings(root)) {
    const definition = AI_MEDIA_KINDS[kind];
    let mapping;
    try {
      mapping = readJson(mappingPath);
    } catch (error) {
      result.diagnostics.push(`${mappingPath}: ${error.message}`);
      continue;
    }
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      result.diagnostics.push(`${mappingPath}: mapping.json must contain an object.`);
      continue;
    }
    const files = new Map();
    for (const [key, rawName] of Object.entries(mapping)) {
      if (typeof rawName !== 'string') continue;
      const fileName = path.basename(rawName);
      if (fileName !== rawName || path.extname(fileName).toLowerCase() !== definition.extension) {
        result.diagnostics.push(`${mappingPath}: '${key}' has an invalid ${definition.extension} filename.`);
        continue;
      }
      if (!files.has(fileName.toLowerCase())) files.set(fileName.toLowerCase(), { fileName, keys: [] });
      files.get(fileName.toLowerCase()).keys.push(key);
    }
    for (const { fileName, keys } of files.values()) {
      result[kind].push(mediaDescriptor(root, kind, mappingPath, fileName, keys));
    }
  }
  for (const kind of Object.keys(AI_MEDIA_KINDS)) {
    result[kind].sort((one, two) =>
      one.group.localeCompare(two.group, undefined, { numeric: true }) ||
      one.fileName.localeCompare(two.fileName, undefined, { numeric: true })
    );
  }
  return result;
}

function resolveAiMediaEntry({ gameRoot, aiRoot, kind, mappingRelativePath, fileName }) {
  const definition = AI_MEDIA_KINDS[kind];
  if (!definition) throw new Error('Unknown AI media type.');
  const layout = installationLayout(gameRoot);
  const root = requireWithin(layout.pluginsRoot, aiRoot, 'AI');
  const mappingPath = requireWithin(root, path.resolve(root, String(mappingRelativePath || '')), 'Media mapping');
  if (path.basename(mappingPath).toLowerCase() !== 'mapping.json' ||
      path.basename(path.dirname(mappingPath)).toLowerCase() !== definition.folder) {
    throw new Error('The selected media mapping is invalid.');
  }
  const safeName = path.basename(String(fileName || ''));
  if (safeName !== fileName || path.extname(safeName).toLowerCase() !== definition.extension) {
    throw new Error(`The selected ${definition.extension} filename is invalid.`);
  }
  const mapping = readJson(mappingPath);
  const keys = Object.entries(mapping || {})
    .filter(([, value]) => typeof value === 'string' && value.toLowerCase() === safeName.toLowerCase())
    .map(([key]) => key);
  if (!keys.length) throw new Error('This file is not present in the selected media mapping.');
  return mediaDescriptor(root, kind, mappingPath, safeName, keys);
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: candidate => !fs.lstatSync(candidate).isSymbolicLink()
  });
}

function castleFiles(aiRoot, diagnostics) {
  const aivRoot = path.join(aiRoot, 'aiv');
  const mappingPath = path.join(aivRoot, 'mapping.json');
  let mapping = {};
  if (fs.existsSync(mappingPath)) {
    try {
      mapping = readJson(mappingPath);
    } catch (error) {
      diagnostics.push(`${mappingPath}: ${error.message}`);
    }
  }

  const castles = [];
  const mappedNames = new Set();
  for (const [key, rawName] of Object.entries(mapping || {})) {
    const slotMatch = String(key).match(/^castle_(\d+)$/i);
    if (!slotMatch || typeof rawName !== 'string') continue;
    const fileName = path.basename(rawName);
    const safe = fileName === rawName && /\.aiv$/i.test(fileName);
    const filePath = safe ? path.join(aivRoot, fileName) : null;
    const jsonPath = safe ? filePath.replace(/\.aiv$/i, '.aivjson') : null;
    if (safe) mappedNames.add(fileName.toLowerCase());
    castles.push({
      slot: Number(slotMatch[1]),
      fileName: rawName,
      filePath,
      exists: Boolean(filePath && fs.existsSync(filePath)),
      jsonPath,
      jsonExists: Boolean(jsonPath && fs.existsSync(jsonPath)),
      valid: safe
    });
  }
  castles.sort((one, two) => one.slot - two.slot);

  if (fs.existsSync(aivRoot)) {
    for (const entry of fs.readdirSync(aivRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.aiv$/i.test(entry.name) || mappedNames.has(entry.name.toLowerCase())) continue;
      const filePath = path.join(aivRoot, entry.name);
      const jsonPath = filePath.replace(/\.aiv$/i, '.aivjson');
      castles.push({
        slot: null,
        fileName: entry.name,
        filePath,
        exists: true,
        jsonPath,
        jsonExists: fs.existsSync(jsonPath),
        valid: true
      });
    }
  }
  return { mappingPath, mappingExists: fs.existsSync(mappingPath), castles };
}

function writableAiRoot(gameRoot, aiRoot) {
  const layout = installationLayout(gameRoot);
  const root = requireWithin(layout.pluginsRoot, path.resolve(String(aiRoot || '')), 'AI');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, 'meta.json'))) {
    throw new Error('The loaded AI project no longer exists.');
  }
  return root;
}

function replaceAiCharacter({ gameRoot, aiRoot, content }) {
  const root = writableAiRoot(gameRoot, aiRoot);
  const character = String(content || '').trim();
  if (!character) throw new Error('The Character file is empty.');
  JSON.parse(character);
  const destination = path.join(root, 'character.json');
  atomicWriteFile(destination, `${character}\n`, 'utf8');
  return { path: destination };
}

async function addAiCastle({
  gameRoot,
  aiRoot,
  fileName,
  document,
  sourcePath = null,
  sourceBytes = null,
  unchanged = true,
  overwrite = false,
  writeAivDocument
}) {
  const root = writableAiRoot(gameRoot, aiRoot);
  const safeName = path.basename(String(fileName || ''));
  if (!safeName || safeName !== fileName || !/\.aiv$/i.test(safeName)) {
    throw new Error('The castle filename must be a plain .aiv filename.');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('The castle document is invalid.');
  }
  if (typeof writeAivDocument !== 'function') throw new Error('The native AIV writer is unavailable.');

  const aivRoot = path.join(root, 'aiv');
  fs.mkdirSync(aivRoot, { recursive: true });
  const destination = path.join(aivRoot, safeName);
  if (fs.existsSync(destination) && !overwrite) {
    throw new Error(`Castle file '${safeName}' already exists in this AI.`);
  }
  const saved = await writeAivDocument(document, destination, {
    sourcePath,
    sourceBytes,
    unchanged: Boolean(unchanged)
  });
  return {
    path: destination,
    fileName: safeName,
    sourceBytes: saved?.sourceBytes || null
  };
}

function updateAiCastleMapping({ gameRoot, aiRoot, slots }) {
  const layout = installationLayout(gameRoot);
  const root = requireWithin(layout.pluginsRoot, aiRoot, 'AI');
  const aivRoot = requireWithin(root, path.join(root, 'aiv'), 'Castle folder');
  if (!fs.existsSync(aivRoot) || !fs.statSync(aivRoot).isDirectory()) {
    throw new Error('This AI has no aiv folder.');
  }
  if (!Array.isArray(slots) || slots.length > 8) throw new Error('Castle mapping must contain at most eight slots.');

  const available = new Map(fs.readdirSync(aivRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.aiv$/i.test(entry.name))
    .map(entry => [entry.name.toLowerCase(), entry.name]));
  const mapping = {};
  for (let index = 0; index < 8; index += 1) {
    const requested = String(slots[index] || '').trim();
    if (!requested) continue;
    const fileName = path.basename(requested);
    if (fileName !== requested || !/\.aiv$/i.test(fileName)) {
      throw new Error(`Castle ${index + 1} has an invalid filename.`);
    }
    const actualName = available.get(fileName.toLowerCase());
    if (!actualName) throw new Error(`Castle file '${fileName}' does not exist in this AI.`);
    mapping[`castle_${index + 1}`] = actualName;
  }
  atomicWriteFile(path.join(aivRoot, 'mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
  const scanned = scanUcpInstallation(layout.gameRoot);
  return scanned.ais.find(ai => path.resolve(ai.rootPath) === root) || null;
}

function scanUcpInstallation(selectedPath) {
  const layout = installationLayout(selectedPath);
  const activeExtensions = readActiveExtensions(layout.configPath);
  const activeSet = new Set(activeExtensions);
  const diagnostics = [];
  const plugins = [];
  const ais = [];

  const candidates = [];
  for (const entry of fs.readdirSync(layout.pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const pluginRoot = path.join(layout.pluginsRoot, entry.name);
    const definition = parseDefinition(path.join(pluginRoot, 'definition.yml'), entry.name);
    if (definition.type && definition.type !== 'plugin') continue;
    candidates.push({ entry, pluginRoot, definition });
  }

  const newestVersionByName = new Map();
  for (const { definition } of candidates) {
    const current = newestVersionByName.get(definition.name);
    if (current == null || compareVersions(definition.version, current) > 0) {
      newestVersionByName.set(definition.name, definition.version);
    }
  }

  for (const { entry, pluginRoot, definition } of candidates) {
    if (compareVersions(definition.version, newestVersionByName.get(definition.name)) < 0) continue;
    const resourcesRoot = path.join(pluginRoot, 'resources', 'ai');
    const plugin = {
      folderName: entry.name,
      rootPath: pluginRoot,
      name: definition.name,
      displayName: definition.displayName,
      version: definition.version,
      active: activeSet.has(definition.name),
      owned: definition.name === MANAGED_PLUGIN.name,
      definitionError: definition.error,
      aiCount: 0
    };

    for (const metaPath of findMetaFiles(resourcesRoot)) {
      const aiRoot = path.dirname(metaPath);
      let meta;
      try {
        meta = readJson(metaPath);
      } catch (error) {
        diagnostics.push(`${metaPath}: ${error.message}`);
        continue;
      }
      const aiDiagnostics = [];
      const characterPath = path.join(aiRoot, 'character.json');
      const linesPath = path.join(aiRoot, 'lines.json');
      const castleInfo = castleFiles(aiRoot, aiDiagnostics);
      const relativeId = asForwardSlashes(path.relative(resourcesRoot, aiRoot));
      const portraitPath = ['portrait.png', 'portrait.jpg', 'portrait.jpeg']
        .map(name => path.join(aiRoot, name))
        .find(candidate => fs.existsSync(candidate)) || null;
      ais.push({
        key: `${definition.name}:${relativeId}:${asForwardSlashes(aiRoot)}`,
        id: relativeId,
        folderName: path.basename(aiRoot),
        rootPath: aiRoot,
        metaPath,
        meta,
        name: typeof meta.name === 'string' && meta.name.trim() ? meta.name : path.basename(aiRoot),
        author: typeof meta.author === 'string' ? meta.author : '',
        version: typeof meta.version === 'string' ? meta.version : '',
        description: typeof meta.description === 'string' ? meta.description : '',
        defaultLang: typeof meta.defaultLang === 'string' ? meta.defaultLang : '',
        supportedLang: Array.isArray(meta.supportedLang) ? meta.supportedLang.map(String) : [],
        characterPath,
        characterExists: fs.existsSync(characterPath),
        linesPath,
        linesExists: fs.existsSync(linesPath),
        mappingPath: castleInfo.mappingPath,
        mappingExists: castleInfo.mappingExists,
        castles: castleInfo.castles,
        portraitPath,
        portraitDataUrl: portraitPath ? imageDataUrl(portraitPath) : null,
        portraitSmallPath: path.join(aiRoot, 'portrait_small.png'),
        portraitSmallDataUrl: fs.existsSync(path.join(aiRoot, 'portrait_small.png'))
          ? imageDataUrl(path.join(aiRoot, 'portrait_small.png'))
          : null,
        active: plugin.active,
        owned: plugin.owned,
        plugin: {
          name: plugin.name,
          displayName: plugin.displayName,
          version: plugin.version,
          folderName: plugin.folderName,
          rootPath: plugin.rootPath,
          active: plugin.active,
          owned: plugin.owned
        },
        diagnostics: aiDiagnostics
      });
      plugin.aiCount += 1;
    }
    plugins.push(plugin);
  }

  // Die Burgen des Spiels selbst. Sie liegen nicht bei den Plugins, sondern im
  // aiv-Ordner des angezeigten Spielordners. Ohne diesen Teil fehlte der
  // vanilla Abbot in der Liste - und mit ihm alle anderen 15 Lords.
  ais.push(...vanillaCastles(path.join(layout.gameRoot, 'aiv')));

  ais.sort((one, two) => one.name.localeCompare(two.name) || one.plugin.displayName.localeCompare(two.plugin.displayName));
  plugins.sort((one, two) => one.displayName.localeCompare(two.displayName));
  return {
    ...layout,
    configExists: fs.existsSync(layout.configPath),
    activeExtensions,
    plugins,
    ais,
    diagnostics,
    managedPlugin: plugins.find(plugin => plugin.owned) || null
  };
}

// Die Burgen des Spiels, gruppiert nach Lord.
//
// GEMESSEN am 11.09.2026 im Spielordner: 128 Dateien, 16 Lords mit je acht
// Burgen, Schema <Lord><Zahl>.aiv. Die Schreibweise ist gemischt (Abbot1,
// aber caliph1), deshalb wird der Name klein verglichen und fuer die Anzeige
// gross geschrieben.
//
// NUR ZUM LESEN. Die Dateien gehoeren dem Spiel; jede Schreibfunktion dieser
// Bibliothek prueft gegen den Plugin-Ordner und weist den Spielordner ab.
const VANILLA_PLUGIN = { name: 'vanilla', displayName: 'Vanilla (game folder)', version: '', folderName: 'aiv', active: true, owned: false };

function vanillaCastles(aivRoot) {
  let entries = [];
  try { entries = fs.readdirSync(aivRoot, { withFileTypes: true }); } catch { return []; }
  const lords = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^([a-z]+)(\d+)\.aiv$/i);
    if (!match) continue;
    const lord = match[1].toLowerCase();
    if (!lords.has(lord)) lords.set(lord, []);
    lords.get(lord).push({ slot: Number(match[2]), fileName: entry.name });
  }
  const out = [];
  for (const [lord, files] of lords) {
    files.sort((a, b) => a.slot - b.slot);
    const name = lord.charAt(0).toUpperCase() + lord.slice(1);
    out.push({
      key: `vanilla:${lord}`,
      id: lord,
      folderName: 'aiv',
      rootPath: aivRoot,
      metaPath: null,
      meta: {},
      name: `${name} (Vanilla)`,
      author: 'Stronghold Crusader',
      version: '',
      description: 'The original castles from the game folder. Read only.',
      defaultLang: '',
      supportedLang: [],
      characterPath: null,
      characterExists: false,
      linesPath: null,
      linesExists: false,
      mappingPath: null,
      mappingExists: false,
      castles: files.map(file => {
        const filePath = path.join(aivRoot, file.fileName);
        return { slot: file.slot, fileName: file.fileName, filePath, exists: true,
                 jsonPath: filePath.replace(/\.aiv$/i, '.aivjson'), jsonExists: false, valid: true };
      }),
      portraitPath: null,
      portraitDataUrl: null,
      portraitSmallPath: null,
      portraitSmallDataUrl: null,
      active: true,
      owned: false,
      vanilla: true,
      plugin: { ...VANILLA_PLUGIN, rootPath: aivRoot },
      diagnostics: []
    });
  }
  return out;
}

// Eine Vanilla-Burg lesen. Keine Figur, keine Zeilen - nur die Burg, und die
// ausdruecklich schreibgeschuetzt.
async function readVanillaCastle({ vanillaRoot, castleFile, readAivDocument }) {
  const result = { aiRoot: vanillaRoot, owned: false, vanilla: true, readOnly: true,
                   character: null, lines: null, media: null, castle: null };
  if (!castleFile) return result;
  const fileName = path.basename(String(castleFile));
  if (fileName !== castleFile || !/\.aiv$/i.test(fileName)) throw new Error('The castle filename is invalid.');
  const filePath = requireWithin(vanillaRoot, path.join(vanillaRoot, fileName), 'Castle');
  if (!fs.existsSync(filePath)) throw new Error(`Castle file '${fileName}' is missing.`);
  if (typeof readAivDocument !== 'function') throw new Error('The native AIV reader is unavailable.');
  const loaded = await readAivDocument(filePath);
  result.castle = { path: filePath, fileName, document: loaded.document, source: 'aiv',
                    sourceBytes: loaded.sourceBytes || null };
  return result;
}

function managedDefinition() {
  return `name: ${MANAGED_PLUGIN.name}\n` +
    `display-name: ${MANAGED_PLUGIN.displayName}\n` +
    `version: ${MANAGED_PLUGIN.version}\n` +
    `author: AI Toolkit\n` +
    `meta:\n  version: 1.0.0\n` +
    `type: plugin\n` +
    `dependencies:\n  aiSwapper: ">= 1.2.0"\n`;
}

function writeManagedDefinition(pluginRoot) {
  fs.writeFileSync(path.join(pluginRoot, 'definition.yml'), managedDefinition(), 'utf8');
}

function sanitizeAiId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id === '.' || id === '..') {
    throw new Error('The AI folder ID may contain lowercase letters, numbers, dots, dashes and underscores.');
  }
  return id;
}

async function replaceDirectoryTransaction(targetPath, prepare) {
  const target = path.resolve(targetPath);
  const parent = path.dirname(target);
  const base = path.basename(target);
  fs.mkdirSync(parent, { recursive: true });
  const token = crypto.randomUUID();
  const stage = path.join(parent, `.${base}.stage-${token}`);
  const backup = path.join(parent, `.${base}.backup-${token}`);
  let movedOriginal = false;
  try {
    if (fs.existsSync(target)) copyDirectory(target, stage);
    else fs.mkdirSync(stage, { recursive: true });
    await prepare(stage);
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedOriginal = true;
    }
    fs.renameSync(stage, target);
    if (movedOriginal) fs.rmSync(backup, { recursive: true, force: true });
    return target;
  } catch (error) {
    if (!fs.existsSync(target) && movedOriginal && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  }
}

function atomicWriteFile(filePath, content, encoding = null) {
  const target = path.resolve(filePath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const token = crypto.randomUUID();
  const stage = path.join(parent, `.${path.basename(target)}.stage-${token}`);
  const backup = path.join(parent, `.${path.basename(target)}.backup-${token}`);
  let movedOriginal = false;
  try {
    fs.writeFileSync(stage, content, encoding || undefined);
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedOriginal = true;
    }
    fs.renameSync(stage, target);
    if (movedOriginal) fs.rmSync(backup, { force: true });
    return target;
  } catch (error) {
    if (!fs.existsSync(target) && movedOriginal && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(stage, { force: true });
  }
}

async function cloneAiToManagedPlugin({ gameRoot, sourceAiRoot, aiId, name, version }) {
  const layout = installationLayout(gameRoot);
  const source = requireWithin(layout.pluginsRoot, sourceAiRoot, 'Source AI');
  const sourceMetaPath = path.join(source, 'meta.json');
  if (!fs.existsSync(sourceMetaPath)) throw new Error('The selected AI has no meta.json.');
  const id = sanitizeAiId(aiId);
  const target = path.join(layout.managedPluginRoot, 'resources', 'ai', id);
  if (fs.existsSync(target)) throw new Error(`My AIs already contains '${id}'. Choose another folder ID.`);
  if (isWithin(source, target) || isWithin(target, source)) throw new Error('The source and destination AI folders overlap.');
  const meta = readJson(sourceMetaPath);
  meta.name = String(name || meta.name || id).trim() || id;
  meta.version = String(version || meta.version || '1.0.0').trim() || '1.0.0';

  await replaceDirectoryTransaction(layout.managedPluginRoot, async stageRoot => {
    writeManagedDefinition(stageRoot);
    const stageTarget = path.join(stageRoot, 'resources', 'ai', id);
    fs.mkdirSync(path.dirname(stageTarget), { recursive: true });
    copyDirectory(source, stageTarget);
    fs.writeFileSync(path.join(stageTarget, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  });

  return scanUcpInstallation(layout.gameRoot).ais.find(ai => ai.owned && ai.id === id) || null;
}

async function createManagedAi({
  gameRoot,
  aiId,
  name,
  author = '',
  version = '1.0.0',
  characterContent,
  portraitPng = null,
  portraitSmallPng = null,
  writeAivDocument
}) {
  const layout = installationLayout(gameRoot);
  const id = sanitizeAiId(aiId);
  const aiName = String(name || '').trim();
  if (!aiName) throw new Error('Enter a name for the new AI.');
  const target = path.join(layout.managedPluginRoot, 'resources', 'ai', id);
  if (fs.existsSync(target)) throw new Error(`My AIs already contains '${id}'. Choose another folder ID.`);
  if (typeof writeAivDocument !== 'function') throw new Error('The native AIV writer is unavailable.');
  const character = String(characterContent || '').trim();
  JSON.parse(character);
  const castleFile = 'castle1.aiv';
  const emptyCastle = {
    pauseDelayAmount: 100,
    frames: [{ itemType: 61, tilePositionOfsets: [5643], shouldPause: false }],
    miscItems: []
  };
  const meta = {
    name: aiName,
    description: '',
    author: String(author || '').trim(),
    link: 'None',
    version: String(version || '1.0.0').trim() || '1.0.0',
    defaultLang: 'en',
    supportedLang: ['en'],
    switched: {
      binks: false,
      speech: false,
      aic: true,
      aiv: true,
      lord: true,
      startTroops: true,
      lines: true,
      portrait: true
    }
  };

  await replaceDirectoryTransaction(layout.managedPluginRoot, async stageRoot => {
    writeManagedDefinition(stageRoot);
    const stageTarget = path.join(stageRoot, 'resources', 'ai', id);
    const aivRoot = path.join(stageTarget, 'aiv');
    fs.mkdirSync(aivRoot, { recursive: true });
    fs.writeFileSync(path.join(stageTarget, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(stageTarget, 'character.json'), `${character}\n`, 'utf8');
    fs.writeFileSync(path.join(stageTarget, 'lines.json'), `${JSON.stringify(defaultLines(aiName), null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(aivRoot, 'mapping.json'), `${JSON.stringify({ castle_1: castleFile }, null, 2)}\n`, 'utf8');
    if (portraitPng) fs.writeFileSync(path.join(stageTarget, 'portrait.png'), portraitPng);
    if (portraitSmallPng) fs.writeFileSync(path.join(stageTarget, 'portrait_small.png'), portraitSmallPng);
    await writeAivDocument(emptyCastle, path.join(aivRoot, castleFile));
  });

  return scanUcpInstallation(layout.gameRoot).ais.find(ai => ai.owned && ai.id === id) || null;
}

async function readAiProject({ gameRoot, aiRoot, castleFile, readAivDocument }) {
  const layout = installationLayout(gameRoot);
  const vanillaRoot = path.join(layout.gameRoot, 'aiv');
  if (path.resolve(String(aiRoot || '')) === path.resolve(vanillaRoot)) {
    return readVanillaCastle({ vanillaRoot, castleFile, readAivDocument });
  }
  const root = requireWithin(layout.pluginsRoot, aiRoot, 'AI');
  const characterPath = path.join(root, 'character.json');
  if (!fs.existsSync(characterPath)) throw new Error('This AI has no character.json.');
  const result = {
    aiRoot: root,
    owned: isWithin(layout.managedPluginRoot, root),
    character: {
      path: characterPath,
      content: fs.readFileSync(characterPath, 'utf8')
    },
    lines: {
      path: path.join(root, 'lines.json'),
      exists: fs.existsSync(path.join(root, 'lines.json')),
      content: fs.existsSync(path.join(root, 'lines.json'))
        ? fs.readFileSync(path.join(root, 'lines.json'), 'utf8')
        : `${JSON.stringify(defaultLines(path.basename(root)), null, 2)}\n`
    },
    portraits: {
      portrait: {
        path: path.join(root, 'portrait.png'),
        exists: fs.existsSync(path.join(root, 'portrait.png')),
        dataUrl: fs.existsSync(path.join(root, 'portrait.png')) ? imageDataUrl(path.join(root, 'portrait.png')) : null
      },
      portraitSmall: {
        path: path.join(root, 'portrait_small.png'),
        exists: fs.existsSync(path.join(root, 'portrait_small.png')),
        dataUrl: fs.existsSync(path.join(root, 'portrait_small.png')) ? imageDataUrl(path.join(root, 'portrait_small.png')) : null
      }
    },
    media: readAiMedia(root),
    castle: null
  };

  if (castleFile) {
    const fileName = path.basename(String(castleFile));
    if (fileName !== castleFile || !/\.aiv$/i.test(fileName)) throw new Error('The mapped castle filename is invalid.');
    const filePath = path.join(root, 'aiv', fileName);
    requireWithin(path.join(root, 'aiv'), filePath, 'Castle');
    if (fs.existsSync(filePath)) {
      if (typeof readAivDocument !== 'function') throw new Error('The native AIV reader is unavailable.');
      const loaded = await readAivDocument(filePath);
      result.castle = {
        path: filePath,
        fileName,
        document: loaded.document,
        source: 'aiv',
        sourceBytes: loaded.sourceBytes || null
      };
    } else {
      const jsonPath = filePath.replace(/\.aiv$/i, '.aivjson');
      if (!fs.existsSync(jsonPath)) throw new Error(`Castle file '${fileName}' is missing.`);
      result.castle = { path: filePath, fileName, document: readJson(jsonPath), source: 'aivjson' };
    }
  }
  return result;
}

async function updateManagedAi({
  gameRoot,
  aiId,
  characterContent,
  castleFile,
  castleDocument,
  castleUnchanged = false,
  castleSourceBytes = null,
  writeAivDocument
}) {
  const layout = installationLayout(gameRoot);
  const id = sanitizeAiId(aiId);
  const aiRoot = path.join(layout.managedPluginRoot, 'resources', 'ai', id);
  if (!fs.existsSync(aiRoot)) throw new Error(`My AIs does not contain '${id}'.`);
  JSON.parse(characterContent);
  const fileName = castleFile ? path.basename(String(castleFile)) : null;
  if (fileName && (fileName !== castleFile || !/\.aiv$/i.test(fileName))) throw new Error('The castle filename is invalid.');
  if (fileName && (!castleDocument || typeof castleDocument !== 'object' || Array.isArray(castleDocument))) {
    throw new Error('The castle document is invalid.');
  }

  let savedCastle = null;
  await replaceDirectoryTransaction(layout.managedPluginRoot, async stageRoot => {
    writeManagedDefinition(stageRoot);
    const stageAiRoot = path.join(stageRoot, 'resources', 'ai', id);
    fs.writeFileSync(path.join(stageAiRoot, 'character.json'), characterContent.trimEnd() + '\n', 'utf8');
    if (fileName && castleDocument) {
      const destination = path.join(stageAiRoot, 'aiv', fileName);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (typeof writeAivDocument !== 'function') throw new Error('The native AIV writer is unavailable.');
      savedCastle = await writeAivDocument(castleDocument, destination, {
        sourcePath: destination,
        sourceBytes: castleSourceBytes,
        unchanged: Boolean(castleUnchanged)
      });
    }
  });

  const updated = scanUcpInstallation(layout.gameRoot).ais.find(ai => ai.owned && ai.id === id) || null;
  if (updated && savedCastle?.sourceBytes) updated.savedCastleSourceBytes = savedCastle.sourceBytes;
  return updated;
}

module.exports = {
  MANAGED_PLUGIN,
  normalizeInstallationPath,
  installationLayout,
  readActiveExtensions,
  compareVersions,
  scanUcpInstallation,
  sanitizeAiId,
  defaultLines,
  cloneAiToManagedPlugin,
  createManagedAi,
  readAiProject,
  readAiMedia,
  resolveAiMediaEntry,
  replaceAiCharacter,
  addAiCastle,
  updateAiCastleMapping,
  updateManagedAi,
  replaceDirectoryTransaction,
  atomicWriteFile,
  isWithin
};
