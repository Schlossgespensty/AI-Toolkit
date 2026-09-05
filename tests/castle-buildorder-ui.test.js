const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

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
  assert.match(script, /drawBlueprint\(mapSize\);\s*if \(els\.showCompatibility\.checked\) drawCompatibilityGuide\(mapSize\);\s*drawGrid\(mapSize\);/);
  const outputStart = script.indexOf('function outputDocument()');
  const outputEnd = script.indexOf('\n  function outputContent()', outputStart);
  assert.doesNotMatch(script.slice(outputStart, outputEnd), /blueprint/i);
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
  assert.match(functionBody('onPointerDown'), /activateBuildStepForRefs\(state\.selected\)/);
  assert.match(functionBody('onPointerUp'), /activateBuildStepForRefs\(state\.selected\)/);
});

test('Castle-only menu actions replace obsolete hidden toolbar controls', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.doesNotMatch(html, /id="castleShowNames"|id="castleDeleteSelectedBtn"|id="ucpCastleMappingBtn"/);
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
