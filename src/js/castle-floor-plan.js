// Colour assignment for "uniform" floor plans: every building is one flat
// colour so image editors can pick it with an eyedropper or magic wand.
// Each region keeps the average colour of its rendered sprite. Instances of a
// region step one brightness level around that colour (0, +1, -1, +2, ...), so
// a low tolerance picks one building and a higher one every building of that
// kind. Only kinds with the same base colour are moved apart, by TYPE_GAP
// levels; other colours are already distinct for the picker and only avoid
// sharing an exact colour.
(function (root, factory) {
  const floorPlan = factory();
  if (typeof module === 'object' && module.exports) module.exports = floorPlan;
  else root.castleFloorPlan = floorPlan;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TYPE_GAP = 10;
  const KEEP = 61, STOCKPILE = 52;

  // Building block and forecourt plates, from assets/aiv/iso/verzeichnis.json
  // ("platten"): [dx, dy, tiles], dx to the east, dy south of the top row.
  const FORECOURTS = Object.freeze({
    86: {size: 5, plates: [[5, 0, 5], [0, 5, 5], [5, 5, 5]]}, // Mercenary Post
    87: {size: 5, plates: [[5, 0, 5], [0, 5, 5], [5, 5, 5]]}, // Barracks
    88: {size: 5, plates: [[0, 5, 5]]}, // Engineering Guild
    89: {size: 5, plates: [[0, 5, 5]]}, // Tunnelors Guild
    180: {size: 4, plates: [[0, 4, 4]]}, // Oil Smelter
  });

  const square = (left, top, size) => ({left, right: left + size - 1, top, bottom: top - size + 1});

  // Split a placement's footprint into separately coloured regions: the
  // building itself and its forecourt. The keep's courtyard includes the
  // entrance row; its attached stockpile is coloured as a stockpile.
  function regions(type, rects) {
    type = Number(type);
    if (type === KEEP) {
      const keep = rects.filter(rect => rect.part === 'keep');
      const stockpile = rects.filter(rect => rect.part === 'stockpile');
      return [
        {key: String(KEEP), rects: keep.slice(0, 1)},
        {key: `${KEEP}:forecourt`, rects: keep.slice(1)},
        ...(stockpile.length ? [{key: String(STOCKPILE), rects: stockpile}] : []),
      ];
    }
    const layout = FORECOURTS[type];
    if (!layout || rects.length !== 1) return [{key: String(type), rects}];
    const {left, top} = rects[0];
    return [
      {key: String(type), rects: [square(left, top, layout.size)]},
      {key: `${type}:forecourt`, rects: layout.plates.map(([dx, dy, size]) => square(left + dx, top - dy, size))},
    ];
  }

  // Instance index -> brightness offset: 0, +1, -1, +2, -2, ...
  const offset = index => index % 2 ? (index + 1) / 2 : 0 - index / 2;

  // The levels around `base` used by `count` instances, kept inside 0..255 by
  // moving the whole band as little as possible. Very long bands flatten the
  // colour towards its grey so every level stays distinct.
  function fitBand(base, count) {
    const length = Math.max(1, Math.min(256, count));
    const low = -Math.floor((length - 1) / 2), high = Math.ceil((length - 1) / 2);
    const mean = (base[0] + base[1] + base[2]) / 3;
    const spread = Math.max(...base) - Math.min(...base), room = 256 - length;
    const scale = spread > room ? room / spread : 1;
    let centre = base.map(value => Math.round(mean + (value - mean) * scale));
    const shift = Math.max(0, -(Math.min(...centre) + low)) - Math.max(0, Math.max(...centre) + high - 255);
    centre = centre.map(value => value + shift);
    return {centre, low, high, length};
  }

  // Largest-channel difference between the closest colours of two bands.
  function bandDistance(a, b) {
    const d = [0, 1, 2].map(c => a.centre[c] - b.centre[c]);
    // Colours differ by d + k, with k = (offset in a) - (offset in b).
    const lowest = a.low - b.high, highest = a.high - b.low;
    const ideal = -(Math.max(...d) + Math.min(...d)) / 2;
    let best = Infinity;
    for (const k of [Math.floor(ideal), Math.ceil(ideal)]) {
      const step = Math.min(highest, Math.max(lowest, k));
      best = Math.min(best, Math.max(...d.map(value => Math.abs(value + step))));
    }
    return best;
  }

  const moved = (band, shift) => ({...band, centre: band.centre.map(value => value + shift)});

  // groups: [{key, base: [r, g, b], count, area}] -> Map(key -> index => [r, g, b]).
  // Groups covering more tiles keep their own colour first. Kinds with the
  // same base colour (all workshops, all forecourts) are spread in steps of
  // TYPE_GAP around it: 0, +gap, -gap, +2 gap, ... Any other kind stays as
  // close to its own colour as possible and only moves the few levels needed
  // not to share an exact colour with another kind.
  function assignColours(groups, gap = TYPE_GAP) {
    const placed = [], colours = new Map(), half = Math.max(1, Math.floor(gap / 2));
    const sameBase = (a, b) => a.every((value, c) => value === b[c]);
    const ordered = [...groups].sort((a, b) => (b.area ?? b.count) - (a.area ?? a.count) || b.count - a.count || String(a.key).localeCompare(String(b.key)));
    for (const group of ordered) {
      const base = group.base.map(Math.round), band = fitBand(base, group.count);
      const lowest = -(Math.min(...band.centre) + band.low), highest = 255 - (Math.max(...band.centre) + band.high);
      const shifts = [];
      for (let step = 0; step * gap <= 255 + half; step++) for (const sign of step ? [1, -1] : [1])
        for (let fine = 0; fine < half; fine++) for (const nudge of fine ? [1, -1] : [1]) shifts.push(sign * step * gap + nudge * fine);
      let chosen = 0, fewest = Infinity;
      for (const shift of shifts) {
        if (shift < lowest || shift > highest) continue;
        const candidate = moved(band, shift);
        const clashes = placed.filter(other => bandDistance(candidate, other) < (sameBase(base, other.base) ? half : 1)).length;
        if (clashes < fewest) { chosen = shift; fewest = clashes; }
        if (!clashes) break;
      }
      const final = {...moved(band, chosen), base};
      placed.push(final);
      colours.set(String(group.key), index => final.centre.map(value => value + offset(index % final.length)));
    }
    return colours;
  }

  return {TYPE_GAP, FORECOURTS, regions, offset, assignColours, bandDistance, fitBand};
});
