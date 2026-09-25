'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const a=require('../src/js/castle-analysis');
const rect=(left,bottom,right=left,top=bottom)=>({left,bottom,right,top});
const p=(type,r,extra={})=>({type,rects:[r],...extra});
test('fire colors distinguish two, four and eight tiles with a smooth transparent edge',()=>{
  assert.deepEqual(a.fireColor(a.fireStrength(1)),[220,20,60,189]);
  assert.deepEqual(a.fireColor(a.fireStrength(1.5)),[220,20,60,189]);
  assert.deepEqual(a.fireColor(a.fireStrength(3.5)),[255,235,20,153]);
  const blue=a.fireColor(a.fireStrength(7));assert.ok(blue[2]>blue[0] && blue[2]>blue[1]);
  assert.equal(a.fireColor(a.fireStrength(8))[3],0);
  assert.equal(a.fireStrength(9),0);
  let alpha=255;for(let d=0;d<=8;d+=.01){const next=a.fireColor(a.fireStrength(d))[3];assert.ok(next<=alpha);alpha=next;}
  for(const n of [3,4,5,9,10,11]) {
    const heat=a.fireExposure([p(54,rect(20,20,19+n,19+n),{name:'Hovel',health:800})]);
    assert.equal(heat[20*100+11],0);assert.ok(heat[20*100+12]>0);
    assert.equal(heat[20*100+12],heat[20*100+27+n]);
  }
  assert.ok(a.fireExposure([p(52,rect(10,10,14,14),{name:'Stockpile'})]).every(v=>v===0));
});
test('HP scales only the outer halo and uses selected balance health',()=>{
  assert.equal(a.fireRadius({name:'Church',health:1000}),8);
  assert.ok(a.fireRadius({name:'Woodcutter hut',health:60}) < a.fireRadius({name:'Hovel',health:200}));
  assert.ok(a.fireRadius({name:'Hovel'}) < a.fireRadius({name:'Hovel',health:200}));
  for (const hp of [60,200,800]) {
    const heat=a.fireExposure([p(54,rect(20,20),{name:'Hovel',health:hp})]);
    assert.deepEqual(a.fireColor(heat[20*100+22]),[220,20,60,189]);
    const third=a.fireColor(heat[20*100+23]);
    assert.ok(third[1]>100,'third ring has already left crimson');
  }
  const blue=a.fireColor(a.fireStrength(7));
  assert.equal(blue[3],90);assert.ok(blue[2]>blue[0]*4);
  const small=a.fireExposure([p(54,rect(20,20),{name:'Hovel',health:60})]);
  const large=a.fireExposure([p(54,rect(20,20),{name:'Hovel',health:800})]);
  assert.equal(small[20*100+25],0);assert.ok(large[20*100+25]>0);
});
test('balance health rejects malformed overrides',()=>{
  const {validate}=require('../src/js/castle-balance');
  for(const health of [-1,NaN,'invalid']) assert.throws(()=>validate({buildings:{Hovel:{health}}}));
  assert.equal(validate({buildings:{Hovel:{health:60}}}).buildings.Hovel.health,60);
});
test('stockpile mapper tiles are walkable without depending on a translated name',()=>{
  const g=a.routeTopology([p(52,rect(3,3,7,7))],12);
  assert.equal(g.surfaces[5*12+5][0].height,10);
  const ps=[p(null,rect(0,0,14,14)),p(52,rect(1,5,8,5)),p(50,rect(9,5),{worker:true})];
  assert.ok(a.routes(ps,15)[0].path.length);
});
test('stairs, wall walks and directly attached towers form a route',()=>{
  const ps=[p(null,rect(0,0,14,14)),p(52,rect(1,5)),p(186,rect(2,5)),
    p(110,rect(3,4,5,6),{ref:'left'}),p(25,rect(6,5)),
    p(110,rect(7,4,9,6),{ref:'right'}),p(186,rect(10,5)),p(50,rect(11,5,12,6),{worker:true})];
  assert.ok(a.routes(ps,15)[0].path.some(t=>t.x===6 && t.y===5 && t.height===90));
  assert.equal(a.routes(ps.filter(t=>t.type!==186),15)[0].path.length,0);
});
test('all gate orientations have separate open passages and roofs',()=>{
  for(const type of [144,145,146,147]) {
    const g=a.routeTopology([p(type,rect(2,2,6,6))],10);
    const passage=g.surfaces[4*10+4].find(n=>n.kind==='passage');
    assert.equal(g.links[passage.id].length,2);
    assert.ok(g.links[passage.id].every(e=>g.nodes[e.to].height===0));
  }
});
test('diagonal ordinary corners work but wall/fear gaps and water do not',()=>{
  const linked=(placements,terrain)=>{
    const g=a.routeTopology(placements,6,terrain),x=g.surfaces[2*6+2][0],y=g.surfaces[3*6+3][0];
    return g.links[x.id].some(e=>e.to===y.id);
  };
  assert.equal(linked([p(54,rect(2,3)),p(54,rect(3,2))]),true);
  assert.equal(linked([p(25,rect(2,3)),p(176,rect(3,2))]),false);
  const blocked=new Uint8Array(36);blocked[3*6+2]=blocked[2*6+3]=1;
  assert.equal(linked([],{blocked}),false);
});
test('six stair levels connect, while ordinary ground cannot climb a high wall',()=>{
  const ps=[181,182,183,184,185,186].map((type,i)=>p(type,rect(i+1,4)));
  ps.push(p(25,rect(0,4)));
  const g=a.routeTopology(ps,10),at=(x,y)=>g.surfaces[y*10+x][0];
  const linked=(one,two)=>g.links[one.id].some(e=>e.to===two.id);
  for(let x=0;x<6;x++) assert.ok(linked(at(x,4),at(x+1,4)));
  assert.equal(linked(at(0,3),at(0,4)),false);
  assert.ok(linked(at(6,4),at(7,4)));
});
test('full adjacent wall turns a 4x4 workshop entrance to the opposite side',()=>{
  const ps=[p(50,rect(5,5,8,8),{worker:true}),p(25,rect(5,9,8,9)),p(52,rect(1,1,3,3))];
  const route=a.routes(ps,15)[0];
  assert.equal(route.entry.y,4);
});
test('stockpiles cannot erase map obstacles and cliffs prevent ground shortcuts',()=>{
  const blocked=new Uint8Array(100);blocked[55]=1;
  const g=a.routeTopology([p(52,rect(5,5))],10,{blocked});
  assert.equal(g.surfaces[55].length,0);
  const heights=new Uint8Array(100);heights[55]=100;
  const cliff=a.routeTopology([],10,{heights});
  assert.equal(cliff.links[cliff.surfaces[55][0].id].length,0);
});


