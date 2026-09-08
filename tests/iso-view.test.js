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
  // Die Diagonale durch Ost- und Suedecke, nicht durch die vordere Spitze:
  // ein Bau von 5 Feldern kommt n-1 = 4 weiter nach vorn, nicht 2*(n-1) = 8.
  assert.equal(geometry.depth({ gx: 10, gy: 10, tiles: 5 }), 24);
  const back = { gx: 5, gy: 5, tiles: 1 };
  const front = { gx: 40, gy: 40, tiles: 1 };
  assert.ok(geometry.byDepth(back, front) < 0, 'the one at the back is painted first');
});

// Monsterfish im Discord: "bei dem tur gibts noch sortierungs probleme wo der
// vor den treppen liegt". Genau dieser Fall, als Zahl: eine Treppe an der
// Ostseite eines 7x7-Torhauses hat ein groesseres gx als der ganze Bau, also
// steht sie davor - und muss NACH ihm gemalt werden.
test('ein Bau verdeckt nichts mehr, was seitlich davor steht', () => {
  const torhaus = { gx: 20, gy: 20, tiles: 7 };      // [20..26] x [20..26]
  const turm = { gx: 31, gy: 14, tiles: 6 };         // [31..36] x [14..19]
  // alles, was rundum ein Feld weiter VORNE liegt, kommt spaeter
  for (let gy = 20; gy <= 26; gy += 1) {
    assert.ok(geometry.byDepth(torhaus, { gx: 27, gy, tiles: 1 }) < 0,
      `Feld (27, ${gy}) steht oestlich vor dem Torhaus und gehoert davor`);
    assert.ok(geometry.byDepth(torhaus, { gx: gy, gy: 27, tiles: 1 }) < 0,
      `Feld (${gy}, 27) steht suedlich vor dem Torhaus und gehoert davor`);
  }
  // und alles, was rundum ein Feld weiter HINTEN liegt, kommt frueher
  for (let gy = 20; gy <= 26; gy += 1) {
    assert.ok(geometry.byDepth({ gx: 19, gy, tiles: 1 }, torhaus) < 0,
      `Feld (19, ${gy}) steht westlich hinter dem Torhaus`);
    assert.ok(geometry.byDepth({ gx: gy, gy: 19, tiles: 1 }, torhaus) < 0,
      `Feld (${gy}, 19) steht noerdlich hinter dem Torhaus`);
  }
  for (let gy = 14; gy <= 19; gy += 1) {
    assert.ok(geometry.byDepth(turm, { gx: 37, gy, tiles: 1 }) < 0,
      `Feld (37, ${gy}) steht vor dem Turm und gehoert davor`);
  }
  // Gegenprobe, dass der Test etwas taugt: mit der alten Zahl faellt er.
  const alt = item => item.gx + item.gy + 2 * ((item.tiles || 1) - 1);
  assert.ok(alt(torhaus) > alt({ gx: 27, gy: 20, tiles: 1 }),
    'die alte Rechnung legte das Torhaus vor die Treppe - genau der Fehler');
});

