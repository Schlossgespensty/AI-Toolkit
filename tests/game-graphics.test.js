'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {resolveGameGraphics} = require('../src/node/game-graphics');
const {loadGameBuildingAssets} = require('../src/node/game-building-assets');
const sources = Object.values(require('../config/iso-source-parts.json'));
const walls = Object.values(require('../config/iso-wall-sources.json'));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-textures-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const write = (name, data) => {const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return file;};
  return {root,write};
}
function pixelAtPart(part) {
  const png=fs.readFileSync(fileURLToPath(part.bild)), chunks=[];
  for(let at=8;at<png.length;) {const size=png.readUInt32BE(at);if(png.toString('ascii',at+4,at+8)==='IDAT')chunks.push(png.subarray(at+8,at+8+size));at+=size+12;}
  const raw=require('node:zlib').inflateSync(Buffer.concat(chunks));
  const stride=1+png.readUInt32BE(16)*4;
  for(let y=0;y<part.hoehe;y++) for(let x=0;x<part.breite;x++) {
    const at=(part.sy+y)*stride+1+(part.sx+x)*4;
    if(raw[at+3])return [...raw.subarray(at,at+4)];
  }
  throw new Error('Empty part');
}
function activate(write, names=['Pack']) {
  write('ucp-config.yml', JSON.stringify({active:true,'config-full':{'load-order':names.map(extension=>({extension,version:'1.0.0'}))}}));
}
test('graphics use active source order, ignore inactive gmx and commented registrations', t => {
  const {root,write}=fixture(t);
  const base=write('gm/tile_land8.gm1','base');
  const first=write('ucp/plugins/Pack-1.0.0/resources/gm/tile_land8.gm1','pack');
  write('ucp/plugins/Pack-1.0.0/resources/gmx/tile_land8.gm1','inactive');
  write('ucp/plugins/Pack-1.0.0/unused/gm/tile_land8.gm1','unused');
  write('ucp/plugins/Pack-1.0.0/init.lua', "modules.files:registerFileSource('ucp/plugins/Pack-*/resources/')\n-- modules.files:registerFileSource('ucp/plugins/Pack-*/unused/')");
  assert.equal(resolveGameGraphics(root).file('tile_land8'),base);
  activate(write); assert.equal(resolveGameGraphics(root).file('tile_land8'),first);
  const before=resolveGameGraphics(root).revision;
  const second=write('ucp/plugins/Second-1.0.0/resources/gm/tile_land8.gm1','second');
  write('ucp/plugins/Second-1.0.0/init.lua',"modules.files:registerFileSource('ucp/plugins/Second-*/resources/')");
  activate(write,['Pack','Second']);
  assert.equal(resolveGameGraphics(root).file('tile_land8'),second);
  assert.notEqual(resolveGameGraphics(root).revision,before);
  write('ucp-config.yml','active: false'); assert.equal(resolveGameGraphics(root).file('tile_land8'),base);
});
function gm1(count, pillar=false, color=0x7c00) {
  const size=pillar?60:512, at=5208+count*24, buffer=Buffer.alloc(at+count*size);
  buffer.writeUInt32LE(count,12);buffer.writeUInt32LE(pillar?5:3,20);
  for(let i=0;i<count;i++) {
    buffer.writeUInt32LE(i*size,5208+i*4);buffer.writeUInt32LE(size,5208+count*4+i*4);
    const h=5208+count*8+i*16;buffer.writeUInt16LE(30,h);buffer.writeUInt16LE(pillar?8:16,h+2);
    for(let j=0;j<size;j+=2)buffer.writeUInt16LE(color,at+i*size+j);
  }
  return buffer;
}
test('building assets run in a worker, share concurrent loads and invalidate after a texture changes', async t => {
  const {root,write}=fixture(t), counts=new Map();
  for(const s of [...sources,...walls,{file:'tree_apple',index:100},{file:'tile_flatties',index:45},{file:'tile_sea8',index:332},{file:'killing_pits',index:15},{file:'pitch_ditches',index:3},...walls.filter(s=>s.pillar!==undefined).map(s=>({file:'tile_walls',index:s.pillar}))])counts.set(s.file,Math.max(counts.get(s.file)||0,s.index+1));
  for(const [name,count] of counts)write(`gm/${name}.gm1`,gm1(count,name==='tile_walls'));
  const apple=fs.readFileSync(path.join(root,'gm/tree_apple.gm1'));
  for(let i=0;i<256;i++)apple.writeUInt16LE(0x7c00,88+2*512+i*2);
  apple.writeUInt16LE(0x03e0,88+2*512+2*2);
  // Distinguish zero-based stump picture 100 from the normal tree picture 0.
  apple.set([0,2,0x80],5208+counts.get('tree_apple')*24+100*512);
  write('gm/tree_apple.gm1',apple);
  const cache=path.join(root,'cache');
  const first=loadGameBuildingAssets(root,cache);
  assert.equal(loadGameBuildingAssets(root,cache),first);
  const result=await first;
  const part=result.gegenstaende[61].partsLayouts[0][0];
  assert.match(part.bild,/^file:/);
  assert.deepEqual(pixelAtPart(part),[255,0,0,255]);
  assert.ok(fs.existsSync(fileURLToPath(part.bild)));
  assert.deepEqual(result.assetWarnings,[]);
  assert.equal(result.flatTiles.length,46);
  assert.ok(result.flatTiles.every(tile=>tile.bild===part.bild && tile.breite===30 && tile.hoehe===16));
  const pit=result.gegenstaende[98];
  assert.equal(pit.nativePit,8,'the sidebar uses a completed pit');
  assert.deepEqual(pit.pitVariants.map(p=>p.nativePit),[8,9,10,11,12,13,14,15]);
  assert.ok(pit.pitVariants.every(p=>p.bild===part.bild&&p.sx!=null&&p.sy!=null));
  const orchard=result.gegenstaende[72].cameraPartsLayouts.flat(2);
  const orchardTrees=orchard.filter(p=>p.flatField);
  assert.equal(orchardTrees.length,32,'all eight trees survive in each camera');
  assert.ok(orchardTrees.every(p=>p.flatSprite?.bild===part.bild),'orchard stumps are decoded into the native atlas');
  assert.deepEqual(pixelAtPart(orchardTrees[0].flatSprite),[0,255,0,255]);
  assert.deepEqual(pixelAtPart(orchardTrees[0]),[255,0,0,255],'normal orchard keeps its original frame');
  const geo=require('../src/js/iso-geometry');
  for(const [type,fieldCount,ground,symbol] of [[70,36,30,31],[71,24,30,31],[73,23,28,29]]) {
    const entry=result.gegenstaende[type];
    for(const layouts of entry.cameraPartsLayouts) for(const layout of layouts) {
      const fields=layout.filter(p=>p.flatField);
      assert.equal(fields.length,fieldCount);
      assert.ok(fields.every(p=>p.flatSprite?.sx===result.flatTiles[ground].sx&&p.flatSprite?.sy===result.flatTiles[ground].sy));
      const normal=geo.buildingParts({gx:10,gy:20,entry:{...entry,partsLayouts:[layout]}});
      assert.equal(normal.length,fieldCount+9,'normal crop/fence components survive');
      const flat=geo.flatBuildingParts({gx:10,gy:20,entry:{...entry,partsLayouts:[layout]}},result.flatTiles,()=>7);
      assert.equal(flat.length,fieldCount+9,'Space follows the sparse hut and field/fence footprint');
      assert.deepEqual(flat.map(p=>[p.gx,p.gy]),normal.map(p=>[p.gx,p.gy]));
      assert.equal(flat.filter(p=>p.sx===result.flatTiles[symbol].sx&&p.sy===result.flatTiles[symbol].sy).length,1,'one symbol on the hut');
      assert.ok(flat.every(p=>p.hoehe===16&&p.dy===0),'no tall posts or crops in Space');
    }
  }
  const again=await loadGameBuildingAssets(root,cache);
  assert.deepEqual(again,result);
  const moat=Object.values(result.gegenstaende[106].moatVariants);
  assert.equal(new Set(moat.map(v=>`${v.sx},${v.sy}`)).size,17,'each native moat picture has its own atlas location');
  write('gm/tile_castle.gm1',gm1(counts.get('tile_castle'),false,0x03e0));
  const changed=await loadGameBuildingAssets(root,cache);
  assert.notEqual(changed.gegenstaende[61].partsLayouts[0][0].bild,part.bild);
  assert.deepEqual(pixelAtPart(changed.gegenstaende[61].partsLayouts[0][0]),[0,255,0,255]);
  for(const type of [25,26,35,46,181,182,183,184,185,186,98,99])assert.match(changed.gegenstaende[type].bild,/^file:/);
});
test('all bundled building components and wall variants have native source identities', () => {
  const parts=require('../config/iso-source-parts.json'), wall=require('../config/iso-wall-sources.json');
  const visit=value=>{if(!value||typeof value!=='object')return;
    if(value.bild==='building-parts.png')assert.ok(parts[`${value.sx},${value.sy}`]);
    if(/^(mauer|treppe)_.*\.png$/.test(value.bild||''))assert.ok(wall[value.bild],value.bild);
    Object.values(value).forEach(visit);
  };visit(require('../assets/aiv/iso/verzeichnis.json'));
});
test('classic saved terrain IDs stay independent of replacement file counts', () => {
  const files=require('../config/map-picture-layout.json').files;
  const stock={withPictures:files.filter(f=>f.count).sort((a,b)=>a.from-b.from)};
  const {pictureForValue}=require('../src/node/game-map').internals;
  // IDs after Reconquista's differently sized church/deer/land-macro stocks
  // must remain attached to their original file and local picture.
  for(const name of ['tile_rocks8','pitch_ditches','tile_land_macros']) {
    const entry=files.find(f=>f.name===name);
    assert.deepEqual(pictureForValue(stock,entry.from+1),{name,index:0});
  }
});


