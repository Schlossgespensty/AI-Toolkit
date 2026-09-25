'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const geometry=require('../src/js/castle-geometry');
const harness=require('./helpers/fill-harness.cjs');
const editor=require.resolve('../src/js/castle-editor');

test('shared flood core matches independent region search for 4/8-connected rectangular grids',()=>{
 let seed=123;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let trial=0;trial<100;trial++)for(const diagonal of [false,true]) {
  const width=11,height=7,blocked=Array.from({length:width*height},()=>random()<0.4),start={x:5,y:3};
  const expected=new Set(),queue=[start];
  for(let i=0;i<queue.length;i++) {
   const {x,y}=queue[i],key=y*width+x;
   if(x<0||y<0||x>=width||y>=height||blocked[key]||expected.has(key))continue;
   expected.add(key);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(diagonal||!dx||!dy))queue.push({x:x+dx,y:y+dy});
  }
  const actual=new Set(),calls=new Uint8Array(width*height);
  geometry.floodRegion(start,(x,y)=>{assert.equal(calls[y*width+x]++,0);return blocked[y*width+x];},{width,height,diagonal,visit:(_x,_y,key)=>actual.add(key)});
  assert.deepEqual(actual,expected);
 }
});
test('flood seeds outside bounds and zero limits do not call the predicate',()=>{
 for(const start of [null,{x:-1,y:0},{x:10,y:0},{x:0.5,y:0}])assert.equal(geometry.floodRegion(start,()=>{throw Error('outside');},{width:10}),0);
 assert.equal(geometry.floodRegion({x:0,y:0},()=>{throw Error('limit');},{limit:0}),0);
});
test('full-map bucket has no 4000-cell cap, commits once, and avoids quadratic footprint scans',()=>{
 const h=harness(editor,geometry);h.fill({x:50,y:50});
 assert.equal(h.state.brushOffsets.length,10000);assert.equal(new Set(h.state.brushOffsets).size,10000);
 assert.equal(h.metrics().commits,1);assert.equal(h.metrics().draws,0);
 assert.ok(h.metrics().footprintCalls<=50000,JSON.stringify(h.metrics()));
});
test('indexed fill has identical placement, replacement and lock behavior to individual brush validation',()=>{
 const placements=[];
 for(let y=20;y<=32;y++)for(let x=20;x<=32;x++)if(x===20||x===32||y===20||y===32)placements.push({type:25,off:y*100+x,ref:`${x},${y}`});
 for(const options of [{type:106},{type:54,sizes:{54:[3,3]}},{type:54,sizes:{54:[3,3]},locked:['20,22','20,23']},{type:54,maximum:3},{type:200}]) {
  const fast=harness(editor,geometry,placements,options),reference=harness(editor,geometry,placements,options);
  fast.fill({x:25,y:25});
  Object.assign(reference.state,{brushOffsets:[],brushTypes:[],brushSeen:new Set(),brushReplacements:new Set()});
  const fields=geometry.floodTiles({x:25,y:25},(x,y)=>!!reference.context.topmostRefAtTile({x,y}));
  for(const field of geometry.orderFillTiles(fields,reference.context.footprintRectsAtXY(options.type,0,0),(x,y)=>!!reference.context.topmostRefAtTile({x,y})))reference.context.brushAddOne(field);
  assert.deepEqual([...fast.state.brushOffsets],[...reference.state.brushOffsets]);
  assert.deepEqual([...fast.state.brushReplacements].sort(),[...reference.state.brushReplacements].sort());
 }
});
test('footprint index deduplicates overlapping rectangles and clips map bounds',()=>{
 const item={rects:[{left:-1,bottom:-1,right:1,top:1},{left:0,bottom:0,right:2,top:2}]};
 const index=geometry.footprintIndex([item],p=>p.rects,3);
 assert.equal(index.query(item.rects).size,1);assert.equal(index.has(2,2),true);
});


test('building fill aligns with local room edges regardless of clicked grid phase',()=>{
 const wall=[];
 for(let y=11;y<=18;y++)for(let x=13;x<=20;x++)if(x===13||x===20||y===11||y===18)wall.push({type:54,off:y*100+x,ref:`${x},${y}`});
 const run=start=>{const h=harness(editor,geometry,wall,{type:26,sizes:{26:[3,3]}});h.fill(start);return [...h.state.brushOffsets];};
 const first=run({x:15,y:15}),second=run({x:18,y:16});
 assert.deepEqual(first,second,'local boundaries determine anchors, not the clicked grid phase');
 assert.equal(first.length,4,'four 3x3 buildings fit the enclosed 6x6 room');
});


test('completed fills do not remain as a duplicate live placement preview',()=>{
 const fs=require('node:fs'),vm=require('./helpers/localized-vm'),source=fs.readFileSync(editor,'utf8');
 const begin=source.indexOf('    getPlacementPreview() {'),end=source.indexOf('    getMarquee()',begin);
 const state={tool:'bucket',currentItemType:106,gesture:null,brushOffsets:[1,2,3],brushTypes:[],hoverTile:null};
 const context=vm.createContext({state,isPlacementTool:()=>true,lineSequence:()=>[],offsetToXY:off=>({x:off,y:0})});
 const api=vm.runInContext('({'+source.slice(begin,end)+'})',context);
 assert.equal(api.getPlacementPreview(),null);
 state.tool='brush';state.gesture='brush';assert.equal(api.getPlacementPreview().tiles.length,3);
 state.gesture=null;assert.equal(api.getPlacementPreview(),null);
});
