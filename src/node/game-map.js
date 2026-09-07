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
const geometry = require('../js/iso-geometry.js');
const { keepOrientation } = geometry;

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

// --------------------------------------------------------- das echte Gelaende
//
// Abschnitt 1001 (GfxLayer, 2 Byte je Feld) traegt nicht eine Gelaendeart,
// sondern die FERTIGE Bildnummer, durchgezaehlt ueber alle gm-Dateien in der
// Reihenfolge, in der die exe sie laedt (Namensliste ab 0xb601c0, Schrittweite
// 1000, Abbruch bei "null"; je Datei die Bildzahl aus dem gm1-Kopf @12).
// Was auf dem Boden STEHT, steht in Abschnitt 1004 (OrganismLayer): 0 nichts,
// 1..1999 Platz in der Baumliste (Abschnitt 1014, 2000 Eintraege zu 156 Byte),
// ab 2000 ein Fels - dessen Bild steckt schon im GfxLayer.
// Alles belegt in VillageStudio/doku/Wissensstand.md, 1b5 und 1b6; der Code
// stammt aus VillageStudio/lib (gelaende.js, karte.js, gm1.js) und ist hier
// uebernommen, weil das Toolkit kein Fremdmodul nachladen soll.
const GFX_SECTION = 1001;          // die Bildnummer je Feld
const ORGANISM_SECTION = 1004;     // was auf dem Feld steht
const TREES_SECTION = 1014;        // LandscapeState.trees
const TREE_STRIDE = 156;

// ------------------------------------------------------------- die Hoehe
//
// Das Gelaende ist nicht flach. renderMap (0x004e8cf0) hebt JEDE Kachel um
//     DAT_RenderMap_YOffset = heightBasedScreenYOffset[HeightLayer[Feld]]
// Punkte an, und zwar an vier Stellen derselben Funktion, immer gleich.
//
// WAS IN DIESER TABELLE STEHT, war bisher nicht gemessen - sie wird erst beim
// Laden gefuellt, von updateShowHiLayerOrResetChangedLayer (0x00501a20). Diese
// Funktion laeuft ueber alle 256 Plaetze und kennt vier Betriebsarten
// (DAT_TileMapState.refreshCertainTileMap):
//     1: tabelle[h] = (h >> 2) + 1      die abgesenkte Ansicht
//     2: tabelle[h] = h                 die normale Ansicht
//     3 und 4: die Zwischenschritte, die von der einen zur anderen wandern
// Welche gilt normalerweise? Constructor_TileMapState (0x00515f40) setzt
// refreshCertainTileMap = 2, und geschrieben wird das Feld ausser dort nur
// noch von triggerLoweredView (0x004f6fd0). Im gewoehnlichen Spiel gilt also
//     Hebung in Bildpunkten = HeightLayer[Feld], eins zu eins.
// Gegenprobe im selben Programm: dieselbe Funktion schreibt danach
// ShowHiLayer[i] = tabelle[HeightLayer[i]] - die Zieladresse liegt 0x4e840
// ueber dem HeightLayer, und genau diesen Abstand haben die beiden Felder in
// der Struktur (HeightLayer +0x29fa30, ShowHiLayer +0x2ee270).
//
// Gemessen an allen 189 Karten des Spiels, 15.195.600 Feldern: Hoehe 8 auf
// 72,9 % (der ebene Grund), 130 auf 7,1 %, 0 auf 7,1 %, 80 auf 3,0 %; groesste
// Zahl 140 auf Rock Face. In einem 100x100-Dorf ist der Unterschied zwischen
// hoechstem und tiefstem Feld im Mittel 64 Punkte (878 Startplaetze gemessen,
// genau EINER davon ist voellig flach) - vier Kachelhoehen. Flach zeichnen war
// also nicht "fast richtig", sondern falsch.
const HEIGHT_SECTION = 1005;       // HeightLayer, ein Byte je Feld
// Und die Steilkante darunter: ohne sie stuende jede erhoehte Kachel auf
// nichts. renderMap zeichnet dafuer PillarGFXLayer, aber nur wo die Hebung
// nicht null ist (Bedingung DAT_00ed3170 != 0), mit
// BlitMapImageWithVerticalClip (0x00453b00): ein 30 Punkte breiter Streifen,
// der 9 Punkte unter der gehobenen Kachel anfaengt und genau so viele Zeilen
// hoch ist wie die Hebung; reicht das Bild nicht, faengt es von vorn an.
const PILLAR_SECTION = 1002;       // PillarGFXLayer, die Steilkante
const PILLAR_TOP = 9;              // die 9 aus BlitMapImageWithVerticalClip
const PILLAR_HEAD = 7;             // imh.height - 7 = nutzbare Zeilen (167-7=160)
// Die Steilkanten liegen in tile_cliffs: 30 Punkte breit, 167 hoch, 9600 Byte
// = 160 Zeilen zu 60 Byte, also unverpackt zwei Byte je Punkt. Von 4.611.642
// erhoehten Feldern auf 60 Karten nennen 66 % ein Bild aus dieser Datei, 12 %
// eines aus tile_land8, 9 % aus tile_chevrons, 12 % gar keines. Nur die aus
// tile_cliffs sind unverpackte Streifen; fuer die anderen nimmt das Werkzeug
// tile_cliffs #0. Das ist ein ERSATZ, keine Messung - sichtbar ist die Kante
// ohnehin nur an einer Stufe.
const CLIFF_FILE = 'tile_cliffs';
const CLIFF_STRIP = 30 * 2;        // Bytes je Zeile eines Steilkanten-Streifens
const MAX_LIFT = 255;              // ein Byte, mehr kann der HeightLayer nicht
const FIRST_ROCK = 2000;           // ab hier ist es ein Fels, kein Baum
const NAME_LIST_VA = 0xb601c0;     // Namensliste der gm-Dateien in der exe
const NAME_STRIDE = 1000;
// Gemessen, nicht hergeleitet: ab Listenplatz 149 liegt der Zaehler des Spiels
// um 21 Bilder unter der Summe aus exe-Liste und Dateikoepfen. Woher die 21
// kommen, ist offen - der Wert ist an 11.497.200 Feldern aus 143 Karten
// angepasst (VillageStudio/lib/gelaende.js).
const PICTURE_SHIFT_FROM = 149, PICTURE_SHIFT = 21;
const TILE_W = 30, TILE_H = 16;    // eine Rautenkachel des Spiels
const TREE_DX = 14, TREE_DY = 6;   // renderMap haengt einen Baum so an sein Feld
const GM1_HEAD = 88, GM1_PALETTES = 10, GM1_COLOURS = 256;
// So viele Punkte stehen in jeder Zeile einer Rautenkachel
const TILE_ROW = [2, 6, 10, 14, 18, 22, 26, 30, 30, 26, 22, 18, 14, 10, 6, 2];
// Ein Feld ausserhalb des Dorfes wird von der Ansicht ohnehin abgeschnitten.
// Ein Feld Zugabe, damit am Rand kein durchsichtiger Streifen stehen bleibt.
const CLIP_MARGIN = 1;
const GM1_CACHE_MAX = 32;
// So weit ausserhalb des Ausschnitts wird noch eingesammelt: ein Baumbild ist
// bis zu 185 Punkte breit und haengt weit links unten, ein hoher Fels steht
// weit ueber seiner eigenen Kachel.
const REACH_SIDE = 200, REACH_UP = 300;

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
//
// Dieser Block ist der Startplatz, aber NICHT der spaetere Standort des
// Bergfrieds: LaunchSkirmishGame (0x00441270) merkt sich x/y, zerstoert das
// Gebaeude und setzt den Bergfried des Spielers neu - bei einer KI an dem
// Platz, auf den die Drehung ihn geschoben hat (bis zu 7 Felder daneben,
// siehe iso-geometry.js, rotateGrid).
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

