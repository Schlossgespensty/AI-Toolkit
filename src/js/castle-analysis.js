'use strict';
(() => {
  const game = typeof module !== 'undefined' ? require('./castle-game-data') : globalThis.castleGameData;
  const geometry = typeof module !== 'undefined' ? require('./castle-geometry') : globalThis.castleGeometry;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function workerCount(p) {
    const count=p.workers ?? game.workers[Number(p.type)] ?? 0;
    return Number.isFinite(Number(count)) ? Math.max(0,Number(count)) : 0;
  }
  // AIV coordinates have north-positive Y. Start south, then turn clockwise
  // through west, north and east. Try side centres before the corner sweep.
  function entranceCandidates(rect, start = 0) {
    const {left:l,right:r,bottom:b,top:t}=rect;
    const cx=Math.floor((l+r)/2),cy=Math.floor((b+t)/2);
    const sides=[{x:cx,y:b-1,side:0},{x:l-1,y:cy,side:1},{x:cx,y:t+1,side:2},{x:r+1,y:cy,side:3}];
    const result=[];const seen=new Set();
    const add=c=>{const key=c.x+','+c.y;if(!seen.has(key)){seen.add(key);result.push(c);}};
    for(let i=0;i<4;i++)add(sides[(start+i)%4]);
    // Retain the executable's perimeter order for square footprints. Reflect X
    // because the AIV south-facing sweep runs towards west in north-positive Y.
    const width=r-l+1, native=width===t-b+1 ? game.entrances[width] : null;
    if(native) {
      for(const [dx,dy] of native) {
        let x=width-1-dx,y=dy;
        for(let turn=0;turn<start;turn++) [x,y]=[y,width-1-x];
        add({x:l+x,y:b+y,side:y<0?0:x<0?1:y>=width?2:3});
      }
      return result;
    }
    const edges=[[],[],[],[]];
    for(let x=r;x>=l;x--)edges[0].push({x,y:b-1,side:0});
    for(let y=b;y<=t;y++)edges[1].push({x:l-1,y,side:1});
    for(let x=l;x<=r;x++)edges[2].push({x,y:t+1,side:2});
    for(let y=t;y>=b;y--)edges[3].push({x:r+1,y,side:3});
    for(let i=0;i<4;i++)for(const c of edges[(start+i)%4])add(c);
    return result;
  }
  // Static, intact, same-owner castle topology. AIV carries placement types,
  // not the runtime walk/height/damage layers. Keep ground gate passages and
  // elevated decks separately, linking them at open gate endpoints.
  function routeTopology(placements, size = 100, terrain = null) {
    const count = size * size;
    const surfaces = Array.from({length: count}, (_,k) => terrain?.blocked?.[k] ? [] : [{ k, height:0, kind:'ground' }]);
    const inside = (x,y) => x >= 0 && y >= 0 && x < size && y < size;
    // A drawbridge is a walk surface above the moat, independent of build order.
    const layered=[...placements.filter(p=>Number(p.type)!==105),...placements.filter(p=>Number(p.type)===105)];
    for (const p of layered) for (const [ri, r] of p.rects.entries()) {
      if ([200,20,21].includes(Number(p.type))) continue;
      const t = Number(p.type);
      const stockpile=t===52 || r.part==='stockpile' || p.name==='Stockpile';
      const recruitment=(t===86 || t===87) && r.right-r.left===9 && r.top-r.bottom===9;
      let platformElevation=10;
      if(stockpile || recruitment) {
        let lo=Infinity,hi=-Infinity;
        for(let py=Math.max(0,r.bottom);py<=Math.min(size-1,r.top);py++)for(let px=Math.max(0,r.left);px<=Math.min(size-1,r.right);px++) {const h=Number(terrain?.heights?.[py*size+px])||0;lo=Math.min(lo,h);hi=Math.max(hi,h);}
        platformElevation=(Number.isFinite(p.baseHeight)?p.baseHeight:(Number.isFinite(lo)?Math.floor((lo+hi)/2):0))+(stockpile?10:0);
      }
      const wall = [25,46].includes(t);
      const tower = t >= 110 && t <= 114;
      const gate = t >= 144 && t <= 147;
      const stair = t >= 181 && t <= 186;
      for (let y = Math.max(0,r.bottom); y <= Math.min(size-1,r.top); y++)
        for (let x = Math.max(0,r.left); x <= Math.min(size-1,r.right); x++) {
          const k = y*size+x, tile = { k, ref:p.ref, type:t };
          if ((terrain?.hardBlocked?.[k] ?? terrain?.blocked?.[k]) && t !== 105) { surfaces[k]=[]; continue; }
          if (stockpile) {
            const cross=x===Math.floor((r.left+r.right)/2) || y===Math.floor((r.bottom+r.top)/2);
            surfaces[k]=cross?[{...tile,height:platformElevation-(Number(terrain?.heights?.[k])||0),kind:'stockpile'}]:[];
          }
          else if (recruitment) {
            // placeBarracks: one solid 5x5 building and three 5x5 gathering
            // grounds. Only each ground's central flag tile is occupied.
            const dx=x-r.left,dy=r.top-y;
            const building=dx<5 && dy<5;
            const flag=dx%5===2 && dy%5===2;
            surfaces[k]=building||flag?[]:[{...tile,height:platformElevation-(Number(terrain?.heights?.[k])||0),kind:'recruitment'}];
          }
          else if (t===61 && (ri>0 || r.part==='courtyard')) surfaces[k]=[{...tile,height:0,kind:'courtyard'}];
          else if ([98,99,105,166,169,175].includes(t)) surfaces[k]=[{...tile,height:0,kind:t===105?'bridge':'ground'}];
          else if (stair) surfaces[k] = [{...tile,height:geometry.structureHeight(t)+(terrain?.constructionLift?.[k]||0),kind:'stair'}];
          else if ([26,35].includes(t)) surfaces[k] = [];
          else if (wall) surfaces[k] = [{...tile,height:geometry.structureHeight(t)+(terrain?.constructionLift?.[k]||0),kind:'wall'}];
          else if (tower) surfaces[k] = [{...tile,height:geometry.structureHeight(t),kind:'tower'}];
          else if (gate) {
            surfaces[k] = [{...tile,height:geometry.structureHeight(t),kind:'deck'}];
            // updatePathLinkageTileMapRelatedToGates (499FA0): the two
            // passage endpoints lie on the central row/column (size / 2).
            const ns = t === 144 || t === 146;
            const corridor = ns ? x === Math.floor((r.left+r.right)/2) : y === Math.floor((r.bottom+r.top)/2);
            if (corridor && !p.closed) surfaces[k].push({...tile,height:0,kind:'passage',axis:ns?'y':'x',start:ns?r.bottom:r.left,end:ns?r.top:r.right});
          } else surfaces[k] = [];
        }
    }
    let id = 0;
    const nodes = surfaces.flat();
    for (const n of nodes) { n.id = id++; n.x = n.k%size; n.y = Math.floor(n.k/size); n.elevation=(Number(terrain?.heights?.[n.k])||0)+n.height; }
    const hardCorners = new Set(), fullWall = new Uint8Array(count);
    for (const p of placements) if ([25,26,35,46].includes(Number(p.type)))
      for (const r of p.rects) for(let y=Math.max(0,r.bottom);y<=Math.min(size-1,r.top);y++) for(let x=Math.max(0,r.left);x<=Math.min(size-1,r.right);x++) fullWall[y*size+x]=1;
    for (const p of placements) if ([25,26,35,46,176,177,301,305,306,307,308,310,311,312].includes(Number(p.type)))
      for (const r of p.rects) for(let y=r.bottom;y<=r.top;y++) for(let x=r.left;x<=r.right;x++)
        if(inside(x,y)) hardCorners.add(y*size+x);
    const isDeck = n => n.kind === 'tower' || n.kind === 'deck';
    const links = nodes.map(() => []);
    function connects(a,b,dx,dy) {
      for (const n of [a,b]) if (n.kind === 'passage') {
        const other=n===a?b:a;
        const coordinate=n.axis==='x'?other.x:other.y;
        const outside=coordinate<n.start || coordinate>n.end;
        if (!outside && ((n.axis === 'x' && dy) || (n.axis === 'y' && dx))) return false;
      }
      // placeWalls copies default terrain height, then adds the structure
      // offset (90/60 for walls, 80..0 for stairs). Compare that total for
      // every ordinary edge, including ground-to-wall and ground-to-stair.
      if(dx && dy && ((a.kind==='wall' && b.kind==='tower') || (b.kind==='wall' && a.kind==='tower')))return false;
      const ordinary=Math.abs(a.elevation-b.elevation)<=16;
      const other=isDeck(a)?b:a;
      const linkedDeck=(isDeck(a)||isDeck(b)) &&
        (isDeck(other)||other.kind==='wall'||other.kind==='stair');
      // Constructed platforms bridge their raw pre-construction ground;
      // their runtime flattening is not present in the source terrain layer.
      const platform=a.height===0 && b.height===0 &&
        ['courtyard','bridge'].some(kind=>a.kind===kind||b.kind===kind);
      if(!ordinary && !linkedDeck && !platform)return false;
      if (dx && dy) {
        // Elevated diagonal wall walks must remain connected. Do not let a
        // diagonal edge climb a tower from ordinary ground or skip a stair.
        if (a.kind === 'wall' && b.kind === 'wall') return true;
        if ((a.kind==='wall' && b.kind==='deck') || (b.kind==='wall' && a.kind==='deck'))return true;
        if (isDeck(a) && isDeck(b) && a.ref != null && a.ref === b.ref) return true;
        const stair=a.kind==='stair'?a:b.kind==='stair'?b:null;
        const other=stair===a?b:a;
        // Adjacent steps include diagonal neighbours. Explicit stair links
        // must not be discarded by the general elevated-diagonal guard.
        if(stair && (other.kind==='stair' || other.kind==='deck' ||
            (other.kind==='tower' && stair.type===186) || other.kind==='wall')) return true;
        if (!ordinary && !platform) return false;
        const sideA = a.y*size+b.x, sideB=b.y*size+a.x;
        // Ordinary building corners are walkable; never squeeze diagonally
        // between walls, or a wall and a negative fear building.
        if (hardCorners.has(sideA) && hardCorners.has(sideB)) return false;
        if (!surfaces[sideA].some(n=>n.height===0) && !surfaces[sideB].some(n=>n.height===0) && terrain?.blocked?.[sideA] && terrain?.blocked?.[sideB]) return false;
      }
      return true;
    }
    for (const a of nodes) for (const [dx,dy] of [...directions,[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const x=a.x+dx,y=a.y+dy;
      if (!inside(x,y)) continue;
      for (const b of surfaces[y*size+x]) if (connects(a,b,dx,dy))
        links[a.id].push({ to:b.id,cost:dx && dy ? Math.SQRT2 : 1 });
    }
    // Native gate endpoint linkage writes the same walk grid used by the roof.
    // Join our two display surfaces there; treating them as disconnected loses
    // the stair -> gate -> ground route. Closed gates have no passage nodes.
    for (const cells of surfaces) {
      const passage=cells.find(n=>n.kind==='passage');
      if(!passage)continue;
      const coordinate=passage.axis==='x'?passage.x:passage.y;
      if(coordinate!==passage.start && coordinate!==passage.end)continue;
      const roof=cells.find(n=>n.kind==='deck');
      if(roof){links[roof.id].push({to:passage.id,cost:0});links[passage.id].push({to:roof.id,cost:0});}
    }
    return { nodes,surfaces,links,fullWall };
  }
  function routes(placements, size = 100, terrain = null) {
    if(terrain?.padding>0) {
      const padding=terrain.padding, edge=size+2*padding;
      const shifted=placements.map(p=>({...p,rects:p.rects.map(r=>({...r,left:r.left+padding,right:r.right+padding,bottom:r.bottom+padding,top:r.top+padding}))}));
      const extended=routes(shifted,edge,{...terrain,padding:0});
      const point=p=>({...p,x:p.x-padding,y:p.y-padding});
      const result=extended.map(r=>({...r,entry:point(r.entry),path:r.path.map(point)}));
      result.walkability=new Uint8Array(size*size);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++)result.walkability[y*size+x]=extended.walkability[(y+padding)*edge+x+padding];
      return result;
    }
    const {nodes,surfaces,links,fullWall} = routeTopology(placements,size,terrain);
    const inside = ({x,y}) => x >= 0 && y >= 0 && x < size && y < size;
    const goalAt=(x,y)=>inside({x,y})?surfaces[y*size+x].find(n=>n.height===0 || ['stockpile','recruitment'].includes(n.kind)):null;
    const piles=placements.flatMap(p=>p.rects.filter(r=>Number(p.type)===52 || p.name==='Stockpile' || r.part==='stockpile').map(r=>({p,r})));
    // The keep-created first stockpile is the single delivery destination.
    // Later extensions provide walkways, never a closer replacement goal.
    const primary=piles.find(({r})=>r.part==='stockpile') || piles[0];
    const goals=[];
    if(primary) {
      const r=primary.r, preferred={x:r.left,y:Math.floor((r.bottom+r.top)/2)};
      const node=goalAt(preferred.x,preferred.y);
      if(node?.kind==='stockpile')goals.push(node);
    }
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
    const result=placements.filter(p=>workerCount(p)>0 && Number(p.type)!==52).map(p=>{
      const r=p.rects[0];
      let start=Number.isInteger(p.entranceSide)?((p.entranceSide%4)+4)%4:0;
      if(r.right-r.left===3 && r.top-r.bottom===3) {
        const wallAt=(x,y)=>inside({x,y}) && (surfaces[y*size+x].some(n=>['wall','deck','tower'].includes(n.kind)) || fullWall[y*size+x]);
        const full=[
          [0,1,2,3].every(i=>wallAt(r.left+i,r.bottom-1)),
          [0,1,2,3].every(i=>wallAt(r.left-1,r.bottom+i)),
          [0,1,2,3].every(i=>wallAt(r.left+i,r.top+1)),
          [0,1,2,3].every(i=>wallAt(r.right+1,r.bottom+i))
        ].findIndex(Boolean);
        if(full>=0)start=(full+2)%4;
      }
      const candidates=entranceCandidates(r,start);
      let entry,candidate;
      for(const c of candidates) {
        const node=goalAt(c.x,c.y);
        if(!node)continue;
        // determineBuildingEntranceFromKeepArea (41AF43..41AF7E) rejects
        // disconnected areas before accepting an entrance. Reuse the route
        // field instead of running another search for each candidate.
        if(!entry){entry=node;candidate=c;}
        if(Number.isFinite(distance[node.id])){entry=node;candidate=c;break;}
      }
      const marker=candidate || candidates.find(inside) || {x:r.left,y:r.bottom};
      const common={ref:p.ref,type:p.type,name:p.name,workers:workerCount(p),entry:{x:marker.x,y:marker.y,side:marker.side,...(entry?.height?{height:entry.height}:{})},path:[]};
      if(!entry)return {...common,reason:'Entrance blocked on all sides'};
      if(!Number.isFinite(distance[entry.id]))return {...common,reason:!goals.length?'First stockpile delivery point is blocked or missing':'Entrance has no walkable route to the first stockpile'};
      const path=[];
      for(let n=entry.id;n>=0;n=next[n])path.push({x:nodes[n].x,y:nodes[n].y,height:nodes[n].height});
      const direct=Math.min(...goals.map(g=>Math.hypot(g.x-entry.x,g.y-entry.y)));
      const d=distance[entry.id];
      return {...common,path,distance:d,efficiency:d?direct/d:1};
    });
    result.walkability=Uint8Array.from(surfaces,cells=>(cells.some(n=>n.height===0 || ['stockpile','recruitment'].includes(n.kind))?1:0)+(cells.some(n=>n.height>0 && !['stockpile','recruitment'].includes(n.kind))?2:0));
    return result;
  }
  // User-selected planning ranges, not engine probabilities. Distance is from
  // the actual footprint boundary, so even-sized and multipart buildings do
  // not acquire a half-tile centre offset. Smoothstep has no hard outer edge.
  // Store normalized proximity so overlapping halos retain the nearest source.
  // Static HP proxy: 800 HP reaches the requested eight-tile ceiling.
  // Square-root scaling keeps fragile sources useful without giving them a full halo.
  function fireRadius(placement) {
    const hp = Number(placement.health ?? game.health[placement.name] ?? 800);
    return 2 + 6 * Math.sqrt(Math.min(1, Math.max(0, Number.isFinite(hp) ? hp : 800) / 800));
  }
  function fireStrength(distance, radius = 8) {
    const d = Math.max(0, distance);
    const scaled = d <= 1.5 ? d : 1.5 + (d - 1.5) * 6.5 / (radius - 1.5);
    return Math.max(0, 1 - scaled / 8);
  }
  function fireColor(strength) {
    if (!(strength>0)) return [0,0,0,0];
    const d=(1-Math.min(1,strength))*8;
    const stops=[[0,220,20,60,189],[1.5,220,20,60,189],[3.5,255,235,20,153],[6,25,45,160,108],[7,15,25,100,90],[8,15,25,100,0]];
    let i=1;while(i<stops.length-1 && d>stops[i][0])i++;
    const a=stops[i-1],b=stops[i],t=(d-a[0])/(b[0]-a[0]),f=t*t*(3-2*t);
    return a.slice(1).map((v,j)=>Math.round(v+(b[j+1]-v)*f));
  }
  function fireExposure(placements, size = 100) {
    const heat = new Float32Array(size*size);
    for (const p of placements) {
      if (!(game.flammability[p.name] > 0)) continue;
      const radius = fireRadius(p);
      for (const r of p.rects) {
        for(let y=Math.max(0,r.bottom-8);y<=Math.min(size-1,r.top+8);y++)
          for(let x=Math.max(0,r.left-8);x<=Math.min(size-1,r.right+8);x++) {
            const dx=Math.max(r.left-x-.5,0,x-r.right-.5);
            const dy=Math.max(r.bottom-y-.5,0,y-r.top-.5);
            const strength=fireStrength(Math.hypot(dx,dy), radius);
            heat[y*size+x]=Math.max(heat[y*size+x],strength);
          }
      }
    }
    return heat;
  }
  const api = { workerCount, entranceCandidates, routeTopology, routes, fireRadius, fireStrength, fireColor, fireExposure };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.castleAnalysis = api;
})();
