// Eine .map des Spiels lesen: das Vorschaubild, die Startplaetze, wem sie
// gehoeren und wie die Burg darauf gedreht wird.
//
// Warum im Hauptprozess und nicht im Fenster: die Oberflaeche hat keinen
// Zugriff auf Dateien (contextIsolation), das Entpacken braucht node-pkware,
// und der Web-Build (web/) darf davon nichts mitschleppen. Der Kanal ist
// derselbe wie bei choose-castle-background - heraus kommt eine fertige
// data:-Adresse, die die Ansicht wie jedes andere Bild laedt.
//
// AUFBAU EINER .map, an 113 Karten des Spiels nachgemessen:
//
//   u32 0xFFFFFFFF
//   u32 Laenge des Vorschau-Blocks
//   Vorschau: u32 entpackt, u32 gepackt, u32 Pruefsumme, dann PKWare-Implode.
//     Entpackt sind das 512 Byte Farbtafel (256 Eintraege zu 16 Bit, 5-5-5)
//     und 200*200 Punkte, je ein Byte als Nummer in die Tafel.
//   Danach Beschreibung und ein paar kleine Felder, dann das Verzeichnis.
//
// Das Verzeichnis ist gebaut wie das der .aiv, nur mit 150 statt 100 Plaetzen:
// 32 Byte Kopf (Verzeichnisgroesse, Datengroesse, Anzahl, Fassung), dann fuenf
// Felder zu je 150 u32 - entpackte Laenge, Laenge, Kennung, Gepackt-Merker,
// Versatz. WO es beginnt, steht nirgends: der Abstand zum Vorschauende ist
// NICHT fest (gemessen: 270 bei 105 Karten, dazu 266, 272, 280 und 869). Es
// wird darum gesucht, aber nicht geraten - drei Bedingungen zugleich muessen
// stimmen, und die trafen bei allen 113 Karten genau eine Stelle.
//
// DIE KARTE IST EINE RAUTE, kein Rechteck: 80.400 Felder in einem 400x400
// grossen Rahmen. Zeile y traegt 2*(y+1) Felder fuer y <= 199 und 800-2*y
// darunter. Deshalb reicht kein y*400+x, sondern es braucht die Zeilentabelle
// addX (siehe unten). Belegt in VillageStudio/doku/Wissensstand.md, 1b5.

const fs = require('node:fs');
const path = require('node:path');
const { explode } = require('node-pkware/simple');
const { encodeRgbaPng } = require('./pixel-image');
// Die Drehregel steht in iso-geometry.js, weil die Ansicht sie auch braucht.
// Zwei Kopien derselben Regel waeren zwei Regeln, und eine davon veraltet.
const { keepOrientation } = require('../js/iso-geometry.js');

const PREVIEW_EDGE = 200;          // Kantenlaenge des Vorschaubildes
const MAP_TILES = 80400;           // Felder der Raute
const DIRECTORY_SIZE = 3036;       // Verzeichnis einer .map
const DIRECTORY_SLOTS = 150;
const BUILDING_SECTION = 1049;     // Bautypen, ein Byte je Feld
const STONE_KEEP = 41;             // BT_STONEKEEP
const KEEP_EDGE = 7;               // ein Bergfried ist 7x7
const MAX_MAP_BYTES = 32 * 1024 * 1024;

// Abschnitt 1013 ist das Gebaeudefeld des Spiels, unveraendert auf die Platte
// geschrieben: 812 Byte je Eintrag, die Feldversaetze stehen so in der
// Building-Struktur des Programms (Ghidra, OpenSHC-ref). Nachgemessen an 486
// Bergfrieden auf 96 Karten - jeder trug an +238/+240 genau die linke obere
// Ecke seines 7x7-Blocks, Bautyp 41, Besitzer 1 bis 8, keine Nummer doppelt.
const BUILDINGS_SECTION = 1013;
const BUILDING_STRIDE = 812;
const BUILDING_TYPE_AT = 210;
const BUILDING_OWNER_AT = 214;
const BUILDING_X_AT = 238;