// ------------------------------------------------ die Bilder des Spiels lesen
//
// Uebernommen aus VillageStudio/lib/gm1.js und lib/gelaende.js. Nur das, was
// das Gelaende braucht - Gebaeudebilder und Schriften bleiben dort.

// 15 Bit: 0RRRRRGGGGGBBBBB
function colourOf(word) {
  return [((word >> 10) & 31) * 255 / 31 | 0, ((word >> 5) & 31) * 255 / 31 | 0, (word & 31) * 255 / 31 | 0];
}

// Kopf, Farbtafeln und Bildverzeichnis einer .gm1
function readGm1(buffer) {
  const count = buffer.readUInt32LE(12);
  const paletteAt = GM1_HEAD;
  const offsetsAt = paletteAt + GM1_PALETTES * GM1_COLOURS * 2;
  const sizesAt = offsetsAt + count * 4;
  const headsAt = sizesAt + count * 4;
  const picturesAt = headsAt + count * 16;

  const palettes = [];
  for (let index = 0; index < GM1_PALETTES; index += 1) {
    const palette = [];
    for (let colour = 0; colour < GM1_COLOURS; colour += 1) {
      palette.push(colourOf(buffer.readUInt16LE(paletteAt + index * 512 + colour * 2)));
    }
    palettes.push(palette);
  }

  const pictures = [];
  for (let index = 0; index < count; index += 1) {
    const at = headsAt + index * 16;
    pictures.push({
      offset: buffer.readUInt32LE(offsetsAt + index * 4),
      size: buffer.readUInt32LE(sizesAt + index * 4),
      width: buffer.readUInt16LE(at),
      height: buffer.readUInt16LE(at + 2),
      lift: buffer.readUInt16LE(at + 10),        // kachelVersatz: hebt den Aufbau
      direction: buffer.readUInt8(at + 12),
      palette: buffer.readUInt8(at + 15)
    });
  }
  return { count, palettes, pictures, picturesAt, buffer };
}

