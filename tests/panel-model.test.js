// The window layout of the castle view area, without a screen.
//
// Everything here is arithmetic on a tree: which window sits in which box,
// what a drop does to the tree, and what a layout out of the store turns
// into. Not one of these tests needs the program to be running - if a drag
// puts a window in the wrong place, it fails here, before anybody clicks.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const M = require(path.join(__dirname, '..', 'src', 'js', 'panel-model.js'));

// The tabs of every area, in the order the tree has them: a short way to say
// what the layout looks like without writing the whole tree out.
function shape(state) {
  return M.areas(state.root).map(a => a.tabs.join('+') || '-').join(' | ');
}

test('it starts with the map alone and the slanted view closed', () => {
  const state = M.defaultState();
  assert.equal(shape(state), 'map');
  assert.equal(M.isOpen(state, 'map'), true);
  assert.equal(M.isOpen(state, 'iso'), false);
  assert.deepEqual(M.openWindows(state), ['map']);
});

// ------------------------------------------------------- the two drops

test('dropped on the middle of an area a window becomes another tab', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'tab');
  assert.equal(shape(state), 'map+iso', 'one box, two tabs');
  assert.equal(M.areas(state.root)[0].active, 'iso', 'and the one just dropped is the one shown');
  assert.equal(M.areas(state.root)[0].id, home.id, 'the box the user aimed at keeps its identity');
});

test('dropped on a side the area is cut in two', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  const right = M.place(state, 'iso', home.id, 'right');
  assert.equal(shape(right), 'map | iso', 'map first, the new window second');
  assert.equal(right.root.kind, 'split');
  assert.equal(right.root.dir, 'row');

  const left = M.place(state, 'iso', home.id, 'left');
  assert.equal(shape(left), 'iso | map', 'left means the new window comes first');
  assert.equal(left.root.dir, 'row');

  const top = M.place(state, 'iso', home.id, 'top');
  assert.equal(shape(top), 'iso | map');
  assert.equal(top.root.dir, 'col', 'above and below cut the other way');

  const bottom = M.place(state, 'iso', home.id, 'bottom');
  assert.equal(shape(bottom), 'map | iso');
  assert.equal(bottom.root.dir, 'col');
});

test('a window is only ever in one place, however it is moved', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'right');
  const isoArea = M.areaOf(state, 'iso');
  // and now drag the map over to the slanted view's box
  state = M.place(state, 'map', isoArea.id, 'tab');
  assert.equal(shape(state), 'iso+map', 'the box it came from is gone, not left empty');
  assert.equal(M.openWindows(state).filter(w => w === 'map').length, 1);
  assert.equal(state.root.kind, 'area', 'and the split that held them collapsed');
});

test('dropping a window back on its own area changes nothing but shows it', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'tab');
  state = M.select(state, home.id, 'map');
  const before = state.root;
  const after = M.place(state, 'iso', home.id, 'tab');
  assert.equal(shape(after), 'map+iso', 'the layout is untouched');
  assert.equal(M.areaOf(after, 'iso').id, before.id, 'and it is the very same box');
  assert.equal(M.areas(after.root)[0].active, 'iso', 'letting go of it shows it');
});

// --------------------------------------------------- closing and opening

test('closing the last window leaves an empty view, not a broken one', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'right');
  state = M.close(state, 'iso');
  assert.equal(shape(state), 'map', 'the box it had is gone and the map takes the room');
  state = M.close(state, 'map');
  assert.equal(shape(state), '-', 'one empty area is left');
  assert.deepEqual(M.openWindows(state), []);
  assert.equal(state.root.kind, 'area', 'and it is a box that can be dropped into');
});

test('a window reopens where it last was', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'bottom');
  assert.equal(shape(state), 'map | iso');
  state = M.close(state, 'iso');
  state = M.open(state, 'iso');
  assert.equal(shape(state), 'map | iso', 'below, where it was, not on the right');
  assert.equal(state.root.dir, 'col');
});

