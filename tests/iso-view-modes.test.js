const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const geo = require('../src/js/iso-geometry');
const source = fs.readFileSync(require.resolve('../src/js/iso-view'), 'utf8');

function view() {
  const state = {view:{zoom:1,panX:400,panY:-400},flatView:false,peekView:false};
  const statuses = [], refreshes = [];
  const context = vm.createContext({state,geo,VIERTEL:2,handDrehung:0,
    surface:()=>({width:800,height:600}),gameMap:()=>({path:'saved.map'}),
    hasMapTiles:()=>true,kartenSchluessel:()=> 'saved.map#200,200',
    bodenHoehe:()=>geo.viewHeight(48,state.flatView),
    isMounted:()=>true,paint(){},refresh:()=>refreshes.push(true),
    setStatus:value=>statuses.push(value)});
  vm.runInContext(source.slice(source.indexOf('  function viewRotation()'), source.indexOf('  function currentRotation()')), context);
  return {state,context,statuses,refreshes};
}

test('saved map rotation needs a loaded atlas, without requiring legacy engine camera caches', () => {
  const {state,context,statuses} = view();
  const original = {...state.view};
  for (const expected of [2,4,6,0]) assert.equal(context.turnView(1),expected);
  assert.deepEqual(state.view,original,'four turns preserve the world-space centre');
  assert.deepEqual(statuses,[]);
  context.hasMapTiles=()=>false;
  state.mapLoadError='Atlas decoding failed';
  assert.equal(context.turnView(1),null);
  assert.deepEqual(statuses,['Atlas decoding failed'],'report the actual error, never an endless camera-cache wait');
});

test('Space toggles flat view once and preserves camera position through an elevated round trip', () => {
  const {state,context,refreshes} = view();
  const original = {...state.view};
  context.toggleFlatView();
  assert.equal(state.flatView,true);
  assert.equal(state.view.panY,original.panY-40);
  context.setViewMode('flat',true);
  assert.equal(refreshes.length,1,'idempotent mode assignment does not rebuild the scene');
  context.toggleFlatView();
  assert.deepEqual(state.view,original);
});

test('V toggles lowered view with an elevated round trip and retains the independent Space state', () => {
  const {state,context} = view();
  const original = {...state.view};
  context.togglePeekView();
  assert.equal(state.peekView,true);
  assert.equal(state.view.panY,original.panY,'V never moves the terrain or camera');
  context.togglePeekView();
  assert.equal(state.peekView,false);
  assert.deepEqual(state.view,original);
  context.toggleFlatView();
  context.togglePeekView();
  context.togglePeekView();
  assert.equal(state.flatView,true);
  context.isMounted=()=>false;
  context.togglePeekView();
  assert.equal(state.peekView,false,'a hidden viewport does not consume its shortcut');
});

test('flat and peek heights share the same tile picking and keep the real height raster intact', () => {
  const height = new Uint8Array(400*400).fill(64);
  const state={view:{zoom:1,panX:0,panY:0}};
  const context=vm.createContext({geo,state,gameMap:()=>({}),currentKeep:()=>({x:200,y:200}),
    viewRotation:()=>0,vorrat:()=>({plaetze:[],bild:{complete:true,naturalWidth:1},hoehen:height})});
  vm.runInContext(source.slice(source.indexOf('  function bodenHoehe('),source.indexOf('  function gameMap()')),context);
  for(const mode of ['flatView','peekView']) {
    assert.equal(context.bodenHoehe(43,43),64);
    state[mode]=true;
    const expected=mode==='peekView'?64:8;
    assert.equal(context.bodenHoehe(43,43),expected);
    const point=geo.isoPoint(43.5,43.5,state.view,expected);
    assert.deepEqual(geo.tileFromPoint(...point,state.view,context.bodenHoehe),{gx:43,gy:43});
    state[mode]=false;
    assert.equal(height[200*400+200],64);
  }
});

test('lowered view uses the native height table, independently from flat view', () => {
  for(let height=0;height<256;height++) {
    assert.equal(geo.viewHeight(height,false,true),(height>>2)+1);
    assert.equal(geo.viewHeight(height,true,true),8);
    assert.equal(geo.viewHeight(height),height);
  }
  const {state,context}=view(),original={...state.view};
  context.togglePeekView();
  context.toggleFlatView();
  assert.equal(state.view.panY,original.panY-40);
  context.toggleFlatView();
  assert.equal(state.view.panY,original.panY);
  context.togglePeekView();
  assert.deepEqual(state.view,original,'switching between lowered and flat preserves the centre');
});

