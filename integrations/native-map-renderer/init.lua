-- Runs only in the Toolkit's private, single-use renderer process.
-- The original game loads the map and regenerates the directional GFX layers.
local M={}
local function writeJSON(name,value)
  local file=assert(io.open(name,'w'));file:write(json:encode(value));file:close()
end
local function dump(name,address,size)
  local file=assert(io.open(name,'wb'))
  for offset=0,size-1,1024 do
    local bytes=core.readBytes(address+offset,math.min(1024,size-offset))
    file:write(string.char(table.unpack(bytes)))
  end
  file:close()
end
function M:enable()
  -- An ordinary game installation must never acquire this process lifecycle.
  local file=assert(io.open('renderer-request.json','r'),'Missing private renderer request')
  local request=json:decode(file:read('*a'));file:close()
  assert(request.format=='ai-toolkit-native-map-v1' and type(request.id)=='string'
    and #request.id<=64 and request.id:match('^[%x%-]+$'),'Invalid renderer request')
  assert(request.mapName=='maps/preview.map','Unexpected renderer input path')
  hooks.registerHookCallback('afterInit',function()
    local ok,reason=pcall(function()
      local loadMap=core.exposeCode(0x4c62c0,2,1)
      local rotate=core.exposeCode(0x501b90,2,1)
      local update=core.exposeCode(0x509180,1,1)
      local updateTextures=core.exposeCode(0x4fc9e0,1,1)
      local name=core.registerString(request.mapName)
      loadMap(0x1653858,name)
      for _,orientation in ipairs({0,2,4,6}) do
        rotate(0x1a93208,orientation)
        update(0x1a93208)
        updateTextures(0x1a93208)
        dump('camera-'..orientation..'-gfx.bin',0x1a93208+0x52480,80400*2)
        dump('camera-'..orientation..'-pillar.bin',0x1a93208+0xc80e0,80400*2)
      end
      dump('height.bin',0x1a93208+0x29fa30,80400)
      dump('base-height.bin',0x1a93208+0x2b3440,80400)
      writeJSON('renderer-result.json',{format=request.format,id=request.id,
        mapHash=request.mapHash,engineHash=request.engineHash,complete=true})
    end)
    if not ok then
      pcall(writeJSON,'renderer-result.json',{format=request.format,id=request.id,error=tostring(reason)})
    end
    -- The original CRT exit entry. All exported files have been closed.
    core.exposeCode(0x583d55,1,0)(ok and 0 or 1)
  end)
end
return M
