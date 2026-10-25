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
const { resolveGameGraphics } = require('./game-graphics');
const { readGm1, tgxToRgba, diamondToRgba, upperTilePicture, pillarPicture } = require('./gm1');
const { virtualToFile } = require('./pe-addresses');
const { packMapPictures } = require('./pixel-atlas');
const { cachedAtlas } = require('./map-atlas-cache');
const { readCachedNativeMap, internals: nativeRendererInternals } = require('./native-map-renderer');
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
// tile_cliffs und tile_walls sind unverpackte Streifen; fuer andere nimmt das Werkzeug
// tile_cliffs #0. Das ist ein ERSATZ, keine Messung - sichtbar ist die Kante
// ohnehin nur an einer Stufe.
const CLIFF_FILE = 'tile_cliffs';
const MAX_LIFT = 255;              // ein Byte, mehr kann der HeightLayer nicht
const FIRST_ROCK = 2000;           // ab hier ist es ein Fels, kein Baum
const NAME_LIST_VA = 0xb601c0;     // Namensliste der gm-Dateien in der exe
const NAME_STRIDE = 1000;
const SAVED_PICTURE_LAYOUT = require('../../config/map-picture-layout.json');
const TILE_W = 30, TILE_H = 16;    // eine Rautenkachel des Spiels
const TREE_DX = 14, TREE_DY = 6;   // renderMap haengt einen Baum so an sein Feld
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


function treePicture(gameRoot, name, tree) {
  const gm1 = heldGm1(gameRoot, name);
  const entry = gm1.pictures[tree.picture - 1];
  if (!entry) return null;
  const raw = gm1.buffer.subarray(gm1.picturesAt + entry.offset, gm1.picturesAt + entry.offset + entry.size);
  const palette = gm1.palettes[tree.palette >= 0 && tree.palette < gm1.palettes.length ? tree.palette : entry.palette];
  return { width: entry.width, height: entry.height, dx: 0, dy: 0,
    rgba: tgxToRgba(raw, entry.width, entry.height, palette) };
}

// Die Namensliste der exe steht an einer virtuellen Adresse; in der Datei
// liegt sie woanders. Der PE-Kopf sagt, wie beides zusammenhaengt.
// Die Ladereihenfolge der gm-Dateien samt Bildzahl und Startplatz. Einmal je
// Installation gelesen - die exe aendert sich waehrend einer Sitzung nicht.
let pictureStockHeld = null;
function readPictureStock(gameRoot) {
  if (pictureStockHeld && pictureStockHeld.root === gameRoot) return pictureStockHeld.stock;
  const exe = fs.readFileSync(path.join(gameRoot, 'Stronghold Crusader.exe'));
  const toFile = virtualToFile(exe);
  const start = toFile(NAME_LIST_VA);
  if (start < 0) throw new Error('The game executable does not carry the list of picture files.');

  for (const entry of SAVED_PICTURE_LAYOUT.files) {
    const at = start + (entry.gmId - 1) * NAME_STRIDE;
    const name = exe.toString('ascii', at, at + 64).replace(/\0.*$/s, '');
    if (name !== entry.name) throw new Error('Unsupported game picture-file layout.');
  }
  // Saved GFX values belong to the map format's picture layout. Replacement
  // texture counts must never shift IDs for every subsequent file.
  const files = SAVED_PICTURE_LAYOUT.files.map(file => ({...file}));
  const stock = pictureStock(files, 'classic');
  pictureStockHeld = { root: gameRoot, stock };
  return stock;
}

function pictureStock(files, layout) {
  return {files, layout, total:Math.max(...files.map(file => file.from + file.count)),
    withPictures:files.filter(entry => entry.count > 0).sort((a,b) => a.from-b.from),
    byGmId:new Map(files.map(entry => [entry.gmId,entry]))};
}

// loadGmFiles advances the global counter by the actual picture
// count. Saved maps can carry either classic IDs or IDs from a replacement
// pack. Captures have known provenance and use the base files of that capture.
function installedPictureStock(gameRoot, overrides = true) {
  let total = 0;
  const files = readPictureStock(gameRoot).files.map(entry => {
    const file = overrides && activeGraphics?.root === path.resolve(gameRoot)
      ? activeGraphics.file(entry.name) : path.join(gameRoot, 'gm', `${entry.name}.gm1`);
    let count = 0;
    if (fs.existsSync(file)) {
      const header = Buffer.alloc(24), handle = fs.openSync(file, 'r');
      try { fs.readSync(handle, header, 0, 24, 0); } finally { fs.closeSync(handle); }
      count = header.readUInt32LE(12);
    }
    const from = total; total += count;
    return {...entry, from, count};
  });
  return pictureStock(files, overrides ? 'installed' : 'capture');
}