// Zwei Bauten nebeneinander, in beiden Achsen und in beiden Richtungen.
test('zwei mehrfeldrige Bauten nebeneinander stehen in der richtigen Folge', () => {
  const a = { gx: 10, gy: 10, tiles: 5 };            // [10..14] x [10..14]
  const faelle = [
    [{ gx: 15, gy: 10, tiles: 5 }, 'oestlich davor'],
    [{ gx: 10, gy: 15, tiles: 5 }, 'suedlich davor'],
    [{ gx: 15, gy: 15, tiles: 5 }, 'diagonal davor'],
    [{ gx: 15, gy: 12, tiles: 3 }, 'kleiner, oestlich davor'],
    [{ gx: 12, gy: 15, tiles: 3 }, 'kleiner, suedlich davor']
  ];
  for (const [b, was] of faelle) assert.ok(geometry.byDepth(a, b) < 0, was);
  const dahinter = [
    [{ gx: 5, gy: 10, tiles: 5 }, 'westlich dahinter'],
    [{ gx: 10, gy: 5, tiles: 5 }, 'noerdlich dahinter'],
    [{ gx: 7, gy: 12, tiles: 3 }, 'kleiner, westlich dahinter'],
    [{ gx: 12, gy: 7, tiles: 3 }, 'kleiner, noerdlich dahinter']
  ];
  for (const [b, was] of dahinter) assert.ok(geometry.byDepth(b, a) < 0, was);
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
  assert.match(malen, /const variant = geo\.variantFor\(sprite, gx, gy, mauerAn, hoeheAn\)/);
  assert.match(malen, /image\(variant\.bild\)/);
  assert.match(malen, /geo\.spriteRect\(variant, gx, gy/);
});

// ------------------------------------------------------------------ Treppen
//
// Daniel am 06.09.2026: "die haben noch keine hoehe, die sind bisher nur alle
// einfach trappen". Genau das pruefen die naechsten drei Tests - dass jede
// Stufe ihre eigene, gemessene Hoehe hat und dass daraus ein steigender Lauf
// wird.

// Ein Katalogeintrag, wie ihn _exportiere_iso.js schreibt. Die Bildhoehen sind
// die echten: Trittflaeche ueber der Bodenraute (hier 12) + 16 Zeilen Raute +
// Koerperhoehe.
function treppenEintrag(hoehe) {
  const bild = (name, ueberRaute) =>
    ({ bild: name, breite: 30, hoehe: ueberRaute + 16 + hoehe });
  return {
    name: 'Treppe', kacheln: 1,
    bild: 'allein.png', breite: 30, hoehe: 2 + 16 + hoehe,
    treppe: {
      hoehe,
      richtungen: {
        r0: bild('r0.png', 12), r2: bild('r2.png', 7),
        r4: bild('r4.png', 7), r6: bild('r6.png', 12),
        allein: bild('allein.png', 2),
      },
    },
  };
}

test('eine gezogene Treppe steigt - jede Stufe hat ihre eigene Hoehe', (t) => {
  const dir = path.join(root, 'assets', 'aiv', 'iso');
  if (!fs.existsSync(path.join(dir, 'verzeichnis.json'))) { t.skip('keine Bilder ausgegeben'); return; }
  const katalog = JSON.parse(fs.readFileSync(path.join(dir, 'verzeichnis.json'), 'utf8')).gegenstaende;

  // Gemessen in placeDefensiveStructureTile (0x005034a0), je Mapper eine
  // Zeile: 181 -> +0x50, 182 -> +0x40, 183 -> +0x30, 184 -> +0x20,
  // 185 -> +0x10, 186 hat gar keine.
  const erwartet = { 181: 80, 182: 64, 183: 48, 184: 32, 185: 16, 186: 0 };
  for (const [mapper, hoehe] of Object.entries(erwartet)) {
    const e = katalog[mapper];
    assert.ok(e && e.treppe, 'Mapper ' + mapper + ' braucht einen Treppeneintrag');
    assert.equal(e.treppe.hoehe, hoehe, 'Mapper ' + mapper);
    // Stufe 6 ist keine Treppe: Mapper 186 setzt kein L_STAIRS-Bit, und genau
    // daran haengt der Treppenzweig in updateGfxLayer. Das Spiel zeichnet dort
    // eine Bodenkachel - sie bekommt darum genau eine flache Fassung und keine
    // Richtungen, sonst zeigt der Editor eine Treppe, die es nie gibt.
    const noetig = Number(mapper) === 186 ? ['allein'] : ['r0', 'r2', 'r4', 'r6', 'allein'];
    assert.deepEqual(Object.keys(e.treppe.richtungen).sort(), [...noetig].sort(),
      'Mapper ' + mapper + ' hat die falschen Ansichten');
    for (const richtung of noetig) {
      const f = e.treppe.richtungen[richtung];
      assert.ok(f, mapper + ' fehlt die Ansicht ' + richtung);
      assert.ok(fs.existsSync(path.join(dir, f.bild)), 'Bilddatei fehlt: ' + f.bild);
    }
  }

  // Und der Lauf steigt wirklich: das Bild von Stufe 1 ist genau 64 Zeilen
  // hoeher als das von Stufe 5 - 80 minus 16. spriteRect setzt beide auf
  // ihrer Kachel ab, also liegt Stufe 1 um diese 64 hoeher.
  const hoch = katalog['181'].treppe.richtungen.r6.hoehe;
  const tief = katalog['185'].treppe.richtungen.r6.hoehe;
  assert.equal(hoch - tief, 64, 'Stufe 1 steht 64 Punkte ueber Stufe 5');
  assert.equal(katalog['186'].treppe.hoehe, 0, 'Stair6 heisst Floor und ist es auch');
  // und hat darum keinen Koerper: ihr Bild ist genau die nackte Bodenkachel,
  // 18 Zeilen, so hoch wie tile_land3#104 selbst.
  assert.equal(katalog['186'].treppe.richtungen.allein.hoehe, 18,
    'Stufe 6 steht auf dem Boden, ohne Koerper darunter');
  assert.ok(katalog['181'].treppe.richtungen.allein.hoehe
            - katalog['186'].treppe.richtungen.allein.hoehe === 80,
    'und Stufe 1 genau 80 Zeilen darueber');
});

test('eine Treppe zeigt zur Seite, auf der der hoehere Nachbar liegt', () => {
  const stufe = treppenEintrag(64);
  const ohne = geometry.variantFor(stufe, 10, 10, null, () => null);
  assert.equal(ohne.bild, 'allein.png', 'kein hoeherer Nachbar -> das flache Podest');

  // Die Zuordnung ist am Bild gemessen (Probebilder 11_/12_/13_ vom
  // 06.09.2026): nur so setzen sich die fuenf Stufen zu EINEM Lauf zusammen.
  const nachbar = (dx, dy, art) => (gx, gy) =>
    (gx === 10 + dx && gy === 10 + dy) ? { hoehe: 90, art: art || 'mauer' } : null;
  assert.equal(geometry.variantFor(stufe, 10, 10, null, nachbar(-1, 0)).bild, 'r6.png');
  assert.equal(geometry.variantFor(stufe, 10, 10, null, nachbar(0, -1)).bild, 'r0.png');
  assert.equal(geometry.variantFor(stufe, 10, 10, null, nachbar(1, 0)).bild, 'r2.png');
  assert.equal(geometry.variantFor(stufe, 10, 10, null, nachbar(0, 1)).bild, 'r4.png');

  // Ein NIEDRIGERER Nachbar zaehlt nicht - sonst wuerde die Treppe nach unten
  // statt nach oben zeigen.
  const tiefer = () => ({ hoehe: 16, art: 'mauer' });
  assert.equal(geometry.variantFor(stufe, 10, 10, null, tiefer).bild, 'allein.png');

  // Der Normalfall in einer echten Burg: die Stufe hat auf der einen Seite
  // die naechsthoehere STUFE und auf der anderen die MAUER, an der sie
  // entlanglaeuft. Das Spiel fragt erst alle vier Richtungen nach einer
  // Treppe ab und danach erst nach einer Mauer - also gewinnt die Stufe,
  // auch wenn die Mauer in der Richtungsliste frueher drankaeme.
  const beides = (gx, gy) => {
    if (gx === 11 && gy === 10) return { hoehe: 90, art: 'mauer' };  // r2, waere zuerst dran
    if (gx === 9 && gy === 10) return { hoehe: 80, art: 'treppe' };  // r6
    return null;
  };
  assert.equal(geometry.variantFor(stufe, 10, 10, null, beides).bild, 'r6.png',
    'die naechste Stufe schlaegt die Mauer');

  // Und eine ZINNENmauer zaehlt gar nicht: hasHigherPlainNeighborWithWall-
  // OrGatehouse schliesst L_CRENEL aus.
  const nurZinne = nachbar(-1, 0, 'zinne');
  assert.equal(geometry.variantFor(stufe, 10, 10, null, nurZinne).bild, 'allein.png');
});

test('hoehenLookup kennt Mauern und Treppen, sonst nichts', () => {
  const felder = [
    { gx: 1, gy: 1, entry: { mauer: { hoehe: 90 } } },
    { gx: 2, gy: 1, entry: treppenEintrag(48) },
    { gx: 3, gy: 1, entry: { bild: 'haus.png' } },
  ];
  const hoeheAn = geometry.hoehenLookup(felder);
  assert.deepEqual(hoeheAn(1, 1), { hoehe: 90, art: 'mauer' });
  assert.deepEqual(hoeheAn(2, 1), { hoehe: 48, art: 'treppe' });
  assert.equal(hoeheAn(3, 1), null, 'fuer ein Haus ist keine Hoehe gemessen');
  assert.equal(hoeheAn(9, 9), null);

  // Eine Zinnenmauer wird getrennt gefuehrt - fuer die Treppe zaehlt sie nicht.
  const zinne = geometry.hoehenLookup([{ gx: 4, gy: 1, entry: { mauer: { hoehe: 98, zinne: true } } }]);
  assert.deepEqual(zinne(4, 1), { hoehe: 98, art: 'zinne' });

  // Hoehe 0 ist eine Hoehe, kein "nichts" - sonst faellt Stufe 6 heraus.
  const boden = geometry.hoehenLookup([{ gx: 0, gy: 0, entry: treppenEintrag(0) }]);
  assert.deepEqual(boden(0, 0), { hoehe: 0, art: 'treppe' });
});

test('auch die Vorschau kennt die Hoehen, damit eine gezogene Treppe schon beim Ziehen steigt', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const vorschau = script.slice(script.indexOf('function drawPreview'),
                                script.indexOf('function drawSelection'));
  assert.match(vorschau, /geo\.hoehenLookup\(kuenftig\)/,
    'die Felder der Vorschau muessen fuer die Treppenregel schon mitzaehlen');
  assert.match(vorschau, /drawSprite\(ctx, eintrag, feld\.gx, feld\.gy, kacheln, mauerAn, hoeheAn\)/);
});

