// Tests for the 2.5D view. Everything here runs without a screen: the
// geometry is checked as plain arithmetic, and the way the view is wired
// into the app is checked by reading index.html, app-shell.js and the CSS.
//
// The wiring tests exist because three mistakes slipped through on
// 05.09.2026 that a screenshot found but the code would have shown just as
// well: the tab was inserted twice, the section landed inside the castle
// workspace instead of next to it, and the height rule was missing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const geometry = require(path.join(root, 'src', 'js', 'iso-geometry.js'));
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src', 'js', 'app-shell.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');

// ---------------------------------------------------------------- geometry

test('editor offset becomes grid coordinates, y flipped', () => {
  // The default keep sits at 5643 => x 43, editor y 56 => grid y 43
  assert.deepEqual(geometry.gridFromOffset(5643), { gx: 43, gy: 43 });
  assert.deepEqual(geometry.gridFromOffset(0), { gx: 0, gy: 99 });
  assert.deepEqual(geometry.gridFromOffset(9999), { gx: 99, gy: 0 });
});

test('offset and grid convert back and forth', () => {
  for (const offset of [0, 1, 99, 100, 5643, 9999]) {
    const { gx, gy } = geometry.gridFromOffset(offset);
    assert.equal(geometry.offsetFromGrid(gx, gy), offset);
  }
});

test('the isometric point puts north up-right and south down-left', () => {
  const view = { zoom: 1, panX: 0, panY: 0 };
  assert.deepEqual(geometry.isoPoint(0, 0, view), [0, 0]);
  // one step east: right and down
  assert.deepEqual(geometry.isoPoint(1, 0, view), [16, 8]);
  // one step south: left and down
  assert.deepEqual(geometry.isoPoint(0, 1, view), [-16, 8]);
  // both: straight down by a whole tile
  assert.deepEqual(geometry.isoPoint(1, 1, view), [0, 16]);
});

test('depth: bigger buildings reach further to the front', () => {
  assert.equal(geometry.depth({ gx: 10, gy: 10, tiles: 1 }), 20);
  assert.equal(geometry.depth({ gx: 10, gy: 10, tiles: 5 }), 28);
  const back = { gx: 5, gy: 5, tiles: 1 };
  const front = { gx: 40, gy: 40, tiles: 1 };
  assert.ok(geometry.byDepth(back, front) < 0, 'the one at the back is painted first');
});

test('a sprite sits centred on its lowest tile', () => {
  const view = { zoom: 1, panX: 100, panY: 100 };
  const sprite = { breite: 30, hoehe: 16 };          // a single flat tile
  const rect = geometry.spriteRect(sprite, 0, 0, 1, view);
  assert.equal(rect.w, 30);
  assert.equal(rect.h, 16);
  assert.equal(rect.x, 100 - 15, 'horizontally centred on the tile');
  assert.equal(rect.y, 100, 'a flat tile ends exactly at the tile centre + 16');
});

test('collectItems reads every position of every build step', () => {
  const doc = {
    frames: [
      { itemType: 61, tilePositionOfsets: [5643] },
      { itemType: 80, tilePositionOfsets: [1000, 1005, 1010] },
      { itemType: 999, tilePositionOfsets: [2000] }        // unknown type
    ]
  };
  const catalogue = { gegenstaende: { 61: { kacheln: 7 }, 80: { kacheln: 4 } } };
  const items = geometry.collectItems(doc, catalogue);
  assert.equal(items.length, 5);
  assert.equal(items[0].tiles, 7);
  assert.equal(items[1].tiles, 4);
  assert.equal(items[4].entry, null, 'unknown types stay in, without a sprite');
  assert.equal(items[4].tiles, 1);
});

test('collectItems copes with an empty or broken document', () => {
  assert.deepEqual(geometry.collectItems(null, {}), []);
  assert.deepEqual(geometry.collectItems({}, {}), []);
  assert.deepEqual(geometry.collectItems({ frames: [{ itemType: 1 }] }, {}), []);
});

test('ground plates are placed relative to their building', () => {
  const items = [{ gx: 10, gy: 20, entry: { platten: [{ dx: 0, dy: 8, kacheln: 7, bild: 'a.png' }] } }];
  const plates = geometry.collectPlates(items);
  assert.equal(plates.length, 1);
  assert.deepEqual([plates[0].gx, plates[0].gy, plates[0].tiles], [10, 28, 7]);
});

test('fitView puts the whole grid into the box', () => {
  const view = geometry.fitView(1200, 800);
  const corners = [[0, 0], [100, 0], [100, 100], [0, 100]]
    .map(([x, y]) => geometry.isoPoint(x, y, view));
  const xs = corners.map(p => p[0]);
  const ys = corners.map(p => p[1]);
  assert.ok(Math.min(...xs) >= -1 && Math.max(...xs) <= 1201, 'fits horizontally');
  assert.ok(Math.min(...ys) >= -1 && Math.max(...ys) <= 801, 'fits vertically');
});

