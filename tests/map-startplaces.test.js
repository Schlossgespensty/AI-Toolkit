'use strict';

// Was diese Tests widerlegen sollen, vor dem Messen aufgeschrieben:
//  1. "Ein 2x2-Marker wird als Startplatz erkannt"  -> faellt, wenn nichts kommt.
//  2. "Nur 2x2 zaehlt"                              -> faellt, wenn 3x3 auch gemeldet wird.
//  3. "Karten mit echtem Bergfried bleiben unberuehrt" -> faellt, wenn keeps sich aendert.
//  4. "Die 17 Karten ohne Bergfried bekommen Plaetze"  -> faellt, wenn eine leer bleibt.
//  5. "Keine Karte VERLIERT Plaetze"                -> faellt, wenn irgendwo weniger steht.

const test = require('node:test');
const assert = require('node:assert');
const { withStartPlaces, findStartMarkers, MARKER } = require('../src/node/map-startplaces');
const { listGameMaps, readGameMap, internals } = require('../src/node/game-map');

const geo = { rowRange: internals.rowRange, tileIndex: internals.tileIndex };

function leereSchicht() { return new Uint8Array(internals.MAP_TILES); }
function setze(schicht, x, y, wert = MARKER) { schicht[internals.tileIndex(x, y)] = wert; }
function block(schicht, x, y, kante) {
  for (let dy = 0; dy < kante; dy += 1) for (let dx = 0; dx < kante; dx += 1) setze(schicht, x + dx, y + dy);
}

test('ein 2x2-Marker ist ein Startplatz, gemeldet an der oberen linken Ecke', () => {
  const s = leereSchicht();
  block(s, 200, 200, 2);
  const gefunden = findStartMarkers(s, geo);
  assert.equal(gefunden.length, 1);
  assert.deepEqual({ x: gefunden[0].x, y: gefunden[0].y }, { x: 200, y: 200 });
});

test('eine 3x3-Flaeche desselben Wertes ist KEIN Startplatz', () => {
  const s = leereSchicht();
  block(s, 200, 200, 3);
  assert.equal(findStartMarkers(s, geo).length, 0);
});

test('ein einzelnes Feld ist kein Startplatz', () => {
  const s = leereSchicht();
  setze(s, 200, 200);
  assert.equal(findStartMarkers(s, geo).length, 0);
});

test('zwei getrennte Marker sind zwei Startplaetze', () => {
  const s = leereSchicht();
  block(s, 150, 150, 2);
  block(s, 250, 250, 2);
  assert.equal(findStartMarkers(s, geo).length, 2);
});

test('eine Karte, die schon Startplaetze hat, wird nicht angefasst', () => {
  const karte = { path: 'gibt-es-nicht.map', keeps: [{ x: 1, y: 2, player: 3 }] };
  assert.deepEqual(withStartPlaces(karte, internals).keeps, [{ x: 1, y: 2, player: 3 }]);
});

test('eine kaputte Karte kippt das Laden nicht', () => {
  const karte = { path: 'gibt-es-nicht.map', keeps: [] };
  assert.deepEqual(withStartPlaces(karte, internals).keeps, []);
});

// Ab hier braucht es das installierte Spiel. Fehlt es, wird uebersprungen -
// aber NICHT stillschweigend: der Grund steht in der Ausgabe.
const { maps } = (() => { try { return listGameMaps(); } catch { return { maps: [] }; } })();

test('echte Karten: keine verliert Startplaetze, die 17 ohne Bergfried bekommen welche', { skip: maps.length ? false : 'Spiel nicht gefunden' }, () => {
  let ergaenzt = 0, leerGeblieben = [];
  for (const m of maps) {
    let vorher;
    try { vorher = readGameMap(m.path); } catch { continue; }
    const anzahlVorher = vorher.keeps.length;
    const nachher = withStartPlaces(readGameMap(m.path), internals);
    assert.ok(nachher.keeps.length >= anzahlVorher, `${m.name} hat Plaetze verloren`);
    if (anzahlVorher === 0) {
      if (nachher.keeps.length) ergaenzt += 1; else leerGeblieben.push(m.name);
    } else {
      assert.equal(nachher.keeps.length, anzahlVorher, `${m.name} wurde angefasst, obwohl sie Bergfriede hat`);
    }
  }
  assert.equal(ergaenzt, 15, 'genau 15 Karten sollten Marker-Startplaetze bekommen');
  assert.deepEqual(leerGeblieben.sort(), ['crusader_tutorial', 'crusaders_mission1a']);
});

test('A Mighty Oasis hat 6 Startplaetze, ohne Spielernummer', { skip: maps.length ? false : 'Spiel nicht gefunden' }, () => {
  const m = maps.find(x => x.name === 'A Mighty Oasis');
  const karte = withStartPlaces(readGameMap(m.path), internals);
  assert.equal(karte.keeps.length, 6);
  assert.ok(karte.keeps.every(k => k.player === null), 'keine erfundene Spielernummer');
  assert.ok(karte.keeps.every(k => k.fromMarker === true));
});
