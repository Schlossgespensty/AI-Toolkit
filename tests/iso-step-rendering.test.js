const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/js/iso-view.js'), 'utf8');

function raster(size) {
  const pixels = new Uint8Array(size * size), stack = [];
  let clip = [{x: 0, y: 0, w: size, h: size}], path;
  const ctx = {pixels, draws: 0, cleared: 0,
    save() { stack.push(clip); }, restore() { clip = stack.pop(); },
    beginPath() {path=[];}, moveTo() {}, lineTo() {}, closePath() {},
    rect(x, y, w, h) { path.push({x, y, w, h}); }, clip() { clip = path; },
    clearRect(x, y, w, h) { this.cleared += w * h; fill(0, x, y, w, h); },
    drawImage(image, ...args) { this.draws++; fill(this.globalCompositeOperation === 'destination-out' ? 0 : image.color, ...args.slice(-4)); }
  };
  function fill(color, x, y, w, h) {
    for (let py = Math.max(0, y); py < Math.min(size, y + h); py++)
      for (let px = Math.max(0, x); px < Math.min(size, x + w); px++)
        if (clip.some(r=>px>=r.x && px<r.x+r.w && py>=r.y && py<r.y+r.h)) pixels[py * size + px] = color;
  }
  return ctx;
}

function scene(fire = false, clearable = false) {
  const size = 100, ctx = raster(size), terrainImage = {color: 1}, frontImage = {color: 9};
  const images = [{color: 2}, {color: 3}];
  let items = [], terrainBuilds = 0;
  const state = {view: {zoom: 1, panX: 0, panY: 0}, catalogue: {}};
  const mask = raster(size);
  const context = vm.createContext({state, document: {getElementById: () => ({checked: fire}), createElement: () => ({width: 0, height: 0, getContext: () => mask})}, window: {castleGameData: {flammability: {Hovel: 1}}, castleCostData: {buildings: {54: {balance: 'Hovel'}}}, castleEditor: {getActiveBuildStep: () => 1}},
    currentDocument: () => null, turnedTiles: value => value, zinnenLage: () => null, drawSchraege() {},
    geo: {GRID: 100, collectItems: () => items, attachDrawbridges: value => value,
      collectPlates: () => [], wallLookup: value => value.length, hoehenLookup: () => null, mauerSchraegen: () => [], anlehnFelder: () => new Set(), anlehnRichtung: () => null,
      buildingParts: () => null, isoPoint: (x, y) => [x, y],
      renderOrder: (a, b) => a.gy - b.gy || a.gx - b.gx || (a.layer ?? 2) - (b.layer ?? 2)},
    paintMapTiles() {
      terrainBuilds++;
      state.mapScenery = [];
      for (let gy = 0; gy < size; gy++) for (let gx = 0; gx < size; gx++)
        state.mapScenery.push({gx, gy, layer: 0, draw: target => target.drawImage(terrainImage, gx, gy, 1, 1)});
      // Foreground scenery must stay interleaved, not become a flat backdrop.
      state.mapScenery.push({gx: 53, gy: 53, layer: 3, clearable, draw: target => target.drawImage(frontImage, 49, 48, 6, 6)});
      context.cacheTerrainCommands();
      return true;
    },
    drawSprite(target, entry, gx, gy, tiles, walls) {
      // Mimic a retained wall changing its sprite when a neighbouring step appears.
      target.drawImage(images[walls > 1 ? 1 : 0], gx, gy - 5, tiles, 6); return true;
    }
  });
  vm.runInContext(source.slice(source.indexOf('  function recordSceneCommands('), source.indexOf('  function paintInteraction(')), context);
  return {ctx, mask, state, context, get terrainBuilds() { return terrainBuilds; },
    render(nextItems, previousCommands = null, reuseTerrain = false, previousFireMask = null) {
      items = nextItems; return context.paintScene(ctx, size, size, {previousCommands, reuseTerrain, previousFireMask});
    }};
}

