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

  return {
    KEEP_ITEM_TYPE,
    FORCED_STOCKPILE_ITEM_TYPE,
    footprintRectsAtXY,
    rectsIntersect,
    footprintsIntersect,
    footprintContainsTile,
    footprintBounds,
    footprintIsInBounds,
    lineTiles,
    insertBuildSteps,
    moveBuildSteps
  };
});
