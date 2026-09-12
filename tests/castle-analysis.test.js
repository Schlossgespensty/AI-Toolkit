'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const balance = require('../src/js/castle-balance');
const installed = require('../src/node/castle-balance');
const production = require('../src/js/castle-production');
const model = require('../src/js/castle-cost-model');
const data = require('../src/js/castle-cost-data');

test('ground repeats and building footprints retain identical dimensions across zoom levels', () => {
  const iso = require('../src/js/iso-geometry');
  for (const zoom of [.25, .73, 1, 2.5]) {
    const scale = iso.groundTextureScale(zoom);
    assert.equal(30 * scale.x, 32 * zoom);
    assert.equal(16 * scale.y, 16 * zoom);
    const sprite = iso.spriteRect({ breite: 126, hoehe: 111 }, 12, 15, 4, { zoom, panX: 0, panY: 0 });
    const bottom = iso.isoPoint(16, 19, { zoom, panX: 0, panY: 0 });
    assert.ok(Math.abs(sprite.x + sprite.w / 2 - bottom[0]) < 1e-8);
    assert.ok(Math.abs(sprite.y + sprite.h - bottom[1]) < 1e-8);
  }
});

test('full-map atlas elevations anchor sprites and picking to the same map tile at every rotation', () => {
  const iso = require('../src/js/iso-geometry');
  const heights = new Uint8Array(400 * 400);
  const view = { zoom: .75, panX: 311, panY: -85 };
  for (const orientation of [0,2,4,6]) {
    const keep = { x: 120, y: 210, orientation };
    const tile = iso.rotateGrid(43,43,1,orientation);
    const map = iso.mapTileForGrid(tile.gx,tile.gy,keep);
    heights[map.my * 400 + map.mx] = 8; // half a tile vertically
    const lift = iso.mapTileHeight(tile.gx,tile.gy,keep,heights);
    assert.equal(lift,8);
    const rect = iso.spriteRect({ breite: 30,hoehe:16 },tile.gx,tile.gy,1,view,lift);
    const corner = iso.isoPoint(tile.gx,tile.gy,view,8);
    assert.equal(rect.y,corner[1]);
    const centre = iso.isoPoint(tile.gx+.5,tile.gy+.5,view,8);
    const picked = iso.tileFromPoint(...centre,view,(x,y) => iso.mapTileHeight(x,y,keep,heights));
    assert.deepEqual(picked,tile);
  }
  assert.equal(iso.mapTileHeight(1000,1000,{x:120,y:210},heights),0);
  const source = fs.readFileSync(path.join(__dirname,'../src/js/iso-view.js'),'utf8');
  const heightFunction = source.slice(source.indexOf('function bodenHoehe'),source.indexOf('function terrainReady'));
  assert.match(heightFunction,/geo\.mapTileHeight\(world\.gx, world\.gy, currentKeep\(\), atlas\.hoehen\)/);
});

test('balance import retains production and rejects invalid integer/boolean patches', () => {
  const input = { buildings: { Hovel: { cost: ['5',0,0,0,0], housing: 12 } }, resources: { Wood: { baseDelivery: 10, skirmishBonus: false } }, fear_factor: { productivity: 20 } };
  assert.deepEqual(balance.validate(input), input);
  assert.throws(() => balance.validate({ buildings: { Hovel: { cost: [1,0,0,0,-1] } } }));
  assert.throws(() => balance.validate({ resources: { Wood: { baseDelivery: 256 } } }));
  assert.throws(() => balance.validate({ resources: { Wood: { skirmishBonus: 'false' } } }));
  const corrupt = model.preisFuer(54, data, { buildings: { Hovel: { cost: [1,0,0,0,'NaN'] } } });
  assert.equal(corrupt.quelle, 'unknown');
});

test('resolved UCP configuration selects one full profile, never guesses between plugin versions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-balance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'ucp/plugins/Liga-2.0/resources');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'balance.json'), JSON.stringify({ resources: { Wood: { baseDelivery: 10 } } }));
  fs.writeFileSync(path.join(root, 'ucp-config.yml'), `active: true\nconfig-full:\n  modules:\n    rebalancer:\n      config:\n        balance_config_file_selector:\n          contents:\n            value: ucp/plugins/Liga-*/resources/balance.json\n`);
  const result = installed.readInstalledBalance(root);
  assert.equal(result.profile.resources.Wood.baseDelivery, 10);
  assert.equal(result.filePath, path.join(dir, 'balance.json'));
  assert.throws(() => installed.resolveSelector(root, '../elsewhere.json'));
  const second = path.join(root, 'ucp/plugins/Liga-2.1/resources');
  fs.mkdirSync(second, { recursive: true }); fs.writeFileSync(path.join(second, 'balance.json'), '{}');
  assert.throws(() => installed.readInstalledBalance(root), /matched 2/);
});

