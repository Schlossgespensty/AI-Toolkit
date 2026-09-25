(function (root, factory) {
  const camera = factory(typeof module === 'object' && module.exports ? require('./castle-shortcuts') : root.castleShortcuts);
  if (typeof module === 'object' && module.exports) module.exports = camera;
  else root.castleCamera = camera;
})(typeof globalThis !== 'undefined' ? globalThis : this, shortcuts => {
  'use strict';
  const tr = (key, options) => (globalThis.toolkitI18n || require('./i18n')).t(key, options);

  const legacy = {
    wheel: 'legacy', left: '', right: '', up: '', down: '', panSpeed: 40
  };
  const arrows = {
    wheel: 'zoom', left: 'arrowleft', right: 'arrowright',
    up: 'arrowup', down: 'arrowdown', panSpeed: 40
  };
  const defaults = arrows;
  const directions = ['left', 'right', 'up', 'down'];

  function normalizeKey(value) {
    return shortcuts.normalize(value);
  }

  function validate(candidate, toolShortcuts = {}) {
    const result = { ...defaults, ...candidate };
    if (!['legacy', 'zoom'].includes(result.wheel)) throw new Error(tr('shortcuts:wheelMode'));
    if (!Number.isInteger(Number(result.panSpeed)) || result.panSpeed < 1 || result.panSpeed > 200) {
      throw new Error(tr('shortcuts:cameraSpeed'));
    }
    result.panSpeed = Number(result.panSpeed);
    const used = new Set(Object.values(toolShortcuts).flat().filter(Boolean));
    for (const direction of directions) {
      const supplied = String(result[direction] || '').trim();
      const key = normalizeKey(supplied);
      if (supplied && !key) throw new Error(tr('shortcuts:invalidCamera'));
      if (key && shortcuts.isReserved(key)) throw new Error(tr('shortcuts:reserved', { key: key.toUpperCase() }));
      if (key && (used.has(key) || used.has(`shift+${key}`))) throw new Error(tr('shortcuts:assigned', { key: key.toUpperCase() }));
      if (key) used.add(key);
      result[direction] = key;
    }
    return result;
  }

  function keyDelta(event, preferences) {
    let key = shortcuts.fromEvent(event);
    if (!key) return null;
    let fast = false;
    if (event.shiftKey && !directions.some(direction => preferences[direction] === key)) {
      key = shortcuts.fromEvent({key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey});
      fast = true;
    }
    const speed = preferences.panSpeed * (fast ? 3 : 1);
    // Moving the camera right moves the image left, in screen coordinates.
    if (key === preferences.left) return { x: speed, y: 0 };
    if (key === preferences.right) return { x: -speed, y: 0 };
    if (key === preferences.up) return { x: 0, y: speed };
    if (key === preferences.down) return { x: 0, y: -speed };
    return null;
  }

  function wheelAction(event, preferences) {
    if (event.ctrlKey) return 'panX';
    if (preferences.wheel === 'zoom' && event.altKey) return 'panY';
    if (event.altKey || (preferences.wheel === 'zoom' && !event.shiftKey)) return 'zoom';
    return 'panY';
  }

  return { defaults, legacy, arrows, directions, normalizeKey, validate, keyDelta, wheelAction };
});