test('dragging a wall shows the whole run at half opacity, not just one tile', () => {
  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const vorschau = editor.slice(editor.indexOf('getPlacementPreview()'),
                                editor.indexOf('getContent: outputContent'));
  // Laeuft ein Zug, ist er selbst die Vorschau - nicht das Feld unter dem Zeiger.
  assert.match(vorschau, /if \(state\.brushOffsets && state\.brushOffsets\.length\)/);
  assert.match(vorschau, /itemType: state\.brushTypes\[i\] \?\? erster/,
    'jedes Feld nennt sein eigenes Bauwerk - eine Treppe legt mehrere');

  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const malen = iso.slice(iso.indexOf('function drawPreview'), iso.indexOf('function drawSelection'));
  assert.match(malen, /ctx\.globalAlpha = 0\.5/, 'halbdurchsichtig wie bei den Gebaeuden');
  assert.match(malen, /feld\.itemType != null \? feld\.itemType : vorschau\.itemType/,
    'und die Ansicht schlaegt je Feld nach');
});

test('picking a wall opens the line tool, without overwriting the remembered one', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const waehlen = script.slice(script.indexOf('function selectItem('), script.indexOf('function updateSelectedItemInfo'));
  assert.match(waehlen, /if \(isWallType\(type\)\) setTool\('line', false\)/,
    'Mauern werden gezogen, nicht getupft');
  assert.match(waehlen, /else setTool\(state\.lastPlacementTool\)/,
    'alles andere kommt zurueck zu dem, was der Nutzer gewaehlt hatte');
  // Welche Bauten Mauern sind, steht in der Konfiguration - nicht hier.
  const wall = script.slice(script.indexOf('function isWallType('), script.indexOf("function setTool(tool"));
  assert.match(wall, /state\.categories && state\.categories\.Walls/);
  const kategorien = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_categories.json'), 'utf8'));
  assert.deepEqual(kategorien.categories.Walls.sort(), ['25', '26', '35', '46'],
    'die vier Mauern - aendert sich das, aendert sich das Verhalten mit');
  // Das Merken haengt am Schalter, nicht am Zufall.
  const setzen = script.slice(script.indexOf('function setTool(tool'), script.indexOf('function selectItem('));
  assert.match(setzen, /function setTool\(tool, remember = true\)/);
  assert.match(setzen, /if \(remember && isPlacementTool\(tool\) && !lineOnly\)/);
});

test('the ground is tiled at the same scale as the map, not stretched', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const grund = iso.slice(iso.indexOf('function paintGround'), iso.indexOf('function drawSprite'));
  assert.match(grund, /createPattern\(img, 'repeat'\)/, 'wiederholt, nicht gestreckt');
  // Ein Feld im Bild muss ein Feld im Editor sein: Spielkachel 30, unsere 32.
  assert.match(grund, /\(\(geo\.HALF_W \* 2\) \/ GAME_TILE_WIDTH\) \* state\.view\.zoom/);
  assert.equal(geometry.HALF_W * 2, 32, 'unsere Kachel ist 32 Punkte breit');
  assert.match(iso, /const GAME_TILE_WIDTH = 30/, 'die des Spiels 30');
  // Mitwandern beim Schieben, und am Kartenrand ist Schluss.
  assert.match(grund, /ctx\.translate\(state\.view\.panX, state\.view\.panY\)/);
  assert.match(grund, /ctx\.clip\(\)/, 'die Karten-Raute schneidet den Grund ab');
  // Faellt das Bild aus, bleibt die Ansicht heil.
  // Faellt das Bild aus, bleibt die Ansicht heil - und nie durchsichtig:
  // die Farbe kommt immer, das Muster nur wenn es da ist.
  assert.match(grund, /ctx\.fillStyle = '#232a1c';[\s\S]{0,20}ctx\.fill\(\);/);
  assert.match(grund, /if \(!pattern\) return;/);
  const rueckfall = iso.slice(iso.indexOf('function onImageFailed'), iso.indexOf('function hasOwnGround'));
  assert.match(rueckfall, /if \(state\.ground && filename === state\.ground\)/);
  assert.match(rueckfall, /setGround\(null\)/, 'ein kaputtes Bild wird vergessen, nicht jedes Mal neu versucht');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'aiv', 'iso', 'grund.png')));
});

