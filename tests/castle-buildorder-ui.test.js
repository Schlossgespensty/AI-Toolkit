const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const functionBody = (script, name) => {
  const start = script.indexOf(`function ${name}`);
  const next = script.indexOf('\n  function ', start + 10);
  return script.slice(start, next < 0 ? script.length : next);
};

test('Castle docks place build order left and item palette right', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const workspaceStart = html.indexOf('<section id="castleWorkspace"');
  const workspaceEnd = html.indexOf('<section id="aiContentWorkspace"', workspaceStart);
  const castle = html.slice(workspaceStart, workspaceEnd);
  const buildPanel = castle.indexOf('class="castlePanel castleBuildPanel"');
  const canvas = castle.indexOf('class="castleCanvasColumn"');
  const palettePanel = castle.indexOf('class="castlePanel castlePalettePanel"');
  assert.ok(buildPanel >= 0 && buildPanel < canvas);
  assert.ok(canvas < palettePanel);
});

test('Castle build-order slider and future-step styling are wired together', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(html, /id="castleBuildSlider"[^>]+type="range"/);
  assert.match(html, /id="castleBuildSliderValue"/);
  assert.match(css, /\.buildStep\.future\s*\{/);
  assert.match(script, /fi\s*>\s*activeStep/);
  assert.match(script, /placement\.fi\s*>\s*activeStep/);
  assert.match(script, /const FUTURE_OPACITY\s*=\s*0\.50/);
  assert.match(script, /const FUTURE_FILTER\s*=\s*'grayscale\(1\) brightness\(\.42\)'/);
  assert.match(script, /buildSlider\.addEventListener\('input',\s*selectBuildStepFromSlider\)/);
  assert.match(script, /scrollIntoView\(\{\s*block:\s*'nearest'\s*\}\)/);
});

