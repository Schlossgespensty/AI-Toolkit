const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const format = require('../src/js/castle-format');
const constants = require('../config/aiv_constants.json');

test('outposts retain the actual DE mapper IDs and cannot disappear in classic export', () => {
  const doc = {frames: [178, 179, 53, 79].map((itemType, i) => ({
    itemType, tilePositionOfsets: [1010 + i * 20], shouldPause: false
  })), miscItems: []};
  assert.deepEqual(JSON.parse(format.stringify(doc)), doc);
  assert.equal(format.classicIssues(doc, constants).length, 4);
  for (const id of [178, 179, 53]) assert.deepEqual(constants[id].size, [5, 5]);
  assert.deepEqual(constants[79].size, [10, 10]);
  assert.equal(constants[79].name, 'Bedouin Stockade');
});

test('DE JSON retains timing, extensions, sparse numbering and unknown items', () => {
  const doc = { pauseDelayAmount: 123, extension: {future: true}, frames: [
    {}, {itemType: 79, tilePositionOfsets: [1724], shouldPause: true, future: 7},
    {itemType: 99999, tilePositionOfsets: [2345], shouldPause: false}
  ], miscItems: [{itemType: 9022, positionOfset: 4567, number: 7}] };
  assert.deepEqual(JSON.parse(format.stringify(doc)), doc);
  assert.ok(format.classicIssues(doc, constants).length >= 4);
  assert.deepEqual(format.classicIssues({frames: [{itemType: 54, tilePositionOfsets: [1724], shouldPause: false}], miscItems: [{itemType: 6, positionOfset: 4567, number: 1}]}, constants), []);
  assert.throws(() => format.stringify({...doc, miscItems: [{itemType: 9022, positionOfset: 10000, number: 0}]}), /offset/);
});

test('DE editor normalization preserves empty steps, pauses and marker numbering on save', () => {
  const source = fs.readFileSync(require.resolve('../src/js/castle-editor'), 'utf8');
  const section = (a,b) => source.slice(source.indexOf(a), source.indexOf(b));
  const state = {format: 'aivjson'};
  const context = vm.createContext({state, window: {castleFormat: format}, deepClone: value => JSON.parse(JSON.stringify(value)), isUnitType: id => constants[id]?.kind === 'unit'});
  for (const [a,b] of [['  function normalizeDocument(', '  function itemInfo('], ['  function renumberUnits(', '  function refExists('], ['  function outputDocument(', '  function outputContent(']]) vm.runInContext(section(a,b), context);
  const doc = {pauseDelayAmount: 100, frames: [{}, {itemType: 79, tilePositionOfsets: [5524], shouldPause: true}], miscItems: [{itemType: 9024, positionOfset: 5540, number: 5}]};
  state.document = context.normalizeUnitStorage(context.normalizeDocument(structuredClone(doc)));
  assert.equal(state.document.frames[0].tilePositionOfsets.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(context.outputDocument())), doc);
});

test('JSON save uses atomic text writer and never calls native encoder', async () => {
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const writes=[];
  const context=vm.createContext({castleFormat:format, asCastleDocument:x=>x, atomicWriteFile:(...args)=>writes.push(args), writeAivDocument:()=>assert.fail('native codec used for JSON')});
  vm.runInContext(main.slice(main.indexOf('async function writeCastleDocument('),main.indexOf('function placeholderPortrait')),context);
  const doc={frames:[],miscItems:[]};
  for(const path of ['Castle.aivjson','Castle.AIVJSON','Castle.aijson']) {
    const result=await context.writeCastleDocument(doc,path,{});
    assert.equal(result.native,false);
    assert.deepEqual(JSON.parse(writes.at(-1)[1]),doc);
    assert.equal(writes.at(-1)[2],'utf8');
  }
});

test('start-place changes persist only a compact preference and coalesce redraws', () => {
  const source=fs.readFileSync(require.resolve('../src/js/iso-view'), 'utf8');
  const map={path:'GreekSea.map',keeps:[{},{}],keepIndex:0,dataUrl:'large payload'};
  const saved=[];let refreshes=0;
  const context=vm.createContext({MAP_POSITION_KEY:'position',gameMap:()=>map,window:{localStorage:{setItem:(...args)=>saved.push(args)}},refresh:()=>refreshes++});
  vm.runInContext(source.slice(source.indexOf('  function setGameMapKeep('),source.indexOf('  let routeTerrainCache')),context);
  context.setGameMapKeep(1);context.setGameMapKeep(1);
  assert.equal(refreshes,1);
  assert.deepEqual(JSON.parse(saved[0][1]),{path:map.path,index:1});
  assert.equal(saved.length,1);
});


test('DE building placeholders keep their real footprint without classic sprites', () => {
  const geometry = require('../src/js/iso-geometry');
  const items = geometry.collectItems({frames:[{itemType:79,tilePositionOfsets:[5524]}]}, {}, null, constants);
  assert.equal(items[0].tiles,10);
});


test('unchanged native castles retain original bytes, while re-encoding diagnoses timing loss', () => {
  const {writeNativeAiv} = require('../src/node/aiv-file');
  const bytes=Buffer.from([1,2,3]); const writes=[];
  const options={codec:{encodeAiv:()=>assert.fail('unchanged native file must not be re-encoded')},document:{frames:[{itemType:25,tilePositionOfsets:[1724],shouldPause:true}]},destination:'castle.aiv',sourceBytes:bytes,unchanged:true,atomicWriteFile:(file,buffer)=>writes.push(buffer)};
  writeNativeAiv(options);
  assert.deepEqual(writes[0],bytes);
  assert.throws(()=>writeNativeAiv({...options,unchanged:false}),/pauses/);
  assert.equal(writes.length,1,'failed conversion does not touch destination');
});