// Ein TGX-Strom in eine RGBA-Flaeche. Ohne Farbtafel sind Farben 2 Byte lang,
// mit Farbtafel 1 Byte als Nummer darin.
function tgxToRgba(data, width, height, palette) {
  const image = Buffer.alloc(width * height * 4, 0);
  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 4;
    image[at] = rgb[0]; image[at + 1] = rgb[1]; image[at + 2] = rgb[2]; image[at + 3] = 255;
  };

  let read = 0, x = 0, y = 0;
  while (read < data.length) {
    const mark = data[read]; read += 1;
    const kind = mark & 0xE0;
    const run = (mark & 0x1F) + 1;
    if (kind === 0x00) {                       // Punkte am Stueck
      for (let step = 0; step < run; step += 1) {
        if (palette) { put(x, y, palette[data[read]]); read += 1; }
        else { if (read + 1 >= data.length) return image; put(x, y, colourOf(data.readUInt16LE(read))); read += 2; }
        x += 1;
      }
    } else if (kind === 0x80) {                // Zeilenende
      y += 1; x = 0;
    } else if (kind === 0x40) {                // ein Punkt, wiederholt
      let rgb;
      if (palette) { rgb = palette[data[read]]; read += 1; }
      else { if (read + 1 >= data.length) return image; rgb = colourOf(data.readUInt16LE(read)); read += 2; }
      for (let step = 0; step < run; step += 1) { put(x, y, rgb); x += 1; }
    } else if (kind === 0x20) {                // durchsichtig
      x += run;
    } else {
      break;                                    // unbekannte Marke: hier ist Schluss
    }
    if (y >= height) break;
  }
  return image;
}

// Eine Rautenkachel: 512 Byte, Punkt fuer Punkt, Zeilenlaengen nach TILE_ROW
function diamondToRgba(data) {
  const image = Buffer.alloc(TILE_W * TILE_H * 4, 0);
  let read = 0;
  for (let y = 0; y < TILE_ROW.length; y += 1) {
    const run = TILE_ROW[y];
    for (let step = 0; step < run; step += 1) {
      const x = 15 + step - run / 2;
      if (read * 2 + 1 >= data.length) return image;
      const rgb = colourOf(data.readUInt16LE(read * 2));
      const at = ((x | 0) + y * TILE_W) * 4;
      image[at] = rgb[0]; image[at + 1] = rgb[1]; image[at + 2] = rgb[2]; image[at + 3] = 255;
      read += 1;
    }
  }
  return image;
}

// Die Namensliste der exe steht an einer virtuellen Adresse; in der Datei
// liegt sie woanders. Der PE-Kopf sagt, wie beides zusammenhaengt.
function virtualToFile(exe) {
  const pe = exe.readUInt32LE(0x3c);
  const sections = exe.readUInt16LE(pe + 6);
  const optionalSize = exe.readUInt16LE(pe + 20);
  const imageBase = exe.readUInt32LE(pe + 24 + 28);
  const table = pe + 24 + optionalSize;
  const parts = [];
  for (let index = 0; index < sections; index += 1) {
    const at = table + index * 40;
    parts.push({
      virtualAt: exe.readUInt32LE(at + 12),
      rawSize: exe.readUInt32LE(at + 16),
      rawAt: exe.readUInt32LE(at + 20)
    });
  }
  return (address) => {
    const relative = address - imageBase;
    for (const part of parts) {
      if (relative >= part.virtualAt && relative < part.virtualAt + part.rawSize) {
        return part.rawAt + (relative - part.virtualAt);
      }
    }
    return -1;
  };
}

