(function exposeCastleGeometry(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.castleGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const KEEP_ITEM_TYPE = 61;
  const FORCED_STOCKPILE_ITEM_TYPE = 52;

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
  // Mauer. Vier Richtungen, nicht acht - sonst laeuft die Fuellung durch
  // diagonale Luecken hindurch, die im Spiel keine sind.
  //
  // `limit` ist eine Notbremse, keine Regel: eine Karte hat 10000 Felder, und
  // ein Fehlgriff auf freies Gelaende soll nicht die halbe Karte zubauen.
  function floodTiles(start, isBlocked, gridSize = 100, limit = 4000) {
    if (!start || isBlocked(start.x, start.y)) return [];
    const gesehen = new Set([start.y * gridSize + start.x]);
    const out = [];
    const rand = [start];
    while (rand.length) {
      const feld = rand.pop();
      out.push(feld);
      if (out.length >= limit) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = feld.x + dx, y = feld.y + dy;
        if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) continue;
        const key = y * gridSize + x;
        if (gesehen.has(key) || isBlocked(x, y)) continue;
        gesehen.add(key);
        rand.push({ x, y });
      }
    }
    return out;
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
      shouldPause: selected.some(index => frames[index].shouldPause)
    };
    const removed = new Set(selected.slice(1));
    return {
      frames: frames.map((frame, index) => index === selected[0] ? merged : frame)
        .filter((_frame, index) => !removed.has(index)),
      index: selected[0]
    };
  }

  // Flood through touching footprints of the clicked type. Locked objects
  // and the Keep are barriers. Other item types never join the deletion.
  function floodPlacementRefs(start, placements, rectsFor, isLocked, gridSize = 100) {
    if (!start || isLocked(start.ref) || Number(start.type) === KEEP_ITEM_TYPE) return new Set();
    const cells = new Map();
    const barriers = new Set();
    for (const placement of placements) {
      const blocked = isLocked(placement.ref) || Number(placement.type) === KEEP_ITEM_TYPE;
      if (!blocked && Number(placement.type) !== Number(start.type)) continue;
      for (const rect of rectsFor(placement)) {
        for (let y = Math.max(0, rect.bottom); y <= Math.min(gridSize - 1, rect.top); y++) {
          for (let x = Math.max(0, rect.left); x <= Math.min(gridSize - 1, rect.right); x++) {
            const key = y * gridSize + x;
            if (blocked) barriers.add(key);
            else {
              if (!cells.has(key)) cells.set(key, new Set());
              cells.get(key).add(placement.ref);
            }
          }
        }
      }
    }
    const startCell = [...cells].find(([key, refs]) => !barriers.has(key) && refs.has(start.ref));
    if (!startCell) return new Set();
    const tiles = floodTiles({ x: startCell[0] % gridSize, y: Math.floor(startCell[0] / gridSize) },
      (x, y) => !cells.has(y * gridSize + x) || barriers.has(y * gridSize + x), gridSize, gridSize * gridSize);
    return new Set(tiles.flatMap(tile => [...cells.get(tile.y * gridSize + tile.x)]));
  }

  return {
    KEEP_ITEM_TYPE,
    mergeBuildSteps,
    floodPlacementRefs,
    // Die Kantenlaenge der Karte. Stand bisher als 100 in jeder
    // Vorgabe; wer sie braucht, soll sie hier holen.
    GRID_SIZE: 100,
    brushTiles,
    floodTiles,
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
