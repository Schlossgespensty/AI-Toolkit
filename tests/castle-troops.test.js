const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const troops = require('../src/js/castle-troops');
const geo = require('../src/js/iso-geometry');
const marker = (type, offset=5050) => ({itemType:type, positionOfset:offset});
const defense = (names, total=80, walls=total) => Object.fromEntries([
  ['DefTotal',total],['DefWalls',walls],...names.map((name,i)=>['DefUnit'+(i+1),name])]);

test('recruitment cycles conserve the budget and distribute remainders in slot order', () => {
  const names=['ArabArcher','EuropArcher','Crossbowman','Spearman','Pikeman','Maceman','Swordsman','Knight'];
  const totals=troops.defenseTotals(defense(names,100));
  assert.deepEqual([...totals.values()],[13,13,13,13,12,12,12,12]);
  assert.equal([...totals.values()].reduce((a,b)=>a+b),100);
  for (const [spots,expected] of [[3,[5,4,4]],[4,[4,3,3,3]]]) {
    const plan=troops.plan(Array.from({length:spots},()=>marker(16)),defense(names,100));
    assert.deepEqual(plan.filter(p=>p.type===16).map(p=>p.count),expected);
    assert.equal(plan.reduce((sum,p)=>sum+p.count,0),100,'missing positions retain their units at fallback destinations');
  }
  assert.deepEqual(troops.plan([marker(6),marker(7)],defense(['EuropArcher','EuropArcher','Crossbowman'],12)).map(p=>p.count),[8,4]);
  assert.equal(troops.plan([marker(6)],defense(['EuropArcher'],1000))[0].count,1000,'allocation is independent of the nine-sprite cap');
  assert.equal(troops.plan([marker(6)],defense(['EuropArcher'],3,80))[0].count,3,'wall preview cannot exceed total defenders');
  assert.deepEqual([...troops.defenseTotals(defense(['EuropArcher','None','ArabArcher'],13))],[[6,13]],'first None terminates the cycle');
  assert.deepEqual([...troops.defenseTotals(defense(['None','EuropArcher'],13))],[]);
  assert.deepEqual([...troops.defenseTotals(defense(['EuropArcher','Crossbowman','EuropArcher'],5))],[[6,3],[7,2]],'duplicate slots aggregate only after rounding');
});

test('Gatekeeper preserves every wall defender with native keep/campfire fallbacks', () => {
  const markers=[16,6,14].flatMap(type=>Array.from({length:10},()=>marker(type)));
  const aic=defense(['ArabArcher','ArabArcher','ArabArcher','ArabArcher','EuropArcher','EuropArcher','Slinger','ArabSwordsman'],145,144);
  const plan=troops.plan(markers,aic);
  assert.deepEqual(plan.filter(p=>p.type===16).map(p=>p.count),[8,8,7,7,7,7,7,7,7,7]);
  assert.deepEqual(plan.filter(p=>p.type===6).map(p=>p.count),[4,4,4,4,4,4,3,3,3,3]);
  assert.deepEqual(plan.filter(p=>p.type===14).map(p=>p.count),[2,2,2,2,2,2,2,2,1,1]);
  assert.deepEqual(plan.at(-1),{type:18,count:18,ref:'standby:18',destination:'keep'});
  assert.equal(plan.reduce((sum,p)=>sum+p.count,0),144,'the remaining patrol recruit is not a wall defender');
  const fallback=troops.plan([],defense(Object.keys(troops.types),80));
  assert.equal(fallback.find(p=>p.type===8).destination,'campfire');
  assert.equal(fallback.find(p=>p.type===6).destination,'keep');
});