test('worker eligibility covers civilian jobs and respects explicit population overrides',()=>{
  const config=require('../config/aiv_gamedata.json').population_effects.requires;
  for(const [type,count] of Object.entries(config)) assert.equal(a.workerCount(p(Number(type),rect(1,1))),count);
  for(const type of [52,54,61,77,80,81,86,87,110,144,200,313]) assert.equal(a.workerCount(p(type,rect(1,1))),0);
  assert.equal(a.workerCount(p(50,rect(1,1),{workers:0})),0);
  assert.equal(a.workerCount(p(50,rect(1,1),{workers:2})),2);
});
test('workers cross the interior of stockpiles to a delivery point',()=>{
  const route=a.routes([p(null,rect(0,0,14,14)),p(52,rect(2,7,9,7)),p(50,rect(10,7))],15)[0];
  assert.deepEqual(route.path.map(t=>t.x),[9,8,7,6,5,4,3,2]);
});
test('killing pits and pitch do not sever a narrow worker passage',()=>{
  const ps=[p(null,rect(0,0,14,14)),p(52,rect(1,7)),p(98,rect(2,7,5,7)),p(99,rect(6,7,9,7)),p(50,rect(10,7))];
  assert.equal(a.routes(ps,15)[0].path.length,9);
  assert.equal(a.routes(ps.map(p=>p.type===98?{...p,type:106}:p),15)[0].path.length,0);
});
test('dummy placement markers never erase a wall or moat',()=>{
  const g=a.routeTopology([p(25,rect(2,2)),p(106,rect(3,2)),p(200,rect(2,2,3,2))],6);
  assert.equal(g.surfaces[14][0].kind,'wall');assert.equal(g.surfaces[15].length,0);
});
test('entrance selection preserves clockwise preference and a blocked marker when no side connects',()=>{
  const building=p(50,rect(5,5,8,8));
  const south=a.routes([building,p(52,rect(1,1))],15)[0];
  assert.equal(south.entry.side,0);
  const west=a.routes([building,p(54,rect(6,4)),p(52,rect(1,1))],15)[0];
  assert.equal(west.entry.side,1);
  const disconnected=a.routes([building,p(52,rect(1,1)),p(106,rect(0,3,14,3))],15)[0];
  assert.deepEqual(disconnected.entry,south.entry);
  assert.equal(disconnected.path.length,0);assert.match(disconnected.reason,/no walkable route/);
});
test('each full wall side rotates a 4x4 entrance by 180 degrees',()=>{
  const walls=[rect(5,4,8,4),rect(4,5,4,8),rect(5,9,8,9),rect(9,5,9,8)];
  for(let side=0;side<4;side++){
    const route=a.routes([p(50,rect(5,5,8,8)),p(25,walls[side]),p(52,rect(1,1))],15)[0];
    assert.equal(route.entry.side,(side+2)%4);
  }
});
test('blocked worker entrances retain a marker and reason, nonworkers do not get routes',()=>{
  const routes=a.routes([p(null,rect(0,0,14,14)),p(50,rect(5,5,8,8)),p(87,rect(10,10))],15);
  assert.equal(routes.length,1);assert.ok(routes[0].entry);assert.match(routes[0].reason,/blocked on all sides/);
  assert.equal(routes.walkability[6*15+6],0);
});
test('stockpiles clear vegetation but cannot bypass cliffs or water',()=>{
  const blocked=new Uint8Array(100),hardBlocked=new Uint8Array(100),heights=new Uint8Array(100);
  blocked[55]=blocked[56]=1;hardBlocked[56]=1;heights[55]=80;
  const g=a.routeTopology([p(52,rect(5,5,6,5))],10,{blocked,hardBlocked,heights});
  const stock=g.surfaces[55][0];assert.equal(stock.kind,'stockpile');
  assert.equal(g.links[stock.id].some(e=>g.nodes[e.to].k===54),false);
  assert.equal(g.surfaces[56].length,0);
});
test('the keep courtyard is walkable but the keep building stays solid',()=>{
  const rects=require('../src/js/castle-geometry').footprintRectsAtXY(61,10,20).filter(r=>r.part!=='stockpile');
  const g=a.routeTopology([{type:61,rects}],30);
  assert.equal(g.surfaces[18*30+12].length,0);
  assert.equal(g.surfaces[8*30+12][0].kind,'courtyard');
});



