const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const geometry = require('../src/js/castle-geometry');
const camera = require('../src/js/castle-camera');
const constants = require('../config/aiv_constants.json');
const allowed = Object.keys(constants).map(Number).filter(type => constants[type].multiPlacement === true);
const step = (type, offsets, extra = {}) => ({itemType: type, tilePositionOfsets: offsets, shouldPause: false, ...extra});
const whole = frames => new Map(frames.map((f, i) => [i, new Set(f.tilePositionOfsets.map((_off, oi) => oi))]));

test('area merge groups checked types at their earliest step, preserving outside placements and unchecked types', () => {
  const frames = [step(61, [5643]), step(25, [1, 2]), step(106, [11]), step(25, [3, 4]), step(106, [12]), step(26, [21]), step(26, [22])];
  const original = structuredClone(frames), selected = whole(frames);
  selected.set(1, new Set([0])); selected.set(3, new Set([1]));
  const result = geometry.mergeStepPlacements(frames, selected, [25, 106], allowed);
  assert.deepEqual(result.frames, [frames[0], step(25, [1, 4]), step(25, [2]), step(106, [11, 12]), step(25, [3]), frames[5], frames[6]]);
  assert.deepEqual(result.mergedIndexes, [1, 3]);
  assert.deepEqual(frames, original, 'preview and proposal do not mutate the input');
});

test('whole-step merging respects exact types, locks, earliest position, deduplication and every configured multi-placement type', () => {
  for (const type of allowed.filter(type => type !== 61)) {
    const frames = [step(type, [1, 2]), step(54, [40]), step(type, [2, 3]), step(type, [4], {locked: true})];
    const result = geometry.mergeStepPlacements(frames, whole(frames), [type], allowed);
    assert.deepEqual(result.frames, [step(type, [1, 2, 3]), frames[1], frames[3]], String(type));
    assert.equal(result.frames[2], frames[3], 'locked frame is unchanged');
  }
  const frames = [step(25, [1]), step(26, [2]), step(54, [3]), step(54, [4]), step(61, [5]), step(61, [6])];
  const groups = geometry.stepMergeGroups(frames, whole(frames), allowed);
  assert.deepEqual(groups.map(g => g.type), [25, 26]);
  assert.throws(() => geometry.mergeStepPlacements(frames, whole(frames), [25, 26, 54, 61], allowed), /at least two/);
  assert.throws(() => geometry.mergeStepPlacements([step(25, [1]), step(25, [2])], whole(frames), [], allowed), /Choose/);
});

function dialogHarness() {
  const source = fs.readFileSync(require.resolve('../src/js/castle-editor.js'), 'utf8');
  const elements = new Map();
  const element = () => ({children: [], handlers: {}, disabled: false, checked: false,
    append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; },
    addEventListener(key, fn) { this.handlers[key] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }});
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const checked = () => get('castleMergeRows').children.map(row => row.children[0]).filter(input => input.checked && !input.disabled);
  const state = {documentRevision: 1, document: {frames: [step(25, [1]), step(106, [3]), step(25, [2]), step(106, [4])]}, selected: new Set()};
  const undo = [], selected = [];
  const context = vm.createContext({state, geometry,
    document: {getElementById: get, createElement: element, querySelector: () => checked()[0], querySelectorAll: checked},
    frames: () => state.document.frames, mergeableTypes: () => allowed, itemName: type => constants[type].name,
    pushUndo: () => undo.push(structuredClone(state.document)), selectBuildFrames: indexes => selected.push(...indexes),
    changed: () => { state.documentRevision++; }});
  vm.runInContext(source.slice(source.indexOf('  let pendingMerge ='), source.indexOf('  function mergeArea(')), context);
  return {context, state, get, undo, selected};
}

test('merge dialog checks each eligible type, changes nothing on cancel, and commits one undoable edit', () => {
  const h = dialogHarness(), original = structuredClone(h.state.document);
  h.context.openMergeDialog(whole(h.state.document.frames));
  assert.equal(h.get('castleMergeRows').children.length, 2);
  assert.deepEqual(h.state.document, original);
  h.get('castleMergeDialog').close();
  assert.deepEqual(h.state.document, original); assert.equal(h.undo.length, 0);
  h.context.openMergeDialog(whole(h.state.document.frames), false);
  const boxes = h.get('castleMergeRows').children.map(row => row.children[0]);
  boxes.find(input => input.value === '106').checked = false;
  h.context.applyMerge({preventDefault() {}});
  assert.equal(h.undo.length, 1); assert.deepEqual(h.undo[0], original);
  assert.deepEqual(h.state.document.frames.map(f => f.tilePositionOfsets), [[1, 2], [3], [4]]);
  assert.equal(h.get('castleMergeDialog').open, false);
});

test('merge dialog rejects stale selections and disables Apply when everything is unchecked', () => {
  const h = dialogHarness();
  h.context.openMergeDialog(whole(h.state.document.frames));
  h.get('castleMergeRows').children.forEach(row => { row.children[0].checked = false; });
  h.context.updateMergeApplyState(); assert.equal(h.get('castleMergeApply').disabled, true);
  h.state.documentRevision++;
  h.context.applyMerge({preventDefault() {}});
  assert.equal(h.undo.length, 0); assert.match(h.get('castleMergeError').textContent, /castle changed/);
});

test('wheel-zoom preset supports Alt and Shift vertical scrolling while Photoshop retains Alt zoom', () => {
  assert.equal(camera.wheelAction({altKey: true}, camera.arrows), 'panY');
  assert.equal(camera.wheelAction({shiftKey: true}, camera.arrows), 'panY');
  assert.equal(camera.wheelAction({ctrlKey: true, altKey: true}, camera.arrows), 'panX');
  assert.equal(camera.wheelAction({altKey: true}, camera.legacy), 'zoom');
  assert.equal(camera.wheelAction({}, camera.arrows), 'zoom');
});