test('generic allocation matches independent recruitment and smallest-group simulation', () => {
  const names=Object.keys(troops.recruitmentTypes);
  let seed=192837;
  const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
  for (let trial=0;trial<400;trial++) {
    const slots=Array.from({length:8},()=>random(6)===0 ? 'None' : names[random(names.length)]);
    const total=random(250), walls=random(300), aic=defense(slots,total,walls);
    const markers=Object.keys(troops.types).flatMap(name=>Array.from({length:random(5)},()=>marker(troops.types[name])));
    const expected=markers.map(m=>({type:m.itemType,count:0})), standby=new Map();
    const cycle=slots.slice(0,slots.includes('None') ? slots.indexOf('None') : 8);
    for (let unit=0;cycle.length && unit<Math.min(total,walls);unit++) {
      const type=troops.recruitmentTypes[cycle[unit%cycle.length]];
      let smallest;
      for (const group of expected) if (group.type===type && (!smallest || group.count<smallest.count)) smallest=group;
      if (smallest) smallest.count++;
      else standby.set(type,(standby.get(type)||0)+1);
    }
    const plan=troops.plan(markers,aic);
    assert.deepEqual(plan.slice(0,markers.length).map(p=>p.count),expected.map(p=>p.count));
    assert.deepEqual(new Map(plan.filter(p=>p.destination).map(p=>[p.type,p.count])),standby);
    assert.equal(plan.reduce((sum,p)=>sum+p.count,0),cycle.length ? Math.min(total,walls) : 0);
  }
});

test('every selectable recruitment type keeps its quota even without an AIV marker or idle sprite', () => {
  const options=require('../config/optionPools.json').units.filter(name=>name!=='None');
  assert.deepEqual(Object.keys(troops.recruitmentTypes).sort(),options.sort());
  assert.deepEqual([...troops.defenseTotals(defense(['EuropArcher','Monk','ArabArcher','Tunneler'],12))],
    [[6,3],['monk',3],[16,3],['tunneler',3]]);
  const plan=troops.plan([],defense(['Monk','Tunneler'],7));
  assert.deepEqual(plan.map(p=>[p.type,p.count,p.destination]),[['monk',4,'campfire'],['tunneler',3,'campfire']]);
});

test('zero or unmatched defense produces no troops, while no character retains one marker preview', () => {
  for(const aic of [defense(['EuropArcher'],0),defense(['EuropArcher'],80,0),defense(['None']),defense(['ArabArcher'])])
    assert.equal(troops.plan([marker(6)],aic)[0].count,0);
  assert.equal(troops.plan([marker(6)],null)[0].count,1);
  assert.equal(troops.plan([marker(2)],defense(['None'],0))[0].count,1,'siege placement is independent of defense recruitment');
});

test('occupancy identity changes only for defense inputs or markers, never unrelated AIC edits', () => {
  const cached=troops.createPlanner(), markers=[marker(6)], aic=defense(['EuropArcher'],7);
  const first=cached(markers,aic);
  assert.equal(cached([{...markers[0]}],{...aic,MaxWood:500}),first);
  assert.equal(cached(markers,aic),first);
  assert.notEqual(cached(markers,{...aic,DefWalls:6}),first);
  assert.notEqual(cached([marker(6,5051)],aic),first);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first[0]));
  assert.notEqual(cached(markers,{...aic,lordType:'Arab'}),first);
});

test('lord appearance follows character lord.Type and reserves the centre of the visible keep', () => {
  for (const [lordType,type] of [['Europ','lord-europ'],['Arab','lord-arab']]) {
    const plan=troops.plan([], {...defense(['ArabSwordsman'],18),lordType});
    assert.deepEqual(plan[0],{type,count:1,ref:'lord',destination:'lord'});
    const keep={gx:43,gy:43,tiles:7,itemType:61};
    const anchors=geo.troopAnchors(plan,keep,0);
    assert.deepEqual([anchors[0].gx,anchors[0].gy],[46,46]);
    assert.deepEqual([anchors[1].gx,anchors[1].gy],[46,47]);
    const layout=troops.layout(anchors,troops.supports([keep],()=>0));
    assert.equal(layout.length,10,'one lord and at most nine representative swordsmen');
    assert.equal(new Set(layout.map(p=>p.gy*100+p.gx)).size,10);
    assert.ok(layout.every(p=>p.elevation===92));
    assert.equal(layout.find(p=>p.gx===46 && p.gy===46).marker.ref,'lord');
    assert.deepEqual(geo.troopAnchors(plan,undefined,0),[],'no future keep leaks into an earlier step');
  }
  assert.deepEqual(troops.plan([],null),[],'no character means no invented lord');
});

