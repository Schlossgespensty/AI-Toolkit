const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const {defaultLines} = require('../src/node/ucp-library');
const source = fs.readFileSync(require.resolve('../src/js/ai-content-editor.js'), 'utf8');

function editor(lines) {
  const inputs = new Map(), saved = [];
  const state = {lines: structuredClone(lines), linesPath: 'test/lines.json', busy: false};
  state.savedSnapshot = JSON.stringify(state.lines);
  const element = tag => ({tag, dataset: {}, value: '', placeholder: '', children: [], handlers: {},
    append(...nodes) { this.children.push(...nodes); },
    addEventListener(event, fn) { this.handlers[event] = fn; }});
  const form = {appendChild(label) { inputs.set(label.children[0].title, label.children[1]); }};
  const context = vm.createContext({state, els: {form},
    document: {createElement: element}, updateDirtyDisplay() {}, setStatus() {},
    setBusy: value => { state.busy = value; },
    window: {electronAPI: {quickSaveFile: async value => saved.push(value)}}});
  vm.runInContext(source.slice(source.indexOf('  function snapshot('), source.indexOf('  function setStatus(')), context);
  vm.runInContext(source.slice(source.indexOf('  function friendlyLabel('), source.indexOf('  function formatBytes(')), context);
  vm.runInContext(source.slice(source.indexOf('  async function saveFile('), source.indexOf('  async function changePortrait(')), context);
  context.renderLines();
  return {context, state, inputs, saved};
}

test('every field described by lines_base has an English hint, including all complete titles', () => {
  const lines = {...defaultLines(''), ...Object.fromEntries(Array.from({length: 8}, (_, i) => [`complete_title_${i + 1}`, '']))};
  const h = editor(lines);
  for (const key of Object.keys(lines)) {
    assert.ok(h.inputs.get(key).placeholder.length > 5, key);
    assert.equal(h.inputs.get(key).value, '', key);
  }
  assert.equal(h.inputs.get('taunt_1').placeholder, 'The AI attacks the player.');
  assert.equal(h.inputs.get('nervous_1').placeholder, 'The player attacks the AI.');
  assert.match(h.inputs.get('complete_title_8').placeholder, /Character name.*title/);
  assert.equal(h.context.lineHint('custom_line'), '');
  assert.equal(h.context.lineHint('constructor'), '', 'unknown keys cannot inherit hints from Object.prototype');
});

test('placeholders do not dirty the project, replace existing dialogue, or enter saved lines', async () => {
  const original = {ai_name: 'Wolf', taunt_1: '', description: null, custom_line: 'Custom dialogue'};
  const h = editor(original);
  assert.equal(h.context.isDirty(), false);
  assert.equal(h.inputs.get('ai_name').value, 'Wolf');
  assert.equal(h.inputs.get('custom_line').placeholder, '');
  assert.equal(await h.context.saveFile(), true);
  assert.deepEqual(JSON.parse(h.saved[0].content), original);
  const input = h.inputs.get('taunt_1');
  input.value = 'Prepare to fight!'; input.handlers.input();
  assert.equal(h.context.isDirty(), true);
  await h.context.saveFile();
  assert.equal(JSON.parse(h.saved[1].content).taunt_1, 'Prepare to fight!');
  input.value = ''; input.handlers.input();
  assert.ok(input.placeholder, 'clearing the value leaves the hint available again');
  await h.context.saveFile();
  assert.equal(JSON.parse(h.saved[2].content).taunt_1, '');
});