function shoreLayoutErrors(stock, gfx, logic, misc, logic2) {
  if (logic?.length !== MAP_TILES*4 || misc?.length !== MAP_TILES*2 || logic2?.length !== MAP_TILES) return null;
  let checked=0, errors=0;
  for(let tile=0;tile<MAP_TILES;tile++) {
    // updateGfxLayer 0x50CDBF: undecorated sea uses one of eight plain
    // pictures in each 246-picture lighting bank, never a bank/corner tile.
    if (!(logic.readUInt32LE(tile*4)&1) || (misc.readUInt16LE(tile*2)&0x3c0) || (logic2[tile]&8)) continue;
    const picture=pictureForValue(stock,gfx.readUInt16LE(tile*2));
    checked++;
    if(picture?.name!=='tile_sea_new_01' || picture.index>=1476 || picture.index%246>=8) errors++;
  }
  return checked ? errors : null;
}

function choosePictureStock(gfx, candidates, validPicture, layers = {}) {
  const values = new Set();
  for (let at=0;at<gfx.length;at+=2) if (gfx.readUInt16LE(at)) values.add(gfx.readUInt16LE(at));
  const checked = candidates.map(stock => ({stock, invalid:[...values].filter(value => {
    const picture = pictureForValue(stock,value);
    return !picture || !validPicture(picture);
  }).length}));
  // Switch only on a fully valid alternative. In ambiguous/unsupported maps
  // preserve classic compatibility, rather than silently selecting a partial fit.
  const valid=checked.filter(candidate=>candidate.invalid===0);
  // Some saved maps use the installed counter after GM slot 149; both
  // layouts can point into valid terrain files. Check native sea semantics
  // before falling back to the historical compatibility preference.
  return valid.find(({stock})=>shoreLayoutErrors(stock,gfx,layers.logic,layers.misc,layers.logic2)===0)?.stock
    || valid[0]?.stock || candidates[0];
}

