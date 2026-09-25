'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm');
const geometry = require('../src/js/castle-geometry');
const camera = require('../src/js/castle-camera');
const palette = require('../src/js/castle-palette');
const categories = require('../config/aiv_categories.json').categories;
const allowed = Object.entries(require('../config/aiv_constants.json'))
  .filter(([, item]) => item.multiPlacement).map(([id]) => id);
const step = (itemType, offsets, shouldPause = false) => ({ itemType, tilePositionOfsets: offsets, shouldPause });

test('merge keeps earliest position, unrelated steps and offset order, with pauses disabled', () => {
  const source = [step(61, [5643]), step(25, [0, 1]), step(54, [400]), step(25, [1, 2], true)];
  const original = structuredClone(source);
  const result = geometry.mergeBuildSteps(source, [3, 1, 3], allowed);
  assert.equal(result.index, 1);
  assert.deepEqual(result.frames, [source[0], step(25, [0, 1, 2]), source[2]]);
  assert.deepEqual(source, original);
});

test('merge requires complete same-type wall, moat or pitch steps and refuses locks', () => {
  for (const type of allowed) {
    assert.equal(geometry.mergeBuildSteps([step(type, [0]), step(type, [1])], [0, 1], allowed).frames.length, 1);
  }
  assert.throws(() => geometry.mergeBuildSteps([step(25, [0]), step(26, [1])], [0, 1], allowed), /same item type/);
  assert.throws(() => geometry.mergeBuildSteps([step(106, [0]), step(99, [1])], [0, 1], allowed), /same item type/);
  assert.throws(() => geometry.mergeBuildSteps([step(54, [0]), step(54, [1])], [0, 1], allowed), /Only wall/);
  assert.throws(() => geometry.mergeBuildSteps([step(25, [0]), { ...step(25, [1]), locked: true }], [0, 1], allowed), /Unlock/);
  assert.throws(() => geometry.mergeBuildSteps([step(25, [0])], [0], allowed), /at least two/);
});

function placement(ref, x, y, type = 25, size = [1, 1]) { return { ref, x, y, type, size }; }
function flood(start, placements, locked = []) {
  return geometry.floodPlacementRefs(start, placements,
    p => geometry.footprintRectsAtXY(p.type, p.x, p.y, p.size), ref => locked.includes(ref));
}

test('flood delete connects diagonal corners across steps while excluding locked cells and other types', () => {
  const items = [placement('a', 0, 0), placement('b', 1, 0), placement('locked', 2, 0),
    placement('beyond', 3, 0), placement('diagonal', 2, 1), placement('other', 0, 1, 26)];
  assert.deepEqual(flood(items[0], items, ['locked']), new Set(['a', 'b', 'diagonal', 'beyond']));
  assert.deepEqual(flood(items[2], items, ['locked']), new Set());
  assert.deepEqual(flood(null, items), new Set());
});

test('a locked placement does not connect separated flood-delete regions', () => {
  const items = [placement('a', 0, 0), placement('locked', 1, 1), placement('b', 2, 2)];
  assert.deepEqual(flood(items[0], items, ['locked']), new Set(['a']));
});

test('flood delete uses whole building footprints and protects the Keep', () => {
  const items = [placement('a', 0, 1, 54, [2, 2]), placement('b', 2, 2, 54), placement('gap', 4, 2, 54)];
  assert.deepEqual(flood(items[0], items), new Set(['a', 'b']));
  const keep = placement('keep', 43, 56, 61);
  assert.deepEqual(flood(keep, [keep]), new Set());
});

test('flood delete covers the full map rather than silently truncating at fill-tool limit', () => {
  const items = Array.from({ length: 10000 }, (_, off) => placement(String(off), off % 100, Math.floor(off / 100), 106));
  assert.equal(flood(items[0], items).size, 10000);
});