test('Castle canvas caches static rendering and avoids per-item compositor filters', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const futureRule = css.match(/\.buildStep\.future\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(futureRule, /\bfilter\s*:/);
  assert.doesNotMatch(futureRule, /\bopacity\s*:/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(script, /const MAX_RENDER_DPR\s*=\s*1\.5/);
  assert.match(script, /staticCacheCanvas/);
  assert.match(script, /futureCacheCanvas/);
  assert.match(script, /globalCompositeOperation\s*=\s*'source-atop'/);
  assert.match(script, /staticCacheCtx\.filter\s*=\s*FUTURE_FILTER/);
  assert.match(script, /scheduleDraw\(false\)/);
  assert.match(script, /if \(state\.placementCache\) return state\.placementCache/);
});

test('Temporary canvas and item selections cannot clear or replace the active build step', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const functionBody = name => {
    const start = script.indexOf(`function ${name}`);
    const next = script.indexOf('\n  function ', start + 10);
    return script.slice(start, next < 0 ? script.length : next);
  };
  assert.doesNotMatch(functionBody('clearSelectionAndItem'), /insertionFrameIndex\s*=\s*null/);
  assert.doesNotMatch(functionBody('deleteSelected'), /insertionFrameIndex\s*=\s*null/);
  assert.doesNotMatch(functionBody('onPointerDown'), /insertionFrameIndex\s*=\s*null/);
  assert.doesNotMatch(functionBody('onPointerUp'), /insertionFrameIndex\s*=\s*null/);
  assert.doesNotMatch(script, /updateInsertionAnchorFromSelection/);
  assert.match(functionBody('selectBuildFrames'), /if \(indexes\.length\)/);
  assert.match(functionBody('clampActiveBuildStep'), /Math\.max\(0, Math\.min\(frames\(\)\.length - 1/);
});

test('Castle palette uses larger category controls and item thumbnails', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');
  assert.match(css, /\.castlePanel \.paletteCategoryButton\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?font-size:\s*13px;/);
  assert.match(css, /\.paletteItem\s*\{[\s\S]*?min-height:\s*54px;/);
  assert.match(css, /\.paletteThumb\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
});

test('Temporary blueprint controls render an in-memory image beneath castle objects', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.doesNotMatch(html, /id="castleBlueprintInput"/);
  assert.match(html, /id="castleShowBlueprint"[^>]+type="checkbox"/);
  assert.match(html, /id="castleBlueprintOpacity"[^>]+type="range"/);
  assert.match(html, /id="castleBlueprintControls"[^>]+hidden/);
  assert.match(script, /els\.blueprintControls\.hidden\s*=\s*!loaded/);
  assert.doesNotMatch(html, /id="castle(?:Load|Clear)BlueprintBtn"/);
  assert.match(main, /label: 'Load\/Replace Background…'/);
  assert.match(main, /label: 'Clear Background'/);
  assert.match(main, /ipcMain\.handle\('choose-castle-background'/);
  assert.match(main, /title: 'Choose temporary castle background'/);
  assert.match(preload, /chooseCastleBackground: \(\) => ipcRenderer\.invoke\('choose-castle-background'\)/);
  assert.match(script, /await window\.electronAPI\.chooseCastleBackground\(\)/);
  assert.match(script, /if \(blueprintDialogOpen\) return false;/);
  assert.doesNotMatch(script, /URL\.createObjectURL|blueprintInput\.click/);
  assert.match(script, /function drawBlueprint\(mapSize\)/);
  assert.match(functionBody(script, 'drawBlueprint'), /imageSmoothingEnabled\s*=\s*false/);
  assert.match(script, /drawBlueprint\(mapSize\);\s*if \(els\.showCompatibility\.checked\) drawCompatibilityGuide\(mapSize\);\s*drawGrid\(mapSize\);/);
  const outputStart = script.indexOf('function outputDocument()');
  const outputEnd = script.indexOf('\n  function outputContent()', outputStart);
  assert.doesNotMatch(script.slice(outputStart, outputEnd), /blueprint/i);
});

test('Castle line tool routes around non-unit placements and ignores unit rallypoints', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const obstacleMap = functionBody(script, 'lineObstacleMap');
  const pointerMove = functionBody(script, 'onPointerMove');
  assert.match(obstacleMap, /placement\.kind\s*===\s*'unit'/);
  assert.match(obstacleMap, /continue/);
  assert.match(pointerMove, /routedLineTiles\(state\.dragStartTile,\s*tile\)/);
});

test('Castle unit order labels are one-based while stored rallypoint indexes remain compatible', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(functionBody(script, 'unitDisplayNumber'), /Number\(number\)\s*\+\s*1/);
  assert.match(functionBody(script, 'drawUnitMarkers'), /unitDisplayNumber\(stack\.top\.number\)/);
  assert.match(functionBody(script, 'placeSingle'), /unitDisplayNumber\(state\.document\.miscItems\[mi\]\.number\)/);
  assert.match(functionBody(script, 'renumberUnits'), /nextNumber\.get\(type\)\s*\|\|\s*0/);
});

test('Castle items default to one placement per build step unless multiple placement is explicit', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const rule = functionBody(script, 'allowsMultiplePerStep');
  const copy = functionBody(script, 'placeCopy');
  assert.match(rule, /isUnitType\(type\)\s*\|\|\s*itemInfo\(type\)\.multiPlacement\s*===\s*true/);
  assert.doesNotMatch(rule, /!==\s*false/);
  assert.match(copy, /if \(allowsMultiplePerStep\(type\)\)/);
  assert.match(copy, /tilePositionOfsets:\s*\[off\]/);
});