function savedPictureStock(gameRoot, gfx, layers = {}) {
  const headers = new Map();
  return choosePictureStock(gfx, [readPictureStock(gameRoot), installedPictureStock(gameRoot)], picture => {
    if (!headers.has(picture.name)) {
      try { const file=heldGm1(gameRoot,picture.name); headers.set(picture.name,{type:file.buffer.readUInt32LE(20),count:file.count}); }
      catch { headers.set(picture.name,{type:0,count:0}); }
    }
    const header=headers.get(picture.name);
    return header.type === 3 && picture.index < header.count;
  }, layers);
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

let activeGraphics = null;
const gm1Held = new Map();
function heldGm1(gameRoot, name) {
  const file = activeGraphics?.root === path.resolve(gameRoot) ? activeGraphics.file(name) : path.join(gameRoot, 'gm', `${name}.gm1`);
  const key = file;
  const found = gm1Held.get(key);
  if (found) return found;
  const parsed = readGm1(fs.readFileSync(file));
  if (gm1Held.size >= GM1_CACHE_MAX) gm1Held.delete(gm1Held.keys().next().value);
  gm1Held.set(key, parsed);
  return parsed;
}

// Kakteen speichern ihr Bild nicht mit: das Spiel wuerfelt es beim ersten Zug
// aus dem gemerkten Zufallswert. Genau diese vier Rechnungen stehen in
// UpdateTree16 bis UpdateTree19 (0x004f28f0, 0x004f2920, 0x004f2970,
// 0x004f29c0) - Art 17, 18 und 19 deckeln ihren obersten Wert, weshalb das
// hoechste Bild doppelt so haeufig vorkommt wie die anderen.
//
// GEMESSEN am 17.09.2026 ueber alle 189 Karten: fuer die 67.903 Kakteen, die
// ihre Bildnummer gespeichert haben, liefert diese Rechnung in 100,00 Prozent
// der Faelle genau die gespeicherte Nummer. Erst damit darf sie auf die
// 10.169 ohne Nummer angewandt werden - ohne sie fehlten 15 Prozent aller
// Gewaechse im Bild, und im Boden blieb nur ihr Schatten stehen.
function cactusPicture(type, rng) {
  switch (type) {
    case 16: return (rng & 7) + 10;                  // Bilder 10 bis 17
    case 17: return Math.min((rng & 3) + 1, 3);      // 1 bis 3
    case 18: return Math.min((rng & 3) + 4, 6);      // 4 bis 6
    case 19: return Math.min((rng & 3) + 7, 9);      // 7 bis 9
    default: return 0;
  }
}

// The native tree updaters select picture 148 for timber trees in Space
// (0x004F260A), hide shrubs, and retain cactus pictures. The editor keeps
// orchard positions visible with the original apple stump (picture 101).
function treeViewPicture(tree, flat = false) {
  if (flat) {
    if (tree.type >= 1 && tree.type <= 4) return 148;
    if (tree.type === 15) return 101;
    if (tree.type >= 5 && tree.type <= 10) return 0;
  }
  return tree.picture;
}

// Die Baumliste, Abschnitt 1014. Nur die Felder, die zum Zeichnen noetig sind.
// Die Namen der Felder stammen aus der OpenSHC-Struktur "Tree" (156 Byte).
function readTrees(section) {
  if (!section || section.length % TREE_STRIDE) return null;
  const list = [];
  for (let index = 0; index < section.length / TREE_STRIDE; index += 1) {
    const at = index * TREE_STRIDE;
    const type = section.readInt16LE(at + 0x46);     // +0x46 treeType
    const picture = section.readInt32LE(at);         // +0x00 animationFrameUnk
    list.push({
      // 1-basierte Bildnummer. Fehlt sie, kommt sie aus dem Zufallswert.
      picture: picture || cactusPicture(type, section.readInt32LE(at + 0x88)),
      gmId: section.readInt16LE(at + 4),         // +0x04 welche gm-Datei
      palette: section.readInt32LE(at + 8),      // +0x08 welche Farbtafel
      originX: section.readInt16LE(at + 0x0c),   // +0x0c Aufhaengepunkt
      originY: section.readInt16LE(at + 0x0e),
      alive: section.readInt16LE(at + 0x44),     // +0x44 0 = leerer Platz
      type                                       // 16 bis 19 sind die Kakteen
    });
  }
  return list;
}

// ---------------------------------------------------- wie gross ein Bild ist
//
// Hier stand bis zum 17.09.2026 renderTerrain: ein fertiges Bild des
// Dorffensters, 3030x1616 Punkte, als PNG 2,77 bis 3,60 MB ueber sechs Karten,
// Zeichnen 197-317 ms, Packen 193-254 ms. Es zeigte nur 100x100 der 400x400
// Felder. Die ganze Karte in derselben Aufloesung waere 12000x6400 Punkte -
// 293 MB roh. Als ein Bild ist das nicht zu haben, und deshalb geht es
// ueberhaupt nicht ueber ein Bild: gemalt wird aus dem Kachelvorrat weiter
// unten, so wie renderMap (0x004e8cf0) es im Spiel macht.

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

// Static terrain constraints for the editor planner. Saved building/path flags
// are deliberately not imported: the current AIV supplies those structures.
function pathTileFlags(flags, organism = 0) {
  const water=Boolean(flags & (1|1048576)) && !(flags & 2097152);
  const hardBlocked=water || Boolean(flags & (16|32));
  const blocked=hardBlocked || Boolean(flags & (128|4096|8192|131072|524288)) || Boolean(organism);
  return {blocked:Number(blocked),hardBlocked:Number(hardBlocked)};
}
function pathTerrain(buffer, directory) {
  const logic = readSection(buffer, directory, 1003);
  const organisms = readSection(buffer, directory, ORGANISM_SECTION);
  const heights = readSection(buffer, directory, 1045) || readSection(buffer, directory, HEIGHT_SECTION);
  if (!logic || logic.length !== MAP_TILES*4) return null;
  const blocked = Buffer.alloc(400*400, 1), hardBlocked = Buffer.alloc(400*400,1), ground = Buffer.alloc(400*400), constructionLift = Buffer.alloc(400*400);
  const buildFlags=Buffer.alloc(400*400*4);
  for(let i=0;i<400*400;i++)buildFlags.writeUInt32LE(16,i*4);
  for(let y=0;y<400;y++) for(let x=0;x<400;x++) {
    const [left,right]=rowRange(y); if(x<left || x>right) continue;
    const tile=tileIndex(x,y);
    const flags=logic.readUInt32LE(tile*4);
    const access=pathTileFlags(flags, organisms?.readUInt16LE(tile*2) || 0);
    blocked[y*400+x]=access.blocked;
    hardBlocked[y*400+x]=access.hardBlocked;
    // Construction is independent of walking: omit vegetation, animals and
    // saved structures, but retain water, marsh, rock, resources and borders.
    buildFlags.writeUInt32LE((flags & 0xe03a00b1) >>> 0,(y*400+x)*4);
    ground[y*400+x]=heights?.[tile] || 0;
    constructionLift[y*400+x]=(flags & 8)?4:0;
  }
  return {version:5,buildFlags:buildFlags.toString('base64'),constructionLift:constructionLift.toString('base64'),fingerprint:nativeRendererInternals.sha(buffer),blocked:blocked.toString('base64'),hardBlocked:hardBlocked.toString('base64'),heights:ground.toString('base64')};
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
    keeps,
    pathTerrain: directory ? pathTerrain(buffer, directory) : null
  };
}

