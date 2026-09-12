'use strict';
((root) => {
  const key = tuple => `${tuple[0]}:${tuple[1]}`;
  function range(trace, from, to) {
    return trace.frames.slice(Math.max(0, from), Math.min(trace.frames.length, to + 1));
  }
  function trails(frames, field, selected = '') {
    const paths = new Map();
    let previous = new Set();
    let previousTick = null;
    for (const frame of frames) {
      if (previousTick !== null && frame.tick !== previousTick + 1) previous = new Set();
      const current = new Set();
      for (const tuple of frame[field]) {
        const id = key(tuple);
        if (selected && id !== selected) continue;
        current.add(id);
        const line = paths.get(id) || { id, segments: [], tuple };
        if (!previous.has(id)) line.segments.push([]);
        const points = line.segments.at(-1);
        const x = field === 'workers' ? tuple[4] : tuple[2] / 8;
        const y = field === 'workers' ? tuple[5] : tuple[3] / 8;
        const height = field === 'workers' ? tuple[6] : tuple[4];
        const last = points.at(-1);
        if (!last || last.x !== x || last.y !== y || last.height !== height)
          points.push({ x, y, height, tick: frame.tick });
        line.tuple = tuple; paths.set(id, line);
      }
      previous = current;
      previousTick = frame.tick;
    }
    return [...paths.values()];
  }
  function fireOccupancy(frames) {
    const cells = new Map();
    for (const frame of frames) {
      const seen = new Set();
      for (const fire of frame.fires) {
        const x = Math.floor(fire[2] / 8), y = Math.floor(fire[3] / 8), id = `${x},${y}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const cell = cells.get(id) || { x, y, samples: 0 };
        cell.samples++; cells.set(id, cell);
      }
    }
    return [...cells.values()].map(c => ({ ...c, fraction: c.samples / Math.max(1, frames.length) }));
  }
  function workerSummary(frames, selected) {
    let previous = null, distance = 0;
    const unloads = [];
    for (const frame of frames) {
      const worker = frame.workers.find(w => key(w) === selected);
      if (!worker) { previous = null; continue; }
      if (previous && frame.tick === previous.tick + 1) {
        distance += Math.hypot(worker[4] - previous.worker[4], worker[5] - previous.worker[5]);
        if (previous.worker[10] > 0 && worker[10] === 0) {
          unloads.push({ tick: frame.tick, good: previous.worker[9], amount: previous.worker[10] });
        }
      }
      previous = { worker, tick: frame.tick };
    }
    const cycles = unloads.slice(1).map((u, i) => u.tick - unloads[i].tick);
    return { distance, unloads, cycles };
  }
  const api = { key, range, trails, fireOccupancy, workerSummary };
  if (typeof module !== 'undefined') module.exports = api;
  else root.simulationModel = api;
})(globalThis);
