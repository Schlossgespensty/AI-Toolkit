'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const constants = JSON.parse(read('config/aiv_constants.json'));
const templates = JSON.parse(read('config/aiv_templates.json'));
const categories = JSON.parse(read('config/aiv_categories.json')).categories;
const catalogue = JSON.parse(read('assets/aiv/iso/verzeichnis.json'));
const geometry = require('../src/js/castle-geometry');
const iso = require('../src/js/iso-geometry');
const costs = require('../src/js/castle-cost-data');
// Crusader 1.41 footprints; apples use placeApplefarm's actual 10x10 reservation
// (0x515740), rather than the command-size lookup's extra clearance tile.
const resources = [[56,6,62],[70,9,73],[71,9,75],[72,10,71],[73,10,72],[90,4,64],[91,4,65]];

test('resource buildings retain native footprints and anchors through edited AIV saves', async () => {
  const codec = await import('../src/node/aiv-codec.mjs');
  for (const [type, size, native] of resources) {
    assert.deepEqual(constants[type].size, [size, size]);
    assert.ok(Object.values(categories).some(ids => ids.includes(String(type))));
    assert.equal(codec.internals.mapperEnumToAiv(type), native);
    const document = { pauseDelayAmount: 100, miscItems: [], frames: [
      {itemType:61,tilePositionOfsets:[9002],shouldPause:false},
      {itemType:type,tilePositionOfsets:[8070],shouldPause:true}
    ]};
    const first = codec.encodeAiv(document, templates);
    const loaded = codec.parseAiv(first);
    assert.deepEqual(loaded.frames, document.frames);
    loaded.frames[1].tilePositionOfsets[0] += 2;
    const reopened = codec.parseAiv(codec.encodeAiv(loaded, templates, {source:first}));
    assert.deepEqual(reopened.frames, loaded.frames);
    const rects = geometry.footprintRectsAtXY(type, 70, 80, constants[type].size);
    assert.equal(geometry.footprintContainsTile(rects, {x:70+size-1,y:81-size}), true);
    assert.equal(geometry.footprintContainsTile(rects, {x:70+size,y:80}), false);
    assert.equal(templates[type].bmap_id_template.flat().filter(id => id === native).length, size*size);
    assert.equal(catalogue.gegenstaende[type].kacheln, size);
    assert.ok(costs.buildings[type].balance);
  }
});

test('farm sprites preserve the full field anchor without stretching the 3x3 building', () => {
  for (const [type, size] of resources.filter(([type]) => type>=70 && type<=73)) {
    const sprite = catalogue.gegenstaende[type];
    const png = fs.readFileSync(path.join(root,'assets/aiv/iso',sprite.bild));
    // Native orchard canopies may extend beyond the placement footprint.
    assert.equal(png.readUInt32BE(16), sprite.breite);
    assert.ok(sprite.breite >= 32*size-2);
    assert.equal(png.readUInt32BE(20), sprite.hoehe);
    const item = iso.collectItems({frames:[{itemType:type,tilePositionOfsets:[8070]}]},catalogue)[0];
    assert.equal(item.tiles,size);
    const view={panX:0,panY:0,zoom:1};
    const rect=iso.spriteRect(sprite,item.gx,item.gy,item.tiles,view);
    const bottom=iso.isoPoint(item.gx+size-1,item.gy+size-1,view);
    assert.equal(rect.y+rect.h,bottom[1]+16);
  }
});

test('a saved apple farm uses exactly 100 cells and can touch the dairy farm', async () => {
  const codec=await import('../src/node/aiv-codec.mjs');
  const document={pauseDelayAmount:100,miscItems:[],frames:[
    {itemType:72,tilePositionOfsets:[8070],shouldPause:false},
    {itemType:73,tilePositionOfsets:[8080],shouldPause:true}
  ]};
  const bytes=codec.encodeAiv(document,templates);
  assert.deepEqual(codec.parseAiv(bytes).frames,document.frames);
  const sections=codec.internals.readDirectory(bytes).sections;
  const ids=sections.get(2007),sizes=sections.get(2004);
  const view=new DataView(ids.buffer,ids.byteOffset,ids.byteLength);
  const appleCells=Array.from({length:10000},(_,i)=>i).filter(i=>view.getUint16(i*2,true)===71);
  assert.equal(appleCells.length,100);
  assert.ok(appleCells.every(i=>sizes[i]===10));
  assert.equal(view.getUint16((19*100+79)*2,true),71,'apple occupies its tenth column');
  assert.equal(view.getUint16((19*100+80)*2,true),72,'the next column belongs to the dairy farm');
});

test('Ctrl/Command-click toggles exactly one placement without beginning a move', () => {
  const source=read('src/js/castle-editor.js');
  const functionText=source.slice(source.indexOf('  function beginSelectGesture('),source.indexOf('  function onPointerMove('));
  for(const modifier of ['ctrlKey','metaKey']) {
    const state={selected:new Set(['f:1:0','f:1:1','f:2:0']),currentItemType:73,gesture:null};
    const context={state,topmostRefAtTile:()=> 'f:1:1',
      activateBuildStepForRefs(){},updateToolAvailability(){},renderPalette(){},updateSelectedItemInfo(){},renderBuildList(){},scheduleDraw(){},setStatus(){}};
    vm.createContext(context); vm.runInContext(functionText,context);
    context.beginSelectGesture({x:1,y:1},{[modifier]:true});
    assert.deepEqual([...state.selected],['f:1:0','f:2:0']);
    assert.equal(state.gesture,null);
    context.beginSelectGesture({x:1,y:1},{[modifier]:true});
    assert.equal(state.selected.size,3);
    assert.ok(state.selected.has('f:1:1'));
    assert.equal(state.gesture,null);
  }
});