// Die ganze Karte, ohne sie auszumalen.
//
// Ein fertiges Bild des Dorffensters waere rund 4 MB und zeigte nur 100x100
// der 400x400 Felder. Die ganze Karte so zu malen waere 12000x6400 Punkte -
// 293 MB roh, 401 MB als Text ueber die Bruecke.
//
// Das Spiel macht es anders: renderMap (0x004e8cf0) laeuft den BILDSCHIRM Feld
// fuer Feld ab und holt jede Kachel einzeln aus ihrer .gm1. Gemalt wird nur,
// was zu sehen ist, und nie ein Zwischenbild. Deshalb liefert diese Funktion
// dasselbe, was das Spiel im Speicher haelt: die Bildnummer je Feld und einen
// Vorrat aus allen Kacheln, die auf dieser Karte ueberhaupt vorkommen.
//
// GEMESSEN am 09.09.2026:
//   Kartendatei           833 KB
//   Bildschicht 1001      157 KB  (80.400 Felder, je zwei Byte)
//   verschiedene Kacheln  956 auf "A Friend Indeed", 1773 auf "Crete Peninsula"
// Der Vorrat bleibt damit unter vier Megabyte - fuer die GANZE Karte, wo heute
// vier Megabyte fuer einen Ausschnitt hinuebergehen.
const ATLAS_SPALTEN = 64;          // 64 * 30 = 1920 Punkte breit

