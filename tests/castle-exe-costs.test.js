'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCostTable, SIGNATURE } = require('../src/node/castle-exe-costs');
const { readInstalledBalance } = require('../src/node/castle-balance');
const names = require('../src/node/building-cost-names.json');
function executable() {
  const b = Buffer.alloc(4096); b.write('MZ'); b.writeUInt32LE(128,60);
  b.writeUInt32LE(0x4550,128); b.writeUInt16LE(1,134);
  b.writeUInt32LE(3072,168); b.writeUInt32LE(512,172); b.writeUInt32LE(0x40,188);
  SIGNATURE.copy(b,512);
  b.writeInt32LE(30,512+names.indexOf('Garden')*20+16);
  b.writeInt32LE(321,512+names.indexOf('Chapel')*20+16);
  return b;
}
test('reads only initialized PE data and uses runtime building indices', () => {
  const b = executable(); const costs = readCostTable(b);
  assert.deepEqual(costs.Hovel.cost,[6,0,0,0,0]);
  assert.equal(costs.Garden.cost[4],30);
  assert.equal(costs.Chapel.cost[4],321);
  b.writeUInt32LE(0x20,188);
  assert.throws(()=>readCostTable(b),/matched 0/);
  assert.throws(()=>readCostTable(Buffer.from('bad')),/executable/);
});
test('UCP overrides the installed EXE baseline and retains non-cost patches', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-exe-balance-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'Stronghold Crusader.exe'),executable());
  fs.writeFileSync(path.join(root,'balance.json'),JSON.stringify({buildings:{Hovel:{cost:[4,0,0,0,0]},Chapel:{health:500}},resources:{Wood:{baseDelivery:8}}}));
  fs.writeFileSync(path.join(root,'ucp-config.yml'),JSON.stringify({active:true,'config-full':{modules:{rebalancer:{config:{balance_config_file_selector:'balance.json'}}}}}));
  const result=readInstalledBalance(root);
  assert.equal(result.profile.buildings.Hovel.cost[0],4);
  assert.equal(result.profile.buildings.Chapel.cost[4],321);
  assert.equal(result.profile.buildings.Chapel.health,500);
  assert.equal(result.profile.resources.Wood.baseDelivery,8);
  assert.equal(result.exePath,path.join(root,'Stronghold Crusader.exe'));
});
