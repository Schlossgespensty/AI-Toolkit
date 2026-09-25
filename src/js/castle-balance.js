'use strict';
(() => {
  const tr = (key, args) => (globalThis.toolkitI18n || require('./i18n')).t(key, args);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, max) => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max;
  function validate(profile) {
    if (!object(profile) || !['buildings', 'resources', 'units', 'population', 'castle'].some(key => object(profile[key]))) {
      throw new Error(tr('validation:balance_profile'));
    }
    for (const section of ['buildings', 'resources']) {
      if (profile[section] !== undefined && !object(profile[section])) throw new Error(tr('validation:balance_section', {section}));
    }
    for (const [name, stats] of Object.entries(profile.buildings || {})) {
      if (!object(stats)) throw new Error(tr('validation:balance_building', {name}));
      if (stats.health !== undefined && !integer(stats.health, 2147483647)) throw new Error(tr('validation:balance_health', {name}));
      if (stats.housing !== undefined && !integer(stats.housing, 2147483647)) throw new Error(tr('validation:balance_housing', {name}));
      if (stats.cost !== undefined && (!Array.isArray(stats.cost) || stats.cost.length !== 5
          || !stats.cost.every(value => integer(value, 2147483647)))) {
        throw new Error(tr('validation:balance_cost', {name}));
      }
    }
    for (const [name, stats] of Object.entries(profile.resources || {})) {
      if (!object(stats)) throw new Error(tr('validation:balance_resource', {name}));
      if (stats.baseDelivery !== undefined && !integer(stats.baseDelivery, 255)) throw new Error(tr('validation:balance_delivery', {name}));
      if (stats.skirmishBonus !== undefined && typeof stats.skirmishBonus !== 'boolean') throw new Error(tr('validation:balance_bonus', {name}));
    }
    if (profile.castle?.ditch_per_pitch !== undefined && ![1,2,3,4].includes(Number(profile.castle.ditch_per_pitch))) {
      throw new Error(tr('validation:balance_ditch'));
    }
    // Preserve ALL sections: production, movement, fear and population matter too.
    return JSON.parse(JSON.stringify(profile));
  }
  const api = { validate };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.castleBalance = api;
})();