test('UCP balance import follows the active extension version among six installed Liga versions', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'castle-active-balance-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const version of ['1.0.7','1.0.8','1.0.9','1.1.0','2.0.0','2.0.2']) {
    const dir=path.join(root,`ucp/plugins/Mod-KI-Team-Liga-${version}/resources/balance`);
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'liga_ai.json'),JSON.stringify({buildings:{Hovel:{cost:[version==='2.0.2'?7:99,0,0,0,0]}}}));
  }
  const config={active:true,'config-full':{
    'load-order':[{extension:'rebalancer',version:'1.1.3'},{extension:'Mod-KI-Team-Liga',version:'2.0.2'}],
    modules:{rebalancer:{config:{balance_config_file_selector:{contents:{value:'ucp/plugins/Mod-KI-Team-Liga-*/resources/balance/liga_ai.json'}}}}}
  }};
  fs.writeFileSync(path.join(root,'ucp-config.yml'),JSON.stringify(config));
  const loaded=installed.readInstalledBalance(root);
  assert.equal(loaded.profile.buildings.Hovel.cost[0],7);
  assert.ok(loaded.filePath.includes('Mod-KI-Team-Liga-2.0.2'));
  config['config-full']['load-order'][1].version='3.0.0';
  fs.writeFileSync(path.join(root,'ucp-config.yml'),JSON.stringify(config));
  assert.throws(()=>installed.readInstalledBalance(root),/matched 0/);
});

test('production integrates housing intervals, per-producer travel and fractional deliveries', () => {
  const populationData = { population_effects: { provides: { 54: 8 } } };
  const frames = [ { itemType: 54, tilePositionOfsets: [0] }, { itemType: 25, tilePositionOfsets: [1] },
    { itemType: 54, tilePositionOfsets: [2] }, { itemType: 25, tilePositionOfsets: [3] } ];
  const opts = { frames, populationData, aic: {}, aicAt: pop => ({ iron: pop / 8 }), data,
    options: { distance: 0, extraDistance: 0, workTicks: { Iron: 50 } }, costModel: model };
  assert.equal(production.estimate({ ...opts, stepIndex: 0 }).Iron.produced, 0);
  assert.equal(production.estimate({ ...opts, stepIndex: 1 }).Iron.produced, 1);
  assert.equal(production.estimate({ ...opts, stepIndex: 2 }).Iron.produced, 3);
  assert.equal(production.estimate(opts).Iron.produced, 5); // 3 cycles + 1 late cycle, individual carry
  assert.equal(production.estimate({ ...opts, balance: { resources: { Iron: { baseDelivery: 2, skirmishBonus: false } } } }).Iron.produced, 8);
  assert.ok(production.estimate({ ...opts, options: { distance: 25, extraDistance: 5, workTicks: { Iron: 50 } } }).Iron.produced < 5);
  assert.equal(production.estimate({ ...opts, aic: null }), null);
});

test('housing overrides affect the population supplied to AIC thresholds', () => {
  const populationData = { population_effects: { provides: { 54: 8 } } };
  const result = model.auswerten({ frames: [{ itemType: 54, tilePositionOfsets: [0] }], data, populationData,
    balance: { buildings: { Hovel: { housing: 16 } } }, aicAt: population => ({ population }) });
  assert.equal(result.population.provided, 16);
  assert.equal(result.population.aic.population, 16);
});

test('pitch placement credit survives step boundaries and respects every rebalancer ratio', () => {
  const frames = Array.from({ length:9 }, (_,i) => ({ itemType:99,tilePositionOfsets:[i] }));
  for (const ratio of [1,2,3,4]) {
    const profile = { castle: { ditch_per_pitch:ratio } };
    for (let step = 0; step < frames.length; step++) {
      const result = model.kostenBis(frames,step,data,profile);
      assert.equal(result.cost.pitch,Math.ceil((step+1)/ratio));
      assert.equal(result.rows[0].total.pitch,result.cost.pitch);
    }
    const merged = [{ itemType:99,tilePositionOfsets:frames.map((_,i) => i) }];
    assert.equal(model.kostenBis(merged,null,data,profile).cost.pitch, model.kostenBis(frames,null,data,profile).cost.pitch);
  }
  assert.equal(model.kostenBis(frames,null,data,null).cost.pitch,3);
  assert.throws(() => balance.validate({ castle:{ ditch_per_pitch:5 } }));
});