test('the ground can be swapped for one of your own, and swapped back', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const quelle = iso.slice(iso.indexOf('function groundSource'), iso.indexOf('function paintGround'));
  assert.match(quelle, /window\.localStorage\.getItem\(GROUND_KEY\)/, 'die Wahl ueberlebt das Schliessen');
  assert.match(quelle, /return state\.ground \|\| 'grund\.png'/, 'ohne eigene Wahl der mitgelieferte Grund');
  assert.match(quelle, /state\.images\.delete\(groundSource\(\)\)/, 'das alte Bild wird vergessen');
  assert.match(quelle, /catch \{ \/\* a view must not fall over because storage is off \*\/ \}/);
  assert.match(iso, /setGround, hasOwnGround/, 'und beides ist von aussen erreichbar');

  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(editor, /window\.electronAPI\.chooseCastleBackground\(\)/);
  assert.match(editor, /window\.isoView\.setGround\(selection\.dataUrl\)/);
  assert.match(editor, /window\.isoView\.setGround\(null\)/, 'und zurueck zum Standard');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /id="castleIsoGroundBtn"/);
  assert.match(html, /id="castleIsoGroundReset"[^>]*hidden/, 'der Zurueck-Knopf zeigt sich erst, wenn er etwas tut');
});

test('an own ground can be tiled or spread once over the map', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const art = iso.slice(iso.indexOf('function groundFit'), iso.indexOf('function setGround'));
  // Der mitgelieferte Grund ist eine Textur und wird IMMER gekachelt.
  assert.match(art, /return state\.ground \? state\.groundFit : 'tile'/);
  const malen = iso.slice(iso.indexOf('function paintGround'), iso.indexOf('function drawSprite'));
  // Gespannt heisst: die Ecken des Bildes auf die Ecken der Karte.
  assert.match(malen, /if \(groundFit\(\) === 'stretch'\)/);
  assert.match(malen, /geo\.isoPoint\(0, geo\.GRID, state\.view\)\[0\]/, 'linke Kartenecke');
  assert.match(malen, /geo\.isoPoint\(geo\.GRID, 0, state\.view\)\[0\]/, 'rechte');
  assert.match(malen, /ctx\.drawImage\(img, links, oben, rechts - links, unten - oben\)/);
  assert.match(malen, /ctx\.clip\(\)/, 'auch gespannt endet es am Kartenrand');

  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(editor, /window\.isoView\.setGroundFit\(window\.isoView\.groundIsStretched\(\) \? 'tile' : 'stretch'\)/);
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /id="castleIsoGroundFit"[^>]*hidden/, 'der Umschalter zeigt sich erst mit eigenem Grund');
});

test('a ground the user picked is loaded as it is, not as a file name', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const laden = iso.slice(iso.indexOf('function image('), iso.indexOf('function drawDiamond'));
  // Eine data:-Adresse ist schon vollstaendig. Wer ihr den Sprite-Pfad
  // voranstellt, baut eine Adresse ins Nichts - und es erscheint nichts.
  assert.match(laden, /\^\(data:\|blob:\|https\?:\|file:\)/);
  assert.match(laden, /\? filename : SPRITE_PATH \+ filename/);
});

// ------------------------------- eine Karte des Spiels unter der Ansicht
//
// Der Kern ist eine Behauptung, die leicht falsch zu machen ist: die Vorschau
// einer .map ist die um 45 Grad GEDREHTE Karte, und die 2.5D-Ansicht dreht ihr
// eigenes Raster um dieselben 45 Grad. Beides zusammen hebt sich auf - das Bild
// braucht keine Drehung, nur eine Verschiebung und eine Streckung 2:1. Wer es
// als Quadrat einpasst oder ein zweites Mal dreht, liegt zwangslaeufig schief.

test('ein Dorffeld liegt auf dem Kartenfeld, das die Rechnung nennt', () => {
  const keep = { x: 84, y: 223 };
  // Dorffeld (43,43) sitzt auf dem Startplatz - das steht in
  // setKeepOffsetAndOrientation und ist an 128 AIV-Dateien nachgemessen.
  assert.deepEqual(geometry.mapTileForGrid(43, 43, keep), { mx: 84, my: 223 });
  assert.deepEqual(geometry.mapTileForGrid(0, 0, keep), { mx: 41, my: 180 });
  assert.deepEqual(geometry.mapTileForGrid(99, 99, keep), { mx: 140, my: 279 });
  assert.equal(geometry.KEEP_TILE, 43);
});

test('die Vorschau ist die gedrehte Raute, Punkt fuer Punkt', () => {
  // Hin und zurueck ueber alle 40.000 Punkte, mit der Regel aus dem
  // Wissensstand (x = px+py, y = py-px+199) als Gegenrechnung.
  let daneben = 0;
  for (let px = 0; px < 200; px++) {
    for (let py = 0; py < 200; py++) {
      const punkt = geometry.previewPointForMapTile(px + py, py - px + 199);
      if (punkt.px !== px || punkt.py !== py) daneben++;
    }
  }
  assert.equal(daneben, 0, 'jeder Vorschaupunkt gehoert genau einem Kartenfeld');
  assert.equal(geometry.MAP_PREVIEW_EDGE, 200);
});

