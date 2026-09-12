-- Uses Recorder's already installed tick callback. No second native hook,
-- pathfinder, fire model, RNG calls or game-state writes.
local module = {}
local workers = {[3]=true,[4]=true,[6]=true,[7]=true,[8]=true,[9]=true,
  [10]=true,[11]=true,[12]=true,[13]=true,[14]=true,[15]=true,[16]=true,
  [17]=true,[18]=true,[19]=true,[20]=true,[21]=true,[31]=true,[32]=true,
  [33]=true,[34]=true,[36]=true,[42]=true,[43]=true,[53]=true}
local LIMIT = 64*1024*1024
local function same(a,b)
  if not a or #a~=#b then return false end
  for i,value in ipairs(b) do if a[i]~=value then return false end end
  return true
end
local function difference(frame,previous)
  local result={kind='frame',tick=frame.tick,removed={}}
  for _,field in ipairs({'workers','buildings','fires','sparks'}) do
    local before=previous[field] or {}
    local current,changed,removed={},{},{}
    for _,row in ipairs(frame[field]) do
      current[row[1]]=row
      if not same(before[row[1]],row) then changed[#changed+1]=row end
    end
    for id in pairs(before) do if not current[id] then removed[#removed+1]=id end end
    table.sort(removed)
    result[field]=changed;result.removed[field]=removed;previous[field]=current
  end
  if not same(previous.resources,frame.resources) then result.resources=frame.resources end
  previous.resources=frame.resources
  return result
end
local function short(at)
  local n=core.readSmallInteger(at)
  return n>=32768 and n-65536 or n
end
local function verify()
  -- SHC 1.41 record-layout checks, independently of Recorder's hook checks.
  local checks={
    {0x419780,{0xb8,0xd4,0x21,0x5c,0x00}},
    {0x419800,{0x56,0x8b,0x74,0x24,0x08,0x69,0xf6,0x90,0x04,0x00,0x00}},
  }
  for _,check in ipairs(checks) do
    local actual=core.readBytes(check[1],#check[2])
    for i,v in ipairs(check[2]) do assert(actual[i]==v,'Observer: unsupported executable layout') end
  end
end
local function snapshot(tick)
  local units,buildings,fires,sparks={},{},{},{}
  local unitLimit=core.readInteger(0x1387f38)
  -- The native update narrows this high-water mark (e.g. 931 in a populated
  -- save). It is not the fixed 2500-slot array capacity.
  assert(unitLimit>=0 and unitLimit<=2500,'Observer: unsupported unit limit '..tostring(unitLimit))
  for id=1,2499 do
    local at=0x138854c+id*0x490
    local kind=short(at+0x8e)
    if workers[kind] and short(at+0x8c)~=0 then
      units[#units+1]={id,core.readInteger(at+0x98),kind,short(at+0x96),
        short(at+0xc4),short(at+0xc6),short(at+0xba),short(at+0xbc),
        short(at+0x398),short(at+0x388),short(at+0x394),short(at+0x8c),short(at+0x380)}
    end
  end
  for id=1,1999 do
    local at=0xf98534+id*0x32c
    if short(at+0xd0)~=0 then
      buildings[#buildings+1]={id,core.readInteger(at+0xd8),short(at+0xd2),short(at+0xd6),
        short(at+0xee),short(at+0xf0),core.readInteger(at+0xf8),short(at+0xfe),short(at+0x100),
        short(at+0x10c),short(at+0x10e),short(at+0x2be),short(at+0xd0)}
    end
  end
  for id=1,2999 do
    local at=0x2350314+id*0xe8
    local kind=short(at+0x2a)
    if kind==9 and short(at+0x28)~=0 then
      fires[#fires+1]={id,core.readInteger(at+0x30),short(at+0x38),short(at+0x3a),short(at+0x3c),
        short(at+0xb4),short(at+0xb6),short(at+0xb8),short(at+0xd8)}
    elseif kind==32 and short(at+0x28)~=0 then
      sparks[#sparks+1]={id,core.readInteger(at+0x30),short(at+0x38),short(at+0x3a),short(at+0x3c),
        short(at+0x50),short(at+0x52),short(at+0x58),short(at+0x2c)}
    end
  end
  return {kind='frame',tick=tick,workers=units,buildings=buildings,fires=fires,sparks=sparks}
end
function module:enable()
  verify()
  local recorder=assert(modules.recorder,'Enable Recorder before the observer')
  assert(recorder.tickObserverApiVersion==1 and type(recorder.registerTickObserver)=='function',
    'This observer requires Recorder with the public tick-observer API')
  local active,stream,bytes,lastTick,stopped,failed,previous,entries,frames
  local function close()
    if stream then stream:close();stream=nil end
  end
  local function observe(r)
    if not r.active or r.status~='recording' or not r.singlePlayer then close();active=nil;return end
    local manifest=r.manifest
    assert(manifest.variant=='SHC','Observer currently supports classic Crusader 1.41 only')
    local tick=r.tick
    if active~=manifest.id then
      close();active=manifest.id;bytes=0;lastTick=nil;stopped=false;previous={};entries=0;frames=0
      assert(active:match('^[%w_-]+$') and #active<80,'Invalid replay identity')
      -- A fresh observer capture never overwrites an existing capture.
      local filename='ucp/replays/'..active..'/ai-toolkit-trace.jsonl'
      local exists=io.open(filename,'rb')
      if exists then exists:close();stopped=true;return end
      stream=assert(io.open(filename,'wb'))
      local header={kind='header',format='ai-toolkit-simulation-v2',session=active,
        snapshotHash=manifest.snapshotHash,settingsHash=manifest.settingsHash,
        environmentHash=manifest.environmentHash,variant=manifest.variant,startTick=tick,
        sampleTicks=1,coordinates='map-tiles',source='UCP Recorder simulation tick',captureVersion=2}
      header.runtimeCosts={}
      for building=0,109 do
        local cost={}
        for resource=0,4 do cost[#cost+1]=core.readInteger(0xf98520+0x18c7d4+building*20+resource*4) end
        header.runtimeCosts[#header.runtimeCosts+1]=cost
      end
      assert(stream:write(json:encode(header)..'\n'));assert(stream:flush())
    end
    if stopped or tick==lastTick then return end
    assert(not lastTick or tick>lastTick,'Observer simulation tick moved backwards')
    local frame=snapshot(tick)
    frame.resources=r.resources
    -- Bound reconstructed history too: compression must not turn a small file
    -- into an unbounded set of per-tick arrays in the viewer.
    local count=#frame.workers+#frame.buildings+#frame.fires+#frame.sparks
    if entries+count>5000000 or frames>=100000 then
      assert(stream:write(json:encode({kind='end',reason='Capture history limit reached',tick=lastTick})..'\n'))
      close();stopped=true;return
    end
    local line=json:encode(difference(frame,previous))..'\n'
    if bytes+#line>LIMIT then
      assert(stream:write(json:encode({kind='end',reason='Capture size limit reached',tick=lastTick})..'\n'))
      close();stopped=true;return
    end
    assert(stream:write(line))
    -- Flush one second-sized batch; complete lines remain importable after an
    -- interrupted write. Do not force a filesystem sync for every game tick.
    if tick%20==0 then assert(stream:flush()) end
    bytes=bytes+#line;lastTick=tick;entries=entries+count;frames=frames+1
  end
  self.token=recorder:registerTickObserver(function(r)
    if failed then return end
    local ok,err=pcall(observe,r)
    if not ok then close();failed=true;print('AI Toolkit observer stopped: '..tostring(err)) end
  end)
  self.recorder=recorder;self.close=close
end
function module:disable()
  if self.close then self.close() end
  if self.recorder and self.token then self.recorder:unregisterTickObserver(self.token);self.token=nil end
end
return module
