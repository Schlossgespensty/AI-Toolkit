const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
const method = source.slice(source.indexOf('  function cutSelection('), source.indexOf('  function pasteCopy('));

test('cut captures only removable buildings before one undoable deletion', () => {
  const placements = [
    { ref: 'keep', kind: 'frame', type: 61 },
    { ref: 'locked', kind: 'frame', type: 54 },
    { ref: 'unit', kind: 'unit', type: 1 },
    { ref: 'wall', kind: 'frame', type: 25 },
    { ref: 'farm', kind: 'frame', type: 73 }
  ];
  const state = { selected: new Set(placements.map(p => p.ref)) }, calls = [];
  const context = { state, geometry: { KEEP_ITEM_TYPE: 61 }, placementRefs: () => placements,
    refIsLocked: ref => ref === 'locked', setStatus: () => {},
    captureCopyBuffer: refs => { calls.push(['copy', ...refs]); return true; },
    pushUndo: () => calls.push(['undo']), setTool: tool => calls.push(['tool', tool]),
    deleteRefs: refs => calls.push(['delete', ...refs]), changed: () => calls.push(['changed']) };
  vm.runInNewContext(method + '\nthis.cut=cutSelection;', context);
  context.cut();
  assert.deepEqual(calls, [['copy', 'wall', 'farm'], ['undo'], ['tool', 'copy'], ['delete', 'wall', 'farm'], ['changed']]);
  assert.equal(state.selected.size, 0);
  calls.length = 0; state.selected = new Set(['keep', 'locked', 'unit']); context.cut();
  assert.deepEqual(calls, [], 'protected-only selection preserves the existing clipboard and document');
  state.selected = new Set(['wall']); context.captureCopyBuffer = () => false; context.cut();
  assert.deepEqual(calls, [], 'never delete when capture fails');
});