test('the first time it is opened the slanted view docks to the right', () => {
  const state = M.open(M.defaultState(), 'iso');
  assert.equal(shape(state), 'map | iso');
  assert.equal(state.root.dir, 'row');
});

test('opening a window that is already open only brings it to the front', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'tab');
  state = M.select(state, home.id, 'map');
  const same = M.open(state, 'iso');
  assert.equal(shape(same), 'map+iso');
  assert.equal(M.areas(same.root)[0].active, 'iso');
});

test('a window can be opened into the empty view', () => {
  let state = M.close(M.close(M.defaultState(), 'iso'), 'map');
  assert.equal(shape(state), '-');
  state = M.open(state, 'map');
  assert.equal(shape(state), 'map');
  assert.equal(M.isOpen(state, 'map'), true);
});

// ------------------------------------------------------------- splitters

test('every split has a path, and the path moves that split and no other', () => {
  let state = M.defaultState();
  const home = M.areas(state.root)[0];
  state = M.place(state, 'iso', home.id, 'right');
  const outer = M.splits(state.root);
  assert.equal(outer.length, 1);
  assert.equal(outer[0].path, '', 'the root split is named by the empty path');

  const moved = M.resize(state, '', 0.3);
  assert.equal(moved.root.share, 0.3);
  assert.equal(M.resize(state, '', 5).root.share, M.MAX_SHARE, 'and it cannot be pushed past the edge');
  assert.equal(M.resize(state, '', -5).root.share, M.MIN_SHARE);
  assert.equal(M.resize(state, 'zz', 0.3), state, 'a path to nothing changes nothing');
});

// ------------------------------------------------------- reading it back

test('anything at all can come out of the store without throwing', () => {
  const rubbish = [null, undefined, 0, 'x', [], {}, { root: null }, { root: { kind: 'split' } },
                   { root: { kind: 'area', tabs: null } }, { root: { kind: 'area', tabs: ['nope'] } },
                   { v: 99, root: { kind: 'split', dir: 'row', a: null, b: null } }];
  for (const raw of rubbish) {
    const state = M.normalize(raw);
    assert.ok(state && state.root, 'a tree came back for ' + JSON.stringify(raw));
    assert.ok(M.areas(state.root).length >= 1, 'with at least one box');
    assert.equal(state.v, M.VERSION);
  }
});

test('a stored layout naming the same window twice keeps only the first', () => {
  const state = M.normalize({
    v: 2,
    root: { kind: 'split', dir: 'row',
            a: { kind: 'area', tabs: ['map', 'iso'], active: 'map' },
            b: { kind: 'area', tabs: ['iso'], active: 'iso' } }
  });
  assert.equal(M.openWindows(state).filter(w => w === 'iso').length, 1,
    'one window, one place - two tabs for it would leave one of them empty');
  assert.equal(shape(state), 'map+iso', 'and the emptied box collapsed');
});

test('a stored layout survives the round trip through JSON unchanged', () => {
  let state = M.defaultState();
  state = M.place(state, 'iso', M.areas(state.root)[0].id, 'bottom');
  state = M.resize(state, '', 0.62);
  const back = M.normalize(JSON.parse(JSON.stringify(state)));
  assert.equal(shape(back), shape(state));
  assert.equal(back.root.share, 0.62);
  assert.equal(back.root.dir, 'col');
});

test('closed windows are listed, so the buttons know what they offer', () => {
  const state = M.defaultState();
  assert.deepEqual(state.closed, ['iso']);
  const both = M.open(state, 'iso');
  assert.deepEqual(both.closed, []);
  assert.deepEqual(M.close(both, 'map').closed, ['map']);
});

test('nothing is edited in place: the state handed in is the state handed back', () => {
  const state = M.defaultState();
  const before = JSON.stringify(state);
  const home = M.areas(state.root)[0];
  M.place(state, 'iso', home.id, 'right');
  M.close(state, 'map');
  M.select(state, home.id, 'map');
  M.resize(state, '', 0.9);
  assert.equal(JSON.stringify(state), before, 'the old state was not touched');
});
