const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseTrace, readTrace } = require('../src/node/simulation-trace');
const { exportObserver } = require('../src/node/simulation-observer');
const model = require('../src/js/simulation-model');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const header = { format:'ai-toolkit-simulation-v1', variant:'SHC', sampleTicks:1, coordinates:'map-tiles', snapshotHash:'a'.repeat(64), settingsHash:'b'.repeat(64) };
const worker = (uid=10,x=100,y=100,cargo=0) => [1,uid,4,1,x,y,90,90,2,2,cargo,1,0];
const frame = (tick,workers=[worker()],extra={}) => ({kind:'frame',tick,workers,buildings:[],fires:[],sparks:[],resources:Array(200).fill(0),...extra});
const encode = (frames,head=header) => [head,...frames].map(v=>JSON.stringify(v)+'\n').join('');

test('trace loader keeps completed frames and ignores an interrupted final line',()=>{
  const result=parseTrace(encode([frame(5),frame(6)])+'{"kind":"frame"');
  assert.equal(result.frames.length,2);
  assert.equal(result.partial,true);
  assert.throws(()=>parseTrace(encode([frame(6),frame(5)])),/unordered/);
  assert.throws(()=>parseTrace(encode([frame(6,[worker(),worker()])])),/Invalid/);
  assert.throws(()=>parseTrace(encode([frame(6,[worker(10,401)])])),/coordinates/);
  assert.throws(()=>parseTrace(encode([frame(6,[],{sparks:[[1,1,3201,0,0,0,0,0,0]]})])),/coordinates/);
});

test('recorded save and UCP settings are verified; no background is borrowed from another castle',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-trace-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const snapshot=Buffer.from('unsupported preview'), settings=Buffer.from('active: balance');
  fs.writeFileSync(path.join(dir,'start.sav'),snapshot);fs.writeFileSync(path.join(dir,'ucp-config.yml'),settings);
  const traceFile=path.join(dir,'capture.jsonl');
  fs.writeFileSync(traceFile,encode([frame(1)],{...header,snapshotHash:hash(snapshot),settingsHash:hash(settings)}));
  const trace=readTrace(traceFile);assert.equal(trace.background,null);assert.match(trace.backgroundNotice,/recorded map coordinates/);
  fs.writeFileSync(path.join(dir,'ucp-config.yml'),'different balance');
  assert.throws(()=>readTrace(traceFile),/do not match/);
});

test('real worker paths preserve detours, heights and entrance-independent coordinates',()=>{
  const frames=[frame(1,[worker(10,10,10)]),frame(2,[worker(10,11,10)]),frame(3,[worker(10,11,11)])];
  const line=model.trails(frames,'workers')[0];
  assert.deepEqual(line.segments[0].map(p=>[p.x,p.y,p.height]),[[10,10,90],[11,10,90],[11,11,90]]);
  assert.equal(model.workerSummary(frames,'1:10').distance,2);
});

test('recycled IDs, absent workers and missing ticks never join unrelated paths',()=>{
  const frames=[frame(1),frame(2,[]),frame(3),frame(5),frame(6,[worker(11)])];
  const paths=model.trails(frames,'workers');
  assert.equal(paths.length,2);assert.equal(paths[0].segments.length,3);
  assert.equal(model.workerSummary([frame(1,[worker(10,1,1,12)]),frame(3,[worker(10,10,10,0)])],'1:10').unloads.length,0);
});

test('fire occupancy counts ticks once per tile and retains distant spark positions',()=>{
  const fires=[[1,1,80,80,0,1,2,0,1],[2,2,81,80,0,1,2,0,1]];
  const sparks=[[1,3,152,80,12,80,80,0,1]];
  const frames=[frame(1,[],{fires,sparks}),frame(2,[])];
  assert.deepEqual(model.fireOccupancy(frames),[{x:10,y:10,samples:1,fraction:.5}]);
  assert.equal(model.trails(frames,'sparks')[0].segments[0][0].x,19);
});

test('cargo cycle observation is separate from production assumptions',()=>{
  const frames=[frame(1,[worker(10,1,1,12)]),frame(2,[worker(10,1,1,0)]),frame(3,[worker(10,1,1,18)]),frame(4,[worker(10,1,1,0)])];
  const summary=model.workerSummary(frames,'1:10');
  assert.deepEqual(summary.unloads.map(u=>u.amount),[12,18]);assert.deepEqual(summary.cycles,[2]);
});

test('observer export is repeatable and preserves a modified existing module',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-observer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const app=path.join(__dirname,'..'), target=exportObserver(dir,app);
  assert.equal(exportObserver(dir,app),target);
  fs.writeFileSync(path.join(target,'init.lua'),'user changes');
  assert.throws(()=>exportObserver(dir,app),/preserve/);
  assert.equal(fs.readFileSync(path.join(target,'init.lua'),'utf8'),'user changes');
});