test('incremental forward/backward steps are pixel-identical to full depth-ordered rendering', t => {
  const incremental = scene();
  const item = (gx, gy) => ({gx, gy, entry: {}, tiles: 4});
  const first = item(50, 50), second = item(52, 52), distant = item(10, 15);
  let previous = incremental.render([first]);
  const fullDraws = incremental.ctx.draws;
  let nearbyDraws;
  for (const items of [[first, second], [first], [first, distant], [], [first, second], [second, first]]) {
    const startDraws = incremental.ctx.draws;
    previous = incremental.render(items, previous.commands, true);
    if (nearbyDraws == null) nearbyDraws = incremental.ctx.draws - startDraws;
    const full = scene(); full.render(items);
    assert.deepEqual(incremental.ctx.pixels, full.ctx.pixels, 'partial repaint must match a fresh frame');
  }
  assert.equal(incremental.terrainBuilds, 1, 'terrain is prepared once across all build steps');
  assert.ok(nearbyDraws < fullDraws / 20, `${nearbyDraws} vs ${fullDraws} draws`);
  t.diagnostic(`Synthetic 10,000-tile scene: nearby step used ${nearbyDraws} image draws vs ${fullDraws} for a full repaint.`);
});

test('damage includes disappearing sprites and uses a full redraw for changed occlusion order', () => {
  const {context} = scene(), command = (key, x) => ({key, x, y: 10, w: 10, h: 10});
  const a = command('a', 10), b = command('b', 70);
  assert.equal(context.sceneDamage([a], [a], 100, 100), null);
  const removed = context.sceneDamage([a, b], [a], 100, 100);
  assert.equal(removed.x, 68); assert.equal(removed.w, 14);
  const reordered = context.sceneDamage([a, b], [b, a], 100, 100);
  assert.equal(reordered.w, 100); assert.equal(reordered.h, 100);
  const duplicate = context.sceneDamage([a], [a, a], 100, 100);
  assert.equal(duplicate.x, 8); assert.equal(duplicate.w, 14);
});

test('step notifications avoid document cloning and serialization until an edit changes its revision', () => {
  let revision = 1, step = 0, clones = 0;
  const refreshes = [], state = {};
  const context = vm.createContext({state, document: {getElementById: () => ({checked: fire}), createElement: () => ({width: 0, height: 0, getContext: () => mask})}, window: {castleGameData: {flammability: {Hovel: 1}}, castleCostData: {buildings: {54: {balance: 'Hovel'}}}, castleEditor: {hasDocument: () => true,
    getDocument: () => { clones++; return {frames: []}; }, getDocumentRevision: () => revision,
    getActiveBuildStep: () => step}}, refresh: (...args) => refreshes.push(args)});
  vm.runInContext(source.slice(source.indexOf('  function currentDocument('), source.indexOf('  // The ground under')), context);
  vm.runInContext(source.slice(source.indexOf('  function editorChanged('), source.indexOf('  function init()')), context);
  const first = context.currentDocument();
  for (step = 0; step < 100; step++) { context.editorChanged(true); assert.equal(context.currentDocument(), first); }
  assert.equal(clones, 1);
  revision++; context.editorChanged(true);
  assert.notEqual(context.currentDocument(), first); assert.equal(clones, 2);
  assert.ok(refreshes.every(args => args[1] === true), 'step/edit notifications keep the terrain cache');
});


test('fire mask stays depth-correct during forward/backward partial redraws and enabling fire', () => {
  const incremental = scene(true), first = {itemType:54,gx:50,gy:50,entry:{},tiles:4};
  const second = {itemType:54,gx:52,gy:52,entry:{},tiles:4};
  let previous = incremental.render([first]);
  for (const items of [[first,second],[first],[],[second]]) {
    previous = incremental.render(items, previous.commands, true, previous.fireMask);
    const full = scene(true); full.render(items);
    assert.deepEqual(incremental.mask.pixels, full.mask.pixels, 'incremental mask must match a full rebuild');
    assert.equal(incremental.mask.pixels[50*100+52],0,'foreground terrain masks the burnable building');
  }
  const enabled = scene(true);
  const withoutMask = enabled.render([first]);
  enabled.mask.pixels.fill(0);
  enabled.render([first],withoutMask.commands,true,null);
  assert.ok(enabled.mask.pixels.some(value=>value>0),'newly enabled mask is built even with no scene damage');
});

