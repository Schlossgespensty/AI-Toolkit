'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('./helpers/localized-vm');
const source=fs.readFileSync(require.resolve('../src/js/castle-editor'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(){
 const map=deferred(),tiles=deferred(),commits=[],paths=[],statuses=[];
 let selected={path:'selected.map'},context;
 const view={gameMapInfo:()=>selected,setMapTiles:async(...args)=>{commits.push(args);return true;}};
 context=vm.createContext({window:{isoView:view,electronAPI:{
   loadGameMap:path=>{paths.push(['map',path]);return map.promise;},
   loadMapTiles:path=>{paths.push(['tiles',path]);return tiles.promise;}}},
   mapSelectionRequest:0,mapRefreshRequest:null,kachelnLaufen:null,updateMapControls(){},setStatus:message=>statuses.push(message)});
 vm.runInContext(source.slice(source.indexOf('  async function refreshGameMap('),source.indexOf('  async function chooseMap(')),context);
 return {context,map,tiles,commits,paths,statuses,select:path=>{selected=path?{path}:null;context.mapSelectionRequest++;}};
}
test('refresh reads the exact selected map and its tiles once while repeated clicks are busy',async()=>{
 const h=harness(),pending=h.context.refreshGameMap();
 assert.equal(await h.context.refreshGameMap(),false);
 assert.equal(h.commits.length,0);assert.ok(h.context.mapRefreshRequest);
 const map={name:'Changed map',path:'selected.map'};h.map.resolve(map);await new Promise(setImmediate);
 assert.deepEqual(h.paths,[['map','selected.map'],['tiles','selected.map']]);
 h.tiles.resolve({atlas:'new'});assert.equal(await pending,true);
 assert.equal(h.commits[0][1],map);assert.equal(h.context.mapRefreshRequest,null);
 assert.match(h.statuses.at(-1),/Changed map/);
});
test('failed refresh retains the displayed map and enables retry',async()=>{
 const h=harness(),pending=h.context.refreshGameMap();h.map.reject(new Error('file still being saved'));
 assert.equal(await pending,false);assert.equal(h.commits.length,0);assert.equal(h.context.mapRefreshRequest,null);
 assert.match(h.statuses.at(-1),/file still being saved/);
});
test('a late refresh cannot replace a different map or restore a removed map',async()=>{
 for(const next of ['other.map',null]){
   const h=harness(),pending=h.context.refreshGameMap();h.select(next);h.map.resolve({name:'Old'});
   assert.equal(await pending,false);assert.equal(h.commits.length,0);assert.equal(h.paths.length,1);
 }
});
