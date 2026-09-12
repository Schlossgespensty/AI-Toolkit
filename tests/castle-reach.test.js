'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const analysis = require('../src/js/castle-analysis');
const rect = (left,bottom,right=left,top=bottom) => ({left,bottom,right,top});
const placement = (type,r,extra={}) => ({type,rects:[r],...extra});

test('initial fire reach includes seed jitter and retains the asymmetric microtile contour', () => {
  const cells = analysis.fireKernel();
  const has = (x,y) => cells.some(c=>c.x===x && c.y===y);
  // Two (+8,-8) jitter samples with a +8 X attempt: (+24,-16).
  assert.ok(has(3,-2));
  // The opposite diagonal table ends at (-7,+7), not (-8,+8).
  assert.equal(has(-3,2),false);
  assert.equal(Math.min(...cells.map(c=>c.x)),-3);
  assert.equal(Math.max(...cells.map(c=>c.x)),3);
  assert.ok(cells.every(c=>Math.abs(c.x)<=3 && Math.abs(c.y)<=3));
});

test('3x3, 4x4 and 5x5 fire sources use exact corners rather than rounded centres', () => {
  for(const n of [3,4,5,9,10,11]) {
    const base=analysis.fireExposure([placement(54,rect(20,20,19+n,19+n),{name:'Hovel'})]);
    const moved=analysis.fireExposure([placement(54,rect(27,31,26+n,30+n),{name:'Hovel'})]);
    assert.deepEqual(moved.map(c=>({...c,x:c.x-7,y:c.y-11})),base);
    assert.equal(Math.min(...base.map(c=>c.x)),17);
    assert.equal(Math.max(...base.map(c=>c.x)),22+n);
  }
});

test('reheated envelope is a distinct conservative bound and contains initial reach', () => {
  const bound=analysis.fireKernel('reheated');
  const keys=new Set(bound.map(c=>`${c.x},${c.y}`));
  for(const c of analysis.fireKernel()) assert.ok(keys.has(`${c.x},${c.y}`));
  assert.ok(bound.some(c=>Math.abs(c.x)===4));
  assert.ok(bound.every(c=>Math.abs(c.x)<=4 && Math.abs(c.y)<=4));
});

test('each gate orientation connects only its central ground passage, independently of its roof', () => {
  for(const type of [144,145,146,147]) {
    const n=type<146?5:7,mid=2+Math.floor(n/2);
    const g=analysis.routeTopology([placement(type,rect(2,2,1+n,1+n),{ref:'gate'})],12);
    const at=(x,y)=>g.surfaces[y*12+x];
    const ns=type===144 || type===146;
    const pass=at(mid,mid).find(n=>n.kind==='passage');
    assert.ok(pass);
    assert.ok(g.links[pass.id].length===2);
    for(const edge of g.links[pass.id]) {
      const next=g.nodes[edge.to];
      assert.equal(next.height,0);
      assert.equal(ns?next.x:next.y,mid);
    }
    assert.equal(at(2,2).some(n=>n.kind==='passage'),false);
    const closed=analysis.routeTopology([placement(type,rect(2,2,1+n,1+n),{closed:true})],12);
    assert.equal(closed.nodes.some(n=>n.kind==='passage'),false);
  }
});

test('routes cross connected towers and a wall walk via Stair 6 at both ends', () => {
  const ps=[placement(null,rect(0,0,14,9)),
    placement(52,rect(1,5),{name:'Stockpile'}),placement(186,rect(2,5)),
    placement(110,rect(3,4,5,6),{ref:'left'}),placement(25,rect(6,5)),
    placement(110,rect(7,4,9,6),{ref:'right'}),placement(186,rect(10,5)),
    placement(51,rect(11,5,12,6),{name:'Fletcher',worker:true})];
  const route=analysis.routes(ps,15)[0];
  assert.ok(route.path.some(p=>p.x===6 && p.y===5 && p.height===90));
  assert.ok(route.path.some(p=>p.height===296));
  assert.ok(route.efficiency>0 && route.efficiency<=1);
  assert.equal(analysis.routes(ps.filter(p=>p.type!==186),15)[0].path.length,0);
});

test('stairs connect by height; ordinary ground cannot climb a tower or high wall', () => {
  const ps=[placement(181,rect(1,2)),placement(182,rect(2,2)),placement(183,rect(3,2)),
    placement(184,rect(4,2)),placement(185,rect(5,2)),placement(186,rect(6,2)),
    placement(110,rect(8,3,10,5),{ref:'tower'}),placement(25,rect(3,7)),placement(25,rect(4,8))];
  const g=analysis.routeTopology(ps,12);
  const at=(x,y)=>g.surfaces[y*12+x][0];
  const linked=(a,b)=>g.links[a.id].some(e=>e.to===b.id);
  for(let x=1;x<6;x++) assert.ok(linked(at(x,2),at(x+1,2)));
  assert.equal(linked(at(1,1),at(1,2)),false);
  assert.equal(linked(at(7,4),at(8,4)),false);
  assert.ok(linked(at(3,7),at(4,8)));
});

test('all added resource plan skins preserve 32-pixel tiles at native footprint size', () => {
  for(const [type,n] of [[56,6],[70,9],[71,9],[72,11],[73,10],[90,4],[91,4]]) {
    const png=fs.readFileSync(path.join(__dirname,`../assets/aiv/skins/${type}.png`));
    assert.equal(png.readUInt32BE(16),32*n);
    assert.equal(png.readUInt32BE(20),32*n);
  }
});
