'use strict';

// Was hier gehalten wird, sind die Zusagen der Zusatzwerkzeuge - nicht ihre
// Oberflaeche. Die Rechenteile laufen ohne Fenster; alles, was ein Fenster
// braucht, wird wie in den anderen Tests am Quelltext geprueft.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const extras = require(path.join(root, 'src', 'js', 'editor-extras.js'));
const editorSource = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
const extrasSource = fs.readFileSync(path.join(root, 'src', 'js', 'editor-extras.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');

const off = (x, y) => y * 100 + x;

test('Ein Burgenpfad wird immer zum selben Ablageschluessel', () => {
  const windows = extras.castleKeyForPath('C:\\Burgen\\Test.aiv');
  const unix = extras.castleKeyForPath('C:/burgen/test.aiv');
  assert.equal(windows, unix);
  assert.equal(extras.castleKeyForPath(null), extras.UNSAVED_KEY);
  assert.equal(extras.castleKeyForPath('   '), extras.UNSAVED_KEY);
});

test('unsaved group identity stays compatible across interface languages', () => {
  for (const label of ['Unsaved castle', 'Ungespeicherte Burg', 'Castillo sin guardar']) {
    const context = vm.createContext({ module: { exports: {} }, toolkitI18n: { t: () => label } });
    vm.runInContext(extrasSource, context);
    assert.equal(context.module.exports.castleKeyForPath(null), '(unsaved castle)');
  }
});

test('Der Kopierspeicher nimmt nur an, was der Editor auch setzen kann', () => {
  const gut = {
    groups: [{ kind: 'frame', itemType: 20, entries: [{ type: 20, dx: -1, dy: 0 }, { type: 20, dx: 1, dy: 0 }] }],
    count: 2
  };
  const geprueft = extras.sanitizeClipboard(gut);
  assert.equal(geprueft.count, 2);
  assert.equal(geprueft.groups[0].entries.length, 2);

  assert.equal(extras.sanitizeClipboard(null), null);
  assert.equal(extras.sanitizeClipboard({ groups: [] }), null);
  assert.equal(extras.sanitizeClipboard({ groups: [{ kind: 'frame', itemType: 'wall', entries: [] }] }), null);
  assert.equal(extras.sanitizeClipboard({
    groups: [{ kind: 'frame', itemType: 20, entries: [{ type: 20, dx: 1.5, dy: 0 }] }], count: 1
  }), null);
  // Die Anzahl wird nachgerechnet, nicht geglaubt.
  assert.equal(extras.sanitizeClipboard({
    groups: [{ kind: 'frame', itemType: 20, entries: [{ type: 20, dx: 0, dy: 0 }] }], count: 99
  }).count, 1);
});

test('Gruppen aus dem Speicher: kaputte Eintraege fliegen raus, Kennungen bleiben eindeutig', () => {
  const geprueft = extras.sanitizeGroups([
    { id: 'a', name: 'Torhaus', members: [{ type: 20, off: off(10, 10) }] },
    { id: 'a', name: 'Mauer', members: [{ type: 21, off: off(11, 10) }] },
    { id: 'b', name: '', members: [{ type: 20, off: 0 }] },
    { id: 'c', name: 'Leer', members: [] },
    'unsinn'
  ]);
  assert.equal(geprueft.length, 2);
  assert.deepEqual(geprueft.map(g => g.name), ['Torhaus', 'Mauer']);
  assert.notEqual(geprueft[0].id, geprueft[1].id);
});

test('Das Tastenkuerzel-Fenster kennt jetzt alle Werkzeuge des Editors', () => {
  // Der Editor prueft beim Speichern ALLE Werkzeuge aus DEFAULT_TOOL_SHORTCUTS.
  const werkzeuge = Object.keys(require('../src/js/castle-shortcuts').defaults);
  assert.ok(werkzeuge.includes('bucket'), 'bucket muss ein Werkzeug mit Kuerzel sein');
  assert.ok(werkzeuge.includes('replace'), 'replace muss ein Werkzeug mit Kuerzel sein');
  assert.match(editorSource, /shortcutConfig.validate\(candidate\)/);

  // Das Fenster ist vollstaendig in index.html. Spaet eingefuegte Felder
  // wuerden den beim Start gebundenen Tasten-Hoerer verpassen.
  const dialog = html.slice(html.indexOf('id="castleShortcutDialog"'), html.indexOf('id="castleIsoMapDialog"'));
  assert.match(dialog, /id="castleShortcutGrid"/);
  assert.match(editorSource, /for \(const \[action, label\] of shortcutConfig.actions\)/);
  assert.ok(editorSource.indexOf('shortcutGrid.append(caption, input)') < editorSource.indexOf("input.addEventListener('keydown', event =>", editorSource.indexOf('const shortcutGrid')));
  assert.ok(!extrasSource.includes('addFillShortcutRow'), 'das Zusatzmodul darf keine spaeten Kuerzelfelder mehr nachtragen');
});

test('Der Editor haengt das Zusatzmodul ein und reicht sein Innenleben heraus', () => {
  assert.ok(editorSource.includes('js/editor-extras.js'), 'castle-editor.js muss das Zusatzmodul nachladen');
  assert.ok(/extras: \{[^\n]*placementRefs[^\n]*\}/.test(editorSource), 'castle-editor.js muss sein Innenleben als extras herausreichen');
  // Eingefuegt wird ueber den Weg des Editors, damit die Pruefungen dieselben
  // bleiben - das Zusatzmodul baut keinen zweiten Einfuegeweg.
  assert.ok(!/miscItems\.push|tilePositionOfsets\.push/.test(extrasSource), 'das Zusatzmodul darf nichts selbst setzen');
  assert.ok(extrasSource.includes('ex.state.copyBuffer = JSON.parse'), 'der Speicher wird dem Editor zurueckgelegt');
});
