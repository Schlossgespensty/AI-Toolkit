const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const geometry = require('../src/js/castle-geometry');
const source = fs.readFileSync(require.resolve('../src/js/castle-editor.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('holding slider arrows accelerates after one and two seconds and resets on release', () => {
  let now = 0, updates = 0;
  const handlers = {};
  const slider = {value:'50', addEventListener(name, callback) {handlers[name]=callback;}};
  const context = vm.createContext({els:{buildSlider:slider}, performance:{now:()=>now},
    frames:()=>Array(100), selectBuildStepFromSlider:()=>updates++});
  vm.runInContext(section('  let scrubKey = null;', "  window.addEventListener('character-population-changed'"), context);
  const key = (name, repeat=false, extras={}) => handlers.keydown({key:name,repeat,preventDefault(){},stopPropagation(){},...extras});
  key('ArrowRight'); assert.equal(slider.value,'51');
  now=999; key('ArrowRight',true); assert.equal(slider.value,'52');
  now=1000; key('ArrowRight',true); assert.equal(slider.value,'55');
  now=2000; key('ArrowRight',true); assert.equal(slider.value,'60');
  key('ArrowLeft',true); assert.equal(slider.value,'59','changing direction restarts acceleration');
  now=4000; key('ArrowLeft',true); assert.equal(slider.value,'54');
  for (const reset of ['keyup','blur','pointerdown']) {
    handlers[reset](); key('ArrowLeft',true); assert.equal(slider.value,String(53-['keyup','blur','pointerdown'].indexOf(reset)));
  }
  slider.value='100'; key('ArrowRight'); assert.equal(slider.value,'100');
  slider.value='1'; key('ArrowLeft'); assert.equal(slider.value,'1');
  const before=updates; key('ArrowRight',false,{ctrlKey:true}); key('a'); assert.equal(updates,before);
});

function setup() {
  let created = 0;
  const scrolled = [];
  const make = () => {
    created++;
    const node = {children: [], dataset: {}, style: {}, attributes: {}, handlers: {},
      append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); },
      addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; }, focus() {},
      scrollIntoView(options) { scrolled.push({index: Number(this.dataset.index), current: this.attributes['aria-current'], block: options.block}); },
      classList: {add(key) { this[key] = true; }, remove(key) { this[key] = false; }, toggle(key, value) { this[key] = value; }, contains(key) { return this[key] === true; }}};
    Object.defineProperty(node, 'innerHTML', {set() { this.children = []; }});
    return node;
  };
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); };
  const doc = {frames: Array.from({length: 100}, (_, i) => ({itemType: 25, tilePositionOfsets: [i]})), miscItems: []};
  const state = {document: doc, documentRevision: 1, selected: new Set(['f:0:0']), insertionFrameIndex: 0};
  const els = Object.fromEntries(['buildList', 'buildSlider', 'buildSliderValue', 'buildCount'].map(key => [key, make()]));
  els.buildList.querySelector = () => els.buildList.children[state.insertionFrameIndex];
  const callbacks = [], selections = [];
  const context = vm.createContext({state, els, geometry, analysisTimer:null, analysisSerial:0, analysisCache:{},
    document: {createElement: make, getElementById: get}, window: {innerWidth: 800, innerHeight: 600},
    frames: () => doc.frames, frameRefKey: (fi, oi) => `f:${fi}:${oi}`, itemName: () => 'Wall', isUnitType: () => false,
    updatePopulationPanel() {}, updateCostPanel() {}, scheduleDraw() {}, setStatus() {},
    requestAnimationFrame: fn => callbacks.push(fn), clearTimeout() {}, setTimeout() {},
    selectBuildFrame: fi => { state.insertionFrameIndex = fi; state.selected = new Set([`f:${fi}:0`]); selections.push(fi); },
    selectedBuildFrameIndexes: () => [...state.selected].map(ref => Number(ref.split(':')[1])),
    frameIsLocked: fi => Boolean(doc.frames[fi].locked), mergeableTypes: () => [25], mergeSelectedSteps() {}
  });
  vm.runInContext(section('  function renderBuildList(', '  function unlockedFrameIndexes('), context);
  vm.runInContext(section('  function closeBuildContextMenu(', '  function placeSingle('), context);
  vm.runInContext(section('  function toggleFrameLock(', '  function deleteRefs('), context);
  return {context, state, els, doc, get, callbacks, selections, scrolled, get created() { return created; }};
}

