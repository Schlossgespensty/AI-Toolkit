const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { internals: { upperTilePicture, packMapPictures } } = require('../src/node/game-map');

test('Space resolves doors, linked grounds and partial decorations through saved building IDs',()=>{
 const {flatMapGraphics,pictureStock,MAP_TILES}=require('../src/node/game-map').internals;
 const types=Buffer.alloc(MAP_TILES),ids=Buffer.alloc(MAP_TILES*2),logic=Buffer.alloc(MAP_TILES*4),records=Buffer.alloc(6*812),random=Buffer.alloc(MAP_TILES*2),gfx=Buffer.alloc(MAP_TILES*2);
 for(let t=0;t<7;t++){gfx.writeUInt16LE(700+t,t*2);random.writeUInt16LE(2,t*2);}
 // Three standalone keep-door records have no BuildingWasLayer hint.
 for(let id=1;id<=3;id++) {ids.writeUInt16LE(id,(id-1)*2);records.writeUInt16LE(70+id,id*812+210);}
 ids.writeUInt16LE(4,6);types[3]=9;records.writeUInt16LE(57,4*812+210); // Barracks' linked ground.
 records.writeUInt16LE(101,5*812+210); // Partial map shrine, two surviving cells.
 ids.writeUInt16LE(5,8);ids.writeUInt16LE(5,10);types[6]=9; // Stale hint on an unowned cell.
 const sections=[[1049,types],[1012,ids],[1013,records],[1003,logic]];
 const header=Buffer.alloc(3036);let offset=0;
 sections.forEach(([id,data],i)=>{header.writeUInt32LE(data.length,632+i*4);header.writeUInt32LE(id,1232+i*4);header.writeUInt32LE(offset,2432+i*4);offset+=data.length;});
 const source={gfx,random,buffer:Buffer.concat([header,...sections.map(s=>s[1])]),directory:{offset:0,count:sections.length}};
 const flat=flatMapGraphics(source,pictureStock([{name:'tile_flatties',from:1000,count:46}],'fixture'));
 const values=Array.from({length:7},(_,t)=>flat.readUInt16LE(t*2));
 assert.deepEqual(values,[1007,1003,1007,703,1015,1015,706]);
 assert.equal(gfx.readUInt16LE(0),700,'normal terrain is unchanged');
});

test('map upper graphics retain GM1 lift, half-tile offset and transparent pixels', () => {
  const raw = Buffer.concat([Buffer.alloc(512), Buffer.from([0, 0xff, 0x7f, 0x80])]);
  const picture = upperTilePicture({ height: 2, lift: 40, direction: 3 }, raw);
  assert.equal(picture.dx, 14);
  assert.equal(picture.dy, -40);
  assert.equal(picture.rgba[3], 255);
  assert.equal(picture.rgba[7], 0);
  assert.equal(picture.rgba[30 * 4 + 3], 0);
  assert.equal(upperTilePicture({ height: 16 }, Buffer.alloc(512)), null);
});

test('Space retains upper pixels and native offsets from extended shore and terrain banks',t=>{
 const {buildTileAtlas,pictureStock,MAP_TILES}=require('../src/node/game-map').internals;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flat-shore-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'gm'));
 const raw=Buffer.concat([Buffer.alloc(512),Buffer.from([0,0xff,0x7f,0x80])]);
 const bytes=Buffer.alloc(5232+raw.length);bytes.writeUInt32LE(1,12);bytes.writeUInt32LE(3,20);
 bytes.writeUInt32LE(raw.length,5212);bytes.writeUInt16LE(30,5216);bytes.writeUInt16LE(2,5218);
 bytes.writeUInt16LE(7,5226);bytes[5228]=3;raw.copy(bytes,5232);
 const gfx=Buffer.alloc(MAP_TILES*2);gfx.writeUInt16LE(1);
 for(const name of ['tile_sea_new_01','tile_land_macros']) {
  fs.writeFileSync(path.join(root,'gm',name+'.gm1'),bytes);
  const stock=pictureStock([{name,gmId:1,from:0,count:1}],'test');
  const normal=buildTileAtlas(gfx,root,{stock}),flat=buildTileAtlas(gfx,root,{stock,flat:true});
  assert.deepEqual(flat.upper,normal.upper,'Space retains the complete selected tile overlay');
  assert.equal(flat.upper.entries[0].dx,14);assert.equal(flat.upper.entries[0].dy,-7);
 }
});