// ----------------------------------------------------------------- wiring

test('the 2.5D view is opened from the castle toolbar, not as a tab', () => {
  assert.ok(html.includes('id="castleIsoBtn"'), 'the button lives in the castle toolbar');
  assert.ok(!html.includes('data-workspace="iso"'), 'no separate tab any more');
  assert.ok(!html.includes('id="isoWorkspace"'), 'no separate workspace any more');
  assert.ok(!shell.includes('isoWorkspace'), 'the shell does not know it either');
});

test('the castle editor lets an outside view use its tools', () => {
  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.ok(editor.includes('pointerFromOutside'), 'the bridge exists');
  assert.ok(editor.includes('tileFromOutside'), 'pointerPosition honours a given tile');
  assert.ok(editor.includes('function tileToScreenPos'), 'a tile can be turned back into screen coordinates');
  // synthetic events have no real pointer, so every capture must be guarded
  const capture = (editor.match(/\.setPointerCapture\(/g) || []).length;
  const guarded = (editor.match(/try \{ els\.canvas\.setPointerCapture\(/g) || []).length;
  assert.equal(capture, guarded, `${capture} calls to setPointerCapture, only ${guarded} of them guarded`);
});

test('the view hands every gesture to the editor, it keeps no rules of its own', () => {
  const view = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  for (const phase of ['down', 'move', 'up'])
    assert.ok(view.includes(`toEditor('${phase}'`), 'phase ' + phase + ' is forwarded');
  for (const wort of ['placeSingle', 'brushAdd', 'routedLineTiles', 'placeCopy'])
    assert.ok(!view.includes(wort), 'the view must not carry its own copy of ' + wort);
});

test('the view scripts are loaded, geometry before the view', () => {
  const geo = html.indexOf('js/iso-geometry.js');
  const view = html.indexOf('js/iso-view.js');
  assert.ok(geo > 0 && view > 0, 'both scripts are included');
  assert.ok(geo < view, 'geometry has to be there before the view uses it');
});

test('every element the view expects in the main window exists in the html', () => {
  const viewSource = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  // The detached window builds its own elements; those ids are written into
  // its body and are looked up on win.document, not on the main document.
  const eigene = [...viewSource.matchAll(/win\.document\.getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const wanted = [...viewSource.matchAll(/(?<!win\.)document\.getElementById\('([^']+)'\)/g)]
    .map(m => m[1]).filter(id => !eigene.includes(id));
  assert.ok(wanted.length > 0, 'the view talks to at least one element of the main window');
  for (const id of wanted) {
    assert.ok(html.includes(`id="${id}"`), `the html is missing #${id}`);
  }
  // and the ids it builds itself must actually be written into the new body
  for (const id of eigene) {
    assert.ok(viewSource.includes(`id="${id}"`), `the window body never creates #${id}`);
  }
});

// --------------------------------------------------------------- sprites

test('the sprite catalogue is complete and its files are there', (t) => {
  const dir = path.join(root, 'assets', 'aiv', 'iso');
  if (!fs.existsSync(path.join(dir, 'verzeichnis.json'))) {
    t.skip('no sprites exported yet - run _exportiere_iso.js from Village Studio');
    return;
  }
  const catalogue = JSON.parse(fs.readFileSync(path.join(dir, 'verzeichnis.json'), 'utf8'));
  const entries = Object.entries(catalogue.gegenstaende);
  assert.ok(entries.length > 50, 'a useful number of items');
  for (const [type, entry] of entries) {
    assert.ok(fs.existsSync(path.join(dir, entry.bild)), `sprite file missing for ${type} (${entry.name})`);
    assert.ok(entry.kacheln >= 1 && entry.kacheln <= 13, `odd footprint for ${type}`);
    assert.ok(entry.breite > 0 && entry.hoehe > 0, `odd size for ${type}`);
    for (const plate of entry.platten || []) {
      assert.ok(fs.existsSync(path.join(dir, plate.bild)), `plate file missing for ${type}`);
    }
  }
});

test('the catalogue covers what a real castle uses', (t) => {
  const dir = path.join(root, 'assets', 'aiv', 'iso');
  if (!fs.existsSync(path.join(dir, 'verzeichnis.json'))) { t.skip('no sprites'); return; }
  const catalogue = JSON.parse(fs.readFileSync(path.join(dir, 'verzeichnis.json'), 'utf8'));
  // the keep is the one item every castle has
  assert.ok(catalogue.gegenstaende['61'], 'the keep needs a sprite');
  assert.equal(catalogue.gegenstaende['61'].kacheln, 7);
});

test('sprite paths are relative to src/index.html, like the rest of the app', () => {
  const view = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const pfade = [...view.matchAll(/(?:CATALOGUE_PATH|SPRITE_PATH) = '([^']+)'/g)].map(m => m[1]);
  assert.ok(pfade.length >= 2, 'both paths are declared');
  for (const p of pfade) {
    assert.ok(p.startsWith('../assets/'),
      p + ' has to start with ../assets/ — the page is loaded from src/, the assets live next to it');
    const real = path.join(root, 'src', p);
    assert.ok(fs.existsSync(real) || fs.existsSync(path.dirname(real)),
      p + ' does not resolve to anything on disk');
  }
});

// ------------------------------------ der Auswahlkasten in der schraegen Ansicht

test('the marquee outline is the map rectangle, turned into the slanted view', () => {
  const view = { panX: 0, panY: 0, zoom: 1 };
  // Ein Feld: (10,20) im Editor. Der Umriss umschliesst die Kachel, also
  // reicht er von 10 bis 11 und - weil y nach oben zaehlt - von 99-20 bis
  // 99-20+1 im Bildschirmsystem.
  const eins = geometry.marqueeOutline({ x0: 10, y0: 20, x1: 10, y1: 20 }, view);
  assert.equal(eins.length, 4);
  assert.deepEqual(eins[0], geometry.isoPoint(10, 79, view));
  assert.deepEqual(eins[1], geometry.isoPoint(11, 79, view));
  assert.deepEqual(eins[2], geometry.isoPoint(11, 80, view));
  assert.deepEqual(eins[3], geometry.isoPoint(10, 80, view));
});

test('the marquee does not care which corner the drag started in', () => {
  const view = { panX: 0, panY: 0, zoom: 1 };
  const hin = geometry.marqueeOutline({ x0: 10, y0: 20, x1: 14, y1: 26 }, view);
  const zurueck = geometry.marqueeOutline({ x0: 14, y0: 26, x1: 10, y1: 20 }, view);
  assert.deepEqual(hin, zurueck, 'von links unten oder von rechts oben gezogen: derselbe Kasten');
  const quer = geometry.marqueeOutline({ x0: 14, y0: 20, x1: 10, y1: 26 }, view);
  assert.deepEqual(hin, quer, 'und ueber die beiden anderen Ecken auch');
});

test('no box, no outline', () => {
  const view = { panX: 0, panY: 0, zoom: 1 };
  assert.equal(geometry.marqueeOutline(null, view), null);
});

test('every drawn item carries the key the editor uses for its selection', () => {
  const dokument = { frames: [
    { itemType: 20, tilePositionOfsets: [2030, 2031] },
    { itemType: 25, tilePositionOfsets: [4050] }
  ] };
  const items = geometry.collectItems(dokument, { gegenstaende: {} });
  assert.deepEqual(items.map(i => i.ref), ['f:0:0', 'f:0:1', 'f:1:0'],
    'derselbe Aufbau wie frameRefKey in castle-editor.js: f:<Bauschritt>:<Feld>');
});

test('a crenellated wall alternates merlon and embrasure, tile by tile', () => {
  const zinne = { bild: 'klotz.png', breite: 30, hoehe: 118, kacheln: 1,
                  wechselBild: 'scharte.png', wechselBreite: 30, wechselHoehe: 103 };
  // gy zaehlt den Bildschirm hinunter: Editor-y = 99 - gy. Die Zinne steht,
  // wo x + y ungerade ist - dieselbe Regel wie im Spiel.
  const feld = (gx, gy) => geometry.variantFor(zinne, gx, gy).bild;
  assert.equal(feld(0, 98), 'klotz.png', 'x 0, y 1 -> ungerade -> Zinne');
  assert.equal(feld(1, 98), 'scharte.png', 'x 1, y 1 -> gerade -> Scharte');
  assert.equal(feld(1, 99), 'klotz.png', 'x 1, y 0 -> ungerade -> Zinne');
  assert.equal(feld(0, 99), 'scharte.png', 'x 0, y 0 -> gerade -> Scharte');

  // Nebeneinander wechselt es Feld fuer Feld, und eine Zeile weiter versetzt.
  const zeile = gy => [0,1,2,3,4,5].map(gx => feld(gx, gy) === 'klotz.png' ? 'Z' : '.').join('');
  assert.equal(zeile(99), '.Z.Z.Z');
  assert.equal(zeile(98), 'Z.Z.Z.', 'die naechste Reihe ist versetzt - ein Schachbrett');

  // Jeder andere Bau bleibt unberuehrt.
  const haus = { bild: 'haus.png', breite: 126, hoehe: 138, kacheln: 4 };
  assert.equal(geometry.variantFor(haus, 3, 7), haus, 'ohne zweite Fassung derselbe Eintrag');
  assert.equal(geometry.variantFor(null, 0, 0), null);

  // Und das Zeichnen benutzt die gewaehlte Fassung, nicht mehr den Eintrag.
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const malen = script.slice(script.indexOf('function drawSprite'), script.indexOf('function drawDiamond'));
  assert.match(malen, /const variant = geo\.variantFor\(sprite, gx, gy\)/);
  assert.match(malen, /image\(variant\.bild\)/);
  assert.match(malen, /geo\.spriteRect\(variant, gx, gy/);
});