function mapSelectionSetup() {
  const h = setup();
  Object.assign(h.context, {
    hit: 'f:78:0', marquee: new Set(),
    topmostRefAtTile: () => h.context.hit,
    refExists: ref => /^f:\d+:0$/.test(ref) || ref === 'u:0',
    parseRef: ref => ref.startsWith('u:') ? {kind: 'unit', mi: 0} : {kind: 'frame', fi: Number(ref.split(':')[1])},
    refIsLocked: ref => Boolean(h.doc.frames[Number(ref.split(':')[1])]?.locked), refOffset: () => 0,
    updateToolAvailability() {}, renderPalette() {}, updateSelectedItemInfo() {},
    refsInMarquee: () => new Set(h.context.marquee), fromOutside: () => true,
    placementRefs: () => [...h.context.marquee].map(ref => ({ref})), footprintRects: () => [], GRID: 100,
    geometry: {...geometry, floodPlacementRefs: () => new Set(h.context.marquee)}
  });
  vm.runInContext(section('  function activateBuildStepForRefs(', '  function updateBuildSelection('), h.context);
  vm.runInContext(section('  function beginSelectGesture(', '  function onPointerMove('), h.context);
  vm.runInContext(section('  function onPointerUp(', '  function onWheel('), h.context);
  vm.runInContext(section('  function floodSelect(', '  function floodDelete('), h.context);
  h.context.renderBuildList();
  return h;
}

test('map selection reveals the active row after updating it, including locked and additive selections', () => {
  for (const event of [{}, {shiftKey: true}, {ctrlKey: true}, {metaKey: true}]) {
    for (const locked of [false, true]) {
      const h = mapSelectionSetup();
      h.doc.frames[78].locked = locked;
      h.context.beginSelectGesture({x: 10, y: 10}, event);
      assert.equal(h.state.insertionFrameIndex, 78);
      assert.deepEqual(h.scrolled, [{index: 78, current: 'step', block: 'nearest'}]);
      assert.equal(h.state.gesture, (locked && !event.shiftKey) || event.ctrlKey || event.metaKey ? null : 'move');
      assert.equal(h.state.documentRevision, 1, 'revealing a row does not edit the castle');
    }
  }
});

test('empty-map clicks, unit-only clicks and removing the last selected placement do not reveal a stale step', () => {
  for (const hit of [null, 'u:0', 'f:78:0']) {
    const h = mapSelectionSetup(); h.context.hit = hit;
    const event = hit === 'f:78:0' ? {ctrlKey: true} : {};
    h.state.selected = new Set(hit === 'f:78:0' ? [hit] : []);
    h.context.beginSelectGesture({x: 10, y: 10}, event);
    assert.equal(h.scrolled.length, 0);
  }
});

test('completed area and flood selections reveal their existing active-step choice', () => {
  for (const flood of [false, true]) {
    const h = mapSelectionSetup();
    h.context.marquee = new Set(['f:20:0', 'f:60:0']);
    h.state.gesture = 'select-marquee';
    if (flood) h.context.floodSelect({x: 10, y: 10}, {});
    else h.context.onPointerUp({button: 0});
    assert.deepEqual(h.scrolled, [{index: 60, current: 'step', block: 'nearest'}]);
    assert.equal(h.state.insertionFrameIndex, 60);
  }
});

test('scrubbing updates existing build rows without replacing their DOM or handlers', () => {
  const h = setup(); h.context.renderBuildList();
  const rows = [...h.els.buildList.children], created = h.created;
  for (let step = 0; step < 100; step++) {
    h.context.selectBuildFrame(step); h.context.renderBuildList();
  }
  assert.equal(h.created, created);
  assert.deepEqual(h.els.buildList.children, rows);
  assert.equal(rows[99].attributes['aria-current'], 'step');
  assert.equal(rows[0].classList.selected, false);
  h.doc.frames[99].locked = true; h.context.renderBuildList();
  assert.equal(rows[99].draggable, false); assert.equal(rows[99].classList.locked, true);
  h.state.documentRevision++; h.context.renderBuildList();
  assert.notEqual(h.els.buildList.children[0], rows[0], 'document edits rebuild row content');
});