test('V preserves native building-part pixels and its isometric footprint', () => {
  const state={view:{zoom:2,panX:0,panY:0},peekView:true},calls=[];
  const context=vm.createContext({geo,state});
  vm.runInContext(source.slice(source.indexOf('  function drawNativePart('),source.indexOf('  function drawSprite(')),context);
  context.drawNativePart({drawImage:(...args)=>calls.push(args)},{gx:0,gy:0,sx:4,sy:6,breite:30,hoehe:90,dx:-15,dy:-74},{},17);
  assert.deepEqual(calls[0].slice(1),[4,6,30,90,-30,-182,60,180]);
  context.drawNativePart({drawImage:(...args)=>calls.push(args)},{gx:0,gy:0,sx:4,sy:6,breite:30,hoehe:90,dx:-15,dy:-74},{},64,67);
  assert.deepEqual(calls[1].slice(1),[4,6,30,23,-30,-142,60,46],'lowering crops a column and leaves its 30x16 base at ground level');
});

test('Space keeps native moat art instead of dropping its tiles',()=>{
 const state={catalogue:{flatTiles:[]}},entry={nativeMoat:204,bild:'water',breite:30,hoehe:20,dx:-15,dy:-4};
 const context=vm.createContext({state,geo,flatRandomAt:()=>0});
 vm.runInContext(source.slice(source.indexOf('  function flatSceneParts('),source.indexOf('  function structureLowering(')),context);
 const parts=context.flatSceneParts({entry,gx:2,gy:3},()=>null,()=>null);
 assert.equal(parts.length,1);assert.equal(parts[0].bild,'water');assert.equal(parts[0].nativeMoat,204);
});

test('placed killing pits use completed variants in normal and Space drawing',()=>{
 const draws=[],variants=Array.from({length:8},(_,i)=>({bild:'completed-pit',nativePit:8+i,sx:i*32,sy:0,breite:30,hoehe:16,dx:-15,dy:0}));
 const entry={bild:'open-pit',kacheln:1,flatBuilding:{group:-1},pitVariants:variants};
 const state={view:{zoom:1,panX:0,panY:0}};
 let random=0;
 const context=vm.createContext({state,geo,flatRandomAt:()=>random,
  image:()=>({complete:true,naturalWidth:256}),bauHoehe:()=>8});
 vm.runInContext(source.slice(source.indexOf('  function flatSceneParts('),source.indexOf('  function structureLowering(')),context);
 vm.runInContext(source.slice(source.indexOf('  function drawSprite('),source.indexOf('  function wallFootDepth(')),context);
 for(random=0;random<16;random++) {
  const parts=context.flatSceneParts({entry,gx:4,gy:5},()=>null,()=>null);
  assert.equal(parts[0].nativePit,8+(random&7));
  context.drawSprite({drawImage:(...args)=>draws.push(args)},entry,4,5,1);
  assert.equal(draws.at(-1)[1],(random&7)*32,'normal/V draw the same completed bank');
 }
});

test('Space uses complete native flat crenellations for high and low walls',()=>{
 const catalogue=require('../assets/aiv/iso/verzeichnis.json');
 const flatTiles=Array.from({length:46},(_,i)=>({bild:'native-flat',sx:i*32,sy:7,breite:30,hoehe:24,dx:-15,dy:-8}));
 const state={catalogue:{flatTiles}};
 let random=0;
 const context=vm.createContext({state,geo,flatRandomAt:()=>random});
 vm.runInContext(source.slice(source.indexOf('  function flatSceneParts('),source.indexOf('  function structureLowering(')),context);
 for(const id of [26,35])for(random=0;random<8;random++) {
  const parts=context.flatSceneParts({entry:catalogue.gegenstaende[id],gx:4,gy:5},()=>null,()=>null);
  assert.equal(parts.length,1);
  assert.deepEqual({...parts[0]},{...flatTiles[36+(random&3)],gx:4,gy:5,tiles:1},
   'native tile and upper artwork survive intact, independent of wall height or neighbours');
 }
});