test('map sprite packing preserves blank indices and separates tall sprites', () => {
  const make = (width, height) => ({ width, height, dx: 14, dy: -40, rgba: Buffer.alloc(width * height * 4) });
  const atlas = packMapPictures([make(1500, 10), null, make(700, 100)]);
  assert.equal(atlas.entries[1], null);
  assert.ok(atlas.entries[2].y > atlas.entries[0].y + atlas.entries[0].height);
  assert.equal(atlas.entries[2].dy, -40);
  assert.match(atlas.dataUrl, /^data:image\/png;base64,/);
  assert.throws(() => packMapPictures([make(2048, 1)]), /dimensions/);
});

test('map keep footprints become desert without modifying captures or adjacent tiles', () => {
  const { replaceMapKeeps, tileIndex, MAP_TILES } = require('../src/node/game-map').internals;
  const keeps = [{x:188,y:294},{x:161,y:106}];
  for (let camera = 0; camera < 4; camera++) {
    const source = Buffer.alloc(MAP_TILES * 2);
    for (let tile = 0; tile < MAP_TILES; tile++) source.writeUInt16LE(22000 + camera, tile * 2);
    const result = replaceMapKeeps(source, keeps, 1);
    const replaced = new Set();
    for (const keep of keeps) {
      // Keep, entrance, forecourt/campfire, stockpile: independently specify
      // the observed map footprint so a missed component fails this check.
      for (const [dx,dy,w,h] of [[0,0,7,7],[2,7,3,1],[0,8,7,7],[7,2,5,5]]) {
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)replaced.add(tileIndex(keep.x+dx+x,keep.y+dy+y));
      }
    }
    assert.equal(replaced.size, 252);
    for (let tile = 0; tile < MAP_TILES; tile++) {
      assert.equal(result.readUInt16LE(tile * 2), replaced.has(tile) ? 1 : 22000 + camera);
      assert.equal(source.readUInt16LE(tile * 2), 22000 + camera);
    }
    assert.equal(replaceMapKeeps(source, [], 1), source);
  }
});

test('successful native map loading never constructs the saved-map fallback', async () => {
  const { resolveNativeMapTiles } = require('../src/node/game-map').internals;
  const source = {}, native = {}, output = {};
  const calls = [];
  const result = await resolveNativeMapTiles(source, async () => native, (parsed, layers) => {
    calls.push({parsed,layers}); return output;
  });
  assert.equal(result, output);
  assert.deepEqual(calls, [{parsed:source,layers:native}]);
});

test('native failures and rejected captures build the saved fallback only when needed', async () => {
  const { resolveNativeMapTiles } = require('../src/node/game-map').internals;
  for (const failDuringBuild of [false,true]) {
    const source = {}, native = {}, calls = [];
    const result = await resolveNativeMapTiles(source, async () => {
      if (!failDuringBuild) throw Error('capture failed');
      return native;
    }, (parsed,layers) => {
      assert.equal(parsed,source); calls.push(layers);
      if (layers) throw Error('capture rejected');
      return {atlas:'saved'};
    });
    assert.equal(result.atlas,'saved');
    assert.match(result.nativeError,/capture (failed|rejected)/);
    assert.deepEqual(calls,failDuringBuild?[native,undefined]:[undefined]);
  }
});

