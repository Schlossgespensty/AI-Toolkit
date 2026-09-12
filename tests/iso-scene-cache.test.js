const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function renderer() {
  const source = fs.readFileSync(require.resolve('../src/js/iso-view.js'), 'utf8');
  const draws = [], scenes = [], callbacks = [];
  const state = { fitted: true, view: { zoom: 1, panX: 100, panY: 50 }, catalogue: {} };
  const context = vm.createContext({
    state, MAP_MARGIN: 5, geo: { GRID: 100 }, window: {},
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) },
    hostIsGone: () => false,
    surface: () => ({width: 800, height: 600, ctx: {clearRect() {}, drawImage(...args) { draws.push(args); }}}),
    currentRotation: () => state.rotation || 0, terrainKey: () => state.mapKey || '',
    mapMode: () => 'native', groundFit: () => 'stretch', groundSource: () => state.ground || '',
    vorrat: () => null, paintInteraction() {}, setStatus() {}, mapStatus: () => '',
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
    () => { r.state.terrain = {}; },
    () => { r.state.ground = 'new image'; }
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