test('standby anchors follow the rendered keep and campfire across map and camera turns', () => {
  const groups=troops.plan([], {...defense(['ArabSwordsman','Slinger'],20),lordType:'Arab'});
  for (const map of [0,2,4,6]) for (const camera of [0,2,4,6]) {
    const world=geo.rotateGrid(43,43,7,map), rotation=(map+camera)%8;
    const keep={...geo.rotateGrid(world.gx,world.gy,7,camera),tiles:7,itemType:61,cameraRotation:camera,
      entry:{platten:[{dx:0,dy:8,kacheln:7}]}};
    const resolved=geo.troopAnchors(groups,keep,rotation).map(group=>({
      ...group,...geo.rotateGrid(group.gx,group.gy,1,map)}));
    for (const group of resolved) assert.deepEqual([group.gx-world.gx,group.gy-world.gy],
      group.destination==='lord' ? [3,3] : group.destination==='keep' ? [3,4] : [3,8]);
  }
});

test('preview groups reserve rally tiles and never share a tile, including duplicate markers', () => {
  const markers=[{gx:50,gy:50,count:9,ref:'a'}, {gx:50,gy:51,count:9,ref:'b'},
    {gx:50,gy:50,count:9,ref:'duplicate'}];
  const layout=troops.layout(markers,()=>0);
  const keys=layout.map(({gx,gy})=>gy*100+gx);
  assert.equal(new Set(keys).size,keys.length);
  for (const marker of markers.slice(0,2)) {
    const centre=layout.find(unit=>unit.gx===marker.gx && unit.gy===marker.gy);
    assert.equal(centre.marker,marker,'neighbours cannot take another group’s rally tile');
  }
  assert.ok(layout.every(({gx,gy,marker})=>Number.isInteger(gx) && Number.isInteger(gy)
    && Math.abs(gx-marker.gx)<=1 && Math.abs(gy-marker.gy)<=1));
});

test('preview spacing stays inside the map and on the supporting deck', () => {
  const edge=troops.layout([{gx:0,gy:0,count:9}],()=>0);
  assert.deepEqual(edge.map(({gx,gy})=>[gx,gy]),[[0,0],[0,1],[1,0],[1,1]]);
  const support=troops.supports([{gx:10,gy:12,tiles:3,itemType:110}],()=>0);
  const roof=troops.layout([{gx:10,gy:12,count:9}],support);
  assert.equal(roof.length,4,'a corner has only four adjacent roof tiles, never floating troops');
  assert.ok(roof.every(unit=>unit.elevation===296 && unit.gx>=10 && unit.gy>=12));
  let queries=0;
  troops.layout(Array.from({length:50},(_,i)=>({gx:i,gy:50,count:9})),()=>{queries++;return 0;});
  assert.ok(queries<=50*10,'formation lookup is bounded per marker, with no map-wide search');
});

test('troop supports use only visible walls, stairs, towers and gate decks above terrain', () => {
  const tower={gx:10,gy:12,tiles:3,itemType:110};
  assert.equal(troops.supports([],()=>30)(11,13),30);
  assert.equal(troops.supports([tower],()=>30)(11,13),326);
  assert.equal(troops.supports([tower],()=>30)(13,13),30);
  for(const [itemType,height] of [[61,92],[25,90],[46,60],[181,80],[186,0],[144,128],[145,128],[146,128],[147,128]])
    assert.equal(troops.supports([{gx:5,gy:8,tiles:1,itemType}],()=>7)(5,8),height+7);
});