test('V leaves terrain, cliffs, trees and scenery anchored at their normal heights', () => {
  const draws=[],image={complete:true,naturalWidth:100};
  const places=new Uint16Array(400*400).fill(0xffff);places[0]=0;
  const heights=new Uint8Array(400*400);heights[0]=64;
  const cliffs=new Uint16Array(400*400);cliffs[0]=2;
  const stock={bild:image,plaetze:places,hoehen:heights,kw:30,kh:16,spalten:64,cliffSprites:cliffs,
    upperImages:[image],upperEntries:[{x:0,y:0,width:30,height:80,dx:0,dy:-64},
      {x:30,y:0,width:30,height:71,dx:0,dy:9},{x:60,y:0,width:36,height:64}],
    treeSprites:new Map([[0,[0,0,2,-3,-48]]])};
  const state={view:{zoom:1,panX:0,panY:0},peekView:true};
  const context=vm.createContext({state,geo:{...geo,mapTileForView:(gx,gy)=>({mx:gx===0&&gy===0?0:-1,my:0})},
    vorrat:()=>stock,gameMap:()=>({}),currentKeep:()=>({x:0,y:0}),viewRotation:()=>0,
    KARTE_FELDER:400,MAP_MARGIN:5,kartenFeld:(x,y)=>x<0?-1:y*400+x,cacheTerrainCommands(){}});
  vm.runInContext(source.slice(source.indexOf('  function paintMapTiles('),source.indexOf('  function paintGround(')),context);
  const recorder={drawImage:(...args)=>draws.push(args)};
  context.paintMapTiles(recorder,1,1);
  for(const item of state.mapScenery)item.draw(recorder);
  assert.equal(draws.length,4);
  assert.deepEqual(draws[0].slice(1),[30,0,30,71,-15,-55,30,71]);
  assert.deepEqual(draws[1].slice(-2),[30,16]);
  assert.deepEqual(draws[2].slice(-2),[30,80]);
  assert.deepEqual(draws[3].slice(-2),[36,64]);
});

test('V crops a wall pillar while preserving the full sixteen-pixel roof diamond', () => {
  const state={peekView:true,view:{zoom:1,panX:0,panY:0}},draws=[];
  const variant={bild:'wall',breite:30,hoehe:106,sx:4,sy:6};
  const context=vm.createContext({state,geo:{...geo,variantFor:()=>variant},
    image:()=>({complete:true,naturalWidth:30}),bodenHoehe:()=>64,
    bauHoehe:()=>64,wallFootDepth:()=>[0,0],drawWallFoot(){}});
  vm.runInContext(source.slice(source.indexOf('  function drawSprite('),source.indexOf('  function wallFootDepth(')),context);
  context.drawSprite({drawImage:(...args)=>draws.push(args)},{mauer:{hoehe:90}},0,0,1);
  assert.deepEqual(draws[0].slice(1),[4,6,30,39,-15,-87,30,39]);
});

test('Space draws the flat atlas stump at its native origin and hides legacy tree canopies',()=>{
 const draws=[],image={complete:true,naturalWidth:256};
 const places=new Uint16Array(400*400).fill(0xffff);places[0]=0;
 const stock={bild:image,plaetze:places,hoehen:new Uint8Array(400*400).fill(64),kw:30,kh:16,spalten:64,
  upperImages:[image],upperEntries:[null,{x:3,y:4,width:185,height:185}],treeSprites:new Map([[0,[0,0,1,-44,-144]]])};
 const state={view:{zoom:1,panX:0,panY:0},flatView:true,kachelVorrat:{flat:stock}};
 const context=vm.createContext({state,geo:{...geo,mapTileForView:(gx,gy)=>({mx:gx===0&&gy===0?0:-1,my:0})},
  vorrat:()=>stock,gameMap:()=>({}),currentKeep:()=>({x:0,y:0}),viewRotation:()=>0,
  KARTE_FELDER:400,MAP_MARGIN:5,kartenFeld:(x,y)=>x<0?-1:y*400+x,cacheTerrainCommands(){}});
 vm.runInContext(source.slice(source.indexOf('  function paintMapTiles('),source.indexOf('  function paintGround(')),context);
 const recorder={drawImage:(...args)=>draws.push(args)};
 context.paintMapTiles(recorder,1,1);
 for(const item of state.mapScenery)item.draw(recorder);
 assert.equal(draws.length,2,'ground and stump are both present');
 assert.deepEqual(draws[1].slice(1),[3,4,185,185,-59,-152,185,185],'the stump retains its native pixels and origin at flat height 8');
 state.kachelVorrat={};draws.length=0;
 context.paintMapTiles(recorder,1,1);
 for(const item of state.mapScenery)item.draw(recorder);
 assert.equal(draws.length,1,'a legacy atlas cannot bring tall tree sprites into Space');
});

