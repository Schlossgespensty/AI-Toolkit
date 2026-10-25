const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm');
const format=require('../src/js/castle-format');
const constants=require('../config/aiv_constants.json');
const source=fs.readFileSync(require.resolve('../src/js/castle-editor'),'utf8');
const body=name=>{const at=source.indexOf('  function '+name+'(');return source.slice(at,source.indexOf('\n  function ',at+5));};
function editor(type=6,formatName='aivjson') {
 const state={format:formatName,currentItemType:type,document:{frames:[],miscItems:[]},selected:new Set()};
 const statuses=[],undo=[];
 const context=vm.createContext({state,window:{},itemInfo:type=>constants[type]||{},isUnitType:type=>constants[type]?.kind==='unit',
  countType:type=>state.document.miscItems.filter(m=>m.itemType===type).length,boundsError:()=>'',overlapMode:()=> 'allow',
  isLineSequence:()=>false,xyToOffset:(x,y)=>y*100+x,offsetToXY:o=>({x:o%100,y:Math.floor(o/100)}),
  pushUndo:()=>undo.push(structuredClone(state.document)),deleteRefs(){},unitRefKey:i=>'u:'+i,
  changed:message=>statuses.push(message),setStatus:message=>statuses.push(message),itemName:type=>constants[type].name});
 for(const name of ['maxAmount','availableUnitNumber','renumberUnits','unitDisplayNumber','validatePlacement','placeSingle'])vm.runInContext(body(name),context);
 return{context,state,statuses,undo};
}
test('placement supports the 11th and 30th guarding spots, then rejects the 31st without mutation',()=>{
 const e=editor();
 for(let n=0;n<30;n++)e.context.placeSingle({x:n,y:50});
 assert.deepEqual(e.state.document.miscItems.map(m=>m.number),Array.from({length:30},(_,i)=>i));
 assert.equal(e.state.document.miscItems[10].number,10);
 const before=JSON.stringify(e.state.document);e.context.placeSingle({x:31,y:50});
 assert.equal(JSON.stringify(e.state.document),before);assert.equal(e.undo.length,30);
 assert.match(e.statuses.at(-1),/30/);
});
test('siege engines, oil engineers, special markers and unsupported DE class keep their original limits',()=>{
 for(const [type,limit]of [[1,9],[2,10],[3,10],[4,10],[5,10],[20,10],[21,10],[9029,10]]) {
  const e=editor(type);for(let i=0;i<=limit;i++)e.context.placeSingle({x:i,y:50});
  assert.equal(e.state.document.miscItems.length,limit,type);
 }
 assert.equal(editor(9022).context.maxAmount(9022),30);
});
test('expanded DE groups stay contiguous after deletion and preserve marker extensions',()=>{
 const e=editor();e.state.document.miscItems=Array.from({length:30},(_,number)=>({itemType:6,number,positionOfset:5000+number,custom:{number}}));
 e.state.document.miscItems.splice(4,1);e.context.renumberUnits();
 assert.deepEqual(e.state.document.miscItems.map(m=>m.number),Array.from({length:29},(_,i)=>i));
 assert.equal(e.state.document.miscItems[4].custom.number,5);
 const unknown={itemType:999,number:99,positionOfset:100};e.state.document.miscItems.push(unknown);e.context.renumberUnits();assert.equal(unknown.number,99);
});
test('all 30 slots survive DE JSON including numbering and future fields; classic export fails before writing',async()=>{
 const doc={frames:[],miscItems:Array.from({length:30},(_,number)=>({itemType:18,number,positionOfset:5000+number,future:'preserve'})),future:{format:'candidate'}};
 assert.deepEqual(JSON.parse(format.stringify(doc)),doc);
 assert.match(format.classicIssues(doc,constants).join('\n'),/above 10.*aivjson/);
 const codec=await import('../src/node/aiv-codec.mjs');
 assert.throws(()=>codec.encodeAiv(doc,require('../config/aiv_templates.json')),/above 10/);
 const writes=[];
 assert.throws(()=>require('../src/node/aiv-file').writeNativeAiv({codec,document:doc,destination:'test.aiv',templates:require('../config/aiv_templates.json'),atomicWriteFile:(...args)=>writes.push(args)}),/above 10/);
 assert.equal(writes.length,0);
});
