// Geometry for the 2.5D view — pure functions, no canvas, no DOM.
// Kept separate from iso-view.js so it can be tested with node --test.
//
// Two coordinate systems meet here:
//
//   Editor:  offset = y * 100 + x, and y counts UPWARDS
//            (screen row = 99 - y, see screenRectForFootprintRect)
//   Sprites: x to the right, y DOWNWARDS, like the .gm1 tiles are laid out
//
// So the translation is gx = x, gy = 99 - y. Everything else follows from it.

(function exposeIsoGeometry(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.isoGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const GRID = 100;
  const HALF_W = 16;          // half a tile in game points
  const HALF_H = 8;

  // Editor offset -> grid coordinates of the item's top-left tile
  function gridFromOffset(offset) {
    const x = offset % GRID;
    const y = Math.floor(offset / GRID);
    return { gx: x, gy: (GRID - 1) - y };
  }

  function offsetFromGrid(gx, gy) {
    return ((GRID - 1) - gy) * GRID + gx;
  }

  // Screen point of a grid corner
  function isoPoint(gx, gy, view) {
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    return [view.panX + (gx - gy) * hw, view.panY + (gx + gy) * hh];
  }

  // The other way round: which tile is under a point on screen? Solving
  //   px = panX + (gx - gy) * hw
  //   py = panY + (gx + gy) * hh
  // for gx and gy. Returns null outside the grid.
  function tileFromPoint(px, py, view) {
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    const a = (px - view.panX) / hw;      // gx - gy
    const b = (py - view.panY) / hh;      // gx + gy
    const gx = Math.floor((a + b) / 2);
    const gy = Math.floor((b - a) / 2);
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return null;
    return { gx, gy };
  }

  // A point on screen straight into the editor's own tile coordinates
  function editorTileFromPoint(px, py, view) {
    const grid = tileFromPoint(px, py, view);
    if (!grid) return null;
    return { x: grid.gx, y: (GRID - 1) - grid.gy };
  }

  // What is further back has to be painted first. The measure is the lowest
  // corner of the item: an item of n tiles reaches n-1 further in both
  // directions.
  function depth(item) {
    return item.gx + item.gy + 2 * ((item.tiles || 1) - 1);
  }

  // Where a sprite goes: centred on the lowest tile, its bottom edge one
  // half tile below that tile's centre - the same rule the .gm1 files use.
  function spriteRect(sprite, gx, gy, tiles, view) {
    const [sx, sy] = isoPoint(gx + tiles - 1, gy + tiles - 1, view);
    const k = view.zoom;
    return {
      x: sx - (sprite.breite / 2) * k,
      y: sy - (sprite.hoehe - HALF_H * 2) * k,
      w: sprite.breite * k,
      h: sprite.hoehe * k
    };
  }

  // Every placed item of a castle document, ready to be sorted and drawn.
  function collectItems(document_, catalogue) {
    const out = [];
    if (!document_ || !Array.isArray(document_.frames)) return out;
    const items = (catalogue && catalogue.gegenstaende) || {};
    document_.frames.forEach((frame, frameIndex) => {
      const entry = items[String(frame.itemType)] || null;
      const offsets = Array.isArray(frame.tilePositionOfsets) ? frame.tilePositionOfsets : [];
      for (const offset of offsets) {
        const { gx, gy } = gridFromOffset(offset);
        out.push({
          gx, gy, entry, frameIndex,
          itemType: frame.itemType,
          tiles: entry ? entry.kacheln : 1
        });
      }
    });
    return out;
  }

  // Ground plates that belong next to an item (keep courtyard, training
  // grounds, guild yards). Their offsets are counted from the item's
  // top-left tile, in the sprite coordinate system.
  function collectPlates(items) {
    const out = [];
    for (const item of items) {
      const plates = (item.entry && item.entry.platten) || [];
      for (const plate of plates) {
        out.push({
          gx: item.gx + plate.dx,
          gy: item.gy + plate.dy,
          tiles: plate.kacheln,
          sprite: plate
        });
      }
    }
    return out;
  }

  function byDepth(a, b) { return depth(a) - depth(b); }

  // Zoom and offset so that the whole 100x100 grid fits into a box
  function fitView(width, height) {
    const zoom = Math.max(0.15, Math.min(width / (GRID * HALF_W * 2),
                                         height / (GRID * HALF_H * 2)) * 0.95);
    return { zoom, panX: width / 2, panY: height / 2 - GRID * HALF_H * zoom };
  }

  return { GRID, HALF_W, HALF_H, gridFromOffset, offsetFromGrid, isoPoint,
           tileFromPoint, editorTileFromPoint,
           depth, byDepth, spriteRect, collectItems, collectPlates, fitView };
});