test('camera preferences round-trip, reject conflicts and leave modified shortcuts alone', () => {
  const preferences = camera.validate(JSON.parse(JSON.stringify(camera.arrows)), { single: ['1', 's'] });
  assert.deepEqual(preferences, camera.arrows);
  assert.deepEqual(camera.keyDelta({ key: 'ArrowRight' }, preferences), { x: -40, y: 0 });
  assert.deepEqual(camera.keyDelta({ key: 'ArrowUp', shiftKey: true }, preferences), { x: 0, y: 120 });
  assert.equal(camera.keyDelta({ key: 'ArrowRight', ctrlKey: true }, preferences), null);
  assert.equal(camera.keyDelta({ key: 'ArrowRight' }, camera.legacy), null);
  assert.throws(() => camera.validate({ ...camera.arrows, left: 's' }, { single: ['s'] }), /already assigned/);
  assert.throws(() => camera.validate({ ...camera.arrows, left: 'c' }, { rotateLeft: ['c'] }), /already assigned/);
  assert.equal(camera.validate({ ...camera.arrows, left: 'c' }, { rotateLeft: ['alt+c'] }).left, 'c');
  assert.throws(() => camera.validate({ ...camera.arrows, left: 'ArrowUp' }), /already assigned/);
  assert.throws(() => camera.validate({ ...camera.arrows, panSpeed: 0 }), /speed/);
  assert.equal(camera.validate({ ...camera.legacy, left: 'A' }).left, 'a');
});

test('camera wheel presets are shared by both views and support modifier panning', () => {
  assert.equal(camera.wheelAction({}, camera.legacy), 'panY');
  assert.equal(camera.wheelAction({ altKey: true }, camera.legacy), 'zoom');
  assert.equal(camera.wheelAction({ ctrlKey: true }, camera.legacy), 'panX');
  assert.equal(camera.wheelAction({}, camera.legacy, true), 'panY');
  for (const iso of [false, true]) {
    assert.equal(camera.wheelAction({}, camera.arrows, iso), 'zoom');
    assert.equal(camera.wheelAction({ shiftKey: true }, camera.arrows, iso), 'panY');
    assert.equal(camera.wheelAction({ ctrlKey: true }, camera.arrows, iso), 'panX');
  }
});

// Exercise the editor's actual control function without starting Electron.
test('brush size controls work for every tool, retaining size limits', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
  const start = source.indexOf('  function updateBrushSizeUI()');
  const end = source.indexOf('\n  function ', start + 10);
  const state = { tool: 'select', brushSize: 5 };
  const els = { brushSizeInput: {}, brushMinus: {}, brushPlus: {} };
  const context = vm.createContext({ state, els, geometry });
  vm.runInContext(source.slice(start, end), context);
  for (const tool of ['single', 'brush', 'select', 'delete', 'copy', 'replace', 'line', 'bucket']) {
    state.tool = tool;
    vm.runInContext('updateBrushSizeUI()', context);
    assert.equal(els.brushMinus.disabled, false, tool);
    assert.equal(els.brushPlus.disabled, false, tool);
    assert.equal(els.brushSizeInput.value, '5', tool);
    assert.equal(els.brushSizeInput.max, String(geometry.GRID_SIZE), tool);
  }
  state.brushSize = 1;
  vm.runInContext('updateBrushSizeUI()', context);
  assert.equal(els.brushMinus.disabled, true);
  assert.equal(els.brushSizeInput.value, '1');
  state.brushSize = 100;
  vm.runInContext('updateBrushSizeUI()', context);
  assert.equal(els.brushPlus.disabled, true);
  assert.equal(els.brushSizeInput.value, '100');
});

test('every configured item has a readable name and every category has a persistent color', () => {
  const constants = require('../config/aiv_constants.json');
  for (const [type, info] of Object.entries(constants)) {
    assert.ok(typeof info.name === 'string' && info.name.trim(), `missing name for ${type}`);
    assert.equal(palette.itemName(constants, type), info.name.trim());
  }
  for (const category of Object.keys(categories)) {
    assert.match(palette.colors[category], /^#[0-9a-f]{6}$/i, category);
  }
  assert.equal(palette.itemName({ 25: { name: '  ' } }, 25), 'Item 25');
  assert.equal(palette.itemName({}, 123456), 'Item 123456');
  assert.equal(palette.itemName({ 25: { name: ' Wall ' } }, 25), 'Wall');
  assert.equal(palette.categoryStyle('Food').background, '#f8f8c0');
  assert.equal(palette.categoryStyle('Bad Things').background, '#f88080');
  assert.equal(palette.categoryStyle('Military').background, '#88b0b8');
});

test('hover names include units and one-tile items, with a safe fallback for unknown types', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
  const start = source.indexOf('  function itemLabelAtTile(');
  const end = source.indexOf('\n  function ', start + 10);
  const constants = require('../config/aiv_constants.json');
  const context = vm.createContext({
    document: {getElementById:()=>({checked:false})},
    topmostRefAtTile: tile => tile.x === 0 ? null : 'placement',
    refType: () => 25,
    itemName: type => palette.itemName(constants, type)
  });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(vm.runInContext('itemLabelAtTile(null)', context), '');
  assert.equal(vm.runInContext('itemLabelAtTile({x: 0, y: 0})', context), '');
  for (const type of [25, 106, 1, 123456]) {
    context.refType = () => type;
    assert.equal(vm.runInContext('itemLabelAtTile({x: 1, y: 1})', context), `${palette.itemName(constants, type)} [${type}]`);
  }
});