test('consecutive stairs connect in all eight directions, but cannot skip a level',()=>{
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
    for(let type=181;type<186;type++){
      const g=a.routeTopology([p(type,rect(5,5)),p(type+1,rect(5+dx,5+dy))],12);
      const one=g.surfaces[65][0],two=g.surfaces[(5+dy)*12+5+dx][0];
      assert.ok(g.links[one.id].some(e=>e.to===two.id));assert.ok(g.links[two.id].some(e=>e.to===one.id));
    }
  }
  const g=a.routeTopology([p(186,rect(5,5)),p(184,rect(6,6))],12);
  assert.ok(!g.links[g.surfaces[65][0].id].some(e=>e.to===g.surfaces[78][0].id));
});
test('Stairs 2 and 3 connect diagonally to low walls; other levels cannot jump to them',()=>{
  for(let type=181;type<=186;type++){
    const g=a.routeTopology([p(type,rect(5,5)),p(46,rect(6,6))],12);
    assert.equal(g.links[g.surfaces[65][0].id].some(e=>e.to===g.surfaces[78][0].id),[182,183].includes(type));
  }
});
test('every stair level joins gate decks while Stair 6 joins towers directly',()=>{
  for(let type=181;type<=186;type++)for(const target of [110,111,112,113,114,144,145,146,147]){
    const g=a.routeTopology([p(type,rect(5,5)),p(target,rect(6,6,8,8),{ref:'target'})],12);
    const one=g.surfaces[65][0],two=g.surfaces[78].find(n=>n.height>0);
    assert.equal(g.links[one.id].some(e=>e.to===two.id),target>=144 || type===186);
  }
});
test('ground traverses height differences through sixteen, but not seventeen',()=>{
  for(const difference of [8,9,15,16,17]){
    const heights=new Uint8Array(100);heights[55]=difference;
    const g=a.routeTopology([],10,{heights}),one=g.surfaces[55][0],two=g.surfaces[54][0];
    assert.equal(g.links[one.id].some(e=>e.to===two.id),difference<=16);
  }
});
test('map fords remain walkable inside rivers; water, rocky terrain and trees do not',()=>{
  const {pathTileFlags}=require('../src/node/game-map').internals;
  assert.equal(pathTileFlags(1048576|2097152).blocked,0);
  assert.equal(pathTileFlags(1048576).blocked,1);
  assert.equal(pathTileFlags(128).blocked,1);
  assert.equal(pathTileFlags(1048576|2097152|4096).blocked,1);
  const blocked=new Uint8Array(144).fill(1),hardBlocked=blocked.slice();
  for(let x=1;x<=10;x++)blocked[6*12+x]=hardBlocked[6*12+x]=pathTileFlags(1048576|2097152).blocked;
  const route=a.routes([p(52,rect(1,6)),p(50,rect(10,6))],12,{blocked,hardBlocked})[0];
  assert.ok(route.path.length);
});
test('a bridge next to the open gate crosses a later moat and reaches its access points',()=>{
  const ps=[p(null,rect(0,0,19,19)),p(52,rect(2,5)),p(145,rect(3,3,7,7),{ref:'gate'}),
    p(105,rect(8,3,12,7)),p(106,rect(8,3,12,7)),p(52,rect(13,5)),p(50,rect(14,5))];
  const g=a.routeTopology(ps,20);
  const start=g.surfaces[5*20+2][0],goal=g.surfaces[5*20+13][0],seen=new Set([start.id]),q=[start.id];
  for(let i=0;i<q.length;i++)for(const edge of g.links[q[i]])if(!seen.has(edge.to)){seen.add(edge.to);q.push(edge.to);}
  assert.ok(seen.has(goal.id));
  assert.ok(g.nodes.some(n=>n.kind==='deck' && seen.has(n.id)));
  assert.equal(g.surfaces[5*20+10][0].kind,'bridge');
});


