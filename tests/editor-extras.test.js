'use strict';

// Was hier gehalten wird, sind die Zusagen der Zusatzwerkzeuge - nicht ihre
// Oberflaeche. Die Rechenteile laufen ohne Fenster; alles, was ein Fenster
// braucht, wird wie in den anderen Tests am Quelltext geprueft.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

test('Eine Gruppe findet ihre Setzungen ueber Bautyp und Feld wieder', () => {
  const placements = [
    { ref: 'f:0:0', type: 20, off: off(5, 5) },
    { ref: 'f:1:0', type: 20, off: off(6, 5) },
    { ref: 'f:2:0', type: 30, off: off(7, 5) }
  ];
  const treffer = extras.matchMembersToRefs(
    [{ type: 20, off: off(5, 5) }, { type: 30, off: off(7, 5) }], placements);
  assert.deepEqual(treffer.refs, ['f:0:0', 'f:2:0']);
  assert.equal(treffer.missing, 0);

  // Was nicht mehr da ist, wird gezaehlt statt geraten.
  const luecke = extras.matchMembersToRefs(
    [{ type: 20, off: off(5, 5) }, { type: 99, off: off(1, 1) }], placements);
  assert.deepEqual(luecke.refs, ['f:0:0']);
  assert.equal(luecke.missing, 1);

  // Zwei gleiche Bauwerke bekommen zwei verschiedene Setzungen, nie dieselbe.
  const doppelt = extras.matchMembersToRefs(
    [{ type: 20, off: off(5, 5) }, { type: 20, off: off(5, 5) }],
    [{ ref: 'f:0:0', type: 20, off: off(5, 5) }, { ref: 'f:1:0', type: 20, off: off(5, 5) }]);
  assert.deepEqual(doppelt.refs, ['f:0:0', 'f:1:0']);
});

test('Nur ein gemeinsames Verschieben laesst die Gruppe neue Felder lernen', () => {
  const vorher = [{ type: 20, off: off(10, 10) }, { type: 20, off: off(11, 10) }];
  const verschoben = [{ type: 20, off: off(13, 12) }, { type: 20, off: off(14, 12) }];
  assert.deepEqual(extras.uniformDelta(vorher, verschoben), { dx: 3, dy: 2 });

  // Auseinandergezogen ist kein Verschieben.
  assert.equal(extras.uniformDelta(vorher, [{ type: 20, off: off(13, 12) }, { type: 20, off: off(20, 12) }]), null);
  // Ein anderer Bautyp an derselben Stelle ist eine andere Setzung.
  assert.equal(extras.uniformDelta(vorher, [{ type: 21, off: off(10, 10) }, { type: 20, off: off(11, 10) }]), null);
  // Eine geloeschte Setzung auch.
  assert.equal(extras.uniformDelta(vorher, [{ type: 20, off: off(10, 10) }]), null);
  // Der Zeilensprung wird richtig gerechnet: ein Feld nach rechts am Rand
  // ist ein Feld nach rechts, nicht ein Sprung in die naechste Zeile.
  assert.deepEqual(
    extras.uniformDelta([{ type: 20, off: off(98, 3) }], [{ type: 20, off: off(99, 3) }]),
    { dx: 1, dy: 0 });
});

test('Das Tastenkuerzel-Fenster kennt jetzt alle Werkzeuge des Editors', () => {
  // Der Editor prueft beim Speichern ALLE Werkzeuge aus DEFAULT_TOOL_SHORTCUTS.
  const block = editorSource.slice(
    editorSource.indexOf('const DEFAULT_TOOL_SHORTCUTS'),
    editorSource.indexOf('const deepClone'));
  const werkzeuge = [...block.matchAll(/^\s{4}(\w+):\s*\[/gm)].map(m => m[1]);
  assert.ok(werkzeuge.includes('bucket'), 'bucket muss ein Werkzeug mit Kuerzel sein');
  assert.match(editorSource, /if \(!keys\[0\]\) throw new Error/);

  // In index.html fehlt genau dieses Werkzeug - deshalb traegt das
  // Zusatzmodul die Zeile nach. Faellt die Zeile in index.html eines Tages
  // doch hinein, faellt dieser Test auf und die Doppelung wird bemerkt.
  const dialog = html.slice(html.indexOf('id="castleShortcutDialog"'), html.indexOf('id="castleIsoMapDialog"'));
  const imFenster = [...dialog.matchAll(/data-tool="(\w+)" data-slot="0"/g)].map(m => m[1]);
  const fehlend = werkzeuge.filter(tool => !imFenster.includes(tool));
  assert.deepEqual(fehlend, ['bucket']);
  assert.ok(extrasSource.includes("input.dataset.tool = 'bucket'"), 'das Zusatzmodul muss die Fill-Zeile nachtragen');
});

test('Der Editor haengt das Zusatzmodul ein und reicht sein Innenleben heraus', () => {
  assert.ok(editorSource.includes('js/editor-extras.js'), 'castle-editor.js muss das Zusatzmodul nachladen');
  assert.ok(/extras: \{[^\n]*placementRefs[^\n]*\}/.test(editorSource), 'castle-editor.js muss sein Innenleben als extras herausreichen');
  // Eingefuegt wird ueber den Weg des Editors, damit die Pruefungen dieselben
  // bleiben - das Zusatzmodul baut keinen zweiten Einfuegeweg.
  assert.ok(!/miscItems\.push|tilePositionOfsets\.push/.test(extrasSource), 'das Zusatzmodul darf nichts selbst setzen');
  assert.ok(extrasSource.includes('ex.state.copyBuffer = JSON.parse'), 'der Speicher wird dem Editor zurueckgelegt');
});