test('path-map hover reports blocked entrances and walkability even without item labels',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/js/castle-editor.js'),'utf8');
  const start=source.indexOf('  function itemLabelAtTile('),end=source.indexOf('\n  function ',start+10);
  const walkability=new Uint8Array(10000);walkability[101]=3;
  const context=vm.createContext({document:{getElementById:()=>({checked:true})},GRID:100,
    analysisCache:{walkability,routes:[{entry:{x:2,y:2},name:'Fletcher',workers:1,reason:'Entrance blocked on all sides'}]},
    topmostRefAtTile:()=>null,itemName:()=>'',refType:()=>0});
  vm.runInContext(source.slice(start,end),context);
  assert.match(vm.runInContext('itemLabelAtTile({x:2,y:2})',context),/Fletcher: 1 worker.*blocked/);
  assert.equal(vm.runInContext('itemLabelAtTile({x:1,y:1})',context),'Ground passage and raised walkway');
  assert.equal(vm.runInContext('itemLabelAtTile({x:0,y:0})',context),'Blocked tile');
});


test('flood selection includes diagonal same-type placements and preserves modifier semantics without edits',()=>{
  const editor=fs.readFileSync(path.join(__dirname,'../src/js/castle-editor.js'),'utf8');
  const begin=editor.indexOf('  function floodSelect('),end=editor.indexOf('\n  function ',begin+10);
  const items=[{ref:'a',type:25,off:101},{ref:'b',type:25,off:202},{ref:'gap',type:25,off:505},{ref:'other',type:26,off:102}];
  const state={selected:new Set(),gesture:'move',currentItemType:25};
  const context=vm.createContext({state,geometry,GRID:100,placementRefs:()=>items,
    topmostRefAtTile:tile=>items.find(p=>p.off===tile.y*100+tile.x)?.ref,
    footprintRects:(type,off)=>[{left:off%100,right:off%100,bottom:Math.floor(off/100),top:Math.floor(off/100)}],
    activateBuildStepForRefs:()=>{},updateToolAvailability:()=>{},renderPalette:()=>{},updateSelectedItemInfo:()=>{},renderBuildList:()=>{},scheduleDraw:()=>{},setStatus:()=>{}});
  vm.runInContext(editor.slice(begin,end),context);
  const click=(x,y,event={})=>context.floodSelect({x,y},event);
  click(1,1);assert.deepEqual([...state.selected],['a','b']);assert.equal(state.gesture,null);
  click(5,5,{shiftKey:true});assert.deepEqual([...state.selected],['a','b','gap']);
  click(1,1,{ctrlKey:true});assert.deepEqual([...state.selected],['gap']);
  click(1,1,{metaKey:true});assert.deepEqual([...state.selected],['gap','a','b']);
  click(0,0,{shiftKey:true});assert.equal(state.selected.size,3);
  click(0,0);assert.equal(state.selected.size,0);
  assert.deepEqual(items.map(p=>p.off),[101,202,505,102]);
});
test('non-destructive connected selection can include a Keep while deletion still protects it',()=>{
  const keep=placement('keep',43,56,61);
  assert.deepEqual(geometry.floodPlacementRefs(keep,[keep],p=>geometry.footprintRectsAtXY(p.type,p.x,p.y),()=>false,100,false),new Set(['keep']));
  assert.deepEqual(flood(keep,[keep]),new Set());
});

test('units without game art show a short name on a disc, Europeans blue and Arabians ochre', () => {
  const categories = require('../config/aiv_categories.json');
  const groups = categories.categories || categories;
  for (const [faction, fill] of [['Europeans', '#3d6fb6'], ['Arabians', '#b8862f']]) {
    for (const id of groups[faction]) {
      const badge = palette.unitBadge(id);
      assert.ok(badge, faction + ' ' + id);
      assert.match(badge.text, /^[A-Za-z]{2,3}$/);
      assert.equal(badge.fill, fill, faction + ' ' + id);
    }
  }
  const texts = Array.from({ length: 21 }, (_, i) => palette.unitBadge(i + 1).text);
  assert.equal(new Set(texts).size, 21, 'every unit has its own short name');
  assert.equal(palette.unitBadge(61), null, 'buildings get no badge');
});