// Der uebliche Ort, wenn niemand eine Installation gewaehlt hat.
const DEFAULT_GAME_ROOT = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stronghold Crusader Extreme';

// ---------------------------------------------------------------- die Raute

// Nummer des ersten Feldes der Zeile y, minus dem kleinsten x dieser Zeile -
// so wird die Feldnummer schlicht addX(y) + x.
function rowBase(y) {
  if (y <= 199) return y * y + 2 * y - 199;
  const k = y - 200;
  return 40200 + 400 * k - k * k;
}

// Welche x eine Zeile ueberhaupt hat. Ausserhalb liegt kein Feld.
function rowRange(y) {
  return y <= 199 ? [199 - y, 200 + y] : [y - 200, 599 - y];
}

function tileIndex(x, y) {
  return rowBase(y) + x;
}

// ------------------------------------------------------------- Dateilesen

function readUint32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

// Das Verzeichnis suchen statt seinen Ort zu raten. Drei Bedingungen zugleich:
// die Verzeichnisgroesse stimmt, die angegebene Datengroesse reicht genau bis
// zum Dateiende, und die Abschnittszahl passt in die 150 Plaetze. Eine Stelle,
// die alle drei zufaellig erfuellt, gibt es in keiner der 113 Karten.
function findDirectory(buffer, searchFrom) {
  for (let offset = searchFrom; offset + 16 <= buffer.length; offset += 1) {
    if (readUint32(buffer, offset) !== DIRECTORY_SIZE) continue;
    const payloadSize = readUint32(buffer, offset + 4);
    const count = readUint32(buffer, offset + 8);
    if (offset + DIRECTORY_SIZE + payloadSize !== buffer.length) continue;
    if (count < 1 || count > DIRECTORY_SLOTS) continue;
    return { offset, count };
  }
  return null;
}

function unpackBlock(block, expectedLength) {
  const uncompressed = readUint32(block, 0);
  const compressed = readUint32(block, 4);
  if (12 + compressed > block.length) throw new Error('A packed section of the map is truncated.');
  const data = Buffer.from(explode(Buffer.from(block.subarray(12, 12 + compressed))));
  const wanted = uncompressed || expectedLength;
  if (wanted && data.length !== wanted) {
    throw new Error(`A section of the map unpacked to ${data.length} bytes instead of ${wanted}.`);
  }
  return data;
}

// Ein Abschnitt nach seiner Kennung. Fehlt er, kommt null zurueck - eine
// fehlende Bauschicht darf die Karte nicht unbrauchbar machen.
function readSection(buffer, directory, wantedId) {
  const idField = directory.offset + 32 + 2 * DIRECTORY_SLOTS * 4;
  const lengthField = directory.offset + 32 + DIRECTORY_SLOTS * 4;
  const packedField = directory.offset + 32 + 3 * DIRECTORY_SLOTS * 4;
  const offsetField = directory.offset + 32 + 4 * DIRECTORY_SLOTS * 4;
  const dataStart = directory.offset + DIRECTORY_SIZE;
  for (let index = 0; index < directory.count; index += 1) {
    if (readUint32(buffer, idField + index * 4) !== wantedId) continue;
    const length = readUint32(buffer, lengthField + index * 4);
    const packed = readUint32(buffer, packedField + index * 4);
    const offset = readUint32(buffer, offsetField + index * 4);
    const block = buffer.subarray(dataStart + offset, dataStart + offset + length);
    return packed ? unpackBlock(block, MAP_TILES) : Buffer.from(block);
  }
  return null;
}

