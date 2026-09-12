'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const production=require('../src/js/castle-production');

test('wood pays for all three resource trips and the stockpile trip',()=>{
  const cycle=production.cycleDetails('Wood',{distance:25,stockpileDistance:10});
  assert.equal(cycle.tiles,170);
  assert.equal(cycle.ticks,2400+170*24);
  assert.equal(production.cycleDetails('Meat',{}).ticks,null);
});
test('bows and crossbows have distinct complete stockpile and armoury itineraries',()=>{
  const opts={stockpileDistance:10,deliveryDistance:20,storesDistance:15};
  assert.equal(production.recipeCycle('Bow',opts).tiles,80);
  assert.equal(production.recipeCycle('Crossbow',opts).tiles,100);
  assert.equal(production.recipeCycle('Sword',opts).tiles,45);
  assert.equal(production.recipeCycle('Pike',opts).tiles,65);
  assert.equal(production.recipeCycle('Spear',opts).ticks,null);
});
test('iron overlaps extraction with transport and quarry output is not an ox load',()=>{
  assert.equal(production.cycleDetails('Iron',{stockpileDistance:0}).ticks,1600);
  assert.equal(production.cycleDetails('Cheese',{stockpileDistance:0}).startup,2400);
  assert.equal(production.delivery('Stone',{resources:{Stone:{baseDelivery:32}}},production.settings()).average,1);
});

test('food uses granary distance and custom production assumptions survive migration',()=>{
  assert.equal(production.cycleDetails('Cheese',{stockpileDistance:3,deliveryDistance:17}).tiles,34);
  const opts=production.restoreSettings(null,{distance:38,extraDistance:7,walkTicks:6,workTicks:{Wood:800,Stone:500}});
  assert.equal(opts.distance,38);assert.equal(opts.extraDistance,7);assert.equal(opts.workTicks.Wood,800);
  assert.equal(opts.workTicks.Stone,480);assert.equal(opts.walkTicksOverride,6);
  assert.equal(production.cycleDetails('Wood',opts).travel,6*8*38);
  assert.equal(production.restoreSettings({workTicks:{Wood:500}},{}).workTicks.Wood,500);
});