test('saved map layout switches only to a fully validated replacement layout', () => {
  const {choosePictureStock,pictureStock} = require('../src/node/game-map').internals;
  const classic=pictureStock([{gmId:1,name:'terrain',from:0,count:2},{gmId:2,name:'animation',from:2,count:3}], 'classic');
  const pack=pictureStock([{gmId:1,name:'terrain',from:0,count:4},{gmId:2,name:'animation',from:4,count:1}], 'installed');
  const gfx=Buffer.from([1,0,3,0,4,0]);
  const valid=p=>p.name==='terrain';
  assert.equal(choosePictureStock(gfx,[classic,pack],valid),pack);
  assert.equal(choosePictureStock(Buffer.from([1,0]),[classic,pack],valid),classic,'ambiguous layouts preserve classic compatibility');
  assert.equal(choosePictureStock(Buffer.from([5,0]),[classic,pack],valid),classic,'a partially plausible table is not accepted');
});

test('plain sea topology disambiguates valid layouts shifted by 21 pictures', () => {
  const {choosePictureStock,pictureStock,MAP_TILES}=require('../src/node/game-map').internals;
  const classic=pictureStock([{gmId:166,name:'tile_sea_new_01',from:0,count:1536}],'classic');
  const installed=pictureStock([{gmId:166,name:'tile_sea_new_01',from:21,count:1536}],'installed');
  const gfx=Buffer.alloc(MAP_TILES*2),logic=Buffer.alloc(MAP_TILES*4),misc=Buffer.alloc(MAP_TILES*2),logic2=Buffer.alloc(MAP_TILES);
  gfx.writeUInt16LE(22);logic.writeUInt32LE(1);
  const layers={logic,misc,logic2};
  assert.equal(choosePictureStock(gfx,[classic,installed],()=>true,layers),installed,'plain water cannot select a corner picture');
  gfx.writeUInt16LE(1);
  assert.equal(choosePictureStock(gfx,[classic,installed],()=>true,layers),classic,'old saved IDs remain supported');
  gfx.writeUInt16LE(22);
  assert.equal(choosePictureStock(gfx,[classic,installed],()=>true),classic,'no topology evidence retains compatibility');
  assert.equal(choosePictureStock(gfx,[classic,installed],p=>p.index===21,layers),classic,'semantic evidence cannot admit invalid pictures');
});