// Die Vorschau steht ganz vorn und ist immer gepackt.
function readPreview(buffer) {
  if (buffer.length < 20 || readUint32(buffer, 0) !== 0xFFFFFFFF) {
    throw new Error('This is not a Stronghold map.');
  }
  const blockLength = readUint32(buffer, 4);
  const block = buffer.subarray(8, 8 + blockLength);
  const raw = unpackBlock(block, 512 + PREVIEW_EDGE * PREVIEW_EDGE);

  const palette = [];
  for (let entry = 0; entry < 256; entry += 1) {
    const word = raw.readUInt16LE(entry * 2);
    palette.push([
      Math.round(((word >> 10) & 31) * 255 / 31),
      Math.round(((word >> 5) & 31) * 255 / 31),
      Math.round((word & 31) * 255 / 31)
    ]);
  }
  return { palette, points: raw.subarray(512), end: 8 + blockLength };
}

function previewPng(preview) {
  const rgba = Buffer.alloc(PREVIEW_EDGE * PREVIEW_EDGE * 4);
  for (let index = 0; index < PREVIEW_EDGE * PREVIEW_EDGE; index += 1) {
    const [r, g, b] = preview.palette[preview.points[index]];
    rgba[index * 4] = r;
    rgba[index * 4 + 1] = g;
    rgba[index * 4 + 2] = b;
    rgba[index * 4 + 3] = 255;
  }
  return encodeRgbaPng(PREVIEW_EDGE, PREVIEW_EDGE, rgba);
}

// ---------------------------------------------------------- die Startplaetze

// Ein Startplatz ist ein steinerner Bergfried: 7x7 Felder mit Bautyp 41 in der
// Bauschicht. Gesucht wird die linke obere Ecke - genau die Ecke, auf der das
// Dorffeld (43,43) sitzt (setKeepOffsetAndOrientation, 0x004ecf70).
function findKeeps(buildings) {
  if (!buildings || buildings.length < MAP_TILES) return [];
  const isKeep = (x, y) => {
    const [low, high] = rowRange(y);
    if (y < 0 || y > 399 || x < low || x > high) return false;
    return buildings[tileIndex(x, y)] === STONE_KEEP;
  };
  const keeps = [];
  for (let y = 0; y <= 399; y += 1) {
    const [low, high] = rowRange(y);
    for (let x = low; x <= high; x += 1) {
      if (!isKeep(x, y) || isKeep(x - 1, y) || isKeep(x, y - 1)) continue;
      let complete = true;
      for (let dy = 0; dy < KEEP_EDGE && complete; dy += 1) {
        for (let dx = 0; dx < KEEP_EDGE; dx += 1) {
          if (!isKeep(x + dx, y + dy)) { complete = false; break; }
        }
      }
      if (complete) keeps.push({ x, y });
    }
  }
  return keeps;
}

// Welchem Spieler ein Startplatz gehoert. Die Reihenfolge, in der die Bloecke
// gefunden werden, ist NICHT die Spielernummer - auf "Crete Peninsula" heissen
// die acht Bloecke von Norden nach Sueden 1, 7, 5, 3, 6, 4, 8, 2. Wer sie
// durchzaehlt, vergleicht die falsche Burg mit dem Bildschirmfoto.
//
// Die Nummer steht im Gebaeudefeld: der Eintrag, dessen x/y auf der Ecke des
// Blocks liegt, traegt bei +214 den Besitzer. Genau diesen Wert nimmt auch das
// Spiel - LaunchSkirmishGame holt keepX/keepY aus buildings[playerData.keep.id]
// und gibt sie an setKeepOffsetAndOrientation weiter.
function nameKeeps(blocks, buildingsSection) {
  const found = blocks.map(block => ({ ...block, player: null, orientation: keepOrientation(block.x, block.y) }));
  const section = buildingsSection;
  if (section) {
    const count = Math.floor(section.length / BUILDING_STRIDE);
    for (let index = 0; index < count; index += 1) {
      const at = index * BUILDING_STRIDE;
      if (at + BUILDING_X_AT + 4 > section.length) break;
      if (section.readInt16LE(at + BUILDING_TYPE_AT) !== STONE_KEEP) continue;
      const x = section.readUInt16LE(at + BUILDING_X_AT);
      const y = section.readUInt16LE(at + BUILDING_X_AT + 2);
      const owner = section.readInt16LE(at + BUILDING_OWNER_AT);
      if (owner < 1 || owner > 8) continue;
      const keep = found.find(entry => entry.x === x && entry.y === y && entry.player === null);
      if (keep) keep.player = owner;
    }
  }
  // Nur umsortieren, wenn wirklich jeder Platz eine eigene Nummer hat -
  // sonst bliebe eine halb geratene Reihenfolge stehen, und die waere
  // schlimmer als die ehrliche Fundreihenfolge.
  const numbers = found.map(entry => entry.player);
  const complete = numbers.every(value => value !== null) && new Set(numbers).size === numbers.length;
  if (complete) found.sort((a, b) => a.player - b.player);
  return found;
}

