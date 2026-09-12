'use strict';
(() => {
  // Stronghold Heaven, Living by numbers parts 1–5 (Merepatra).
  // Approximate original-Stronghold observations, NOT measured Crusader engine
  // constants. 800 ticks/month is this editor's game-calendar conversion.
  // See docs/production-reference.md for batch, startup and transport limits.
  const MONTH = 800;
  const GOODS = {
    Wood: { base: 12, aic: 'wood', building: 'Woodcutter hut' }, Stone: { base: 8, aic: 'quarries', building: 'Quarry' },
    Iron: { base: 1, aic: 'iron', building: 'Iron mine' }, Pitch: { base: 1, aic: 'pitch', building: 'Pitch rig' },
    Meat: { base: 6, building: 'Hunters hut' }, Fruit: { base: 3, farm: 'AppleFarm', building: 'Apple farm' },
    Cheese: { base: 3, farm: 'DairyFarm', building: 'Dairy farm' }, Hop: { base: 2, farm: 'HopFarm', building: 'Hop farm' },
    Wheat: { base: 2, farm: 'WheatFarm', building: 'Wheat farm' }
  };
  const reference = {
    Wood: { work: 3*MONTH, speed: 100/3, sourceTrips: 3, deliveryTrips: 1 },
    Stone: { work: 12*MONTH/20, speed: 100/3, sourceTrips: 0, deliveryTrips: 0 },
    Iron: { work: 2*MONTH, speed: 33, sourceTrips: 0, deliveryTrips: 1, concurrent: true },
    Pitch: { work: 2*MONTH, speed: 50, sourceTrips: 0, deliveryTrips: 1 },
    Meat: { work: null, speed: null, sourceTrips: 1, deliveryTrips: 1 },
    Fruit: { work: 3*MONTH, speed: 50, sourceTrips: 0, deliveryTrips: 1 },
    Cheese: { work: 2*MONTH, startup: 3*MONTH, speed: 50, sourceTrips: 0, deliveryTrips: 1 },
    Hop: { work: 13*MONTH/4, speed: 50, sourceTrips: 0, deliveryTrips: 1 },
    Wheat: { work: 18*MONTH/12, speed: 100/3, sourceTrips: 0, deliveryTrips: 1 }
  };
  // Explicit itineraries: a leg is a one-way journey, not a resource count.
  // W = workshop, S = stockpile, D = delivery store, C = cow source.
  const recipes = {
    Bow: { work: 2*MONTH, speed: 25, path: ['W','S','W','S','W','D','W'], note: '2 wood; separate armoury return' },
    Crossbow: { work: 2*MONTH, speed: 25, path: ['W','S','W','S','W','S','W','D','W'], note: '3 wood; separate armoury return' },
    Spear: { work: null, speed: 25, path: ['W','D','S','W'], note: '1 wood; work time is only documented as less than 1 month' },
    Pike: { work: 2*MONTH, speed: 25, path: ['W','S','W','D','S','W'], note: '2 wood; collects first plank after armoury delivery' },
    Sword: { work: 2*MONTH, speed: 25, path: ['W','D','S','W'], note: '1 iron; collects next input after armoury delivery' },
    Mace: { work: 2*MONTH, speed: 25, path: ['W','D','S','W'], note: '1 iron; collects next input after armoury delivery' },
    Armour: { work: 2*MONTH, speed: 25, path: ['W','D','S','W'], note: '1 iron; collects next input after armoury delivery' },
    Leather: { work: null, speed: 25, path: ['W','C','W','D','W','D','W','D','W'], note: '3 deliveries per cow; each work time is only documented as less than 3 months' },
    Bread: { work: 2*MONTH, speed: 100/3, path: ['W','D','S','W'], note: '1 flour; granary then stockpile' },
    Ale: { work: 4*MONTH, speed: 25, path: ['W','S','W','S','W'], note: '1 hop; stockpile input and output' }
  };
  const defaults = { distance: 25, extraDistance: 5, stockpileDistance: 25, deliveryDistance: 25,
    storesDistance: 25, walkSpeedMultiplier: 1, productivity: 100, skirmish: true,
    workTicks: Object.fromEntries(Object.entries(reference).map(([g,r]) => [g,r.work])) };
  function settings(input = {}) {
    const number = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
    return { distance: number(input.distance, 25, 0, 1000), extraDistance: number(input.extraDistance, 5, 0, 1000),
      stockpileDistance: number(input.stockpileDistance, input.distance ?? 25, 0, 1000),
      deliveryDistance: number(input.deliveryDistance, input.distance ?? 25, 0, 1000),
      storesDistance: number(input.storesDistance, input.distance ?? 25, 0, 1000),
      walkSpeedMultiplier: number(input.walkSpeedMultiplier, 1, .1, 10),
      walkTicksOverride: number(input.walkTicksOverride, null, .01, 1000),
      productivity: number(input.productivity, 100, 100, 1000),
      skirmish: input.skirmish !== false,
      workTicks: Object.fromEntries(Object.keys(GOODS).map(g => [g, number(input.workTicks?.[g], reference[g].work, 1, 1000000)])) };
  }
  function restoreSettings(current, legacy) {
    if (current) return settings(current);
    if (!legacy) return settings();
    // The old 500-tick values were placeholders, not observations. Preserve
    // other user timings and distances, including a custom walking override.
    const workTicks = Object.fromEntries(Object.entries(legacy.workTicks || {}).filter(([,v]) => Number(v) !== 500));
    return settings({ ...legacy, workTicks,
      walkTicksOverride: Number(legacy.walkTicks) !== 4 ? legacy.walkTicks : null });
  }
  function cycleDetails(good, options, index = 0) {
    const opts = settings(options), r = reference[good];
    const ticksPerTile = opts.walkTicksOverride ?? (r.speed ? MONTH / r.speed / opts.walkSpeedMultiplier : null);
    const source = opts.distance + opts.extraDistance*index;
    const food = ['Meat', 'Fruit', 'Cheese'].includes(good);
    const store = (food ? opts.deliveryDistance : opts.stockpileDistance) + opts.extraDistance*index;
    const tiles = 2*r.sourceTrips*source + 2*r.deliveryTrips*store;
    const work = opts.workTicks[good];
    const travel = ticksPerTile == null ? null : tiles*ticksPerTile;
    return { work, tiles, travel, ticks: work == null || travel == null ? null : r.concurrent ? Math.max(work,travel) : work+travel,
      startup: r.startup || 0 };
  }
  function recipeCycle(name, options) {
    const opts=settings(options), r=recipes[name];
    if (!r) return null;
    const lengths={ SW:opts.stockpileDistance, DW:opts.deliveryDistance, DS:opts.storesDistance, CW:opts.distance };
    const legs=r.path.slice(1).map((to,i)=>({from:r.path[i],to,
      tiles:lengths[[r.path[i],to].sort().join('')] }));
    const tiles=legs.reduce((n,l)=>n+l.tiles,0), travel=tiles*(opts.walkTicksOverride ?? MONTH/r.speed/opts.walkSpeedMultiplier);
    return { legs, tiles, travel, work:r.work, ticks:r.work == null ? null : r.work+travel, note:r.note };
  }
  function delivery(good, profile, opts) {
    // Heaven's quarry rate is stone at the quarry, not an eight-stone ox load.
    // Rebalancer's Stone delivery changes transport; do not multiply quarry output.
    if (good === 'Stone') return { base:1, percent:100, average:1 };
    const override = profile?.resources?.[good];
    const base = override?.baseDelivery !== undefined ? Number(override.baseDelivery) : (good === 'Hop' && !opts.skirmish ? 1 : GOODS[good].base);
    // 0x00530D70 carries the fractional bonus per worker between deliveries.
    const percent = Math.max(100, opts.productivity) + (opts.skirmish && override?.skirmishBonus !== false ? 50 : 0);
    return { base, percent, average: base * percent / 100 };
  }
  function estimate({ frames, stepIndex, populationData, aicAt, aic, balance, options, costModel, data }) {
    if (!aic || typeof aicAt !== 'function') return null;
    const opts = settings(options);
    const count = Math.max(0, Math.min(frames.length, stepIndex == null ? frames.length : stepIndex + 1));
    const workers = Object.fromEntries(Object.keys(GOODS).map(g => [g, []]));
    let provided = 0;
    const placed = {};
    // Integrate each interval separately: a building made late cannot produce
    // retrospectively. Pauses, placement delay and actual population are unknown.
    for (let i = 0; i < count - 1; i++) {
      const frame = frames[i];
      provided += costModel.housingFor(frame.itemType, populationData, data, balance) * (frame.tilePositionOfsets?.length || 0);
      const name = data?.buildings?.[frame.itemType]?.balance;
      if (name) placed[name] = (placed[name] || 0) + (frame.tilePositionOfsets?.length || 0);
      const stats = aicAt(provided);
      const farms = costModel.farmAufteilung(aic, stats.farms)?.counts || {};
      for (const [good, info] of Object.entries(GOODS)) {
        const desired = Math.min(1000, Math.max(placed[info.building] || 0, Math.floor(Number(info.aic ? stats[info.aic] : farms[info.farm]) || 0)));
        for (let index = 0; index < desired; index++) {
          const details = cycleDetails(good,opts,index);
          const worker = workers[good][index] ||= { progress: -details.startup, cycles: 0 };
          const cycle = details.ticks;
          if (cycle == null) continue;
          worker.progress += 50;
          const completed = Math.max(0,Math.floor(worker.progress / cycle));
          worker.cycles += completed; worker.progress -= completed * cycle;
        }
      }
    }
    return Object.fromEntries(Object.entries(workers).map(([good, entries]) => {
      const batch = delivery(good, balance, opts);
      return [good, { produced: cycleDetails(good,opts).ticks == null ? null : entries.reduce((sum, worker) => sum + Math.floor(worker.cycles * batch.base * batch.percent / 100), 0),
        producers: entries.length, cycles: entries.reduce((sum, w) => sum + w.cycles, 0), delivery: batch.average }];
    }));
  }
  const api = { GOODS, defaults, reference, recipes, settings, restoreSettings, delivery, estimate, cycleDetails, recipeCycle };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.castleProduction = api;
})();