// Die Ladereihenfolge der gm-Dateien samt Bildzahl und Startplatz. Einmal je
// Installation gelesen - die exe aendert sich waehrend einer Sitzung nicht.
let pictureStockHeld = null;
function readPictureStock(gameRoot) {
  if (pictureStockHeld && pictureStockHeld.root === gameRoot) return pictureStockHeld.stock;
  const exe = fs.readFileSync(path.join(gameRoot, 'Stronghold Crusader.exe'));
  const toFile = virtualToFile(exe);
  const start = toFile(NAME_LIST_VA);
  if (start < 0) throw new Error('The game executable does not carry the list of picture files.');

  const files = [];
  let total = 0;
  for (let index = 0; index < 260; index += 1) {
    const at = start + index * NAME_STRIDE;
    if (at + 64 > exe.length) break;
    const name = exe.toString('ascii', at, at + 64).replace(/\0.*$/s, '');
    if (!/^[\w\-. ]+$/.test(name)) break;
    if (name === 'null') break;                 // loadGmFiles bricht hier ab
    let count = 0;
    const file = path.join(gameRoot, 'gm', `${name}.gm1`);
    if (fs.existsSync(file)) {
      const handle = fs.openSync(file, 'r');
      const head = Buffer.alloc(GM1_HEAD);
      try { fs.readSync(handle, head, 0, GM1_HEAD, 0); } finally { fs.closeSync(handle); }
      count = head.readUInt32LE(12);
    }
    files.push({ gmId: index + 1, name, count, from: total - (index >= PICTURE_SHIFT_FROM ? PICTURE_SHIFT : 0) });
    total += count;
  }
  const stock = {
    files,
    withPictures: files.filter(entry => entry.count > 0).sort((a, b) => a.from - b.from),
    byGmId: new Map(files.map(entry => [entry.gmId, entry])),
    total
  };
  pictureStockHeld = { root: gameRoot, stock };
  return stock;
}

// Bildnummer aus dem GfxLayer -> Datei und Nummer darin. renderGM greift auf
// Platz GMTotalPicturesProcessed[gmID] + bildNr - 1 zu, der Zaehler beginnt
// bei 1: der 0-basierte Platz ist also der Wert minus eins.
function pictureForValue(stock, value) {
  if (value <= 0) return null;
  const wanted = value - 1;
  const list = stock.withPictures;
  let low = 0, high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = list[middle];
    if (wanted < entry.from) high = middle - 1;
    else if (wanted >= entry.from + entry.count) low = middle + 1;
    else return { name: entry.name, index: wanted - entry.from };
  }
  return null;
}

const gm1Held = new Map();
function heldGm1(gameRoot, name) {
  const key = `${gameRoot}|${name}`;
  const found = gm1Held.get(key);
  if (found) return found;
  const parsed = readGm1(fs.readFileSync(path.join(gameRoot, 'gm', `${name}.gm1`)));
  if (gm1Held.size >= GM1_CACHE_MAX) gm1Held.delete(gm1Held.keys().next().value);
  gm1Held.set(key, parsed);
  return parsed;
}

// Die Baumliste, Abschnitt 1014. Nur die Felder, die zum Zeichnen noetig sind.
function readTrees(section) {
  if (!section || section.length % TREE_STRIDE) return null;
  const list = [];
  for (let index = 0; index < section.length / TREE_STRIDE; index += 1) {
    const at = index * TREE_STRIDE;
    list.push({
      picture: section.readInt32LE(at),          // +0x00 1-basierte Bildnummer
      gmId: section.readInt16LE(at + 4),         // +0x04 welche gm-Datei
      palette: section.readInt32LE(at + 8),      // +0x08 welche Farbtafel
      originX: section.readInt16LE(at + 0x0c),   // +0x0c Aufhaengepunkt
      originY: section.readInt16LE(at + 0x0e),
      alive: section.readInt16LE(at + 0x44)      // +0x44 0 = leerer Platz
    });
  }
  return list;
}