test('Castle Brush and Line stay available and split single-step items into consecutive steps', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const brush = functionBody(script, 'commitBrush');
  const setTool = functionBody(script, 'setTool');
  const selectItem = functionBody(script, 'selectItem');
  assert.match(brush, /state\.brushOffsets\.map\(off => \(\{ itemType: type, tilePositionOfsets: \[off\]/);
  assert.match(brush, /insertBuildFrames\(newFrames\)/);
  assert.doesNotMatch(setTool, /allowsMultiplePerStep/);
  assert.match(selectItem, /setTool\(state\.lastPlacementTool\)/);
});

test('Castle multi-placement is for the things that are drawn in a line', () => {
  // Moat, the two walls, crenels, pitch - and since the stairs became line
  // recipes, the two of them as well: what they have in common is that the
  // user draws a run of them in one gesture, not that they are walls.
  const constants = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_constants.json'), 'utf8'));
  const allowed = Object.entries(constants)
    .filter(([_id, info]) => info.multiPlacement === true)
    .map(([id]) => Number(id))
    .sort((one, two) => one - two);
  assert.deepEqual(allowed, [25, 26, 35, 46, 99, 106, 10001, 10002]);
  // Every recipe is drawn in a line, or its own tools would not be offered.
  for (const [id, info] of Object.entries(constants)) {
    if (!Array.isArray(info.lineSequence) || !info.lineSequence.length) continue;
    assert.equal(info.multiPlacement, true, `recipe ${id} is not multi-placement`);
  }
});

test('Castle exposes capped High Stair and Low Stair line recipes as consecutive real steps', () => {
  const constants = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_constants.json'), 'utf8'));
  const categories = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_categories.json'), 'utf8'));
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.deepEqual(constants['10001'].lineSequence, [181, 182, 183, 184, 185]);
  assert.deepEqual(constants['10002'].lineSequence, [183, 184, 185]);
  assert.deepEqual(categories.categories.Stairs.slice(0, 2), ['10001', '10002']);
  // Die Sperre steht weiter in updateToolAvailability, liest den Namen des
  // Werkzeugs jetzt aber einmal in eine Variable - seit dort eine zweite
  // Bedingung dazugekommen ist (kein Gebaeude gewaehlt).
  assert.match(functionBody(script, 'updateToolAvailability'), /tool === 'single'.*tool === 'brush'/s);
  assert.match(functionBody(script, 'setTool'), /if \(lineOnly && isPlacementTool\(tool\)\) tool = 'line'/);
  assert.match(functionBody(script, 'updateLineSequencePreview'), /geometry\.limitedLineTiles/);
  assert.match(functionBody(script, 'commitBrush'), /itemType:\s*state\.brushTypes\[index\]/);
  assert.doesNotMatch(functionBody(script, 'commitBrush'), /state\.brushOffsets\.length\s*!==\s*sequence\.length/);
});

test('Move-tool selection makes the last selected physical placement the active build step', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const functionBody = name => {
    const start = script.indexOf(`function ${name}`);
    const next = script.indexOf('\n  function ', start + 10);
    return script.slice(start, next < 0 ? script.length : next);
  };
  assert.match(functionBody('activateBuildStepForRefs'), /for \(const ref of refs\)/);
  assert.match(functionBody('activateBuildStepForRefs'), /parsed\.kind === 'frame'/);
  assert.match(functionBody('activateBuildStepForRefs'), /state\.insertionFrameIndex = frameIndex/);
  // Umgezogen aus onPointerDown nach beginSelectGesture: dieselbe Geste wird
  // jetzt auch von den anderen Werkzeugen benutzt, wenn kein Gebaeude
  // gewaehlt ist. Die Zusicherung ist dieselbe.
  assert.match(functionBody('beginSelectGesture'), /activateBuildStepForRefs\(state\.selected\)/);
  assert.match(functionBody('onPointerUp'), /activateBuildStepForRefs\(state\.selected\)/);
});

test('Castle-only menu actions replace obsolete hidden toolbar controls', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.doesNotMatch(html, /id="castleDeleteSelectedBtn"|id="ucpCastleMappingBtn"/);
  assert.match(main, /function editMenuForWorkspace\(workspace\)/);
  assert.match(main, /workspace === 'character'/);
  assert.match(main, /workspace === 'castle'/);
  assert.match(main, /label: 'Edit Castle Mapping…'/);
  assert.match(main, /label: 'Customize Castle Shortcuts…'/);
  assert.match(main, /label: documentLabel \? `New \$\{documentLabel\}` : 'New'/);
  assert.match(preload, /onTriggerNewDocument/);
  assert.match(preload, /setActiveWorkspace/);
});

test('Castle tool shortcuts are editable, validated, and persisted locally', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(html, /id="castleShortcutDialog"/);
  assert.equal((html.match(/class="castleShortcutKey"/g) || []).length, 12);
  assert.match(script, /const DEFAULT_TOOL_SHORTCUTS/);
  assert.match(script, /localStorage\.setItem\(SHORTCUT_STORAGE_KEY/);
  assert.match(script, /assigned more than once/);
  assert.match(script, /function toolForShortcut\(key\)/);
  assert.match(script, /setTool\(shortcutTool\)/);
});

// --------------------------------------------------- Ctrl+C and Ctrl+V

