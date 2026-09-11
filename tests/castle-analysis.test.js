'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const analysis = require('../src/js/castle-analysis');
const game = require('../src/js/castle-game-data');
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
  assert.match(heightFunction,/geo\.mapTileHeight\(gx, gy, currentKeep\(\), atlas\.hoehen\)/);
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

test('entrance tables retain game order and are transformed to upward editor coordinates', () => {
  const entries = analysis.entranceCandidates({ left: 10, right: 12, top: 12, bottom: 10 });
  assert.equal(entries.length, 12);
  assert.deepEqual(entries.slice(0,3), [{ x: 11,y:13 }, { x:12,y:13 }, { x:13,y:12 }]);
  for (const e of entries) assert.ok(e.x < 10 || e.x > 12 || e.y < 10 || e.y > 12);
});

test('worker routes avoid solid walls, use a reachable entrance, and report enclosure', () => {
  const store = { name: 'Stockpile', rects: [{ left: 1, right: 1, top: 5, bottom: 5 }] };
  const work = { name: 'Fletcher', ref: 'work', worker: true, rects: [{ left: 5,right:6,top:6,bottom:5 }] };
  const wall = { name: null, rects: [{ left: 3,right:3,top:8,bottom:1 }] };
  const route = analysis.routes([store,work,wall],10)[0];
  assert.ok(route.path.length > 0);
  assert.ok(route.efficiency < 1);
  assert.ok(route.path.every(p => !(p.x === 3 && p.y >= 1 && p.y <= 8)));
  const enclosed = { name: null, rects: [{ left: 0,right:9,top:9,bottom:0 }] };
  assert.equal(analysis.routes([store,work,enclosed],10)[0].path.length,0);
});

test('fire exposure uses only burnable sources and clips at the village boundary', () => {
  assert.equal(game.flammability['Stone keep'], undefined); // no invented name fallback
  const rects = [{ left: 0,right:0,top:0,bottom:0 }];
  assert.deepEqual(analysis.fireExposure([{ name:'Small gatehouse',rects }]), []);
  const cells = analysis.fireExposure([{ name:'Hovel',rects }]);
  assert.ok(cells.length > 1);
  assert.ok(cells.every(c => c.x >= 0 && c.y >= 0 && c.intensity > 0 && c.intensity <= 1));
  assert.ok(new Set(cells.map(c => c.intensity)).size > 2);
});
