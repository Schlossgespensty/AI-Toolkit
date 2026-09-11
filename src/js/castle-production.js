'use strict';
(() => {
  // Delivery immediates from rebalancer/init.lua. Work/walk timings below are
  // deliberately editable planning assumptions, not extracted engine timings.
  const GOODS = {
    Wood: { base: 12, aic: 'wood', building: 'Woodcutter hut' }, Stone: { base: 8, aic: 'quarries', building: 'Quarry' },
    Iron: { base: 1, aic: 'iron', building: 'Iron mine' }, Pitch: { base: 1, aic: 'pitch', building: 'Pitch rig' },
    Meat: { base: 6, building: 'Hunters hut' }, Fruit: { base: 3, farm: 'AppleFarm', building: 'Apple farm' },
    Cheese: { base: 3, farm: 'DairyFarm', building: 'Dairy farm' }, Hop: { base: 2, farm: 'HopFarm', building: 'Hop farm' },
    Wheat: { base: 2, farm: 'WheatFarm', building: 'Wheat farm' }
  };
  const defaults = { distance: 25, extraDistance: 5, walkTicks: 4, productivity: 100,
    skirmish: true, workTicks: Object.fromEntries(Object.keys(GOODS).map(g => [g, 500])) };
  function settings(input = {}) {
    const number = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
    return { distance: number(input.distance, 25, 0, 1000), extraDistance: number(input.extraDistance, 5, 0, 1000),
      walkTicks: number(input.walkTicks, 4, .01, 1000), productivity: number(input.productivity, 100, 100, 1000),
      skirmish: input.skirmish !== false,
      workTicks: Object.fromEntries(Object.keys(GOODS).map(g => [g, number(input.workTicks?.[g], 500, 1, 1000000)])) };
  }
  function delivery(good, profile, opts) {
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
          const worker = workers[good][index] ||= { progress: 0, cycles: 0 };
          const distance = opts.distance + opts.extraDistance * index;
          const cycle = opts.workTicks[good] + 2 * distance * opts.walkTicks;
          worker.progress += 50;
          const completed = Math.floor(worker.progress / cycle);
          worker.cycles += completed; worker.progress -= completed * cycle;
        }
      }
    }
    return Object.fromEntries(Object.entries(workers).map(([good, entries]) => {
      const batch = delivery(good, balance, opts);
      return [good, { produced: entries.reduce((sum, worker) => sum + Math.floor(worker.cycles * batch.base * batch.percent / 100), 0),
        producers: entries.length, cycles: entries.reduce((sum, w) => sum + w.cycles, 0), delivery: batch.average }];
    }));
  }
  const api = { GOODS, defaults, settings, delivery, estimate };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.castleProduction = api;
})();