function buildTileAtlas(gfx, gameRoot, layers = {}) {
  const stock = layers.stock || savedPictureStock(gameRoot, gfx);

  // Welche Bildnummern kommen ueberhaupt vor? Jede bekommt einen festen Platz.
  const platzVon = new Map();
  const reihe = [];
  for (let feld = 0; feld < MAP_TILES; feld += 1) {
    const wert = gfx.readUInt16LE(feld * 2);
    if (!wert || platzVon.has(wert)) continue;
    platzVon.set(wert, reihe.length);
    reihe.push(wert);
  }

  const zeilen = Math.max(1, Math.ceil(reihe.length / ATLAS_SPALTEN));
  const breite = ATLAS_SPALTEN * TILE_W;
  const hoehe = zeilen * TILE_H;
  const rgba = Buffer.alloc(breite * hoehe * 4, 0);
  const upperPictures = new Array(reihe.length).fill(null);
  let fehlend = 0;

  reihe.forEach((wert, platz) => {
    const found = pictureForValue(stock, wert);
    if (!found) { fehlend += 1; return; }
    let bild = null;
    try {
      const gm1 = heldGm1(gameRoot, found.name);
      const entry = gm1.pictures[found.index];
      if (entry && gm1.buffer.readUInt32LE(20) === 3) {
        const raw = gm1.buffer.subarray(gm1.picturesAt + entry.offset, gm1.picturesAt + entry.offset + entry.size);
        bild = diamondToRgba(raw.subarray(0, 512));
        // Flat substitutions happen before decoding. The selected tile keeps
        // its native upper pixels, including the extended shoreline banks.
        upperPictures[platz] = upperTilePicture(entry, raw);
      }
    } catch { bild = null; }
    if (!bild) { fehlend += 1; return; }
    const spalte = platz % ATLAS_SPALTEN;
    const zeile = Math.floor(platz / ATLAS_SPALTEN);
    for (let y = 0; y < TILE_H; y += 1) {
      const von = y * TILE_W * 4;
      const nach = ((zeile * TILE_H + y) * breite + spalte * TILE_W) * 4;
      bild.copy(rgba, nach, von, von + TILE_W * 4);
    }
  });

  // Platz im Vorrat je Feld - und zwar in einem VOLLEN 400x400-Raster, nicht
  // in der Rautennummerierung der Datei. Die Raute spart 80.400 statt 160.000
  // Plaetze, aber der Empfaenger muesste ihre Zeilenformel nachbauen; genau
  // das ist am 09.09.2026 schiefgegangen und hat die Karte in Streifen
  // gezogen. 160.000 mal zwei Byte sind 320 KB - der Fehler war teurer als
  // die 163 KB, die das Raten gespart haette.
  // 0xffff heisst "hier ist nichts zu malen", auch ausserhalb der Raute.
  const plaetze = new Uint16Array(400 * 400).fill(0xffff);
  for (let my = 0; my < 400; my += 1) {
    const [von, bis] = rowRange(my);
    for (let mx = von; mx <= bis; mx += 1) {
      const wert = gfx.readUInt16LE(tileIndex(mx, my) * 2);
      const platz = wert === 0 ? undefined : platzVon.get(wert);
      if (platz !== undefined) plaetze[my * 400 + mx] = platz;
    }
  }

  const treeSprites = [];
  const cliffSprites = new Uint16Array(400 * 400);
  const cliffIndices = new Map();
  if (layers.heights?.length === MAP_TILES) {
    const atHeight = (x, y, fallback) => {
      if (y < 0 || y >= 400) return fallback;
      const [from, to] = rowRange(y);
      return x < from || x > to ? fallback : layers.heights[tileIndex(x, y)];
    };
    for (let my = 0; my < 400; my++) {
      const [from, to] = rowRange(my);
      for (let mx = from; mx <= to; mx++) {
        const tile = tileIndex(mx, my), lift = layers.heights[tile];
        if (!lift || Math.min(atHeight(mx - 1, my, lift), atHeight(mx + 1, my, lift),
          atHeight(mx, my - 1, lift), atHeight(mx, my + 1, lift)) >= lift) continue;
        const found = layers.pillars?.length === MAP_TILES * 2
          ? pictureForValue(stock, layers.pillars.readUInt16LE(tile * 2)) : null;
        const name = found?.name || CLIFF_FILE, index = found?.index || 0;
        const key = `${name}:${index}:${lift}`;
        let packed = cliffIndices.get(key);
        if (packed === undefined) {
          const strip = pillarPicture(heldGm1(gameRoot, name), index, lift)
            || pillarPicture(heldGm1(gameRoot, CLIFF_FILE), 0, lift);
          if (!strip) continue;
          packed = upperPictures.length;
          upperPictures.push(strip);
          cliffIndices.set(key, packed);
        }
        cliffSprites[my * 400 + mx] = packed + 1;
      }
    }
  }
  const treePictures = new Map();
  const organisms = layers.organisms;
  const trees = layers.trees;
  if (organisms?.length === MAP_TILES * 2 && trees) {
    for (let my = 0; my < 400; my++) {
      const [from, to] = rowRange(my);
      for (let mx = from; mx <= to; mx++) {
        const id = organisms.readUInt16LE(tileIndex(mx, my) * 2);
        const tree = id > 0 && id < FIRST_ROCK ? trees[id] : null;
        if (!tree || !tree.alive) continue;
        const pictureNumber = treeViewPicture(tree, layers.flat);
        if (!pictureNumber) continue;
        const file = stock.byGmId.get(tree.gmId);
        if (!file || pictureNumber > file.count) continue;
        const key = `${file.name}/${pictureNumber}/${tree.palette}`;
        let index = treePictures.get(key);
        if (index === undefined) {
          const picture = treePicture(gameRoot, file.name, {...tree,picture:pictureNumber});
          if (!picture) continue;
          index = upperPictures.length;
          upperPictures.push(picture);
          treePictures.set(key, index);
        }
        treeSprites.push([mx, my, index, TREE_DX - tree.originX, TREE_DY - tree.originY]);
      }
    }
  }

  return {
    atlas: `data:image/png;base64,${encodeRgbaPng(breite, hoehe, rgba).toString('base64')}`,
    atlasBreite: breite,
    atlasHoehe: hoehe,
    spalten: ATLAS_SPALTEN,
    kachelBreite: TILE_W,
    kachelHoehe: TILE_H,
    kacheln: reihe.length,
    fehlend,
    upper: packMapPictures(upperPictures, {paged:true}),
    treeSprites,
    cliffSprites: Buffer.from(cliffSprites.buffer).toString('base64'),
    plaetze: Buffer.from(plaetze.buffer).toString('base64')
  };
}

