(function exposeCastleGeometry(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.castleGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const KEEP_ITEM_TYPE = 61;
  const FORCED_STOCKPILE_ITEM_TYPE = 52;

  // Classic construction deck heights, shared by routing and troop previews.
  // Heights are native image pixels above the supporting terrain.
  function structureHeight(type) {
    type = Number(type);
    if (type === KEEP_ITEM_TYPE) return 92;
    if (type === 25) return 90;
    if (type === 46) return 60;
    if (type >= 181 && type <= 186) return (186 - type) * 16;
    if (type >= 110 && type <= 114) return [296, 148, 180, 192, 192][type - 110];
    // getBuildingHeightForBuildingID: both stone gatehouse roofs are 128px.
    if (type >= 144 && type <= 147) return 128;
    return null;
  }

  function rectangle(left, bottom, right, top, part = 'item') {
    return { left, bottom, right, top, part };
  }

  function footprintRectsAtXY(type, x, y, size = [1, 1]) {
    if (Number(type) === KEEP_ITEM_TYPE) {
      return [
        // Keep building: seven rows.
        rectangle(x, y - 6, x + 6, y, 'keep'),
        // Only the center three tiles of the connecting middle row are occupied.
        rectangle(x + 2, y - 7, x + 4, y - 7, 'keep'),
        // Lower Keep/courtyard: seven rows.
        rectangle(x, y - 14, x + 6, y - 8, 'keep'),
        // Stockpile automatically created by the game; visual/collision only.
        rectangle(x + 7, y - 6, x + 11, y - 2, 'stockpile')
      ];
    }

    const width = Math.max(1, Number(size[0]) || 1);
    const height = Math.max(1, Number(size[1]) || 1);
    return [rectangle(x, y - height + 1, x + width - 1, y)];
  }

  function rectsIntersect(a, b) {
    return !(a.right < b.left || b.right < a.left || a.top < b.bottom || b.top < a.bottom);
  }

  function footprintsIntersect(first, second) {
    return first.some(a => second.some(b => rectsIntersect(a, b)));
  }

  function footprintContainsTile(rects, tile) {
    return rects.some(rect => (
      tile.x >= rect.left && tile.x <= rect.right &&
      tile.y >= rect.bottom && tile.y <= rect.top
    ));
  }

  function footprintBounds(rects) {
    return {
      left: Math.min(...rects.map(rect => rect.left)),
      bottom: Math.min(...rects.map(rect => rect.bottom)),
      right: Math.max(...rects.map(rect => rect.right)),
      top: Math.max(...rects.map(rect => rect.top))
    };
  }

  function footprintIsInBounds(rects, gridSize) {
    return rects.every(rect => (
      rect.left >= 0 && rect.bottom >= 0 &&
      rect.right < gridSize && rect.top < gridSize
    ));
  }

  function lineTiles(a, b) {
    const points = [];
    let x0 = a.x;
    let y0 = a.y;
    const x1 = b.x;
    const y1 = b.y;
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;

    while (true) {
      points.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const doubledError = 2 * error;
      if (doubledError >= dy) {
        error += dy;
        x0 += sx;
      }
      if (doubledError <= dx) {
        error += dx;
        y0 += sy;
      }
    }

    return points;
  }

  function limitedLineTiles(start, end, maxLength) {
    const count = Math.max(0, Math.floor(Number(maxLength) || 0));
    if (!count) return [];
    return lineTiles(start, end).slice(0, count);
  }

  function routedLineTiles(a, b, isBlocked, gridSize = 100) {
    if (typeof isBlocked !== 'function') throw new TypeError('Line routing requires an obstacle check.');
    const start = { x: Number(a?.x), y: Number(a?.y) };
    const end = { x: Number(b?.x), y: Number(b?.y) };
    const size = Math.max(1, Math.floor(Number(gridSize) || 0));
    const inBounds = point => (
      Number.isInteger(point.x) && Number.isInteger(point.y) &&
      point.x >= 0 && point.y >= 0 && point.x < size && point.y < size
    );
    if (!inBounds(start) || !inBounds(end) || isBlocked(start)) return [];

    const direct = lineTiles(start, end);
    if (direct.every(point => !isBlocked(point))) return direct;

    const indexOf = point => point.y * size + point.x;
    const pointAt = index => ({ x: index % size, y: Math.floor(index / size) });
    const keyFor = point => `${point.x}:${point.y}`;
    const goals = new Set();
    if (!isBlocked(end)) {
      goals.add(keyFor(end));
    } else {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const point = { x: end.x + dx, y: end.y + dy };
          if (inBounds(point) && !isBlocked(point)) goals.add(keyFor(point));
        }
      }
    }
    if (!goals.size) return [];

    const previous = new Int32Array(size * size);
    previous.fill(-1);
    const startIndex = indexOf(start);
    previous[startIndex] = startIndex;
    const queue = [startIndex];
    let queueIndex = 0;
    let goalIndex = -1;
    const directions = [
      { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
      { x: -1, y: 0 },                       { x: 1, y: 0 },
      { x: -1, y: 1 },  { x: 0, y: 1 },  { x: 1, y: 1 }
    ];
    const lineDx = end.x - start.x;
    const lineDy = end.y - start.y;
    const rank = point => ({
      distance: Math.max(Math.abs(end.x - point.x), Math.abs(end.y - point.y)),
      deviation: Math.abs(lineDy * (point.x - start.x) - lineDx * (point.y - start.y))
    });

    while (queueIndex < queue.length) {
      const currentIndex = queue[queueIndex++];
      const current = pointAt(currentIndex);
      if (goals.has(keyFor(current))) {
        goalIndex = currentIndex;
        break;
      }

      const neighbors = directions
        .map(direction => ({ x: current.x + direction.x, y: current.y + direction.y }))
        .filter(inBounds)
        .sort((one, two) => {
          const first = rank(one);
          const second = rank(two);
          return first.distance - second.distance || first.deviation - second.deviation;
        });
      for (const neighbor of neighbors) {
        const neighborIndex = indexOf(neighbor);
        if (previous[neighborIndex] !== -1 || isBlocked(neighbor)) continue;
        previous[neighborIndex] = currentIndex;
        queue.push(neighborIndex);
      }
    }

    if (goalIndex < 0) return [];
    const route = [];
    for (let index = goalIndex; ; index = previous[index]) {
      route.push(pointAt(index));
      if (index === startIndex) break;
    }
    route.reverse();
    return route;
  }

  function insertBuildSteps(frames, newFrames, afterIndex = null) {
    if (!Array.isArray(frames) || !Array.isArray(newFrames)) {
      throw new TypeError('Build steps must be arrays.');
    }
    const hasAnchor = Number.isInteger(afterIndex) && afterIndex >= -1 && afterIndex < frames.length;
    const startIndex = hasAnchor ? afterIndex + 1 : frames.length;
    frames.splice(startIndex, 0, ...newFrames);
    return {
      startIndex,
      endIndex: newFrames.length ? startIndex + newFrames.length - 1 : afterIndex
    };
  }

  function moveBuildSteps(frames, selectedIndices, targetIndex) {
    if (!Array.isArray(frames) || !Array.isArray(selectedIndices)) {
      throw new TypeError('Build steps and selected indexes must be arrays.');
    }
    const indexes = [...new Set(selectedIndices)]
      .filter(index => Number.isInteger(index) && index >= 0 && index < frames.length)
      .sort((one, two) => one - two);
    if (!indexes.length || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= frames.length) {
      return { moved: false, startIndex: -1, endIndex: -1 };
    }
    if (indexes.includes(targetIndex)) {
      return { moved: false, startIndex: indexes[0], endIndex: indexes.at(-1) };
    }

    const selected = new Set(indexes);
    const moving = indexes.map(index => frames[index]);
    const targetFrame = frames[targetIndex];
    const remaining = frames.filter((_frame, index) => !selected.has(index));
    const targetRemainingIndex = remaining.indexOf(targetFrame);
    const movingDown = targetIndex > indexes.at(-1);
    const startIndex = targetRemainingIndex + (movingDown ? 1 : 0);
    remaining.splice(startIndex, 0, ...moving);
    frames.splice(0, frames.length, ...remaining);
    return {
      moved: true,
      startIndex,
      endIndex: startIndex + moving.length - 1
    };
  }

  // Die Felder eines Pinsels. Groesse 1 ist ein Feld, 3 ein Quadrat von drei
  // mal drei um die Mitte herum. Gerade Groessen legen die Mitte nach links
  // unten - anders geht es nicht, ohne den Zeiger zwischen zwei Felder zu
  // setzen. Was ueber den Kartenrand ragt, faellt weg.
  function brushTiles(center, size, gridSize = 100) {
    if (!center) return [];
    const n = Math.max(1, Math.min(Math.round(size) || 1, gridSize));
    const von = Math.floor((n - 1) / 2);
    const out = [];
    for (let dy = -von; dy < n - von; dy++) {
      for (let dx = -von; dx < n - von; dx++) {
        const x = center.x + dx, y = center.y + dy;
        if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) continue;
        out.push({ x, y });
      }
    }
    return out;
  }

  // Der zusammenhaengende freie Bereich um ein Feld herum - was der Farbeimer
  // fuellt. Begrenzt wird er von allem, was `isBlocked` als besetzt meldet,
  // und vom Kartenrand: wer am Rand steht, ist eingeschlossen wie vor einer
  // Mauer. Wie im alten Village Editor zaehlen auch direkte diagonale
  // Nachbarn als verbunden. Dies ist die Fuellregel, nicht die Wegfindung.
  //
  /** Iterative region traversal. The predicate is evaluated at most once per cell.
   * Stable DFS order preserves capped fills and multi-tile placement order.
   * @param {{x:number,y:number}} start
   * @param {(x:number,y:number)=>boolean} isBlocked
   * @param {{width?:number,height?:number,limit?:number,diagonal?:boolean,visit?:(x:number,y:number,index:number)=>void}} options
   * @returns {number} Visited cell count.
   */
  function floodRegion(start, isBlocked, {width=100,height=width,limit=width*height,diagonal=true,visit=()=>{}} = {}) {
    if (!start || !Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1
      || !Number.isInteger(start.x) || !Number.isInteger(start.y)
      || start.x<0 || start.y<0 || start.x>=width || start.y>=height || !(limit>0)) return 0;
    const seen=new Uint8Array(width*height), stack=new Uint32Array(width*height);
    let length=0, count=0;
    const enqueue=(x,y)=>{
      if(x<0||y<0||x>=width||y>=height)return;
      const index=y*width+x;
      if(seen[index])return;
      seen[index]=1;
      if(!isBlocked(x,y))stack[length++]=index;
    };
    enqueue(start.x,start.y);
    while(length) {
      const index=stack[--length],x=index%width,y=Math.floor(index/width);
      visit(x,y,index);
      if(++count>=limit)break;
      enqueue(x+1,y);enqueue(x-1,y);enqueue(x,y+1);enqueue(x,y-1);
      if(diagonal){enqueue(x+1,y+1);enqueue(x+1,y-1);enqueue(x-1,y+1);enqueue(x-1,y-1);}
    }
    return count;
  }

  function floodTiles(start, isBlocked, gridSize = 100, limit = gridSize * gridSize) {
    const out=[];
    floodRegion(start,isBlocked,{width:gridSize,limit,visit:(x,y)=>out.push({x,y})});
    return out;
  }

  /** Greedy building fill: prefer contact with existing boundaries, then sweep rows.
   * Every tile remains an eligible anchor; no global grid phase or packing search.
   * Footprints and placement policy are validated by the caller after ordering.
   */
  function orderFillTiles(tiles, footprint, isBlocked, gridSize=100) {
    const inside=new Set(),key=(x,y)=>`${x},${y}`;
    for(const r of footprint)for(let y=r.bottom;y<=r.top;y++)for(let x=r.left;x<=r.right;x++)inside.add(key(x,y));
    if(inside.size<=1)return tiles;
    const perimeter=new Map();
    for(const cell of inside){const [x,y]=cell.split(',').map(Number);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const at=key(x+dx,y+dy);if(!inside.has(at))perimeter.set(at,[x+dx,y+dy]);
      }
    }
    const edges=[...perimeter.values()];
    // Integer contact scores permit linear bucket ordering, not comparison sorting.
    const at=Array(gridSize*gridSize), buckets=Array.from({length:edges.length+1},()=>[]);
    for(const tile of tiles)at[tile.y*gridSize+tile.x]=tile;
    for(const tile of at)if(tile){
      let contact=0;
      for(const [dx,dy] of edges){const x=tile.x+dx,y=tile.y+dy;
        if(x<0||y<0||x>=gridSize||y>=gridSize||isBlocked(x,y))contact++;
      }
      buckets[contact].push(tile);
    }
    const ordered=[];
    for(let score=buckets.length-1;score>=0;score--)for(const tile of buckets[score])ordered.push(tile);
    return ordered;
  }

  // Operation-local broad-phase index. Exact collision policy stays in the validator.
  function footprintIndex(placements, rectsFor, gridSize=100) {
    const cells=Array(gridSize*gridSize);
    function eachCell(rects, visit) {
      for(const r of rects) for(let y=Math.max(0,r.bottom);y<=Math.min(gridSize-1,r.top);y++)
        for(let x=Math.max(0,r.left);x<=Math.min(gridSize-1,r.right);x++)visit(y*gridSize+x);
    }
    const add=placement=>eachCell(rectsFor(placement),index=>{(cells[index] ||= []).push(placement);});
    for(const placement of placements)add(placement);
    return {add,has:(x,y)=>!!cells[y*gridSize+x],query(rects){
      const found=new Set();eachCell(rects,index=>{for(const p of cells[index] || [])found.add(p);});return found;
    }};
  }

  // Return a proposal, leaving the document untouched until the caller has
  // saved its undo snapshot. Exact item types must match, not just categories.
  function mergeBuildSteps(frames, indexes, allowedTypes) {
    const selected = [...new Set(indexes)].sort((a, b) => a - b);
    if (selected.length < 2) throw new Error('Select at least two complete build steps.');
    if (selected.some(index => !Number.isInteger(index) || !frames[index])) {
      throw new Error('The build-step selection is invalid.');
    }
    const first = frames[selected[0]];
    if (!allowedTypes.map(Number).includes(Number(first.itemType))) {
      throw new Error('Only wall, moat or pitch steps can be merged.');
    }
    if (selected.some(index => Number(frames[index].itemType) !== Number(first.itemType))) {
      throw new Error('Select steps of exactly the same item type.');
    }
    if (selected.some(index => frames[index].locked)) throw new Error('Unlock the selected steps before merging.');
    const merged = {
      ...first,
      tilePositionOfsets: [...new Set(selected.flatMap(index => frames[index].tilePositionOfsets))],
      shouldPause: false
    };
    const removed = new Set(selected.slice(1));
    return {
      frames: frames.map((frame, index) => index === selected[0] ? merged : frame)
        .filter((_frame, index) => !removed.has(index)),
      index: selected[0]
    };
  }

  // Selections name placement indexes, so an area can merge part of a step
  // without pulling its placements outside the box forward in the build order.
  function stepMergeGroups(frames, selections, allowedTypes) {
    const allowed = new Set(allowedTypes.map(Number)), byType = new Map();
    for (const [fi, indexes] of selections) {
      const frame = frames[fi], type = Number(frame?.itemType);
      if (!frame || frame.locked || type === KEEP_ITEM_TYPE || !allowed.has(type)) continue;
      const picked = new Set([...indexes].filter(oi => Number.isInteger(oi) && oi >= 0 && oi < frame.tilePositionOfsets.length));
      if (!picked.size) continue;
      if (!byType.has(type)) byType.set(type, {type, steps: new Map(), count: 0});
      const group = byType.get(type);
      group.steps.set(fi, picked);
      group.count += picked.size;
    }
    return [...byType.values()].sort((a, b) => a.type - b.type);
  }

  function mergeStepPlacements(frames, selections, checkedTypes, allowedTypes) {
    const checked = new Set(checkedTypes.map(Number));
    const groups = stepMergeGroups(frames, selections, allowedTypes)
      .filter(group => checked.has(group.type) && group.steps.size > 1);
    if (!groups.length) throw new Error('Choose an item type with placements in at least two unlocked steps.');
    const starts = new Map(), removed = new Map();
    for (const group of groups) {
      const indexes = [...group.steps.keys()].sort((a, b) => a - b);
      const offsets = indexes.flatMap(fi => frames[fi].tilePositionOfsets.filter((_off, oi) => group.steps.get(fi).has(oi)));
      starts.set(indexes[0], {...frames[indexes[0]], tilePositionOfsets: [...new Set(offsets)], shouldPause: false});
      for (const fi of indexes) removed.set(fi, group.steps.get(fi));
    }
    const output = [], mergedIndexes = [];
    frames.forEach((frame, fi) => {
      if (starts.has(fi)) { mergedIndexes.push(output.length); output.push(starts.get(fi)); }
      if (!removed.has(fi)) { output.push(frame); return; }
      const rest = frame.tilePositionOfsets.filter((_off, oi) => !removed.get(fi).has(oi));
      if (rest.length) output.push({...frame, tilePositionOfsets: rest});
    });
    return {frames: output, mergedIndexes};
  }

  // Flood through touching footprints of the clicked type. Locked objects
  // and the Keep are barriers. Other item types never join the deletion.
  function floodPlacementRefs(start, placements, rectsFor, isLocked, gridSize = 100, protectKeep = true) {
    if (!start || isLocked(start.ref) || (protectKeep && Number(start.type) === KEEP_ITEM_TYPE)) return new Set();
    const cells = Array(gridSize*gridSize);
    const barriers = new Uint8Array(gridSize*gridSize);
    for (const placement of placements) {
      const blocked = isLocked(placement.ref) || (protectKeep && Number(placement.type) === KEEP_ITEM_TYPE);
      if (!blocked && Number(placement.type) !== Number(start.type)) continue;
      for (const rect of rectsFor(placement)) {
        for (let y = Math.max(0, rect.bottom); y <= Math.min(gridSize - 1, rect.top); y++) {
          for (let x = Math.max(0, rect.left); x <= Math.min(gridSize - 1, rect.right); x++) {
            const key = y * gridSize + x;
            if (blocked) barriers[key] = 1;
            else {
              (cells[key] ||= []).push(placement.ref);
            }
          }
        }
      }
    }
    let seed;
    for(const [key,refs] of cells.entries()) if(!barriers[key]&&refs?.includes(start.ref)){seed=key;break;}
    const result=new Set();
    if(seed===undefined)return result;
    floodRegion({x:seed%gridSize,y:Math.floor(seed/gridSize)},
      (x,y)=>!cells[y*gridSize+x]||!!barriers[y*gridSize+x],
      {width:gridSize,visit:(_x,_y,key)=>{for(const ref of cells[key])result.add(ref);}});
    return result;
  }

  // Placement policy is independent of the palette category and active tool.
  const MERGEABLE_TYPES = Object.freeze([25, 26, 35, 46, 99, 106]);
  function placementOverlap(incoming, existing, definitions) {
    const next = definitions[incoming] || {}, previous = definitions[existing] || {};
    if (next.kind === 'unit' || next.overlap === 'allow' || previous.kind === 'unit' || previous.overlap === 'allow') return 'allow';
    if ([99, 106].includes(Number(incoming))) return 'block';
    if (previous.overlap !== 'replace') return 'block';
    if (Number(incoming) === Number(existing)) return 'block';
    return 'replace';
  }

  return {
    KEEP_ITEM_TYPE,
    MERGEABLE_TYPES,
    placementOverlap,
    mergeBuildSteps,
    stepMergeGroups,
    mergeStepPlacements,
    floodPlacementRefs,
    // Die Kantenlaenge der Karte. Stand bisher als 100 in jeder
    // Vorgabe; wer sie braucht, soll sie hier holen.
    GRID_SIZE: 100,
    structureHeight,
    brushTiles,
    floodTiles,
    floodRegion,
    orderFillTiles,
    footprintIndex,
    FORCED_STOCKPILE_ITEM_TYPE,
    footprintRectsAtXY,
    rectsIntersect,
    footprintsIntersect,
    footprintContainsTile,
    footprintBounds,
    footprintIsInBounds,
    lineTiles,
    limitedLineTiles,
    routedLineTiles,
    insertBuildSteps,
    moveBuildSteps
  };
});
