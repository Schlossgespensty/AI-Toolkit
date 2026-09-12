// 2.5D view — the castle drawn the way the game draws it.
//
// Opened from the Castle tab. It is not a second editor: every click is
// turned into a tile and handed to the castle editor, which then does what
// its current tool says. Single, Line, Brush, Select/Move, Copy and Delete
// therefore work exactly as on the top-down map, including undo, previews
// and build steps - there is no second set of rules to keep in step.
//
// The view can live in one of two hosts: the panel inside the castle column
// (#castleIsoWindow) or a window of its own. Only ever one of them, and both
// share this one set of drawing routines - the surface changes, the picture
// does not. Which host is in use is panel-view.js's decision, not this file's.
//
// All the arithmetic lives in iso-geometry.js and is tested without a
// screen (tests/iso-view.test.js).

(() => {
  'use strict';

  const geo = (typeof globalThis !== 'undefined' && globalThis.isoGeometry) || null;
  const CATALOGUE_PATH = '../assets/aiv/iso/verzeichnis.json';
  const SPRITE_PATH = '../assets/aiv/iso/';
  const MAX_RENDER_DPR = 1.5;

  const state = {
    catalogue: null,
    images: new Map(),
    view: { zoom: 1, panX: 0, panY: 0 },
    fitted: false,
    // { kind: 'dock' | 'window', win, box, canvas, statusEl }
    host: null,
    // Counts up on every attempt to take a host. Both attempts wait for the
    // catalogue first, so two clicks in quick succession can both be in the
    // air; without this the slower one would finish last and overwrite the
    // newer host - leaving, in the worst case, a window nobody holds any
    // more: it cannot be closed, it never reports itself closed, and the
    // button no longer belongs to it.
    mountToken: 0,
    observer: null,
    bound: new WeakSet(),
    paintPending: false,
    panning: false,
    panStart: null,
    drawing: false,
    hover: null,
    controls: null
  };

  // ---------------------------------------------------------- sprites

  async function loadCatalogue() {
    if (state.catalogue) return state.catalogue;
    try {
      const response = await fetch(CATALOGUE_PATH);
      if (!response.ok) throw new Error(String(response.status));
      state.catalogue = await response.json();
    } catch {
      state.catalogue = { gegenstaende: {} };
    }
    return state.catalogue;
  }

  function image(filename) {
    if (!filename) return null;
    let img = state.images.get(filename);
    if (img) return img;
    img = new Image();
    img.onload = () => refresh();
    img.onerror = () => onImageFailed(filename);
    // A ground the user picked arrives as a whole data: URL, not as the name
    // of a file next to the sprites. Prefixing the sprite path to it would
    // make an address that leads nowhere - and nothing would appear.
    img.src = /^(data:|blob:|https?:|file:)/.test(filename) ? filename : SPRITE_PATH + filename;
    state.images.set(filename, img);
    return img;
  }

  // ---------------------------------------------------------- drawing

  function currentDocument() {
    const editor = window.castleEditor;
    return (editor && editor.hasDocument && editor.hasDocument()) ? editor.getDocument() : null;
  }

  // The ground under the castle: a terrain picture from the game, repeated
  // rather than stretched and scaled with the zoom, so that one tile in the
  // picture is one tile in the editor. The game's tile is 30 points wide and
  // ours is HALF_W*2 = 32, hence the factor. Asked for by Monsterfish; Daniel
  // added the condition that the scale has to match.
  //
  // The path handed in is the map diamond, so the ground stops at the map edge
  // and everything outside stays dark. If the picture is not there or the
  // browser will not make a pattern from it, the old flat colour is used - the
  // view must never depend on a decoration.
  const GAME_TILE_WIDTH = 30;
  const GROUND_KEY = 'castleIsoGround';        // remembered between sessions
  const GROUND_FIT_KEY = 'castleIsoGroundFit'; // 'tile' or 'stretch'

  // Which picture the ground is made of. Empty means the one that ships with
  // the app; anything else is a file the user picked.
  function groundSource() {
    if (state.ground === undefined) {
      let stored = null;
      try { stored = window.localStorage.getItem(GROUND_KEY); } catch { stored = null; }
      state.ground = stored || null;
    }
    return state.ground || 'grund.png';
  }

  // Laid out tile by tile, or spread once over the whole map? A texture wants
  // the first, a picture of a finished map the second. The app's own ground is
  // a texture and is always tiled.
  function groundFit() {
    if (state.groundFit === undefined) {
      let stored = null;
      try { stored = window.localStorage.getItem(GROUND_FIT_KEY); } catch { stored = null; }
      state.groundFit = stored === 'stretch' ? 'stretch' : 'tile';
    }
    return state.ground ? state.groundFit : 'tile';
  }

  function setGround(url) {
    state.ground = url || null;
    try {
      if (url) window.localStorage.setItem(GROUND_KEY, url);
      else window.localStorage.removeItem(GROUND_KEY);
    } catch { /* a view must not fall over because storage is off */ }
    state.images.delete(groundSource());
    // Only ever one ground: a picture of your own puts a map of the game away.
    if (url && gameMap()) { state.gameMap = null; rememberGameMap(); }
    // Und mit der Karte auch ihr Gelaende: das Bild ist entpackt rund 19 MB,
    // und ohne Karte kommt es nie wieder zum Vorschein.
    if (url && state.terrain) { state.images.delete(state.terrain.dataUrl); state.terrain = null; }
    paint();
  }

  function setGroundFit(fit) {
    state.groundFit = fit === 'stretch' ? 'stretch' : 'tile';
    try { window.localStorage.setItem(GROUND_FIT_KEY, state.groundFit); } catch { /* egal */ }
    paint();
  }

  // A picture that will not load must not leave an empty map behind. If it was
  // the ground the user picked, we fall back to the one that comes with the
  // app and forget the broken choice - otherwise it would greet him again
  // after every restart.
  function onImageFailed(filename) {
    if (state.ground && filename === state.ground) {
      setGround(null);
      return;
    }
    const map = state.gameMap;
    if (map && filename === map.dataUrl) {
      setGameMap(null);
      return;
    }
    // Ein kaputtes Gelaendebild kostet nur das Gelaende: die Vorschau liegt
    // noch da, und der Grund bleibt sichtbar.
    if (state.terrain && filename === state.terrain.dataUrl) {
      setTerrain(null);
      return;
    }
    refresh();
  }

  function hasOwnGround() { return Boolean(state.ground); }
  function groundIsStretched() { return groundFit() === 'stretch'; }

  // ------------------------------------------------- a map of the game
  //
  // A .map brings its own 200x200 preview. Laid under the view it is not a
  // decoration but a measure: one field of the map is one field of the editor.
  // Where it goes is geo.mapPreviewRect's business - it needs the starting
  // place, because that is the only thing that says WHERE on the map the
  // village of 100x100 stands.
  //
  // Only ever one ground: choosing a map puts an own ground away and the other
  // way round. Two pictures on the same floor would hide each other, and no
  // one could tell which of them is to scale.
  const MAP_KEY = 'castleIsoGameMap';
  const MAP_MODE_KEY = 'castleIsoMapMode';   // 'preview' or 'terrain'

  // Das echte Gelaende wird NICHT gemerkt. Es ist rund 3 MB als PNG, also gut
  // 4 MB als data:-Adresse - localStorage haelt ueblicherweise 5 MB fuer alles
  // zusammen, und die Karte laege danach nirgends mehr. Gemerkt wird nur, DASS
  // der Nutzer das Gelaende sehen will; geholt wird es beim naechsten Start neu.
  function mapMode() {
    if (state.mapMode === undefined) {
      let stored = null;
      try { stored = window.localStorage.getItem(MAP_MODE_KEY); } catch { stored = null; }
      state.mapMode = stored === 'terrain' ? 'terrain' : 'preview';
    }
    return state.mapMode;
  }

  function setMapMode(mode) {
    state.mapMode = mode === 'terrain' ? 'terrain' : 'preview';
    try { window.localStorage.setItem(MAP_MODE_KEY, state.mapMode); } catch { /* a view must not fall over because storage is off */ }
    paint();
  }

  // Welches Gelaende die Ansicht gerade braucht: eine Karte und ein Startplatz.
  // Wechselt eines von beidem, passt das gehaltene Bild nicht mehr, und die
  // Ansicht faellt auf die Vorschau zurueck, bis das neue da ist.
  function terrainKey() {
    const map = gameMap();
    if (!map || !map.path) return null;
    const keep = currentKeep();
    return keep ? `${map.path}#${keep.x},${keep.y}` : null;
  }

  // Das Gelaende bringt seine Hoehen mit: ein Byte je Dorffeld, als Text
  // verpackt, weil ein Byte-Feld nicht durch den Kanal passt. Ohne sie stuende
  // die Burg flach auf einem Gelaende, das Berge hat.
  function dorfHoehen(text) {
    if (typeof text !== 'string' || !text) return null;
    try {
      const roh = typeof atob === 'function' ? atob(text) : null;
      if (!roh || roh.length !== geo.GRID * geo.GRID) return null;
      const feld = new Uint8Array(roh.length);
      for (let i = 0; i < roh.length; i += 1) feld[i] = roh.charCodeAt(i);
      return feld;
    } catch { return null; }
  }

  function setTerrain(terrain) {
    if (state.terrain) state.images.delete(state.terrain.dataUrl);
    state.terrain = terrain && terrain.dataUrl
      ? { key: terrain.key, dataUrl: terrain.dataUrl,
          px0: Number(terrain.px0) || 0, py0: Number(terrain.py0) || 0,
          cells: Number(terrain.cells) || geo.MAP_PREVIEW_EDGE,
          top: Number(terrain.top) || 0,
          floor: Number(terrain.floor) || 0,
          village: dorfHoehen(terrain.village) }
      : null;
    paint();
  }

  // Wie hoch der Boden unter einem Dorffeld liegt, in Bildpunkten. Null,
  // solange kein echtes Gelaende liegt: die Vorschau ist ein flaches Bild, und
  // eine Burg ueber einem flachen Boden schweben zu lassen waere schlimmer als
  // sie flach zu lassen.
  function bodenHoehe(gx, gy) {
    // The full-map atlas takes precedence over paintGround. It already lifts
    // terrain tiles; sprites and picking must use those same heights, not the
    // previous cropped image's height buffer (or zero on first load).
    const atlas = vorrat();
    if (atlas?.plaetze && atlas.bild?.complete && atlas.bild?.naturalWidth && gameMap()) {
      return geo.mapTileHeight(gx, gy, currentKeep(), atlas.hoehen);
    }
    const feld = state.hoehenFeld;
    if (!feld) return 0;
    if (gx < 0 || gy < 0 || gx >= geo.GRID || gy >= geo.GRID) return 0;
    return feld[gy * geo.GRID + gx] || 0;
  }

  function terrainReady() {
    const wanted = terrainKey();
    return Boolean(wanted && state.terrain && state.terrain.key === wanted);
  }

  function gameMap() {
    if (state.gameMap === undefined) {
      let stored = null;
      try { stored = window.localStorage.getItem(MAP_KEY); } catch { stored = null; }
      try { state.gameMap = stored ? JSON.parse(stored) : null; } catch { state.gameMap = null; }
    }
    return state.gameMap;
  }

  function rememberGameMap() {
    try {
      if (state.gameMap) window.localStorage.setItem(MAP_KEY, JSON.stringify(state.gameMap));
      else window.localStorage.removeItem(MAP_KEY);
    } catch { /* a view must not fall over because storage is off */ }
  }

  function setGameMap(map) {
    const previous = gameMap();
    if (previous) state.images.delete(previous.dataUrl);
    state.gameMap = map
      ? { name: map.name, path: map.path || null, dataUrl: map.dataUrl,
          keeps: Array.isArray(map.keeps) ? map.keeps : [], keepIndex: 0 }
      : null;
    // Das Gelaende der alten Karte zeigt die alte Karte. Es jetzt stehen zu
    // lassen hiesse, die neue Karte mit fremdem Boden zu zeigen.
    setTerrain(null);
    rememberGameMap();
    if (state.gameMap && state.ground) setGround(null);   // paints as well
    else paint();
  }

  function setGameMapKeep(index) {
    const map = gameMap();
    if (!map || !map.keeps.length) return;
    map.keepIndex = Math.max(0, Math.min(map.keeps.length - 1, Number(index) || 0));
    rememberGameMap();
    paint();
  }

  function hasGameMap() { return Boolean(gameMap()); }
  function gameMapInfo() {
    const map = gameMap();
    if (!map) return null;
    const keep = currentKeep();
    return { name: map.name, path: map.path || null, keeps: map.keeps, keepIndex: map.keepIndex,
             keep, mode: mapMode(), terrainKey: terrainKey(), terrainReady: terrainReady() };
  }

  // Which starting place the village is built on. Without one the village goes
  // into the middle of the map - the picture still fits, only the place is a
  // guess, and the toolbar says so.
  function currentKeep() {
    const map = gameMap();
    if (!map) return null;
    const keep = map.keeps[map.keepIndex] || geo.centreKeep();
    // Eine Karte, die noch aus einer aelteren Sitzung im Speicher liegt, kennt
    // die Drehung nicht. Sie haengt aber nur an x und y, also wird sie hier
    // nachgerechnet statt die Karte kommentarlos ungedreht zu zeigen.
    if (keep.orientation === undefined) {
      return { ...keep, orientation: geo.keepOrientation(keep.x, keep.y) };
    }
    return keep;
  }

  // Wie stark die Burg auf DIESEM Startplatz gedreht wird. Ohne Karte gar
  // nicht - dann ist die Ansicht der reine Bauplan.
  // Die Ansicht laesst sich von Hand drehen: C eine Vierteldrehung nach links,
  // X nach rechts. Gezaehlt wird in Spielwerten (0/2/4/6), damit dieselbe
  // Zahl herauskommt, die auch ein Startplatz mitbringt. Der Standard ist 0 -
  // die Burg steht so da, wie sie in der Datei liegt, Hof nach vorn.
  //
  // WAS DABEI NICHT MITGEHT: unser Bildvorrat kennt fuer die meisten Gebaeude
  // nur eine Blickrichtung (gemessen an 128 mitgelieferten .aiv: 54,8 Prozent
  // der gesetzten Felder). Lage, Reihenfolge und Hoehe drehen mit, das
  // einzelne Gebaeudebild nicht.
  const VIERTEL = 2;
  let handDrehung = 0;

  function viewRotation() { return handDrehung; }

  function turnView(richtung) {
    const schritt = Number(richtung) < 0 ? -VIERTEL : VIERTEL;
    handDrehung = (((handDrehung + schritt) % 8) + 8) % 8;
    paint();
    return handDrehung;
  }

  function currentRotation() {
    const keep = currentKeep();
    const vonDerKarte = keep ? (Number(keep.orientation) || 0) : 0;
    return (vonDerKarte + handDrehung) % 8;
  }

  // Ein Feld des Bauplans an seinen gedrehten Platz - und zurueck, wenn die
  // Maus fragt, welches Feld sie gerade trifft.
  function turnedTiles(list) {
    const rotation = currentRotation();
    if (!rotation) return list;
    return list.map(item => {
      const turned = geo.rotateGrid(item.gx, item.gy, item.tiles, rotation);
      return { ...item, gx: turned.gx, gy: turned.gy };
    });
  }

  function editorTileAt(px, py) {
    const grid = geo.tileFromPoint(px, py, state.view, bodenHoehe);
    if (!grid) return null;
    const back = geo.unrotateGrid(grid.gx, grid.gy, currentRotation());
    return { x: back.gx, y: geo.GRID - 1 - back.gy };
  }

  // Wo der Zeiger zuletzt war - fuer das Loslassen ausserhalb der Karte.
  // state.hover steht im BILD, nicht im Bauplan, muss also zurueckgedreht
  // werden wie ein frischer Klick.
  function lastHoverTile() {
    if (!state.hover) return null;
    const back = geo.unrotateGrid(state.hover.gx, state.hover.gy, currentRotation());
    return { x: back.gx, y: geo.GRID - 1 - back.gy };
  }

  // Was gerade unter der Burg liegt. Das echte Gelaende nur, wenn es gewaehlt
  // UND fertig geladen ist - sonst die Vorschau. So bleibt der Grund nie leer:
  // das Gelaende braucht eine halbe Sekunde, die Vorschau ist sofort da.
  function groundPicture() {
    const map = gameMap();
    if (!map) return null;
    if (mapMode() === 'terrain' && terrainReady()) {
      const terrain = state.terrain;
      const img = image(terrain.dataUrl);
      if (img && img.complete && img.naturalWidth) {
        return { img, px0: terrain.px0, py0: terrain.py0, cells: terrain.cells,
                 top: terrain.top, floor: terrain.floor, hoehen: terrain.village, smooth: true };
      }
    }
    const img = image(map.dataUrl);
    if (!img || !img.complete || !img.naturalWidth) return null;
    return { img, px0: 0, py0: 0, cells: geo.MAP_PREVIEW_EDGE, top: 0, floor: 0, hoehen: null, smooth: false };
  }

  function paintGameMap(ctx, picture) {
    if (!picture) return;
    // Beide Bilder sind Ausschnitte desselben Rasters, nur verschieden fein
    // gemalt - dieselbe Rechnung legt sie an dieselbe Stelle.
    const rect = geo.mapImageRect(currentKeep(), state.view, picture.px0, picture.py0, picture.cells, picture.top);
    ctx.save();
    // Beschnitten wird auf die Raute des Dorfes - aber der Boden liegt nicht
    // mehr in ihrer Ebene. Er steht zwischen dem tiefsten Feld (floor) und dem
    // hoechsten (top) darueber, und der Beschnitt muss genau diesen Streifen
    // freigeben: oben, sonst saegt er jede Bergkuppe waagerecht ab; unten,
    // sonst bleibt am Suedrand ein dunkler Saum, weil der Boden dort um seine
    // Grundhoehe hochgerueckt ist. Aus der Raute wird damit ein Sechseck.
    if (picture.top > 0) {
      const oben = picture.top * state.view.zoom;
      const unten = (picture.floor || 0) * state.view.zoom;
      const punkt = (cx, cy, hoch) => {
        const [px, py] = geo.isoPoint(cx, cy, state.view);
        return [px, py - (hoch ? oben : unten)];
      };
      ctx.beginPath();
      [punkt(0, 0, true), punkt(geo.GRID, 0, true), punkt(geo.GRID, 0, false),
       punkt(geo.GRID, geo.GRID, false), punkt(0, geo.GRID, false), punkt(0, geo.GRID, true)]
        .forEach(([px, py], index) => { if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.closePath();
    }
    ctx.clip();
    // Ein Vorschaupunkt ist ein ganzes Feld und muss ein hartes Quadrat bleiben
    // - geglaettet schmierte der Rand eines Feldes ueber seinen Nachbarn. Das
    // Gelaende ist ein echtes Bild aus Kacheln des Spiels und wird geglaettet,
    // sonst franst es beim Verkleinern aus.
    ctx.imageSmoothingEnabled = picture.smooth;
    ctx.drawImage(picture.img, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  // ------------------------------------- die ganze Karte aus dem Kachelvorrat
  //
  // Statt eines fertigen Bildes vom Dorffenster bekommt die Ansicht das, was
  // auch das Spiel im Speicher haelt: einen Vorrat aller Kacheln dieser Karte
  // und je Feld die Nummer seiner Kachel. Gemalt wird beim Zeichnen, und nur
  // was im Fenster liegt - so wie renderMap (0x004e8cf0) es tut. Deshalb
  // laesst sich die GANZE Karte in voller Aufloesung zeigen, ohne dass je ein
  // Bild von 12000x6400 Punkten entsteht.
  const KARTE_FELDER = 400;

  function vorrat() { return state.kachelVorrat || null; }

  // Base64 in ein Zahlenfeld. Die Bruecke kann keine Binaerdaten, deshalb
  // kommen Plaetze und Hoehen als Text.
  function ausBase64(text, Art) {
    if (!text) return null;
    const roh = atob(text);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
    return new Art(bytes.buffer);
  }

  function setMapTiles(daten) {
    if (!daten) { state.kachelVorrat = null; paint(); return; }
    const bild = new Image();
    bild.onload = () => paint();
    bild.src = daten.atlas;
    state.kachelVorrat = {
      bild,
      plaetze: ausBase64(daten.plaetze, Uint16Array),
      hoehen: daten.hoehen ? ausBase64(daten.hoehen, Uint8Array) : null,
      spalten: Number(daten.spalten) || 64,
      kw: Number(daten.kachelBreite) || 30,
      kh: Number(daten.kachelHoehe) || 16,
      name: daten.name || ''
    };
    paint();
  }

  function hasMapTiles() { return Boolean(vorrat() && vorrat().plaetze); }

  // Feldnummer in der Karte. Die Plaetze kommen als volles 400x400-Raster
  // herueber, deshalb reicht eine Multiplikation - die Rautenzaehlung der
  // Datei bleibt drueben, wo ihre Formel steht. Am 09.09.2026 hatte ich sie
  // hier nachgebaut und dabei geraten; die Karte kam in Streifen heraus.
  function kartenFeld(mx, my) {
    if (mx < 0 || my < 0 || mx >= KARTE_FELDER || my >= KARTE_FELDER) return -1;
    return my * KARTE_FELDER + mx;
  }

  // Ein Kartenfeld in Dorfkoordinaten - dieselbe Verschiebung, mit der auch
  // das Gelaendebild aufgelegt wird (geo.mapTileForGrid, rueckwaerts).
  function dorfAus(mx, my, keep, anker) {
    return { gx: mx - keep.x + anker.gx, gy: my - keep.y + anker.gy };
  }

  function paintMapTiles(ctx, width, height) {
    const v = vorrat();
    const map = gameMap();
    const keep = currentKeep();
    if (!v || !v.plaetze || !map || !keep || !v.bild.complete || !v.bild.naturalWidth) return false;
    const anker = geo.keepAnchor(keep);
    const hw = 16 * state.view.zoom, hh = 8 * state.view.zoom;

    // Welche Felder liegen im Fenster? Aus den vier Ecken zurueckgerechnet,
    // statt alle 160.000 zu pruefen.
    const ecken = [[0, 0], [width, 0], [0, height], [width, height]].map(([px, py]) => {
      const dx = (px - state.view.panX) / hw, dy = (py - state.view.panY) / hh;
      return { gx: (dy + dx) / 2, gy: (dy - dx) / 2 };
    });
    const rand = 3 + Math.ceil(255 / (16 * state.view.zoom));   // hohe Felder ragen herein
    const gx0 = Math.floor(Math.min(...ecken.map(e => e.gx))) - rand;
    const gx1 = Math.ceil(Math.max(...ecken.map(e => e.gx))) + rand;
    const gy0 = Math.floor(Math.min(...ecken.map(e => e.gy))) - rand;
    const gy1 = Math.ceil(Math.max(...ecken.map(e => e.gy))) + rand;

    const kw = v.kw, kh = v.kh;
    let gemalt = 0;
    // Von hinten nach vorn: kleineres gx+gy zuerst, sonst deckt das hintere
    // Feld das vordere zu.
    for (let summe = gx0 + gy0; summe <= gx1 + gy1; summe += 1) {
      for (let gx = Math.max(gx0, summe - gy1); gx <= Math.min(gx1, summe - gy0); gx += 1) {
        const gy = summe - gx;
        const mx = gx + keep.x - anker.gx;
        const my = gy + keep.y - anker.gy;
        const feld = kartenFeld(mx, my);
        if (feld < 0) continue;
        const platz = v.plaetze[feld];
        if (platz === 0xffff) continue;
        const hebung = (v.hoehen ? v.hoehen[feld] : 0) * state.view.zoom;
        const [px, py] = geo.isoPoint(gx, gy, state.view, 0);
        ctx.drawImage(v.bild,
          (platz % v.spalten) * kw, Math.floor(platz / v.spalten) * kh, kw, kh,
          px - hw, py - hebung, 2 * hw, 2 * hh);
        gemalt += 1;
      }
    }
    state.letzteKacheln = gemalt;
    return gemalt > 0;
  }

  function paintGround(ctx, width, height) {
    if (gameMap()) {
      ctx.save();
      ctx.fillStyle = '#232a1c';
      ctx.fill();
      ctx.restore();
      // Was jetzt unter der Burg liegt, bestimmt auch, wie hoch sie steht:
      // beide holen ihre Zahl aus derselben Quelle, also koennen sie nicht
      // auseinanderlaufen.
      const picture = groundPicture();
      state.hoehenFeld = picture ? picture.hoehen : null;
      paintGameMap(ctx, picture);
      return;
    }
    state.hoehenFeld = null;
    const img = image(groundSource());
    let pattern = null;
    if (img && img.complete && img.naturalWidth) {
      try { pattern = ctx.createPattern(img, 'repeat'); } catch { pattern = null; }
    }
    // Immer erst die Farbe: solange ein Bild noch laedt oder gescheitert ist,
    // bleibt die Karte sonst durchsichtig, und man sieht durch sie hindurch.
    ctx.save();
    ctx.fillStyle = '#232a1c';
    ctx.fill();
    ctx.restore();
    if (!pattern) return;

    // Spread once: the picture covers exactly the box around the map diamond,
    // so its corners land on the map's corners.
    if (groundFit() === 'stretch') {
      const links = geo.isoPoint(0, geo.GRID, state.view)[0];
      const rechts = geo.isoPoint(geo.GRID, 0, state.view)[0];
      const oben = geo.isoPoint(0, 0, state.view)[1];
      const unten = geo.isoPoint(geo.GRID, geo.GRID, state.view)[1];
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, links, oben, rechts - links, unten - oben);
      ctx.restore();
      return;
    }

    const scale = geo.groundTextureScale(state.view.zoom, GAME_TILE_WIDTH, 16);
    ctx.save();
    ctx.clip();
    ctx.translate(state.view.panX, state.view.panY);
    ctx.scale(scale.x, scale.y);
    ctx.fillStyle = pattern;
    ctx.fillRect(-state.view.panX / scale.x, -state.view.panY / scale.y,
                 width / scale.x, height / scale.y);
    ctx.restore();
  }

  // Ein Bauwerk haengt an seiner vorderen Ecke - also gilt die Hoehe DIESES
  // Feldes. Das Spiel laesst auf einer Kante ohnehin nicht bauen, innerhalb
  // eines Bauwerks ist der Boden also eben.
  function bauHoehe(gx, gy, tiles) {
    return bodenHoehe(gx + (tiles || 1) - 1, gy + (tiles || 1) - 1);
  }

  function drawSprite(ctx, sprite, gx, gy, tiles, mauerAn, hoeheAn) {
    const variant = geo.variantFor(sprite, gx, gy, mauerAn, hoeheAn);
    const img = image(variant.bild);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const rect = geo.spriteRect(variant, gx, gy, tiles, state.view, bauHoehe(gx, gy, tiles));
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    return true;
  }

  function drawDiamond(ctx, gx, gy, tiles, fill, stroke) {
    const hebung = bauHoehe(gx, gy, tiles);
    ctx.beginPath();
    [[gx, gy], [gx + tiles, gy], [gx + tiles, gy + tiles], [gx, gy + tiles]]
      .forEach(([cx, cy], index) => {
        const [px, py] = geo.isoPoint(cx, cy, state.view, hebung);
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function hostIsGone() {
    const host = state.host;
    if (!host) return true;
    return host.kind === 'window' && (!host.win || host.win.closed);
  }

  // The size comes from the box, never from the canvas: a canvas can push a
  // flex or grid track wider but never let it shrink again, so measuring it
  // would make a docked panel grow on every frame and never come back.
  // Returns null while the box has no size at all - which happens whenever
  // the Castle tab is hidden, and would otherwise refit the view to 0 by 0.
  function surface() {
    const host = state.host;
    if (!host || !host.canvas || !host.box) return null;
    const rect = host.box.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) return null;
    const win = host.win || window;
    const dpr = Math.min(MAX_RENDER_DPR, Math.max(1, win.devicePixelRatio || 1));
    const canvas = host.canvas;
    const bufferWidth = Math.floor(width * dpr);
    const bufferHeight = Math.floor(height * dpr);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    const ctx = canvas.getContext('2d');
    // setting width resets the transform, so this is redone every time
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, ctx };
  }

  function paint() {
    state.paintPending = false;
    if (!geo || hostIsGone()) return;
    const target = surface();
    if (!target) return;
    const { width, height, ctx } = target;

    if (!state.fitted) { state.view = geo.fitView(width, height); state.fitted = true; }
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = state.view.zoom < 1;

    ctx.beginPath();
    [[0, 0], [geo.GRID, 0], [geo.GRID, geo.GRID], [0, geo.GRID]].forEach(([cx, cy], index) => {
      const [px, py] = geo.isoPoint(cx, cy, state.view);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    // Der Kachelvorrat zeigt die GANZE Karte und geht deshalb vor.
    if (!paintMapTiles(ctx, width, height)) paintGround(ctx, width, height);

    // Die Bodenplatten haengen an der GEDREHTEN Ecke ihres Gebaeudes, und ihr
    // eigener Versatz wird NICHT mitgedreht.
    //
    // GEMESSEN am 07.09.2026 an 201 Startplaetzen aus 60 Karten: bei 194 von
    // ihnen liegt der Lagerplatz (Bautyp 10) genau 7 Felder rechts und 2
    // Felder unter der Ecke des Bergfrieds - bei Drehung 0, 2, 4 und 6
    // gleichermassen. Der Startaufbau auf der Karte dreht sich also nicht mit;
    // das Spiel setzt ihn immer gleich hin. Genau diese 7/2 stehen auch im
    // Katalog. Wer die Platten mitdreht, schiebt den Lagerplatz von der Karte.
    const gerade = geo.collectItems(currentDocument(), state.catalogue);
    const items = turnedTiles(gerade);
    const plates = geo.collectPlates(items);
    for (const plate of plates.sort(geo.byDepth))
      drawSprite(ctx, plate.sprite, plate.gx, plate.gy, plate.tiles);

    // Welche Felder Mauer tragen. Ein Mauerfeld waehlt sein Bild nach seinen
    // Nachbarn - laeuft die Mauer durch, wird sie eine durchgehende Flaeche
    // statt einer Reihe von Pfeilern (siehe geo.variantFor).
    const mauerAn = geo.wallLookup(items);
    state.mauerAn = mauerAn;
    // Und wie hoch jedes Feld ist. Eine Treppe waehlt ihre Ansicht danach,
    // auf welcher Seite der hoehere Nachbar liegt - Mauer wie Treppe zaehlen
    // beide, genau wie im Spiel (siehe geo.variantFor).
    const hoeheAn = geo.hoehenLookup(items);
    state.hoeheAn = hoeheAn;

    let missing = 0;
    for (const item of items.sort(geo.byDepth)) {
      // Farms reserve a much larger field than their 3x3 building sprite.
      // Keep the complete placement area visible without inventing crop state.
      if (item.entry?.fieldFootprint) drawDiamond(ctx, item.gx, item.gy, item.tiles, 'rgba(248,248,192,.12)', 'rgba(248,248,192,.55)');
      if (item.entry && drawSprite(ctx, item.entry, item.gx, item.gy, item.tiles, mauerAn, hoeheAn)) continue;
      drawDiamond(ctx, item.gx, item.gy, item.tiles, 'rgba(210,170,90,.55)');
      missing++;
    }

    // where the mouse is
    if (state.hover) drawDiamond(ctx, state.hover.gx, state.hover.gy, 1, null, 'rgba(255,255,255,.5)');

    drawAnalysis(ctx);
    drawSelection(ctx, items);
    drawPreview(ctx);
    drawMarquee(ctx);

    const editor = window.castleEditor;
    const tool = editor && editor.getTool ? editor.getTool() : '—';
    setStatus(items.length + ' items' + (missing ? ', ' + missing + ' without a sprite' : '') +
              ' · tool: ' + tool + mapStatus() + ' · middle mouse pans, wheel zooms');
  }

  function drawAnalysis(ctx) {
    const overlay = window.castleEditor?.getAnalysisOverlay?.();
    if (!overlay) return;
    const turn = tile => geo.rotateGrid(tile.x, 99 - tile.y, 1, currentRotation());
    ctx.save();
    const cells = new Set(overlay.heat.map(c => `${c.x},${c.y}`));
    for (const c of overlay.heat) {
      const p = turn(c);
      const boundary = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !cells.has(`${c.x+dx},${c.y+dy}`));
      drawDiamond(ctx, p.gx, p.gy, 1, `rgba(255,112,16,${0.035 + .34 * Math.sqrt(c.intensity)})`, boundary ? 'rgba(235,45,38,.8)' : null);
    }
    for (const route of overlay.routes) {
      ctx.beginPath(); ctx.strokeStyle = '#64e8ef'; ctx.lineWidth = 1.5;
      route.path.forEach((tile, index) => {
        const p = turn(tile);
        const [x,y] = geo.isoPoint(p.gx + .5, p.gy + .5, state.view, bauHoehe(p.gx,p.gy,1) + (tile.height || 0));
        if (index) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      }); ctx.stroke();
      if (route.entry) { const p = turn(route.entry); drawDiamond(ctx,p.gx,p.gy,1,'rgba(100,232,239,.65)'); }
    }
    ctx.restore();
  }

  // Was in der Statuszeile ueber die Karte steht. Die Drehung gehoert dorthin,
  // weil man ihr sonst nur ansieht, DASS etwas anders liegt, aber nicht warum.
  function mapStatus() {
    const map = gameMap();
    if (!map) return '';
    const keep = currentKeep();
    const platz = map.keeps.length
      ? (keep.player ? ' · start ' + keep.player : ' · start place ' + (map.keepIndex + 1)) +
        ' (' + keep.x + ', ' + keep.y + ')'
      : ' · no starting place, village in the middle of the map';
    // Die Zahl des Spiels wird mitgenannt: 0/2/4/6 ist das, was in
    // keepOrientation steht, und nur damit laesst sich nachrechnen.
    const drehung = keep.orientation
      ? ' · turned ' + (keep.orientation / 2) + ' quarter turn' + (keep.orientation === 2 ? '' : 's') +
        ' (game value ' + keep.orientation + ')'
      : (map.keeps.length ? ' · not turned (game value 0)' : '');
    // Und ob der Boden Hoehen hat. Ohne diese Zeile sieht man dem Bild nur an,
    // DASS etwas anders liegt, aber nicht warum - und ob es an dieser Karte
    // liegt oder daran, dass gerade die flache Vorschau darunterliegt.
    const feld = state.hoehenFeld;
    let hoehe = '';
    if (feld) {
      let tief = 255, hoch = 0;
      for (const wert of feld) { if (wert < tief) tief = wert; if (wert > hoch) hoch = wert; }
      hoehe = hoch === tief ? ' · flat ground (height ' + hoch + ')'
                            : ' · ground rises ' + (hoch - tief) + ' points (height ' + tief + ' to ' + hoch + ')';
    }
    return ' · map: ' + map.name + platz + drehung + hoehe;
  }

  // Was ein Klick setzen wuerde - mit dem richtigen Bild, halb durchsichtig.
  // Vorher stand hier nur eine leere Raute, und die zeigte weder, WIE das
  // Gebaeude aussieht, noch WIE VIELE Felder ein breiter Pinsel deckt.
  function drawPreview(ctx) {
    const editor = window.castleEditor;
    if (!editor || !editor.getPlacementPreview) return;
    const vorschau = editor.getPlacementPreview();
    if (!vorschau || !vorschau.tiles.length) return;
    const katalog = state.catalogue && state.catalogue.gegenstaende;
    const nachschlagen = type => (katalog ? katalog[String(type)] : null) || null;
    // A dragged line can lay down several different items - a stair does. Each
    // tile therefore names its own, and only falls back to the one for the
    // whole preview.
    // Die Felder der Vorschau zaehlen fuer die Mauerregel schon mit: sonst
    // sieht eine gezogene Mauerlinie wie eine Reihe Pfeiler aus und springt
    // beim Loslassen zur durchgehenden Flaeche um.
    // Auch die Vorschau wird gedreht - sonst haengt am Zeiger ein Bauwerk,
    // das nach dem Loslassen woanders steht.
    const kuenftig = turnedTiles(vorschau.tiles.map(feld => {
      const entry = nachschlagen(feld.itemType != null ? feld.itemType : vorschau.itemType);
      return { gx: feld.x, gy: geo.GRID - 1 - feld.y, entry, tiles: entry ? entry.kacheln : 1 };
    }));
    const neueMauern = geo.wallLookup(kuenftig);
    const mauerAn = (gx, gy) =>
      neueMauern(gx, gy) || (state.mauerAn ? state.mauerAn(gx, gy) : null);
    // Dasselbe fuer die Hoehen: eine gezogene Treppe sieht ihre eigenen
    // Stufen schon waehrend des Ziehens, sonst zeigen alle fuenf das flache
    // Podest und springen beim Loslassen um.
    const neueHoehen = geo.hoehenLookup(kuenftig);
    const hoeheAn = (gx, gy) => {
      const neu = neueHoehen(gx, gy);
      return neu != null ? neu : (state.hoeheAn ? state.hoeheAn(gx, gy) : null);
    };

    ctx.save();
    ctx.globalAlpha = 0.5;
    for (const feld of kuenftig) {
      const eintrag = feld.entry;
      const kacheln = feld.tiles;
      if (!eintrag || !drawSprite(ctx, eintrag, feld.gx, feld.gy, kacheln, mauerAn, hoeheAn))
        drawDiamond(ctx, feld.gx, feld.gy, kacheln, 'rgba(120,220,140,.45)', 'rgba(150,240,170,.9)');
    }
    ctx.restore();
  }

  // Was ausgewaehlt ist, bekommt einen Rahmen. Der Editor fuehrt die Auswahl,
  // diese Ansicht zeigt sie nur - so kann sie nicht von der Karte abweichen.
  function drawSelection(ctx, items) {
    const editor = window.castleEditor;
    if (!editor || !editor.getSelection) return;
    const selected = editor.getSelection();
    if (!selected || !selected.size) return;
    for (const item of items) {
      if (!selected.has(item.ref)) continue;
      drawDiamond(ctx, item.gx, item.gy, item.tiles, 'rgba(120,190,255,.22)', 'rgba(150,205,255,.95)');
    }
  }

  // Der laufende Auswahlkasten. In der schraegen Ansicht ist ein Rechteck der
  // Karte eine Raute - deshalb kommt der Umriss aus der Geometrie und wird
  // hier nur nachgezogen. Rot, wenn geloescht wird: dieselbe Farbe wie auf
  // der Karte, damit die beiden Ansichten dasselbe sagen.
  function drawMarquee(ctx) {
    const editor = window.castleEditor;
    if (!editor || !editor.getMarquee) return;
    const box = editor.getMarquee();
    const ecken = box && geo.marqueeOutline(box, state.view, currentRotation());
    if (!ecken) return;
    ctx.save();
    ctx.beginPath();
    ecken.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    const loeschen = box.kind === 'delete-marquee';
    const ersetzen = box.kind === 'replace-marquee';
    ctx.fillStyle = loeschen ? 'rgba(220,90,80,.18)' : ersetzen ? 'rgba(221,169,75,.18)' : 'rgba(120,190,255,.16)';
    ctx.strokeStyle = loeschen ? 'rgba(240,120,110,.95)' : ersetzen ? 'rgba(221,169,75,.95)' : 'rgba(150,205,255,.95)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // One repaint per frame at most. The editor now tells the view about every
  // change it makes, and a build step can be a hundred of them in a row.
  function refresh() {
    if (state.paintPending || hostIsGone()) return;
    state.paintPending = true;
    requestAnimationFrame(paint);
  }

  function setStatus(text) {
    if (state.host && state.host.statusEl) state.host.statusEl.textContent = text;
  }

  function fit() { state.fitted = false; refresh(); }

  // ------------------------------------------------------------- input

  function pointOf(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // A click becomes a tile, and the tile goes to the castle editor. The
  // editor decides what happens - that is the whole point.
  function toEditor(phase, event, tile) {
    const editor = window.castleEditor;
    if (!editor || !editor.pointerFromOutside) return;
    editor.pointerFromOutside(phase, {
      // A release always says "left button", whatever ended the gesture. A
      // pointercancel - the normal way a touch or a pen finishes - carries
      // button -1, and the editor drops anything that is not 0; its brush or
      // marquee would then stay open and the next click would carry on the
      // old stroke.
      button: phase === 'up' ? 0 : event.button,
      pointerId: event.pointerId || 1,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      tileFromOutside: tile,
      preventDefault() {},
      stopPropagation() {}
    });
    refresh();
  }

  // Bound once per canvas, and a canvas belongs to exactly one host for its
  // whole life, so nothing here ever needs unbinding.
  function bindSurface(canvas) {
    if (!canvas || state.bound.has(canvas)) return;
    state.bound.add(canvas);
    canvas.tabIndex = 0;

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('pointerdown', event => {
      canvas.focus({ preventScroll: true });
      // In a narrow docked panel the pointer leaves the canvas mid-stroke.
      // Without capture the matching pointerup goes to another element and
      // state.drawing would stay stuck on.
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events have no pointer */ }
      if (event.button === 1 || event.button === 2) {      // middle or right: pan
        event.preventDefault();
        state.panning = true;
        const p = pointOf(canvas, event);
        state.panStart = { x: p.x, y: p.y, panX: state.view.panX, panY: state.view.panY };
        return;
      }
      const p = pointOf(canvas, event);
      const tile = editorTileAt(p.x, p.y);
      if (!tile) return;
      state.drawing = true;
      toEditor('down', event, tile);
    });

    canvas.addEventListener('pointermove', event => {
      const p = pointOf(canvas, event);
      if (state.panning && state.panStart) {
        state.view.panX = state.panStart.panX + p.x - state.panStart.x;
        state.view.panY = state.panStart.panY + p.y - state.panStart.y;
        refresh();
        return;
      }
      const tile = editorTileAt(p.x, p.y);
      const grid = geo.tileFromPoint(p.x, p.y, state.view, bodenHoehe);
      canvas.title = window.castleEditor?.itemLabelAtTile?.(tile) || '';
      const moved = !state.hover || !grid || state.hover.gx !== grid.gx || state.hover.gy !== grid.gy;
      state.hover = grid;
      if (tile && (state.drawing || moved)) toEditor('move', event, tile);
      else if (moved) refresh();
    });

    const ende = event => {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
      if (state.panning) { state.panning = false; state.panStart = null; return; }
      if (!state.drawing) return;
      state.drawing = false;
      const p = pointOf(canvas, event);
      const tile = editorTileAt(p.x, p.y) || lastHoverTile();
      if (tile) toEditor('up', event, tile);
    };
    canvas.addEventListener('pointerup', ende);
    canvas.addEventListener('pointercancel', ende);
    canvas.addEventListener('pointerleave', () => { state.hover = null; refresh(); });

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const preferences = window.castleEditor?.getCameraPreferences?.() || window.castleCamera.defaults;
      const action = window.castleCamera.wheelAction(event, preferences, true);
      if (action !== 'zoom') {
        state.view[action] -= event.deltaY || event.deltaX;
        refresh();
        return;
      }
      if (!event.deltaY) return;
      const before = state.view.zoom;
      const next = Math.max(0.15, Math.min(8, before * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const p = pointOf(canvas, event);
      state.view.zoom = next;
      state.view.panX = p.x - (p.x - state.view.panX) * (next / before);
      state.view.panY = p.y - (p.y - state.view.panY) * (next / before);
      refresh();
    }, { passive: false });
  }

  // Everything around the drawing surface, and the one place the two hosts
  // really differ: a window has to be told about its own size and keys, a
  // panel is watched by a ResizeObserver and shares the app's keyboard.
  function bindHostChrome(host) {
    if (host.kind === 'dock') {
      if (!state.observer) state.observer = new ResizeObserver(() => refresh());
      state.observer.disconnect();
      state.observer.observe(host.box);
      return;
    }
    const win = host.win;
    win.addEventListener('resize', refresh);
    win.addEventListener('beforeunload', () => {
      // Only if this window is still the host. Closing it while docking
      // fires this after the panel has taken over, and clearing the host
      // then would leave the panel blank.
      if (state.host !== host) return;
      parkControls();
      state.host = null;
      state.panning = false;
      state.panStart = null;
      state.drawing = false;
      state.hover = null;
      window.castlePanels?.open?.('iso');
    });
    // The editor's own key handler listens on the main window and never
    // hears this one, so the window forwards. A docked panel must NOT do
    // this, or every shortcut would arrive twice.
    win.addEventListener('keydown', event => {
      const editor = window.castleEditor;
      if (!editor || !editor.handleKey) return;
      editor.handleKey(event);
      refresh();
    });
  }

  // ------------------------------------------------------------- hosts

  function parkControls() {
    const store = document.getElementById('castleWindowStore');
    if (state.controls && store && state.controls.parentElement !== store) {
      store.appendChild(state.controls);
    }
  }

  function isMounted() { return Boolean(state.host) && !hostIsGone(); }

  function panFromKey(event, delta) {
    if (!isMounted()) return false;
    const host = state.host;
    const target = event.target;
    const belongs = host.kind === 'window'
      ? target?.ownerDocument === host.win.document || event.view === host.win
      : Boolean(target?.nodeType && host.box.contains(target));
    if (!belongs) return false;
    state.view.panX += delta.x;
    state.view.panY += delta.y;
    refresh();
    return true;
  }

  function closeWindow() {
    const host = state.host;
    if (!host || host.kind !== 'window') return;
    state.host = null;
    try { if (host.win && !host.win.closed) host.win.close(); } catch { /* already gone */ }
  }

  function unmount() {
    const host = state.host;
    if (!host || host.kind !== 'dock') return;
    if (state.observer) state.observer.disconnect();
    state.host = null;
  }

  async function mountDock() {
    const box = document.getElementById('isoDockBody');
    const canvas = document.getElementById('isoDockCanvas');
    const statusEl = document.getElementById('isoDockStatus');
    if (!box || !canvas) return false;
    // Already here: do not reset the fit, or every splitter drag would throw
    // away the user's zoom and pan.
    if (state.host && state.host.kind === 'dock') { refresh(); return true; }
    const token = ++state.mountToken;
    closeWindow();
    await loadCatalogue();
    if (token !== state.mountToken) return false;      // somebody else took over meanwhile
    state.host = { kind: 'dock', win: window, box, canvas, statusEl };
    state.fitted = false;
    bindSurface(canvas);
    bindHostChrome(state.host);
    refresh();
    return true;
  }

  async function openWindow() {
    if (state.host && state.host.kind === 'window' && !hostIsGone()) {
      state.host.win.focus();
      refresh();
      return true;
    }
    const token = ++state.mountToken;
    await loadCatalogue();
    if (token !== state.mountToken) return false;      // somebody else took over meanwhile
    const win = window.open('', 'aiToolkitIsoView', 'width=1280,height=860');
    if (!win) return false;                       // blocked, or no user gesture
    unmount();
    win.document.title = '2.5D view — AI Toolkit';
    win.document.body.style.cssText =
      'margin:0;background:#171a14;overflow:hidden;font:12px/1.4 system-ui,sans-serif;color:#cfd6c8';
    win.document.body.innerHTML =
      '<div id="isoWindowChrome"><strong>2.5D</strong><div id="isoWindowControlSlot"></div>' +
      '<span class="isoWindowFill"></span><button id="isoWindowDockBtn" type="button">Dock</button></div>' +
      '<div id="isoWindowHost">' +
      '<canvas id="isoWindowCanvas" style="display:block;width:100%;height:100%;cursor:crosshair"></canvas>' +
      '</div>' +
      '<div id="isoWindowStatus" style="position:fixed;left:0;right:0;bottom:0;padding:5px 10px;' +
      'background:rgba(0,0,0,.55);pointer-events:none"></div>';
    const chromeStyle = win.document.createElement('style');
    chromeStyle.textContent =
      '[hidden]{display:none!important}' +
      '#isoWindowChrome{position:fixed;inset:0 0 auto 0;height:34px;display:flex;align-items:center;gap:5px;' +
      'padding:3px 6px;box-sizing:border-box;background:#20262a;border-bottom:1px solid #465158}' +
      '#isoWindowChrome>strong{padding:0 4px;color:#eef1f6;font-size:11px}' +
      '#isoWindowControlSlot{min-width:0;display:flex;flex:0 1 auto;overflow-x:auto;overflow-y:hidden}' +
      '.isoWindowFill{flex:1}' +
      '#isoWindowHost{position:fixed;inset:34px 0 0}' +
      '.isoViewControls{min-width:0;display:flex;align-items:center;gap:3px}' +
      '.isoViewControls button,#isoWindowDockBtn{flex:none;min-height:24px;padding:1px 7px;border:1px solid #465158;' +
      'border-radius:4px;background:#2a3237;color:#eef1f6;font:600 11px system-ui,sans-serif;cursor:pointer}' +
      '.isoViewControls button[aria-pressed="true"]{border-color:#b98542;background:#463722}' +
      '.isoViewControls .isoViewReset{width:24px;padding:0}' +
      '.isoViewControls select{flex:none;width:128px;min-height:24px;border:1px solid #465158;border-radius:4px;' +
      'background:#2a3237;color:#eef1f6;font:11px system-ui,sans-serif}';
    win.document.head.appendChild(chromeStyle);
    const controlSlot = win.document.getElementById('isoWindowControlSlot');
    if (controlSlot && state.controls) controlSlot.appendChild(state.controls);
    state.host = {
      kind: 'window',
      win,
      box: win.document.getElementById('isoWindowHost'),
      canvas: win.document.getElementById('isoWindowCanvas'),
      statusEl: win.document.getElementById('isoWindowStatus')
    };
    state.fitted = false;
    // Dragging a panel back over a window border is not possible - the page
    // gets no pointer position outside its own window - so the way back is
    // this button.
    const back = win.document.getElementById('isoWindowDockBtn');
    if (back) back.addEventListener('click', () => window.castlePanels?.open?.('iso'));
    bindSurface(state.host.canvas);
    bindHostChrome(state.host);
    refresh();
    return true;
  }

  function init() {
    // The toolbar button belongs to panel-view.js: it decides where this
    // view is shown, this file only knows how to be shown.
    bindSurface(document.getElementById('isoDockCanvas'));
    state.controls = document.getElementById('castleIsoControls');
    window.castleEditor?.addChangeListener?.(refresh);
    loadCatalogue();
  }

  window.isoView = { init, openWindow, closeWindow, mountDock, unmount, refresh, paint, fit, isMounted, panFromKey,
                     setGround, hasOwnGround, setGroundFit, groundIsStretched,
                     setGameMap, setGameMapKeep, hasGameMap, gameMapInfo,
                     mapMode, setMapMode, setTerrain, terrainKey, terrainReady,
                     viewRotation, turnView, currentRotation,
                     setMapTiles, hasMapTiles };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
