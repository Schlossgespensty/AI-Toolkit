(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.castleShortcuts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const tr = (key, options) => (globalThis.toolkitI18n || require('./i18n')).t(key, options);
  // Order follows the toolbar, then its submenus and additional editing actions.
  const actions = [
    ['openCastle', "shortcuts:openCastle", 'ctrl+o', 'castleOpenBtn'],
    ['saveCastle', "shortcuts:saveCastle", 'ctrl+s', 'castleSaveBtn'],
    ['newCastle', "shortcuts:newCastle", 'ctrl+n', 'castleNewBtn'],
    ['map', "shortcuts:map", 'alt+m', 'castleMapBtn'], ['iso', "shortcuts:iso", 'alt+i', 'castleIsoBtn'],
    ['single', "shortcuts:single", '1'], ['line', "shortcuts:line", '2'], ['brush', "shortcuts:brush", '3'],
    ['brushSmaller', "shortcuts:brushSmaller", '-', 'castleBrushMinus'],
    ['brushLarger', "shortcuts:brushLarger", 'plus', 'castleBrushPlus'],
    ['bucket', "shortcuts:bucket", '4'], ['select', "shortcuts:select", '5'],
    ['replace', "shortcuts:replace", 'r'], ['merge', "shortcuts:merge", 'm'], ['delete', "shortcuts:delete", 'd'],
    ['overlays', "shortcuts:overlays", 'o'], ['groups', "shortcuts:groups", 'g'],
    ['paste', "shortcuts:paste", 'ctrl+v'], ['clearClipboard', "shortcuts:clearClipboard", 'ctrl+shift+delete', 'castleClipboardClearBtn'],
    ['names', "shortcuts:names", 'n', 'castleShowNames'], ['units', "shortcuts:units", 'u', 'castleShowUnitNumbers'],
    ['guides', "shortcuts:guides", 'h', 'castleShowCompatibility'], ['paths', "shortcuts:paths", 'p', 'castleShowRoutes'],
    ['fire', "shortcuts:fire", 'f', 'castleShowFire'],
    ['gameMap', "shortcuts:gameMap", 'ctrl+m', 'castleIsoMapBtn'], ['resetMap', "shortcuts:resetMap", 'ctrl+shift+m', 'castleIsoMapReset'],
    ['rotateLeft', "shortcuts:rotateLeft", 'c'], ['rotateRight', "shortcuts:rotateRight", 'x'],
    ['saveAs', "shortcuts:saveAs", 'ctrl+shift+s'], ['undo', "shortcuts:undo", 'ctrl+z'], ['redo', "shortcuts:redo", 'ctrl+y'],
    ['copy', "shortcuts:copy", 'ctrl+c'], ['cut', "shortcuts:cut", 'ctrl+x'],
    ['exportDe', "shortcuts:exportDe", 'ctrl+shift+e', 'castleExportDeBtn'],
    ['pause', "shortcuts:pause", '0', 'castlePauseBtn'],
    ['deleteSelected', "shortcuts:deleteSelected", 'delete'], ['deselect', "shortcuts:deselect", 'escape']
  ];
  const defaults = Object.fromEntries(actions.map(([id, , key]) => [id, [key]]));
  const reserved = new Set(['ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+shift+n', 'ctrl+shift+o',
    'ctrl+r', 'ctrl+shift+r', 'ctrl+shift+i', 'ctrl+0', 'ctrl+-', 'ctrl+=', 'ctrl+plus',
    'alt+f', 'alt+e', 'alt+v', 'alt+f4', 'f10', 'f11']);
  function normalize(value) {
    const parts = String(value || '').trim().toLowerCase().replace(/commandorcontrol|cmdorctrl|control|meta|cmd/g, 'ctrl').split('+');
    const key = parts.pop();
    if (!/^(?:[a-z0-9\[\],.\/;='`\\-]|f(?:[1-9]|1[0-2])|arrow(?:left|right|up|down)|delete|backspace|escape|enter|space|tab|plus)$/.test(key)) return '';
    if (parts.some(part => !['ctrl', 'alt', 'shift'].includes(part)) || new Set(parts).size !== parts.length) return '';
    return [...['ctrl', 'alt', 'shift'].filter(part => parts.includes(part)), key].join('+');
  }
  function fromEvent(event) {
    let key = String(event.key || '').toLowerCase();
    if (key === ' ') key = 'space';
    if (key === '+') key = 'plus';
    return normalize([...(event.ctrlKey || event.metaKey || event.control || event.meta ? ['ctrl'] : []),
      ...(event.altKey || event.alt ? ['alt'] : []), ...(event.shiftKey || event.shift ? ['shift'] : []), key].join('+'));
  }
  function validate(candidate) {
    const result = {}, used = new Set();
    for (const [id, label] of actions) {
      if (Object.hasOwn(candidate || {}, id) && !Array.isArray(candidate[id])) throw new Error(tr('shortcuts:invalid', { label: tr(label) }));
      const value = Object.hasOwn(candidate || {}, id) ? candidate[id]?.[0] : defaults[id][0];
      const key = normalize(value);
      if (value && !key) throw new Error(tr('shortcuts:invalid', { label: tr(label) }));
      if (key && reserved.has(key)) throw new Error(tr('shortcuts:reserved', { key: key.toUpperCase() }));
      if (key && used.has(key)) throw new Error(tr('shortcuts:duplicate', { key: key.toUpperCase() }));
      if (key) used.add(key);
      result[id] = [key];
    }
    return result;
  }
  function migrate(old) {
    const result = JSON.parse(JSON.stringify(defaults));
    const used = new Set(Object.values(result).flat().filter(Boolean));
    // Native File/Edit shortcuts take priority over old tool aliases.
    for (const id of ['single', 'line', 'brush', 'bucket', 'select', 'replace', 'merge', 'delete']) {
      const key = normalize(old?.[id]?.[0]);
      const previous = result[id][0];
      used.delete(previous);
      if (key && !reserved.has(key) && !used.has(key)) result[id] = [key];
      if (result[id][0]) used.add(result[id][0]);
    }
    return validate(result);
  }
  // Add formerly unassigned defaults without taking a user's existing key.
  function upgrade(saved, cameraKeys = []) {
    const result = Object.fromEntries(actions.map(([id]) => [id, saved?.[id] || ['']]));
    const checked = validate(result);
    const used = new Set([...Object.values(checked).flat(), ...cameraKeys].filter(Boolean));
    for (const [id] of actions) {
      const key = defaults[id][0];
      if (!checked[id][0] && key && !used.has(key)) { checked[id] = [key]; used.add(key); }
    }
    return checked;
  }
  // Earlier versions saved their defaults on first start, so an untouched
  // profile still carries the old tool keys. Only a complete, unchanged old
  // set moves to the number row, and only if no other action holds those keys.
  const previousDefaults = { line: '6', brush: '2', brushSmaller: '[', brushLarger: ']', bucket: '7', select: '3', replace: '8', delete: '4' };
  function refreshDefaults(saved) {
    const moved = Object.keys(previousDefaults);
    if (!moved.every(id => saved?.[id]?.[0] === previousDefaults[id])) return saved;
    const others = new Set(actions.map(([id]) => id).filter(id => !moved.includes(id)).map(id => saved[id]?.[0]).filter(Boolean));
    if (moved.some(id => others.has(defaults[id][0]))) return saved;
    return { ...saved, ...Object.fromEntries(moved.map(id => [id, [...defaults[id]]])) };
  }
  function actionFor(event, bindings) {
    const key = typeof event === 'string' ? normalize(event) : fromEvent(event);
    return key ? actions.find(([id]) => bindings[id]?.[0] === key)?.[0] || null : null;
  }
  function accelerator(key) { return key ? key.split('+').map(part => part === 'ctrl' ? 'CmdOrCtrl' : part === 'space' ? 'Space' : part === 'plus' ? 'Plus' : part.toUpperCase()).join('+') : undefined; }
  return { get actions() { return actions.map(([id, label, ...rest]) => [id, tr(label), ...rest]); }, defaults, normalize, fromEvent, validate, migrate, upgrade, refreshDefaults, actionFor, accelerator, isReserved: key => reserved.has(key) };
});