test('rapid slider input performs one update at the latest selected step', () => {
  const h = setup(); h.context.renderBuildList();
  for (let step = 1; step <= 100; step++) {
    h.els.buildSlider.value = String(step); h.context.selectBuildStepFromSlider();
  }
  assert.equal(h.callbacks.length, 1);
  h.callbacks.shift()();
  assert.deepEqual(h.selections, [99]);
  assert.equal(h.state.scrubPending, false);
  h.context.selectBuildStepFromSlider(); h.callbacks.shift()();
  assert.deepEqual(h.selections, [99], 'repeated input at the same step does not schedule another render');
});

test('scrubbing refreshes visible rows without overwriting a newer thumb position', () => {
  const h = setup(); h.context.renderBuildList();
  h.state.buildListViewport = {top: 70 * 42, height: 5 * 42};
  h.context.selectBuildFrame(72); h.context.renderBuildList(true);
  const rows = h.els.buildList.children;
  assert.equal(rows[72].attributes['aria-current'], 'step');
  assert.equal(rows[74].classList.future, true);
  assert.equal(rows[90]._buildState, undefined, 'offscreen rows are not refreshed');
  h.state.buildListViewport = {top: 10 * 42, height: 5 * 42};
  h.context.selectBuildFrame(12); h.context.renderBuildList(true);
  assert.equal(rows[72].attributes['aria-current'], undefined, 'previous active row is cleared');
  assert.equal(rows[12].attributes['aria-current'], 'step');
  h.state.scrubPending = true; h.els.buildSlider.value = '83';
  h.context.renderBuildList(true);
  assert.equal(h.els.buildSlider.value, '83', 'list scrolling must not snap the thumb back');
});

test('right-click preserves a multi-step selection and locks/unlocks all selected positions', () => {
  const h = setup(); h.context.renderBuildList();
  h.state.selected = new Set(['f:1:0', 'f:2:0']);
  const event = {clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {}};
  h.context.openBuildContextMenu(event, 2);
  assert.equal(h.get('castleContextMerge').disabled, false);
  assert.equal(h.get('castleContextLock').textContent, 'Lock positions');
  assert.deepEqual([...h.state.selected], ['f:1:0', 'f:2:0']);
  h.get('castleContextLock').onclick();
  assert.ok(h.doc.frames[1].locked && h.doc.frames[2].locked);
  assert.equal(h.get('castleBuildContextMenu').hidden, true);
  h.context.openBuildContextMenu(event, 1);
  assert.equal(h.get('castleContextLock').textContent, 'Unlock positions');
  assert.equal(h.get('castleContextMerge').disabled, true);
  h.get('castleContextLock').onclick();
  assert.ok(!h.doc.frames[1].locked && !h.doc.frames[2].locked);
  h.context.openBuildContextMenu(event, 4);
  assert.deepEqual([...h.state.selected], ['f:4:0'], 'right-click outside selection targets only that step');
  assert.equal(h.get('castleContextMerge').disabled, true);
});

test('scrubbing defers analysis until the latest position settles and rejects earlier results', () => {
  const timers=new Map();let serial=0,draws=0;
  const h={state:{},analysisTimer:7,analysisSerial:4,analysisCache:{image:'old'},
    clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++serial,fn);return serial;},scheduleDraw:()=>draws++};
  vm.createContext(h);
  vm.runInContext(section('  function deferAnalysisOverlay()', '  function selectBuildStepFromSlider()'),h);
  h.deferAnalysisOverlay();h.deferAnalysisOverlay();
  assert.equal(h.state.scrubbing,true);assert.equal(h.analysisSerial,6);
  assert.equal(h.analysisCache.image,undefined);assert.equal(timers.size,1);
  vm.runInContext(section('  function getAnalysisOverlay(', '  function drawAnalysisOverlay('),h);
  assert.equal(h.getAnalysisOverlay().routes.length,0,'no DOM, terrain or worker work while scrubbing');
  [...timers.values()][0]();assert.equal(h.state.scrubbing,false);assert.equal(draws,1);
});