test('Space uses native texture banks and preserves sparse farm parts instead of a square foundation', () => {
  const tiles=Array.from({length:46},(_,i)=>({bild:'local-flat-atlas',sx:i*32,sy:0,breite:30,hoehe:16,dx:-15,dy:0}));
  assert.equal(geo.flatTileIndex({building:41,group:0},3,1),7);
  assert.equal(geo.flatTileIndex({building:10,group:1},2,0),10);
  assert.equal(geo.flatTileIndex({building:12,group:2},1,1),21);
  assert.equal(geo.flatTileIndex({building:3,group:3},4),24);
  assert.equal(geo.flatTileIndex({building:3,group:3},4,0,true),25);
  const farm={gx:10,gy:20,tiles:8,entry:{flatBuilding:{building:30,group:3},partsLayouts:[[
    {gx:0,gy:0},{gx:1,gy:0},{gx:0,gy:1},{gx:1,gy:1},
    {gx:7,gy:6,bild:'field-atlas',flatField:true,breite:30,hoehe:16}
  ]]}};
  const parts=geo.flatBuildingParts(farm,tiles,()=>0);
  assert.equal(parts.length,5,'four hut cells plus one field, never an 8x8 square');
  assert.deepEqual(parts.map(p=>[p.gx,p.gy]),[[10,20],[11,20],[10,21],[11,21],[17,26]]);
  assert.equal(parts[0].bild,'local-flat-atlas');
  assert.equal(parts[4].bild,'field-atlas');
  assert.equal(parts.filter(p=>p.sx===31*32).length,1,'exactly one farm marker, independent of tile RNG');
  assert.equal(geo.flatBuildingParts({...farm,entry:{flatBuilding:{group:-1}}},tiles,()=>0).length,0);
});

test('Space substitutes farm ground and orchard stumps without changing normal parts',()=>{
 const tiles=Array.from({length:46},(_,i)=>({bild:'flat',sx:i*32}));
 const ground={bild:'dairy-ground',sx:11,sy:13,breite:30,hoehe:16,dx:-15,dy:0};
 const fence={gx:3,gy:2,bild:'native-fence',sx:31,sy:33,breite:44,hoehe:32,dx:-15,dy:-16,flatField:true,flatSprite:ground};
 const stump={bild:'apple-stump',sx:1,sy:2,breite:185,hoehe:185,dx:-87,dy:-114};
 const tree={gx:8,gy:7,bild:'apple-tree',breite:120,hoehe:100,flatField:true,flatSprite:stump};
 const item={gx:10,gy:20,tiles:10,entry:{flatBuilding:{building:32,group:3},partsLayouts:[[{gx:0,gy:0},fence,tree]]}};
 const parts=geo.flatBuildingParts(item,tiles,()=>0);
 assert.equal(parts.some(p=>p.bild==='native-fence'),false,'Space replaces the full fence, rather than cropping it');
 assert.deepEqual(parts.find(p=>p.bild==='dairy-ground'),{...ground,gx:13,gy:22,tiles:1});
 assert.deepEqual(geo.buildingParts(item).find(p=>p.bild==='native-fence'),{...fence,gx:13,gy:22,tiles:1},'normal source pixels and offsets survive unchanged');
 assert.equal(parts.some(p=>p.bild==='apple-tree'),false);
 assert.deepEqual(parts.find(p=>p.bild==='apple-stump'),{...stump,gx:18,gy:27,tiles:1},'stump uses native pixels/origin at the orchard position');
 assert.equal(parts.filter(p=>p.bild==='flat').length,1,'tree/field cells cannot become extra hut cells');
});

test('Space uses native camp and training-ground types instead of stockpile textures',()=>{
 const catalogue=require('../assets/aiv/iso/verzeichnis.json');
 const expected={61:[55,10],86:[57,58,56],87:[57,58,56],88:[53],89:[59],180:[51]};
 const context=vm.createContext({state:{catalogue},geo,flatRandomAt:()=>0});
 vm.runInContext(source.slice(source.indexOf('  function flatSceneParts('),source.indexOf('  function structureLowering(')),context);
 for(const [id,types] of Object.entries(expected))for(const [index,type] of types.entries()) {
  const plate=catalogue.gegenstaende[id].platten[index];
  assert.equal(plate.flatBuilding.building,type);
  assert.equal(plate.flatBuilding.group,catalogue.flatViewGroups[type]);
  if(type===10)continue;
  const item={entry:plate,gx:20,gy:30,tiles:plate.kacheln};
  assert.deepEqual(JSON.parse(JSON.stringify(context.flatSceneParts(item))),geo.buildingParts(item),'negative native groups preserve original attached-ground parts');
 }
});

test('Space placement preview draws the same native parts at the flat datum', () => {
  const draws=[],parts=[{bild:'flat',gx:4,gy:5},{bild:'flat',gx:5,gy:5}];
  const context=vm.createContext({state:{flatView:true},flatSceneParts:()=>parts,
    image:()=>({complete:true,naturalWidth:30}),bauHoehe:()=>8,
    drawNativePart:(ctx,part,img,lift)=>draws.push([part,lift])});
  vm.runInContext(source.slice(source.indexOf('  function drawSprite('),source.indexOf('  function wallFootDepth(')),context);
  assert.equal(context.drawSprite({}, {},4,5,2),true);
  assert.deepEqual(draws.map(([part,lift])=>[part.gx,part.gy,lift]),[[4,5,8],[5,5,8]]);
});
