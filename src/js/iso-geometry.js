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

  // Eine Mauer hat kein festes Bild. Das Spiel rechnet jedes Feld neu, und
  // zwei Fragen entscheiden - beide beantwortet computeWallCornerRenderRotation
  // (0x004fc650):
  //
  //  1. LAEUFT die Mauer durch dieses Feld? Sie tut es, wenn BEIDE Nachbarn
  //     derselben Achse Mauer sind und keiner mehr als 16 Punkte niedriger
  //     ist (isWallConnectionHeightValid 0x004f8840). Laeuft sie in x, liegt
  //     das naechste Feld 16 Punkte rechts und verdeckt die rechte Haelfte -
  //     sichtbar bleibt die besonnte Seite. Laeuft sie in y, liegt es 16
  //     Punkte links, sichtbar bleibt die beschattete. Dafuer traegt der
  //     Katalog zwei Saetze Bilder: laengs und quer. Laeuft sie nicht durch,
  //     entscheidet allein, wer das Feld verdeckt: ein Nachbar in x nimmt
  //     die rechte Haelfte weg (rand.laengs), einer in y die linke
  //     (rand.quer), gar keiner nichts (rand.allein, der freistehende
  //     Pfeiler mit beiden Seiten). Im Spiel sind das 0x30, 0x3f und 0x21.
  //  2. WELCHES der sechzehn Bilder eines Satzes? Das sagt x & 15 bzw.
  //     y & 15, damit sich das Mauerwerk nicht alle paar Felder wiederholt.
  //
  // Die Krone wechselt unabhaengig davon: Klotz bei x + y ungerade, sonst die
  // flache Scharte - placeDefensiveStructureTile (0x005034a0) setzt dafuer
  // LogicLayer 0x400000. gy zaehlt den Bildschirm hinunter, darum wird die
  // Editor-Koordinate y zuerst zurueckgerechnet.
  //
  // mauerAn(gx, gy) liefert den Mauereintrag eines Nachbarfeldes oder null.
  // Fehlt er, bleibt es beim Einzelbild - die Ansicht sieht dann aus wie
  // vorher, statt zu bruchlanden.
  function variantFor(sprite, gx, gy, mauerAn) {
    if (!sprite) return sprite;
    const y = (GRID - 1) - gy;
    const klotz = (((gx + y) % 2) + 2) % 2 === 1;
    const mauer = sprite.mauer;
    if (!mauer) {
      if (!sprite.wechselBild || klotz) return sprite;
      return { bild: sprite.wechselBild, breite: sprite.wechselBreite,
               hoehe: sprite.wechselHoehe, kacheln: sprite.kacheln };
    }
    const welche = (klotz || !mauer.rand.allein.scharte) ? 'klotz' : 'scharte';
    let gewaehlt = mauer.rand.allein[welche];
    if (typeof mauerAn === 'function') {
      const traegt = (nx, ny) => {
        const nachbar = mauerAn(nx, ny);
        return !!nachbar && nachbar.hoehe >= mauer.hoehe - 16;
      };
      // Was VOR diesem Feld liegt, wird spaeter gemalt und verdeckt es zur
      // Haelfte: (gx+1, gy) nimmt die rechte, (gx, gy+1) die linke.
      if (traegt(gx - 1, gy) && traegt(gx + 1, gy)) gewaehlt = mauer.laengs[welche][gx & 15];
      else if (traegt(gx, gy - 1) && traegt(gx, gy + 1)) gewaehlt = mauer.quer[welche][y & 15];
      else if (traegt(gx + 1, gy)) gewaehlt = mauer.rand.laengs[welche];
      else if (traegt(gx, gy + 1)) gewaehlt = mauer.rand.quer[welche];
    }
    if (!gewaehlt) gewaehlt = mauer.rand.allein[welche];
    return { bild: gewaehlt.bild, breite: gewaehlt.breite,
             hoehe: gewaehlt.hoehe, kacheln: sprite.kacheln };
  }

  // Nachschlagewerk fuer die Regel oben: welches Feld traegt eine Mauer.
  // Aus den Gegenstaenden, die ohnehin schon eingesammelt sind.
  function wallLookup(items, extra) {
    const felder = new Map();
    const eintragen = (gx, gy, entry) => {
      if (entry && entry.mauer) felder.set(gx + ':' + gy, entry.mauer);
    };
    for (const item of items || []) eintragen(item.gx, item.gy, item.entry);
    for (const item of extra || []) eintragen(item.gx, item.gy, item.entry);
    return (gx, gy) => felder.get(gx + ':' + gy) || null;
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
  // Der Umriss eines Auswahlkastens in Iso-Punkten. Das Rechteck kommt in
  // Editor-Koordinaten, wo y nach OBEN zaehlt; hier wird es in das
  // Bildschirmsystem gedreht (gy = 99 - y) und um eine Kachel erweitert, weil
  // der Kasten die Felder umschliesst und nicht ihre Mittelpunkte.
  function marqueeOutline(box, view) {
    if (!box) return null;
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1) + 1;
    const yLow = Math.min(box.y0, box.y1), yHigh = Math.max(box.y0, box.y1);
    const gy0 = GRID - 1 - yHigh, gy1 = GRID - 1 - yLow + 1;
    return [[x0, gy0], [x1, gy0], [x1, gy1], [x0, gy1]].map(([gx, gy]) => isoPoint(gx, gy, view));
  }

  function collectItems(document_, catalogue) {
    const out = [];
    if (!document_ || !Array.isArray(document_.frames)) return out;
    const items = (catalogue && catalogue.gegenstaende) || {};
    document_.frames.forEach((frame, frameIndex) => {
      const entry = items[String(frame.itemType)] || null;
      const offsets = Array.isArray(frame.tilePositionOfsets) ? frame.tilePositionOfsets : [];
      offsets.forEach((offset, offsetIndex) => {
        const { gx, gy } = gridFromOffset(offset);
        out.push({
          gx, gy, entry, frameIndex, offsetIndex,
          // Derselbe Schluessel, den castle-editor.js fuer die Auswahl
          // vergibt (frameRefKey). Ohne ihn koennte die Ansicht nicht sagen,
          // welcher Gegenstand ausgewaehlt ist.
          ref: 'f:' + frameIndex + ':' + offsetIndex,
          itemType: frame.itemType,
          tiles: entry ? entry.kacheln : 1
        });
      });
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
           depth, byDepth, spriteRect, variantFor, wallLookup,
           collectItems, collectPlates, marqueeOutline, fitView };
});
