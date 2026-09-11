(function (root, factory) {
  const camera = factory();
  if (typeof module === 'object' && module.exports) module.exports = camera;
  else root.castleCamera = camera;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const defaults = {
    wheel: 'legacy', left: '', right: '', up: '', down: '', panSpeed: 40
  };
  const arrows = {
    wheel: 'zoom', left: 'arrowleft', right: 'arrowright',
    up: 'arrowup', down: 'arrowdown', panSpeed: 40
  };
  const directions = ['left', 'right', 'up', 'down'];

  function normalizeKey(value) {
    const key = String(value || '').trim().toLowerCase();
    return /^(?:[a-z0-9]|arrow(?:left|right|up|down))$/.test(key) ? key : '';
  }

  function validate(candidate, toolShortcuts = {}) {
    const result = { ...defaults, ...candidate };
    if (!['legacy', 'zoom'].includes(result.wheel)) throw new Error('Choose a wheel mode.');
    if (!Number.isInteger(Number(result.panSpeed)) || result.panSpeed < 1 || result.panSpeed > 200) {
      throw new Error('Camera speed must be between 1 and 200 pixels.');
    }
    result.panSpeed = Number(result.panSpeed);
    const used = new Set(['c', 'x', ...Object.values(toolShortcuts).flat().filter(Boolean)]);
    for (const direction of directions) {
      const supplied = String(result[direction] || '').trim();
      const key = normalizeKey(supplied);
      if (supplied && !key) throw new Error('Camera keys must be letters, numbers or arrow keys.');
      if (key && used.has(key)) throw new Error(`The key ${key.toUpperCase()} is already assigned or reserved.`);
      if (key) used.add(key);
      result[direction] = key;
    }
    return result;
  }

  function keyDelta(event, preferences) {
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    const key = normalizeKey(event.key);
    if (!key) return null;
    const speed = preferences.panSpeed * (event.shiftKey ? 3 : 1);
    // Moving the camera right moves the image left, in screen coordinates.
    if (key === preferences.left) return { x: speed, y: 0 };
    if (key === preferences.right) return { x: -speed, y: 0 };
    if (key === preferences.up) return { x: 0, y: speed };
    if (key === preferences.down) return { x: 0, y: -speed };
    return null;
  }

  function wheelAction(event, preferences, legacyZoom = false) {
    if (preferences.wheel === 'legacy' && legacyZoom) return 'zoom';
    if (event.ctrlKey) return 'panX';
    if (event.altKey || (preferences.wheel === 'zoom' && !event.shiftKey)) return 'zoom';
    return 'panY';
  }

  return { defaults, arrows, directions, normalizeKey, validate, keyDelta, wheelAction };
});