test('terrain commands retain identity across consecutive scrubs and are immutable', () => {
  const s = scene(), item = {gx:50,gy:50,entry:{},tiles:4};
  let previous = s.render([item]);
  const commands = s.state.mapSceneryCommands, buckets = s.state.mapSceneryBuckets;
  const original = [...commands];
  for (const items of [[], [item], []]) {
    previous = s.render(items, previous.commands, true);
    assert.equal(s.state.mapSceneryCommands, commands);
    assert.equal(s.state.mapSceneryBuckets, buckets);
    original.forEach((command, index) => {
      assert.equal(commands[index], command);
      assert.ok(Object.isFrozen(command));
    });
  }
});

test('linear merge matches the previous full stable sort, including exact ties and multipart draws', () => {
  const {context} = scene();
  const geo = require('../src/js/iso-geometry');
  context.geo.renderOrder = geo.renderOrder;
  const command = (gx, gy, tiles, layer, name) => ({order:{gx,gy,tiles,layer},name});
  const terrain = [], buildings = [];
  for (let i=0; i<500; i++) {
    terrain.push(command(i%17, i%23, 1, i%3, `t${i}`));
    buildings.push(command(i%19, i%29, i%4+1, i%3, `b${i}`));
  }
  terrain.push(command(4,5,1,2,'tie-terrain-a'),command(4,5,1,2,'tie-terrain-b'));
  buildings.push(command(4,5,1,2,'tie-building-a'),command(4,5,1,2,'tie-building-b'));
  const compare = (a,b) => geo.renderOrder(a.order,b.order);
  const expected = [...terrain,...buildings].sort(compare);
  terrain.sort(compare);buildings.sort(compare);
  assert.deepEqual([...context.mergeSceneCommands(terrain,buildings)],expected);
  assert.deepEqual([...context.mergeSceneCommands([],buildings)],buildings);
  assert.deepEqual([...context.mergeSceneCommands(terrain,[])],terrain);
});

test('spatial query matches a full scan across negative coordinates, boundaries and multi-cell sprites', () => {
  const s = scene();
  s.state.mapScenery = Array.from({length:400},(_,i) => ({gx:i%20,gy:Math.floor(i/20),layer:i%3,
    draw:target=>target.drawImage({color:1},(i%20)*90-350,Math.floor(i/20)*80-290,i%3===0?600:32,350)}));
  s.context.cacheTerrainCommands();
  const commands = s.state.mapSceneryCommands;
  for (const rect of [{x:-400,y:-400,w:100,h:100},{x:256,y:256,w:1,h:1},
    {x:255,y:255,w:258,h:258},{x:3000,y:3000,w:1,h:1},{x:-500,y:-500,w:4000,h:4000}]) {
    const actual = [...s.context.terrainCommandsIn(rect)];
    const expected = commands.filter(c=>s.context.intersectsSceneRect(c,rect));
    assert.deepEqual(actual,[...expected]);
    assert.equal(new Set(actual).size,actual.length);
  }
});

test('terrain cache is replaced when terrain is rebuilt or becomes unavailable', () => {
  const s = scene();
  s.render([]);
  const oldCommands = s.state.mapSceneryCommands, oldBuckets = s.state.mapSceneryBuckets;
  s.render([], null, false);
  assert.notEqual(s.state.mapSceneryCommands, oldCommands);
  assert.notEqual(s.state.mapSceneryBuckets, oldBuckets);
  Object.assign(s.context, {vorrat:()=>null,gameMap:()=>null,currentKeep:()=>null});
  vm.runInContext(source.slice(source.indexOf('  function paintMapTiles('),source.indexOf('  function paintGround(')),s.context);
  assert.equal(s.context.paintMapTiles(s.ctx,100,100),false);
  assert.equal(s.state.mapSceneryCommands.length,0);
  assert.equal(s.state.mapSceneryBuckets.size,0);
});

