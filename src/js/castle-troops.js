(function exposeTroops(root, factory) {
  const api = factory(typeof module === 'object' ? require('./castle-geometry') : root.castleGeometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.castleTroops = api;
})(globalThis, geometry => {
  'use strict';
  const types = Object.freeze({Engineer:1, EuropArcher:6, Crossbowman:7, Spearman:8,
    Pikeman:9, Maceman:10, Swordsman:11, Knight:12, Slave:13, Slinger:14,
    Assassin:15, ArabArcher:16, HorseArcher:17, ArabSwordsman:18, FireThrower:19});
  // These recruits have no classic AIV marker. Keep their allocation separate
  // from placeable marker IDs, even before an idle sprite is available.
  const recruitmentTypes = Object.freeze({...types, Monk:'monk', Tunneler:'tunneler'});
  const fields = Object.freeze(['DefTotal', 'DefWalls', ...Array.from({length:8}, (_,i)=>'DefUnit'+(i+1))]);
  const defensiveTypes = new Set(Object.values(types));
  // assignUnitToATribe: ranged and armoured defenders wait at the keep;
  // other recruited types without a matching AIV group wait at the campfire.
  const keepTypes = new Set([6,7,9,11,16,18,19]);
  const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0,Math.floor(Number(value))) : 0;
  // One unit per tile: centre first, then south and neighbours.
  const formation = Object.freeze([[0,0],[0,1],[1,0],[-1,0],[0,-1],[-1,1],[1,1],[-1,-1],[1,-1]]
    .map(position=>Object.freeze(position)));
  const standbyFormation = Object.freeze([...formation, ...[2,3].flatMap(radius=>{
    const ring=[];
    for (let y=-radius;y<=radius;y++) for (let x=-radius;x<=radius;x++) {
      if (Math.max(Math.abs(x),Math.abs(y))===radius) ring.push(Object.freeze([x,y]));
    }
    return ring;
  })]);
  const defenseKey = aic => aic ? JSON.stringify([...fields.map(key=>aic[key]),aic.lordType]) : '';

  /** @typedef {{type:number|string, count:number, ref:string,
   * offset?:number, destination?:'keep'|'campfire'|'lord'}} TroopGroup */

  // aiRecruitUnits visits the recruitment slots in order, stopping at the
  // first None. Quotient/remainder is the same cycle without simulating units.
  function defenseTotals(aic) {
    const slots = [], totals = new Map();
    if (!aic) return totals;
    for (let i=1;i<=8;i++) {
      const name = aic['DefUnit'+i];
      if (!name || name==='None') break;
      slots.push(Object.hasOwn(recruitmentTypes,name) ? recruitmentTypes[name] : String(name));
    }
    const budget = Math.min(nonnegative(aic.DefWalls), nonnegative(aic.DefTotal));
    if (!slots.length) return totals;
    const each = Math.floor(budget/slots.length), extra = budget%slots.length;
    slots.forEach((type,index) => totals.set(type,(totals.get(type)||0)+each+(index<extra ? 1 : 0)));
    return totals;
  }

  /** One immutable allocation plan, independent of sprite limits and geometry.
   * No character means one representative per marker, never an invented army.
   * @param {Array<{itemType:number,positionOfset:number}>} markers
   * @param {Record<string,unknown>|null} aic
   * @returns {ReadonlyArray<Readonly<TroopGroup>>}
   */
  function plan(markers, aic) {
    const counts = new Map(), next = new Map(), totals = defenseTotals(aic);
    for (const marker of markers) counts.set(Number(marker.itemType), (counts.get(Number(marker.itemType)) || 0)+1);
    /** @type {TroopGroup[]} */
    const groups = markers.map((marker, index) => {
      const type = Number(marker.itemType);
      const total = totals.get(type)||0, size = counts.get(type), ordinal = next.get(type)||0;
      next.set(type,ordinal+1);
      const count = !aic || !defensiveTypes.has(type) ? 1
        : Math.floor(total/size)+(ordinal<total%size ? 1 : 0);
      return {type, offset:Number(marker.positionOfset), count, ref:'u:'+index};
    });
    for (const [type,count] of totals) if (count && !counts.has(type)) {
      groups.push({type,count,ref:'standby:'+type,destination:keepTypes.has(type) ? 'keep' : 'campfire'});
    }
    if (aic?.lordType==='Europ' || aic?.lordType==='Arab') {
      groups.unshift({type:aic.lordType==='Arab' ? 'lord-arab' : 'lord-europ',count:1,ref:'lord',destination:'lord'});
    }
    return Object.freeze(groups.map(group=>Object.freeze(group)));
  }

  function createPlanner() {
    let previousKey, previous;
    return (markers, aic) => {
      const key = defenseKey(aic)+'|'+markers.map(m=>m.itemType+':'+m.positionOfset).join(',');
      if (key !== previousKey) { previous = plan(markers, aic); previousKey = key; }
      return previous;
    };
  }

  /** Distribute preview troops without changing their saved rally markers.
   * Reserve every original marker before adding neighbours, so one group cannot
   * displace another. Nine candidate tiles per AIV marker bounds the work; crowded
   * or unsupported tiles simply show fewer representatives.
   * Standby groups share a bounded 7x7 area around the keep/campfire, with at
   * most nine representatives per type. The allocation keeps the full count.
   * @template {{gx:number,gy:number,count:number,destination?:string}} T
   * @param {T[]} markers
   * @param {(x:number,y:number)=>number} support
   * @returns {Array<{marker:T,gx:number,gy:number,elevation:number}>}
   */
  function layout(markers, support) {
    const owners = new Map(), occupied = new Set(), result = [];
    const size = geometry.GRID_SIZE;
    for (const marker of markers) {
      const key = marker.gy*size+marker.gx;
      if (marker.count && !owners.has(key)) owners.set(key,marker);
    }
    for (const marker of markers) {
      if (!marker.count) continue;
      const elevation = support(marker.gx,marker.gy);
      let placed = 0;
      for (const [dx,dy] of marker.destination ? standbyFormation : formation) {
        const gx = marker.gx+dx, gy = marker.gy+dy, key = gy*size+gx;
        if (gx<0 || gy<0 || gx>=size || gy>=size || occupied.has(key)
            || (owners.has(key) && owners.get(key)!==marker)
            || support(gx,gy)!==elevation) continue;
        occupied.add(key);
        result.push({marker,gx,gy,elevation});
        if (++placed>=Math.min(9,marker.count)) break;
      }
    }
    return result;
  }

  // Build-step-sensitive support map. Call only when scene content changes,
  // using visible placements; never use the complete future castle topology.
  function supports(items, terrainHeight) {
    const surface = new Map();
    for (const item of items) {
      const height = geometry.structureHeight(item.itemType);
      if (height === null) continue;
      const size = item.tiles || 1;
      const elevation = terrainHeight(item.gx+size-1, item.gy+size-1) + height;
      for (let y=item.gy;y<item.gy+size;y++) for(let x=item.gx;x<item.gx+size;x++) {
        const key=y*geometry.GRID_SIZE+x;
        surface.set(key, Math.max(surface.get(key) ?? -Infinity, elevation));
      }
    }
    return (x,y) => surface.get(y*geometry.GRID_SIZE+x) ?? terrainHeight(x,y);
  }
  return {types, recruitmentTypes, fields, formation, defenseKey, defenseTotals, plan, createPlanner, layout, supports};
});
