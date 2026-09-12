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
  // Static, intact, same-owner castle topology. AIV carries placement types,
  // not the runtime walk/height/damage layers. Keep ground gate passages and
  // elevated decks separate so an open gate never becomes a staircase.
  function routeTopology(placements, size = 100) {
    const count = size * size;
    const surfaces = Array.from({length: count}, (_,k) => [{ k, height:0, kind:'ground' }]);
    const inside = (x,y) => x >= 0 && y >= 0 && x < size && y < size;
    for (const p of placements) for (const r of p.rects) {
      const t = Number(p.type);
      const wall = [25,46].includes(t);
      const tower = t >= 110 && t <= 114;
      const gate = t >= 144 && t <= 147;
      const stair = t >= 181 && t <= 186;
      for (let y = Math.max(0,r.bottom); y <= Math.min(size-1,r.top); y++)
        for (let x = Math.max(0,r.left); x <= Math.min(size-1,r.right); x++) {
          const k = y*size+x, tile = { k, ref:p.ref };
          if (p.name === 'Stockpile' || t === 99) surfaces[k] = [{...tile,height:0,kind:'ground'}];
          else if (stair) surfaces[k] = [{...tile,height:(186-t)*16,kind:'stair'}];
          else if (wall) surfaces[k] = [{...tile,height:t===46?60:90,kind:'wall'}];
          else if (tower) surfaces[k] = [{...tile,height:[296,148,180,192,192][t-110],kind:'tower'}];
          else if (gate) {
            surfaces[k] = [{...tile,height:90,kind:'deck'}];
            // updatePathLinkageTileMapRelatedToGates (499FA0): the two
            // passage endpoints lie on the central row/column (size / 2).
            const ns = t === 144 || t === 146;
            const corridor = ns ? x === Math.floor((r.left+r.right)/2) : y === Math.floor((r.bottom+r.top)/2);
            if (corridor && !p.closed) surfaces[k].push({...tile,height:0,kind:'passage',axis:ns?'y':'x'});
          } else surfaces[k] = [];
        }
    }
    let id = 0;
    const nodes = surfaces.flat();
    for (const n of nodes) { n.id = id++; n.x = n.k%size; n.y = Math.floor(n.k/size); }
    const isDeck = n => n.kind === 'tower' || n.kind === 'deck';
    const links = nodes.map(() => []);
    function connects(a,b,dx,dy) {
      for (const n of [a,b]) if (n.kind === 'passage') {
        if ((n.axis === 'x' && dy) || (n.axis === 'y' && dx) || b.height !== a.height) return false;
      }
      // The engine has explicit intact tower/wall/stair linkage. In
      // particular Stair 6 (zero height) may enter a tower directly.
      if (isDeck(a) || isDeck(b)) {
        const other = isDeck(a) ? b : a;
        if (!(isDeck(other) || other.kind === 'wall' || other.kind === 'stair')) return false;
      } else if (Math.abs(a.height-b.height) > 16) return false;
      if (dx && dy) {
        // Elevated diagonal wall walks must remain connected. Do not let a
        // diagonal edge climb a tower from ordinary ground or skip a stair.
        if (a.kind === 'wall' && b.kind === 'wall') return true;
        if (isDeck(a) && isDeck(b) && a.ref != null && a.ref === b.ref) return true;
        return false;
      }
      return true;
    }
    for (const a of nodes) for (const [dx,dy] of [...directions,[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const x=a.x+dx,y=a.y+dy;
      if (!inside(x,y)) continue;
      for (const b of surfaces[y*size+x]) if (connects(a,b,dx,dy))
        links[a.id].push({ to:b.id,cost:dx && dy ? Math.SQRT2 : 1 });
    }
    return { nodes,surfaces,links };
  }
  function routes(placements, size = 100) {
    const {nodes,surfaces,links} = routeTopology(placements,size);
    const inside = ({x,y}) => x >= 0 && y >= 0 && x < size && y < size;
    const goals = placements.filter(p => p.name === 'Stockpile').flatMap(p => p.rects.flatMap(r => {
      const cells=[];
      for (let y=r.bottom;y<=r.top;y++) for(let x=r.left;x<=r.right;x++)
        if(inside({x,y})) cells.push(...surfaces[y*size+x].filter(n=>n.height===0 && n.kind==='ground'));
      return cells;
    }));
    const distance = new Float64Array(nodes.length).fill(Infinity);
    const next = new Int32Array(nodes.length).fill(-1);
    // Dijkstra, because diagonal wall walks are sqrt(2) tiles long.
    const heap=[];
    function push(id,d) {
      let i=heap.length; heap.push({id,d});
      while(i) { const parent=(i-1)>>1; if(heap[parent].d<=d) break;heap[i]=heap[parent];i=parent; }
      heap[i]={id,d};
    }
    function pop() {
      const first=heap[0],last=heap.pop();
      if(heap.length) {
        let i=0;
        while(i*2+1<heap.length) {
          let c=i*2+1;if(c+1<heap.length && heap[c+1].d<heap[c].d)c++;
          if(heap[c].d>=last.d)break;heap[i]=heap[c];i=c;
        }
        heap[i]=last;
      }
      return first;
    }
    for(const g of goals)if(distance[g.id]!==0){distance[g.id]=0;push(g.id,0);}
    while(heap.length) {
      const {id,d}=pop();if(d!==distance[id])continue;
      for(const edge of links[id]) {
        const nd=d+edge.cost;
        if(nd>=distance[edge.to])continue;
        distance[edge.to]=nd;next[edge.to]=id;push(edge.to,nd);
      }
    }
    return placements.filter(p=>p.worker && p.name!=='Stockpile').map(p=>{
      const candidates=entranceCandidates(p.rects[0]);
      let entry;
      for(const c of candidates) {
        if(!inside(c))continue;
        entry=surfaces[c.y*size+c.x].find(n=>n.height===0 && Number.isFinite(distance[n.id]));
        if(entry)break;
      }
      if(!entry)return {ref:p.ref,name:p.name,path:[],reason:!goals.length?'No stockpile':'No reachable first-pass entrance'};
      const path=[];
      for(let n=entry.id;n>=0;n=next[n])path.push({x:nodes[n].x,y:nodes[n].y,height:nodes[n].height});
      const direct=Math.min(...goals.map(g=>Math.hypot(g.x-entry.x,g.y-entry.y)));
      const d=distance[entry.id];
      return {ref:p.ref,name:p.name,entry:{x:entry.x,y:entry.y},path,distance:d,efficiency:d?direct/d:1};
    });
  }
  const fireKernels = new Map();
  function fireKernel(mode = 'initial') {
    if (fireKernels.has(mode)) return fireKernels.get(mode);
    const heat = new Map();
    const add = (x, y, strength) => {
      // Coordinates are relative to an interior map tile, NOT the map origin.
      // floor(relative / 8) equals trunc((positive map origin + relative) / 8)
      // minus that origin. Village coordinates 0 are not world coordinates 0.
      const k = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
      heat.set(k, Math.max(heat.get(k) || 0, strength));
    };
    if (mode === 'reheated') {
      // Conservative envelope: allow any microtile phase in a source tile and
      // two remaining generations at intensity 3. This is NOT a prediction of
      // available direction counters or re-ignition timing in a running game.
      let wave = new Set();
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) wave.add(`${x},${y}`);
      for (let hop = 0; hop < 2; hop++) {
        const next = new Set();
        for (const k of wave) {
          const [x,y] = k.split(',').map(Number);
          for (const [dx,dy] of directions) for (const [jx,jy] of game.fireJitter) {
            const nx = x + 8*dx + jx, ny = y + 8*dy + jy;
            next.add(`${nx},${ny}`); add(nx,ny,hop === 0 ? .45 : .12);
          }
        }
        wave = next;
      }
    } else {
      // igniteBuilding (41C810): size² row-major seeds at tile*8, intensity 2.
      // IgniteFireAtMiniTile adds jitter BEFORE saving the seed's microposition.
      // UpdateFireEntity then makes four directional attempts, intensity 2 -> 1.
      for (const [sx,sy] of game.fireJitter) {
        add(sx,sy,.85);
        for (const [dx,dy] of directions) for (const [jx,jy] of game.fireJitter)
          add(sx + 8*dx + jx,sy + 8*dy + jy,.35);
      }
    }
    const cells = [...heat].map(([key,intensity]) => {
      const [x,y] = key.split(',').map(Number);
      return { x,y,intensity };
    });
    fireKernels.set(mode,cells);
    return cells;
  }
  function fireExposure(placements, size = 100, mode = 'initial') {
    const heat = new Map();
    for (const p of placements) {
      if (!(game.flammability[p.name] > 0)) continue;
      // Preserve the actual corner/extent, including even-sized footprints.
      // Do not recenter on a rounded midpoint or substitute a circular radius.
      for (const r of p.rects) for (let sy = r.bottom; sy <= r.top; sy++) for (let sx = r.left; sx <= r.right; sx++) {
        for (const cell of fireKernel(mode)) {
          const x = sx + cell.x, y = sy - cell.y;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const k = y * size + x;
          heat.set(k, Math.max(heat.get(k) || 0, cell.intensity));
        }
      }
    }
    // Intensity distinguishes source/propagation bands, never probabilities.
    return [...heat].map(([key, intensity]) => ({ x: key % size, y: Math.floor(key / size), intensity }));
  }
  const api = { entranceCandidates, routeTopology, routes, fireKernel, fireExposure };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.castleAnalysis = api;
})();
