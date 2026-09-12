'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const { internals: native } = require('../src/node/native-map-renderer');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-native-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = { format: native.FORMAT, id: 'abc-123', mapHash: 'map', engineHash: 'engine' };
  const receipt = change => fs.writeFileSync(path.join(root, 'renderer-result.json'),
    JSON.stringify({ ...request, complete: true, ...change }));
  receipt();
  for (const name of ['height.bin', 'base-height.bin']) fs.writeFileSync(path.join(root, name), Buffer.alloc(80400));
  for (const angle of [0, 2, 4, 6]) for (const layer of ['gfx', 'pillar'])
    fs.writeFileSync(path.join(root, `camera-${angle}-${layer}.bin`), Buffer.alloc(160800, angle));
  return { root, request, receipt };
}

test('native output requires the current request, map and executable', t => {
  const { root, request, receipt } = fixture(t);
  const result = native.readResult(root, request);
  assert.deepEqual(result.cameras.map(c => c.orientation), [0, 2, 4, 6]);
  assert.equal(result.baseHeights.length, 80400);
  assert.equal(result.cameras[3].gfx[0], 6);
  receipt({ id: 'old' }); assert.throws(() => native.readResult(root, request), /stale/);
  receipt({ mapHash: 'other' }); assert.throws(() => native.readResult(root, request), /does not match/);
  receipt({ engineHash: 'other' }); assert.throws(() => native.readResult(root, request), /does not match/);
  receipt({ complete: false }); assert.throws(() => native.readResult(root, request), /does not match/);
  receipt({ error: 'Map load failed' }); assert.throws(() => native.readResult(root, request), /Map load failed/);
});

test('partial native layers cannot become a usable camera cache', t => {
  const { root, request } = fixture(t);
  fs.truncateSync(path.join(root, 'camera-4-gfx.bin'), 160798);
  assert.throws(() => native.readResult(root, request), /Invalid native renderer layer/);
});

test('helper setup refuses unrelated directories and unknown game executables', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-owner-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'castle.aiv'), 'keep this');
  assert.throws(() => native.ownedDirectory(root), /unrelated/);
  assert.equal(fs.readFileSync(path.join(root, 'castle.aiv'), 'utf8'), 'keep this');
  const owned = path.join(root, 'cache');
  native.ownedDirectory(owned); native.ownedDirectory(owned);
  const bytes = Buffer.from('not a supported executable');
  assert.throws(() => native.isolatedExecutable(bytes), /supports Crusader 1.41/);
  assert.equal(bytes.toString(), 'not a supported executable');
});

test('native Lua loads once, regenerates every direction and exits after closing exports', () => {
  const source = fs.readFileSync(path.join(__dirname, '../integrations/native-map-renderer/init.lua'), 'utf8');
  const fixture = `
    local callback; local receipt; local calls={}; local sizes={}; local opened=0
    local request={format='ai-toolkit-native-map-v1',id='abc-123',mapName='maps/preview.map',mapHash='map',engineHash='engine'}
    io={open=function(name,mode)
      opened=opened+1
      return {read=function()return '{}' end,write=function()end,close=function()opened=opened-1 end}
    end}
    json={decode=function()return request end,encode=function(self,value)receipt=value;return '{}' end}
    hooks={registerHookCallback=function(name,fn)assert(name=='afterInit');callback=fn end}
    core={registerString=function(name)assert(name=='preview.map', 'The game itself prepends maps/');return 123 end,
      readBytes=function(at,n) sizes[#sizes+1]={at,n};return {0} end,
      exposeCode=function(address,args,thiscall)
        return function(a,b)
          calls[#calls+1]={address,a,b}
          if address==0x4c62c0 then assert(args==2 and thiscall==1 and a==0x1653858 and b==123) end
          if address==0x583d55 then assert(a==0 and opened==0 and receipt.complete) end
        end
      end}
    local renderer=(function() ${source} end)()
    renderer:enable(); assert(#calls==0);callback()
    assert(#calls==14 and calls[1][1]==0x4c62c0 and calls[14][1]==0x583d55)
    for i=0,3 do
      local at=2+i*3
      assert(calls[at][1]==0x501b90 and calls[at][2]==0x1a93208 and calls[at][3]==i*2)
      assert(calls[at+1][1]==0x509180 and calls[at+2][1]==0x4fc9e0)
    end
    local total=0;for _,read in ipairs(sizes) do total=total+read[2] end
    assert(total==80400*18)
    assert(receipt.id==request.id and receipt.mapHash=='map' and receipt.engineHash=='engine')
    request.mapName='../other.map';assert(not pcall(function()renderer:enable()end))
  `;
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  try {
    const result = lauxlib.luaL_dostring(L, to_luastring(fixture));
    assert.equal(result, lua.LUA_OK, result === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(L, -1)));
  } finally { lua.lua_close(L); }
});
