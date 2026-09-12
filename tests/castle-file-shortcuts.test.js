const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/js/castle-editor.js'), 'utf8');
const defaults = source.slice(source.indexOf('  const DEFAULT_TOOL_SHORTCUTS ='), source.indexOf('  const deepClone'));
const validation = source.slice(source.indexOf('  function normalizeShortcutKey('), source.indexOf('  function updateToolShortcutHints('));

test('file shortcut defaults migrate without discarding customized tool bindings', () => {
  const context = { toolLabel: key => key };
  vm.runInNewContext(defaults + validation + '\nthis.defaults=DEFAULT_TOOL_SHORTCUTS;this.validate=validateToolShortcuts;', context);
  const old = JSON.parse(JSON.stringify(context.defaults));
  delete old.saveCastle; delete old.openCastle; old.brush = ['9', 'b'];
  const restored = context.validate(old);
  assert.equal(restored.brush[0], '9');
  assert.equal(restored.saveCastle[0], 'f1'); assert.equal(restored.openCastle[0], 'f2');
  restored.saveCastle = ['F3']; restored.openCastle = ['F4', 'o'];
  assert.equal(context.validate(restored).saveCastle[0], 'f3');
  restored.openCastle = ['f3'];
  assert.throws(() => context.validate(restored), /assigned more than once/);
  restored.openCastle = ['c'];
  assert.throws(() => context.validate(restored), /reserved for rotation/);
  restored.openCastle = ['F13'];
  assert.throws(() => context.validate(restored), /primary shortcut/);
});

test('file actions reuse save/open and suppress overlapping dialogs until completion', async () => {
  let finish, saves = 0, opens = 0;
  const context = { saveFile: () => { saves++; return new Promise(resolve => { finish = resolve; }); },
    openFile: async () => { opens++; }, setStatus: message => { throw new Error(message); } };
  const method = source.slice(source.indexOf('  let fileShortcutPending ='), source.indexOf('  function selectItem('));
  vm.runInNewContext(method + '\nthis.run=runFileShortcut;', context);
  const pending = context.run('saveCastle');
  await context.run('saveCastle'); await context.run('openCastle');
  assert.equal(saves, 1); assert.equal(opens, 0);
  finish(); await pending; await context.run('openCastle');
  assert.equal(opens, 1);
});
