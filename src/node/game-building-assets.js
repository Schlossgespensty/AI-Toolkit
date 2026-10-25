'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const gm = require('./gm1');
const {packMapPictures} = require('./pixel-atlas');
const {resolveGameGraphics} = require('./game-graphics');
const sourceParts = require('../../config/iso-source-parts.json');
const wallSources = require('../../config/iso-wall-sources.json');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const cataloguePath = path.join(__dirname,'../../assets/aiv/iso/verzeichnis.json');
function gameBuildingAssets(root, cacheRoot) {
  if(!root)return null;
  const graphics=resolveGameGraphics(root);
  const catalogue=JSON.parse(fs.readFileSync(cataloguePath,'utf8'));
  const revision=require('node:crypto').createHash('sha256').update('8:'+graphics.revision+JSON.stringify(sourceParts)+JSON.stringify(wallSources)+JSON.stringify(catalogue)).digest('hex');
  fs.mkdirSync(cacheRoot,{recursive:true});
  const cache=path.join(cacheRoot,`${revision}.json`),png=path.join(cacheRoot,`${revision}.png`);
  if(fs.existsSync(cache)&&fs.existsSync(png))return JSON.parse(fs.readFileSync(cache,'utf8'));
  const files = new Map(), parts = new Map(), pictures = [], warnings = new Set();
  function stock(name, index) {
    const selected = graphics.file(name);
    const read = file => {
      if (!files.has(file)) files.set(file, gm.readGm1(fs.readFileSync(file)));
      return files.get(file);
    };
    const file = read(selected);
    if (file.pictures[index]) return file;
    const fallback = path.join(root, 'gm', `${name}.gm1`);
    if (path.resolve(selected) === path.resolve(fallback)) throw new Error(`Missing ${name} picture ${index}`);
    warnings.add(`${name} picture ${index}: missing from replacement; using installed base texture.`);
    return read(fallback);
  }
  function decode(source) {
    if (source.sprite === true) {
      // Plain pictures (anim_castle: the bevels of diagonal walls) keep their own origin.
      const file = stock(source.file, source.index), entry = file.pictures[source.index];
      const raw = file.buffer.subarray(file.picturesAt + entry.offset, file.picturesAt + entry.offset + entry.size);
      return {width: entry.width, height: entry.height, dx: 0, dy: 0, rgba: gm.tgxToRgba(raw, entry.width, entry.height, null)};
    }
    const top = gm.decodePart(stock(source.file, source.index), source.index, source.palette ?? null);
    if (source.pillar === undefined) return top;
    const pillar = gm.pillarPicture(stock('tile_walls', source.pillar), source.pillar, source.lift);
    if (!pillar) throw new Error('Unsupported wall pillar texture.');
    const height = top.height + source.lift, rgba = Buffer.alloc(top.width * height * 4);
    gm.composite(rgba, top.width, height, pillar.rgba, pillar.width, pillar.height, 0, pillar.dy - top.dy);
    gm.composite(rgba, top.width, height, top.rgba, top.width, top.height, 0, 0);
    return {...top, height, rgba};
  }
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    const key = Number.isInteger(value.nativePit) ? `pit:${value.nativePit}` : Number.isInteger(value.nativeMoat) ? `moat:${value.nativeMoat}` : value.bild === 'building-parts.png' ? `${value.sx},${value.sy}` : value.bild;
    let source = value.bild === 'building-parts.png' ? sourceParts[key] : wallSources[key];
    const single = /^(killing_pits|pitch_ditches)_(\d+)\.png$/.exec(value.bild || '');
    if (Number.isInteger(value.nativeMoat)) source = {file:'tile_sea8', index:value.nativeMoat};
    const flat = /^native-flat:(\d+)$/.exec(value.bild || '');
    if (flat) source = {file:'tile_flatties', index:Number(flat[1])};
    const appleStump = /^native-apple-stump:(\d+)$/.exec(value.bild || '');
    if (appleStump) source = {file:'tree_apple', index:100, palette:Number(appleStump[1])};
    if (source?.file === 'tile_farmland' || source?.file === 'tree_apple') value.flatField = true;
    // Native farm placement gives crop and fence cells the parent building ID.
    // They use plain farm/dairy ground in Space; the hut alone has a symbol.
    if (source?.file === 'tile_farmland' && source.index <= 60) value.flatSprite = {bild:`native-flat:${source.index >= 55 ? 28 : 30}`};
    if (source?.file === 'tree_apple' && !appleStump) value.flatSprite = {bild:`native-apple-stump:${source.palette ?? 0}`};
    if (source?.file === 'tile_land3') value.flatStair = [134,136].includes(source.index) ? 42 : 40;
    if (single) source = {file: single[1], index: Number(single[2])};
    if (Number.isInteger(value.nativePit)) source = {file:'killing_pits',index:value.nativePit};
    if (source) {
      let record = parts.get(key);
      if (!record) {
        const decoded = decode(source);
        record = {index:pictures.length, decoded}; parts.set(key, record); pictures.push(decoded);
      }
      value.bild = pathToFileURL(png).href;
      value.breite = record.decoded.width; value.hoehe = record.decoded.height;
      value.dx = record.decoded.dx; value.dy = record.decoded.dy;
      value.assetIndex = record.index;
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  }
  visit(catalogue);
  const atlas=packMapPictures(pictures);
  function locate(value) {
    if(!value||typeof value!=='object')return;
    if(value.assetIndex!==undefined){const entry=atlas.entries[value.assetIndex];value.sx=entry.x;value.sy=entry.y;delete value.assetIndex;}
    for(const child of Object.values(value))if(child&&typeof child==='object')locate(child);
  }
  locate(catalogue);
  catalogue.assetWarnings = [...warnings];
  fs.writeFileSync(png,Buffer.from(atlas.dataUrl.split(',')[1],'base64'));
  fs.writeFileSync(cache,JSON.stringify(catalogue));
  return catalogue;
}
// Keep GM1 decoding and PNG compression off Electron's main thread. Concurrent
// view mounts share one build; later requests revalidate the on-disk asset cache.
const pending = new Map();
function loadGameBuildingAssets(root, cacheRoot) {
  if (!root) return Promise.resolve(null);
  const key = JSON.stringify([root, cacheRoot]);
  if (!pending.has(key)) {
    const promise = new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {workerData: {root, cacheRoot}});
      worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result.catalogue));
      worker.once('error', reject);
      worker.once('exit', code => { if (code) reject(new Error(`Building texture worker exited (${code}).`)); });
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
  }
  return pending.get(key);
}
if (!isMainThread && workerData?.cacheRoot) {
  try { parentPort.postMessage({catalogue: gameBuildingAssets(workerData.root, workerData.cacheRoot)}); }
  catch (error) { parentPort.postMessage({error: error.message}); }
}
module.exports = {gameBuildingAssets, loadGameBuildingAssets};