test('das Kartenbild wird nur verschoben und 2:1 gestreckt, nie gedreht', () => {
  const keep = { x: 84, y: 223 };
  for (const view of [{ zoom: 1, panX: 0, panY: 0 },
                      { zoom: 0.37, panX: 640, panY: -120 },
                      { zoom: 2.5, panX: -333, panY: 777 }]) {
    const rect = geometry.mapPreviewRect(keep, view);
    // Ein Vorschaupunkt ist genau eine Kachel breit und eine Kachel hoch.
    assert.equal(rect.w / geometry.MAP_PREVIEW_EDGE, 2 * geometry.HALF_W * view.zoom);
    assert.equal(rect.h / geometry.MAP_PREVIEW_EDGE, 2 * geometry.HALF_H * view.zoom);
    const punktBreite = rect.w / geometry.MAP_PREVIEW_EDGE;
    const punktHoehe = rect.h / geometry.MAP_PREVIEW_EDGE;
    // Und jede Feldmitte trifft die Mitte ihres Punktes - das ist der Beweis,
    // dass keine Drehung fehlt: waere eine noetig, ginge das nur fuer eine
    // einzige Richtung auf.
    let geprueft = 0;
    for (let gx = 0; gx < 100; gx += 7) {
      for (let gy = 0; gy < 100; gy += 7) {
        const { mx, my } = geometry.mapTileForGrid(gx, gy, keep);
        if (((mx + my) % 2 + 2) % 2 === 0) continue;   // kein eigener Punkt
        const { px, py } = geometry.previewPointForMapTile(mx, my);
        const [sx, sy] = geometry.isoPoint(gx + 0.5, gy + 0.5, view);
        assert.ok(Math.abs(rect.x + (px + 0.5) * punktBreite - sx) < 1e-9,
                  `Punkt ${px},${py} liegt in x nicht unter Feld ${gx},${gy}`);
        assert.ok(Math.abs(rect.y + (py + 0.5) * punktHoehe - sy) < 1e-9,
                  `Punkt ${px},${py} liegt in y nicht unter Feld ${gx},${gy}`);
        geprueft++;
      }
    }
    assert.ok(geprueft > 50, 'es wurden genug Felder geprueft');
  }
  assert.equal(geometry.mapPreviewRect(null, { zoom: 1, panX: 0, panY: 0 }), null);
});

test('ohne Startplatz steht das Dorf in der Kartenmitte', () => {
  const mitte = geometry.centreKeep();
  // Dorffeld (50,50) muss auf dem mittleren Vorschaupunkt (100,100) landen.
  const { mx, my } = geometry.mapTileForGrid(50, 50, mitte);
  assert.deepEqual(geometry.previewPointForMapTile(mx, my), { px: 100, py: 100 });
});

test('die Ansicht legt die Karte mit der Rechnung hin, nicht nach Augenmass', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  const malen = iso.slice(iso.indexOf('function paintGameMap'), iso.indexOf('function paintGround'));
  assert.match(malen, /geo\.mapImageRect\(currentKeep\(\), state\.view, picture\.px0, picture\.py0, picture\.cells, picture\.top\)/);
  assert.match(malen, /ctx\.drawImage\(picture\.img, rect\.x, rect\.y, rect\.w, rect\.h\)/);
  assert.match(malen, /ctx\.clip\(\)/, 'die Karte endet an der Raute des Dorfes');
  assert.match(malen, /ctx\.imageSmoothingEnabled = picture\.smooth/);
  // Die Vorschau bleibt hart: ein Vorschaupunkt ist ein ganzes Feld und darf
  // nicht ins Nachbarfeld verlaufen. Nur das echte Gelaende wird geglaettet.
  const waehlen = iso.slice(iso.indexOf('function groundPicture'), iso.indexOf('function paintGameMap'));
  assert.match(waehlen, /cells: geo\.MAP_PREVIEW_EDGE, top: 0, floor: 0, hoehen: null, smooth: false/);
  assert.match(waehlen, /cells: terrain\.cells,\s*\n\s*top: terrain\.top, floor: terrain\.floor, hoehen: terrain\.village, smooth: true/);
  // Ohne Startplatz die Kartenmitte - und nicht etwa gar nichts.
  const platz = iso.slice(iso.indexOf('function currentKeep'), iso.indexOf('function paintGameMap'));
  assert.match(platz, /map\.keeps\[map\.keepIndex\] \|\| geo\.centreKeep\(\)/);
  // Es gibt nur einen Grund: beide Wege raeumen den jeweils anderen weg.
  const setzen = iso.slice(iso.indexOf('function setGameMap'), iso.indexOf('function setGameMapKeep'));
  assert.match(setzen, /if \(state\.gameMap && state\.ground\) setGround\(null\)/);
  const grund = iso.slice(iso.indexOf('function setGround'), iso.indexOf('function setGroundFit'));
  assert.match(grund, /if \(url && gameMap\(\)\) \{ state\.gameMap = null; rememberGameMap\(\); \}/);
  assert.match(iso, /setGameMap, setGameMapKeep, hasGameMap, gameMapInfo/, 'von aussen erreichbar');
  assert.match(iso, /const MAP_KEY = 'castleIsoGameMap'/, 'die Wahl ueberlebt das Schliessen');
});

test('die Karte wird ueber einen eigenen Kanal geholt, nicht ueber den Dateidialog', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(preload, /listGameMaps: \(\) => ipcRenderer\.invoke\('list-game-maps'\)/);
  assert.match(preload, /loadGameMap: \(filePath\) => ipcRenderer\.invoke\('load-game-map', filePath\)/);
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('list-game-maps'/);
  assert.match(main, /ipcMain\.handle\('load-game-map'/);
  assert.match(main, /require\('\.\/src\/node\/game-map'\)/);

  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(editor, /window\.electronAPI\.listGameMaps\(\)/);
  assert.match(editor, /window\.electronAPI\.loadGameMap\(entry\.path\)/);
  assert.match(editor, /window\.isoView\.setGameMap\(map\)/);
  assert.match(editor, /window\.isoView\.setGameMapKeep\(Number\(karteBergfried\.value\)\)/);

  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /id="castleIsoMapBtn"/);
  // Wie bei den Grund-Knoepfen: erscheinen, wenn sie etwas tun, sonst nicht.
  assert.match(html, /id="castleIsoMapKeep"[^>]*hidden/, 'der Startplatz-Waehler zeigt sich erst mit einer Karte');
  assert.match(html, /id="castleIsoMapReset"[^>]*hidden/, 'der Zurueck-Knopf ebenso');
  assert.match(html, /id="castleIsoMapDialog"/);
});

