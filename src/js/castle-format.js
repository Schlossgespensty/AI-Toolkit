(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.castleFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const tr = (key, args) => (globalThis.toolkitI18n || require('./i18n')).t(key, args);
  const itemName = (constants, type) => (globalThis.castlePalette || require('./castle-palette')).itemName(constants, type);
  const isJsonPath = path => /\.(aivjson|aijson)$/i.test(path || '');

  // DE JSON is an interchange document: retain extensions, timing and marker
  // numbering. Never pass it through the classic editor's compaction policy.
  function validate(document) {
    if (!document || Array.isArray(document) || !Array.isArray(document.frames)) throw new Error(tr('validation:frames_array'));
    const offset = (value, step) => {
      if (!Number.isInteger(value) || value < 0 || value >= 10000) throw new Error(tr('validation:tile_offset', {label:step == null ? tr('validation:marker') : tr('validation:step', {step})}));
    };
    for (const [i, frame] of document.frames.entries()) {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error(tr('validation:step_object', {step:i+1}));
      if (!Object.keys(frame).length) continue;
      if (!Number.isInteger(frame.itemType) || !Array.isArray(frame.tilePositionOfsets)) throw new Error(tr('validation:step_positions', {step:i+1}));
      for (const value of frame.tilePositionOfsets) offset(value, i+1);
      if (frame.shouldPause != null && typeof frame.shouldPause !== 'boolean') throw new Error(tr('validation:step_pause', {step:i+1}));
    }
    if (document.miscItems != null && !Array.isArray(document.miscItems)) throw new Error(tr('validation:markers_array'));
    for (const item of document.miscItems || []) {
      if (!item || !Number.isInteger(item.itemType) || !Number.isInteger(item.number) || item.number < 0) throw new Error(tr('validation:marker_invalid'));
      offset(item.positionOfset);
    }
    if (document.pauseDelayAmount != null && (!Number.isFinite(document.pauseDelayAmount) || document.pauseDelayAmount < 0)) throw new Error(tr('validation:pause_delay'));
    return document;
  }

  function classicIssues(document, constants) {
    const issues = new Set();
    for (const frame of document.frames || []) {
      if (!frame?.tilePositionOfsets?.length) issues.add(tr('validation:classic_empty_steps'));
      const definition = constants[String(frame?.itemType)];
      if (frame?.itemType != null && (!definition || definition.edition === 'de' || definition.classicAiv === false)) issues.add(tr('validation:classic_item', {name:itemName(constants,frame.itemType)}));
      if (frame?.shouldPause) issues.add(tr('validation:classic_pauses'));
    }
    for (const item of document.miscItems || []) {
      if (!Number.isInteger(item.itemType) || item.itemType < 0 || item.itemType >= 24 || item.number < 0 || item.number >= 10) {
        issues.add(tr('validation:classic_marker', {name:itemName(constants,item.itemType)}));
      }
    }
    return [...issues];
  }
  function stringify(document) { return JSON.stringify(validate(document), null, 2) + '\n'; }
  return { isJsonPath, validate, classicIssues, stringify };
});