test('Ctrl+C and Ctrl+V go through the copy tool, never around it', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const keys = functionBody(script, 'handleCastleKey');
  assert.match(keys, /\(event\.ctrlKey \|\| event\.metaKey\) && key === 'c'/);
  assert.match(keys, /\(event\.ctrlKey \|\| event\.metaKey\) && key === 'v'/);
  assert.match(keys, /key === 'c'\)\s*\{\s*\n?\s*event\.preventDefault\(\); copySelection\(\);/);
  assert.match(keys, /key === 'v'\)\s*\{\s*\n?\s*event\.preventDefault\(\); pasteCopy\(\);/);

  // One buffer, one check, one way of placing: the keys must reuse what the
  // marquee already uses, or a copy made with the keyboard could behave
  // differently from one made with the mouse.
  const copy = functionBody(script, 'copySelection');
  assert.match(copy, /captureCopyBuffer\(refs\)/, 'Ctrl+C fills the very same buffer');
  assert.match(copy, /p\.type !== geometry\.KEEP_ITEM_TYPE/, 'and leaves out the Keep, as the marquee does');
  const paste = functionBody(script, 'pasteCopy');
  assert.match(paste, /placeCopy\(state\.hoverTile\)/, 'Ctrl+V places where the cursor is');
  assert.match(paste, /if \(!state\.hoverTile\)/, 'and says so instead of guessing a spot');
  assert.ok(!/state\.document\.miscItems\.push/.test(copy + paste),
    'neither of them writes into the castle on its own');
});

test('typing in a field keeps its own Ctrl+C, and no menu steals the keys', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const keys = functionBody(script, 'handleCastleKey');
  const editing = keys.indexOf('const editing');
  const ctrlC = keys.indexOf("key === 'c'");
  assert.ok(editing > 0 && editing < ctrlC,
    'the check for an input field comes first, or a name could not be copied any more');

  // An accelerator in the application menu is caught by Electron BEFORE the
  // page sees the key - the handler above would then never run at all. So
  // the menu must not carry these two.
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.doesNotMatch(main, /accelerator:\s*'CmdOrCtrl\+C'/);
  assert.doesNotMatch(main, /accelerator:\s*'CmdOrCtrl\+V'/);
});


// ------------------------------------------- auswaehlen geht immer

test('without an item chosen, dragging is a selection box in every tool', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const down = functionBody(script, 'onPointerDown');

  // Die Weiche steht VOR den Werkzeug-Zweigen, sonst kaeme sie nie dran.
  const weiche = down.indexOf('const boxInstead');
  const ersterZweig = down.indexOf("state.tool === 'single'");
  assert.ok(weiche > 0 && weiche < ersterZweig,
    'die Weiche muss vor dem ersten Werkzeug-Zweig stehen');

  assert.match(down, /state\.currentItemType == null \|\| event\.ctrlKey \|\| event\.metaKey/,
    'ohne Gebaeude - oder mit Strg - wird ausgewaehlt');
  assert.match(down, /state\.tool === 'delete' \|\| \(state\.tool === 'copy' && state\.copyBuffer\)/,
    'ausgenommen sind die zwei Werkzeuge, die selbst eine Ziehgeste haben');
  assert.match(down, /if \(boxInstead && !ownsTheDrag\) \{[\s\S]{0,40}beginSelectGesture/,
    'und dann laeuft dieselbe Geste wie im Auswahl-Werkzeug');
});

test('placement tools are switched off while nothing is chosen', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const verfuegbar = functionBody(script, 'updateToolAvailability');
  assert.match(verfuegbar, /nothingChosen && isPlacementTool\(tool\)/,
    'ohne Gebaeude sind Single, Line und Brush gesperrt');

  // Ein gesperrtes Werkzeug darf nicht aktiv stehen bleiben.
  const raus = functionBody(script, 'leavePlacementToolIfDisabled');
  assert.match(raus, /state\.currentItemType == null && isPlacementTool\(state\.tool\)/);
  assert.match(raus, /setTool\('select'\)/);
  assert.match(functionBody(script, 'clearSelectionAndItem'), /leavePlacementToolIfDisabled\(\)/,
    'Esc waehlt ab und fuehrt aus dem gesperrten Werkzeug heraus');
});

test('a copy hangs from the middle of what was picked up, not from a corner', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const nehmen = functionBody(script, 'captureCopyBuffer');
  assert.match(nehmen, /const anchorX = Math\.round\(\(left \+ right\) \/ 2\)/);
  assert.match(nehmen, /const anchorY = Math\.round\(\(bottom \+ top\) \/ 2\)/);
  assert.doesNotMatch(nehmen, /anchorX = Math\.min/,
    'die alte Ecke als Ankerpunkt ist weg - sonst haengt die Kopie wieder rechts unten');
});