test('die Werkzeugleiste holt sich den gemerkten Grund nach, wenn die Ansicht da ist', () => {
  // castle-editor.js steht in index.html VOR iso-view.js. Beim Verdrahten gibt
  // es window.isoView also noch nicht, und beide Abfragen liefern "nichts
  // gewaehlt" - auch wenn aus der letzten Sitzung eine Karte gemerkt ist. Dann
  // laege die Karte da, aber der Knopf, sie wegzunehmen, waere unsichtbar.
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/castle-editor.js') < html.indexOf('js/iso-view.js'),
            'die Reihenfolge ist der Grund fuer das Nachholen - aendert sie sich, gehoert der Test geprueft');
  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const nachholen = editor.slice(editor.indexOf("window.addEventListener('DOMContentLoaded'"));
  assert.match(nachholen.slice(0, 200), /updateGroundControls\(\);\s*updateMapControls\(\);/);
});

// --------------------------------------------------------------- die Drehung

// Nachbau von rotateAIV (0x004ed0b0) aus seinen drei Kopierschleifen - NICHT
// aus der Formel, die geprueft werden soll. Innen laeuft die Quelle flach
// durch (Zeile k, Spalte j), aussen wandert der Zielzeiger.
function rotateAIVNachbau(quelle, orientation) {
  if (!orientation) return quelle.slice();
  const ziel = new Array(10000).fill(0);
  for (let k = 0; k < 100; k += 1) {
    for (let j = 0; j < 100; j += 1) {
      let zeile, spalte;
      if (orientation === 6) { zeile = j; spalte = 99 - k; }
      else if (orientation === 4) { zeile = 99 - k; spalte = 99 - j; }
      else if (orientation === 2) { zeile = 99 - j; spalte = k; }
      else return quelle.slice();
      ziel[zeile * 100 + spalte] = quelle[k * 100 + j];
    }
  }
  return ziel;
}

test('die Drehung kommt aus der Lage zur Kartenmitte - mit dem Tausch 2/6', () => {
  // Weit im Osten, weit im Westen, weit im Sueden, weit im Norden.
  assert.equal(geometry.keepOrientation(350, 200), 2);
  assert.equal(geometry.keepOrientation(50, 200), 6);
  assert.equal(geometry.keepOrientation(200, 350), 0);
  assert.equal(geometry.keepOrientation(200, 50), 4);
  // Genau auf der Diagonalen - dort greifen die vier Sonderfaelle.
  assert.equal(geometry.keepOrientation(150, 250), 0);
  assert.equal(geometry.keepOrientation(250, 250), 2);
  assert.equal(geometry.keepOrientation(250, 150), 4);
  assert.equal(geometry.keepOrientation(150, 150), 6);
  // Der Tausch ist der leicht zu ueberlesende Teil: ohne ihn kaeme im Osten
  // 6 und im Westen 2 heraus, und die halbe Karte staende quer.
  assert.notEqual(geometry.keepOrientation(350, 200), 6);
  // Ein Platz genau in der Mitte hat keine Vorzugsrichtung.
  assert.equal(geometry.keepOrientation(200, 200), 0);
});

test('gedreht und zurueck ist wieder dasselbe Feld', () => {
  for (const orientation of [0, 2, 4, 6]) {
    for (let gx = 0; gx < 100; gx += 1) {
      for (let gy = 0; gy < 100; gy += 1) {
        const hin = geometry.rotateGrid(gx, gy, 1, orientation);
        assert.ok(hin.gx >= 0 && hin.gx < 100 && hin.gy >= 0 && hin.gy < 100);
        assert.deepEqual(geometry.unrotateGrid(hin.gx, hin.gy, orientation), { gx, gy });
      }
    }
  }
});

test('ein grosses Gebaeude wird an seiner Ecke gedreht, nicht an seinem Feld', () => {
  // Der Bergfried belegt (43,43) bis (49,49). Nach einer halben Drehung liegt
  // er auf (50,50) bis (56,56) - der Ansatz ist 50, nicht 56. Wer die
  // Kachelzahl vergisst, verschiebt ihn um seine eigenen sieben Felder.
  assert.deepEqual(geometry.rotateGrid(43, 43, 7, 4), { gx: 50, gy: 50 });
  assert.deepEqual(geometry.rotateGrid(43, 43, 7, 2), { gx: 43, gy: 50 });
  assert.deepEqual(geometry.rotateGrid(43, 43, 7, 6), { gx: 50, gy: 43 });
  assert.deepEqual(geometry.rotateGrid(43, 43, 7, 0), { gx: 43, gy: 43 });
});

test('die Ansicht dreht die Burg und rechnet die Maus zurueck', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  // Erst einsammeln, dann drehen - sonst landen die Bodenplatten neben ihrem
  // Gebaeude, weil sie aus dessen Ecke gerechnet werden.
  assert.match(iso, /const gerade = geo\.collectItems\(currentDocument\(\), state\.catalogue\);/);
  assert.match(iso, /const items = turnedTiles\(gerade\);/);
  // Die Platten haengen an der GEDREHTEN Ecke, ihr eigener Versatz wird nicht
  // mitgedreht. Gemessen an 201 Startplaetzen aus 60 Karten: 194 davon tragen
  // den Lagerplatz genau 7 rechts und 2 unter der Bergfriedecke, und zwar bei
  // jeder Drehung - der Startaufbau der Karte dreht sich nicht mit.
  assert.match(iso, /const plates = geo\.collectPlates\(items\)/);
  // Ein Klick trifft das Feld, das man sieht - also zurueckgedreht.
  assert.match(iso, /geo\.unrotateGrid\(grid\.gx, grid\.gy, currentRotation\(\)\)/);
  assert.match(iso, /const tile = editorTileAt\(p\.x, p\.y\)/);
  // Und der Auswahlkasten dreht mit.
  assert.match(iso, /geo\.marqueeOutline\(box, state\.view, currentRotation\(\)\)/);
  // Die Drehung steht in der Statuszeile, sonst sieht man nur, DASS etwas
  // anders liegt.
  assert.match(iso, /turned '/);
  assert.match(iso, /game value/);
});

