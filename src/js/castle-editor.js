(() => {
  'use strict';

  const GRID = 100;
  const MIN_CELL = 3;
  const MAX_CELL = 32;
  const DEFAULT_CELL = 8;
  const DEFAULT_KEEP_OFFSET = 5643;
  const MAX_RENDER_DPR = 1.5;
  const FUTURE_OPACITY = 0.50;
  const FUTURE_FILTER = 'grayscale(1) brightness(.42)';
  const FUTURE_TINT = 'rgba(144, 176, 221, .13)';
  const SHORTCUT_STORAGE_KEY = 'aiv.castleToolShortcuts.v1';
  const CAMERA_STORAGE_KEY = 'aiv.castleCamera.v1';
  const camera = window.castleCamera;
  const OVERVIEW_STORAGE_KEY = 'aiv.castleOverviewLayout.v1';
  const DEFAULT_OVERVIEW_LAYOUT = {
    population: { visible: true, side: 'left' },
    costs: { visible: true, side: 'left' }
  };
  const DEFAULT_TOOL_SHORTCUTS = {
    single: ['1', 's'],
    brush: ['2', 'b'],
    select: ['3', 'v'],
    delete: ['4', 'd'],
    copy: ['5'],            // 'c' dreht jetzt die Ansicht, Kopieren bleibt auf 5 und Strg+C
    line: ['6', 'l'],
    bucket: ['7', 'f'],
    replace: ['8', 'r']
  };
  const deepClone = value => JSON.parse(JSON.stringify(value));
  const retainSourceBytes = value => {
    if (!value) return null;
    if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    if (Array.isArray(value)) return Uint8Array.from(value);
    return null;
  };
  const newCastleDocument = () => ({
    pauseDelayAmount: 100,
    frames: [{ itemType: 61, tilePositionOfsets: [DEFAULT_KEEP_OFFSET], shouldPause: false }],
    miscItems: []
  });

  const els = {
    canvas: document.getElementById('castleCanvas'),
    replaceDialog: document.getElementById('castleReplaceDialog'),
    replaceForm: document.getElementById('castleReplaceForm'),
    replaceRows: document.getElementById('castleReplaceRows'),
    replaceSummary: document.getElementById('castleReplaceSummary'),
    replaceError: document.getElementById('castleReplaceError'),
    replaceApply: document.getElementById('castleReplaceApplyBtn'),
    replaceCancel: document.getElementById('castleReplaceCancelBtn'),
    brushMinus: document.getElementById('castleBrushMinus'),
    brushPlus: document.getElementById('castleBrushPlus'),
    brushSizeOut: document.getElementById('castleBrushSize'),
    host: document.getElementById('castleCanvasHost'),
    palette: document.getElementById('castlePalette'),
    itemInfo: document.getElementById('castleSelectedItemInfo'),
    buildList: document.getElementById('castleBuildList'),
    buildCount: document.getElementById('castleBuildCount'),
    buildSlider: document.getElementById('castleBuildSlider'),
    buildSliderValue: document.getElementById('castleBuildSliderValue'),
    status: document.getElementById('castleStatus'),
    fileLabel: document.getElementById('castleFileLabel'),
    showNames: document.getElementById('castleShowNames'),
    showUnitNumbers: document.getElementById('castleShowUnitNumbers'),
    showCompatibility: document.getElementById('castleShowCompatibility'),
    showBlueprint: document.getElementById('castleShowBlueprint'),
    blueprintOpacity: document.getElementById('castleBlueprintOpacity'),
    blueprintOpacityValue: document.getElementById('castleBlueprintOpacityValue'),
    blueprintControls: document.getElementById('castleBlueprintControls'),
    shortcutDialog: document.getElementById('castleShortcutDialog'),
    shortcutForm: document.getElementById('castleShortcutForm'),
    shortcutError: document.getElementById('castleShortcutError'),
    shortcutDefaults: document.getElementById('castleShortcutDefaultsBtn'),
    shortcutCancel: document.getElementById('castleShortcutCancelBtn'),
    populationOverview: document.getElementById('castlePopulationOverview'),
    costOverview: document.getElementById('castleCostOverview'),
    buildPanel: document.querySelector('.castleBuildPanel'),
    palettePanel: document.querySelector('.castlePalettePanel'),
    saveNotice: document.getElementById('castleSaveNotice')
  };
  const displayCtx = els.canvas.getContext('2d', { alpha: false });
  const staticCacheCanvas = document.createElement('canvas');
  const staticCacheCtx = staticCacheCanvas.getContext('2d', { alpha: false });
  const futureCacheCanvas = document.createElement('canvas');
  const futureCacheCtx = futureCacheCanvas.getContext('2d');
  let ctx = displayCtx;
  const geometry = window.castleGeometry;
  const mapBackground = new Image();
  mapBackground.onload = () => scheduleDraw();
  mapBackground.src = '../assets/aiv/background.png';
  const bundledKeepImage = new Image();
  bundledKeepImage.onload = () => scheduleDraw();
  bundledKeepImage.src = '../assets/aiv/skins/61.png';
  const bundledStockpileImage = new Image();
  bundledStockpileImage.onload = () => scheduleDraw();
  bundledStockpileImage.src = '../assets/aiv/skins/52.png';

  const state = {
    constants: {},
    categories: {},
    populationData: { population_effects: { provides: {}, requires: {} } },
    unitTypes: new Set(),
    document: newCastleDocument(),
    filePath: null,
    sourcePath: null,
    sourceBytes: null,
    readOnly: false,
    dirty: false,
    tool: 'single',
    lastPlacementTool: 'single',
    currentItemType: null,
    activeCategory: null,
    selected: new Set(),
    insertionFrameIndex: null,
    copyBuffer: null,
    undo: [],
    redo: [],
    cell: DEFAULT_CELL,
    panX: 0,
    panY: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    hoverTile: null,
    centeredOnce: false,
    gesture: null,
    pointerId: null,
    dragStartTile: null,
    dragStartScreen: null,
    marqueeEnd: null,
    moveStartOffsets: new Map(),
    moveDelta: { x: 0, y: 0 },
    brushOffsets: [],
    brushTypes: [],
    brushError: '',
    brushSeen: new Set(),
    brushReplacements: new Set(),
    brushLastTile: null,
    brushSize: 1,
    camera: { ...camera.defaults },
    panning: false,
    panStart: null,
    skins: {},
    customSkinTypes: new Set(),
    skinImages: {},
    dragFrameIndexes: [],
    buildSelectionAnchor: null,
    renderPending: false,
    renderDpr: 1,
    staticCacheDirty: true,
    placementCache: null,
    blueprintImage: null,
    blueprintFileName: '',
    blueprintOpacity: 0.5,
    blueprintVisible: true,
    blueprintLoadToken: 0,
    toolShortcuts: deepClone(DEFAULT_TOOL_SHORTCUTS),
    overviewLayout: deepClone(DEFAULT_OVERVIEW_LAYOUT)
  };
  let saveNoticeTimer = null;
  let blueprintDialogOpen = false;

  function frames() {
    if (!Array.isArray(state.document.frames)) state.document.frames = [];
    return state.document.frames;
  }

  function selectBuildFrame(frameIndex) {
    return selectBuildFrames([frameIndex], frameIndex);
  }

  function selectedBuildFrameIndexes() {
    const indexes = [];
    frames().forEach((frame, frameIndex) => {
      const offsets = frame.tilePositionOfsets || [];
      if (offsets.length && offsets.every((_offset, offsetIndex) => state.selected.has(frameRefKey(frameIndex, offsetIndex)))) {
        indexes.push(frameIndex);
      }
    });
    return indexes;
  }

  function selectBuildFrames(frameIndexes, activeIndex = null, { updateAnchor = true } = {}) {
    const indexes = [...new Set(frameIndexes)]
      .filter(index => Number.isInteger(index) && index >= 0 && index < frames().length)
      .sort((one, two) => one - two);
    state.selected.clear();
    for (const frameIndex of indexes) {
      const frame = frames()[frameIndex];
      (frame.tilePositionOfsets || []).forEach((_offset, offsetIndex) => {
        state.selected.add(frameRefKey(frameIndex, offsetIndex));
      });
    }
    if (indexes.length) {
      state.insertionFrameIndex = indexes.includes(activeIndex) ? activeIndex : indexes.at(-1);
      if (updateAnchor) state.buildSelectionAnchor = state.insertionFrameIndex;
    }
    return indexes.length > 0;
  }

  function activateBuildStepForRefs(refs, preferredRef = null) {
    let frameIndex = null;
    if (preferredRef && refExists(preferredRef)) {
      const preferred = parseRef(preferredRef);
      if (preferred.kind === 'frame') frameIndex = preferred.fi;
    }
    if (frameIndex == null) {
      for (const ref of refs) {
        if (!refExists(ref)) continue;
        const parsed = parseRef(ref);
        if (parsed.kind === 'frame') frameIndex = parsed.fi;
      }
    }
    if (frameIndex == null) return false;
    state.insertionFrameIndex = frameIndex;
    state.buildSelectionAnchor = frameIndex;
    return true;
  }

  function updateBuildSelection(frameIndex, event) {
    const additive = event.ctrlKey || event.metaKey;
    const current = new Set(selectedBuildFrameIndexes());
    let next;
    if (event.shiftKey) {
      const anchor = Number.isInteger(state.buildSelectionAnchor) ? state.buildSelectionAnchor : frameIndex;
      const start = Math.min(anchor, frameIndex);
      const end = Math.max(anchor, frameIndex);
      const range = Array.from({ length: end - start + 1 }, (_unused, index) => start + index);
      next = additive ? new Set([...current, ...range]) : new Set(range);
      selectBuildFrames([...next], frameIndex, { updateAnchor: false });
    } else if (additive) {
      if (current.has(frameIndex)) current.delete(frameIndex);
      else current.add(frameIndex);
      next = current;
      selectBuildFrames([...next], current.has(frameIndex) ? frameIndex : [...current].sort((a, b) => a - b).at(-1));
    } else {
      next = new Set([frameIndex]);
      selectBuildFrame(frameIndex);
    }
    return [...next].sort((one, two) => one - two);
  }

  function insertBuildFrames(newFrames) {
    const inserted = geometry.insertBuildSteps(frames(), newFrames, state.insertionFrameIndex);
    invalidatePlacementCache();
    if (newFrames.length) selectBuildFrame(inserted.endIndex);
    return inserted;
  }

  function clampActiveBuildStep() {
    if (!Number.isInteger(state.insertionFrameIndex)) return;
    if (!frames().length) {
      state.insertionFrameIndex = null;
      state.buildSelectionAnchor = null;
      return;
    }
    state.insertionFrameIndex = Math.max(0, Math.min(frames().length - 1, state.insertionFrameIndex));
    state.buildSelectionAnchor = state.insertionFrameIndex;
  }

  function normalizeDocument(doc, diagnostics = null) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('The AIV castle document is invalid.');
    if (!Array.isArray(doc.frames)) throw new Error("The AIV file must contain a 'frames' array.");
    const normalizedFrames = [];
    doc.frames.forEach((frame, i) => {
      const emptyLegacyStep = frame == null || (
        typeof frame === 'object' && !Array.isArray(frame) && (
          Object.keys(frame).length === 0 ||
          (Array.isArray(frame.tilePositionOfsets) && frame.tilePositionOfsets.length === 0)
        )
      );
      if (emptyLegacyStep) {
        if (diagnostics) diagnostics.removedLegacySteps = (diagnostics.removedLegacySteps || 0) + 1;
        return;
      }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error(`Frame ${i + 1} is not an object.`);
      if (!Number.isInteger(Number(frame.itemType))) throw new Error(`Frame ${i + 1} has no valid itemType.`);
      if (!Array.isArray(frame.tilePositionOfsets)) throw new Error(`Frame ${i + 1}: tilePositionOfsets must be an array.`);
      frame.itemType = Number(frame.itemType);
      frame.tilePositionOfsets = frame.tilePositionOfsets.map(off => {
        const n = Number(off);
        if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error(`Frame ${i + 1}: invalid tile offset ${off}.`);
        return n;
      });
      frame.shouldPause = Boolean(frame.shouldPause);
      normalizedFrames.push(frame);
    });
    doc.frames = normalizedFrames;
    if (!Array.isArray(doc.miscItems)) doc.miscItems = [];
    doc.miscItems.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Misc item ${i + 1} is not an object.`);
      if (!Number.isInteger(Number(item.itemType))) throw new Error(`Misc item ${i + 1} has no valid itemType.`);
      const offset = Number(item.positionOfset);
      if (!Number.isInteger(offset) || offset < 0 || offset > 9999) throw new Error(`Misc item ${i + 1}: invalid positionOfset ${item.positionOfset}.`);
      item.itemType = Number(item.itemType);
      item.positionOfset = offset;
    });
    return doc;
  }

  // Build-step locks are workspace aids, not part of an AIV document. They
  // begin empty whenever a castle is loaded and are removed from every save.
  function stripSessionLocks(doc) {
    if (Array.isArray(doc?.frames)) {
      for (const frame of doc.frames) {
        if (frame && typeof frame === 'object') delete frame.locked;
      }
    }
    return doc;
  }

  function itemInfo(type) { return state.constants[String(type)] || {}; }
  function itemName(type) { return window.castlePalette.itemName(state.constants, type); }
  function itemSize(type) {
    const size = itemInfo(type).size;
    if (!Array.isArray(size) || size.length < 2) return [1, 1];
    return [Math.max(1, Number(size[0]) || 1), Math.max(1, Number(size[1]) || 1)];
  }
  function overlapMode(type) {
    if (isUnitType(type)) return 'allow';
    return String(itemInfo(type).overlap || 'block').toLowerCase();
  }
  function maxAmount(type) {
    const configured = itemInfo(type).maxAmount;
    return configured == null && isUnitType(type) ? 10 : configured;
  }
  function offsetToXY(offset) { return { x: offset % GRID, y: Math.floor(offset / GRID) }; }
  function xyToOffset(x, y) { return y * GRID + x; }
  function frameRefKey(fi, oi) { return `f:${fi}:${oi}`; }
  function unitRefKey(mi) { return `u:${mi}`; }
  function parseRef(ref) {
    const [kind, first, second] = String(ref).split(':');
    return kind === 'u'
      ? { kind: 'unit', mi: Number(first) }
      : { kind: 'frame', fi: Number(first), oi: Number(second) };
  }

  function isUnitType(type) { return state.unitTypes.has(Number(type)); }

  function allowsMultiplePerStep(type) {
    return isUnitType(type) || itemInfo(type).multiPlacement === true;
  }

  function lineSequence(type) {
    const configured = itemInfo(type).lineSequence;
    if (!Array.isArray(configured)) return [];
    return configured.map(Number).filter(itemType => Number.isInteger(itemType) && state.constants[String(itemType)]);
  }

  function isLineSequence(type) {
    return lineSequence(type).length > 0;
  }

  function renumberUnits(doc = state.document) {
    const nextNumber = new Map();
    for (const item of doc.miscItems || []) {
      const type = Number(item.itemType);
      if (!isUnitType(type)) continue;
      const number = nextNumber.get(type) || 0;
      item.number = number;
      nextNumber.set(type, number + 1);
    }
  }

  function unitDisplayNumber(number) {
    return Number(number) + 1;
  }

  function normalizeUnitStorage(doc = state.document) {
    if (!state.unitTypes.size) return doc;
    const retainedFrames = [];
    for (const frame of doc.frames || []) {
      const type = Number(frame.itemType);
      if (!isUnitType(type)) {
        retainedFrames.push(frame);
        continue;
      }
      for (const offset of frame.tilePositionOfsets || []) {
        doc.miscItems.push({ positionOfset: Number(offset), itemType: type, number: 0 });
      }
    }
    doc.frames = retainedFrames;
    renumberUnits(doc);
    return doc;
  }

  function refExists(ref) {
    const parsed = parseRef(ref);
    if (parsed.kind === 'unit') {
      return parsed.mi >= 0 && parsed.mi < state.document.miscItems.length;
    }
    const { fi, oi } = parsed;
    return fi >= 0 && fi < frames().length && oi >= 0 && oi < (frames()[fi].tilePositionOfsets || []).length;
  }

  function refOffset(ref) {
    const parsed = parseRef(ref);
    if (parsed.kind === 'unit') return Number(state.document.miscItems[parsed.mi].positionOfset);
    return Number(frames()[parsed.fi].tilePositionOfsets[parsed.oi]);
  }

  function refType(ref) {
    const parsed = parseRef(ref);
    if (parsed.kind === 'unit') return Number(state.document.miscItems[parsed.mi].itemType);
    return Number(frames()[parsed.fi].itemType);
  }

  function placementRefs() {
    if (state.placementCache) return state.placementCache;
    const out = [];
    frames().forEach((frame, fi) => {
      const type = Number(frame.itemType);
      (frame.tilePositionOfsets || []).forEach((off, oi) => out.push({
        ref: frameRefKey(fi, oi), kind: 'frame', fi, oi, type, off: Number(off)
      }));
    });
    state.document.miscItems.forEach((item, mi) => {
      if (!isUnitType(item.itemType)) return;
      out.push({
        ref: unitRefKey(mi), kind: 'unit', mi, type: Number(item.itemType),
        off: Number(item.positionOfset), number: Number(item.number)
      });
    });
    state.placementCache = out;
    return state.placementCache;
  }

  function calculatePopulationSummary() {
    const effects = state.populationData?.population_effects || {};
    const provides = effects.provides || {};
    const requires = effects.requires || {};
    let provided = 0;
    let required = 0;
    const counts = {};

    for (const placement of placementRefs()) {
      const key = String(placement.type);
      counts[key] = (counts[key] || 0) + 1;
      provided += Number(provides[key]) || 0;
      required += Number(requires[key]) || 0;
    }

    return { provided, required, left: provided - required, counts };
  }

  function updatePopulationPanel(emitCastleEvent = true) {
    const summary = calculatePopulationSummary();
    // The complete-castle counter is no longer shown here, but Character and
    // other workspaces still consume this event and the public summary API.
    if (emitCastleEvent) {
      window.dispatchEvent(new CustomEvent('castle-population-changed', { detail: summary }));
    }
    return summary;
  }

  function footprintRectsAtXY(type, x, y) {
    return geometry.footprintRectsAtXY(Number(type), x, y, itemSize(type));
  }

  function footprintRects(type, offset) {
    const { x, y } = offsetToXY(offset);
    return footprintRectsAtXY(type, x, y);
  }

  function itemRect(type, offset) {
    return geometry.footprintBounds(footprintRects(type, offset));
  }

  function countType(type, ignore = new Set()) {
    let count = 0;
    for (const p of placementRefs()) if (p.type === type && !ignore.has(p.ref)) count++;
    return count;
  }

  function boundsError(type, x, y) {
    if (!geometry.footprintIsInBounds(footprintRectsAtXY(type, x, y), GRID)) {
      return `${itemName(type)} would extend outside the 100×100 field.`;
    }
    return '';
  }

  function validatePlacement(type, offset, options = {}) {
    const ignore = options.ignoreRefs || new Set();
    const extraNew = options.extraNew || [];
    const checkMax = options.checkMax !== false;
    const { x, y } = offsetToXY(offset);
    const outside = boundsError(type, x, y);
    if (outside) return { ok: false, reason: outside, replacements: new Set() };

    if (checkMax) {
      const maximum = maxAmount(type);
      if (maximum != null && countType(type, ignore) >= Number(maximum)) {
        return { ok: false, reason: `Maximum amount for ${itemName(type)} is ${maximum}.`, replacements: new Set() };
      }
    }

    if (overlapMode(type) === 'allow') return { ok: true, reason: '', replacements: new Set() };

    const proposedFootprint = footprintRects(type, offset);
    const replacements = new Set();
    for (const p of placementRefs()) {
      if (ignore.has(p.ref)) continue;
      if (!geometry.footprintsIntersect(proposedFootprint, footprintRects(p.type, p.off))) continue;
      const existingMode = overlapMode(p.type);
      if (existingMode === 'allow') continue;
      if (existingMode === 'replace') {
        // Ein gesperrter Bauschritt wird auch nicht ueberbaut.
        if (refIsLocked(p.ref)) return { ok: false, reason: 'That build step is locked.', replacements: new Set() };
        replacements.add(p.ref);
        continue;
      }
      return { ok: false, reason: `Blocked by ${itemName(p.type)}.`, replacements: new Set() };
    }

    for (const other of extraNew) {
      if (overlapMode(other.type) === 'allow') continue;
      if (geometry.footprintsIntersect(proposedFootprint, footprintRects(other.type, other.off))) {
        return { ok: false, reason: 'Overlaps another item in this brush stroke.', replacements: new Set() };
      }
    }
    return { ok: true, reason: '', replacements };
  }

  function lineObstacleMap() {
    const occupied = new Uint8Array(GRID * GRID);
    for (const placement of placementRefs()) {
      if (placement.kind === 'unit') continue;
      for (const rect of footprintRects(placement.type, placement.off)) {
        const left = Math.max(0, rect.left);
        const right = Math.min(GRID - 1, rect.right);
        const bottom = Math.max(0, rect.bottom);
        const top = Math.min(GRID - 1, rect.top);
        for (let y = bottom; y <= top; y++) {
          for (let x = left; x <= right; x++) occupied[y * GRID + x] = 1;
        }
      }
    }
    return occupied;
  }

  function routedLineTiles(start, end) {
    const type = state.currentItemType;
    const occupied = lineObstacleMap();
    const isBlocked = tile => {
      const footprint = footprintRectsAtXY(type, tile.x, tile.y);
      if (!geometry.footprintIsInBounds(footprint, GRID)) return true;
      return footprint.some(rect => {
        for (let y = rect.bottom; y <= rect.top; y++) {
          for (let x = rect.left; x <= rect.right; x++) {
            if (occupied[y * GRID + x]) return true;
          }
        }
        return false;
      });
    };
    return geometry.routedLineTiles(start, end, isBlocked, GRID);
  }

  function stableColor(type) {
    const category = Object.entries(state.categories).find(([, ids]) => ids.some(id => Number(id) === Number(type)))?.[0];
    if (category) return window.castlePalette.categoryStyle(category).background;
    const hue = (Number(type) * 47) % 360;
    return `hsl(${hue} 45% 62%)`;
  }

  function setStatus(text) {
    els.status.textContent = text;
    if (window.appWorkspace?.getActive() === 'castle') window.appWorkspace.setStatus(text);
  }

  function showSaveNotice(message, type = '') {
    clearTimeout(saveNoticeTimer);
    els.saveNotice.textContent = message;
    els.saveNotice.className = `castleSaveNotice${type ? ` ${type}` : ''}`;
    els.saveNotice.hidden = false;
    saveNoticeTimer = setTimeout(() => { els.saveNotice.hidden = true; }, type === 'error' ? 5000 : 3200);
  }

  function setDirty(value) {
    state.dirty = value;
    updateFileLabel();
  }

  function updateFileLabel() {
    const name = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'Untitled.aiv';
    els.fileLabel.textContent = `${name}${state.dirty ? ' *' : ''}${state.readOnly ? ' [read-only]' : ''}`;
    els.fileLabel.title = state.filePath || '';
    document.getElementById('castleSaveBtn').disabled = false;
    document.getElementById('castleSaveAsBtn').disabled = false;
  }

  function pushUndo() {
    state.undo.push(deepClone(state.document));
    if (state.undo.length > 100) state.undo.shift();
    state.redo.length = 0;
  }

  function changed(message) {
    invalidatePlacementCache();
    setDirty(true);
    renderBuildList();
    scheduleDraw();
    setStatus(message);
  }

  function undo() {
    if (!state.undo.length) return setStatus('Nothing to undo');
    const activeStep = state.insertionFrameIndex;
    state.redo.push(deepClone(state.document));
    state.document = state.undo.pop();
    normalizeDocument(state.document);
    invalidatePlacementCache();
    state.selected.clear();
    state.insertionFrameIndex = activeStep;
    clampActiveBuildStep();
    state.copyBuffer = null;
    setDirty(true);
    renderBuildList();
    scheduleDraw();
    setStatus('Undo');
  }

  function redo() {
    if (!state.redo.length) return setStatus('Nothing to redo');
    const activeStep = state.insertionFrameIndex;
    state.undo.push(deepClone(state.document));
    state.document = state.redo.pop();
    normalizeDocument(state.document);
    invalidatePlacementCache();
    state.selected.clear();
    state.insertionFrameIndex = activeStep;
    clampActiveBuildStep();
    state.copyBuffer = null;
    setDirty(true);
    renderBuildList();
    scheduleDraw();
    setStatus('Redo');
  }

  async function newFile() {
    if (!await window.unsavedChanges?.confirmEditor('castle', 'creating a new castle')) return false;
    const document = newCastleDocument();
    const disposition = await window.ucpLibrary?.chooseDocumentDisposition?.('castle', 'new') || 'separate';
    if (disposition === 'cancel') return false;
    if (disposition === 'project') {
      const added = await window.ucpLibrary.addCastleDocument({ document, unchanged: false });
      if (!added) return false;
      loadDocument(document, added.path, {
        projectManaged: true,
        source: 'aiv',
        sourceBytes: added.sourceBytes
      });
      setStatus(`New castle added to the loaded AI as ${added.fileName}`);
      return true;
    }
    state.document = document;
    invalidatePlacementCache();
    state.filePath = null;
    state.sourcePath = null;
    state.sourceBytes = null;
    state.readOnly = false;
    state.undo.length = 0;
    state.redo.length = 0;
    state.selected.clear();
    selectBuildFrame(0);
    state.buildSelectionAnchor = 0;
    state.copyBuffer = null;
    window.ucpLibrary?.detachCastleProject?.();
    setDirty(false);
    renderBuildList();
    scheduleDraw();
    setStatus('New castle');
    return true;
  }

  async function openFile() {
    if (!await window.unsavedChanges?.confirmEditor('castle', 'opening another castle')) return false;
    const result = await window.electronAPI.openFile('aiv');
    if (!result) return false;
    const disposition = await window.ucpLibrary?.chooseDocumentDisposition?.('castle', 'open') || 'separate';
    if (disposition === 'cancel') return false;
    if (disposition === 'project') {
      const added = await window.ucpLibrary.addCastleDocument({
        document: result.document,
        suggestedFileName: result.path,
        sourcePath: result.source === 'aiv' ? result.path : null,
        sourceBytes: result.sourceBytes,
        unchanged: true
      });
      if (!added) return false;
      loadDocument(result.document, added.path, {
        projectManaged: true,
        source: 'aiv',
        sourceBytes: added.sourceBytes
      });
      setStatus(`${added.fileName} added to the loaded AI`);
      return true;
    }
    loadDocument(result.document, result.path, { source: result.source, sourceBytes: result.sourceBytes });
    return true;
  }

  function loadDocument(document, path, options = {}) {
    try {
      const diagnostics = { removedLegacySteps: 0 };
      const parsed = stripSessionLocks(normalizeUnitStorage(normalizeDocument(deepClone(document), diagnostics)));
      state.document = parsed;
      invalidatePlacementCache();
      state.filePath = path || null;
      state.sourcePath = options.source === 'aiv' && path ? path : null;
      state.sourceBytes = options.source === 'aiv' ? retainSourceBytes(options.sourceBytes) : null;
      state.readOnly = false;
      state.undo.length = 0;
      state.redo.length = 0;
      state.selected.clear();
      state.insertionFrameIndex = null;
      state.buildSelectionAnchor = null;
      state.copyBuffer = null;
      state.currentItemType = null;
      updateToolAvailability();
      if (!options.projectManaged) window.ucpLibrary?.detachCastleProject?.();
      renderPalette();
      setDirty(false);
      renderBuildList();
      centerMap();
      const legacyNote = diagnostics.removedLegacySteps
        ? ` — removed ${diagnostics.removedLegacySteps} empty legacy step${diagnostics.removedLegacySteps === 1 ? '' : 's'}`
        : '';
      const formatNote = options.source === 'aiv'
        ? 'native AIV'
        : options.source === 'aivjson' ? 'AIVJSON compatibility import' : 'castle document';
      setStatus(`Opened ${path ? path.split(/[\\/]/).pop() : 'castle'} — ${frames().length} build steps · ${formatNote}${legacyNote}`);
    } catch (err) {
      alert(`Could not open AIV castle:\n\n${err.message}`);
      console.error(err);
    }
  }

  function loadFromContent(content, path, options = {}) {
    try {
      const document = typeof content === 'string' ? JSON.parse(content) : content;
      loadDocument(document, path, { ...options, source: options.source || 'aivjson' });
    } catch (err) {
      alert(`Could not import AIVJSON castle:\n\n${err.message}`);
      console.error(err);
    }
  }

  function outputDocument() {
    const out = deepClone(state.document);
    normalizeDocument(out);
    normalizeUnitStorage(out);
    return stripSessionLocks(out);
  }

  function outputContent() {
    return JSON.stringify(outputDocument(), null, 2) + '\n';
  }

  async function saveFile() {
    if (!state.filePath || !/\.aiv$/i.test(state.filePath)) return saveAs();
    try {
      const result = await window.electronAPI.quickSaveFile({
        path: state.filePath,
        content: outputDocument(),
        kind: 'aiv',
        sourcePath: state.sourcePath,
        sourceBytes: state.sourceBytes,
        unchanged: !state.dirty
      });
      if (!result) {
        setStatus('Save cancelled; the existing castle was not changed');
        return false;
      }
      state.sourcePath = state.filePath;
      state.sourceBytes = retainSourceBytes(result.sourceBytes) || state.sourceBytes;
      setDirty(false);
      const name = state.filePath.split(/[\\/]/).pop();
      const message = `Saved ${name}`;
      setStatus(message);
      showSaveNotice(`✓ ${message}`);
      return true;
    } catch (err) {
      alert(`Could not save AIV castle:\n\n${err.message}`);
      showSaveNotice('Castle was not saved', 'error');
      return false;
    }
  }

  async function saveAs() {
    try {
      const defaultPath = state.filePath
        ? state.filePath.replace(/\.aivjson$/i, '.aiv')
        : 'Castle.aiv';
      const result = await window.electronAPI.saveFile(outputDocument(), 'aiv', defaultPath, {
        sourcePath: state.sourcePath,
        sourceBytes: state.sourceBytes,
        unchanged: !state.dirty
      });
      if (!result) return false;
      state.filePath = result.path || result;
      state.sourcePath = state.filePath;
      state.sourceBytes = retainSourceBytes(result.sourceBytes) || state.sourceBytes;
      state.readOnly = false;
      setDirty(false);
      const name = state.filePath.split(/[\\/]/).pop();
      const message = `Saved ${name}`;
      setStatus(message);
      showSaveNotice(`✓ ${message}`);
      return true;
    } catch (err) {
      alert(`Could not save AIV castle:\n\n${err.message}`);
      showSaveNotice('Castle was not saved', 'error');
      return false;
    }
  }

  // Ein gesperrter Bauschritt laesst sich nicht mehr anfassen: nicht loeschen,
  // nicht verschieben, nicht umsortieren und nicht ueberbauen. Angesehen und
  // ausgewaehlt werden darf er - gesperrt heisst unveraenderlich, nicht
  // unsichtbar.
  //
  // Die Sperre haengt am Bauschritt selbst, nicht an seiner Nummer: beim
  // Umsortieren wandert sie mit, und eine Nummer, die auf den falschen
  // Schritt zeigt, kann es gar nicht geben. In die AIV-Datei wandert sie
  // nicht - das Format kennt kein solches Feld.
  function selectionByType(refs = state.selected) {
    const nach = new Map();
    for (const ref of refs) {
      if (!refExists(ref)) continue;
      const type = Number(refType(ref));
      if (!nach.has(type)) nach.set(type, []);
      nach.get(type).push(ref);
    }
    return nach;
  }

  function replacementTargetsFor(sourceType) {
    const unit = isUnitType(sourceType);
    return Object.keys(state.constants)
      .map(Number)
      .filter(type => type !== geometry.KEEP_ITEM_TYPE && isUnitType(type) === unit)
      .sort((a, b) => itemName(a).localeCompare(itemName(b)) || a - b);
  }

  function updateReplacementApplyState() {
    if (!els.replaceApply) return;
    const changedChoice = Array.from(els.replaceRows.querySelectorAll('select[data-source-type]'))
      .some(select => Number(select.value) !== Number(select.dataset.sourceType));
    els.replaceApply.disabled = !changedChoice;
    els.replaceError.textContent = '';
  }

  // The Replace tool owns its selection and its choices. Picking a normal
  // palette item no longer changes or operates on an unrelated selection.
  function openReplacementDialog(refs) {
    const selectedRefs = new Set(Array.from(refs || []).filter(refExists));
    if (!selectedRefs.size) {
      setStatus('Nothing selected to replace.');
      return false;
    }
    state.selected = selectedRefs;
    activateBuildStepForRefs(state.selected);
    els.replaceRows.textContent = '';
    els.replaceError.textContent = '';
    const groups = selectionByType(selectedRefs);
    let mutableCount = 0;

    for (const [type, typeRefs] of Array.from(groups).sort((a, b) => itemName(a[0]).localeCompare(itemName(b[0])))) {
      const locked = typeRefs.filter(refIsLocked).length;
      const immutableKeep = type === geometry.KEEP_ITEM_TYPE;
      const mutable = immutableKeep ? 0 : typeRefs.length - locked;
      mutableCount += mutable;

      const row = document.createElement('label');
      row.className = 'castleReplaceRow';
      const source = document.createElement('span');
      source.className = 'castleReplaceSource';
      source.textContent = `${typeRefs.length}× ${itemName(type)}`;
      source.title = `${itemName(type)} [${type}]`;
      row.appendChild(source);

      if (mutable) {
        const select = document.createElement('select');
        select.dataset.sourceType = String(type);
        select.setAttribute('aria-label', `Replace ${itemName(type)} with`);
        for (const target of replacementTargetsFor(type)) {
          const option = document.createElement('option');
          option.value = String(target);
          option.textContent = `${itemName(target)} [${target}]`;
          select.appendChild(option);
        }
        select.value = String(type);
        select.addEventListener('change', updateReplacementApplyState);
        row.appendChild(select);
      } else {
        const reason = document.createElement('span');
        reason.className = 'castleReplaceUnavailable';
        reason.textContent = immutableKeep ? 'Keep cannot be replaced' : 'Locked';
        row.appendChild(reason);
      }

      if (locked && mutable) {
        const note = document.createElement('small');
        note.textContent = `${locked} locked placement${locked === 1 ? '' : 's'} will stay unchanged`;
        row.appendChild(note);
      }
      els.replaceRows.appendChild(row);
    }

    els.replaceSummary.textContent = `${selectedRefs.size} placement${selectedRefs.size === 1 ? '' : 's'} across ${groups.size} item type${groups.size === 1 ? '' : 's'}. Choose one replacement per type.`;
    els.replaceApply.disabled = true;
    if (mutableCount === 0) els.replaceError.textContent = 'The selection contains only locked placements or the Keep.';
    if (els.replaceDialog.open) els.replaceDialog.close();
    els.replaceDialog.showModal();
    els.replaceRows.querySelector('select')?.focus();
    renderBuildList();
    scheduleDraw();
    return true;
  }

  function replacementFailure(message) {
    els.replaceError.textContent = message;
    setStatus(message);
    return false;
  }

  // A partially selected frame is split directly after its original frame;
  // this preserves build order while allowing every source type to have its
  // own target. Units can only become units and buildings only buildings.
  function replaceSelectionByType(mapping) {
    const originalRefs = Array.from(state.selected).filter(refExists);
    const changes = [];
    for (const ref of originalRefs) {
      const sourceType = Number(refType(ref));
      const targetType = Number(mapping.get(sourceType));
      if (!Number.isFinite(targetType) || targetType === sourceType || refIsLocked(ref) || sourceType === geometry.KEEP_ITEM_TYPE) continue;
      if (!state.constants[String(targetType)] || targetType === geometry.KEEP_ITEM_TYPE) {
        return replacementFailure(`Invalid replacement for ${itemName(sourceType)}.`);
      }
      if (isUnitType(sourceType) !== isUnitType(targetType)) {
        return replacementFailure('Buildings can only replace buildings, and rallypoints can only replace rallypoints.');
      }
      changes.push({ ref, sourceType, targetType, off: refOffset(ref), parsed: parseRef(ref) });
    }
    if (!changes.length) return replacementFailure('Choose at least one different replacement.');

    const changingRefs = new Set(changes.map(change => change.ref));
    const proposed = [];
    const totals = new Map();
    for (const change of changes) totals.set(change.targetType, (totals.get(change.targetType) || 0) + 1);
    for (const [targetType, added] of totals) {
      const maximum = maxAmount(targetType);
      if (maximum != null && countType(targetType, changingRefs) + added > Number(maximum)) {
        return replacementFailure(`Maximum amount for ${itemName(targetType)} is ${maximum}.`);
      }
    }
    for (const change of changes) {
      const check = validatePlacement(change.targetType, change.off, {
        ignoreRefs: changingRefs,
        extraNew: proposed,
        checkMax: false
      });
      if (!check.ok) return replacementFailure(`No room for ${itemName(change.targetType)}: ${check.reason}`);
      if (check.replacements.size) {
        return replacementFailure(`${itemName(change.targetType)} would also replace an item outside the selected area.`);
      }
      proposed.push({ type: change.targetType, off: change.off });
    }

    pushUndo();
    const desired = originalRefs.map(ref => {
      const sourceType = Number(refType(ref));
      const change = changes.find(entry => entry.ref === ref);
      return { type: change ? change.targetType : sourceType, off: refOffset(ref) };
    });

    for (const change of changes.filter(entry => entry.parsed.kind === 'unit')) {
      state.document.miscItems[change.parsed.mi].itemType = change.targetType;
    }

    const byFrame = new Map();
    for (const change of changes.filter(entry => entry.parsed.kind === 'frame')) {
      if (!byFrame.has(change.parsed.fi)) byFrame.set(change.parsed.fi, []);
      byFrame.get(change.parsed.fi).push(change);
    }
    for (const fi of Array.from(byFrame.keys()).sort((a, b) => b - a)) {
      const frame = frames()[fi];
      if (!frame) continue;
      const frameChanges = byFrame.get(fi);
      const targetType = frameChanges[0].targetType;
      const indexes = new Set(frameChanges.map(change => change.parsed.oi));
      const allOffsets = frame.tilePositionOfsets || [];
      const replacedOffsets = allOffsets.filter((_off, oi) => indexes.has(oi));
      const remainingOffsets = allOffsets.filter((_off, oi) => !indexes.has(oi));
      if (!remainingOffsets.length) {
        frame.itemType = targetType;
      } else {
        frame.tilePositionOfsets = remainingOffsets;
        frames().splice(fi + 1, 0, { itemType: targetType, tilePositionOfsets: replacedOffsets, shouldPause: false });
      }
    }
    renumberUnits();
    invalidatePlacementCache();

    const available = new Map();
    for (const placement of placementRefs()) {
      const key = `${placement.type}:${placement.off}`;
      if (!available.has(key)) available.set(key, []);
      available.get(key).push(placement.ref);
    }
    state.selected = new Set();
    for (const wanted of desired) {
      const refs = available.get(`${wanted.type}:${wanted.off}`);
      if (refs?.length) state.selected.add(refs.shift());
    }
    activateBuildStepForRefs(state.selected);
    changed(`Replaced ${changes.length} placement${changes.length === 1 ? '' : 's'} across ${totals.size} target type${totals.size === 1 ? '' : 's'}`);
    return true;
  }

  function submitReplacementDialog(event) {
    event.preventDefault();
    const mapping = new Map(Array.from(els.replaceRows.querySelectorAll('select[data-source-type]'))
      .map(select => [Number(select.dataset.sourceType), Number(select.value)]));
    if (replaceSelectionByType(mapping)) els.replaceDialog.close();
  }

  function frameIsLocked(fi) {
    const frame = frames()[fi];
    return Boolean(frame && frame.locked);
  }

  function refIsLocked(ref) {
    const parsed = parseRef(ref);
    return parsed.kind === 'frame' && frameIsLocked(parsed.fi);
  }

  function lockedAmong(refs) {
    let n = 0;
    for (const ref of refs) if (refIsLocked(ref)) n++;
    return n;
  }

  // Ein Klick aufs Schloss schaltet den angeklickten Schritt - und, wenn er
  // Teil einer groesseren Auswahl ist, gleich die ganze Auswahl mit. Alle
  // bekommen denselben Zustand wie der angeklickte, damit ein zweiter Klick
  // sie wieder gemeinsam oeffnet.
  function toggleFrameLock(fi) {
    const frame = frames()[fi];
    if (!frame) return;
    const wert = !frame.locked;
    const ausgewaehlt = selectedBuildFrameIndexes();
    const betroffen = ausgewaehlt.includes(fi) && ausgewaehlt.length > 1 ? ausgewaehlt : [fi];
    for (const index of betroffen) {
      const f = frames()[index];
      if (f) f.locked = wert;
    }
    renderBuildList();
    scheduleDraw();
    setStatus(betroffen.length === 1
      ? 'Build step ' + (fi + 1) + (wert ? ' is locked' : ' is open again')
      : betroffen.length + ' build steps ' + (wert ? 'locked' : 'open again'));
  }

  function deleteRefs(refs) {
    const groupedFrames = new Map();
    const unitIndexes = [];
    for (const ref of refs) {
      if (!refExists(ref)) continue;
      if (refIsLocked(ref)) continue;          // gesperrt: bleibt stehen
      const parsed = parseRef(ref);
      if (parsed.kind === 'unit') {
        unitIndexes.push(parsed.mi);
        continue;
      }
      if (!groupedFrames.has(parsed.fi)) groupedFrames.set(parsed.fi, []);
      groupedFrames.get(parsed.fi).push(parsed.oi);
    }
    const frameIndexes = Array.from(groupedFrames.keys()).sort((a, b) => b - a);
    for (const fi of frameIndexes) {
      const offsets = frames()[fi].tilePositionOfsets;
      const indexes = Array.from(new Set(groupedFrames.get(fi))).sort((a, b) => b - a);
      for (const oi of indexes) if (oi >= 0 && oi < offsets.length) offsets.splice(oi, 1);
      if (!offsets.length) {
        frames().splice(fi, 1);
        if (state.insertionFrameIndex != null && fi <= state.insertionFrameIndex) state.insertionFrameIndex -= 1;
      }
    }
    for (const mi of Array.from(new Set(unitIndexes)).sort((a, b) => b - a)) {
      if (mi >= 0 && mi < state.document.miscItems.length) state.document.miscItems.splice(mi, 1);
    }
    renumberUnits();
    clampActiveBuildStep();
    invalidatePlacementCache();
  }

  function deleteSelected() {
    const refs = new Set(Array.from(state.selected).filter(refExists));
    if (!refs.size) return;
    const gesperrt = lockedAmong(refs);
    if (gesperrt === refs.size) return setStatus('Locked - unlock the build step first.');
    pushUndo();
    deleteRefs(refs);
    state.selected.clear();
    const geloescht = refs.size - gesperrt;
    changed(`Deleted ${geloescht} placement${geloescht === 1 ? '' : 's'}` +
            (gesperrt ? ` (${gesperrt} locked and left alone)` : ''));
  }

  function floodDelete(tile) {
    const placements = placementRefs();
    const ref = topmostRefAtTile(tile);
    const start = placements.find(placement => placement.ref === ref);
    const refs = geometry.floodPlacementRefs(start, placements,
      placement => footprintRects(placement.type, placement.off), refIsLocked, GRID);
    if (!refs.size) return setStatus('Click an unlocked placement to flood delete its connected type. The Keep is protected.');
    pushUndo();
    deleteRefs(refs);
    state.selected.clear();
    changed(`Flood deleted ${refs.size} connected ${itemName(start.type)} placements`);
  }

  function mergeSelectedSteps() {
    try {
      const indexes = selectedBuildFrameIndexes();
      const proposal = geometry.mergeBuildSteps(frames(), indexes, mergeableTypes());
      pushUndo();
      state.document.frames = proposal.frames;
      selectBuildFrame(proposal.index);
      changed(`Merged ${indexes.length} steps at step ${proposal.index + 1}; any pause follows the merged step`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function mergeableTypes() {
    return [...(state.categories.Walls || []), ...(state.categories.Moat || []), 99]; // Pitch
  }

  function placeSingle(tile) {
    if (state.currentItemType == null) return setStatus('Choose an item first.');
    const type = state.currentItemType;
    if (isLineSequence(type)) return setStatus(`${itemName(type)} can only be placed with the Line tool.`);
    const off = xyToOffset(tile.x, tile.y);
    const result = validatePlacement(type, off);
    if (!result.ok) return setStatus(result.reason);
    pushUndo();
    deleteRefs(result.replacements);
    if (isUnitType(type)) {
      const mi = state.document.miscItems.length;
      state.document.miscItems.push({ positionOfset: off, itemType: type, number: countType(type) });
      state.selected = new Set([unitRefKey(mi)]);
      changed(`Placed ${itemName(type)} rallypoint #${unitDisplayNumber(state.document.miscItems[mi].number)} at ${off}`);
    } else {
      insertBuildFrames([{ itemType: type, tilePositionOfsets: [off], shouldPause: false }]);
      changed(`Placed ${itemName(type)} at ${off}`);
    }
  }

  // Ein Pinselzug auf ein Feld. Ist der Pinsel groesser als eins, sind es
  // entsprechend viele Felder - jedes geht durch dieselbe Pruefung wie ein
  // einzelnes, damit ein breiter Pinsel nichts darf, was ein schmaler nicht
  // duerfte.
  function brushAdd(tile) {
    if (state.brushSize > 1) {
      for (const feld of geometry.brushTiles(tile, state.brushSize)) brushAddOne(feld);
      return;
    }
    brushAddOne(tile);
  }

  function brushAddOne(tile) {
    if (state.currentItemType == null) return;
    const type = state.currentItemType;
    if (isLineSequence(type)) return;
    const off = xyToOffset(tile.x, tile.y);
    if (state.brushSeen.has(off)) return;
    state.brushSeen.add(off);

    const pending = state.brushOffsets.map(p => ({ type, off: p }));
    const result = validatePlacement(type, off, {
      ignoreRefs: state.brushReplacements,
      extraNew: pending,
      checkMax: false
    });
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }

    const maximum = maxAmount(type);
    if (maximum != null) {
      const current = countType(type, state.brushReplacements);
      if (current + state.brushOffsets.length + 1 > Number(maximum)) {
        setStatus(`Maximum amount for ${itemName(type)} is ${maximum}.`);
        return;
      }
    }

    state.brushOffsets.push(off);
    state.brushTypes.push(type);
    for (const ref of result.replacements) state.brushReplacements.add(ref);
    scheduleDraw(false);
  }

  function updateLineSequencePreview(start, end) {
    const types = lineSequence(state.currentItemType);
    const tiles = geometry.limitedLineTiles(start, end, types.length);
    state.brushOffsets = tiles.map(tile => xyToOffset(tile.x, tile.y));
    state.brushTypes = types.slice(0, tiles.length);
    state.brushReplacements = new Set();
    state.brushError = '';

    const pending = [];
    for (let index = 0; index < tiles.length && !state.brushError; index++) {
      const type = state.brushTypes[index];
      const off = state.brushOffsets[index];
      const maximum = maxAmount(type);
      const pendingOfType = pending.filter(entry => entry.type === type).length;
      if (maximum != null && countType(type, state.brushReplacements) + pendingOfType >= Number(maximum)) {
        state.brushError = `Maximum amount for ${itemName(type)} is ${maximum}.`;
        break;
      }
      const result = validatePlacement(type, off, {
        ignoreRefs: state.brushReplacements,
        extraNew: pending,
        checkMax: false
      });
      if (!result.ok) {
        state.brushError = result.reason;
        break;
      }
      pending.push({ type, off });
      for (const ref of result.replacements) state.brushReplacements.add(ref);
    }
    setStatus(state.brushError || `${itemName(state.currentItemType)} ready — ${tiles.length}/${types.length} steps — release to place`);
    scheduleDraw(false);
  }

  function commitBrush(toolName = 'Brush') {
    if (state.currentItemType == null || !state.brushOffsets.length) return setStatus(`${toolName} placed nothing.`);
    if (state.brushError) return setStatus(state.brushError);
    const type = state.currentItemType;
    const sequence = lineSequence(type);
    if (sequence.length && (state.brushTypes.length !== state.brushOffsets.length || state.brushOffsets.length > sequence.length)) {
      return setStatus(`Could not build the ${itemName(type)} sequence.`);
    }
    pushUndo();
    deleteRefs(state.brushReplacements);
    if (sequence.length) {
      const newFrames = state.brushOffsets.map((off, index) => ({
        itemType: state.brushTypes[index],
        tilePositionOfsets: [off],
        shouldPause: false
      }));
      insertBuildFrames(newFrames);
      changed(`${itemName(type)}: placed ${newFrames.length} consecutive stair steps`);
    } else if (isUnitType(type)) {
      const firstMi = state.document.miscItems.length;
      let nextNumber = countType(type);
      for (const off of state.brushOffsets) {
        state.document.miscItems.push({ positionOfset: off, itemType: type, number: nextNumber++ });
      }
      state.selected = new Set(state.brushOffsets.map((_off, i) => unitRefKey(firstMi + i)));
      changed(`${toolName}: placed ${state.brushOffsets.length} ${itemName(type)} rallypoints`);
    } else {
      const newFrames = allowsMultiplePerStep(type)
        ? [{ itemType: type, tilePositionOfsets: [...state.brushOffsets], shouldPause: false }]
        : state.brushOffsets.map(off => ({ itemType: type, tilePositionOfsets: [off], shouldPause: false }));
      insertBuildFrames(newFrames);
      changed(allowsMultiplePerStep(type)
        ? `${toolName} step: ${state.brushOffsets.length} × ${itemName(type)}`
        : `${toolName}: placed ${state.brushOffsets.length} ${itemName(type)} in consecutive build steps`);
    }
  }

  function topmostRefAtTile(tile) {
    for (let mi = state.document.miscItems.length - 1; mi >= 0; mi--) {
      const item = state.document.miscItems[mi];
      if (!isUnitType(item.itemType)) continue;
      if (geometry.footprintContainsTile(footprintRects(Number(item.itemType), Number(item.positionOfset)), tile)) return unitRefKey(mi);
    }
    for (let fi = frames().length - 1; fi >= 0; fi--) {
      const frame = frames()[fi];
      const type = Number(frame.itemType);
      const offsets = frame.tilePositionOfsets || [];
      for (let oi = offsets.length - 1; oi >= 0; oi--) {
        if (geometry.footprintContainsTile(footprintRects(type, Number(offsets[oi])), tile)) return frameRefKey(fi, oi);
      }
    }
    return null;
  }

  // The flat editor is the file-oriented plan. Map/start-position rotation
  // belongs only to the 2.5D view; applying it here warped non-square sprites
  // such as the Keep and made the two perspectives unnecessarily coupled.

  function screenRectForXY(type, x, y) {
    const [w, h] = itemSize(type);
    if (isUnitType(type)) {
      return {
        x: state.panX + (x - 0.5) * state.cell,
        y: state.panY + (98.5 - y) * state.cell,
        w: 2 * state.cell,
        h: 2 * state.cell
      };
    }
    return {
      x: state.panX + x * state.cell,
      y: state.panY + (99 - y) * state.cell,
      w: w * state.cell,
      h: h * state.cell
    };
  }

  function screenRectsForPlacement(type, off) {
    return footprintRects(type, off).map(rect => ({
      x: state.panX + rect.left * state.cell,
      y: state.panY + (99 - rect.top) * state.cell,
      w: (rect.right - rect.left + 1) * state.cell,
      h: (rect.top - rect.bottom + 1) * state.cell
    }));
  }

  function refsInMarquee() {
    if (!state.dragStartScreen || !state.marqueeEnd) return new Set();
    const x0 = Math.min(state.dragStartScreen.x, state.marqueeEnd.x);
    const y0 = Math.min(state.dragStartScreen.y, state.marqueeEnd.y);
    const x1 = Math.max(state.dragStartScreen.x, state.marqueeEnd.x);
    const y1 = Math.max(state.dragStartScreen.y, state.marqueeEnd.y);
    const refs = new Set();
    for (const p of placementRefs()) {
      const intersects = screenRectsForPlacement(p.type, p.off).some(r => (
        !(r.x + r.w < x0 || x1 < r.x || r.y + r.h < y0 || y1 < r.y)
      ));
      if (intersects) refs.add(p.ref);
    }
    return refs;
  }

  function captureCopyBuffer(refs) {
    const selected = placementRefs()
      .filter(p => refs.has(p.ref) && p.kind === 'frame' && p.type !== geometry.KEEP_ITEM_TYPE)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'frame' ? -1 : 1;
        return a.kind === 'frame' ? a.fi - b.fi || a.oi - b.oi : a.mi - b.mi;
      });
    if (!selected.length) {
      state.copyBuffer = null;
      return false;
    }

    // Der Punkt, an dem die Kopie am Zeiger haengt: die MITTE dessen, was
    // aufgenommen wurde. Vorher war es die linke obere Ecke, und dann hing
    // die ganze Auswahl rechts unter der Maus statt darum herum - man sah
    // beim Einfuegen nicht, wo sie landet.
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (const p of selected) {
      const xy = offsetToXY(p.off);
      left = Math.min(left, xy.x);
      right = Math.max(right, xy.x);
      bottom = Math.min(bottom, xy.y);
      top = Math.max(top, xy.y);
    }
    const anchorX = Math.round((left + right) / 2);
    const anchorY = Math.round((bottom + top) / 2);

    const groupMap = new Map();
    for (const p of selected) {
      const xy = offsetToXY(p.off);
      const key = p.kind === 'frame' ? `f:${p.fi}` : `u:${p.type}`;
      if (!groupMap.has(key)) groupMap.set(key, { kind: p.kind, itemType: p.type, entries: [] });
      groupMap.get(key).entries.push({
        type: p.type,
        dx: xy.x - anchorX,
        dy: xy.y - anchorY
      });
    }

    state.copyBuffer = {
      groups: Array.from(groupMap.entries())
        .map(([, group]) => group),
      count: selected.length
    };
    return true;
  }

  function copyProposalAt(tile) {
    if (!state.copyBuffer || !tile) return { entries: [], groups: [] };
    const entries = [];
    const groups = state.copyBuffer.groups.map(group => {
      const proposed = group.entries.map(entry => {
        const x = tile.x + entry.dx;
        const y = tile.y + entry.dy;
        const out = { type: entry.type, x, y, off: xyToOffset(x, y) };
        entries.push(out);
        return out;
      });
      return { kind: group.kind, itemType: group.itemType, entries: proposed };
    });
    return { entries, groups };
  }

  function validateCopyAt(tile) {
    if (!state.copyBuffer) return { ok: false, reason: 'Drag over items to copy first.', replacements: new Set(), proposal: null };
    const proposal = copyProposalAt(tile);
    const replacements = new Set();
    const copyCounts = {};

    for (const entry of proposal.entries) {
      const outside = boundsError(entry.type, entry.x, entry.y);
      if (outside) return { ok: false, reason: outside, replacements: new Set(), proposal };
      const key = String(entry.type);
      copyCounts[key] = (copyCounts[key] || 0) + 1;
    }

    for (const [key, amount] of Object.entries(copyCounts)) {
      const type = Number(key);
      const maximum = maxAmount(type);
      if (maximum != null && countType(type) + amount > Number(maximum)) {
        return { ok: false, reason: `Maximum amount for ${itemName(type)} is ${maximum}.`, replacements: new Set(), proposal };
      }
    }

    const existing = placementRefs();
    for (const entry of proposal.entries) {
      if (overlapMode(entry.type) === 'allow') continue;
      const entryFootprint = footprintRectsAtXY(entry.type, entry.x, entry.y);
      for (const other of existing) {
        if (!geometry.footprintsIntersect(entryFootprint, footprintRects(other.type, other.off))) continue;
        const mode = overlapMode(other.type);
        if (mode === 'allow') continue;
        if (mode === 'replace') {
          if (refIsLocked(other.ref)) return { ok: false, reason: 'That build step is locked.', replacements: new Set(), proposal: null };
          replacements.add(other.ref);
          continue;
        }
        return { ok: false, reason: `Copy blocked by ${itemName(other.type)}.`, replacements: new Set(), proposal };
      }
    }
    return { ok: true, reason: '', replacements, proposal };
  }

  function placeCopy(tile) {
    const result = validateCopyAt(tile);
    if (!result.ok) return setStatus(result.reason);
    pushUndo();
    deleteRefs(result.replacements);
    const startUnit = state.document.miscItems.length;
    const newUnitSelection = new Set();
    const newFrames = [];
    const nextUnitNumber = new Map();
    for (const group of result.proposal.groups) {
      const offsets = group.entries.map(entry => xyToOffset(entry.x, entry.y));
      if (group.kind === 'unit') {
        const type = Number(group.itemType);
        let number = nextUnitNumber.has(type) ? nextUnitNumber.get(type) : countType(type);
        for (const off of offsets) {
          const mi = state.document.miscItems.length;
          state.document.miscItems.push({ positionOfset: off, itemType: type, number: number++ });
          newUnitSelection.add(unitRefKey(mi));
        }
        nextUnitNumber.set(type, number);
        continue;
      }
      const type = Number(group.itemType);
      if (allowsMultiplePerStep(type)) {
        newFrames.push({ itemType: type, tilePositionOfsets: offsets, shouldPause: false });
      } else {
        for (const off of offsets) newFrames.push({ itemType: type, tilePositionOfsets: [off], shouldPause: false });
      }
    }
    if (newFrames.length) insertBuildFrames(newFrames);
    else state.selected = newUnitSelection;
    const addedFrames = newFrames.length;
    const addedUnits = state.document.miscItems.length - startUnit;
    const details = [
      addedFrames ? `${addedFrames} build step${addedFrames === 1 ? '' : 's'}` : '',
      addedUnits ? `${addedUnits} rallypoint${addedUnits === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' and ');
    changed(`Placed copy of ${state.copyBuffer.count} placement${state.copyBuffer.count === 1 ? '' : 's'} as ${details}`);
  }

  // Ctrl+C and Ctrl+V - the two handles everybody already knows. They are a
  // short way to the copy tool, never a second way of copying: same buffer,
  // same check, same placing, so a copy made with the keys and one made with
  // the mouse cannot behave differently.
  //
  // What Ctrl+C takes is whatever is selected, with whichever tool it was
  // selected. Units and the Keep are left out here for the same reason the
  // marquee leaves them out - they are not build steps and cannot be copied
  // as such.
  function copySelection() {
    setTool('copy');
    const refs = new Set(placementRefs()
      .filter(p => state.selected.has(p.ref) && p.kind === 'frame' && p.type !== geometry.KEEP_ITEM_TYPE)
      .map(p => p.ref));
    if (!captureCopyBuffer(refs)) {
      setStatus('Nothing to copy yet — drag a box over the placements first');
      return false;
    }
    state.selected = refs;
    renderBuildList();
    scheduleDraw();
    const many = state.copyBuffer.count === 1 ? '' : 's';
    setStatus(`Copied ${state.copyBuffer.count} placement${many} — Ctrl+V puts it where the cursor is`);
    return true;
  }

  // Where the cursor is, because that is where a paste is aimed in every
  // other program. With the cursor off the map there is no honest place to
  // put it, and guessing one would drop a copy somewhere nobody looked.
  function pasteCopy() {
    if (!state.copyBuffer && !copySelection()) return;
    setTool('copy');
    if (!state.hoverTile) {
      setStatus('Move the cursor onto the map, then press Ctrl+V');
      return;
    }
    placeCopy(state.hoverTile);
  }

  // Der Farbeimer: fuellt den zusammenhaengenden freien Bereich um ein Feld
  // herum mit dem gewaehlten Gebaeude. Was besetzt ist, begrenzt ihn - und
  // der Kartenrand ebenso. Gefuellt wird ueber denselben Weg wie ein
  // Pinselzug, also mit denselben Pruefungen und als EIN Bauschritt.
  function bucketFill(tile) {
    if (state.currentItemType == null) return setStatus('Choose an item first.');
    const type = state.currentItemType;
    if (isLineSequence(type)) return setStatus('This item is drawn as a line, not poured.');
    const besetzt = (x, y) => Boolean(topmostRefAtTile({ x, y }));
    const felder = geometry.floodTiles(tile, besetzt);
    if (!felder.length) return setStatus('Nothing to fill here - that tile is taken.');

    state.brushOffsets = [];
    state.brushTypes = [];
    state.brushError = '';
    state.brushSeen = new Set();
    state.brushReplacements = new Set();
    for (const feld of felder) brushAddOne(feld);
    if (!state.brushOffsets.length) return setStatus('Nothing could be placed there.');
    const gesetzt = state.brushOffsets.length;
    commitBrush();
    setStatus('Filled ' + gesetzt + ' tile' + (gesetzt === 1 ? '' : 's') + ' with ' + itemName(type));
  }

  function validateMove(proposed) {
    const selectedRefs = new Set(proposed.keys());
    const replacements = new Set();
    for (const [ref, newOff] of proposed.entries()) {
      const type = refType(ref);
      // Validate from the unwrapped x/y delta. Converting x=100 to an offset first
      // would wrap it onto the next row (5100 -> x=0,y=51).
      const oldOff = state.moveStartOffsets.get(ref);
      const oldXY = offsetToXY(oldOff);
      const x = oldXY.x + state.moveDelta.x;
      const y = oldXY.y + state.moveDelta.y;
      const outside = boundsError(type, x, y);
      if (outside) return { ok: false, reason: outside, replacements: new Set() };
      if (overlapMode(type) === 'allow') continue;
      const movedFootprint = footprintRectsAtXY(type, x, y);
      for (const other of placementRefs()) {
        if (selectedRefs.has(other.ref)) continue;
        if (!geometry.footprintsIntersect(movedFootprint, footprintRects(other.type, other.off))) continue;
        const mode = overlapMode(other.type);
        if (mode === 'allow') continue;
        if (mode === 'replace') {
          // Ueber einen gesperrten Bauschritt wird nicht gebaut.
          if (refIsLocked(other.ref)) return { ok: false, reason: 'That build step is locked.', replacements: new Set() };
          replacements.add(other.ref);
          continue;
        }
        return { ok: false, reason: `Move blocked by ${itemName(other.type)}.`, replacements: new Set() };
      }
    }
    return { ok: true, reason: '', replacements };
  }

  function proposedMove() {
    const proposed = new Map();
    for (const [ref, oldOff] of state.moveStartOffsets.entries()) {
      if (!refExists(ref)) continue;
      const { x, y } = offsetToXY(oldOff);
      const nx = x + state.moveDelta.x;
      const ny = y + state.moveDelta.y;
      if (nx < 0 || nx > 99 || ny < 0 || ny > 99) {
        proposed.set(ref, xyToOffset(nx, ny));
      } else {
        proposed.set(ref, xyToOffset(nx, ny));
      }
    }
    return proposed;
  }

  function commitMove() {
    if (!state.selected.size || (state.moveDelta.x === 0 && state.moveDelta.y === 0)) return scheduleDraw();
    const proposed = proposedMove();
    const result = validateMove(proposed);
    if (!result.ok) {
      state.moveDelta = { x: 0, y: 0 };
      scheduleDraw();
      return setStatus(result.reason);
    }
    pushUndo();
    for (const [ref, newOff] of proposed.entries()) {
      if (!refExists(ref)) continue;
      const parsed = parseRef(ref);
      if (parsed.kind === 'unit') state.document.miscItems[parsed.mi].positionOfset = newOff;
      else frames()[parsed.fi].tilePositionOfsets[parsed.oi] = newOff;
    }
    deleteRefs(result.replacements);
    state.selected.clear();
    changed(`Moved ${proposed.size} placement${proposed.size === 1 ? '' : 's'}`);
  }

  function clearSelectionAndItem() {
    state.selected.clear();
    state.currentItemType = null;
    state.copyBuffer = null;
    state.gesture = null;
    state.brushOffsets = [];
    state.brushTypes = [];
    state.brushError = '';
    state.brushSeen.clear();
    state.brushReplacements.clear();
    updateToolAvailability();
    leavePlacementToolIfDisabled();
    renderPalette();
    updateSelectedItemInfo();
    renderBuildList();
    scheduleDraw();
    setStatus('Selection cleared');
  }

  function toolLabel(tool) {
    return ({ single: 'Single', brush: 'Brush', line: 'Line', select: 'Select / Move', copy: 'Copy Selection', replace: 'Replace Area', delete: 'Delete Area' })[tool] || tool;
  }

  function isPlacementTool(tool) {
    return tool === 'single' || tool === 'brush' || tool === 'line' || tool === 'bucket';
  }

  // Was man ohne gewaehltes Gebaeude nicht tun kann, soll auch nicht
  // anklickbar sein: Single, Line und Brush brauchen etwas zum Setzen und
  // sagten sonst bei jedem Klick "Choose an item first". Das macht den
  // Zustand "nichts gewaehlt" eindeutig - und genau dann ist Ziehen ein
  // Auswahlkasten, ganz gleich welches Werkzeug oben steht (onPointerDown).
  function updateToolAvailability() {
    const lineOnly = state.currentItemType != null && isLineSequence(state.currentItemType);
    const nothingChosen = state.currentItemType == null;
    document.querySelectorAll('.castleTool').forEach(button => {
      const tool = button.dataset.tool;
      button.disabled = (lineOnly && (tool === 'single' || tool === 'brush'))
                     || (nothingChosen && isPlacementTool(tool));
    });
  }

  // Ein gesperrtes Werkzeug darf nicht aktiv stehen bleiben. Wer das Gebaeude
  // abwaehlt - mit Esc oder durch Anklicken eines Bauwerks - landet deshalb
  // beim Auswaehlen, dem einzigen Werkzeug, das ohne Gebaeude etwas tut.
  // Brush size is a shared preference and can be adjusted from any tool.
  function setBrushSize(size) {
    const grenze = geometry.GRID_SIZE || 100;
    state.brushSize = Math.max(1, Math.min(Math.round(size) || 1, grenze));
    updateBrushSizeUI();
    scheduleDraw();
  }

  function updateBrushSizeUI() {
    if (!els.brushSizeOut) return;
    const grenze = geometry.GRID_SIZE || 100;
    els.brushSizeOut.textContent = String(state.brushSize);
    if (els.brushMinus) els.brushMinus.disabled = state.brushSize <= 1;
    if (els.brushPlus) els.brushPlus.disabled = state.brushSize >= grenze;
    const kasten = els.brushSizeOut.parentElement;
    if (kasten) kasten.classList.remove('off');
  }

  function leavePlacementToolIfDisabled() {
    if (state.currentItemType == null && isPlacementTool(state.tool)) setTool('select');
  }

  // A wall is dragged, not dabbed. Which items count as walls is not a list of
  // our own: it is the "Walls" category from config/aiv_categories.json, so it
  // stays right when that file changes.
  function isWallType(type) {
    const walls = state.categories && state.categories.Walls;
    return Array.isArray(walls) && walls.includes(String(type));
  }

  // remember: false for a tool the user did not pick himself. Without it the
  // line tool that a wall brings along would become the remembered choice and
  // then greet him again on the next building.
  function setTool(tool, remember = true) {
    const lineOnly = state.currentItemType != null && isLineSequence(state.currentItemType);
    if (lineOnly && isPlacementTool(tool)) tool = 'line';
    state.tool = tool;
    document.getElementById('castleDeleteModeLabel').hidden = tool !== 'delete';
    if (remember && isPlacementTool(tool) && !lineOnly) state.lastPlacementTool = tool;
    if (tool !== 'copy') state.copyBuffer = null;
    if (tool === 'copy' || tool === 'replace') state.currentItemType = null;
    document.querySelectorAll('.castleTool').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    els.canvas.classList.toggle('tool-select', tool === 'select' || tool === 'copy' || tool === 'replace');
    updateToolAvailability();
    updateBrushSizeUI();
    updateSelectedItemInfo();
    renderPalette();
    setStatus(`${toolLabel(tool)} tool`);
    scheduleDraw();
  }

  function normalizeShortcutKey(value) {
    const key = String(value || '').trim().toLowerCase();
    return /^[a-z0-9]$/.test(key) ? key : '';
  }

  function validateToolShortcuts(candidate) {
    const normalized = {};
    const used = new Set();
    for (const tool of Object.keys(DEFAULT_TOOL_SHORTCUTS)) {
      const supplied = Array.isArray(candidate?.[tool]) ? candidate[tool] : [];
      const keys = [normalizeShortcutKey(supplied[0]), normalizeShortcutKey(supplied[1])];
      if (!keys[0]) throw new Error(`${toolLabel(tool)} needs a primary shortcut.`);
      for (const key of keys) {
        if (!key) continue;
        if (used.has(key)) throw new Error(`The key ${key.toUpperCase()} is assigned more than once.`);
        used.add(key);
      }
      normalized[tool] = keys;
    }
    return normalized;
  }

  function updateToolShortcutHints() {
    document.querySelectorAll('.castleTool').forEach(button => {
      const keys = state.toolShortcuts[button.dataset.tool] || [];
      const labels = keys.filter(Boolean).map(key => key.toUpperCase());
      const badge = button.querySelector('kbd');
      if (badge) badge.textContent = labels[0] || '';
      button.title = labels.length ? `Shortcuts: ${labels.join(' or ')}` : '';
    });
  }

  function loadToolShortcuts() {
    try {
      const saved = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || 'null');
      if (saved) state.toolShortcuts = validateToolShortcuts(saved);
    } catch (error) {
      console.warn('Ignoring invalid saved Castle shortcuts:', error);
      state.toolShortcuts = deepClone(DEFAULT_TOOL_SHORTCUTS);
    }
    try {
      state.camera = camera.validate(JSON.parse(localStorage.getItem(CAMERA_STORAGE_KEY) || 'null') || camera.defaults, state.toolShortcuts);
    } catch { state.camera = { ...camera.defaults }; }
    updateToolShortcutHints();
  }

  function sanitizeOverviewLayout(value) {
    const layout = deepClone(DEFAULT_OVERVIEW_LAYOUT);
    for (const key of Object.keys(layout)) {
      const candidate = value && value[key];
      if (!candidate || typeof candidate !== 'object') continue;
      layout[key].visible = candidate.visible !== false;
      layout[key].side = candidate.side === 'right' ? 'right' : 'left';
    }
    return layout;
  }

  function applyOverviewLayout() {
    const entries = [
      ['population', els.populationOverview],
      ['costs', els.costOverview]
    ];
    for (const [key, panel] of entries) {
      if (!panel) continue;
      const preference = state.overviewLayout[key];
      const parent = preference.side === 'right' ? els.palettePanel : els.buildPanel;
      if (parent && panel.parentElement !== parent) parent.appendChild(panel);
      panel.hidden = !preference.visible;
      panel.dataset.side = preference.side;
    }
  }

  function saveOverviewLayout() {
    try { localStorage.setItem(OVERVIEW_STORAGE_KEY, JSON.stringify(state.overviewLayout)); }
    catch { /* the layout still works for the current window */ }
    window.electronAPI?.setCastleOverviewPreferences?.(state.overviewLayout);
  }

  function loadOverviewLayout() {
    try {
      state.overviewLayout = sanitizeOverviewLayout(JSON.parse(localStorage.getItem(OVERVIEW_STORAGE_KEY) || 'null'));
    } catch {
      state.overviewLayout = deepClone(DEFAULT_OVERVIEW_LAYOUT);
    }
    applyOverviewLayout();
    window.electronAPI?.setCastleOverviewPreferences?.(state.overviewLayout);
  }

  function setOverviewPreference(command) {
    if (!command || !Object.hasOwn(DEFAULT_OVERVIEW_LAYOUT, command.panel)) return;
    if (command.property === 'visible' && typeof command.value === 'boolean') {
      state.overviewLayout[command.panel].visible = command.value;
    } else if (command.property === 'side' && (command.value === 'left' || command.value === 'right')) {
      state.overviewLayout[command.panel].side = command.value;
    } else {
      return;
    }
    applyOverviewLayout();
    saveOverviewLayout();
  }

  function populateCameraDialog(preferences = state.camera) {
    document.getElementById('castleCameraWheel').value = preferences.wheel;
    document.getElementById('castleCameraSpeed').value = preferences.panSpeed;
    for (const input of els.shortcutForm.querySelectorAll('.castleCameraKey')) {
      input.value = preferences[input.dataset.direction].toUpperCase();
    }
  }

  function populateShortcutDialog(shortcuts = state.toolShortcuts, preferences = state.camera) {
    populateCameraDialog(preferences);
    for (const input of els.shortcutForm.querySelectorAll('.castleShortcutKey')) {
      const key = shortcuts[input.dataset.tool]?.[Number(input.dataset.slot)] || '';
      input.value = key.toUpperCase();
    }
    els.shortcutError.textContent = '';
  }

  function showShortcutDialog() {
    populateShortcutDialog();
    els.shortcutDialog.showModal();
    els.shortcutForm.querySelector('.castleShortcutKey')?.focus();
  }

  function shortcutDraft() {
    const draft = {};
    for (const tool of Object.keys(DEFAULT_TOOL_SHORTCUTS)) draft[tool] = ['', ''];
    for (const input of els.shortcutForm.querySelectorAll('.castleShortcutKey')) {
      draft[input.dataset.tool][Number(input.dataset.slot)] = normalizeShortcutKey(input.value);
    }
    return draft;
  }

  function saveShortcutDialog(event) {
    event.preventDefault();
    try {
      const shortcuts = validateToolShortcuts(shortcutDraft());
      const draft = {
        wheel: document.getElementById('castleCameraWheel').value,
        panSpeed: document.getElementById('castleCameraSpeed').value
      };
      for (const input of els.shortcutForm.querySelectorAll('.castleCameraKey')) draft[input.dataset.direction] = input.value;
      const preferences = camera.validate(draft, shortcuts);
      localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
      localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(preferences));
      state.toolShortcuts = shortcuts;
      state.camera = preferences;
      updateToolShortcutHints();
      els.shortcutDialog.close();
      setStatus('Castle shortcuts saved');
    } catch (error) {
      els.shortcutError.textContent = error.message;
    }
  }

  function toolForShortcut(key) {
    const normalized = normalizeShortcutKey(key);
    if (!normalized) return null;
    return Object.entries(state.toolShortcuts).find(([_tool, keys]) => keys.includes(normalized))?.[0] || null;
  }

  function selectItem(type) {
    state.selected.clear();
    state.currentItemType = Number(type);
    // Walls open with the line tool - that is how they are built. The choice is
    // not remembered, so the next ordinary building comes back to what the user
    // had picked before.
    if (isWallType(type)) setTool('line', false);
    else setTool(state.lastPlacementTool);
    renderPalette();
    renderBuildList();
    updateSelectedItemInfo();
    setStatus(`Selected ${itemName(type)} — click the map to place`);
  }

  function updateSelectedItemInfo() {
    if (state.currentItemType == null) {
      els.itemInfo.textContent = 'Select an item';
      return;
    }
    const type = state.currentItemType;
    const info = itemInfo(type);
    const [w, h] = itemSize(type);
    const maximum = maxAmount(type);
    const max = maximum == null ? '∞' : maximum;
    const sequence = lineSequence(type);
    const kind = sequence.length
      ? `line only · up to ${sequence.length} consecutive steps · `
      : isUnitType(type)
      ? 'rallypoint · '
      : `${allowsMultiplePerStep(type) ? 'multiple per step' : 'single per step'} · `;
    const sizeLabel = type === geometry.KEEP_ITEM_TYPE ? `${w}×${h} + forced 5×5 Stockpile` : `${w}×${h}`;
    els.itemInfo.textContent = `${itemName(type)} [${type}] · ${kind}${sizeLabel} · overlap: ${overlapMode(type)} · max: ${max}`;
  }

  function getPaletteGroups() {
    const categorized = new Set();
    const groups = [];
    for (const [category, ids] of Object.entries(state.categories)) {
      const valid = (ids || []).map(String).filter(id => state.constants[id]);
      valid.forEach(id => categorized.add(id));
      groups.push([category, valid]);
    }
    const others = Object.keys(state.constants).filter(id => !categorized.has(id)).sort((a, b) => Number(a) - Number(b));
    if (others.length) groups.push(['Other', others]);
    return groups;
  }

  function renderPalette() {
    const groups = getPaletteGroups();
    if (!groups.length) {
      els.palette.innerHTML = '<div class="paletteEmpty">No item categories configured.</div>';
      return;
    }
    if (!state.activeCategory || !groups.some(([name]) => name === state.activeCategory)) {
      state.activeCategory = groups[0][0];
    }

    els.palette.innerHTML = '';
    const categoryButtons = document.createElement('div');
    categoryButtons.className = 'paletteCategoryButtons';
    for (const [category, ids] of groups) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'paletteCategoryButton';
      const colors = window.castlePalette.categoryStyle(category);
      button.style.setProperty('--category-color', colors.background);
      button.style.setProperty('--category-text', colors.foreground);
      button.setAttribute('aria-pressed', String(category === state.activeCategory));
      if (category === state.activeCategory) button.classList.add('active');
      button.textContent = category;
      button.title = `${category} (${ids.length})`;
      button.addEventListener('click', () => {
        state.activeCategory = category;
        renderPalette();
      });
      categoryButtons.appendChild(button);
    }
    els.palette.appendChild(categoryButtons);

    const active = groups.find(([name]) => name === state.activeCategory) || groups[0];
    const items = document.createElement('div');
    items.className = 'paletteItems';
    const visible = active[1];

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'paletteEmpty';
      empty.textContent = `No items in ${active[0]}.`;
      items.appendChild(empty);
    }

    for (const id of visible) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'paletteItem';
      if (state.currentItemType === Number(id)) row.classList.add('selected');
      row.dataset.itemType = id;
      row.title = `${itemName(id)} [${id}]`;
      row.setAttribute('aria-label', row.title);

      const thumb = document.createElement('span');
      thumb.className = 'paletteThumb';
      const sequence = lineSequence(Number(id));
      const thumbnailType = String(sequence[0] ?? id);
      if (state.skins[thumbnailType]) {
        const img = document.createElement('img');
        img.src = state.skins[thumbnailType];
        img.alt = '';
        thumb.appendChild(img);
      } else {
        thumb.textContent = id;
        thumb.style.background = stableColor(Number(id));
        thumb.style.color = '#111';
      }

      const name = document.createElement('span');
      name.className = 'paletteItemName';
      name.textContent = itemName(id);
      const meta = document.createElement('span');
      meta.className = 'paletteItemMeta';
      const size = itemSize(Number(id));
      meta.textContent = sequence.length
        ? `Line · up to ${sequence.length} steps`
        : Number(id) === geometry.KEEP_ITEM_TYPE
        ? `${size[0]}×${size[1]} + SP`
        : `${size[0]}×${size[1]}`;
      row.append(thumb, name, meta);
      row.addEventListener('click', () => selectItem(Number(id)));
      items.appendChild(row);
    }
    els.palette.appendChild(items);
  }

  // Die Berechnung und die Detaildarstellung der beiden Uebersichten liegen
  // in eigenen castle-cost-Dateien und werden erst vom Burgeditor gebraucht.
  function ladeKostenanzeige() {
    const stil = document.createElement('link');
    stil.rel = 'stylesheet';
    stil.href = 'css/castle-cost-panel.css';
    document.head.appendChild(stil);
    const dateien = ['js/castle-cost-data.js', 'js/castle-balance.js', 'js/castle-production.js', 'js/castle-cost-model.js', 'js/castle-cost-panel.js'];
    const naechste = index => {
      if (index >= dateien.length) { updateCostPanel(); return; }
      const skript = document.createElement('script');
      skript.src = dateien[index];
      skript.onload = () => naechste(index + 1);
      // Faellt eine Datei aus, bleibt der Editor heil - nur der Kostenblock fehlt.
      skript.onerror = () => console.error(`Cost panel: ${dateien[index]} could not be loaded`);
      document.head.appendChild(skript);
    };
    naechste(0);
  }

  // Uebergibt der Kostenanzeige den aktuellen Stand: alle Bauschritte und den
  // Schritt, bis zu dem gerechnet werden soll.
  function updateCostPanel() {
    if (!window.castleCostPanel) return;
    const aktiv = Number.isInteger(state.insertionFrameIndex)
      && state.insertionFrameIndex >= 0 && state.insertionFrameIndex < frames().length
      ? state.insertionFrameIndex
      : null;
    window.castleCostPanel.update({
      frames: frames(),
      stepIndex: aktiv,
      populationData: state.populationData
    });
  }

  function renderBuildList() {
    const mergeButton = document.getElementById('castleMergeSteps');
    try {
      geometry.mergeBuildSteps(frames(), selectedBuildFrameIndexes(), mergeableTypes());
      mergeButton.disabled = false;
    } catch { mergeButton.disabled = true; }
    updatePopulationPanel();
    updateCostPanel();
    els.buildList.innerHTML = '';
    const activeStep = Number.isInteger(state.insertionFrameIndex) && state.insertionFrameIndex >= 0 && state.insertionFrameIndex < frames().length
      ? state.insertionFrameIndex
      : null;
    els.buildSlider.min = '1';
    els.buildSlider.max = String(Math.max(1, frames().length));
    els.buildSlider.value = String(activeStep == null ? 1 : activeStep + 1);
    els.buildSlider.disabled = frames().length === 0;
    els.buildSliderValue.textContent = activeStep == null ? 'No step selected' : `Step ${activeStep + 1}`;
    const rallypointCount = state.document.miscItems.filter(item => isUnitType(item.itemType)).length;
    els.buildCount.textContent = `${frames().length} step${frames().length === 1 ? '' : 's'}`;
    frames().forEach((frame, fi) => {
      const type = Number(frame.itemType);
      const count = (frame.tilePositionOfsets || []).length;
      const row = document.createElement('div');
      row.className = 'buildStep';
      row.draggable = true;
      row.dataset.index = String(fi);
      const allSelected = count > 0 && frame.tilePositionOfsets.every((_off, oi) => state.selected.has(frameRefKey(fi, oi)));
      if (allSelected || fi === state.insertionFrameIndex) row.classList.add('selected');
      if (activeStep != null && fi > activeStep) row.classList.add('future');
      if (fi === activeStep) {
        row.classList.add('current');
        row.setAttribute('aria-current', 'step');
      }

      const index = document.createElement('span');
      index.className = 'buildIndex';
      index.textContent = String(fi + 1);
      const name = document.createElement('span');
      name.className = 'buildName';
      name.textContent = itemName(type);
      name.title = `${itemName(type)} [${type}]`;
      const right = document.createElement('div');
      right.className = 'buildStepControls';
      const meta = document.createElement('span');
      meta.className = 'buildMeta';
      meta.textContent = count > 1 ? `×${count}` : '';
      const up = document.createElement('button');
      up.type = 'button'; up.textContent = '↑'; up.title = 'Move selected step(s) up';
      const down = document.createElement('button');
      down.type = 'button'; down.textContent = '↓'; down.title = 'Move selected step(s) down';
      up.addEventListener('click', e => { e.stopPropagation(); moveBuildSelection(fi, -1); });
      down.addEventListener('click', e => { e.stopPropagation(); moveBuildSelection(fi, 1); });
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'buildLock' + (frame.locked ? ' on' : '');
      lock.textContent = frame.locked ? '🔒' : '🔓';
      lock.title = frame.locked ? 'Locked - click to open' : 'Lock this step against changes';
      lock.addEventListener('click', e => { e.stopPropagation(); toggleFrameLock(fi); });
      if (frame.locked) row.classList.add('locked');
      row.draggable = !frame.locked;
      right.append(meta, lock, up, down);
      row.append(index, name, right);

      row.addEventListener('click', event => {
        const selectedFrames = updateBuildSelection(fi, event);
        renderBuildList();
        scheduleDraw();
        setStatus(selectedFrames.length > 1
          ? `Selected ${selectedFrames.length} build steps — drag or use the arrows to move them together`
          : `Selected build step ${fi + 1} — new buildings will be inserted after it`);
      });
      row.addEventListener('dragstart', e => {
        let selectedFrames = selectedBuildFrameIndexes();
        if (!selectedFrames.includes(fi)) {
          selectBuildFrame(fi);
          selectedFrames = [fi];
          renderBuildList();
        }
        state.dragFrameIndexes = selectedFrames;
        for (const candidate of els.buildList.querySelectorAll('.buildStep')) {
          candidate.classList.toggle('dragging', selectedFrames.includes(Number(candidate.dataset.index)));
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', selectedFrames.join(','));
      });
      row.addEventListener('dragend', () => {
        state.dragFrameIndexes = [];
        for (const candidate of els.buildList.querySelectorAll('.buildStep')) candidate.classList.remove('dragging');
      });
      row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const dragged = state.dragFrameIndexes.length
          ? state.dragFrameIndexes
          : String(e.dataTransfer.getData('text/plain')).split(',').map(Number);
        moveBuildSteps(dragged, fi);
      });
      els.buildList.appendChild(row);
    });
  }

  function selectBuildStepFromSlider() {
    if (els.buildSlider.disabled || frames().length === 0) return;
    const frameIndex = Math.max(0, Math.min(frames().length - 1, Number(els.buildSlider.value) - 1));
    selectBuildFrame(frameIndex);
    renderBuildList();
    els.buildList.querySelector(`.buildStep[data-index="${frameIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    scheduleDraw();
    setStatus(`Selected build step ${frameIndex + 1} — new buildings will be inserted after it`);
  }

  function unlockedFrameIndexes(indexes) {
    return indexes.filter(fi => !frameIsLocked(fi));
  }

  // Ein gesperrter Bauschritt wird nicht umgehaengt - aber er haelt die anderen
  // auch nicht mehr auf. Wer fuenf waehlt und einen davon gesperrt hat, bewegt
  // vier. Die eine Stelle fuer beide Wege, Pfeile wie Ziehen.
  function moveBuildSteps(indexes, targetIndex) {
    if (!indexes.length) return false;
    const beweglich = unlockedFrameIndexes(indexes);
    if (!beweglich.length) {
      setStatus('Locked - unlock the build step first.');
      return false;
    }
    const festgehalten = indexes.length - beweglich.length;
    pushUndo();
    const result = geometry.moveBuildSteps(frames(), beweglich, targetIndex);
    if (!result.moved) {
      state.undo.pop();
      return false;
    }
    const movedIndexes = Array.from(
      { length: result.endIndex - result.startIndex + 1 },
      (_unused, index) => result.startIndex + index
    );
    selectBuildFrames(movedIndexes, result.endIndex);
    changed(`${movedIndexes.length} build step${movedIndexes.length === 1 ? '' : 's'} moved together`
      + (festgehalten ? ` (${festgehalten} locked and left alone)` : ''));
    return true;
  }

  function moveBuildSelection(clickedIndex, direction) {
    let selectedFrames = selectedBuildFrameIndexes();
    if (!selectedFrames.includes(clickedIndex)) {
      selectBuildFrame(clickedIndex);
      selectedFrames = [clickedIndex];
    }
    // Das Ziel richtet sich nach dem, was sich wirklich bewegt: ein gesperrter
    // Schritt am Rand der Auswahl darf nicht mit uebersprungen werden, sonst
    // huepft die Auswahl ueber ihn hinweg statt hinter ihn.
    const beweglich = unlockedFrameIndexes(selectedFrames);
    if (!beweglich.length) {
      setStatus('Locked - unlock the build step first.');
      return false;
    }
    const selected = new Set(beweglich);
    let target = direction < 0 ? Math.min(...beweglich) - 1 : Math.max(...beweglich) + 1;
    while (target >= 0 && target < frames().length && selected.has(target)) target += direction;
    if (target < 0 || target >= frames().length) return false;
    return moveBuildSteps(selectedFrames, target);
  }

  function loadSkinImages() {
    state.skinImages = {};
    for (const [id, url] of Object.entries(state.skins)) {
      const img = new Image();
      img.onload = scheduleDraw;
      img.src = url;
      state.skinImages[id] = img;
    }
  }

  function applyLoadedSkins(loaded) {
    state.skins = loaded?.skins || loaded || {};
    state.customSkinTypes = new Set((loaded?.customSkinTypes || []).map(String));
    loadSkinImages();
  }

  async function setSkin() {
    if (state.currentItemType == null) return;
    const id = String(state.currentItemType);
    const url = await window.electronAPI.chooseAivSkin(state.currentItemType);
    if (!url) return;
    state.skins[id] = url;
    state.customSkinTypes.add(id);
    loadSkinImages();
    renderPalette();
    updateSelectedItemInfo();
    setStatus(`Set PNG skin for ${itemName(state.currentItemType)}`);
  }

  async function removeSkin() {
    if (state.currentItemType == null) return;
    await window.electronAPI.removeAivSkin(state.currentItemType);
    applyLoadedSkins(await window.electronAPI.loadAivSkins());
    renderPalette();
    updateSelectedItemInfo();
    scheduleDraw();
    setStatus(`Removed skin for ${itemName(state.currentItemType)}`);
  }

  function resizeCanvas() {
    const rect = els.host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(MAX_RENDER_DPR, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (state.canvasWidth === width && state.canvasHeight === height && els.canvas.width === Math.floor(width * dpr)) return;
    state.canvasWidth = width;
    state.canvasHeight = height;
    state.renderDpr = dpr;
    els.canvas.width = Math.floor(width * dpr);
    els.canvas.height = Math.floor(height * dpr);
    staticCacheCanvas.width = els.canvas.width;
    staticCacheCanvas.height = els.canvas.height;
    futureCacheCanvas.width = els.canvas.width;
    futureCacheCanvas.height = els.canvas.height;
    els.canvas.style.width = `${width}px`;
    els.canvas.style.height = `${height}px`;
    displayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    futureCacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.staticCacheDirty = true;
    if (!state.centeredOnce) {
      state.centeredOnce = true;
      centerMap();
    } else {
      clampPan();
      scheduleDraw();
    }
  }

  function centerMap() {
    if (!state.canvasWidth || !state.canvasHeight) resizeCanvas();
    const map = GRID * state.cell;
    state.panX = (state.canvasWidth - map) / 2;
    state.panY = (state.canvasHeight - map) / 2;
    scheduleDraw();
  }

  function clampPan() {
    const map = GRID * state.cell;
    const margin = 40;
    if (map <= state.canvasWidth) state.panX = (state.canvasWidth - map) / 2;
    else state.panX = Math.min(margin, Math.max(state.canvasWidth - map - margin, state.panX));
    if (map <= state.canvasHeight) state.panY = (state.canvasHeight - map) / 2;
    else state.panY = Math.min(margin, Math.max(state.canvasHeight - map - margin, state.panY));
  }

  function invalidatePlacementCache() {
    state.placementCache = null;
    state.staticCacheDirty = true;
  }

  // Anyone who wants to know when the map changed subscribes here. This way
  // the editor never learns a foreign name - without it every second view
  // would need its own line in this file.
  const changeListeners = new Set();
  function addChangeListener(listener) {
    if (typeof listener === 'function') changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  }

  function scheduleDraw(staticChanged = true) {
    if (staticChanged) state.staticCacheDirty = true;
    if (state.renderPending) return;
    state.renderPending = true;
    requestAnimationFrame(() => {
      state.renderPending = false;
      draw();
      for (const listener of changeListeners) {
        try { listener(staticChanged); } catch { /* a watcher must not stop the map */ }
      }
    });
  }

  function updateBlueprintControls() {
    const loaded = Boolean(state.blueprintImage);
    els.blueprintControls.hidden = !loaded;
    els.showBlueprint.disabled = !loaded;
    els.blueprintOpacity.disabled = !loaded;
    els.showBlueprint.checked = state.blueprintVisible;
    els.blueprintOpacity.value = String(Math.round(state.blueprintOpacity * 100));
    els.blueprintOpacityValue.textContent = `${Math.round(state.blueprintOpacity * 100)}%`;
  }

  async function chooseBlueprint() {
    if (blueprintDialogOpen) return false;
    blueprintDialogOpen = true;
    try {
      const selection = await window.electronAPI.chooseCastleBackground();
      if (!selection) return false;
      loadBlueprintSelection(selection);
      return true;
    } catch (error) {
      setStatus(`Could not load background: ${error.message}`);
      return false;
    } finally {
      blueprintDialogOpen = false;
    }
  }

  function clearBlueprint({ announce = true } = {}) {
    state.blueprintLoadToken += 1;
    state.blueprintImage = null;
    state.blueprintFileName = '';
    updateBlueprintControls();
    scheduleDraw();
    if (announce) setStatus('Temporary blueprint cleared');
  }

  function loadBlueprintSelection(selection) {
    if (!selection?.dataUrl) return;
    const token = ++state.blueprintLoadToken;
    const image = new Image();
    image.onload = () => {
      if (token !== state.blueprintLoadToken) return;
      state.blueprintImage = image;
      state.blueprintFileName = selection.fileName || 'background image';
      state.blueprintVisible = true;
      updateBlueprintControls();
      scheduleDraw();
      setStatus(`Temporary blueprint loaded: ${state.blueprintFileName}`);
    };
    image.onerror = () => {
      if (token !== state.blueprintLoadToken) return;
      setStatus('Could not open the selected blueprint image');
    };
    image.src = selection.dataUrl;
  }

  function drawBlueprint(mapSize) {
    if (!state.blueprintVisible || !imageReady(state.blueprintImage)) return;
    ctx.save();
    ctx.globalAlpha = state.blueprintOpacity;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.blueprintImage, state.panX, state.panY, mapSize, mapSize);
    ctx.restore();
  }

  function clearCacheContext(cacheCtx, cacheCanvas) {
    cacheCtx.save();
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
    cacheCtx.restore();
  }

  function rebuildStaticCache() {
    clearCacheContext(staticCacheCtx, staticCacheCanvas);
    clearCacheContext(futureCacheCtx, futureCacheCanvas);

    ctx = staticCacheCtx;
    ctx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, state.canvasWidth, state.canvasHeight);
    const mapSize = GRID * state.cell;
    if (mapBackground.complete && mapBackground.naturalWidth) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mapBackground, state.panX, state.panY, mapSize, mapSize);
      ctx.restore();
    } else {
      ctx.fillStyle = css('--map-bg', '#171a1f');
      ctx.fillRect(state.panX, state.panY, mapSize, mapSize);
    }

    drawBlueprint(mapSize);
    if (els.showCompatibility.checked) drawCompatibilityGuide(mapSize);
    drawGrid(mapSize);

    const movingRefs = state.gesture === 'move' ? state.moveStartOffsets : null;
    const activeStep = Number.isInteger(state.insertionFrameIndex) ? state.insertionFrameIndex : null;
    const futurePlacements = [];
    const unitPlacements = [];
    for (const placement of placementRefs()) {
      if (movingRefs?.has(placement.ref)) continue;
      if (placement.kind === 'unit') {
        unitPlacements.push(placement);
      } else if (activeStep != null && placement.fi > activeStep) {
        futurePlacements.push(placement);
      } else {
        drawPlacement(placement.type, placement.off, state.selected.has(placement.ref));
      }
    }

    if (futurePlacements.length) {
      ctx = futureCacheCtx;
      for (const placement of futurePlacements) {
        drawPlacement(placement.type, placement.off);
      }
      futureCacheCtx.save();
      futureCacheCtx.globalCompositeOperation = 'source-atop';
      futureCacheCtx.fillStyle = FUTURE_TINT;
      futureCacheCtx.fillRect(0, 0, state.canvasWidth, state.canvasHeight);
      futureCacheCtx.restore();

      staticCacheCtx.save();
      staticCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
      staticCacheCtx.globalAlpha = FUTURE_OPACITY;
      staticCacheCtx.filter = FUTURE_FILTER;
      staticCacheCtx.drawImage(futureCacheCanvas, 0, 0);
      staticCacheCtx.restore();

      ctx = staticCacheCtx;
      for (const placement of futurePlacements) {
        if (state.selected.has(placement.ref)) drawPlacementOutline(placement.type, placement.off);
      }
    }

    ctx = staticCacheCtx;
    drawAnalysisOverlay();
    for (const placement of unitPlacements) {
      drawPlacement(placement.type, placement.off, state.selected.has(placement.ref));
    }

    ctx = displayCtx;
    state.staticCacheDirty = false;
  }

  let analysisCache = null;
  function getAnalysisOverlay() {
    const showFire = document.getElementById('castleShowFire').checked;
    const showRoutes = document.getElementById('castleShowRoutes').checked;
    if (!showFire && !showRoutes) return { heat: [], routes: [] };
    const data = window.castleCostData;
    const placements = placementRefs().filter(p => p.kind !== 'unit'
      && (!Number.isInteger(state.insertionFrameIndex) || p.fi <= state.insertionFrameIndex)).flatMap(p => {
      const name = data?.buildings[p.type]?.balance;
      const rects = footprintRects(p.type, p.off);
      const item = { ref: p.ref, name, rects, worker: !!state.populationData?.population_effects?.requires?.[p.type] };
      // The keep forces an attached stockpile, encoded as a composite footprint.
      return p.type === geometry.KEEP_ITEM_TYPE && rects.length > 1
        ? [{ ...item, rects: rects.filter(r => r.part !== 'stockpile') }, { ref: `${p.ref}:stockpile`, name: 'Stockpile', rects: rects.filter(r => r.part === 'stockpile') }]
        : [item];
    });
    const key = JSON.stringify([showFire, showRoutes, placements]);
    if (analysisCache?.key === key) return analysisCache.value;
    const value = { heat: showFire ? window.castleAnalysis.fireExposure(placements) : [],
      routes: showRoutes ? window.castleAnalysis.routes(placements) : [] };
    analysisCache = { key, value };
    return value;
  }
  function drawAnalysisOverlay() {
    const overlay = getAnalysisOverlay();
    const info = document.getElementById('castleAnalysisInfo');
    info.hidden = !document.getElementById('castleShowFire').checked && !document.getElementById('castleShowRoutes').checked;
    const notes = [];
    if (document.getElementById('castleShowFire').checked) notes.push('Orange: relative direct fire exposure; red: sampled reach. Flammable buildings only. Terrain, suppression and chain fires are not simulated.');
    if (document.getElementById('castleShowRoutes').checked) {
      const reachable = overlay.routes.filter(r => r.path.length);
      const average = reachable.length ? Math.round(100 * reachable.reduce((sum, r) => sum + r.efficiency, 0) / reachable.length) : null;
      notes.push(`Routes: ${reachable.length}/${overlay.routes.length} reachable; ${average == null ? '—' : average + '%'} direct-distance efficiency. AIV-only stockpile paths; ignores height, gate passages, traffic and terrain.`);
    }
    info.textContent = notes.join(' ');
    ctx.save();
    const cells = new Set(overlay.heat.map(c => c.y * GRID + c.x));
    for (const c of overlay.heat) {
      const x = state.panX + c.x * state.cell, y = state.panY + (99 - c.y) * state.cell;
      ctx.fillStyle = `rgba(255,112,16,${0.035 + 0.34 * Math.sqrt(c.intensity)})`;
      ctx.fillRect(x, y, state.cell, state.cell);
      ctx.strokeStyle = 'rgba(235,45,38,0.85)'; ctx.lineWidth = 1.3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [dx, dy, ax, ay, bx, by] of [[-1,0,0,0,0,1],[1,0,1,0,1,1],[0,1,0,0,1,0],[0,-1,0,1,1,1]]) {
        if (c.x + dx >= 0 && c.x + dx < GRID && c.y + dy >= 0 && c.y + dy < GRID && cells.has((c.y + dy) * GRID + c.x + dx)) continue;
        ctx.beginPath(); ctx.moveTo(x + ax * state.cell, y + ay * state.cell); ctx.lineTo(x + bx * state.cell, y + by * state.cell); ctx.stroke();
      }
    }
    for (const route of overlay.routes) {
      if (!route.path.length) continue;
      ctx.strokeStyle = '#64e8ef'; ctx.lineWidth = 1.5; ctx.beginPath();
      route.path.forEach((tile, i) => {
        const x = state.panX + (tile.x + .5) * state.cell, y = state.panY + (99 - tile.y + .5) * state.cell;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }); ctx.stroke();
      const tile = route.entry;
      ctx.fillStyle = '#64e8ef'; ctx.fillRect(state.panX + tile.x * state.cell, state.panY + (99 - tile.y) * state.cell, state.cell, state.cell);
    }
    ctx.restore();
  }

  function draw() {
    if (!state.canvasWidth || !state.canvasHeight) return;
    if (state.staticCacheDirty) rebuildStaticCache();

    ctx = displayCtx;
    displayCtx.save();
    displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    displayCtx.drawImage(staticCacheCanvas, 0, 0);
    displayCtx.restore();

    const proposed = state.gesture === 'move' ? proposedMove() : null;

    if (proposed) {
      const moveCheck = validateMove(proposed);
      for (const [ref, off] of proposed.entries()) {
        if (!refExists(ref)) continue;
        drawPlacement(refType(ref), off, true, moveCheck.ok ? css('--selected', '#ffb24d') : css('--danger', '#d75f5f'), 0.82);
      }
    }

    if ((state.gesture === 'brush' || state.gesture === 'line') && state.currentItemType != null) {
      const color = state.brushError ? css('--danger', '#d75f5f') : css('--valid', '#55c271');
      state.brushOffsets.forEach((off, index) => {
        drawPlacement(state.brushTypes[index] ?? state.currentItemType, off, false, color, 0.62, true);
      });
    }

    if (state.hoverTile && state.currentItemType != null && (state.tool === 'single' || state.tool === 'brush' || state.tool === 'line') && state.gesture !== 'brush' && state.gesture !== 'line') {
      const previewType = lineSequence(state.currentItemType)[0] ?? state.currentItemType;
      // Beim Pinsel zeigt die Vorschau die ganze Breite - sonst sieht man die
      // eingestellte Groesse erst, wenn schon gemalt ist.
      const felder = state.tool === 'brush' && state.brushSize > 1
        ? geometry.brushTiles(state.hoverTile, state.brushSize)
        : [state.hoverTile];
      for (const feld of felder) {
        const off = xyToOffset(feld.x, feld.y);
        const result = validatePlacement(previewType, off);
        const color = !result.ok ? css('--danger', '#d75f5f') : result.replacements.size ? css('--replace', '#dda94b') : css('--valid', '#55c271');
        drawPlacement(previewType, off, false, color, 0.48, true);
      }
    }

    if (state.tool === 'copy' && state.copyBuffer && state.hoverTile && state.gesture !== 'copy-marquee') {
      const result = validateCopyAt(state.hoverTile);
      const color = !result.ok ? css('--danger', '#d75f5f') : result.replacements.size ? css('--replace', '#dda94b') : css('--valid', '#55c271');
      for (const entry of result.proposal?.entries || []) {
        drawPlacementXY(entry.type, entry.x, entry.y, false, color, 0.55, true);
      }
    }

    // Draw markers last so stacked sprites cannot cover their numbers or counts.
    drawUnitMarkers(proposed);

    if ((state.gesture === 'select-marquee' || state.gesture === 'copy-marquee' || state.gesture === 'replace-marquee' || state.gesture === 'delete-marquee') && state.dragStartScreen && state.marqueeEnd) {
      const x = Math.min(state.dragStartScreen.x, state.marqueeEnd.x);
      const y = Math.min(state.dragStartScreen.y, state.marqueeEnd.y);
      const w = Math.abs(state.dragStartScreen.x - state.marqueeEnd.x);
      const h = Math.abs(state.dragStartScreen.y - state.marqueeEnd.y);
      const deleting = state.gesture === 'delete-marquee';
      const copying = state.gesture === 'copy-marquee';
      const replacing = state.gesture === 'replace-marquee';
      ctx.save();
      ctx.fillStyle = deleting ? 'rgba(215,95,95,.16)' : copying ? 'rgba(174,120,255,.16)' : replacing ? 'rgba(221,169,75,.18)' : 'rgba(58,123,213,.15)';
      ctx.strokeStyle = deleting ? css('--danger', '#d75f5f') : copying ? css('--copy', '#ae78ff') : replacing ? css('--replace', '#dda94b') : css('--accent', '#3a7bd5');
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
    if (els.showCompatibility.checked) drawCompatibilityOriginMarker();
    drawHoveredItemName();
  }

  function itemLabelAtTile(tile) {
    const ref = tile && topmostRefAtTile(tile);
    return ref ? `${itemName(refType(ref))} [${refType(ref)}]` : '';
  }

  // Tiny footprints and long names cannot fit an in-sprite label. A hover
  // label provides their full name without printing thousands of wall labels.
  function drawHoveredItemName() {
    if (!els.showNames.checked || state.gesture || state.panning) return;
    const label = itemLabelAtTile(state.hoverTile);
    if (!label) return;
    const pos = tileToScreenPos(state.hoverTile);
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    const width = Math.min(state.canvasWidth, ctx.measureText(label).width + 16);
    const x = Math.max(0, Math.min(state.canvasWidth - width, pos.x + 12));
    const y = Math.max(0, Math.min(state.canvasHeight - 26, pos.y - 30));
    ctx.fillStyle = 'rgba(16,20,24,.95)';
    ctx.fillRect(x, y, width, 26);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 8, y + 13, Math.max(1, width - 16));
    ctx.restore();
  }

  function drawCompatibilityGuide(mapSize) {
    const margin = 14 * state.cell;
    const safeSize = mapSize - margin * 2;
    ctx.save();
    ctx.fillStyle = 'rgba(194, 67, 60, .20)';
    ctx.fillRect(state.panX, state.panY, mapSize, margin);
    ctx.fillRect(state.panX, state.panY + mapSize - margin, mapSize, margin);
    ctx.fillRect(state.panX, state.panY + margin, margin, safeSize);
    ctx.fillRect(state.panX + mapSize - margin, state.panY + margin, margin, safeSize);

    ctx.strokeStyle = 'rgba(255, 190, 74, .95)';
    ctx.lineWidth = Math.max(2, Math.min(4, state.cell / 2));
    ctx.strokeRect(
      state.panX + margin,
      state.panY + margin,
      safeSize,
      safeSize
    );

    const keep = offsetToXY(DEFAULT_KEEP_OFFSET);
    const keepScreenX = state.panX + keep.x * state.cell;
    const keepScreenY = state.panY + (99 - keep.y) * state.cell;
    ctx.fillStyle = 'rgba(64, 184, 108, .72)';
    ctx.fillRect(keepScreenX, keepScreenY, state.cell, state.cell);
    ctx.strokeStyle = 'rgba(221, 255, 230, .98)';
    ctx.lineWidth = Math.max(1, Math.min(3, state.cell / 3));
    ctx.strokeRect(keepScreenX + .5, keepScreenY + .5, Math.max(0, state.cell - 1), Math.max(0, state.cell - 1));
    ctx.restore();
  }

  function drawCompatibilityOriginMarker() {
    const keep = offsetToXY(DEFAULT_KEEP_OFFSET);
    const x = state.panX + keep.x * state.cell;
    const y = state.panY + (99 - keep.y) * state.cell;
    ctx.save();
    ctx.strokeStyle = 'rgba(102, 255, 155, .98)';
    ctx.lineWidth = Math.max(2, Math.min(4, state.cell / 2));
    ctx.setLineDash([Math.max(2, state.cell / 2), Math.max(2, state.cell / 3)]);
    ctx.strokeRect(x + 1, y + 1, Math.max(0, state.cell - 2), Math.max(0, state.cell - 2));
    ctx.restore();
  }

  function drawGrid(mapSize) {
    const minor = css('--grid', '#272c34');
    const major = css('--grid-major', '#414956');
    ctx.save();
    ctx.lineWidth = 1;
    const minorPath = new Path2D();
    const majorPath = new Path2D();
    for (let i = 0; i <= GRID; i++) {
      const p = Math.round(state.panX + i * state.cell) + 0.5;
      const q = Math.round(state.panY + i * state.cell) + 0.5;
      const path = i % 10 === 0 ? majorPath : minorPath;
      path.moveTo(p, state.panY);
      path.lineTo(p, state.panY + mapSize);
      path.moveTo(state.panX, q);
      path.lineTo(state.panX + mapSize, q);
    }
    ctx.strokeStyle = minor;
    ctx.stroke(minorPath);
    ctx.strokeStyle = major;
    ctx.stroke(majorPath);
    ctx.restore();
  }

  function drawPlacement(type, off, selected = false, outlineOverride = null, alpha = 1, preview = false) {
    const { x, y } = offsetToXY(off);
    drawPlacementXY(type, x, y, selected, outlineOverride, alpha, preview);
  }

  function drawPlacementOutline(type, off, color = css('--selected', '#ffb24d')) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (const rect of screenRectsForPlacement(type, off)) {
      ctx.strokeRect(rect.x + .5, rect.y + .5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1));
    }
    ctx.restore();
  }

  function screenRectForFootprintRect(rect) {
    return {
      x: state.panX + rect.left * state.cell,
      y: state.panY + (99 - rect.top) * state.cell,
      w: (rect.right - rect.left + 1) * state.cell,
      h: (rect.top - rect.bottom + 1) * state.cell
    };
  }

  function imageReady(image) {
    return image?.complete && image.naturalWidth;
  }

  function drawItemName(type, rect) {
    if (!els.showNames.checked || isUnitType(type)) return;
    const [width, height] = itemSize(type);
    if (width < 2 || height < 2) return;
    drawSkinLabel(itemName(type), rect, 10, 4);
  }

  function drawSkinLabel(label, rect, minReadableFontSize = 0, padding = 2) {
    const maxWidth = Math.max(1, rect.w - padding * 2);
    const maxHeight = Math.max(1, rect.h - padding * 2);
    let fontSize = Math.max(6, Math.min(16, state.cell * 1.4));
    let lines;
    let widest;

    ctx.save();
    // Wrap full words, then shrink further for small tiles or long names.
    while (true) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      lines = [''];
      for (const word of label.split(/\s+/)) {
        const last = lines.length - 1;
        const candidate = lines[last] ? `${lines[last]} ${word}` : word;
        if (lines[last] && ctx.measureText(candidate).width > maxWidth) lines.push(word);
        else lines[last] = candidate;
      }
      widest = Math.max(...lines.map(line => ctx.measureText(line).width));
      if ((widest <= maxWidth && lines.length * fontSize * 1.15 <= maxHeight) || fontSize <= 6) break;
      fontSize = Math.max(6, fontSize - 1);
    }
    fontSize *= Math.min(1, maxWidth / Math.max(1, widest), maxHeight / (lines.length * fontSize * 1.15));
    if (fontSize < minReadableFontSize) {
      ctx.restore();
      return;
    }
    const lineHeight = fontSize * 1.15;
    const centerX = rect.x + rect.w / 2;
    const firstY = rect.y + rect.h / 2 - (lines.length - 1) * lineHeight / 2;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.min(3, Math.max(0.5, fontSize / 4));
    ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.fillStyle = '#fff';
    lines.forEach((line, index) => {
      const y = firstY + index * lineHeight;
      ctx.strokeText(line, centerX, y);
      ctx.fillText(line, centerX, y);
    });
    ctx.restore();
  }

  function drawUnitMarkers(proposed = null) {
    const stacks = new Map();
    for (const placement of placementRefs()) {
      if (placement.kind !== 'unit') continue;
      const off = proposed?.get(placement.ref) ?? placement.off;
      const stack = stacks.get(off) || { count: 0, top: null };
      stack.count += 1;
      // Moving sprites are drawn above stationary ones, even if stored earlier.
      if (!stack.top || proposed?.has(placement.ref) || !proposed?.has(stack.top.ref)) stack.top = placement;
      stacks.set(off, stack);
    }
    for (const [off, stack] of stacks) {
      const { x, y } = offsetToXY(off);
      const rect = screenRectForXY(stack.top.type, x, y);
      if (rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > state.canvasWidth || rect.y > state.canvasHeight) continue;
      if (els.showUnitNumbers.checked) drawSkinLabel(`#${unitDisplayNumber(stack.top.number)}`, rect);
      if (stack.count < 2) continue;

      ctx.save();
      const fontSize = Math.max(8, Math.min(12, state.cell));
      const label = `×${stack.count}`;
      ctx.font = `bold ${fontSize}px sans-serif`;
      const badgeWidth = ctx.measureText(label).width + 6;
      const badgeHeight = fontSize + 4;
      const left = Math.max(0, Math.min(state.canvasWidth - badgeWidth, rect.x + rect.w - badgeWidth));
      const top = Math.max(0, rect.y - badgeHeight + 2);
      ctx.fillStyle = '#e9b45f';
      ctx.beginPath();
      ctx.roundRect(left, top, badgeWidth, badgeHeight, 3);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#171a1f';
      ctx.fillText(label, left + badgeWidth / 2, top + badgeHeight / 2);
      ctx.restore();
    }
  }

  function drawKeepCompositeXY(x, y, selected, outlineOverride, alpha, preview) {
    const footprint = footprintRectsAtXY(geometry.KEEP_ITEM_TYPE, x, y);
    const keepParts = footprint.filter(rect => rect.part === 'keep');
    const stockpilePart = footprint.find(rect => rect.part === 'stockpile');
    const keepImage = state.skinImages[String(geometry.KEEP_ITEM_TYPE)] || bundledKeepImage;
    const stockpileImage = state.skinImages[String(geometry.FORCED_STOCKPILE_ITEM_TYPE)] || bundledStockpileImage;
    const keepArtRect = screenRectForXY(geometry.KEEP_ITEM_TYPE, x, y);
    const stockpileRect = screenRectForFootprintRect(stockpilePart);
    const screenParts = footprint.map(screenRectForFootprintRect);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (imageReady(keepImage)) {
      ctx.save();
      ctx.beginPath();
      for (const part of keepParts.map(screenRectForFootprintRect)) ctx.rect(part.x, part.y, part.w, part.h);
      ctx.clip();
      ctx.drawImage(keepImage, keepArtRect.x, keepArtRect.y, keepArtRect.w, keepArtRect.h);
      ctx.restore();
    } else {
      ctx.fillStyle = stableColor(geometry.KEEP_ITEM_TYPE);
      for (const part of keepParts.map(screenRectForFootprintRect)) ctx.fillRect(part.x, part.y, part.w, part.h);
    }

    if (imageReady(stockpileImage)) {
      ctx.drawImage(stockpileImage, stockpileRect.x, stockpileRect.y, stockpileRect.w, stockpileRect.h);
    } else {
      ctx.fillStyle = stableColor(geometry.FORCED_STOCKPILE_ITEM_TYPE);
      ctx.fillRect(stockpileRect.x, stockpileRect.y, stockpileRect.w, stockpileRect.h);
    }

    if (preview) {
      ctx.fillStyle = outlineOverride || css('--valid', '#55c271');
      ctx.globalAlpha = alpha * 0.24;
      for (const part of screenParts) ctx.fillRect(part.x, part.y, part.w, part.h);
      ctx.globalAlpha = alpha;
    }

    if (selected) {
      ctx.strokeStyle = outlineOverride || css('--selected', '#ffb24d');
      ctx.lineWidth = 3;
      for (const part of screenParts) {
        ctx.strokeRect(part.x + .5, part.y + .5, Math.max(0, part.w - 1), Math.max(0, part.h - 1));
      }
    }

    drawItemName(geometry.KEEP_ITEM_TYPE, keepArtRect);
    drawItemName(geometry.FORCED_STOCKPILE_ITEM_TYPE, stockpileRect);

    ctx.restore();
  }

  function drawPlacementXY(type, x, y, selected = false, outlineOverride = null, alpha = 1, preview = false) {
    if (Number(type) === geometry.KEEP_ITEM_TYPE) {
      drawKeepCompositeXY(x, y, selected, outlineOverride, alpha, preview);
      return;
    }
    const r = screenRectForXY(type, x, y);
    const img = state.skinImages[String(type)];
    ctx.save();
    ctx.globalAlpha = alpha;
    if (img?.complete && img.naturalWidth) {
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      if (preview) {
        ctx.fillStyle = outlineOverride || css('--valid', '#55c271');
        ctx.globalAlpha = alpha * 0.24;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = alpha;
      }
    } else {
      ctx.fillStyle = stableColor(type);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    if (selected) {
      ctx.strokeStyle = outlineOverride || css('--selected', '#ffb24d');
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + .5, r.y + .5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    }

    drawItemName(type, r);

    ctx.restore();
  }

  function css(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function pointerPosition(event) {
    // Events coming from another view (2.5D) already know which tile they
    // mean; this canvas is hidden then and its rectangle would be empty.
    if (event && event.tileFromOutside) return tileToScreenPos(event.tileFromOutside);
    const rect = els.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // Centre of a tile, in this map's screen coordinates
  function tileToScreenPos(tile) {
    return {
      x: state.panX + (tile.x + 0.5) * state.cell,
      y: state.panY + (99 - tile.y + 0.5) * state.cell
    };
  }

  function screenToTile(pos) {
    const localX = (pos.x - state.panX) / state.cell;
    const localY = (pos.y - state.panY) / state.cell;
    const x = Math.floor(localX);
    const row = Math.floor(localY);
    const y = 99 - row;
    if (x < 0 || x > 99 || y < 0 || y > 99) return null;
    return { x, y };
  }

  // A pointer that belongs to another canvas - the 2.5D view, docked into the
  // same page - must stay there. Capturing it here would take the rest of the
  // gesture away from it: every further move and the release would land on
  // this canvas, be measured against this canvas's rectangle instead of the
  // tile that was clicked, and the 2.5D view would never see its own
  // pointerup, so its stroke would stay switched on for good. While the view
  // was a window of its own the id did not exist here and the call simply
  // threw; docked it succeeds, which is why this guard is needed now.
  function fromOutside(event) { return Boolean(event && event.tileFromOutside); }

  function onPointerDown(event) {
    const outside = fromOutside(event);
    if (event.button === 1) {
      event.preventDefault();
      state.panning = true;
      state.pointerId = event.pointerId;
      state.panStart = { ...pointerPosition(event), panX: state.panX, panY: state.panY };
      els.canvas.classList.add('panning');
      if (!outside) { try { els.canvas.setPointerCapture(event.pointerId); } catch (_) {} }
      return;
    }
    if (event.button !== 0) return;
    const pos = pointerPosition(event);
    const tile = screenToTile(pos);
    if (!tile) return;
    // ... and the keyboard stays where the click was, too.
    if (!outside) els.canvas.focus();
    state.pointerId = event.pointerId;
    if (!outside) { try { els.canvas.setPointerCapture(event.pointerId); } catch (_) {} }
    state.dragStartTile = tile;
    state.dragStartScreen = pos;
    state.marqueeEnd = pos;

    // Ein Kasten geht immer. Ohne gewaehltes Gebaeude kann ohnehin nichts
    // gesetzt werden, und mit Strg soll man auswaehlen koennen, ohne vorher
    // das Gebaeude abzuwaehlen. Ausgenommen bleiben die beiden Werkzeuge,
    // die selbst einen Kasten ziehen (Delete) oder gerade eine Kopie in der
    // Hand halten (Copy) - dort wuerde die Weiche ihre eigene Geste
    // wegnehmen.
    const boxInstead = state.currentItemType == null || event.ctrlKey || event.metaKey;
    const ownsTheDrag = state.tool === 'delete' || state.tool === 'replace' || (state.tool === 'copy' && state.copyBuffer);
    if (boxInstead && !ownsTheDrag) {
      beginSelectGesture(tile, event);
      return;
    }

    if (state.tool === 'single') {
      placeSingle(tile);
      state.gesture = null;
      return;
    }
    if (state.tool === 'brush') {
      if (state.currentItemType == null) return setStatus('Choose an item first.');
      state.gesture = 'brush';
      state.brushOffsets = [];
      state.brushTypes = [];
      state.brushError = '';
      state.brushSeen = new Set();
      state.brushReplacements = new Set();
      state.brushLastTile = tile;
      brushAdd(tile);
      return;
    }
    if (state.tool === 'line') {
      if (state.currentItemType == null) return setStatus('Choose an item first.');
      state.gesture = 'line';
      state.brushOffsets = [];
      state.brushTypes = [];
      state.brushError = '';
      state.brushSeen = new Set();
      state.brushReplacements = new Set();
      state.brushLastTile = tile;
      if (isLineSequence(state.currentItemType)) {
        updateLineSequencePreview(tile, tile);
      } else {
        brushAdd(tile);
      }
      return;
    }
    if (state.tool === 'bucket') {
      bucketFill(tile);
      state.gesture = null;
      return;
    }
    if (state.tool === 'copy') {
      if (state.copyBuffer) {
        placeCopy(tile);
        state.gesture = null;
        return;
      }
      state.selected.clear();
      state.gesture = 'copy-marquee';
      scheduleDraw();
      return;
    }
    if (state.tool === 'replace') {
      state.selected.clear();
      state.gesture = 'replace-marquee';
      scheduleDraw();
      return;
    }
    if (state.tool === 'delete') {
      if (document.getElementById('castleDeleteMode').value === 'flood') {
        floodDelete(tile);
        state.gesture = null;
        return;
      }
      state.gesture = 'delete-marquee';
      scheduleDraw();
      return;
    }
    beginSelectGesture(tile, event);
  }

  // Auf ein Bauwerk gedrueckt heisst anfassen und verschieben, auf leeres
  // Feld gedrueckt heisst Kasten ziehen. Frueher steckte das im Zweig des
  // Auswahl-Werkzeugs; jetzt steht es fuer sich, weil die anderen Werkzeuge
  // es genauso brauchen (siehe die Weiche oben in onPointerDown).
  function beginSelectGesture(tile, event) {
    const hit = topmostRefAtTile(tile);
    if (hit) {
      if (event.ctrlKey || event.metaKey) {
        if (state.selected.has(hit)) state.selected.delete(hit);
        else state.selected.add(hit);
        activateBuildStepForRefs(state.selected);
        state.currentItemType = null;
        state.gesture = null;
        updateToolAvailability();
        renderPalette();
        updateSelectedItemInfo();
        renderBuildList();
        scheduleDraw();
        setStatus(`Selected ${state.selected.size} placement${state.selected.size === 1 ? '' : 's'}`);
        return;
      }
      if (!state.selected.has(hit)) {
        if (!event.shiftKey) state.selected.clear();
        state.selected.add(hit);
      }
      activateBuildStepForRefs(state.selected);
      state.currentItemType = null;
      updateToolAvailability();
      // Gesperrte Bauwerke bleiben liegen, auch wenn sie mit ausgewaehlt
      // sind: bewegt wird nur, was offen ist. Vorher hing die Pruefung an
      // "sind ALLE gesperrt" - bei gemischter Auswahl wanderte damit auch
      // das Gesperrte mit.
      const beweglich = Array.from(state.selected).filter(ref => refExists(ref) && !refIsLocked(ref));
      const festgehalten = state.selected.size - beweglich.length;
      if (!beweglich.length) {
        setStatus('Locked - unlock the build step first.');
        state.gesture = null;
        renderBuildList();
        scheduleDraw();
        return;
      }
      if (festgehalten) setStatus(festgehalten + ' locked placement' + (festgehalten === 1 ? '' : 's') + ' stay where they are');
      state.gesture = 'move';
      state.moveStartOffsets = new Map();
      for (const ref of beweglich) state.moveStartOffsets.set(ref, refOffset(ref));
      state.moveDelta = { x: 0, y: 0 };
      renderPalette();
      updateSelectedItemInfo();
      renderBuildList();
      scheduleDraw();
      return;
    }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) state.selected.clear();
    state.gesture = 'select-marquee';
    renderBuildList();
    scheduleDraw();
  }

  function onPointerMove(event) {
    const pos = pointerPosition(event);
    if (state.panning && state.panStart) {
      state.panX = state.panStart.panX + pos.x - state.panStart.x;
      state.panY = state.panStart.panY + pos.y - state.panStart.y;
      clampPan();
      scheduleDraw();
      return;
    }

    const tile = screenToTile(pos);
    const previousTile = state.hoverTile;
    const tileChanged = previousTile?.x !== tile?.x || previousTile?.y !== tile?.y;
    const hadHoverPreview = Boolean(previousTile) && (
      (state.currentItemType != null && isPlacementTool(state.tool)) ||
      (state.tool === 'copy' && state.copyBuffer)
    );
    state.hoverTile = tile;
    if (tileChanged && !fromOutside(event)) els.canvas.title = itemLabelAtTile(tile);
    if (tileChanged && tile) {
      const off = xyToOffset(tile.x, tile.y);
      if (state.currentItemType != null && isPlacementTool(state.tool)) {
        const sequence = lineSequence(state.currentItemType);
        if (sequence.length) {
          const result = validatePlacement(sequence[0], off);
          setStatus(result.ok
            ? `Drag from x=${tile.x}, y=${tile.y} to choose the ${itemName(state.currentItemType)} direction.`
            : result.reason);
        } else {
          const result = validatePlacement(state.currentItemType, off);
          setStatus(result.ok ? `x=${tile.x}, y=${tile.y}, offset=${off}` : result.reason);
        }
      } else if (state.tool === 'copy' && state.copyBuffer) {
        const result = validateCopyAt(tile);
        setStatus(result.ok ? `Copy ready at x=${tile.x}, y=${tile.y} — click to place` : result.reason);
      } else {
        setStatus(`x=${tile.x}, y=${tile.y}, offset=${off}`);
      }
    } else if (tileChanged) setStatus('Outside map');

    if (state.gesture === 'brush' && tile && tileChanged) {
      const from = state.brushLastTile || tile;
      for (const p of geometry.lineTiles(from, tile)) brushAdd(p);
      state.brushLastTile = tile;
    } else if (state.gesture === 'line' && tile && state.dragStartTile && tileChanged) {
      if (isLineSequence(state.currentItemType)) {
        updateLineSequencePreview(state.dragStartTile, tile);
      } else {
        state.brushOffsets = [];
        state.brushTypes = [];
        state.brushError = '';
        state.brushSeen = new Set();
        state.brushReplacements = new Set();
        const route = routedLineTiles(state.dragStartTile, tile);
        if (!route.length) setStatus('No unobstructed route to that tile.');
        for (const p of route) brushAdd(p);
      }
    } else if (state.gesture === 'select-marquee' || state.gesture === 'copy-marquee' || state.gesture === 'replace-marquee' || state.gesture === 'delete-marquee') {
      state.marqueeEnd = pos;
      scheduleDraw(false);
    } else if (state.gesture === 'move' && tile && state.dragStartTile) {
      const nextDelta = { x: tile.x - state.dragStartTile.x, y: tile.y - state.dragStartTile.y };
      if (nextDelta.x === state.moveDelta.x && nextDelta.y === state.moveDelta.y) return;
      state.moveDelta = nextDelta;
      const result = validateMove(proposedMove());
      if (!result.ok) setStatus(result.reason);
      scheduleDraw(false);
    } else if (tileChanged) {
      const hasHoverPreview = Boolean(tile) && (
        (state.currentItemType != null && isPlacementTool(state.tool)) ||
        (state.tool === 'copy' && state.copyBuffer)
      );
      if (hadHoverPreview || hasHoverPreview || els.showNames.checked) scheduleDraw(false);
    }
  }

  function onPointerUp(event) {
    if (state.panning && event.pointerId === state.pointerId) {
      state.panning = false;
      state.panStart = null;
      els.canvas.classList.remove('panning');
      if (!fromOutside(event)) { try { els.canvas.releasePointerCapture(event.pointerId); } catch (_) {} }
      return;
    }
    if (event.button !== 0) return;

    if (state.gesture === 'brush') {
      commitBrush();
    } else if (state.gesture === 'line') {
      commitBrush('Line');
    } else if (state.gesture === 'select-marquee') {
      const refs = refsInMarquee();
      if (event.ctrlKey || event.metaKey) refs.forEach(ref => state.selected.has(ref) ? state.selected.delete(ref) : state.selected.add(ref));
      else if (event.shiftKey) refs.forEach(ref => state.selected.add(ref));
      else state.selected = refs;
      activateBuildStepForRefs(state.selected);
      renderBuildList();
      scheduleDraw();
      setStatus(`Selected ${state.selected.size} placement${state.selected.size === 1 ? '' : 's'}`);
    } else if (state.gesture === 'copy-marquee') {
      const candidates = refsInMarquee();
      const refs = new Set(placementRefs()
        .filter(p => candidates.has(p.ref) && p.kind === 'frame' && p.type !== geometry.KEEP_ITEM_TYPE)
        .map(p => p.ref));
      const ignored = candidates.size - refs.size;
      state.selected = refs;
      if (captureCopyBuffer(refs)) {
        renderBuildList();
        scheduleDraw();
        const ignoredNote = ignored ? ` (${ignored} unit/Keep placement${ignored === 1 ? '' : 's'} ignored)` : '';
        setStatus(`Copied selection prepared: ${refs.size} placement${refs.size === 1 ? '' : 's'}${ignoredNote} — move the cursor and click to place`);
      } else {
        state.selected.clear();
        setStatus(ignored ? 'Nothing copyable selected. Units and the Keep are ignored.' : 'Nothing selected to copy.');
      }
    } else if (state.gesture === 'replace-marquee') {
      const refs = refsInMarquee();
      state.selected = refs;
      if (!openReplacementDialog(refs)) {
        state.selected.clear();
        renderBuildList();
      }
    } else if (state.gesture === 'delete-marquee') {
      const refs = refsInMarquee();
      if (refs.size) {
        pushUndo();
        deleteRefs(refs);
        state.selected.clear();
        changed(`Deleted ${refs.size} placement${refs.size === 1 ? '' : 's'}`);
      }
    } else if (state.gesture === 'move') {
      commitMove();
    }

    state.gesture = null;
    state.dragStartTile = null;
    state.dragStartScreen = null;
    state.marqueeEnd = null;
    state.moveStartOffsets = new Map();
    state.moveDelta = { x: 0, y: 0 };
    state.brushOffsets = [];
    state.brushTypes = [];
    state.brushError = '';
    state.brushSeen = new Set();
    state.brushReplacements = new Set();
    state.brushLastTile = null;
    if (!fromOutside(event)) { try { els.canvas.releasePointerCapture(event.pointerId); } catch (_) {} }
    scheduleDraw();
  }

  function onWheel(event) {
    event.preventDefault();
    const pos = pointerPosition(event);
    const action = camera.wheelAction(event, state.camera);
    if (action === 'panX') {
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      state.panX -= delta;
      clampPan();
      scheduleDraw();
      return;
    }
    if (action === 'zoom') {
      if (!event.deltaY) return;
      const old = state.cell;
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = Math.max(MIN_CELL, Math.min(MAX_CELL, old + direction));
      if (next === old) return;
      const worldX = (pos.x - state.panX) / old;
      const worldY = (pos.y - state.panY) / old;
      state.cell = next;
      state.panX = pos.x - worldX * next;
      state.panY = pos.y - worldY * next;
      clampPan();
      scheduleDraw();
      return;
    }

    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    state.panY -= delta;
    clampPan();
    scheduleDraw();
  }

  async function init() {
    try {
      const [constants, categories, populationData, skins] = await Promise.all([
        window.electronAPI.loadConfig('aiv_constants.json'),
        window.electronAPI.loadConfig('aiv_categories.json'),
        window.electronAPI.loadConfig('aiv_gamedata.json'),
        window.electronAPI.loadAivSkins()
      ]);
      state.constants = constants || {};
      state.categories = categories?.categories || {};
      const unitCategory = Object.entries(state.categories)
        .find(([name]) => name.toLowerCase() === 'units');
      state.unitTypes = new Set((unitCategory?.[1] || []).map(Number));
      state.populationData = populationData || { population_effects: { provides: {}, requires: {} } };
      applyLoadedSkins(skins);
      if (skins?.background) mapBackground.src = skins.background;
      if (skins?.skins?.[String(geometry.KEEP_ITEM_TYPE)]) bundledKeepImage.src = skins.skins[String(geometry.KEEP_ITEM_TYPE)];
      if (skins?.skins?.[String(geometry.FORCED_STOCKPILE_ITEM_TYPE)]) bundledStockpileImage.src = skins.skins[String(geometry.FORCED_STOCKPILE_ITEM_TYPE)];
      normalizeUnitStorage(state.document);
      renderPalette();
      updateSelectedItemInfo();
      renderBuildList();
      updateFileLabel();
      updateBlueprintControls();
      loadToolShortcuts();
      resizeCanvas();
    } catch (err) {
      console.error('Castle editor initialization failed:', err);
      setStatus('Castle editor configuration failed to load');
    }
  }

  // Der Grund der 2.5D-Ansicht. Der Dateidialog ist derselbe, den auch der
  // Bauplan benutzt - ein Kanal, nicht zwei. Das gewaehlte Bild wird Kachel
  // fuer Kachel gelegt, nicht gestreckt; sehr grosse Bilder passen unter
  // Umstaenden nicht in den Speicher der Sitzung und sind dann nur bis zum
  // Schliessen da. Die Ansicht faengt das ab.
  const grundKnopf = document.getElementById('castleIsoGroundBtn');
  const grundZurueck = document.getElementById('castleIsoGroundReset');
  const grundArt = document.getElementById('castleIsoGroundFit');
  function updateGroundControls() {
    const eigener = Boolean(window.isoView && window.isoView.hasOwnGround());
    if (grundZurueck) grundZurueck.hidden = !eigener;
    if (grundArt) {
      grundArt.hidden = !eigener;
      const gespannt = Boolean(window.isoView && window.isoView.groundIsStretched());
      grundArt.textContent = gespannt ? 'Stretched' : 'Tiled';
      grundArt.setAttribute('aria-pressed', String(gespannt));
    }
  }
  if (grundArt) grundArt.addEventListener('click', () => {
    if (!window.isoView) return;
    window.isoView.setGroundFit(window.isoView.groundIsStretched() ? 'tile' : 'stretch');
    updateGroundControls();
    setStatus(window.isoView.groundIsStretched()
      ? 'Ground spread once over the whole map'
      : 'Ground laid out tile by tile');
  });
  if (grundKnopf) grundKnopf.addEventListener('click', async () => {
    if (!window.isoView) return;
    try {
      const selection = await window.electronAPI.chooseCastleBackground();
      if (!selection?.dataUrl) return;
      window.isoView.setGround(selection.dataUrl);
      updateGroundControls();
      // Es gibt nur einen Grund: die Ansicht legt eine Spielkarte dabei weg,
      // also muessen deren Knoepfe mit verschwinden.
      updateMapControls();
      setStatus(`Ground of the slanted view: ${selection.fileName || 'chosen picture'}`);
    } catch (error) {
      setStatus(`Could not load ground: ${error.message}`);
    }
  });
  if (grundZurueck) grundZurueck.addEventListener('click', () => {
    if (!window.isoView) return;
    window.isoView.setGround(null);
    updateGroundControls();
    setStatus('Ground back to the one that comes with the app');
  });

  // Eine Karte des Spiels unter die 2.5D-Ansicht legen. Anders als ein
  // beliebiges Bild hat sie einen Massstab: ein Feld der Karte ist ein Feld
  // des Editors. Damit das gilt, muss der Startplatz bekannt sein - eine
  // Karte hat mehrere (in "A Friend Indeed" sechs), und erst er sagt, WO auf
  // der Karte das Dorf von 100x100 steht.
  const karteKnopf = document.getElementById('castleIsoMapBtn');
  const karteZurueck = document.getElementById('castleIsoMapReset');
  const karteBergfried = document.getElementById('castleIsoMapKeep');
  const karteArt = document.getElementById('castleIsoMapMode');
  const karteDialog = document.getElementById('castleIsoMapDialog');
  const karteListe = document.getElementById('castleIsoMapList');
  const karteFilter = document.getElementById('castleIsoMapFilter');
  const karteFehler = document.getElementById('castleIsoMapError');
  const karteAbbruch = document.getElementById('castleIsoMapCancel');
  let karteVorrat = null;   // einmal geholt, dann behalten

  function updateMapControls() {
    const info = window.isoView && window.isoView.gameMapInfo ? window.isoView.gameMapInfo() : null;
    if (karteZurueck) karteZurueck.hidden = !info;
    if (karteArt) {
      karteArt.hidden = !info;
      const echt = Boolean(info && info.mode === 'terrain');
      karteArt.textContent = echt ? 'Terrain' : 'Preview';
      karteArt.setAttribute('aria-pressed', String(echt));
    }
    if (!karteBergfried) return;
    // Der Wähler zeigt sich nur, wenn es etwas zu wählen gibt - bei einem
    // einzigen Startplatz gäbe es nichts zu tun.
    karteBergfried.hidden = !info || info.keeps.length < 2;
    if (karteBergfried.hidden) { karteBergfried.replaceChildren(); return; }
    // Die Nummer kommt aus der Karte, nicht aus der Fundreihenfolge: die
    // Bloecke werden von Norden nach Sueden gefunden, das Spiel nummeriert
    // sie ganz anders (auf "Crete Peninsula" 1, 7, 5, 3, 6, 4, 8, 2). Wer
    // durchzaehlt, vergleicht die falsche Burg mit dem Bildschirmfoto.
    karteBergfried.replaceChildren(...info.keeps.map((keep, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      const name = keep.player ? `Start ${keep.player}` : `Start place ${index + 1}`;
      const dreh = keep.orientation ? `, turned ${keep.orientation / 2}/4` : '';
      option.textContent = `${name} (${keep.x}, ${keep.y})${dreh}`;
      return option;
    }));
    karteBergfried.value = String(info.keepIndex);
  }

  // Das echte Gelaende holen, wenn es gebraucht wird und noch nicht daliegt.
  // Es wird NICHT gemerkt (rund 3 MB), also faellt es bei jedem Neustart und
  // bei jedem Wechsel von Karte oder Startplatz an - und bis es da ist, liegt
  // die Vorschau darunter, damit der Grund nie leer aussieht.
  let gelaendeLaeuft = null;

  // Der Kachelvorrat der ganzen Karte. Er haengt nur an der Karte, nicht am
  // Startplatz - einmal geholt, gilt er fuer alle Burgen darauf.
  let kachelnLaufen = null;
  async function ensureMapTiles() {
    if (!window.isoView || !window.isoView.setMapTiles) return;
    const info = window.isoView.gameMapInfo();
    if (!info || !info.path) return;
    if (kachelnLaufen === info.path) return;
    kachelnLaufen = info.path;
    try {
      const vorrat = await window.electronAPI.loadMapTiles(info.path);
      if (kachelnLaufen !== info.path) return;      // inzwischen andere Karte
      window.isoView.setMapTiles(vorrat);
      setStatus(`Whole map "${vorrat.name}" ready · ${vorrat.kacheln} different tiles`
                + (vorrat.fehlend ? `, ${vorrat.fehlend} without a picture` : ''));
    } catch (error) {
      kachelnLaufen = null;
      setStatus(`Could not read the map tiles: ${error.message}`);
    }
  }

  async function ensureTerrain() {
    if (!window.isoView || !window.isoView.gameMapInfo) return;
    const info = window.isoView.gameMapInfo();
    if (!info || info.mode !== 'terrain' || info.terrainReady) return;
    if (!info.path) {
      // Eine Karte aus einer aelteren Sitzung kennt ihren Pfad nicht.
      setStatus('Pick the map again - the remembered one does not say where it lies.');
      return;
    }
    const key = info.terrainKey;
    if (!key || gelaendeLaeuft === key) return;
    gelaendeLaeuft = key;
    setStatus(`Drawing the real terrain of "${info.name}" …`);
    try {
      const terrain = await window.electronAPI.loadMapTerrain({ path: info.path, keep: info.keep });
      // Zwischendurch kann die Karte oder der Startplatz gewechselt haben -
      // dann gehoert dieses Bild nicht mehr hierher.
      if (window.isoView.terrainKey() !== key) return;
      window.isoView.setTerrain({ ...terrain, key });
      setStatus(`Real terrain of "${info.name}" · ${terrain.tiles} fields, ${terrain.trees} trees, ` +
                `${terrain.width}x${terrain.height} points`);
    } catch (error) {
      setStatus(`Could not draw the terrain: ${error.message}`);
      window.isoView.setMapMode('preview');
      updateMapControls();
    } finally {
      if (gelaendeLaeuft === key) gelaendeLaeuft = null;
    }
  }

  function renderMapList(filter) {
    if (!karteListe) return;
    const needle = String(filter || '').trim().toLowerCase();
    const hits = (karteVorrat || []).filter(entry => entry.name.toLowerCase().includes(needle));
    if (!hits.length) {
      const empty = document.createElement('div');
      empty.className = 'castleMapEmpty';
      empty.textContent = karteVorrat && karteVorrat.length
        ? 'No map of that name.'
        : 'No maps found. Choose the game folder under UCP first.';
      karteListe.replaceChildren(empty);
      return;
    }
    karteListe.replaceChildren(...hits.map(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('span');
      name.textContent = entry.name;
      const source = document.createElement('span');
      source.className = 'castleMapSource';
      source.textContent = entry.source;
      button.append(name, source);
      button.addEventListener('click', () => chooseMap(entry));
      return button;
    }));
  }

  async function chooseMap(entry) {
    if (!window.isoView || !karteFehler) return;
    karteFehler.textContent = 'Reading the map…';
    try {
      const map = await window.electronAPI.loadGameMap(entry.path);
      window.isoView.setGameMap(map);
      ensureMapTiles();
      updateMapControls();
      updateGroundControls();
      ensureTerrain();
      if (karteDialog && karteDialog.open) karteDialog.close();
      // Der Fokus bleibt sonst im Suchfeld des Dialogs, und weil Tasten in
      // Eingabefeldern zu Recht ignoriert werden, ginge danach kein einziges
      // Kuerzel mehr - auch das Drehen mit C und X nicht.
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      setStatus(map.keeps.length
        ? `Map "${map.name}" laid under the slanted view · ${map.keeps.length} starting place${map.keeps.length === 1 ? '' : 's'}`
        : `Map "${map.name}" laid under the slanted view · no starting place found, the castle sits in the middle of the map`);
    } catch (error) {
      karteFehler.textContent = `Could not read that map: ${error.message}`;
    }
  }

  if (karteKnopf) karteKnopf.addEventListener('click', async () => {
    if (!karteDialog || !karteFehler) return;
    karteFehler.textContent = '';
    if (karteFilter) karteFilter.value = '';
    // Bei JEDEM Oeffnen frisch holen. Vorher wurde die Liste einmal gemerkt -
    // wer eine eigene Karte in den maps-Ordner legte, fand sie erst nach einem
    // Neustart des Werkzeugs. Das Lesen von 189 Kartennamen kostet nichts,
    // ein Neustart mitten in der Arbeit dagegen viel.
    try {
      const answer = await window.electronAPI.listGameMaps();
      karteVorrat = (answer && answer.maps) || [];
    } catch (error) {
      karteVorrat = karteVorrat || [];
      karteFehler.textContent = `Could not list the maps: ${error.message}`;
    }
    renderMapList('');
    if (!karteDialog.open) karteDialog.showModal();
    if (karteFilter) karteFilter.focus();
  });
  if (karteFilter) karteFilter.addEventListener('input', () => renderMapList(karteFilter.value));
  if (karteAbbruch) karteAbbruch.addEventListener('click', () => karteDialog?.close());
  if (karteBergfried) karteBergfried.addEventListener('change', () => {
    if (!window.isoView) return;
    window.isoView.setGameMapKeep(Number(karteBergfried.value));
    ensureTerrain();
    const info = window.isoView.gameMapInfo();
    const keep = info && info.keeps[info.keepIndex];
    setStatus(keep
      ? `Castle built on ${keep.player ? `start ${keep.player}` : 'the starting place'} at (${keep.x}, ${keep.y})` +
        (keep.orientation ? ` · the game turns it by ${keep.orientation / 2} quarter turn${keep.orientation === 2 ? '' : 's'}` : ' · not turned')
      : 'Starting place changed');
  });
  if (karteArt) karteArt.addEventListener('click', () => {
    if (!window.isoView) return;
    const echt = window.isoView.mapMode() !== 'terrain';
    window.isoView.setMapMode(echt ? 'terrain' : 'preview');
    updateMapControls();
    if (echt) ensureTerrain();
    else setStatus('Ground back to the quick preview of the map');
  });
  if (karteZurueck) karteZurueck.addEventListener('click', () => {
    if (!window.isoView) return;
    window.isoView.setGameMap(null);
    kachelnLaufen = null;
    window.isoView.setMapTiles(null);
    updateMapControls();
    updateGroundControls();
    setStatus('Map of the game taken away');
  });

  updateGroundControls();
  updateMapControls();
  // Diese Datei wird VOR iso-view.js geladen (index.html), also gibt es
  // window.isoView hier noch gar nicht - beide Abfragen oben liefern darum
  // "nichts gewaehlt", auch wenn aus der letzten Sitzung ein eigener Grund
  // oder eine Karte gemerkt ist. Dann stuenden die Knoepfe falsch: die Karte
  // laege da, aber der Weg, sie wieder wegzunehmen, waere unsichtbar. Sobald
  // die Seite fertig geladen ist, wird deshalb noch einmal nachgesehen.
  window.addEventListener('DOMContentLoaded', () => {
    updateGroundControls();
    updateMapControls();
    ensureTerrain();
  });

  document.querySelectorAll('.castleTool').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
  document.getElementById('castleNewBtn').addEventListener('click', newFile);
  document.getElementById('castleOpenBtn').addEventListener('click', openFile);
  document.getElementById('castleSaveBtn').addEventListener('click', saveFile);
  document.getElementById('castleSaveAsBtn').addEventListener('click', saveAs);
  els.showNames.addEventListener('change', scheduleDraw);
  els.showUnitNumbers.addEventListener('change', scheduleDraw);
  els.showCompatibility.addEventListener('change', scheduleDraw);
  document.getElementById('castleShowFire').addEventListener('change', scheduleDraw);
  document.getElementById('castleShowRoutes').addEventListener('change', scheduleDraw);
  els.showBlueprint.addEventListener('change', () => {
    state.blueprintVisible = els.showBlueprint.checked;
    scheduleDraw();
    setStatus(state.blueprintVisible ? 'Temporary blueprint shown' : 'Temporary blueprint hidden');
  });
  els.blueprintOpacity.addEventListener('input', () => {
    state.blueprintOpacity = Number(els.blueprintOpacity.value) / 100;
    els.blueprintOpacityValue.textContent = `${els.blueprintOpacity.value}%`;
    scheduleDraw();
  });
  for (const input of els.shortcutForm.querySelectorAll('.castleShortcutKey')) {
    input.addEventListener('keydown', event => {
      if (event.key === 'Tab' || event.key === 'Escape') return;
      event.preventDefault();
      if (event.key === 'Backspace' || event.key === 'Delete') {
        input.value = '';
        els.shortcutError.textContent = '';
        return;
      }
      const key = normalizeShortcutKey(event.key);
      if (!key || event.ctrlKey || event.metaKey || event.altKey) {
        els.shortcutError.textContent = 'Use one letter or number without modifier keys.';
        return;
      }
      input.value = key.toUpperCase();
      els.shortcutError.textContent = '';
    });
  }
  els.shortcutDefaults.addEventListener('click', () => populateShortcutDialog(DEFAULT_TOOL_SHORTCUTS, camera.defaults));
  document.getElementById('castleCameraLegacy').addEventListener('click', () => populateCameraDialog(camera.defaults));
  document.getElementById('castleCameraArrows').addEventListener('click', () => populateCameraDialog(camera.arrows));
  document.getElementById('castleMergeSteps').addEventListener('click', mergeSelectedSteps);
  for (const input of els.shortcutForm.querySelectorAll('.castleCameraKey')) {
    input.addEventListener('keydown', event => {
      if (event.key === 'Tab' || event.key === 'Escape') return;
      event.preventDefault();
      if (event.key === 'Backspace' || event.key === 'Delete') { input.value = ''; return; }
      const key = camera.normalizeKey(event.key);
      if (!key || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        els.shortcutError.textContent = 'Use a letter, number or arrow key without modifiers.';
        return;
      }
      input.value = key.toUpperCase();
      els.shortcutError.textContent = '';
    });
  }
  els.shortcutCancel.addEventListener('click', () => els.shortcutDialog.close());
  els.shortcutForm.addEventListener('submit', saveShortcutDialog);
  els.replaceCancel.addEventListener('click', () => els.replaceDialog.close());
  els.replaceForm.addEventListener('submit', submitReplacementDialog);
  if (els.brushMinus) els.brushMinus.addEventListener('click', () => setBrushSize(state.brushSize - 1));
  if (els.brushPlus) els.brushPlus.addEventListener('click', () => setBrushSize(state.brushSize + 1));
  els.buildSlider.addEventListener('input', selectBuildStepFromSlider);
  window.addEventListener('character-population-changed', () => updatePopulationPanel(false));

  els.canvas.addEventListener('pointerdown', onPointerDown);
  els.canvas.addEventListener('pointermove', onPointerMove);
  els.canvas.addEventListener('pointerup', onPointerUp);
  els.canvas.addEventListener('pointercancel', onPointerUp);
  els.canvas.addEventListener('wheel', onWheel, { passive: false });
  els.canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    clearSelectionAndItem();
  });
  els.canvas.addEventListener('mouseleave', () => {
    const hadPreview = state.hoverTile && (
      (state.currentItemType != null && isPlacementTool(state.tool)) ||
      (state.tool === 'copy' && state.copyBuffer)
    );
    state.hoverTile = null;
    els.canvas.title = '';
    if (hadPreview || els.showNames.checked) scheduleDraw(false);
  });

  // Aus dem window-Hoerer herausgeloest, damit ein eigenes Fenster (die
  // 2.5D-Ansicht) dieselben Tasten schicken kann: dessen keydown erreicht
  // den Hoerer hier nie, weil es ein anderes window ist.
  function handleCastleKey(event) {
    if (window.appWorkspace?.getActive() !== 'castle') return;
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const target = event.target || document.activeElement;
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
    if (editing) return;
    const delta = camera.keyDelta(event, state.camera);
    if (delta) {
      event.preventDefault();
      if (!window.isoView?.panFromKey?.(event, delta)) {
        state.panX += delta.x;
        state.panY += delta.y;
        clampPan();
        scheduleDraw();
      }
      return;
    }
    const key = event.key.toLowerCase();
    const shortcutTool = !event.ctrlKey && !event.metaKey && !event.altKey ? toolForShortcut(key) : null;
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault(); redo();
    } else if (!event.ctrlKey && !event.metaKey && (key === '[' || key === ']')) {
      event.preventDefault();
      setBrushSize(state.brushSize + (key === ']' ? 1 : -1));
    } else if ((event.ctrlKey || event.metaKey) && key === 'c') {
      event.preventDefault(); copySelection();
    } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
      event.preventDefault(); pasteCopy();
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey
               && (key === 'c' || key === 'x') && window.isoView && window.isoView.turnView) {
      // C dreht die Ansicht nach links, X nach rechts - so bestellt. Weil 'c'
      // vorher das Zweitkuerzel fuers Kopieren war, ist es dort ausgetragen;
      // Kopieren bleibt auf '5' und Strg+C.
      event.preventDefault();
      const wert = window.isoView.turnView(key === 'c' ? -1 : 1);
      setStatus('View turned' + (wert ? ' by ' + (wert / 2) + ' quarter turn' + (wert === 2 ? '' : 's') : ' back to the file'));
    } else if (shortcutTool) {
      event.preventDefault();
      setTool(shortcutTool);
    } else if (event.key === 'Delete') {
      event.preventDefault(); deleteSelected();
    } else if (event.key === 'Escape') {
      event.preventDefault(); clearSelectionAndItem();
    }
  }

  window.addEventListener('keydown', handleCastleKey);

  window.electronAPI.onTriggerUndo(() => {
    if (window.appWorkspace?.getActive() === 'castle') undo();
    else document.execCommand?.('undo');
  });
  window.electronAPI.onTriggerRedo(() => {
    if (window.appWorkspace?.getActive() === 'castle') redo();
    else document.execCommand?.('redo');
  });
  window.electronAPI.onTriggerDeleteSelected(() => {
    if (window.appWorkspace?.getActive() === 'castle') deleteSelected();
  });
  window.electronAPI.onTriggerLoadCastleBackground(() => {
    if (window.appWorkspace?.getActive() === 'castle') chooseBlueprint();
  });
  window.electronAPI.onTriggerClearCastleBackground(() => {
    if (window.appWorkspace?.getActive() === 'castle') clearBlueprint();
  });
  window.electronAPI.onTriggerCustomizeCastleShortcuts(() => {
    if (window.appWorkspace?.getActive() === 'castle') showShortcutDialog();
  });
  window.electronAPI.onTriggerCastleOverview(command => {
    if (window.appWorkspace?.getActive() === 'castle') setOverviewPreference(command);
  });

  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(els.host);

  window.castleEditor = {
    extras: { state, placementRefs, setTool, setStatus, renderBuildList, scheduleDraw }, // fuer editor-extras.js: Gruppen und Kopierspeicher, siehe dort
    openFile,
    saveFile,
    saveAs,
    newFile,
    loadDocument,
    loadFromContent,
    undo,
    redo,
    deleteSelected,
    getCameraPreferences: () => ({ ...state.camera }),
    itemLabelAtTile,
    getAnalysisOverlay,
    chooseBlueprint,
    clearBlueprint,
    showShortcutDialog,
    setStatus,
    isDirty: () => state.dirty,
    getPath: () => state.filePath,
    isReadOnly: () => state.readOnly,
    markSaved: sourceBytes => {
      state.sourceBytes = retainSourceBytes(sourceBytes) || state.sourceBytes;
      setDirty(false);
    },
    getSourceBytes: () => state.sourceBytes,
    getDocument: outputDocument,
    // Fuer die 2.5D-Ansicht: ein Zeigerereignis mit { tileFromOutside: {x, y} }
    // durchreichen. Alles andere - Werkzeugwahl, Vorschau, Rueckgaengig -
    // bleibt genau wie beim Zeichnen auf der Karte.
    pointerFromOutside(phase, event) {
      if (phase === 'down') return onPointerDown(event);
      if (phase === 'move') return onPointerMove(event);
      if (phase === 'up') return onPointerUp(event);
    },
    handleKey: handleCastleKey,
    addChangeListener,
    getTool: () => state.tool,
    getCurrentItemType: () => state.currentItemType,
    // Fuer die 2.5D-Ansicht: was ausgewaehlt ist, und welcher Kasten gerade
    // gezogen wird. Beides als Kopie und in KACHELN - die Ansicht rechnet in
    // ihrem eigenen Bildschirmsystem und darf mit den Bildschirmpunkten der
    // Karte nichts zu tun haben.
    getSelection: () => new Set(state.selected),
    // Was ein Klick jetzt setzen wuerde: die Felder des Pinsels und der Typ.
    // Die 2.5D-Ansicht malt daraus ihre eigene Vorschau - sie hat keinen
    // Zeiger auf der Karte und koennte sie sonst nicht zeigen.
    getPlacementPreview() {
      if (state.currentItemType == null || !isPlacementTool(state.tool)) return null;
      const erster = lineSequence(state.currentItemType)[0] ?? state.currentItemType;

      // Zieht der Nutzer gerade, ist der Zug selbst die Vorschau - jedes Feld
      // mit dem Bauwerk, das dort hinkaeme. Vorher zeigte die schraege Ansicht
      // nur das Feld unter dem Zeiger, und man sah beim Ziehen einer Mauer
      // nicht, was entsteht.
      if (state.brushOffsets && state.brushOffsets.length) {
        return {
          itemType: erster,
          tiles: state.brushOffsets.map((off, i) => {
            const xy = offsetToXY(off);
            return { x: xy.x, y: xy.y, itemType: state.brushTypes[i] ?? erster };
          })
        };
      }

      if (!state.hoverTile) return null;
      const felder = state.tool === 'brush' && state.brushSize > 1
        ? geometry.brushTiles(state.hoverTile, state.brushSize)
        : [state.hoverTile];
      return { itemType: erster, tiles: felder };
    },
    getMarquee() {
      const zieht = state.gesture === 'select-marquee' || state.gesture === 'copy-marquee'
                 || state.gesture === 'replace-marquee' || state.gesture === 'delete-marquee';
      if (!zieht || !state.dragStartTile || !state.marqueeEnd) return null;
      const ende = screenToTile(state.marqueeEnd);
      if (!ende) return null;
      return { x0: state.dragStartTile.x, y0: state.dragStartTile.y,
               x1: ende.x, y1: ende.y, kind: state.gesture };
    },
    getContent: outputContent,
    hasDocument: () => Boolean(state.document),
    getPopulationSummary: calculatePopulationSummary,
    refreshPopulation: () => updatePopulationPanel(false),
    refreshOverviewLayout: applyOverviewLayout,
    onWorkspaceShown() { resizeCanvas(); clampPan(); updatePopulationPanel(false); scheduleDraw(); }
  };

  loadOverviewLayout();
  ladeKostenanzeige();
  try { document.head.appendChild(Object.assign(document.createElement('script'), { src: 'js/editor-extras.js' })); } catch (error) { console.warn('Castle extras not loaded:', error); } // Gruppen, Kopierspeicher, Tastenkuerzel

  init();
})();
