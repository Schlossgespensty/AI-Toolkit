'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {internals:map}=require('./game-map');
const MAX=65*1024*1024;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function bounded(file,limit=MAX) {
  if (fs.statSync(file).size>limit) throw new Error('Simulation capture exceeds the supported size.');
  return fs.readFileSync(file);
}
function parseTrace(text) {
  if (Buffer.byteLength(text)>MAX) throw new Error('Simulation capture exceeds the supported size.');
  const lines=text.split('\n');
  // A currently recording writer may be part way through the last line.
  const partial=!!lines.at(-1).trim();
  lines.pop();
  const header=JSON.parse(lines.shift()||'null');
  if (header?.format!=='ai-toolkit-simulation-v1' || header.variant!=='SHC'
    || header.sampleTicks!==1 || header.coordinates!=='map-tiles'
    || !/^[a-f0-9]{64}$/.test(header.snapshotHash||'')
    || !/^[a-f0-9]{64}$/.test(header.settingsHash||'')) throw new Error('Unsupported simulation trace header.');
  const frames=[];let last=-1,end=null;
  const tuples=(values,length,max)=>Array.isArray(values) && values.length<=max && values.every(v=>
    Array.isArray(v) && v.length===length && v.every(Number.isSafeInteger) && v[0]>0 && v[0]<max && v[1]>=0)
    && new Set(values.map(v=>v[0])).size===values.length;
  for (const line of lines) {
    if (!line.trim()) continue;
    const frame=JSON.parse(line);
    if (frame.kind==='end') { end=String(frame.reason||'Capture ended').slice(0,160);continue; }
    if (end || frame.kind!=='frame' || !Number.isSafeInteger(frame.tick) || frame.tick<=last
      || !tuples(frame.workers,13,2500) || !tuples(frame.buildings,13,2000) || !tuples(frame.fires,9,3000) || !tuples(frame.sparks,9,3000)
      || !Array.isArray(frame.resources) || frame.resources.length!==200 || !frame.resources.every(Number.isSafeInteger)) throw new Error('Invalid or unordered simulation frame.');
    if (frame.workers.some(w=>w[4]<0||w[4]>399||w[5]<0||w[5]>399)
      || frame.buildings.some(b=>b[4]<0||b[4]>399||b[5]<0||b[5]>399||b[6]<1||b[6]>32)
      || [...frame.fires,...frame.sparks].some(f=>f[2]<0||f[2]>3199||f[3]<0||f[3]>3199)) throw new Error('Simulation coordinates exceed the game map.');
    last=frame.tick;frames.push(frame);
    if (frames.length>100000) throw new Error('Too many simulation frames.');
  }
  if (!frames.length) throw new Error('No completed simulation frames yet.');
  return {header,frames,partial,end};
}
function readTrace(file) {
  const trace=parseTrace(bounded(file).toString('utf8'));
  const folder=path.dirname(fs.realpathSync(file));
  // Fixed siblings only; the imported JSON cannot name arbitrary local files.
  const snapshot=bounded(path.join(folder,'start.sav'),32*1024*1024);
  const settings=bounded(path.join(folder,'ucp-config.yml'),4*1024*1024);
  if (hash(snapshot)!==trace.header.snapshotHash || hash(settings)!==trace.header.settingsHash) throw new Error('The recorded map or UCP settings do not match this trace.');
  // Save variants without a supported preview can still display the actual
  // recorded coordinates. Never substitute the unrelated map open in the AIV.
  try {
    const preview=map.readPreview(snapshot);
    trace.background=`data:image/png;base64,${map.previewPng(preview).toString('base64')}`;
  } catch {
    trace.background=null;
    trace.backgroundNotice='This save has no supported preview; showing recorded map coordinates.';
  }
  trace.path=file;
  return trace;
}
module.exports={parseTrace,readTrace};