test('idle draw commands preserve native anchors and identity across visible-step changes', () => {
  const source=fs.readFileSync(require.resolve('../src/js/iso-view.js'),'utf8');
  const sprite={path:'idle.png',width:20,height:36,dx:-10,dy:-32};
  const image={complete:true,naturalWidth:20};
  const doc={miscItems:[marker(6,geo.offsetFromGrid(11,13))]};
  const state={view:{zoom:1,panX:0,panY:0},unitAssets:{idleSprites:{6:sprite}},unitCommands:new Map(),troopAic:null};
  const context=vm.createContext({state,window:{castleTroops:troops},geo,currentDocument:()=>doc,
    bodenHoehe:()=>0,currentRotation:()=>0,image:()=>image});
  vm.runInContext(source.slice(source.indexOf('  function recordSceneCommands('),source.indexOf('  /** @param {SceneRect} a')),context);
  vm.runInContext(source.slice(source.indexOf('  function troopSceneCommands('),source.indexOf('  function paintScene(')),context);
  const ground=context.troopSceneCommands([])[0];
  const tower={gx:10,gy:12,tiles:3,itemType:110};
  const raised=context.troopSceneCommands([tower])[0];
  assert.equal(raised.y,ground.y-296);
  assert.equal(context.troopSceneCommands([tower])[0],raised);
  const stableAnchors=state.troopAnchors, stablePlan=state.troopPlan;
  assert.equal(context.troopSceneCommands([])[0],ground,'returning before the tower restores cached ground command');
  assert.equal(state.troopAnchors,stableAnchors,'ordinary step changes reuse resolved rally anchors');
  assert.equal(state.troopPlan,stablePlan,'ordinary step changes never recalculate recruitment');
  assert.equal(ground.w,20); assert.equal(ground.h,36);
  const [x,y]=geo.isoPoint(11.5,13.5,state.view);
  assert.equal(ground.x,x-10);assert.equal(ground.y,y-32);
  for (const itemType of [144,145,146,147]) {
    const gate = context.troopSceneCommands([{...tower,itemType,tiles:itemType<146 ? 5 : 7}])[0];
    assert.equal(gate.x,ground.x,'the rally tile and sprite origin do not shift sideways');
    assert.equal(gate.y,ground.y-128,'native gate roof height must not reuse the 90px wall height');
    assert.equal(context.troopSceneCommands([])[0],ground,'scrubbing before the gate restores ground support');
  }
  state.troopAic=defense(['EuropArcher'],9);state.troopDocument=null;
  const formation=context.troopSceneCommands([tower]);
  assert.equal(formation.length,9);
  assert.equal(new Set(formation.map(c=>c.order.gy*100+c.order.gx)).size,9);
  assert.ok(formation.every(c=>Number.isInteger(c.order.gx) && Number.isInteger(c.order.gy) && c.order.layer===4),
    'each troop sorts at its own supporting tile');
  for(let height=0;height<100; height++) {
    context.bodenHoehe=()=>height;
    context.troopSceneCommands([tower]);
  }
  assert.ok(state.unitCommands.size<=state.unitCommandLimit+9,'cache stays bounded through changing terrain heights');
  for (const rotation of [0,2,4,6]) {
    context.currentRotation=()=>rotation;
    const rotated=context.troopSceneCommands([]);
    assert.equal(rotated.length,9);
    const sourceTiles=rotated.map(command=>{
      const tile=geo.rotateGrid(command.order.gx,command.order.gy,1,(8-rotation)%8);
      return tile.gy*100+tile.gx;
    }).sort((a,b)=>a-b);
    assert.deepEqual(Array.from(sourceTiles),[1210,1211,1212,1310,1311,1312,1410,1411,1412],
      'camera rotation preserves the same nine world tiles');
  }
});

test('terrain, structures and troop commands share the same stable depth merge', () => {
  const source=fs.readFileSync(require.resolve('../src/js/iso-view.js'),'utf8');
  const context=vm.createContext({geo});
  vm.runInContext(source.slice(source.indexOf('  function* mergeSceneCommands('),source.indexOf('  function visibleSceneItems(')),context);
  const list=(prefix,layer)=>Array.from({length:100},(_,i)=>({key:prefix+i,order:{gx:i%10,gy:Math.floor(i/10),layer}}))
    .sort((a,b)=>geo.renderOrder(a.order,b.order));
  for (const layers of [[0,2,4],[2,2,2]]) {
    const streams=[list('terrain',layers[0]),list('building',layers[1]),list('troop',layers[2])];
    // Include equal-depth ties, exhausted streams and optional overlays.
    for (let present=0;present<8;present++) {
      const input=streams.map((stream,index)=>present & (1<<index) ? stream : []);
      const expected=input.flat().sort((a,b)=>geo.renderOrder(a.order,b.order));
      assert.deepEqual([...context.mergeSceneCommands(...input)],expected);
    }
    assert.deepEqual([...context.mergeSceneCommands(...streams.slice(0,2))],
      streams.slice(0,2).flat().sort((a,b)=>geo.renderOrder(a.order,b.order)));
  }
});
