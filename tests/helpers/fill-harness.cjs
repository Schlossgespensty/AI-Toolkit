'use strict';
const fs=require('node:fs'),vm=require('./localized-vm');
module.exports=function fillHarness(sourceFile,geometry,placements=[],options={}) {
 const source=fs.readFileSync(sourceFile,'utf8');let footprintCalls=0,draws=0,commits=0;
 const definitions={25:{overlap:'replace'},26:{overlap:'replace'},106:{},54:{},61:{},200:{kind:'unit',overlap:'allow'}};
 const state={currentItemType:options.type||106,constants:definitions,document:{miscItems:[],frames:placements.map(p=>({itemType:p.type,tilePositionOfsets:[p.off]}))}};
 const rects=(type,off)=>{footprintCalls++;return geometry.footprintRectsAtXY(type,off%100,Math.floor(off/100),options.sizes?.[type]||[1,1]);};
 const context=vm.createContext({geometry,GRID:100,state,frames:()=>state.document.frames,placementRefs:()=>placements,
  footprintRects:rects,footprintRectsAtXY:(type,x,y)=>rects(type,y*100+x),offsetToXY:off=>({x:off%100,y:Math.floor(off/100)}),xyToOffset:(x,y)=>y*100+x,
  itemName:String,isLineSequence:()=>false,overlapMode:type=>definitions[type]?.overlap,
  isUnitType:type=>type===200,frameRefKey:(i)=>placements[i].ref,unitRefKey:String,
  refIsLocked:ref=>options.locked?.includes(ref),maxAmount:()=>options.maximum??null,
  setStatus(){},scheduleDraw(){draws++;},commitBrush(){commits++;}});
 for(const name of ['countType','boundsError','validatePlacement','brushAddOne','topmostRefAtTile','bucketFill']) {
  const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+10);
  vm.runInContext(source.slice(start,end),context);
 }
 return {context,state,fill:tile=>context.bucketFill(tile),metrics:()=>({footprintCalls,draws,commits})};
};