// Der Kachelvorrat einer Karte, samt Hoehen und Startplaetzen - alles, was die
// Ansicht braucht, um die ganze Karte selbst zu malen.
// Die Hoehenschicht aus der Rautenzaehlung in ein volles 400x400-Raster.
function hoehenRaster(heights) {
  const raster = new Uint8Array(400 * 400);
  for (let my = 0; my < 400; my += 1) {
    const [von, bis] = rowRange(my);
    for (let mx = von; mx <= bis; mx += 1) raster[my * 400 + mx] = heights[tileIndex(mx, my)] || 0;
  }
  return raster;
}

// Map keeps are replaced by the editable AIV keep. Work on a copy so cached
// native captures and the source map remain unchanged across camera switches.
// Saved starting compounds face south regardless of the AIV's orientation.
// Relative to the keep: three door tiles, the seven-tile forecourt below it,
// and the five-tile supply area to its right (including stockpile goods).
const KEEP_COMPOUND = [
  { dx: 0, dy: 0, width: 7, height: 7 },
  { dx: 2, dy: 7, width: 3, height: 1 },
  { dx: 0, dy: 8, width: 7, height: 7 },
  { dx: 7, dy: 2, width: 5, height: 5 }
];
function replaceMapKeeps(gfx, keeps, desertValue) {
  if (!keeps.length) return gfx;
  const ground = Buffer.from(gfx);
  for (const keep of keeps) {
    for (const part of KEEP_COMPOUND) {
      for (let dy = 0; dy < part.height; dy++) {
        const y = keep.y + part.dy + dy;
        if (y < 0 || y >= 400) continue;
        const [low, high] = rowRange(y);
        for (let dx = 0; dx < part.width; dx++) {
          const x = keep.x + part.dx + dx;
          if (x >= low && x <= high) ground.writeUInt16LE(desertValue, tileIndex(x, y) * 2);
        }
      }
    }
  }
  return ground;
}

function readMapSource(filePath, gameRoot) {
  const known = knownMap(filePath, gameRoot);
  const root = gameRootOrDefault(gameRoot);
  if (!root) throw new Error('The game folder is not set.');
  const buffer = fs.readFileSync(known.path);
  const preview = readPreview(buffer);
  const directory = findDirectory(buffer, preview.end);
  if (!directory) throw new Error('This map carries no sections.');
  const gfx = readSection(buffer, directory, GFX_SECTION);
  if (!gfx || gfx.length !== MAP_TILES * 2) throw new Error('This map carries no terrain layer (section 1001).');
  let heights = null;
  try { heights = readSection(buffer, directory, HEIGHT_SECTION); } catch { heights = null; }
  let organisms = null, trees = null, pillars = null, random = null;
  try { random = readSection(buffer, directory, 1008); } catch { random = null; }
  try { pillars = readSection(buffer, directory, PILLAR_SECTION); } catch { pillars = null; }
  try {
    organisms = readSection(buffer, directory, ORGANISM_SECTION);
    trees = readTrees(readSection(buffer, directory, TREES_SECTION));
  } catch { organisms = null; trees = null; }
  return { known, root, buffer, directory, gfx, heights, organisms, trees, pillars, random,
    keeps: findKeeps(readSection(buffer, directory, BUILDING_SECTION)) };
}