test('map navigation margin permits paths around the AIV boundary without shifting entrance dots',()=>{
  const placements=[p(106,rect(0,5,9,5)),p(52,rect(4,1)),p(50,rect(4,8))];
  assert.equal(a.routes(placements,10)[0].path.length,0);
  const margin={padding:2,blocked:new Uint8Array(196),hardBlocked:new Uint8Array(196),heights:new Uint8Array(196)};
  const result=a.routes(placements,10,margin);
  assert.deepEqual(result[0].entry,{x:4,y:7,side:0});
  assert.ok(result[0].path.some(p=>p.x<0 || p.x>=10));
  assert.equal(result.walkability.length,100);
  assert.equal(result.walkability[55],0);
});


test('cliffs connect to walls by total terrain plus structure height in both directions',()=>{
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]])for(const delta of [0,16,17]){
    const heights=new Uint8Array(144);heights[65]=8;heights[(5+dy)*12+5+dx]=98-delta;
    const g=a.routeTopology([p(25,rect(5,5))],12,{heights});
    const wall=g.surfaces[65][0],ground=g.surfaces[(5+dy)*12+5+dx][0];
    assert.equal(wall.elevation,98);
    assert.equal(g.links[wall.id].some(e=>e.to===ground.id),delta<=16);
    assert.equal(g.links[ground.id].some(e=>e.to===wall.id),delta<=16);
  }
});
test('stairs obey total surface height rather than fixed type pairings',()=>{
  const heights=new Uint8Array(144);heights[65]=32;
  const g=a.routeTopology([p(186,rect(5,5)),p(184,rect(6,6))],12,{heights});
  const one=g.surfaces[65][0],two=g.surfaces[78][0];
  assert.equal(one.elevation,two.elevation);
  assert.ok(g.links[one.id].some(e=>e.to===two.id));
  const raised=new Uint8Array(144);raised[65]=80;
  const cliff=a.routeTopology([p(181,rect(6,6))],12,{heights:raised});
  assert.ok(cliff.links[cliff.surfaces[65][0].id].some(e=>e.to===cliff.surfaces[78][0].id));
});
test('equal wall types on different terrain do not create a height jump shortcut',()=>{
  const heights=new Uint8Array(100);heights[55]=80;
  const g=a.routeTopology([p(25,rect(5,5)),p(25,rect(6,5))],10,{heights});
  assert.ok(!g.links[g.surfaces[55][0].id].some(e=>e.to===g.surfaces[56][0].id));
});


