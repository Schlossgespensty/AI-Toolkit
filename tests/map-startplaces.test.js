'use strict';

// Self-contained tests for detecting start-place markers. Installed game maps
// are intentionally not fixtures for the project test suite.

const test = require('node:test');
const assert = require('node:assert');
const { withStartPlaces, findStartMarkers, MARKER } = require('../src/node/map-startplaces');
const { internals } = require('../src/node/game-map');

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
