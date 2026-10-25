'use strict';
// Numeric metadata only. See docs/construction-warnings.md for the engine checks.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {virtualToFile}=require('../src/node/pe-addresses');
const root=path.resolve(__dirname,'..');
const bytes=fs.readFileSync(path.join(process.argv[2] || '', 'Stronghold Crusader.exe'));
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
if(!['3bb0a8c1e72331b3a30a5aa93ed94beca0081b476b04c1960e26d5b45387ac5a','0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34'].includes(sha))throw Error('Unsupported executable layout');
const at=virtualToFile(bytes),integer=va=>bytes.readInt32LE(at(va));
const rules={};
for(const [id,definition] of Object.entries(require('../config/aiv_constants.json'))) {
 const type=Number(id);
 if(definition.kind==='unit' || type<28 || type>358 || type===200)continue;
 // convertCommandBuildingTypeToBuildingType: mapper-28 -> byte switch -> MOV EAX, building ID.
 const branch=bytes[at(0x4097e0)+type-28],target=integer(0x409670+branch*4);
 const offset=at(target);
 if(bytes[offset]!==0xb8)continue;
 const building=bytes.readUInt32LE(offset+1);
 if(!building || building>=110)continue;
 rules[type]={building,maxHeightDifference:integer(0x5b8108+building*4),heightLimit:integer(0x5b7f50+building*4),
   clearRock:!!integer(0x5b8478+building*4),marsh:integer(0x5b87e8+building*4),moat:!!integer(0x5b89a0+building*4)};
}
const data={source:{exeSHA256:sha,heightUnits:'native terrain height units',heightTable:'0x005B8108',placementCheck:'0x005037B0 / 0x004F9A60'},rules};
fs.writeFileSync(path.join(root,'src/js/castle-construction-data.js'),`// Extracted numerical placement rules; no game artwork or executable code.\n(function(root){const data=${JSON.stringify(data)};if(typeof module==='object'&&module.exports)module.exports=data;else root.castleConstructionData=data;})(globalThis);\n`);
console.log(`${Object.keys(rules).length} construction rules extracted`);