// ------------------------------------------------------- das echte Gelaende

test('das Dorf-Fenster deckt jedes Feld des Bauplans ab und ist nicht groesser als noetig', () => {
  // Fuer jeden Startplatz: die 100x100 Felder des Dorfes muessen im Fenster
  // liegen, und das Fenster darf hoechstens 101 Punkte Kante haben - sonst
  // waechst das Bild ohne Grund. 101 statt 100 kommt vor, wenn die Ecken auf
  // halbe Vorschaupunkte fallen.
  const plaetze = [{ x: 84, y: 223 }, { x: 225, y: 77 }, { x: 200, y: 200 },
                   { x: 43, y: 43 }, { x: 356, y: 356 }, geometry.centreKeep()];
  for (const keep of plaetze) {
    const fenster = geometry.villageWindow(keep);
    assert.ok(fenster.cells === 100 || fenster.cells === 101,
              `Kante ${fenster.cells} bei (${keep.x},${keep.y})`);
    for (const [gx, gy] of [[0, 0], [99, 0], [0, 99], [99, 99], [50, 50], [17, 83]]) {
      const feld = geometry.mapTileForGrid(gx, gy, keep);
      const punkt = geometry.previewPointForMapTile(feld.mx, feld.my);
      assert.ok(punkt.px >= fenster.px0 && punkt.px <= fenster.px0 + fenster.cells,
                `px ${punkt.px} liegt nicht im Fenster ${fenster.px0}..${fenster.px0 + fenster.cells}`);
      assert.ok(punkt.py >= fenster.py0 && punkt.py <= fenster.py0 + fenster.cells,
                `py ${punkt.py} liegt nicht im Fenster ${fenster.py0}..${fenster.py0 + fenster.cells}`);
    }
  }
});

test('Gelaende und Vorschau werden von derselben Rechnung hingelegt', () => {
  // Die ganze Vorschau ist nur der Sonderfall "Ausschnitt von 0,0 ueber 200
  // Punkte". Waeren es zwei Rechnungen, laege eine davon irgendwann schief.
  const view = { zoom: 0.37, panX: 411, panY: -88 };
  const keep = { x: 84, y: 223 };
  assert.deepEqual(geometry.mapImageRect(keep, view, 0, 0, geometry.MAP_PREVIEW_EDGE),
                   geometry.mapPreviewRect(keep, view));

  // Und der Ausschnitt landet auf demselben Fleck wie das Stueck der Vorschau,
  // das dieselben Punkte zeigt: Punkt px0 der Vorschau liegt genau auf der
  // linken Kante des Gelaendebildes.
  for (const zoom of [0.2, 1, 3.5]) {
    const sicht = { zoom, panX: 120, panY: 40 };
    const fenster = geometry.villageWindow(keep);
    const ganz = geometry.mapPreviewRect(keep, sicht);
    const teil = geometry.mapImageRect(keep, sicht, fenster.px0, fenster.py0, fenster.cells);
    const punktBreite = ganz.w / geometry.MAP_PREVIEW_EDGE;
    const punktHoehe = ganz.h / geometry.MAP_PREVIEW_EDGE;
    assert.ok(Math.abs(teil.x - (ganz.x + fenster.px0 * punktBreite)) < 1e-9, 'linke Kante');
    assert.ok(Math.abs(teil.y - (ganz.y + fenster.py0 * punktHoehe)) < 1e-9, 'obere Kante');
    assert.ok(Math.abs(teil.w - fenster.cells * punktBreite) < 1e-9, 'Breite');
    assert.ok(Math.abs(teil.h - fenster.cells * punktHoehe) < 1e-9, 'Hoehe');
  }
});