test('cached geometry filters the visible prefix before resolving neighbouring buildings',()=>{
 let doc={frames:[{}, {}, {}]},step=0,rotation=0,collections=0;
 const state={catalogue:{}},seen=[];
 const context=vm.createContext({state,window:{castleEditor:{getActiveBuildStep:()=>step}},
  currentDocument:()=>doc,currentRotation:()=>rotation,viewRotation:()=>rotation,image(){},
  turnedTiles:items=>items.map(item=>({...item,rotation})),
  geo:{resolveMoats:require('../src/js/iso-geometry').resolveMoats,collectItems:()=>{collections++;return doc.frames.map((_,frameIndex)=>({frameIndex,entry:null}));},
   attachDrawbridges:items=>{seen.push(items.map(i=>i.frameIndex));return items;}}});
 vm.runInContext(source.slice(source.indexOf('  function visibleSceneItems('),source.indexOf('  function paintScene(')),context);
 assert.equal(context.visibleSceneItems().length,1);
 step=2;assert.equal(context.visibleSceneItems().length,3);
 step=0;assert.equal(context.visibleSceneItems().length,1);
 assert.equal(collections,1);
 assert.deepEqual(seen,[[0],[0,1,2],[0]]);
 rotation=2;assert.equal(context.visibleSceneItems()[0].rotation,2);assert.equal(collections,2);
 doc={frames:[{}]};context.visibleSceneItems();assert.equal(collections,3);
});
test('distant step changes keep separate damage regions rather than repainting the gap',()=>{
 const {context}=scene(),command=(key,x)=>({key,x,y:10,w:4,h:4});
 const damage=context.sceneDamage([], [command('left',5),command('right',85)],100,100);
 assert.equal(damage.regions.length,2);
 assert.ok(damage.regions.reduce((n,r)=>n+r.w*r.h,0)<damage.w*damage.h/3);
});

test('enabled fire overlays do not force Canvas scene rendering during slider motion', () => {
  const s=scene(true);let scrubbing=true,submitted=0,maskRequest;
  s.state.gpu={setScene(...args){submitted++;maskRequest=args[3];}};
  s.context.window.castleEditor.isScrubbing=()=>scrubbing;
  const moving=s.render([{itemType:54,gx:50,gy:50,entry:{},tiles:4}]);
  assert.equal(moving.gpu,true);assert.equal(moving.fireMask,null);assert.equal(submitted,1);
  scrubbing=false;
  const settled=s.render([{itemType:54,gx:50,gy:50,entry:{},tiles:4}]);
  assert.equal(settled.gpu,true,'fire never switches the scene back to Canvas');
  assert.deepEqual(Array.from(maskRequest),[100,100],'settled fire requests a worker mask');
});


test('construction clears overlapping scenery and stepping backward restores the same cached objects', () => {
  const s = scene(false, true);
  let frame = s.render([]);
  const objects = s.state.mapObjectCommands;
  assert.equal(objects.length, 1);
  assert.equal(s.ctx.pixels[48 * 100 + 49], 9);
  const building = {gx: 50, gy: 50, entry: {}, tiles: 4};
  for (const items of [[building], [], [building], []]) {
    frame = s.render(items, frame.commands, true);
    const full = scene(false, true); full.render(items);
    assert.deepEqual(s.ctx.pixels, full.ctx.pixels);
    assert.equal(s.state.mapObjectCommands, objects);
    assert.equal(s.context.visibleMapObjects(items, []).length, items.length ? 0 : 1);
  }
  assert.equal(s.context.visibleMapObjects([], [{gx:53, gy:53, tiles:1}]).length, 0, 'attached ground plates clear scenery too');
  assert.equal(s.context.visibleMapObjects([{gx:54, gy:53, tiles:1}], []).length, 1, 'adjacent scenery is retained');
  assert.equal(s.terrainBuilds, 1);
});