test('stockpile storage quadrants are blocked and the nine cross tiles share a flat platform',()=>{
  const heights=new Uint8Array(144).fill(36);heights[3*12+3]=38;
  const g=a.routeTopology([p(52,rect(3,3,7,7))],12,{heights});
  let count=0;
  for(let y=3;y<=7;y++)for(let x=3;x<=7;x++) {
    const ns=g.surfaces[y*12+x];
    assert.equal(ns.length,Number(x===5||y===5));
    if(ns.length){count++;assert.equal(ns[0].elevation,47);}
  }
  assert.equal(count,9);
});
test('all deliveries target the keep stockpile even when a later extension is closer',()=>{
  const first=p(52,{...rect(2,2,6,6),part:'stockpile'});
  const ps=[p(52,rect(10,2,14,6)),first,p(50,rect(16,2,18,4))];
  const route=a.routes(ps,22)[0];
  assert.ok(route.path.length);
  assert.deepEqual(route.path.at(-1),{x:2,y:4,height:10});
  const blocked=a.routes([...ps,p(null,rect(2,4))],22)[0];
  assert.equal(blocked.path.length,0);
  assert.match(blocked.reason,/First stockpile/);
});
test('stockpile platforms connect only within sixteen total height units',()=>{
  for(const difference of [16,17]) {
    const g=a.routeTopology([p(52,rect(1,2),{baseHeight:80}),p(52,rect(2,2),{baseHeight:80-difference})],6);
    const one=g.surfaces[13][0],two=g.surfaces[14][0];
    assert.equal(g.links[one.id].some(e=>e.to===two.id),difference===16);
  }
});
test('walls connect diagonally to gate roofs but only cardinally to towers',()=>{
  for(const type of [145,110])for(const [dx,dy] of [[1,0],[1,1]]) {
    const g=a.routeTopology([p(25,rect(2,2)),p(type,rect(2+dx,2+dy))],6);
    const one=g.surfaces[14][0],two=g.surfaces[(2+dy)*6+2+dx][0];
    assert.equal(g.links[one.id].some(e=>e.to===two.id),type===145||dy===0);
  }
});
test('gate passage ends allow diagonal exits and join the roof at the same endpoint',()=>{
  const g=a.routeTopology([p(145,rect(2,2,6,6))],10);
  const entry=g.surfaces[42].find(n=>n.kind==='passage');
  assert.ok(g.links[entry.id].some(e=>g.nodes[e.to].k===31));
  assert.ok(g.links[entry.id].some(e=>g.nodes[e.to].kind==='deck' && g.nodes[e.to].k===entry.k));
});
test('native terrain flag lift participates in wall and stair height comparisons',()=>{
  const heights=new Uint8Array(36),constructionLift=new Uint8Array(36);
  heights[14]=80;heights[15]=8;constructionLift[14]=4;
  const ps=[p(186,rect(2,2)),p(25,rect(3,2))];
  const g=a.routeTopology(ps,6,{heights,constructionLift});
  assert.equal(g.surfaces[14][0].elevation,84);
  assert.equal(g.surfaces[15][0].elevation,98);
  assert.ok(g.links[g.surfaces[14][0].id].some(e=>e.to===g.surfaces[15][0].id));
  const unlifted=a.routeTopology(ps,6,{heights});
  assert.equal(unlifted.links[unlifted.surfaces[14][0].id].some(e=>e.to===unlifted.surfaces[15][0].id),false);
});