// -------------------------------------------------------- das Gelaende malen
//
// WIE GROSS DARF DAS BILD WERDEN? Ein Feld ist beim Spiel 30 Punkte breit und
// 16 hoch, und ein Vorschaupunkt ist genau ein Feld. Die ganze Karte in dieser
// Aufloesung waere 200*30 x 200*16 = 6000x3200 = 19,2 Millionen Punkte, roh
// 76,8 MB - das ist als ein Bild nicht zu haben.
//
// Gebraucht wird davon nur, was die Ansicht ueberhaupt zeigt: paintGround
// schneidet den Grund an der Raute des 100x100-Dorfes ab. Diese Raute liegt in
// einem Rahmen von 100x100 Vorschaupunkten und fuellt davon die Haelfte -
// 5.000 von 40.000 Punkten der Karte, also ein Achtel. Gemessen an
// "A Friend Indeed", Startplatz 1:
//   ganzer Rahmen 3030x1616 = 4,90 Mio Punkte  -> PNG 5,07 MB
//   nur die Raute darin, der Rest durchsichtig -> PNG 3,02 MB
// Ueber sechs Karten lag das PNG zwischen 2,77 und 3,60 MB, das Zeichnen bei
// 197-317 ms, das Packen bei 193-254 ms. Ein einziges Bild traegt damit.
// In Kacheln zerlegt braeuchte es bei 10x10 Punkten je Kachel 76 der 100
// Kacheln (nachgerechnet: eine Kachel faellt nur weg, wenn sie ganz ausserhalb
// der Raute liegt) - das spart ein Viertel und kostet 76 Bilder statt einem.
//
// Das Bild geht deshalb NICHT in den Sitzungsspeicher des Fensters: 3 MB als
// data:-Adresse sind rund 4 MB Text, und localStorage haelt ueblicherweise
// 5 MB fuer alles zusammen.
function renderTerrain(buffer, directory, gameRoot, keep) {
  const window = geometry.villageWindow(keep);
  const stock = readPictureStock(gameRoot);
  const gfx = readSection(buffer, directory, GFX_SECTION);
  if (!gfx || gfx.length !== MAP_TILES * 2) throw new Error('This map carries no terrain layer (section 1001).');
  let organisms = null;
  let trees = null;
  try {
    organisms = readSection(buffer, directory, ORGANISM_SECTION);
    trees = readTrees(readSection(buffer, directory, TREES_SECTION));
  } catch { organisms = null; trees = null; }
  if (!organisms || organisms.length !== MAP_TILES * 2 || !trees) { organisms = null; trees = null; }
  // Die Hoehe. Fehlt der Abschnitt, bleibt alles flach - das ist genau die
  // Ansicht von vorher, also faellt niemand auf die Nase.
  let heights = null;
  try { heights = readSection(buffer, directory, HEIGHT_SECTION); } catch { heights = null; }
  if (!heights || heights.length !== MAP_TILES) heights = null;
  let pillars = null;
  try { pillars = readSection(buffer, directory, PILLAR_SECTION); } catch { pillars = null; }
  if (!pillars || pillars.length !== MAP_TILES * 2) pillars = null;
  const hoeheAn = (tile) => (heights ? heights[tile] : 0);

  // Die Hoehe je Dorffeld, damit die Ansicht die Burg um dasselbe Mass hebt
  // wie den Boden. Ein Feld ausserhalb der Karte bekommt 0.
  const village = Buffer.alloc(geometry.GRID * geometry.GRID, 0);
  let topLift = 0;
  let floorLift = MAX_LIFT;
  for (let gy = 0; gy < geometry.GRID; gy += 1) {
    for (let gx = 0; gx < geometry.GRID; gx += 1) {
      const { mx, my } = geometry.mapTileForGrid(gx, gy, keep);
      if (my < 0 || my > 399) continue;
      const [von, bis] = rowRange(my);
      if (mx < von || mx > bis) continue;
      const wert = Math.min(MAX_LIFT, hoeheAn(tileIndex(mx, my)));
      village[gy * geometry.GRID + gx] = wert;
      if (wert > topLift) topLift = wert;
      if (wert < floorLift) floorLift = wert;
    }
  }
  if (floorLift > topLift) floorLift = topLift;      // gar kein Feld auf der Karte

  const width = window.cells * TILE_W;
  const flatHeight = window.cells * TILE_H;
  // Oben kommt so viel Luft dazu, wie das hoechste Feld des Dorfes gehoben
  // wird - sonst schnitte der Bildrand die Bergkuppe ab.
  const height = flatHeight + topLift;
  // Aus der Lage eines Feldes im schraegen Bild hergeleitet: ein Feld sitzt bei
  // (15*(x-y), 8*(x+y)), und der Vorschaupunkt (px,py) gehoert zu
  // x-y = 2px-199 und x+y = 2py+199.
  const originX = TILE_W * window.px0 - 2985;
  const originY = TILE_H * window.py0 + 1592;
  const rgba = Buffer.alloc(width * height * 4, 0);

  // Welcher Teil einer Bildzeile gehoert ueberhaupt zum Dorf? Die Ansicht
  // schneidet den Grund an der Raute ab, also braucht alles ausserhalb gar
  // nicht erst gemalt zu werden - das ist die halbe Bildflaeche und war im
  // Versuch der Unterschied zwischen 5,07 MB und 3,02 MB.
  // Fuer einen Punkt mit den Vorschau-Koordinaten (P,Q) gilt
  //   gx = P + Q - (keep.x - 43)      gy = Q - P + 199 - (keep.y - 43)
  // und beide muessen zwischen 0 und 100 liegen. Nach P aufgeloest ergibt das
  // je Zeile genau ein Stueck.
  const anchorX = keep.x - geometry.KEEP_TILE;
  const anchorY = keep.y - geometry.KEEP_TILE;
  const low = new Int32Array(flatHeight);
  const high = new Int32Array(flatHeight);
  for (let y = 0; y < flatHeight; y += 1) {
    const q = (y + 0.5) / TILE_H + window.py0;
    const from = Math.max(anchorX - q, q + (PREVIEW_EDGE - 1) - anchorY - geometry.GRID) - CLIP_MARGIN;
    const to = Math.min(anchorX - q + geometry.GRID, q + (PREVIEW_EDGE - 1) - anchorY) + CLIP_MARGIN;
    low[y] = Math.max(0, Math.ceil((from - window.px0) * TILE_W - 0.5));
    high[y] = Math.min(width - 1, Math.floor((to - window.px0) * TILE_W - 0.5));
  }

  // Gerechnet wird weiter in der FLACHEN Zeile - erst beim Schreiben kommt
  // die Hebung dazu. Nur so schneidet die Raute noch richtig: die Grenze
  // gehoert zu dem Feld, auf dem der Punkt steht, nicht zu der Bildzeile, in
  // die ihn seine Hoehe hebt. Wer stattdessen die gehobene Zeile prueft,
  // schneidet einer erhoehten Kachel am Rand die halbe Seite ab.
  //   y       = Zeile ohne Hebung (darf negativ sein, wenn etwas hoch steht)
  //   hebung  = wie weit dieser Punkt nach oben rueckt
  //   pruefen = welche Zeile ueber die Raute entscheidet (die des Feldes)
  const put = (x, y, r, g, b, hebung, pruefen) => {
    const zeile = pruefen === undefined ? y : pruefen;
    if (zeile < 0 || zeile >= flatHeight || x < low[zeile] || x > high[zeile]) return;
    const bild = y - (hebung || 0) + topLift;
    if (bild < 0 || bild >= height) return;
    const at = (bild * width + x) * 4;
    rgba[at] = r; rgba[at + 1] = g; rgba[at + 2] = b; rgba[at + 3] = 255;
  };

  // Alles einsammeln, was in den Ausschnitt ragt, und von hinten nach vorn
  // malen - ein hoher Fels steht weit ueber seiner eigenen Kachel.
  const order = [];
  for (let y = 0; y <= 399; y += 1) {
    const [from, to] = rowRange(y);
    for (let x = from; x <= to; x += 1) {
      const sx = 15 * (x - y) - originX;
      const sy = 8 * (x + y) - originY;
      if (sx > width + REACH_SIDE || sx < -REACH_SIDE || sy > flatHeight + REACH_SIDE || sy < -REACH_UP) continue;
      order.push([tileIndex(x, y), sx, sy, x, y]);
    }
  }
  order.sort((a, b) => a[2] - b[2]);

  const painted = { tiles: 0, missing: 0, trees: 0, cliffs: 0 };

  // Welcher Baum steht auf diesem Feld? null, wenn keiner.
  const treeOn = (tile) => {
    if (!organisms) return null;
    const value = organisms.readUInt16LE(tile * 2);
    if (!value || value >= FIRST_ROCK) return null;   // 0 nichts, ab 2000 ein Fels
    const tree = trees[value];
    if (!tree || tree.alive === 0 || tree.picture === 0) return null;
    const file = stock.byGmId.get(tree.gmId);
    if (!file || tree.picture > file.count) return null;
    return { tree, name: file.name };
  };

  const paintTree = (sx, sy, hit, hebung) => {
    const tree = hit.tree;
    const gm1 = heldGm1(gameRoot, hit.name);
    const entry = gm1.pictures[tree.picture - 1];
    if (!entry) return;
    const raw = gm1.buffer.subarray(gm1.picturesAt + entry.offset, gm1.picturesAt + entry.offset + entry.size);
    const palette = gm1.palettes[(tree.palette >= 0 && tree.palette < gm1.palettes.length) ? tree.palette : entry.palette];
    const picture = tgxToRgba(raw, entry.width, entry.height, palette);
    const atX = sx - tree.originX + TREE_DX;
    const atY = sy - tree.originY + TREE_DY;
    // Der Baum steht auf seinem Feld und steigt mit ihm: renderMap zieht auch
    // bei ihm DAT_RenderMap_YOffset ab (Zeile 0x004eb70e im Dekompilat).
    const fuss = sy + TILE_H - 1;
    for (let y = 0; y < entry.height; y += 1) {
      for (let x = 0; x < entry.width; x += 1) {
        const at = (y * entry.width + x) * 4;
        if (picture[at + 3]) put(atX + x, atY + y, picture[at], picture[at + 1], picture[at + 2], hebung, fuss);
      }
    }
    painted.trees += 1;
  };

  // Die Steilkante unter einer gehobenen Kachel. Gezeichnet wird nur, was auch
  // zu sehen ist: liegen beide Nachbarn davor genauso hoch, deckt ihr eigener
  // Boden die Kante zu. Das spart bei 79 % der Felder die ganze Arbeit.
  const cliffHeld = new Map();
  const cliffStrip = (name, index) => {
    const key = `${name}#${index}`;
    const found = cliffHeld.get(key);
    if (found) return found;
    const gm1 = heldGm1(gameRoot, name);
    const entry = gm1.pictures[index];
    if (!entry || entry.width !== TILE_W) return null;
    const zeilen = entry.height - PILLAR_HEAD;
    if (zeilen < 1 || entry.size < zeilen * CLIFF_STRIP) return null;
    const raw = gm1.buffer.subarray(gm1.picturesAt + entry.offset, gm1.picturesAt + entry.offset + entry.size);
    const bild = Buffer.alloc(TILE_W * zeilen * 4, 0);
    for (let y = 0; y < zeilen; y += 1) {
      for (let x = 0; x < TILE_W; x += 1) {
        const rgb = colourOf(raw.readUInt16LE(y * CLIFF_STRIP + x * 2));
        const at = (y * TILE_W + x) * 4;
        bild[at] = rgb[0]; bild[at + 1] = rgb[1]; bild[at + 2] = rgb[2]; bild[at + 3] = 255;
      }
    }
    const streifen = { bild, zeilen };
    cliffHeld.set(key, streifen);
    return streifen;
  };
  const cliffFor = (tile) => {
    if (pillars) {
      const found = pictureForValue(stock, pillars.readUInt16LE(tile * 2));
      if (found && found.name === CLIFF_FILE) {
        const streifen = cliffStrip(found.name, found.index);
        if (streifen) return streifen;
      }
    }
    return cliffStrip(CLIFF_FILE, 0);      // der Ersatz, siehe oben bei CLIFF_FILE
  };
  // Hoehe eines Nachbarfeldes, ohne aus der Raute zu fallen. Ausserhalb gilt
  // die eigene Hoehe - dort ist nichts zu sehen, und eine 0 wuerde am
  // Kartenrand eine Kante erfinden, die es nicht gibt.
  const hoeheBei = (x, y, ersatz) => {
    if (y < 0 || y > 399) return ersatz;
    const [von, bis] = rowRange(y);
    if (x < von || x > bis) return ersatz;
    return hoeheAn(tileIndex(x, y));
  };
  const paintCliff = (tile, x, y, sx, sy, hebung) => {
    // Liegt RINGSUM alles gleich hoch, ist die Kante von den Nachbarn verdeckt
    // und braucht gar nicht gemalt zu werden - das spart auf einer Hochebene
    // die ganze Arbeit. Es reicht aber nicht, nur nach vorn zu sehen: faellt
    // das Gelaende nach HINTEN ab, schaut man von oben in die Luecke, und
    // genau dort blieben sonst Loecher stehen (gemessen auf Rock Face: 8066
    // durchsichtige Punkte mitten im Dorf).
    const tiefster = Math.min(hoeheBei(x + 1, y, hebung), hoeheBei(x, y + 1, hebung),
                              hoeheBei(x - 1, y, hebung), hoeheBei(x, y - 1, hebung));
    if (tiefster >= hebung) return false;
    const streifen = cliffFor(tile);
    if (!streifen) return false;
    const fuss = sy + TILE_H - 1;
    for (let i = 0; i < hebung; i += 1) {
      const quelle = (i % streifen.zeilen) * TILE_W * 4;
      const zeile = sy + PILLAR_TOP + i;                   // Zeile OHNE Hebung
      for (let x2 = 0; x2 < TILE_W; x2 += 1) {
        const at = quelle + x2 * 4;
        if (streifen.bild[at + 3]) put(sx + x2, zeile, streifen.bild[at], streifen.bild[at + 1], streifen.bild[at + 2], hebung, fuss);
      }
    }
    return true;
  };

  for (const [tile, sx, sy, mx, my] of order) {
    const hebung = Math.min(MAX_LIFT, hoeheAn(tile));
    const hit = treeOn(tile);
    const found = pictureForValue(stock, gfx.readUInt16LE(tile * 2));
    if (!found) { painted.missing += 1; if (hit) paintTree(sx, sy, hit, hebung); continue; }
    const gm1 = heldGm1(gameRoot, found.name);
    const entry = gm1.pictures[found.index];
    if (!entry) { painted.missing += 1; continue; }
    const raw = gm1.buffer.subarray(gm1.picturesAt + entry.offset, gm1.picturesAt + entry.offset + entry.size);

    // erst die Steilkante, dann die Kachel darauf
    if (hebung > 0 && paintCliff(tile, mx, my, sx, sy, hebung)) painted.cliffs += 1;

    // die Rautenkachel selbst
    const diamond = diamondToRgba(raw.subarray(0, 512));
    for (let y = 0; y < TILE_H; y += 1) {
      for (let x = 0; x < TILE_W; x += 1) {
        const at = (y * TILE_W + x) * 4;
        if (diamond[at + 3]) put(sx + x, sy + y, diamond[at], diamond[at + 1], diamond[at + 2], hebung);
      }
    }
    // was darueber steht (Fels, Busch): lift hebt es ueber die eigene Kachel
    if (raw.length > 512) {
      const lift = entry.lift || 0;
      const above = tgxToRgba(raw.subarray(512), TILE_W, entry.height, null);
      const right = entry.direction === 3 ? 14 : 0;
      const fuss = sy + TILE_H - 1;
      for (let y = 0; y < entry.height; y += 1) {
        for (let x = 0; x < TILE_W; x += 1) {
          const at = (y * TILE_W + x) * 4;
          if (above[at + 3]) put(sx + right + x, sy - lift + y, above[at], above[at + 1], above[at + 2], hebung, fuss);
        }
      }
    }
    // und zuletzt, was auf dem Feld STEHT - das Spiel malt den Baum in
    // derselben Runde direkt nach der Kachel
    if (hit) paintTree(sx, sy, hit, hebung);
    painted.tiles += 1;
  }

  // top: so viele Punkte steht das Bild ueber dem flachen Rahmen. Die Ansicht
  // muss es um genau dieses Mass hoeher ansetzen, sonst saesse alles zu tief.
  // village: die Hoehe je Dorffeld, damit die Burg mit dem Boden steigt.
  return { width, height, top: topLift, floor: floorLift, village,
           px0: window.px0, py0: window.py0, cells: window.cells, rgba, ...painted };
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
function knownMap(filePath, gameRoot) {
  const { maps } = listGameMaps(gameRoot);
  const known = maps.find(entry => path.resolve(entry.path).toLowerCase() === path.resolve(String(filePath || '')).toLowerCase());
  if (!known) throw new Error('That map is not one of the game maps.');
  if (fs.statSync(known.path).size > MAX_MAP_BYTES) throw new Error('That map file is unexpectedly large.');
  return known;
}

function readGameMap(filePath, gameRoot) {
  const known = knownMap(filePath, gameRoot);
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

// Dieselbe Karte noch einmal, aber als echtes Gelaende statt als Farbpunkte.
// WELCHER Startplatz gemeint ist, sagt das Fenster - es kennt auch den Fall
// "keine Startplaetze, Dorf in die Kartenmitte" (geo.centreKeep), und zwei
// Stellen, die das getrennt entscheiden, waeren zwei Stellen zum Auseinander-
// laufen. Geprueft wird der Platz trotzdem: er muss auf der Karte liegen.
function readMapTerrain(filePath, gameRoot, keep) {
  const known = knownMap(filePath, gameRoot);
  const root = gameRootOrDefault(gameRoot);
  if (!root) throw new Error('The game folder is not set.');
  // Nicht Number(keep && keep.x): fehlt der Platz ganz, waere das die 0, und
  // die Karte wuerde still an der falschen Ecke gemalt statt zu widersprechen.
  const x = keep && typeof keep.x === 'number' ? keep.x : NaN;
  const y = keep && typeof keep.y === 'number' ? keep.y : NaN;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 399 || y < 0 || y > 399) {
    throw new Error('That starting place is not on the map.');
  }

  const buffer = fs.readFileSync(known.path);
  const preview = readPreview(buffer);
  const directory = findDirectory(buffer, preview.end);
  if (!directory) throw new Error('That map has no section directory.');
  const terrain = renderTerrain(buffer, directory, root, { x, y });
  return {
    name: known.name,
    path: known.path,
    px0: terrain.px0,
    py0: terrain.py0,
    cells: terrain.cells,
    width: terrain.width,
    height: terrain.height,
    top: terrain.top,
    floor: terrain.floor,
    tiles: terrain.tiles,
    missing: terrain.missing,
    trees: terrain.trees,
    cliffs: terrain.cliffs,
    // 10.000 Byte, eins je Dorffeld - als Text rund 13 KB. Klein genug, um es
    // mit dem Bild zusammen zu schicken, und ohne es stuende die Burg flach
    // auf einem Gelaende mit Bergen.
    village: terrain.village.toString('base64'),
    dataUrl: `data:image/png;base64,${encodeRgbaPng(terrain.width, terrain.height, terrain.rgba).toString('base64')}`
  };
}

module.exports = {
  listGameMaps,
  readGameMap,
  readMapTerrain,
  // fuer die Tests und fuer Werkzeuge, die eine Karte ohne Electron lesen
  internals: { readPreview, previewPng, findDirectory, readSection, findKeeps, nameKeeps, keepOrientation,
               rowBase, rowRange, tileIndex,
               readPictureStock, pictureForValue, readGm1, renderTerrain, virtualToFile,
               PREVIEW_EDGE, MAP_TILES, BUILDING_SECTION, BUILDINGS_SECTION, STONE_KEEP, KEEP_EDGE,
               TILE_W, TILE_H, GFX_SECTION, ORGANISM_SECTION, TREES_SECTION,
               HEIGHT_SECTION, PILLAR_SECTION, PILLAR_TOP, PILLAR_HEAD, CLIFF_FILE, MAX_LIFT }
};
