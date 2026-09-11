'use strict';
(() => {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, max) => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max;
  function validate(profile) {
    if (!object(profile) || !['buildings', 'resources', 'units', 'population', 'castle'].some(key => object(profile[key]))) {
      throw new Error('Expected a rebalancer profile with a buildings, resources, units, population or castle section.');
    }
    for (const section of ['buildings', 'resources']) {
      if (profile[section] !== undefined && !object(profile[section])) throw new Error(`Invalid ${section} section.`);
    }
    for (const [name, stats] of Object.entries(profile.buildings || {})) {
      if (!object(stats)) throw new Error(`Invalid building: ${name}`);
      if (stats.housing !== undefined && !integer(stats.housing, 2147483647)) throw new Error(`${name}: housing must be a non-negative integer.`);
      if (stats.cost !== undefined && (!Array.isArray(stats.cost) || stats.cost.length !== 5
          || !stats.cost.every(value => integer(value, 2147483647)))) {
        throw new Error(`${name}: cost must contain five non-negative integers (wood, stone, iron, pitch, gold).`);
      }
    }
    for (const [name, stats] of Object.entries(profile.resources || {})) {
      if (!object(stats)) throw new Error(`Invalid resource: ${name}`);
      if (stats.baseDelivery !== undefined && !integer(stats.baseDelivery, 255)) throw new Error(`${name}: delivery must fit a byte (0–255).`);
      if (stats.skirmishBonus !== undefined && typeof stats.skirmishBonus !== 'boolean') throw new Error(`${name}: skirmishBonus must be true or false.`);
    }
    // Preserve ALL sections: production, movement, fear and population matter too.
    return JSON.parse(JSON.stringify(profile));
  }
  const api = { validate };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.castleBalance = api;
})();