// ------------------------------------------------------------------- aussen

function gameRootOrDefault(gameRoot) {
  if (gameRoot && fs.existsSync(gameRoot)) return gameRoot;
  return fs.existsSync(DEFAULT_GAME_ROOT) ? DEFAULT_GAME_ROOT : null;
}

// Wo Karten liegen: der maps-Ordner des Spiels und der jedes UCP-Plugins.
// Dasselbe Rezept wie in VillageStudio/server.js (listeKarten).
function mapFolders(gameRoot) {
  const folders = [path.join(gameRoot, 'maps')];
  const pluginRoot = path.join(gameRoot, 'ucp', 'plugins');
  let plugins = [];
  try { plugins = fs.readdirSync(pluginRoot); } catch { plugins = []; }
  for (const plugin of plugins) {
    const folder = path.join(pluginRoot, plugin, 'resources', 'maps');
    if (fs.existsSync(folder)) folders.push(folder);
  }
  return folders;
}

function listGameMaps(gameRoot) {
  const root = gameRootOrDefault(gameRoot);
  if (!root) return { gameRoot: null, maps: [] };
  const maps = [];
  for (const folder of mapFolders(root)) {
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.map')) continue;
      maps.push({
        name: name.replace(/\.map$/i, ''),
        path: path.join(folder, name),
        source: path.basename(path.dirname(folder))
      });
    }
  }
  maps.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { gameRoot: root, maps };
}

// Eine Karte oeffnen. Nur Dateien, die auch in der Liste stehen - so kann ein
// Fenster ueber diesen Kanal nichts Beliebiges aus dem Dateisystem holen.
function readGameMap(filePath, gameRoot) {
  const { maps } = listGameMaps(gameRoot);
  const known = maps.find(entry => path.resolve(entry.path).toLowerCase() === path.resolve(String(filePath || '')).toLowerCase());
  if (!known) throw new Error('That map is not one of the game maps.');
  if (fs.statSync(known.path).size > MAX_MAP_BYTES) throw new Error('That map file is unexpectedly large.');

  const buffer = fs.readFileSync(known.path);
  const preview = readPreview(buffer);
  const directory = findDirectory(buffer, preview.end);
  let keeps = [];
  if (directory) {
    try {
      const blocks = findKeeps(readSection(buffer, directory, BUILDING_SECTION));
      let buildings = null;
      try { buildings = readSection(buffer, directory, BUILDINGS_SECTION); } catch { buildings = null; }
      keeps = nameKeeps(blocks, buildings);
    } catch { keeps = []; }
  }
  return {
    name: known.name,
    path: known.path,
    source: known.source,
    edge: PREVIEW_EDGE,
    dataUrl: `data:image/png;base64,${previewPng(preview).toString('base64')}`,
    keeps
  };
}

module.exports = {
  listGameMaps,
  readGameMap,
  // fuer die Tests und fuer Werkzeuge, die eine Karte ohne Electron lesen
  internals: { readPreview, previewPng, findDirectory, readSection, findKeeps, nameKeeps, keepOrientation,
               rowBase, rowRange, tileIndex,
               PREVIEW_EDGE, MAP_TILES, BUILDING_SECTION, BUILDINGS_SECTION, STONE_KEEP, KEEP_EDGE }
};