test('attached stair reaches ground through an open gate endpoint, but a closed gate does not',()=>{
  for(const closed of [false,true]) {
    const ps=[p(null,rect(0,0,14,14)),p(52,rect(1,7)),p(186,rect(2,7)),p(145,rect(3,5,7,9),{closed}),p(98,rect(8,7)),p(50,rect(9,7),{workers:1})];
    const rs=a.routes(ps,15);assert.equal(rs[0].path.length>0,!closed);
  }
});


test('mill skips an isolated entrance and enters the reachable stockpile cross',()=>{
  const heights=new Uint8Array(400),blocked=new Uint8Array(400),hardBlocked=new Uint8Array(400);
  // Enclose every tile except the stockpile and a disconnected north pocket.
  blocked.fill(1);
  for(let y=5;y<=9;y++)for(let x=5;x<=9;x++)blocked[y*20+x]=0;
  blocked[13*20+6]=0;
  const ps=[p(52,rect(5,5,9,9)),p(74,rect(5,10,7,12))];
  const result=a.routes(ps,20,{heights,blocked,hardBlocked})[0];
  assert.ok(result.path.length);
  assert.deepEqual(result.entry,{x:7,y:9,side:0,height:10});
  assert.deepEqual(result.path.at(-1),{x:5,y:7,height:10});
  assert.ok(result.path.every(t=>t.x===7||t.y===7));
});


test('recruitment footprints keep only the building and flag tiles solid',()=>{
  for(const type of [86,87]) {
    const g=a.routeTopology([p(type,rect(3,3,12,12))],16);
    let walkable=0;
    for(let y=3;y<=12;y++)for(let x=3;x<=12;x++) {
      const dx=x-3,dy=12-y,solid=(dx<5&&dy<5)||(dx%5===2&&dy%5===2);
      assert.equal(g.surfaces[y*16+x].length,solid?0:1);
      if(!solid)walkable++;
    }
    assert.equal(walkable,72);
    const rs=a.routes([p(type,rect(3,3,12,12)),p(52,rect(2,5)),p(50,rect(13,4,15,6))],20);
    assert.ok(rs[0].path.some(t=>t.x>3&&t.x<12&&t.y>=3&&t.y<8));
  }
});
test('analysis worker loads every dependency and returns fire and routes together',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const dir=path.join(__dirname,'../src/js'),messages=[];
  const context=vm.createContext({postMessage:m=>messages.push(m)});
  context.self=context;
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),context,{filename:file}));
  vm.runInContext(fs.readFileSync(path.join(dir,'castle-analysis-worker.js'),'utf8'),context);
  const ps=[p(null,rect(0,0,14,14)),p(52,rect(1,5)),p(186,rect(2,5)),
    p(110,rect(3,4,5,6),{ref:'left'}),p(25,rect(6,5)),
    p(110,rect(7,4,9,6),{ref:'right'}),p(186,rect(10,5)),p(50,rect(11,5,12,6),{worker:true}),
    p(54,rect(40,40),{name:'Hovel',health:200})];
  context.onmessage({data:{id:1,placements:ps,terrain:null,fire:true,paths:true}});
  const [result]=messages;
  assert.equal(result.error,undefined);
  assert.ok(result.heat.some(v=>v>0),'fire heat survives enabling paths');
  assert.ok(result.routes[0].path.some(t=>t.x===6 && t.y===5 && t.height===90));
});
