'use strict';
(() => {
  const game = typeof module !== 'undefined' ? require('./castle-game-data') : window.castleGameData;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  // First-pass candidates from setupBuildingEntrancesOffset(size, 1, attempt, 0).
  // The game starts at a saved attempt and checks region/height flags. AIV has
  // neither; this planner starts at zero and accepts the first reachable tile.
  function entranceCandidates(rect, start = 0) {
    const size = rect.right - rect.left + 1;
    if (size !== rect.top - rect.bottom + 1) return [];
    const table = game.entrances[size];
    if (!table) return [];
    return table.map((_, i) => table[(i + start) % table.length])
      .map(([x, y]) => ({ x: rect.left + x, y: rect.top - y }));
  }
  function routes(placements, size = 100) {
    const blocked = new Uint8Array(size * size);
    const inside = ({ x, y }) => x >= 0 && y >= 0 && x < size && y < size;
    const key = p => p.y * size + p.x;
    // Stockpile tiles are walkable. Gate passage, height and terrain are not
    // encoded by this AIV-only model; conservative obstacles are intentional.
    for (const p of placements) if (p.name !== 'Stockpile') for (const r of p.rects) {
      for (let y = Math.max(0, r.bottom); y <= Math.min(size - 1, r.top); y++)
        for (let x = Math.max(0, r.left); x <= Math.min(size - 1, r.right); x++) blocked[y * size + x] = 1;
    }
    const stores = placements.filter(p => p.name === 'Stockpile');
    const goals = stores.flatMap(p => p.rects.flatMap(r => {
      const cells = [];
      for (let y = r.bottom; y <= r.top; y++) for (let x = r.left; x <= r.right; x++) cells.push({ x, y });
      return cells;
    })).filter(p => inside(p) && !blocked[key(p)]);
    const distance = new Int32Array(size * size).fill(-1);
    const next = new Int32Array(size * size).fill(-1);
    const queue = [];
    for (const p of goals) { const k = key(p); if (distance[k] < 0) { distance[k] = 0; queue.push(k); } }
    // Cardinal BFS measures layout detours, not the engine's dynamic pathfinder.
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head], x = k % size, y = Math.floor(k / size);
      for (const [dx, dy] of directions) {
        const p = { x: x + dx, y: y + dy };
        if (!inside(p)) continue;
        const n = key(p);
        if (blocked[n] || distance[n] >= 0) continue;
        distance[n] = distance[k] + 1; next[n] = k; queue.push(n);
      }
    }
    return placements.filter(p => p.worker && p.name !== 'Stockpile').map(p => {
      const candidates = entranceCandidates(p.rects[0]);
      const entry = candidates.find(c => inside(c) && distance[key(c)] >= 0);
      if (!entry) return { ref: p.ref, name: p.name, path: [], reason: !goals.length ? 'No stockpile' : 'No reachable first-pass entrance' };
      const path = [];
      for (let k = key(entry); k >= 0; k = next[k]) path.push({ x: k % size, y: Math.floor(k / size) });
      const direct = Math.min(...goals.map(g => Math.abs(g.x - entry.x) + Math.abs(g.y - entry.y)));
      return { ref: p.ref, name: p.name, entry, path, distance: path.length - 1,
        efficiency: path.length <= 1 ? 1 : direct / (path.length - 1) };
    });
  }
  let kernel;
  function fireKernel() {
    if (kernel) return kernel;
    // Relative exposure from two generations (sustained intensity 3 -> 2 -> 1).
    // Uniform RNG samples are a planning assumption, NOT ignition probabilities.
    // Preserve microtile coordinates until the end, as IgniteFireAtMiniTile does.
    let wave = new Map([['0,0', 1]]);
    const heat = new Map();
    for (let hop = 0; hop < 2; hop++) {
      const next = new Map();
      for (const [key, weight] of wave) {
        const [x, y] = key.split(',').map(Number);
        for (const [dx, dy] of directions) for (const [jx, jy] of game.fireJitter) {
          const nx = x + dx * 8 + jx, ny = y + dy * 8 + jy;
          const k = `${nx},${ny}`, w = weight / 256;
          next.set(k, (next.get(k) || 0) + w);
        }
      }
      for (const [key, weight] of next) {
        const [x, y] = key.split(',').map(Number);
        const k = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
        heat.set(k, (heat.get(k) || 0) + weight);
      }
      wave = next;
    }
    const max = Math.max(...heat.values());
    kernel = [...heat].map(([key, value]) => { const [x, y] = key.split(',').map(Number); return { x, y, intensity: value / max }; });
    return kernel;
  }
  function fireExposure(placements, size = 100) {
    const heat = new Map();
    for (const p of placements) {
      if (!(game.flammability[p.name] > 0)) continue;
      for (const r of p.rects) for (let sy = r.bottom; sy <= r.top; sy++) for (let sx = r.left; sx <= r.right; sx++) {
        for (const cell of fireKernel()) {
          const x = sx + cell.x, y = sy - cell.y;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const k = y * size + x;
          heat.set(k, Math.max(heat.get(k) || 0, cell.intensity));
        }
      }
    }
    return [...heat].map(([key, intensity]) => ({ x: key % size, y: Math.floor(key / size), intensity }));
  }
  const api = { entranceCandidates, routes, fireKernel, fireExposure };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.castleAnalysis = api;
})();