test('cactus picture selection clamps each variety and rejects non-cactus types', () => {
  const { internals } = require('../src/node/game-map');
  // Die Deckelung ist der Grund, warum das hoechste Bild einer Art doppelt so
  // oft vorkommt - ohne sie zeigte jede vierte Pflanze ein fremdes Bild.
  assert.equal(internals.cactusPicture(17, 3), 3, 'Art 17 deckelt die 4 auf 3');
  assert.equal(internals.cactusPicture(18, 3), 6, 'Art 18 deckelt die 7 auf 6');
  assert.equal(internals.cactusPicture(19, 3), 9, 'Art 19 deckelt die 10 auf 9');
  assert.equal(internals.cactusPicture(16, 7), 17, 'Art 16 geht bis 17');
  assert.equal(internals.cactusPicture(16, 0), 10);
  assert.equal(internals.cactusPicture(2, 3), 0, 'ein Baum ist kein Kaktus - da wird nichts geraten');
});

test('Space selects timber and orchard stumps, hides shrubs and retains cactus pictures',()=>{
 const {treeViewPicture}=require('../src/node/game-map').internals;
 for(let type=0;type<20;type++) {
  const tree={type,picture:12,originX:58,originY:150,palette:3};
  assert.equal(treeViewPicture(tree),12,'normal view retains the saved frame');
  const expected=type>=1&&type<=4?148:type===15?101:type>=5&&type<=10?0:12;
  assert.equal(treeViewPicture(tree,true),expected);
  assert.deepEqual(tree,{type,picture:12,originX:58,originY:150,palette:3},'view selection does not alter map data');
 }
 assert.equal(treeViewPicture({type:1,picture:0},true),148,'a missing saved animation frame does not remove a timber stump');
});


test('native pillars follow both sloped tile edges and repeat source rows without stretching', () => {
  const {pillarPicture} = require('../src/node/gm1');
  const buffer = Buffer.alloc(24 + 60 * 2); buffer.writeUInt32LE(5, 20);
  for (let x=0;x<30;x++) {buffer.writeUInt16LE(0x7c00,24+x*2);buffer.writeUInt16LE(0x03e0,84+x*2);}
  const file = {buffer, picturesAt:24, pictures:[{offset:0,size:120,width:30,height:9}]};
  const p = pillarPicture(file, 0, 3);
  assert.equal(p.height, 10);
  const pixel = (x,y) => [...p.rgba.subarray((y*30+x)*4,(y*30+x+1)*4)];
  for (let x=0;x<30;x++) {
    const shift = Math.min(x>>1,(29-x)>>1);
    assert.deepEqual(pixel(x,shift),[255,0,0,255]);
    assert.deepEqual(pixel(x,shift+1),[0,255,0,255]);
    assert.deepEqual(pixel(x,shift+2),[255,0,0,255]);
    if (shift) assert.equal(pixel(x,shift-1)[3],0);
  }
  buffer.writeUInt32LE(3,20);assert.equal(pillarPicture(file,0,3),null);
});

test('large scenery atlases split into bounded pages, preserving indices and native pixels',()=>{
 const picture={width:1020,height:1020,dx:14,dy:-100,rgba:Buffer.alloc(1020*1020*4)};
 picture.rgba.set([12,34,56,255]);
 const pictures=Array(35).fill(picture);pictures.splice(3,0,null);
 assert.throws(()=>packMapPictures(pictures),/size limit/);
 const atlas=packMapPictures(pictures,{paged:true});
 assert.equal(atlas.entries[3],null);assert.ok(atlas.pages.length>1);
 const decoded=atlas.pages.map(url=>{
  const png=Buffer.from(url.split(',')[1],'base64'),width=png.readUInt32BE(16),height=png.readUInt32BE(20),chunks=[];
  assert.ok(width<=2048&&height<=4096);
  for(let at=8;at<png.length;){const n=png.readUInt32BE(at);if(png.toString('ascii',at+4,at+8)==='IDAT')chunks.push(png.subarray(at+8,at+8+n));at+=n+12;}
  return {width,raw:require('node:zlib').inflateSync(Buffer.concat(chunks))};
 });
 for(const entry of atlas.entries.filter(Boolean)) {
  assert.equal(entry.dx,14);assert.equal(entry.dy,-100);
  const {raw,width}=decoded[entry.page],at=entry.y*(width*4+1)+1+entry.x*4;
  assert.deepEqual([...raw.subarray(at,at+4)],[12,34,56,255]);
 }
});