function flatMapGraphics(source, stock) {
  const rules = require('../../assets/aiv/iso/verzeichnis.json');
  const layer = number => { try { return readSection(source.buffer,source.directory,number); } catch { return null; } };
  const types=layer(1049),ids=layer(1012),records=layer(1013),logic=layer(1003),misc=layer(1007),random=source.random;
  const runtimeTypes=ids?.length===MAP_TILES*2 && records?.length>=BUILDING_STRIDE && records.length%BUILDING_STRIDE===0;
  const result=Buffer.from(source.gfx), flat=stock.files.find(f=>f.name==='tile_flatties');
  if (!flat || (!types && !runtimeTypes) || !logic) return result;
  for(let tile=0;tile<MAP_TILES;tile++) {
    const id=ids?.readUInt16LE(tile*2)||0;
    // renderMap 0x4E98C7 reads Buildings[BuildingLayer[tile]].buildingType.
    // BuildingWasLayer omits keep doors and some scenario decorations, and
    // stores the parent type on linked training grounds.
    const type=runtimeTypes ? (id>0&&(id+1)*BUILDING_STRIDE<=records.length ? records.readUInt16LE(id*BUILDING_STRIDE+BUILDING_TYPE_AT) : 0) : types?.[tile]||0;
    const flags=logic.readUInt32LE(tile*4),rng=random?.readUInt16LE(tile*2)||0;
    let index=null, file=flat;
    if(type>0 && !(flags&0x40000000)) {
      const group=rules.flatViewGroups[type];
      if(group===3) {
        index=(({3:24,7:26,33:28})[type]??30)+Number(!!((misc?.readUInt16LE(tile*2)||0)&4));
      }
      else if(group>=0) index=group*8+(id&1)*4+(rng&3);
    } else if(flags&0x100) {
      if(flags&0x800) {const source=pictureForValue(stock,result.readUInt16LE(tile*2));index=source?.name==='tile_land3'&&[134,136].includes(source.index)?42:40;}
      else if(flags&0x200) index=36+(rng&3);
    } else if(flags&0x80) {
      const picture=pictureForValue(stock,result.readUInt16LE(tile*2));
      const candidate=stock.files.find(f=>f.name===picture?.name);
      index=rules.flatRockPictures[rng&3];
      file=candidate?.count>index?candidate:stock.files.find(f=>f.name==='tile_rocks8');
    }
    if(index!==null && file?.count>index) result.writeUInt16LE(file.from+index+1,tile*2);
  }
  return result;
}

function buildMapTiles(source, nativeLayers = null) {
  const { known, root, buffer, directory, gfx, organisms, trees, pillars, keeps } = source;
  let heights = source.heights;
  if (nativeLayers && nativeRendererInternals.sha(buffer) !== nativeLayers.mapHash)
    throw new Error('The map changed while its native graphics were being generated. Reload the map.');
  if (nativeLayers) {
    // Loading a scenario can reset saved stockpile-platform heights.
    // Compare unchanged ground (1045), then use the game's resulting
    // height layer for drawing and picking, rather than the saved platforms.
    const baseHeights = readSection(buffer, directory, 1045);
    if (!baseHeights || !baseHeights.equals(nativeLayers.baseHeights))
      throw new Error('The game renderer returned ground heights from a different map.');
    heights = nativeLayers.heights;
  }
  // Resolve the desert tile through the executable's GM table, not a global
  // sprite number. tile_land8 picture 0 is a plain desert diamond.
  const stock = nativeLayers ? installedPictureStock(root, false) : savedPictureStock(root, gfx, {
    logic:readSection(buffer,directory,1003), misc:readSection(buffer,directory,1007), logic2:readSection(buffer,directory,1037)
  });
  const desert = stock.files.find(file => file.name === 'tile_land8' && file.count);
  if (keeps.length && !desert) throw new Error('The game desert terrain graphics are missing.');
  const groundOnly = layer => replaceMapKeeps(layer, keeps, (desert?.from || 0) + 1);
  const heightRaster = heights ? Buffer.from(hoehenRaster(heights)).toString('base64') : null;
  const cameras = nativeLayers?.cameras.map(layer => ({
    ...buildTileAtlas(groundOnly(layer.gfx), root, { stock, organisms, trees, pillars: layer.pillars, heights: nativeLayers.heights }),
    hoehen: heightRaster
  }));
  const vorrat = cameras?.[0] || buildTileAtlas(groundOnly(gfx), root, { stock, organisms, trees, pillars, heights });
  const flatFor = layer => buildTileAtlas(flatMapGraphics({...source,gfx:layer},stock),root,{stock,flat:true,organisms,trees});
  const flatCameras = nativeLayers?.cameras.map(layer=>flatFor(layer.gfx));
  const flat = flatCameras?.[0] || flatFor(gfx);
  const savedCamera=readSection(buffer,directory,1044);
  const orientation=savedCamera?.length===4 ? savedCamera.readUInt32LE(0) : 0;
  const flatRandom = Buffer.alloc(400*400*2);
  if (source.random?.length === MAP_TILES*2) for(let y=0;y<400;y++) {
    const [low,high]=rowRange(y),start=tileIndex(low,y)*2;
    source.random.copy(flatRandom,(y*400+low)*2,start,start+(high-low+1)*2);
  }
  return {
    name: known.name,
    path: known.path,
    pictureLayout: stock.layout,
    ...vorrat,
    flat,
    ...(flatCameras ? {flatCameras} : {}),
    savedOrientation:[0,2,4,6].includes(orientation)?orientation:0,
    flatRandom: flatRandom.toString('base64'),
    ...(cameras ? { cameras, nativeRenderer: true } : {}),
    // Hoehen in derselben Zaehlung wie die Plaetze: volles 400x400-Raster.
    hoehen: heightRaster
  };
}

