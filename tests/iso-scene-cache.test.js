const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');

function renderer() {
  const source = fs.readFileSync(require.resolve('../src/js/iso-view.js'), 'utf8');
  const draws = [], scenes = [], callbacks = [];
  const state = { fitted: true, view: { zoom: 1, panX: 100, panY: 50 }, catalogue: {} };
  const context = vm.createContext({
    state, MAP_MARGIN: 5, geo: { GRID: 100 }, window: {},
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) },
    hostIsGone: () => false, gameMap:()=>null,
    surface: () => ({width: 800, height: 600, ctx: {clearRect() {}, drawImage(...args) { draws.push(args); }}}),
    currentRotation: () => state.rotation || 0, kartenSchluessel: () => state.mapKey || '',
    vorrat: () => null, paintInteraction() {}, setStatus() {}, mapStatus: () => '',
    // In dieser Attrappe liegt keine Karte, also gibt es auch keine
    // Startplatzmarken zu treffen.
    startPlaceAt: () => null, setGameMapKeep() {},
    paintScene(ctx, width, height) { scenes.push({...state.view}); return {items: [], missing: 0}; },
    requestAnimationFrame: fn => callbacks.push(fn)
  });
  vm.runInContext(source.slice(source.indexOf('  function paint()'), source.indexOf('  function paintScene(')), context);
  return { state, draws, scenes, context };
}

test('pan and zoom reuse native scene while preserving its world anchor', () => {
  const r = renderer(); r.context.paint();
  const original = r.draws.at(-1);
  r.state.view = {zoom: 2, panX: 210, panY: 80}; r.context.paint();
  assert.equal(r.scenes.length, 1);
  const next = r.draws.at(-1);
  assert.equal(next[0], original[0]);
  assert.equal(next[1], 210 - r.scenes[0].panX * 2);
  assert.equal(next[2], 80 - r.scenes[0].panY * 2);
  assert.equal(next[3], original[3] * 2);
  assert.equal(next[4], original[4] * 2);
});

test('edit, step, camera, map and late image changes cannot leave stale scenery', () => {
  const r = renderer(); r.context.paint();
  for (const change of [
    () => { r.state.sceneDirty = true; }, // editor notification includes build-step changes
    () => { r.state.rotation = 2; },
    () => { r.state.mapKey = 'another keep'; },
    () => { r.state.kachelVorrat = {}; },
    () => { r.state.sceneDirty = true; r.state.assetRevision = 1; }
  ]) {
    const count = r.scenes.length; change(); r.context.paint();
    assert.equal(r.scenes.length, count + 1);
    r.context.paint(); assert.equal(r.scenes.length, count + 1);
    assert.equal(r.state.view.panX, 100, 'offscreen rendering restores interactive camera');
  }
});

test('2D viewport and selection repaint notifications do not rebuild the isometric scene', () => {
  const source = fs.readFileSync(require.resolve('../src/js/iso-view.js'), 'utf8');
  let doc = {frames: [{itemType: 25, tilePositionOfsets: [12]}]}, step = 0;
  const refreshes = [];
  const context = vm.createContext({state: {}, currentDocument: () => doc,
    window: {castleEditor: {getActiveBuildStep: () => step}}, refresh: reuse => refreshes.push(reuse)});
  vm.runInContext(source.slice(source.indexOf('  function editorChanged('), source.indexOf('  function init()')), context);
  context.editorChanged(true); context.editorChanged(true); context.editorChanged(false);
  doc.frames[0].tilePositionOfsets.push(13); context.editorChanged(true);
  step = 1; context.editorChanged(true); context.editorChanged(true);
  assert.deepEqual(refreshes, [false, true, true, false, false, true]);
});

