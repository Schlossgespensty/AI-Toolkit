'use strict';

// Startplaetze auf Karten, die keinen vorgebauten Bergfried tragen.
//
// Die meisten Karten haben an jedem Startplatz einen echten Bergfried stehen:
// einen 7x7-Block mit BT_STONEKEEP (41) in der Bautypenschicht 1049. Findet
// game-map.js dort nichts, sagt das Fenster "no starting place, village in the
// middle of the map" - und die Burg landet in der Kartenmitte statt am
// richtigen Fleck. Genau das war bei "A Mighty Oasis" zu sehen.
//
// GEMESSEN am 07.09.2026 ueber alle 189 Karten des Spiels:
//   - 172 Karten haben 41er-Bergfriede, 17 nicht.
//   - Alle 17 stammen aus Stronghold Crusader Extreme.
//   - Crete Peninsula: 392x Wert 41 (8 Bergfriede a 7x7),  0x Wert 52.
//   - A Mighty Oasis:    0x Wert 41,                       24x Wert 52,
//     verteilt auf 6 Gruppen zu je 4 Feldern (2x2) ueber die ganze Karte.
//   - Die beiden Werte schliessen sich karten-uebergreifend aus: wo 41 steht,
//     steht nie 52 und umgekehrt.
//   - 15 der 17 Karten tragen solche 52er-Gruppen, immer genau 4 Felder.
//     crusader_tutorial und crusaders_mission1a haben gar keine - das sind
//     reine Kampagnenkarten ohne Gefechts-Startplaetze.
//
// NICHT belegt ist, dass der Wert 52 im Spielcode "Startplatz" heisst. Das
// Muster ist eindeutig, der Beweis aus der exe steht aus. Deshalb bekommen
// diese Plaetze auch keine Spielernummer angedichtet (player bleibt null) -
// die Nummer steht bei den 41ern im Gebaeudeeintrag bei +214, und den gibt es
// hier nicht. Wer sie durchzaehlt, vergleicht die falsche Burg.

const fs = require('fs');

const MARKER = 52;              // Wert des Startplatz-Markers in Schicht 1049
const MARKER_FELDER = 4;        // ein Marker ist 2x2 - alles andere ist etwas anderes

// Wo genau der Bergfried auf so einem Marker landet, ist NICHT gemessen. Ein
// 41er-Block ist 7x7 und wird an seiner oberen linken Ecke gemeldet, ein
// Marker ist 2x2. Bis das jemand nachmisst, bleibt der Versatz 0: eine
// geratene Zahl waere schlimmer als eine sichtbare Abweichung, denn sie sieht
// richtig aus.
const MARKER_VERSATZ = 0;

// Alle zusammenhaengenden Marker-Gruppen einer Bautypenschicht.
// geo liefert die Rautengeometrie (rowRange, tileIndex) aus game-map.js -
// hierher kopiert wuerde sie zum zweiten Ort, an dem dasselbe steht.
function findStartMarkers(section, geo) {
  if (!section || !geo) return [];
  const { rowRange, tileIndex } = geo;
  const gesehen = new Set();
  const gruppen = [];

  const istMarker = (x, y) => {
    if (y < 0 || y > 399) return false;
    const [low, high] = rowRange(y);
    if (x < low || x > high) return false;
    return section[tileIndex(x, y)] === MARKER;
  };

  for (let y = 0; y <= 399; y += 1) {
    const [low, high] = rowRange(y);
    for (let x = low; x <= high; x += 1) {
      const schluessel = x + ',' + y;
      if (gesehen.has(schluessel) || !istMarker(x, y)) continue;
      // Zusammenhaengende Flaeche einsammeln, ueber die vier Seiten.
      const felder = [];
      const offen = [[x, y]];
      gesehen.add(schluessel);
      while (offen.length) {
        const [ax, ay] = offen.pop();
        felder.push([ax, ay]);
        for (const [bx, by] of [[ax + 1, ay], [ax - 1, ay], [ax, ay + 1], [ax, ay - 1]]) {
          const k = bx + ',' + by;
          if (gesehen.has(k) || !istMarker(bx, by)) continue;
          gesehen.add(k);
          offen.push([bx, by]);
        }
      }
      // Nur die 2x2-Gruppe ist ein Startplatz. Groessere Flaechen desselben
      // Wertes waeren etwas anderes - dann lieber nichts melden als Falsches.
      if (felder.length !== MARKER_FELDER) continue;
      const links = Math.min(...felder.map(f => f[0]));
      const oben = Math.min(...felder.map(f => f[1]));
      gruppen.push({ x: links + MARKER_VERSATZ, y: oben + MARKER_VERSATZ, felder: felder.length });
    }
  }
  gruppen.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return gruppen;
}

// Eine gelesene Karte um ihre Startplaetze ergaenzen - aber nur, wenn sie
// keine hat. Karten mit echten Bergfrieden bleiben unberuehrt.
function withStartPlaces(map, internals) {
  if (!map || (Array.isArray(map.keeps) && map.keeps.length)) return map;
  if (!internals || !map.path) return map;
  const { readPreview, findDirectory, readSection, keepOrientation, rowRange, tileIndex, BUILDING_SECTION } = internals;
  try {
    const buffer = fs.readFileSync(map.path);
    const preview = readPreview(buffer);
    const directory = findDirectory(buffer, preview.end);
    if (!directory) return map;
    const section = readSection(buffer, directory, BUILDING_SECTION);
    const marker = findStartMarkers(section, { rowRange, tileIndex });
    if (!marker.length) return map;
    map.keeps = marker.map(m => ({
      x: m.x,
      y: m.y,
      player: null,                            // keine Nummer in den Daten, also keine erfinden
      orientation: keepOrientation(m.x, m.y),
      fromMarker: true                         // damit das Fenster es sagen kann
    }));
  } catch {
    return map;                                // eine kaputte Karte darf das Laden nicht kippen
  }
  return map;
}

module.exports = { withStartPlaces, findStartMarkers, MARKER, MARKER_FELDER, MARKER_VERSATZ };
