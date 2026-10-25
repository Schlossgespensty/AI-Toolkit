'use strict';
// Numeric metadata only. Art is decoded from the selected game at runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {virtualToFile}=require('../src/node/pe-addresses');
const bytes=fs.readFileSync(path.join(process.argv[2]||'','Stronghold Crusader.exe'));
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
if(!['3bb0a8c1e72331b3a30a5aa93ed94beca0081b476b04c1960e26d5b45387ac5a','0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34'].includes(sha))throw Error('Unsupported executable layout');
const at=virtualToFile(bytes),integer=va=>bytes.readInt32LE(at(va));
const filename=path.join(__dirname,'../assets/aiv/iso/verzeichnis.json');
const catalogue=JSON.parse(fs.readFileSync(filename,'utf8'));
const geometry=require('../src/js/castle-geometry');
for(const [id,entry] of Object.entries(catalogue.gegenstaende)) {
 const type=Number(id);
 const height=geometry.structureHeight(type);
 if(height!==null)entry.structureHeight=height;
 if(type>=28&&type<=358&&type!==200) {
  const branch=bytes[at(0x4097e0)+type-28],target=integer(0x409670+branch*4),offset=at(target);
  if(bytes[offset]===0xb8) {
   const building=bytes.readUInt32LE(offset+1);
   if(building>0&&building<110)entry.flatBuilding={building,group:integer(0xb44220+building*4)};
  }
 }
 // Linked buildings have their own runtime types (placeKeep/placeBarracks/
 // placeEngineersguild/placeTunnelersguild/placeOilsmelter), not the parent's
 // BuildingWasLayer value. Negative groups retain their native ground art.
 const grounds={61:[55,10],86:[57,58,56],87:[57,58,56],88:[53],89:[59],180:[51]}[type];
 for(const [index,plate] of (entry.platten||[]).entries()) {
  const building=grounds?.[index];
  if(!building)throw Error(`Missing native attached-ground type for ${type}/${index}`);
  plate.flatBuilding={building,group:integer(0xb44220+building*4)};
 }
}
catalogue.flatTiles=Array.from({length:46},(_,index)=>({bild:`native-flat:${index}`}));
// Finished killing pits use the covered bank, pictures 9–16 (one-based).
// Keep the bundled fallback name; both hosts decode nativePit from the game.
catalogue.gegenstaende['98'].nativePit=8;
catalogue.gegenstaende['98'].pitVariants=Array.from({length:8},(_,i)=>({bild:`native-pit:${8+i}`,nativePit:8+i}));
catalogue.flatViewGroups=Array.from({length:110},(_,type)=>integer(0xb44220+type*4));
catalogue.flatRockPictures=[1,2,3,4].map(index=>integer(0xb485e8+index*4)-1);
catalogue.flatViewSource={exeSHA256:sha,groups:'0x00B44220',selection:'0x004E9845 / 0x004EBBC4'};
fs.writeFileSync(filename,JSON.stringify(catalogue,null,1)+'\n');
console.log('Native flat-view metadata and 46 runtime tile references extracted');