function interactiveRenderer() {
  const r = renderer();
  const source = fs.readFileSync(require.resolve('../src/js/iso-view.js'), 'utf8');
  const listeners = {}, inputs = [], clears = [];
  const canvas = {
    style: {},         // der Zeiger wechselt ueber einer Startplatzmarke
    focus() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({left: 0, top: 0}),
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  r.state.bound = new WeakSet();
  r.context.window.castlePieMenu = {bind: (_canvas, run) => { listeners.contextmenu = event => { event.preventDefault(); run('deselect'); }; }};
  r.context.window.castleCamera = require('../src/js/castle-camera');
  r.context.window.castleEditor = {
    pointerFromOutside: (phase, event) => inputs.push({phase, event}),
    runContextAction: action => { if (action === 'deselect') clears.push(true); }
  };
  Object.assign(r.context, {
    refresh: reuse => { if (reuse !== true) r.state.sceneDirty = true; },
    editorTileAt: (x, y) => ({x, y}), lastHoverTile: () => ({x: 0, y: 0}), bodenHoehe: () => 0
  });
  r.context.geo.tileFromPoint = (x, y) => ({gx: x, gy: y});
  vm.runInContext(source.slice(source.indexOf('  function pointOf('), source.indexOf('  function bindHostChrome(')), r.context);
  r.context.bindSurface(canvas);
  const fire = (name, overrides = {}) => listeners[name]({button: 0, pointerId: 1,
    clientX: 200, clientY: 150, deltaY: 0, deltaX: 0, preventDefault() {}, ...overrides});
  return {...r, fire, inputs, clears};
}

test('drag overlays reuse the scene throughout selection and delete gestures', () => {
  for (const tool of ['select', 'delete', 'copy', 'replace']) {
    const r = interactiveRenderer();
    r.context.window.castleEditor.getTool = () => tool;
    r.context.paint();
    r.fire('pointerdown');
    assert.equal(r.state.drawing, true);
    for (let x = 0; x < 100; x++) {
      r.fire('pointermove', {clientX: x}); r.context.paint();
    }
    r.fire('pointerup'); r.context.paint();
    assert.equal(r.scenes.length, 1, `${tool}: pointer-only changes must not rebuild terrain`);
    assert.equal(r.inputs.length, 102);
    assert.equal(r.state.drawing, false);
    // An actual edit still invalidates and rebuilds once.
    r.state.sceneDirty = true; r.context.paint();
    assert.equal(r.scenes.length, 2);
  }
});

test('2.5D right-click deselects without panning or placing; middle-drag pans', () => {
  const r = interactiveRenderer();
  r.fire('pointerdown', {button: 2});
  r.fire('contextmenu', {button: 2});
  r.fire('pointerup', {button: 2});
  assert.equal(r.clears.length, 1);
  assert.equal(r.inputs.length, 0);
  assert.ok(!r.state.panning);
  r.fire('pointerdown', {button: 1});
  r.fire('pointermove', {clientX: 220, clientY: 180});
  assert.deepEqual(r.state.view, {zoom: 1, panX: 120, panY: 80});
  r.fire('pointerup', {button: 1});
  assert.equal(r.state.panning, false);
  assert.equal(r.inputs.length, 0);
});

test('2.5D wheel uses Map modifiers in both presets and zoom stays anchored at the pointer', () => {
  const r = interactiveRenderer(), camera = r.context.window.castleCamera;
  for (const preferences of [camera.legacy, camera.defaults]) {
    r.context.window.castleEditor.getCameraPreferences = () => preferences;
    for (const modifiers of [{}, {ctrlKey: true}, {altKey: true}, {shiftKey: true}]) {
      r.state.view = {zoom: 1, panX: 100, panY: 50};
      const action = camera.wheelAction(modifiers, preferences);
      r.fire('wheel', {deltaY: -20, ...modifiers});
      if (action === 'zoom') {
        const v = r.state.view;
        assert.ok(v.zoom > 1);
        assert.ok(Math.abs((200 - v.panX) / v.zoom - 100) < 1e-9);
        assert.ok(Math.abs((150 - v.panY) / v.zoom - 100) < 1e-9);
      } else {
        assert.equal(r.state.view.zoom, 1);
        assert.equal(r.state.view[action], action === 'panX' ? 120 : 70);
      }
    }
  }
});


test('a selected map waits for its atlas and reports errors without painting fallback scenery',()=>{
 const r=renderer(),messages=[];let hidden=0;
 r.context.gameMap=()=>({path:'map'});r.context.hasMapTiles=()=>false;
 r.state.gpu={hide(){hidden++;}};
 r.context.surface=()=>({width:800,height:600,ctx:{clearRect(){},fillRect(){},fillText(text){messages.push(text);}}});
 r.context.paint();assert.equal(r.scenes.length,0);assert.equal(messages.at(-1),'Loading map...');
 r.state.mapLoadError='Could not load map';r.context.paint();
 assert.equal(messages.at(-1),r.state.mapLoadError);assert.equal(hidden,2);
});
