const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {lua,lauxlib,lualib,to_luastring,to_jsstring} = require('fengari');

test('observer Lua preserves Recorder, captures type-32 sparks and stops safely on bad memory',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../integrations/ai-toolkit-observer/init.lua'),'utf8');
  const fixture=`
    local mem={}; local seen={}; local writes={}; local closed=0; local calls=0
    local unit=0x138854c+0x490; local entity=0x2350314+0xe8
    mem[0x1387f38]=2500
    mem[unit+0x8e]=4; mem[unit+0x8c]=1; mem[unit+0x98]=10
    mem[unit+0xc4]=100; mem[unit+0xc6]=100
    mem[entity+0x2a]=32; mem[entity+0x28]=1; mem[entity+0x30]=99
    mem[entity+0x38]=160; mem[entity+0x3a]=240
    core={readInteger=function(at) return mem[at] or 0 end,readSmallInteger=function(at) return mem[at] or 0 end,
      readBytes=function(at,n) if at==0x419780 then return {0xb8,0xd4,0x21,0x5c,0} end return {0x56,0x8b,0x74,0x24,8,0x69,0xf6,0x90,4,0,0} end}
    local stream={write=function(self,value) writes[#writes+1]=value;return true end,flush=function()return true end,close=function()closed=closed+1 end}
    io={open=function(name,mode) if mode=='rb' then return nil end return stream end}
    json={encode=function(self,value) seen[#seen+1]=value;return '{}' end}
    local tick=1
    local callback
    local provider={tickObserverApiVersion=1,
      registerTickObserver=function(self,fn)callback=fn;return 7 end,
      unregisterTickObserver=function(self,token)assert(token==7);callback=nil end}
    -- UCP exposes other extensions through read-only proxies, not writable
    -- Recorder tables. The integration must only call the public methods.
    modules={recorder=setmetatable({},{__index=provider,__newindex=function()error('UCP read-only module')end})}
    local function nativeTick()
      calls=calls+1
      if callback then callback({active=true,status='recording',singlePlayer=true,tick=tick,resources={},
        manifest={id='fixture',variant='SHC',snapshotHash='a',settingsHash='b'}}) end
    end
    local observer=(function() ${source} end)()
    observer:enable();nativeTick()
    assert(calls==1 and #seen==2)
    assert(#seen[2].workers==1 and #seen[2].fires==0 and #seen[2].sparks==1)
    assert(seen[2].sparks[1][2]==99 and seen[2].sparks[1][3]==160)
    nativeTick();assert(#seen==2 and calls==2)
    tick=2;mem[0x1387f38]=3000;nativeTick();assert(calls==3 and closed==1)
    tick=3;nativeTick();assert(calls==4 and #seen==2)
    observer:disable();assert(callback==nil)
  `;
  const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  const result=lauxlib.luaL_dostring(L,to_luastring(fixture));
  assert.equal(result,lua.LUA_OK,result===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(L,-1)));
  lua.lua_close(L);
});
