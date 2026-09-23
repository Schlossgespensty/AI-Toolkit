(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.castleFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const isJsonPath = path => /\.(aivjson|aijson)$/i.test(path || '');

  // DE JSON is an interchange document: retain extensions, timing and marker
  // numbering. Never pass it through the classic editor's compaction policy.
  function validate(document) {
    if (!document || Array.isArray(document) || !Array.isArray(document.frames)) throw new Error('Castle frames must be an array.');
    const offset = (value, label) => {
      if (!Number.isInteger(value) || value < 0 || value >= 10000) throw new Error(`${label}: invalid tile offset.`);
    };
    for (const [i, frame] of document.frames.entries()) {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error(`Step ${i + 1}: expected an object.`);
      if (!Object.keys(frame).length) continue;
      if (!Number.isInteger(frame.itemType) || !Array.isArray(frame.tilePositionOfsets)) throw new Error(`Step ${i + 1}: invalid item or positions.`);
      for (const value of frame.tilePositionOfsets) offset(value, `Step ${i + 1}`);
      if (frame.shouldPause != null && typeof frame.shouldPause !== 'boolean') throw new Error(`Step ${i + 1}: invalid pause flag.`);
    }
    if (document.miscItems != null && !Array.isArray(document.miscItems)) throw new Error('Castle markers must be an array.');
    for (const item of document.miscItems || []) {
      if (!item || !Number.isInteger(item.itemType) || !Number.isInteger(item.number) || item.number < 0) throw new Error('Invalid castle marker.');
      offset(item.positionOfset, 'Castle marker');
    }
    if (document.pauseDelayAmount != null && (!Number.isFinite(document.pauseDelayAmount) || document.pauseDelayAmount < 0)) throw new Error('Invalid pause delay.');
    return document;
  }

  function classicIssues(document, constants) {
    const issues = new Set();
    for (const frame of document.frames || []) {
      if (!frame?.tilePositionOfsets?.length) issues.add('Empty build steps cannot be preserved in classic AIV.');
      const definition = constants[String(frame?.itemType)];
      if (frame?.itemType != null && (!definition || definition.edition === 'de' || definition.classicAiv === false)) issues.add(`${definition?.name || `Item ${frame.itemType}`} is not supported by classic AIV.`);
      if (frame?.shouldPause) issues.add('Build-step pauses are disabled in the classic editor.');
    }
    for (const item of document.miscItems || []) {
      if (!Number.isInteger(item.itemType) || item.itemType < 0 || item.itemType >= 24 || item.number < 0 || item.number >= 10) {
        issues.add(`${constants[String(item.itemType)]?.name || `Marker ${item.itemType}`} cannot be preserved in classic AIV.`);
      }
    }
    return [...issues];
  }
  function stringify(document) { return JSON.stringify(validate(document), null, 2) + '\n'; }
  return { isJsonPath, validate, classicIssues, stringify };
});