function readMapTiles(filePath, gameRoot, nativeLayers = null) {
  const source = readMapSource(filePath, gameRoot);
  selectGraphics(source.root);
  return buildMapTiles(source, nativeLayers);
}

// Validate/parse once, then materialize exactly the representation that is used.
async function resolveNativeMapTiles(source, loadNative, build = buildMapTiles) {
  try {
    return build(source, await loadNative());
  } catch (error) {
    return { ...build(source), nativeError: error.message };
  }
}

let atlasAssetRevision = null;
function selectGraphics(root) {
  const graphics = resolveGameGraphics(root);
  if (activeGraphics?.revision !== graphics.revision || activeGraphics?.root !== graphics.root) gm1Held.clear();
  activeGraphics = graphics;
  return graphics;
}
async function readNativeMapTiles(filePath, gameRoot, cacheRoot) {
  const source = readMapSource(filePath, gameRoot);
  const graphics = selectGraphics(source.root);
  return resolveNativeMapTiles(source, () => readCachedNativeMap({
    gameRoot, mapPath: source.known.path, cacheRoot
  }), (parsed, layers) => {
    // Native provenance includes the game executable, helper and GM assets.
    // Never let a cache bypass map/capture validation or store fallback output.
    if (!layers?.sourceHash || nativeRendererInternals.sha(parsed.buffer) !== layers.mapHash)
      return buildMapTiles(parsed, layers);
    const revision = parsed.root + ':' + layers.sourceHash;
    if (atlasAssetRevision !== revision) {
      pictureStockHeld = null;
      gm1Held.clear();
      atlasAssetRevision = revision;
    }
    const layerHash = nativeRendererInternals.sha(Buffer.concat([
      layers.heights, layers.baseHeights, ...layers.cameras.flatMap(camera => [camera.gfx, camera.pillars])
    ]));
    return cachedAtlas(cacheRoot, ['flat-view-7', parsed.root, parsed.known.path, layers.mapHash, layers.sourceHash, layerHash, graphics.revision],
      () => buildMapTiles(parsed, layers));
  });
}


module.exports = {
  listGameMaps,
  readGameMap,
  readMapTiles,
  readNativeMapTiles,
  // fuer die Tests und fuer Werkzeuge, die eine Karte ohne Electron lesen
  internals: { readMapSource, buildMapTiles, flatMapGraphics, resolveNativeMapTiles, replaceMapKeeps, pathTileFlags, readPreview, previewPng, findDirectory, readSection, findKeeps, nameKeeps, keepOrientation,
               rowBase, rowRange, tileIndex,
               readPictureStock, pictureForValue, choosePictureStock, pictureStock, readGm1, tgxToRgba, virtualToFile,
               readTrees, cactusPicture, treeViewPicture, TREE_STRIDE, FIRST_ROCK,
               buildTileAtlas, diamondToRgba, upperTilePicture, packMapPictures, heldGm1, ATLAS_SPALTEN,
               PREVIEW_EDGE, MAP_TILES, BUILDING_SECTION, BUILDINGS_SECTION, STONE_KEEP, KEEP_EDGE,
               TILE_W, TILE_H, GFX_SECTION, ORGANISM_SECTION, TREES_SECTION,
               HEIGHT_SECTION, PILLAR_SECTION, PILLAR_TOP, PILLAR_HEAD, CLIFF_FILE, MAX_LIFT }
};
