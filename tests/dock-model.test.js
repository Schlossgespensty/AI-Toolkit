// Tests for the docking state. The interesting input is broken input: this
// object comes back out of the browser's store, where an older version of
// the app, a half-written entry or a user with a console can leave anything.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const M = require(path.join(__dirname, '..', 'src', 'js', 'dock-model.js'));

test('a fresh state is hidden and remembers a side to come back to', () => {
  const s = M.defaultState();
  assert.equal(s.mode, 'off');
  assert.equal(s.side, 'right');
  assert.equal(s.lastMode, 'dock');
  assert.equal(s.v, M.VERSION);
});

test('normalize survives everything and never throws', () => {
  const rubbish = [null, undefined, 0, '', 'broken', '{oops', [], {}, { v: 99 },
                   { v: 1, side: 'diagonal' }, { v: 1, mode: 'floating' },
                   { v: 1, size: null }, { v: 1, size: 'wide' }];
  for (const input of rubbish) {
    const s = M.normalize(input);
    assert.ok(M.MODES.includes(s.mode), `mode is valid for ${JSON.stringify(input)}`);
    assert.ok(M.SIDES.includes(s.side), `side is valid for ${JSON.stringify(input)}`);
    for (const side of M.SIDES) assert.ok(Number.isFinite(s.size[side]), 'every size is a number');
  }
});

test('sizes are repaired, not believed', () => {
  assert.equal(M.normalize({ v: 1, size: { right: -5 } }).size.right, 120, 'a negative size is lifted');
  assert.equal(M.normalize({ v: 1, size: { right: '380' } }).size.right, 380, 'text becomes a number');
  assert.equal(M.normalize({ v: 1, size: { right: 99999 } }).size.right, 4000, 'a huge size is cut');
  assert.equal(M.normalize({ v: 1, size: { right: NaN } }).size.right, 380, 'NaN falls back');
  assert.equal(M.normalize({ v: 1, size: { top: 250.6 } }).size.top, 251, 'stored as whole pixels');
});

test('normalize does not touch what it was given', () => {
  const original = { v: 1, mode: 'dock', side: 'left', size: { left: 300 }, lastMode: 'dock' };
  const copy = JSON.parse(JSON.stringify(original));
  M.withDock(M.normalize(original), 'top');
  assert.deepEqual(original, copy, 'the input object is unchanged');
});

test('a state survives the round trip through JSON', () => {
  const before = M.withSize(M.withDock(M.defaultState(), 'bottom'), 'bottom', 260);
  const after = M.normalize(JSON.parse(JSON.stringify(before)));
  assert.deepEqual(after, before);
});

test('at start a saved window becomes nothing, but is not forgotten', () => {
  const saved = M.withWindow(M.defaultState());
  const booted = M.bootState(saved);
  assert.equal(booted.mode, 'off', 'no window opens on its own');
  assert.equal(booted.lastMode, 'window', 'the button still knows where it was');
  const docked = M.withDock(M.defaultState(), 'top');
  assert.deepEqual(M.bootState(docked), docked, 'a docked panel comes back docked');
});

test('the button toggles through all three states', () => {
  assert.deepEqual(M.toggleTarget(M.defaultState()), { kind: 'dock', side: 'right' });
  assert.deepEqual(M.toggleTarget(M.withDock(M.defaultState(), 'top')), { kind: 'off' });
  assert.deepEqual(M.toggleTarget(M.withWindow(M.defaultState())), { kind: 'off' });
  // hidden after a window: the button brings the window back, not a panel
  const hiddenAfterWindow = M.withHidden(M.withWindow(M.defaultState()));
  assert.deepEqual(M.toggleTarget(hiddenAfterWindow), { kind: 'window' });
});

test('every side keeps its own width', () => {
  let s = M.withSize(M.withDock(M.defaultState(), 'right'), 'right', 500);
  s = M.withSize(M.withDock(s, 'bottom'), 'bottom', 200);
  s = M.withDock(s, 'right');
  assert.equal(M.sizeOf(s, 'right'), 500, 'the first width is still there');
  assert.equal(M.sizeOf(s, 'bottom'), 200);
  assert.equal(M.sizeOf(s, 'nonsense'), 500, 'an unknown side falls back to the active one');
});

test('hiding keeps the side, so the panel returns where it was', () => {
  const s = M.withHidden(M.withDock(M.defaultState(), 'left'));
  assert.equal(s.mode, 'off');
  assert.equal(s.side, 'left');
  assert.equal(s.lastMode, 'dock');
});