test('der Umschalter zwischen Vorschau und Gelaende haengt richtig', () => {
  // Der Knopf steht bei den anderen Kartenknoepfen und zeigt sich nur mit
  // Karte. Und das Gelaende wird NICHT gemerkt - 3 MB passen nicht in den
  // Sitzungsspeicher, in dem auch die Karte selbst liegt.
  assert.match(html, /id="castleIsoMapMode"[^>]*hidden/);
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  assert.match(iso, /mapMode, setMapMode, setTerrain, terrainKey, terrainReady/, 'von aussen erreichbar');
  const merken = iso.slice(iso.indexOf('function rememberGameMap'), iso.indexOf('function setGameMap'));
  assert.doesNotMatch(merken, /terrain/i, 'das Gelaende gehoert nicht in den Sitzungsspeicher');
  // Karte oder Startplatz gewechselt heisst: das alte Gelaende passt nicht mehr.
  const schluessel = iso.slice(iso.indexOf('function terrainKey'), iso.indexOf('function setTerrain'));
  assert.match(schluessel, /map\.path/);
  assert.match(schluessel, /keep\.x/);

  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(preload, /loadMapTerrain: \(request\) => ipcRenderer\.invoke\('load-map-terrain', request\)/);
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('load-map-terrain'/);
  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(editor, /window\.electronAPI\.loadMapTerrain\(\{ path: info\.path, keep: info\.keep \}\)/);
  assert.match(editor, /window\.isoView\.setMapMode\(/);
  // Kommt die Antwort zu spaet, gehoert sie nicht mehr hierher.
  assert.match(editor, /if \(window\.isoView\.terrainKey\(\) !== key\) return;/);
});

// ----------------------------------------------------------------- die Hoehe

test('eine Kachel steigt um genau die Zahl, die im HeightLayer steht', () => {
  const view = { zoom: 1, panX: 0, panY: 0 };
  // renderMap hebt jede Kachel um heightBasedScreenYOffset[HeightLayer[Feld]],
  // und die Tabelle ist in der normalen Ansicht die Eins-zu-eins-Abbildung
  // (updateShowHiLayerOrResetChangedLayer 0x00501a20, Betriebsart 2, gesetzt
  // in Constructor_TileMapState 0x00515f40). Senkrecht ist ein Punkt des
  // Spiels ein Punkt der Ansicht - eine Kachel ist hier wie dort 16 hoch.
  const flach = geometry.isoPoint(10, 10, view);
  const hoch = geometry.isoPoint(10, 10, view, 130);
  assert.equal(hoch[0], flach[0], 'zur Seite verrutscht dabei nichts');
  assert.equal(hoch[1], flach[1] - 130);
  // und mit Zoom mitskaliert
  const gezoomt = geometry.isoPoint(10, 10, { zoom: 2, panX: 0, panY: 0 }, 8);
  assert.equal(gezoomt[1], geometry.isoPoint(10, 10, { zoom: 2, panX: 0, panY: 0 })[1] - 16);
  // Ein Bauwerk haengt an seiner vorderen Ecke und steigt mit ihr.
  const sprite = { breite: 30, hoehe: 16 };
  const unten = geometry.spriteRect(sprite, 0, 0, 1, view);
  const oben = geometry.spriteRect(sprite, 0, 0, 1, view, 24);
  assert.equal(oben.y, unten.y - 24);
  assert.equal(oben.x, unten.x);
});

test('die Maus findet das Feld auch, wenn der Boden dort hoeher liegt', () => {
  const view = { zoom: 1, panX: 500, panY: 100 };
  // Ein Gelaende mit einer Stufe: alles auf 8, die halbe Karte auf 72.
  const hoehe = (gx, gy) => (gx >= 50 ? 72 : 8);
  for (const [gx, gy] of [[10, 10], [50, 30], [80, 80], [55, 5], [99, 99]]) {
    const hebung = hoehe(gx, gy);
    // Mitte des Feldes auf dem Bildschirm, mit Hebung
    const [px, py] = geometry.isoPoint(gx + 0.5, gy + 0.5, view, hebung);
    const getroffen = geometry.tileFromPoint(px, py, view, hoehe);
    assert.deepEqual(getroffen, { gx, gy }, `Feld (${gx},${gy}) auf Hoehe ${hebung}`);
  }
  // An der Kante liegen zwei Felder an derselben Stelle: (46,26) unten auf 8
  // und (50,30) oben auf 72 - genau 64 Punkte, also vier Felder. Was ein
  // Mensch dort sieht, ist das VORDERE; das tiefe steckt dahinter.
  const kante = geometry.isoPoint(50.5, 30.5, view, 72);
  assert.deepEqual(geometry.isoPoint(46.5, 26.5, view, 8), kante, 'wirklich derselbe Punkt');
  assert.deepEqual(geometry.tileFromPoint(kante[0], kante[1], view, hoehe), { gx: 50, gy: 30 });
  // Gegenprobe: ohne die Hoehenauskunft trifft dieselbe Rechnung daneben,
  // sonst misst der Test nichts.
  const [px, py] = geometry.isoPoint(80.5, 80.5, view, 72);
  const blind = geometry.tileFromPoint(px, py, view);
  assert.notDeepEqual(blind, { gx: 80, gy: 80 });
});

test('das Gelaendebild macht oben Platz fuer den Berg und die Ansicht setzt es dort an', () => {
  const view = { zoom: 1, panX: 0, panY: 0 };
  const keep = { x: 200, y: 199 };
  const ohne = geometry.mapImageRect(keep, view, 3, 4, 101, 0);
  const mit = geometry.mapImageRect(keep, view, 3, 4, 101, 140);
  assert.equal(mit.x, ohne.x, 'zur Seite aendert sich nichts');
  assert.equal(mit.w, ohne.w);
  assert.equal(mit.y, ohne.y - 140, 'das Bild faengt 140 Punkte hoeher an');
  assert.equal(mit.h, ohne.h + 140, 'und ist genau um diese 140 hoeher');
  assert.equal(mit.y + mit.h, ohne.y + ohne.h, 'unten liegt es gleich - dort haengt der Boden');
});

test('die Hoehe kommt aus derselben Quelle wie der Boden', () => {
  const iso = fs.readFileSync(path.join(root, 'src', 'js', 'iso-view.js'), 'utf8');
  // Ohne echtes Gelaende bleibt alles flach: die Vorschau ist ein flaches Bild.
  const waehlen = iso.slice(iso.indexOf('function groundPicture'), iso.indexOf('function paintGameMap'));
  assert.match(waehlen, /hoehen: null, smooth: false/, 'die Vorschau bringt keine Hoehen mit');
  const grund = iso.slice(iso.indexOf('function paintGround'), iso.indexOf('function bauHoehe'));
  assert.match(grund, /state\.hoehenFeld = picture \? picture\.hoehen : null/);
  assert.match(grund, /state\.hoehenFeld = null/, 'ohne Karte gibt es keine Hoehen');
  // Ein Bauwerk haengt an seiner vorderen Ecke - dieselbe Ecke, auf der auch
  // sein Bild sitzt (spriteRect).
  const bau = iso.slice(iso.indexOf('function bauHoehe'), iso.indexOf('function drawDiamond'));
  assert.match(bau, /bodenHoehe\(gx \+ \(tiles \|\| 1\) - 1, gy \+ \(tiles \|\| 1\) - 1\)/);
  assert.match(bau, /geo\.spriteRect\(variant, gx, gy, tiles, state\.view, bauHoehe\(gx, gy, tiles\)\)/);
  // Und die Maus rechnet die Hoehe zurueck, sonst klickt man daneben.
  assert.match(iso, /geo\.tileFromPoint\(px, py, state\.view, bodenHoehe\)/);
});
