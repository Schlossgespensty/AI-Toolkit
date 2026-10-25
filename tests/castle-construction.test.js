const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../src/js/castle-construction');
const geometry=require('../src/js/castle-geometry');
function terrain(size=100,padding=0){const length=(size+padding*2)**2;return {padding,buildFlags:new Uint32Array(length),heights:new Uint8Array(length),blocked:new Uint8Array(length)};}
const rect=(left=10,bottom=10,right=12,top=12)=>({left,bottom,right,top});

test('construction warnings require actual map construction data, never walking obstructions',()=>{
  assert.equal(evaluate(50,[rect()],null),null);
  assert.equal(evaluate(50,[rect()],{blocked:new Uint8Array(10000).fill(1)}),null);
  const map=terrain();map.blocked.fill(1);
  assert.equal(evaluate(50,[rect()],map),null,'trees, bushes and animals obstruct walking but not this warning');
  assert.equal(evaluate(1,[rect()],map),null,'rally markers are not buildings');
  assert.equal(evaluate(200,[rect()],map),null,'dummy steps are not buildings');
});

test('permanent water, marsh, rocks, borders and dug moats mark the entire affected placement',()=>{
  for(const [flag,reason] of [[1,'water'],[1048576,'water'],[2097152,'water'],[128,'rock'],[16,'outside'],[32,'outside'],[536870912,'marsh'],[1073741824,'moat']]){
    const map=terrain();map.buildFlags[11*100+11]=flag;
    assert.ok(evaluate(50,[rect()],map)?.reasons.includes(reason),reason);
    assert.equal(evaluate(50,[rect(20,20,22,22)],map),null,'unrelated neighbouring buildings stay clear');
  }
});

test('height differences use exact per-building limits, independently of absolute elevation',()=>{
  for(const [type,limit]of [[50,12],[56,40],[70,80]]){
    const map=terrain();map.heights.fill(80);map.heights[11*100+11]=80+limit;
    assert.equal(evaluate(type,[rect()],map),null,`${type}: equality is buildable`);
    map.heights[11*100+11]++;
    assert.ok(evaluate(type,[rect()],map)?.reasons.includes('slope'),`${type}: one unit over the limit is not`);
  }
  const map=terrain();map.heights.fill(201);
  assert.ok(evaluate(50,[rect()],map)?.reasons.includes('height'));
});

test('resource buildings and AI-clearable rock retain the game exceptions',()=>{
  const map=terrain();map.buildFlags[11*100+11]=128|131072;
  assert.ok(evaluate(50,[rect()],map)?.reasons.includes('rock'));
  assert.equal(evaluate(56,[rect()],map),null,'quarry may occupy its stone');
  assert.equal(evaluate(110,[rect()],map),null,'AI tower placement explicitly allows rock clearance');
  map.buildFlags[11*100+11]=128|524288;
  assert.equal(evaluate(90,[rect()],map),null,'iron mine may occupy ore');
  map.buildFlags[11*100+11]=536870912|2147483648;
  assert.equal(evaluate(91,[rect()],map),null,'pitch rig may occupy oil marsh');
  assert.ok(evaluate(50,[rect()],map)?.reasons.includes('marsh'));
});

test('a drawbridge may cross a moat but retains its absolute terrain-height limit',()=>{
  const map=terrain();map.buildFlags[11*100+11]=1073741824;
  assert.equal(evaluate(105,[rect()],map),null);
  map.heights.fill(13);
  assert.ok(evaluate(105,[rect()],map)?.reasons.includes('height'));
});

test('composite keep footprints include the courtyard and stockpile, excluding their empty gap',()=>{
  const footprint=geometry.footprintRectsAtXY(61,43,56,[7,15]);
  const map=terrain();map.buildFlags[49*100+43]=1048576;
  assert.equal(evaluate(61,footprint,map),null,'empty courtyard connection corners do not block the keep');
  map.buildFlags[52*100+51]=1048576;
  assert.ok(evaluate(61,footprint,map)?.reasons.includes('water'),'the attached stockpile counts');
});

test('padded terrain indices do not wrap outside the map',()=>{
  const map=terrain(100,5);map.buildFlags[(10+5)*110+10+5]=1;
  assert.ok(evaluate(50,[rect()],map)?.reasons.includes('water'));
  assert.ok(evaluate(50,[rect(-6,0,-6,0)],map)?.reasons.includes('outside'));
});

test('construction flags follow the selected start orientation into canonical editor coordinates',()=>{
  const fs=require('node:fs'),vm=require('./helpers/localized-vm'),geo=require('../src/js/iso-geometry');
  const source=fs.readFileSync(require.resolve('../src/js/iso-view'),'utf8');
  const x=21,y=64,flags=new Uint32Array(400*400),heights=new Uint8Array(400*400);
  const context=vm.createContext({geo,window:{},
    ausBase64:(text,Type)=>{if(!text)return null;const bytes=Uint8Array.from(Buffer.from(text,'base64'));return new Type(bytes.buffer);}});
  vm.runInContext(source.slice(source.indexOf('  let routeTerrainCache'),source.indexOf('  function hasGameMap()')),context);
  for(const orientation of [0,2,4,6]) {
    const keep={x:200,y:200,orientation};flags.fill(0);heights.fill(0);
    const turned=geo.rotateGrid(x,99-y,1,orientation),world=geo.mapTileForGrid(turned.gx,turned.gy,keep);
    flags[world.my*400+world.mx]=1048576;heights[world.my*400+world.mx]=40;
    const encode=typed=>Buffer.from(typed.buffer).toString('base64');
    const map={path:'test.map',pathTerrain:{version:5,fingerprint:String(orientation),
      buildFlags:encode(flags),heights:encode(heights),constructionLift:encode(new Uint8Array(400*400)),blocked:encode(new Uint8Array(400*400)),hardBlocked:encode(new Uint8Array(400*400))}};
    context.gameMap=()=>map;context.currentKeep=()=>keep;
    const local=context.analysisTerrain(),index=(y+5)*110+x+5;
    assert.equal(local.buildFlags[index],1048576);
    assert.equal(local.heights[index],40);
    assert.ok(evaluate(50,[rect(x,y,x,y)],local)?.reasons.includes('water'));
    assert.equal(local.buildFlags,context.analysisTerrain().buildFlags,'ordinary redraws reuse the decoded grid');
  }
});
