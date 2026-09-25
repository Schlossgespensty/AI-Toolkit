const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/js/castle-editor.js'), 'utf8');
const start = source.indexOf('  function renderCastlePicture(');
const end = source.indexOf('\n  els.showBlueprint.addEventListener', start);
function setup(fail = false) {
  const state = {cell: 4, panX: -500, panY: 37, canvasWidth: 800, canvasHeight: 600, gesture: 'move', staticCacheDirty: true, snapshotLabels: false, floorPlan: false, selected: new Set(['f:0:0']),
    skinImages: {25: {complete: true, naturalWidth: 40, naturalHeight: 40}}};
  const rendered = [];
  const original = {...state};
  const els = {showCompatibility:{checked:false}, showNames:{checked:true}};
  const context = vm.createContext({state, GRID: 100, ctx: 'screen',
    placementRefs: () => [{type:25}], itemSize: () => [1,1], imageReady: () => true,
    document: {createElement: () => ({getContext: () => 'export', toDataURL: () => {if(fail) throw Error('encoding failed'); return 'png';}})},
    rebuildStaticCache: (target, future) => rendered.push({width: target.width, height: target.height, futureWidth:future.width, cell:state.cell, x:state.panX, y:state.panY,
      labels: state.snapshotLabels, plan: state.floorPlan, names: els.showNames.checked, selected: state.selected.size}),
    floorPlanPixels: (picture, cell) => ({toDataURL: () => `plan ${picture.width}/${cell}`}),
    drawUnitMarkers() { rendered.push('units'); }, drawCompatibilityOriginMarker() {}, els
  });
  vm.runInContext(source.slice(start,end), context);
  return {context,state,original,rendered};
}
test('castle pictures render the whole grid at native sprite resolution regardless of viewport', () => {
  const r=setup();
  assert.equal(r.context.renderCastlePicture(),'png');
  assert.deepEqual(r.rendered[0],{width:4000,height:4000,futureWidth:4000,cell:40,x:0,y:0,labels:true,plan:false,names:true,selected:1});
  assert.equal(r.rendered[1],'units');
  r.rendered.length=1;
  assert.deepEqual(r.state,r.original);
  r.state.cell=19;r.state.panX=100;
  r.context.renderCastlePicture();
  assert.deepEqual(r.rendered[1],r.rendered[0]);
  assert.equal(r.context.ctx,'screen');
});
test('floor plans sample the full-resolution picture without names, selection or unit markers', () => {
  const r=setup();
  assert.equal(r.context.renderCastlePicture({floorPlan:true}),'plan 4000/40');
  assert.deepEqual(r.rendered,[{width:4000,height:4000,futureWidth:4000,cell:40,x:0,y:0,labels:false,plan:true,names:false,selected:0}]);
  assert.deepEqual(r.state,r.original);
  assert.equal(r.context.els.showNames.checked,true,'the name overlay is switched back on');
  assert.equal(r.context.ctx,'screen');
});
test('floor plans draw every building on transparent ground without troops or overlays', () => {
  const first = source.indexOf('  function clearCacheContext('), last = source.indexOf('\n  let analysisCache', first);
  const calls = [];
  const canvas = name => ({width: 100, height: 100, getContext: () => ({save() {}, restore() {}, setTransform() {}, fillRect: () => calls.push(`${name} fill`),
    clearRect: () => calls.push(`${name} clear`), drawImage: () => calls.push(`${name} image`)})});
  const state = {floorPlan: true, gesture: null, insertionFrameIndex: 0, selected: new Set(), canvasWidth: 100, canvasHeight: 100, cell: 1, panX: 0, panY: 0};
  const context = vm.createContext({state, GRID: 100, ctx: null, displayCtx: 'screen', mapBackground: {complete: true, naturalWidth: 1},
    staticCacheCanvas: null, futureCacheCanvas: null, els: {showCompatibility: {checked: true}},
    placementRefs: () => [{kind: 'item', type: 25, off: 1, fi: 0}, {kind: 'item', type: 54, off: 2, fi: 5}, {kind: 'unit', type: 900, off: 3, fi: 0}],
    drawPlacement: type => calls.push(`draw ${type}`), drawPlacementOutline() {}, drawAnalysisOverlay: () => calls.push('overlay'),
    drawBlueprint: () => calls.push('blueprint'), drawCompatibilityGuide: () => calls.push('guide'), drawGrid: () => calls.push('grid'), css: () => '', FUTURE_TINT: '', FUTURE_OPACITY: 1, FUTURE_FILTER: ''});
  vm.runInContext(source.slice(first, last), context);
  context.rebuildStaticCache(canvas('picture'), canvas('future'));
  assert.deepEqual(calls, ['picture clear', 'draw 25', 'draw 54'], 'only the castle, all steps at full strength');
  calls.length = 0;
  state.floorPlan = false;
  context.rebuildStaticCache(canvas('picture'), canvas('future'));
  assert.deepEqual(calls.filter(call => !call.startsWith('future')),
    ['picture clear', 'picture fill', 'picture image', 'blueprint', 'guide', 'grid', 'draw 25', 'draw 54', 'picture image', 'overlay', 'draw 900']);
});
test('failed snapshot encoding restores the live viewport and rendering context', () => {
  const r=setup(true);
  assert.throws(()=>r.context.renderCastlePicture(),/encoding failed/);
  assert.deepEqual(r.state,r.original);
  assert.equal(r.context.ctx,'screen');
});

function labelFont(snapshotLabels, rect) {
  const fonts=[];
  const ctx={font:'',save(){},restore(){},measureText(text){return {width:text.length*parseFloat(this.font.slice(5))*.55};},strokeText(){},fillText(){fonts.push(parseFloat(this.font.slice(5)));}};
  const context=vm.createContext({ctx,state:{cell:32,snapshotLabels},els:{showNames:{checked:true}},isUnitType:()=>false,itemSize:()=>[7,7],itemName:()=> 'Mercenary Post'});
  const first=source.indexOf('  function drawItemName('),last=source.indexOf('  function drawUnitMarkers(',first);
  vm.runInContext(source.slice(first,last),context);
  context.drawItemName(87,rect);
  return fonts[0];
}
test('snapshot building names fill their footprint instead of retaining the viewport font cap',()=>{
  const rect={x:0,y:0,w:224,h:224};
  const normal=labelFont(false,rect),snapshot=labelFont(true,rect);
  assert.equal(normal,16);
  assert.ok(snapshot>normal*2);
  assert.ok(snapshot*'Mercenary'.length*.55<=216);
  assert.ok(2*snapshot*1.15<=216);
  assert.ok(labelFont(true,{...rect,w:448,h:448})>=snapshot*2);
});
