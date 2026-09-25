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
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);

  const geo = (typeof globalThis !== 'undefined' && globalThis.isoGeometry) || null;
  const CATALOGUE_PATH = '../assets/aiv/iso/verzeichnis.json';
  const SPRITE_PATH = '../assets/aiv/iso/';
  const MAX_RENDER_DPR = 1.5;
  const GPU_SPARE = 256;          // device px of picture the GPU layer draws beyond the panel
  const MAP_MARGIN = 5;

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

  let catalogueRequest = null;
  let unitRequest = null;
  function loadUnitSprites() {
    if (!unitRequest) {
      const request = Promise.resolve(window.electronAPI?.loadGameUnitSprites?.())
      .then(assets => {
        if (unitRequest !== request) return;
        state.unitAssets = assets || {};
        state.troopDocument = state.troopPlan = null;
        state.unitCommands = new Map();
        for (const pose of Object.values(assets?.idleSprites || {})) image(pose.path);
        refresh(false, true);
      }).catch(error => { console.warn('Idle troop previews unavailable:', error); });
      unitRequest = request;
    }
    return unitRequest;
  }
  function loadCatalogue() {
    if (state.catalogue) return Promise.resolve(state.catalogue);
    if (!catalogueRequest) catalogueRequest = (async () => {
      const response = await fetch(CATALOGUE_PATH);
      if (!response.ok) throw new Error(String(response.status));
      const bundled = await response.json();
      try { return await window.electronAPI?.loadGameBuildingAssets?.() || bundled; }
      catch (error) { console.warn('Game building textures unavailable:', error); return bundled; }
    })().catch(error => { console.warn('Building catalogue unavailable:', error); return {gegenstaende: {}}; });
    const request = catalogueRequest;
    return request.then(catalogue => {
      if (catalogueRequest === request) state.catalogue = catalogue;
      return catalogue;
    });
  }

  async function reloadGameAssets() {
    catalogueRequest = null;
    state.catalogue = null;
    unitRequest = null;
    state.unitAssets = null;
    await Promise.all([loadCatalogue(), loadUnitSprites()]);
    refresh();
  }

  function image(filename, terrainAsset = false) {
    if (!filename) return null;
    let img = state.images.get(filename);
    if (img) { img.terrainAsset ||= terrainAsset; return img; }
    img = new Image();
    // Tauri serves local game atlases from its scoped asset origin. Request
    // CORS explicitly so canvas export and worker ImageBitmap transfer stay clean.
    img.crossOrigin = 'anonymous';
    img.terrainAsset = terrainAsset;
    img.decoding = 'async';
    img.onload = () => refresh(false, !img.terrainAsset);
    img.onerror = () => onImageFailed(filename);
    // Runtime atlases use absolute URLs; bundled sprites use relative paths.
    img.src = /^(data:|blob:|https?:|file:|asset:)/.test(filename) ? filename : SPRITE_PATH + filename;
    state.images.set(filename, img);
    return img;
  }

  // ---------------------------------------------------------- drawing

  function currentDocument() {
    const editor = window.castleEditor;
    if (!editor?.hasDocument?.()) return null;
    const revision = editor.getDocumentRevision?.();
    if (revision == null) return editor.getDocument();
    if (state.documentSnapshotRevision !== revision) {
      state.documentSnapshot = editor.getDocument();
      state.documentSnapshotRevision = revision;
    }
    return state.documentSnapshot;
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
  function onImageFailed(filename) {
    refresh();
  }

  // ------------------------------------------------- a map of the game
  //
  // The map atlas supplies terrain at native resolution after all images decode.

  const MAP_KEY = 'castleIsoGameMap';
  const MAP_POSITION_KEY = 'castleIsoGameMapPosition';

  // Welche Karte mit welchem Startplatz gerade liegt. Wechselt eines von
  // beidem, passt alles Gezeichnete nicht mehr und muss neu entstehen.
  function kartenSchluessel() {
    const map = gameMap();
    if (!map || !map.path) return null;
    const keep = currentKeep();
    return keep ? `${map.path}#${keep.x},${keep.y}` : null;
  }

  // Terrain height in native image pixels, shared by sprites and picking.
  function bodenHoehe(gx, gy) {
    // The full-map atlas takes precedence over paintGround. It already lifts
    // terrain tiles; sprites and picking must use those same heights.
    const atlas = vorrat();
    if (atlas?.plaetze && atlas.bild?.complete && atlas.bild?.naturalWidth && gameMap()) {
      // Dieselbe Rechnung wie beim Malen des Grundes - anders schwebte ein
      // Bauwerk ueber seiner eigenen Kachel.
      return geo.mapTileHeight(gx, gy, currentKeep(), atlas.hoehen, viewRotation());
    }
    const world = geo.unrotateGrid(gx, gy, viewRotation());
    const feld = state.hoehenFeld;
    if (!feld) return 0;
    if (world.gx < 0 || world.gy < 0 || world.gx >= geo.GRID || world.gy >= geo.GRID) return 0;
    return feld[world.gy * geo.GRID + world.gx] || 0;
  }

  function gameMap() {
    if (state.gameMap === undefined) {
      let stored = null;
      try { stored = window.localStorage.getItem(MAP_KEY); } catch { stored = null; }
      try { state.gameMap = stored ? JSON.parse(stored) : null; } catch { state.gameMap = null; }
      try {
        const position = JSON.parse(window.localStorage.getItem(MAP_POSITION_KEY) || 'null');
        if (state.gameMap && position?.path === state.gameMap.path && Number.isInteger(position.index)) {
          state.gameMap.keepIndex = Math.max(0, Math.min(state.gameMap.keeps.length - 1, position.index));
        }
      } catch { /* Ignore a corrupt position preference; retain the loaded map. */ }
    }
    return state.gameMap;
  }

  function rememberGameMap() {
    try {
      if (state.gameMap) window.localStorage.setItem(MAP_KEY, JSON.stringify(state.gameMap));
      else window.localStorage.removeItem(MAP_KEY);
    } catch { /* a view must not fall over because storage is off */ }
  }

  let mapTilesRequest = 0;
  function setGameMap(map) {
    mapTilesRequest++;
    state.mapLoadError = null;
    const previous = gameMap();
    state.gameMap = map
      ? { name: map.name, path: map.path || null,
          keeps: Array.isArray(map.keeps) ? map.keeps : [], keepIndex: 0, pathTerrain: map.pathTerrain || null }
      : null;
    // Das Gelaende der alten Karte zeigt die alte Karte. Es jetzt stehen zu
    // lassen hiesse, die neue Karte mit fremdem Boden zu zeigen.
    if (state.kachelVorrat) {
      releaseMapImages();
      state.kachelVorrat = null;
    }
    if (previous?.path !== state.gameMap?.path) handDrehung = 0;
    window.castleEditor?.extras?.scheduleDraw?.();
    rememberGameMap();
    try { window.localStorage.removeItem(MAP_POSITION_KEY); } catch {}
    refresh();
  }

  function setGameMapKeep(index) {
    const map = gameMap();
    if (!map || !map.keeps.length) return;
    const next = Math.max(0, Math.min(map.keeps.length - 1, Number(index) || 0));
    if (map.keepIndex === next) return;
    map.keepIndex = next;
    // A starting place is a tiny preference, not a change to the map payload.
    try { window.localStorage.setItem(MAP_POSITION_KEY, JSON.stringify({ path: map.path, index: next })); } catch {}
    window.castleEditor?.extras?.scheduleDraw?.();
    refresh();
  }

  let routeTerrainCache = null, terrainRequest = null;
  function analysisTerrain() {
    const map=gameMap(), keep=currentKeep();
    if (map?.pathTerrain?.version !== 4 || !keep) {
      if(map?.path && terrainRequest !== map.path && window.electronAPI?.loadGameMap) {
        terrainRequest=map.path;
        window.electronAPI.loadGameMap(map.path).then(loaded=>{
          if(gameMap()!==map || !loaded.pathTerrain) return;
          map.pathTerrain=loaded.pathTerrain;rememberGameMap();
          window.castleEditor?.extras?.scheduleDraw?.();
        }).catch(()=>{ /* Overlay reports castle-only terrain when unavailable. */ });
      }
      return null;
    }
    const key=JSON.stringify([map.path,keep,map.pathTerrain.fingerprint]);
    if(routeTerrainCache?.map === map && routeTerrainCache.key === key) return {key:routeTerrainCache.key,padding:routeTerrainCache.padding,blocked:routeTerrainCache.blocked,hardBlocked:routeTerrainCache.hardBlocked,heights:routeTerrainCache.heights,constructionLift:routeTerrainCache.constructionLift};
    const source=ausBase64(map.pathTerrain.blocked,Uint8Array);
    const hard=ausBase64(map.pathTerrain.hardBlocked,Uint8Array) || source;
    const heights=ausBase64(map.pathTerrain.heights,Uint8Array);
    const lifts=ausBase64(map.pathTerrain.constructionLift,Uint8Array);
    const padding=5,edge=100+2*padding;
    const blocked=new Uint8Array(edge*edge), hardBlocked=new Uint8Array(edge*edge), ground=new Uint8Array(edge*edge), constructionLift=new Uint8Array(edge*edge);
    for(let y=-padding;y<100+padding;y++) for(let x=-padding;x<100+padding;x++) {
      const index=(y+padding)*edge+x+padding;
      const rotated=geo.rotateGrid(x,99-y,1,keep.orientation);
      const {mx,my}=geo.mapTileForGrid(rotated.gx,rotated.gy,keep);
      const valid=mx>=0 && my>=0 && mx<400 && my<400;
      blocked[index]=valid ? source[my*400+mx] : 1;
      hardBlocked[index]=valid ? hard[my*400+mx] : 1;
      ground[index]=valid ? heights[my*400+mx] : 0;
      constructionLift[index]=valid ? lifts[my*400+mx] : 0;
    }
    routeTerrainCache={map,key,padding,blocked,hardBlocked,heights:ground,constructionLift};
    return {key:routeTerrainCache.key,padding:routeTerrainCache.padding,blocked:routeTerrainCache.blocked,hardBlocked:routeTerrainCache.hardBlocked,heights:routeTerrainCache.heights,constructionLift:routeTerrainCache.constructionLift};
  }

  function hasGameMap() { return Boolean(gameMap()); }
  function gameMapInfo() {
    const map = gameMap();
    if (!map) return null;
    const keep = currentKeep();
    return { name: map.name, path: map.path || null, keeps: map.keeps, keepIndex: map.keepIndex,
             keep, schluessel: kartenSchluessel() };
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
    if (gameMap() && !state.kachelVorrat?.cameras) {
      setStatus(() => state.kachelVorrat?.nativeError
        ? tr("viewport:rotation_unavailable") + state.kachelVorrat.nativeError
        : tr("viewport:loading_camera_views"));
      return null;
    }
    const schritt = Number(richtung) < 0 ? -VIERTEL : VIERTEL;
    const target = surface();
    if (target) {
      const pivotKey = () => [target.width, target.height, state.view.zoom, state.view.panX,
        state.view.panY, kartenSchluessel()].join('/');
      // Keep the same world-space pivot between turns. Picking again after
      // each turn can choose a different face of a cliff and move the camera.
      let height = state.rotationPivot?.key === pivotKey() ? state.rotationPivot.height : null;
      if (height === null) {
        const focus = geo.tileFromPoint(target.width / 2, target.height / 2, state.view, bodenHoehe, false);
        height = focus ? bodenHoehe(focus.gx, focus.gy) : 0;
      }
      state.view = geo.turnCameraView(state.view, target.width, target.height, (schritt + 8) % 8, height);
      state.rotationPivot = { key: pivotKey(), height };
    }
    if (state.hover) state.hover = geo.rotateGrid(state.hover.gx, state.hover.gy, 1, (schritt + 8) % 8);
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
    return list.map(item => {
      const turned = geo.rotateGrid(item.gx, item.gy, item.tiles, rotation);
      // A quarter turn changes a gate's passage axis. Resolve drawbridge
      // attachment after this swap, in the same coordinates as the map.
      const gateType = [144, 145, 146, 147].includes(Number(item.itemType)) && rotation % 4 === 2
        ? (Number(item.itemType) ^ 1) : item.itemType;
      const base = state.catalogue?.gegenstaende[gateType] || item.entry;
      const layouts = base?.cameraPartsLayouts?.[viewRotation() / 2];
      return { ...item, gx: turned.gx, gy: turned.gy, itemType: gateType, cameraRotation: viewRotation(),
        entry: layouts ? { ...base, partsLayouts: layouts } : base };
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

  // ------------------------------------- die ganze Karte aus dem Kachelvorrat
  //
  // Statt eines fertigen Bildes vom Dorffenster bekommt die Ansicht das, was
  // auch das Spiel im Speicher haelt: einen Vorrat aller Kacheln dieser Karte
  // und je Feld die Nummer seiner Kachel. Gemalt wird beim Zeichnen, und nur
  // was im Fenster liegt - so wie renderMap (0x004e8cf0) es tut. Deshalb
  // laesst sich die GANZE Karte in voller Aufloesung zeigen, ohne dass je ein
  // Bild von 12000x6400 Punkten entsteht.
  const KARTE_FELDER = 400;

  function vorrat() {
    const stock = state.kachelVorrat;
    return stock?.cameras?.[viewRotation() / 2] || stock || null;
  }

  function releaseMapImages() {
    const stock = state.kachelVorrat;
    for (const camera of stock?.cameras || (stock ? [stock] : [])) {
      if (camera.upperImage) state.images.delete(camera.upperImage.src);
    }
  }

  // Base64 in ein Zahlenfeld. Die Bruecke kann keine Binaerdaten, deshalb
  // kommen Plaetze und Hoehen als Text.
  function ausBase64(text, Art) {
    if (!text) return null;
    const roh = atob(text);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
    return new Art(bytes.buffer);
  }

  async function setMapTiles(daten) {
    const selected = gameMap();
    if (daten?.path && daten.path !== selected?.path) return false;
    const request = ++mapTilesRequest;
    if (!daten) { releaseMapImages(); state.kachelVorrat = null; state.startMarks = null; refresh(); return false; }
    const pending = [];
    function cameraStock(daten) {
      const bild = new Image();
      bild.crossOrigin = 'anonymous';
      bild.src = daten.atlas;
      pending.push(bild.decode());
      const upperImages = (daten.upper?.pages || (daten.upper?.dataUrl ? [daten.upper.dataUrl] : [])).map(url => {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; pending.push(img.decode()); return img;
      });
      return {
        path: daten.path,
        bild,
        upperImages, upperEntries: daten.upper?.entries || [],
        treeSprites: new Map((daten.treeSprites || []).map(tree => [tree[1] * KARTE_FELDER + tree[0], tree])),
        cliffSprites: ausBase64(daten.cliffSprites, Uint16Array),
        plaetze: ausBase64(daten.plaetze, Uint16Array),
        hoehen: daten.hoehen ? ausBase64(daten.hoehen, Uint8Array) : null,
        spalten: Number(daten.spalten) || 64,
        kw: Number(daten.kachelBreite) || 30,
        kh: Number(daten.kachelHoehe) || 16,
        name: daten.name || ''
      };
    }
    const cameras = daten.cameras?.length === 4 ? daten.cameras.map(cameraStock) : null;
    const stock = { ...(cameras?.[0] || cameraStock(daten)), path: daten.path, cameras, nativeError: daten.nativeError };
    await Promise.all(pending);
    if (request !== mapTilesRequest || selected !== gameMap()) return false;
    releaseMapImages();
    state.kachelVorrat = stock;
    state.mapLoadError = null;
    if (!cameras) handDrehung = 0;
    refresh();
    return true;
  }

  function setMapLoadError(message) { state.mapLoadError = message; refresh(); }

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
    state.mapScenery = [];
    cacheTerrainCommands();
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
    const gx0 = Math.max(-MAP_MARGIN, Math.floor(Math.min(...ecken.map(e => e.gx))) - rand);
    const gx1 = Math.min(geo.GRID + MAP_MARGIN - 1, Math.ceil(Math.max(...ecken.map(e => e.gx))) + rand);
    const gy0 = Math.max(-MAP_MARGIN, Math.floor(Math.min(...ecken.map(e => e.gy))) - rand);
    const gy1 = Math.min(geo.GRID + MAP_MARGIN - 1, Math.ceil(Math.max(...ecken.map(e => e.gy))) + rand);

    const kw = v.kw, kh = v.kh;
    let gemalt = 0;
    // Von hinten nach vorn: kleineres gx+gy zuerst, sonst deckt das hintere
    // Feld das vordere zu.
    for (let summe = gx0 + gy0; summe <= gx1 + gy1; summe += 1) {
      for (let gx = Math.max(gx0, summe - gy1); gx <= Math.min(gx1, summe - gy0); gx += 1) {
        const gy = summe - gx;
        // Anzeigefeld -> Kartenfeld. Die Rechnung steht in iso-geometry.js,
        // damit Grund, Hoehe und Marken dieselbe nehmen.
        const { mx, my } = geo.mapTileForView(gx, gy, keep, viewRotation());
        const feld = kartenFeld(mx, my);
        if (feld < 0) continue;
        const platz = v.plaetze[feld];
        if (platz === 0xffff) continue;
        const hebung = (v.hoehen ? v.hoehen[feld] : 0) * state.view.zoom;
        const [px, py] = geo.isoPoint(gx, gy, state.view, 0);
        // The game advances 32 pixels between tiles on a screen row, but
        // a GM1 diamond contains only 30 pixels. Do not stretch those pixels
        // (or the attached scenery) to fill the grid pitch.
        const tileWidth = kw * state.view.zoom;
        const tileLeft = px - tileWidth / 2;
        const cliff = v.upperEntries[(v.cliffSprites?.[feld] || 0) - 1];
        const cliffImage = v.upperImages?.[cliff?.page || 0] || v.upperImage;
        state.mapScenery.push({ isTerrain: true, gx, gy, tiles: 1, layer: 0, draw: (target = ctx) => {
        if (cliff && cliffImage?.complete && cliffImage.naturalWidth) {
          target.drawImage(cliffImage, cliff.x, cliff.y, cliff.width, cliff.height,
            tileLeft, py - hebung + cliff.dy * state.view.zoom,
            tileWidth, cliff.height * state.view.zoom);
        }
        target.drawImage(v.bild,
          (platz % v.spalten) * kw, Math.floor(platz / v.spalten) * kh, kw, kh,
          tileLeft, py - hebung, tileWidth, kh * state.view.zoom);
        }});
        const upper = v.upperEntries[platz];
        const upperImage = v.upperImages?.[upper?.page || 0] || v.upperImage;
        if (upper && upperImage?.complete && upperImage.naturalWidth) {
          state.mapScenery.push({ isTerrain: true, clearable: true, gx, gy, tiles: 1, draw: (target = ctx) => {
            const scaleX = state.view.zoom, scaleY = state.view.zoom;
            target.drawImage(upperImage, upper.x, upper.y, upper.width, upper.height,
              tileLeft + upper.dx * scaleX, py - hebung + upper.dy * scaleY,
              upper.width * scaleX, upper.height * scaleY);
          }});
        }
        const tree = v.treeSprites.get(feld);
        const treePicture = tree && v.upperEntries[tree[2]];
        const treeImage = v.upperImages?.[treePicture?.page || 0] || v.upperImage;
        if (treePicture && treeImage?.complete && treeImage.naturalWidth) {
          state.mapScenery.push({ isTerrain: true, clearable: true, gx, gy, tiles: 1, draw: (target = ctx) => {
            const scaleX = state.view.zoom, scaleY = state.view.zoom;
            target.drawImage(treeImage, treePicture.x, treePicture.y, treePicture.width, treePicture.height,
              tileLeft + tree[3] * scaleX, py - hebung + tree[4] * scaleY,
              treePicture.width * scaleX, treePicture.height * scaleY);
          }});
        }
        gemalt += 1;
      }
    }
    cacheTerrainCommands();
    state.letzteKacheln = gemalt;
    return gemalt > 0;
  }

  function paintGround(ctx, width, height) {
    state.hoehenFeld = null;
    const img = image('grund.png', true);
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

  function drawNativePart(ctx, part, img, lift) {
    const [x, y] = geo.isoPoint(part.gx, part.gy, state.view, lift);
    const z = state.view.zoom;
    ctx.drawImage(img, part.sx, part.sy, part.breite, part.hoehe,
      x + part.dx * z, y + part.dy * z, part.breite * z, part.hoehe * z);
  }

  function drawSprite(ctx, sprite, gx, gy, tiles, mauerAn, hoeheAn, layoutIndex = 0) {
    const parts = geo.buildingParts({ entry: sprite, gx, gy, layoutIndex });
    if (parts) {
      const loaded = new Map(parts.map(part => [part.bild, image(part.bild)]));
      if ([...loaded.values()].every(img => img?.complete && img.naturalWidth)) {
        const lift = bauHoehe(gx, gy, tiles);
        for (const part of parts.sort(geo.renderOrder)) drawNativePart(ctx, part, loaded.get(part.bild), lift);
        return true;
      }
    }
    const variant = geo.variantFor(sprite, gx, gy, mauerAn, hoeheAn);
    const img = image(variant.bild);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const rect = geo.spriteRect(variant, gx, gy, tiles, state.view, bauHoehe(gx, gy, tiles));
    if (Number.isFinite(variant.sx) && Number.isFinite(variant.sy)) {
      ctx.drawImage(img, variant.sx, variant.sy, variant.breite, variant.hoehe, rect.x, rect.y, rect.w, rect.h);
    } else ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
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
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    // setting width resets the transform, so this is redone every time
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, ctx, dpr };
  }

  // Compose at native scale once. Pan and zoom transform this world image;
  // they must not replay thousands of terrain draw calls on every frame.
  function paint() {
    state.paintPending = false;
    if (!geo || hostIsGone()) return;
    const target = surface();
    if (!target) return;
    const { width, height, ctx, dpr } = target;
    if (gameMap() && !hasMapTiles()) {
      state.gpu?.hide();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#232a1c'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#cbd2d2'; ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.mapLoadError || tr("viewport:loading_map"), width / 2, height / 2, width - 24);
      ctx.textAlign = 'start';
      return;
    }
    if (window.castleGpuStage && !state.gpuRequested) {
      state.gpuRequested=true;
      window.castleGpuStage.create(()=>refresh(true)).then(gpu=>{state.gpu=gpu;refresh(false,true);})
        .catch(error=>{console.warn('GPU preview unavailable:',error);state.gpuFailed=true;refresh(false,true);});
    }
    if (state.gpuRequested && !state.gpu && !state.gpuFailed) return;
    if (!state.fitted) { state.view = geo.fitView(width, height); state.fitted = true; }
    const key = [currentRotation(), kartenSchluessel()].join('/');
    const cache = state.sceneCache;
    const fireEnabled = fireOverlayVisible();
    if (!cache || state.sceneDirty || cache.fireEnabled !== fireEnabled || cache.key !== key || cache.stock !== state.kachelVorrat) {
      const sameEnvironment = cache?.key === key && cache.stock === state.kachelVorrat
        && cache.assetRevision === state.assetRevision;
      const sprites = sameEnvironment ? [] : Object.values(state.catalogue?.gegenstaende || {});
      const scenery = sameEnvironment ? [] : vorrat()?.upperEntries || [];
      const overhang = sameEnvironment ? cache.overhang : Math.ceil(Math.max(64,
        ...sprites.map(e => Math.max(Number(e.breite) || 0, Number(e.hoehe) || 0)),
        ...scenery.filter(Boolean).map(e => Math.max(Math.abs(Number(e.dx) || 0) + (Number(e.width) || 0), Math.abs(Number(e.dy) || 0) + (Number(e.height) || 0)))));
      const extent = geo.GRID + 2 * MAP_MARGIN;
      const worldWidth = extent * 32 + overhang * 2;
      const worldHeight = extent * 16 + 255 + overhang * 2;
      const canvas = cache?.canvas || document.createElement('canvas');
      const sameSize = canvas.width === worldWidth && canvas.height === worldHeight;
      if (!sameSize) { canvas.width = worldWidth; canvas.height = worldHeight; }
      const revision = window.castleEditor?.getDocumentRevision?.();
      const reuseTerrain = sameSize && sameEnvironment;
      const sceneView = { zoom: 1, panX: worldWidth / 2, panY: overhang + 255 + MAP_MARGIN * 16 };
      const view = state.view;
      let scene;
      try {
        state.view = sceneView;
        const sceneContext = canvas.getContext('2d');
        sceneContext.imageSmoothingEnabled = false;
        scene = paintScene(sceneContext, worldWidth, worldHeight, {
          reuseTerrain,
          previousCommands: reuseTerrain && !cache.gpu && revision != null && cache.documentRevision === revision ? cache.commands : null,
          previousFireMask: reuseTerrain ? cache.fireMask : null
        });
      } finally { state.view = view; }
      state.sceneCache = { key, canvas, fireEnabled, overhang, view: sceneView, ...scene, stock: state.kachelVorrat,
        assetRevision: state.assetRevision,
        documentRevision: window.castleEditor?.getDocumentRevision?.() };
      state.sceneDirty = false;
    }
    const scene = state.sceneCache;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = state.view.zoom < 1;
    const z = state.view.zoom;
    if (scene.gpu && state.gpu) {
      try {
        state.gpu.presentBehind(ctx.canvas, dpr);
        // The worker draws a frame or two after the panel changes size. Drawing
        // with spare room means a growing panel uncovers finished picture, not
        // an empty strip, and small size changes need no new canvas at all.
        const room = v => Math.ceil((v + GPU_SPARE) / GPU_SPARE) * GPU_SPARE;
        state.gpu.render(room(ctx.canvas.width),room(ctx.canvas.height),z*dpr,
          (state.view.panX-scene.view.panX*z)*dpr,(state.view.panY-scene.view.panY*z)*dpr);

      } catch(error) {
        console.warn('GPU preview failed:',error);state.gpu.destroy();state.gpu=null;state.gpuFailed=true;state.sceneCache=null;refresh();return;
      }
    } else {
      state.gpu?.hide();
      ctx.drawImage(scene.canvas, state.view.panX - scene.view.panX * z,
      state.view.panY - scene.view.panY * z, scene.canvas.width * z, scene.canvas.height * z);
    }
    drawAnalysis(ctx);
    paintInteraction(ctx, scene.items);
    const { items, missing } = scene;
    const editor = window.castleEditor;
    const toolId=editor?.getTool?.();
    const tool = toolId ? tr('shortcuts:'+toolId,{defaultValue:toolId}) : '—';
    setStatus(() => items.length + tr("viewport:items") + (missing ? ', ' + missing + tr("viewport:without_a_sprite") : '') +
              tr("viewport:tool") + tool + mapStatus() + tr("viewport:middle_drag_pans_right_click_clears_camera_controls_match_map"));
  }

  let fireLayer=null;
  function drawAnalysis(ctx) {
    const overlay=window.castleEditor?.getAnalysisOverlay?.(false);
    if(!overlay) return;
    const turn=tile=>geo.rotateGrid(tile.x,99-tile.y,1,currentRotation());
    ctx.save();
    const scene=state.sceneCache, fireMask=scene?.gpu ? state.gpu?.fireMask : scene?.fireMask;
    if(overlay.image && (!scene?.gpu || fireMask)) {
      fireLayer ||= document.createElement('canvas');
      if(fireLayer.width!==ctx.canvas.width || fireLayer.height!==ctx.canvas.height){fireLayer.width=ctx.canvas.width;fireLayer.height=ctx.canvas.height;}
      const fireCtx=fireLayer.getContext('2d');fireCtx.clearRect(0,0,fireLayer.width,fireLayer.height);
      // Image pixels are tile centres. Rotate the whole footprint about the
      // same tile centre as the castle, then project its two basis vectors.
      const point=(x,y)=>{
        const p=geo.rotateGrid(x-.5,y-.5,1,currentRotation());
        return geo.isoPoint(p.gx+.5,p.gy+.5,state.view);
      };
      const a=point(0,0), b=point(100,0), c=point(0,100);
      fireCtx.save();fireCtx.transform((b[0]-a[0])/100,(b[1]-a[1])/100,(c[0]-a[0])/100,(c[1]-a[1])/100,a[0],a[1]);
      fireCtx.imageSmoothingEnabled=true;fireCtx.drawImage(overlay.image,0,0);fireCtx.restore();
      const z=state.view.zoom;
      if(fireMask){fireCtx.save();fireCtx.globalCompositeOperation='destination-out';fireCtx.drawImage(fireMask,state.view.panX-scene.view.panX*z,state.view.panY-scene.view.panY*z,fireMask.width*z,fireMask.height*z);fireCtx.restore();}
      ctx.drawImage(fireLayer,0,0);
    }
    ctx.strokeStyle='#64e8ef';ctx.lineWidth=1.5;
    for(const route of overlay.routes) {
      if(route.path.length) {
        ctx.beginPath();
        route.path.forEach((tile,i)=>{
          const p=turn(tile),xy=geo.isoPoint(p.gx+.5,p.gy+.5,state.view,bauHoehe(p.gx,p.gy,1)+(tile.height||0));
          if(i)ctx.lineTo(...xy);else ctx.moveTo(...xy);
        });ctx.stroke();
      }
      if(route.entry) {
        const p=turn(route.entry),xy=geo.isoPoint(p.gx+.5,p.gy+.5,state.view,bauHoehe(p.gx,p.gy,1)+(route.entry.height||0));
        ctx.beginPath();ctx.arc(...xy,3.5,0,Math.PI*2);
        ctx.fillStyle=route.path.length?'#64e8ef':'#ff7167';ctx.fill();
        ctx.save();ctx.strokeStyle='#142a2e';ctx.lineWidth=1;ctx.stroke();ctx.restore();
      }
    }
    ctx.restore();
  }

  /** @typedef {{x:number, y:number, w:number, h:number}} SceneRect */
  /** @typedef {{gx:number, gy:number, tiles?:number, layer?:number}} SceneOrder */
  /** @typedef {SceneRect & {key:string, order:SceneOrder, flammable:boolean,
   * draw:(target:CanvasRenderingContext2D)=>void}} SceneCommand */

  /** Record once in scene coordinates; never mutate shared terrain commands.
   * @param {SceneOrder} order
   * @param {boolean} flammable
   * @param {(recorder: {commands: SceneCommand[], drawImage: CanvasRenderingContext2D['drawImage']}) => void} draw
   * @returns {SceneCommand[]}
   */
  function recordSceneCommands(order, flammable, draw) {
    if (!state.commandImageIds) { state.commandImageIds = new WeakMap(); state.nextCommandImageId = 0; }
    /** @type {SceneCommand[]} */
    const commands = [];
    draw({commands, drawImage(img, ...args) {
      const [x, y, w, h] = args.slice(-4);
      if (!state.commandImageIds.has(img)) state.commandImageIds.set(img, ++state.nextCommandImageId);
      commands.push({order, flammable, image:img, imageId:state.commandImageIds.get(img), args, key: `${state.commandImageIds.get(img)}:${args.join(',')}`, x, y, w, h,
        draw: target => target.drawImage(img, ...args)});
    }});
    return commands;
  }

  /** @param {SceneRect} a @param {SceneRect} b */
  function intersectsSceneRect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Inclusive end cells deliberately over-select at boundaries; the exact
  // rectangle check removes those candidates. Negative world positions are valid.
  function* sceneCells(rect) {
    if (rect.w <= 0 || rect.h <= 0) return;
    for (let y = Math.floor(rect.y / 256); y <= Math.floor((rect.y + rect.h) / 256); y++)
      for (let x = Math.floor(rect.x / 256); x <= Math.floor((rect.x + rect.w) / 256); x++) yield `${x}:${y}`;
  }

  function cacheTerrainCommands() {
    const commands = state.mapSceneryCommands = [];
    state.mapObjectCommands = [];
    const buckets = state.mapSceneryBuckets = new Map();
    for (const item of state.mapScenery.sort(geo.renderOrder)) {
      for (const command of recordSceneCommands(item, false, recorder => item.draw(recorder))) {
        Object.freeze(command);
        if (item.clearable) { state.mapObjectCommands.push(command); continue; }
        const index = commands.push(command) - 1;
        for (const cell of sceneCells(command)) {
          if (!buckets.has(cell)) buckets.set(cell, []);
          buckets.get(cell).push(index);
        }
      }
    }
  }

  // The ground stays cached. Only overground objects under visible construction
  // disappear, so stepping backward restores them without rebuilding terrain.
  function visibleMapObjects(items, plates) {
    const occupied = new Set();
    for (const item of [...items, ...plates]) {
      for (let y = 0; y < item.tiles; y++) for (let x = 0; x < item.tiles; x++)
        occupied.add(`${item.gx + x}:${item.gy + y}`);
    }
    return (state.mapObjectCommands || []).filter(command =>
      !occupied.has(`${command.order.gx}:${command.order.gy}`));
  }

  /** Query in original painter order, deduplicating sprites spanning cells. */
  function terrainCommandsIn(rect) {
    const found = new Set();
    for (const cell of sceneCells(rect))
      for (const index of state.mapSceneryBuckets.get(cell) || []) found.add(index);
    return [...found].sort((a, b) => a - b).map(index => state.mapSceneryCommands[index])
      .filter(command => intersectsSceneRect(command, rect));
  }

  /** Stable merge: terrain preceded buildings in the old full sort, including ties.
   * @param {SceneCommand[]} terrain @param {SceneCommand[]} buildings
   * @returns {Generator<SceneCommand>}
   */
  function* mergeSceneCommands(terrain, buildings, overlays = null) {
    let t = 0, b = 0, next = 0;
    const overlayCount = overlays?.length || 0;
    // Select directly from all three streams: wrapping a second generator
    // would suspend/resume twice for every static scenery command.
    while (t < terrain.length || b < buildings.length) {
      const command = b >= buildings.length || (t < terrain.length
        && geo.renderOrder(terrain[t].order, buildings[b].order) <= 0)
        ? terrain[t++] : buildings[b++];
      while (next < overlayCount && geo.renderOrder(overlays[next].order, command.order) < 0)
        yield overlays[next++];
      yield command;
    }
    while (next < overlayCount) yield overlays[next++];
  }

  function visibleSceneItems() {
    const doc = currentDocument(), step = window.castleEditor?.getActiveBuildStep?.();
    if (!doc) return geo.attachDrawbridges(turnedTiles(geo.collectItems(doc, state.catalogue, step)));
    const rotation = currentRotation(), camera = viewRotation(), cache = state.geometryCache;
    if (!cache || cache.doc !== doc || cache.catalogue !== state.catalogue || cache.rotation !== rotation || cache.camera !== camera) {
      const items = turnedTiles(geo.collectItems(doc, state.catalogue, null, window.castleEditor?.getItemDefinitions?.()));
      state.geometryCache = {doc, catalogue:state.catalogue, rotation, camera, items};
      state.moatCache = items.some(item=>item.entry?.moatVariants) ? {} : null;
      // Decode every variant used by this document before scrubbing discovers it.
      const seen = new Set();
      const preload = entry => {
        if (!entry || typeof entry !== 'object' || seen.has(entry)) return;
        seen.add(entry);
        if (typeof entry.bild === 'string') image(entry.bild);
        for (const value of Object.values(entry)) if (value && typeof value === 'object') preload(value);
      };
      for (const item of items) preload(item.entry);
    }
    const items = Number.isInteger(step) ? state.geometryCache.items.filter(item => item.frameIndex <= step) : state.geometryCache.items;
    // Gates, wall/stair variants and bridges depend on visible neighbours only.
    const connected = geo.attachDrawbridges(items);
    return state.moatCache ? geo.resolveMoats(connected, state.moatCache) : connected;
  }

  function fireOverlayVisible() {
    return !!document.getElementById?.('castleShowFire')?.checked && !window.castleEditor?.isScrubbing?.();
  }

  function troopCharacterChanged() {
    const troops = window.castleTroops;
    if (!troops) return;
    const aic = window.characterEditor?.getDefensePreview?.() || null;
    const key = troops.defenseKey(aic);
    if (key === state.troopCharacterKey) return;
    state.troopCharacterKey = key;
    state.troopAic = aic;
    state.troopDocument = null;
    refresh(false, true);
  }

  function troopSceneCommands(items) {
    const troops = window.castleTroops, doc = currentDocument();
    if (!troops || !doc || !state.unitAssets) return [];
    if (!state.troopPlanner) state.troopPlanner = troops.createPlanner();
    if (state.troopDocument !== doc) {
      const plan = state.troopPlanner(doc.miscItems || [], state.troopAic);
      if (plan !== state.troopPlan) {
        state.troopPlan = plan;
        state.troopMarkers = plan.filter(marker=>marker.count).map(marker=>({
          ...marker,
          count:state.unitAssets.idleSprites?.[marker.type] ? Math.min(9,marker.count)
            : marker.destination ? 0 : 1
        }));
        state.unitCommandLimit = Math.max(128, state.troopMarkers.reduce((sum,marker)=>sum+marker.count,0)*8);
        state.unitCommands = new Map();
      }
      state.troopDocument = doc;
    }
    if (!state.troopMarkers.length) return [];
    const context = [currentRotation(),state.view.panX,state.view.panY].join('/');
    if (state.unitTerrain !== state.mapSceneryCommands || state.unitContext !== context
        || state.unitCommands.size >= state.unitCommandLimit) {
      state.unitCommands.clear();
      state.unitTerrain = state.mapSceneryCommands;
      state.unitContext = context;
    }
    const support = troops.supports(items, bodenHoehe);
    const rotation = currentRotation();
    const keep = items.find(item=>Number(item.itemType)===61);
    if (state.troopAnchorSource!==state.troopMarkers || state.troopAnchorKeep!==keep
        || state.troopAnchorRotation!==rotation) {
      state.troopAnchors = geo.troopAnchors(state.troopMarkers,keep,rotation);
      state.troopAnchorSource = state.troopMarkers;
      state.troopAnchorKeep = keep;
      state.troopAnchorRotation = rotation;
    }
    const layout = troops.layout(state.troopAnchors,(gx,gy)=>{
      const tile = geo.rotateGrid(gx,gy,1,rotation);
      return support(tile.gx,tile.gy);
    });
    const commands = [], cache = state.unitCommands;
    for (const {marker,gx,gy,elevation} of layout) {
      const tile = geo.rotateGrid(gx,gy,1,rotation);
      const pose = state.unitAssets.idleSprites?.[marker.type];
      let img;
      if (pose) {
        img = image(pose.path);
        if (!img?.complete || !img.naturalWidth) continue;
      } else {
        // Explicit rally marker for unverified siege/DE poses, not a walking
        // sprite disguised as idle. This editor-owned image is made once.
        state.unitMarkerImages ||= new Map();
        img = state.unitMarkerImages.get(marker.type);
        if (!img) {
          img = document.createElement('canvas'); img.width = 24; img.height = 20;
          const c = img.getContext('2d');
          c.fillStyle = '#173346'; c.strokeStyle = '#83c8ee';
          c.fillRect(1,1,22,16); c.strokeRect(1,1,22,16);
          c.fillStyle = '#e1f3ff'; c.font = '10px sans-serif'; c.textAlign = 'center';
          c.fillText(String(marker.type >= 9000 ? marker.type-9000 : marker.type),12,13);
          state.unitMarkerImages.set(marker.type,img);
        }
      }
      const [x,y] = geo.isoPoint(tile.gx+.5,tile.gy+.5,state.view,elevation);
      const key = [marker.ref,tile.gx,tile.gy,x,y,pose?.path || marker.type].join(':');
      let command = cache.get(key);
      if (!command) {
        const order={gx:tile.gx,gy:tile.gy,tiles:1,layer:4};
        [command] = recordSceneCommands(order,false,recorder => recorder.drawImage(img,
          x+(pose?.dx ?? -12),y+(pose?.dy ?? -20),pose?.width ?? 24,pose?.height ?? 20));
        cache.set(key,command);
      }
      commands.push(command);
    }
    return commands.sort((a,b)=>geo.renderOrder(a.order,b.order));
  }

  function paintScene(ctx, width, height, options = {}) {
    // Terrain geometry and its drawing commands do not depend on the build step.
    if (!options.reuseTerrain) state.nativeTerrain = paintMapTiles(ctx, width, height);
    if (!state.nativeTerrain) state.hoehenFeld = null;

    // Die Bodenplatten haengen an der GEDREHTEN Ecke ihres Gebaeudes, und ihr
    // eigener Versatz wird NICHT mitgedreht.
    //
    // GEMESSEN am 07.09.2026 an 201 Startplaetzen aus 60 Karten: bei 194 von
    // ihnen liegt der Lagerplatz (Bautyp 10) genau 7 Felder rechts und 2
    // Felder unter der Ecke des Bergfrieds - bei Drehung 0, 2, 4 und 6
    // gleichermassen. Der Startaufbau auf der Karte dreht sich also nicht mit;
    // das Spiel setzt ihn immer gleich hin. Genau diese 7/2 stehen auch im
    // Katalog. Wer die Platten mitdreht, schiebt den Lagerplatz von der Karte.
    const items = visibleSceneItems();
    state.renderItems = items;
    const plates = geo.collectPlates(items);

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
    const buildingSprites = [...plates.map(plate => ({ ...plate, entry: plate.sprite, layer: 1 })), ...items].flatMap(item => {
      const parts = geo.buildingParts(item);
      if (!parts) return [item];
      // Load all components before switching away from the complete fallback.
      const loaded = parts.map(part => image(part.bild));
      if (!loaded.every(img => img?.complete && img.naturalWidth)) return [item];
      const lift = bauHoehe(item.gx, item.gy, item.tiles);
      return parts.map((part, index) => ({ ...part, itemType: item.itemType, layer: item.layer ?? 2, draw: target => {
        drawNativePart(target, part, loaded[index], lift);
      }}));
    });
    // Scenery is no longer flattened underneath every building. Each upper
    // tile participates in the same depth order as the castle sprites.
    const placedCommands = [];
    for (const item of buildingSprites.sort(geo.renderOrder)) {
      const flammable = (window.castleGameData?.flammability[window.castleCostData?.buildings[item.itemType]?.balance] || 0) > 0;
      const recorded = recordSceneCommands(item, flammable, recorder => {
        if (item.draw) item.draw(recorder);
        else if (!item.entry || !drawSprite(recorder, item.entry, item.gx, item.gy, item.tiles, mauerAn, hoeheAn)) {
          const [x, y] = geo.isoPoint(item.gx, item.gy, state.view);
          const size = (item.tiles || 1) * 32;
          recorder.commands.push({order: item, flammable,
            polygon:[[item.gx,item.gy],[item.gx+item.tiles,item.gy],[item.gx+item.tiles,item.gy+item.tiles],[item.gx,item.gy+item.tiles]]
              .map(([x,y])=>geo.isoPoint(x,y,state.view,bauHoehe(item.gx,item.gy,item.tiles))),
            key: `missing:${item.gx}:${item.gy}:${item.tiles}`, x: x - size, y: y - 256, w: size * 2, h: size + 256,
            draw: target => drawDiamond(target, item.gx, item.gy, item.tiles, 'rgba(210,170,90,.55)')});
          missing++;
        }
      });
      placedCommands.push(...recorded);
    }
    const buildingCommands = [...mergeSceneCommands(visibleMapObjects(items, plates), placedCommands, troopSceneCommands(items))];
    const commandsIn = rect => mergeSceneCommands(terrainCommandsIn(rect),
      buildingCommands.filter(command => intersectsSceneRect(command, rect)));
    if (state.nativeTerrain && state.gpu) {
      state.gpu.setScene(state.mapSceneryCommands,buildingCommands,window.castleEditor?.getDocumentRevision?.(),
        fireOverlayVisible() ? [width,height] : null);
      return {items,missing,commands:buildingCommands,fireMask:null,gpu:true};
    }
    const dirty = sceneDamage(options.previousCommands, buildingCommands, width, height);
    const damagedRegions = dirty ? (dirty.regions || [dirty]).map(rect => ({rect, commands:[...commandsIn(rect)]})) : [];
    for (const {rect: dirty, commands: damagedCommands} of damagedRegions) {
      ctx.save();
      try {
        ctx.beginPath(); ctx.rect(dirty.x, dirty.y, dirty.w, dirty.h); ctx.clip();
        ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
        ctx.beginPath();
        [[0, 0], [geo.GRID, 0], [geo.GRID, geo.GRID], [0, geo.GRID]].forEach(([cx, cy], index) => {
          const [px, py] = geo.isoPoint(cx, cy, state.view);
          if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        if (!state.nativeTerrain) paintGround(ctx, width, height);
        for (const command of damagedCommands) command.draw(ctx);
      } finally { ctx.restore(); }
    }
    // Reuse the same depth-ordered commands and damage bounds for the fire mask.
    // Burnable sprites mask the halo; foreground nonburnable scenery erases that mask.
    const fireMask = typeof document !== 'undefined' && fireOverlayVisible()
      ? options.previousFireMask || document.createElement('canvas') : null;
    if (fireMask) {
      const resized = fireMask.width !== width || fireMask.height !== height;
      if (resized) { fireMask.width = width; fireMask.height = height; }
      const damage = options.previousFireMask && !resized ? dirty : {x: 0, y: 0, w: width, h: height};
      const regions = damage === dirty ? damagedRegions : damage ? [{rect:damage, commands:[...commandsIn(damage)]}] : [];
      for (const {rect:damage, commands:damagedCommands} of regions) {
        const mask = fireMask.getContext('2d'); mask.save();
        try {
          mask.beginPath(); mask.rect(damage.x, damage.y, damage.w, damage.h); mask.clip();
          mask.clearRect(damage.x, damage.y, damage.w, damage.h);
          for (const command of damagedCommands) {
            mask.globalCompositeOperation = command.flammable ? 'source-over' : 'destination-out';
            command.draw(mask);
          }
        } finally { mask.restore(); }
      }
    }
    return { items, missing, commands: buildingCommands, fireMask };
  }

  // Compare actual sprite draws, not only placement coordinates: neighbours can
  // change a wall/stair/bridge sprite when a step is added or removed. No extra
  // full-map canvases are retained for historical steps.
  function sceneDamage(previous, current, width, height) {
    if (!previous) return {x: 0, y: 0, w: width, h: height};
    const old = new Map(), next = new Map();
    for (const command of previous) old.set(command.key, (old.get(command.key) || 0) + 1);
    for (const command of current) next.set(command.key, (next.get(command.key) || 0) + 1);
    const changed = [...previous, ...current].filter(command => old.get(command.key) !== next.get(command.key));
    // A changed relative order of retained draws can alter occlusion too.
    const shared = command => old.get(command.key) === next.get(command.key);
    const before = previous.filter(shared), after = current.filter(shared);
    if (before.some((command, index) => command.key !== after[index]?.key)) return {x: 0, y: 0, w: width, h: height};
    if (!changed.length) return null;
    let left = width, top = height, right = 0, bottom = 0;
    for (const command of changed) {
      left = Math.min(left, command.x - 2); top = Math.min(top, command.y - 2);
      right = Math.max(right, command.x + command.w + 2); bottom = Math.max(bottom, command.y + command.h + 2);
    }
    left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
    const regions = [];
    for (const command of changed) {
      let r = {x:Math.max(0,Math.floor(command.x-2)), y:Math.max(0,Math.floor(command.y-2)),
        right:Math.min(width,Math.ceil(command.x+command.w+2)), bottom:Math.min(height,Math.ceil(command.y+command.h+2))};
      if (r.right<=r.x || r.bottom<=r.y) continue;
      // Join overlapping damage, never the empty space between distant edits.
      for (let i=0;i<regions.length;) {
        const b=regions[i];
        if (r.x<=b.right && r.right>=b.x && r.y<=b.bottom && r.bottom>=b.y) {
          r={x:Math.min(r.x,b.x),y:Math.min(r.y,b.y),right:Math.max(r.right,b.right),bottom:Math.max(r.bottom,b.bottom)};
          regions.splice(i,1); i=0;
        } else i++;
      }
      regions.push(r);
    }
    return {x: left, y: top, w: Math.max(0, Math.min(width, Math.ceil(right)) - left), h: Math.max(0, Math.min(height, Math.ceil(bottom)) - top),
      regions:regions.map(r=>({x:r.x,y:r.y,w:r.right-r.x,h:r.bottom-r.y}))};
  }

  // Die anderen Startplaetze der Karte. Gezeichnet wird nur das Dorffenster,
  // und die anderen Plaetze liegen weit davor - deshalb sitzt ihre Marke am
  // Rand des Bildes und zeigt als Pfeil in ihre Richtung. Liegt ein Platz
  // doch im Bild, steht die Marke an seiner Stelle. Ein Klick baut die Burg
  // auf diesem Platz auf.
  const MARKE_RAND = 36;      // so weit vom Bildrand sitzt ein Pfeil - Kreis
                              // und Dreieck muessen ganz hineinpassen
  const MARKE_RADIUS = 15;    // so gross ist der Kreis, auch zum Treffen
  function startPlaceMarks() {
    const map = gameMap();
    const target = surface();
    if (!map || !target || !Array.isArray(map.keeps) || map.keeps.length < 2) return [];
    const keep = currentKeep();
    const dreh = viewRotation();
    const mitteX = target.width / 2, mitteY = target.height / 2;
    const marken = [];
    map.keeps.forEach((platz, index) => {
      if (index === map.keepIndex) return;         // hier steht die Burg schon
      const feld = geo.viewTileForMap(platz.x, platz.y, keep, dreh);
      const [px, py] = geo.isoPoint(feld.gx + 0.5, feld.gy + 0.5, state.view, 0);
      if (px > MARKE_RAND && px < target.width - MARKE_RAND
        && py > MARKE_RAND && py < target.height - MARKE_RAND) {
        marken.push({ index, platz, x: px, y: py, zeigt: null, seite: null });
        return;
      }
      // Vom Bildmittelpunkt in Richtung des Platzes bis an den Rand. Welche
      // Kante zuerst erreicht wird, sagt auch, an welcher Seite die Marke
      // sitzt - das braucht das Entzerren gleich darunter.
      const dx = px - mitteX, dy = py - mitteY;
      const laenge = Math.hypot(dx, dy) || 1;
      const tx = (mitteX - MARKE_RAND) / (Math.abs(dx) || 1e-6);
      const ty = (mitteY - MARKE_RAND) / (Math.abs(dy) || 1e-6);
      const t = Math.min(tx, ty);
      marken.push({ index, platz, x: mitteX + dx * t, y: mitteY + dy * t,
                    zeigt: { x: dx / laenge, y: dy / laenge },
                    seite: tx <= ty ? (dx < 0 ? 'links' : 'rechts') : (dy < 0 ? 'oben' : 'unten') });
    });

    // Zwei Marken an derselben Kante duerfen sich nicht ueberdecken - sonst
    // liegt eine Nummer unter der anderen und ist nicht anklickbar. Gemessen
    // an "Crete Peninsula": von acht Startplaetzen landeten sechs an der
    // linken Kante, zwei davon 11 Punkte auseinander.
    const abstand = MARKE_RADIUS * 2 + 6;
    for (const seite of ['links', 'rechts', 'oben', 'unten']) {
      const reihe = marken.filter(marke => marke.seite === seite);
      if (reihe.length < 2) continue;
      const senkrecht = seite === 'links' || seite === 'rechts';
      const grenze = senkrecht ? target.height : target.width;
      reihe.sort((a, b) => (senkrecht ? a.y - b.y : a.x - b.x));
      // Erst von oben nach unten auseinanderschieben, dann von unten zurueck,
      // damit die letzte Marke nicht aus dem Bild gedraengt wird.
      let letzte = MARKE_RAND - abstand;
      for (const marke of reihe) {
        letzte = Math.max(senkrecht ? marke.y : marke.x, letzte + abstand);
        if (senkrecht) marke.y = letzte; else marke.x = letzte;
      }
      letzte = grenze - MARKE_RAND + abstand;
      for (const marke of [...reihe].reverse()) {
        letzte = Math.min(senkrecht ? marke.y : marke.x, letzte - abstand);
        if (senkrecht) marke.y = letzte; else marke.x = letzte;
      }
    }
    return marken;
  }

  function drawStartPlaces(ctx) {
    // Immer zuerst merken, auch wenn nichts zu malen ist: sonst bleibt nach
    // einem Kartenwechsel die alte Liste liegen, und ein Klick auf die Stelle
    // einer Marke wechselt auf eine Burg, die es nicht mehr gibt.
    const marken = startPlaceMarks();
    state.startMarks = marken;
    if (!marken.length) return;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const marke of marken) {
      if (marke.zeigt) {
        // Ein Dreieck, das nach draussen zeigt - dorthin, wo der Platz liegt.
        const winkel = Math.atan2(marke.zeigt.y, marke.zeigt.x);
        ctx.save();
        ctx.translate(marke.x, marke.y);
        ctx.rotate(winkel);
        ctx.beginPath();
        ctx.moveTo(MARKE_RADIUS + 11, 0);
        ctx.lineTo(MARKE_RADIUS + 1, -8);
        ctx.lineTo(MARKE_RADIUS + 1, 8);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 226, 150, .92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(40, 30, 10, .85)';
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(marke.x, marke.y, MARKE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28, 24, 18, .78)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 226, 150, .92)';
      ctx.stroke();
      ctx.fillStyle = '#ffe296';
      // Die Nummer kommt aus der Karte, nicht aus der Fundreihenfolge - sonst
      // steht am Pfeil eine andere Burg als im Spiel.
      ctx.fillText(String(marke.platz.player || (marke.index + 1)), marke.x, marke.y + 1);
    }
    ctx.restore();
  }

  // Hat der Zeiger eine Marke getroffen? Dann wird nicht gebaut, sondern die
  // Burg wechselt auf diesen Startplatz.
  function startPlaceAt(px, py) {
    for (const marke of state.startMarks || []) {
      if (Math.hypot(px - marke.x, py - marke.y) <= MARKE_RADIUS + 4) return marke;
    }
    return null;
  }

  function paintInteraction(ctx, items) {
    if (state.hover) drawDiamond(ctx, state.hover.gx, state.hover.gy, 1, null, 'rgba(255,255,255,.5)');
    drawSelection(ctx, items);
    drawPreview(ctx);
    drawMarquee(ctx);
    drawStartPlaces(ctx);
  }

  // Wie hoch der Boden unter dem Dorf steigt, aus dem Kachelvorrat. Frueher
  // brachte das Gelaendebild diese Hoehen mit; seit es weg ist, stehen sie im
  // Vorrat. 10.000 Felder werden nur einmal je Karte und Startplatz gezaehlt,
  // nicht bei jedem Bild.
  function dorfHoehen() {
    const atlas = vorrat();
    const schluessel = kartenSchluessel();
    if (!atlas?.hoehen || !schluessel) return null;
    if (state.hoehenSpanne?.key === schluessel) return state.hoehenSpanne.wert;
    const keep = currentKeep();
    let tief = 255, hoch = 0;
    for (let gy = 0; gy < geo.GRID; gy += 1) {
      for (let gx = 0; gx < geo.GRID; gx += 1) {
        const wert = geo.mapTileHeight(gx, gy, keep, atlas.hoehen);
        if (wert < tief) tief = wert;
        if (wert > hoch) hoch = wert;
      }
    }
    const wert = { tief, hoch };
    state.hoehenSpanne = { key: schluessel, wert };
    return wert;
  }

  // Was in der Statuszeile ueber die Karte steht. Die Drehung gehoert dorthin,
  // weil man ihr sonst nur ansieht, DASS etwas anders liegt, aber nicht warum.
  function mapStatus() {
    const map = gameMap();
    if (!map) return '';
    const keep = currentKeep();
    const platz = map.keeps.length
      ? tr(keep.player ? 'details:map_start' : 'details:map_start_place', {number:keep.player || map.keepIndex+1,x:keep.x,y:keep.y})
      : tr("viewport:no_starting_place_village_in_the_middle_of_the_map");
    // Die Zahl des Spiels wird mitgenannt: 0/2/4/6 ist das, was in
    // keepOrientation steht, und nur damit laesst sich nachrechnen.
    const drehung = keep.orientation
      ? tr('details:map_rotation', {turns:tr('quantity:quarter_turn',{count:keep.orientation/2}),value:keep.orientation})
      : (map.keeps.length ? tr("viewport:not_turned_game_value_0") : '');
    // Und ob der Boden Hoehen hat. Ohne diese Zeile sieht man dem Bild nur an,
    // DASS etwas anders liegt, aber nicht warum - und ob es an dieser Karte
    // liegt.
    const spanne = dorfHoehen();
    let hoehe = '';
    if (spanne) {
      hoehe = spanne.hoch === spanne.tief ? tr('details:map_flat',{height:spanne.hoch})
        : tr('details:map_height',{range:spanne.hoch-spanne.tief,minimum:spanne.tief,maximum:spanne.hoch});
    }
    return tr('details:map_name',{name:map.name}) + platz + drehung + hoehe;
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
    const existing = state.renderItems || [];
    const counts = new Map();
    for (const item of existing) counts.set(item.itemType, (counts.get(item.itemType) || 0) + 1);
    const pending = turnedTiles(vorschau.tiles.map(feld => {
      const itemType = feld.itemType != null ? feld.itemType : vorschau.itemType;
      const entry = nachschlagen(itemType), layoutIndex = counts.get(itemType) || 0;
      counts.set(itemType, layoutIndex + 1);
      return { gx: feld.x, gy: geo.GRID - 1 - feld.y, itemType, entry, layoutIndex, tiles: entry ? entry.kacheln : 1 };
    }));
    const combined = geo.attachDrawbridges([...existing, ...pending]);
    const kuenftig = (pending.some(item=>item.entry?.moatVariants)
      ? geo.resolveMoats(combined, {}) : combined).slice(existing.length);
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
      if (!eintrag || !drawSprite(ctx, eintrag, feld.gx, feld.gy, kacheln, mauerAn, hoeheAn, feld.layoutIndex))
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
  function refresh(reuseScene = false, contentOnly = false, immediate = false) {
    if (reuseScene !== true && !contentOnly) state.assetRevision = (state.assetRevision || 0) + 1;
    // A document/image update must win over a camera update queued this frame.
    if (reuseScene !== true) state.sceneDirty = true;
    if (hostIsGone()) return;
    if (immediate) { paint(); return; }
    if (state.paintPending) return;
    state.paintPending = true;
    requestAnimationFrame(() => { if (state.paintPending) paint(); });
  }

  function setStatus(text) {
    if (state.host && state.host.statusEl) window.toolkitI18n.bindText(state.host.statusEl, text);
  }

  function fit() { state.fitted = false; refresh(true); }

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
    // Pointer feedback only changes overlays. Committed edits (and build-step
    // changes) invalidate the scene through editorChanged, not each drag event.
    refresh(true);
  }

  // Bound once per canvas, and a canvas belongs to exactly one host for its
  // whole life, so nothing here ever needs unbinding.
  function bindSurface(canvas) {
    if (!canvas || state.bound.has(canvas)) return;
    state.bound.add(canvas);
    canvas.tabIndex = 0;

    window.castlePieMenu.bind(canvas, (action, position) => window.castleEditor?.runContextAction(action, position), action => window.castleEditor?.getShortcut(action), () => window.castleEditor?.neutralContextAction());

    canvas.addEventListener('pointerdown', event => {
      canvas.focus({ preventScroll: true });
      if (event.button !== 0 && event.button !== 1) return;
      // In a narrow docked panel the pointer leaves the canvas mid-stroke.
      // Without capture the matching pointerup goes to another element and
      // state.drawing would stay stuck on.
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events have no pointer */ }
      if (event.button === 1) {                          // middle: pan, as on Map
        event.preventDefault();
        state.panning = true;
        const p = pointOf(canvas, event);
        state.panStart = { x: p.x, y: p.y, panX: state.view.panX, panY: state.view.panY };
        return;
      }
      const p = pointOf(canvas, event);
      const marke = startPlaceAt(p.x, p.y);
      if (marke) {
        setGameMapKeep(marke.index);
        window.castleEditor?.updateMapControls?.();
        const nummer = marke.platz.player || (marke.index + 1);
        window.castleEditor?.setStatus?.(() => tr("viewport:castle_moved_to_start_value_at_value_value", { nummer: nummer, x: marke.platz.x, y: marke.platz.y }));
        return;
      }
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
        refresh(true);
        return;
      }
      const tile = editorTileAt(p.x, p.y);
      const grid = geo.tileFromPoint(p.x, p.y, state.view, bodenHoehe);
      // Ueber einer Startplatzmarke sagt der Zeiger, dass sie anklickbar ist -
      // sonst sieht man einen Kreis mit Zahl und weiss nicht, was er tut.
      const ueberMarke = startPlaceAt(p.x, p.y);
      canvas.style.cursor = ueberMarke ? 'pointer' : '';
      canvas.title = ueberMarke
        ? tr("viewport:start_value_at_value_value_click_to_build_here", { value1: ueberMarke.platz.player || (ueberMarke.index + 1), x: ueberMarke.platz.x, y: ueberMarke.platz.y })
        : (window.castleEditor?.itemLabelAtTile?.(tile) || '');
      const moved = !state.hover || !grid || state.hover.gx !== grid.gx || state.hover.gy !== grid.gy;
      state.hover = grid;
      if (tile && (state.drawing || moved)) toEditor('move', event, tile);
      else if (moved) refresh(true);
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
    canvas.addEventListener('pointerleave', () => { state.hover = null; refresh(true); });

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const preferences = window.castleEditor?.getCameraPreferences?.() || window.castleCamera.defaults;
      const action = window.castleCamera.wheelAction(event, preferences);
      if (action !== 'zoom') {
        state.view[action] -= event.deltaY || event.deltaX;
        refresh(true);
        return;
      }
      if (!event.deltaY) return;
      const before = state.view.zoom;
      const next = Math.max(0.15, Math.min(8, before * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const p = pointOf(canvas, event);
      state.view.zoom = next;
      state.view.panX = p.x - (p.x - state.view.panX) * (next / before);
      state.view.panY = p.y - (p.y - state.view.panY) * (next / before);
      refresh(true);
    }, { passive: false });
  }

  // Everything around the drawing surface, and the one place the two hosts
  // really differ: a window has to be told about its own size and keys, a
  // panel is watched by a ResizeObserver and shares the app's keyboard.
  function bindHostChrome(host) {
    if (host.kind === 'dock') {
      // Paint inside the callback: it runs after layout and before the frame is
      // shown, so a splitter drag never shows the moved panel with last frame's
      // picture. A rAF paint would land one frame late and make the view shake.
      if (!state.observer) state.observer = new ResizeObserver(() => refresh(true, false, true));
      state.observer.disconnect();
      state.observer.observe(host.box);
      return;
    }
    const win = host.win;
    win.addEventListener('resize', () => refresh(true));
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
      refresh(true);
    });
  }

  // ------------------------------------------------------------- hosts

  function parkControls() {
    const store = document.getElementById('castleWindowStore');
    if (state.controls && store && state.controls.parentElement !== store) {
      store.appendChild(state.controls);
    }
    if (state.controls) window.toolkitI18n?.applyBindings(state.controls);
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
    refresh(true);
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
    if (state.controls) window.toolkitI18n?.applyBindings(state.controls);
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
    window.electronAPI?.prepareViewportWindow?.(win);
    unmount();
    win.document.title = tr("viewport:2_5d_view_ai_toolkit");
    win.document.body.innerHTML =
      '<div id="isoWindowChrome"><strong>2.5D</strong><div id="isoWindowControlSlot"></div>' +
      `<span class="isoWindowFill"></span><button id="isoWindowDockBtn" type="button" data-i18n="castle:dock">${globalThis.toolkitI18n.html("castle:dock")}</button></div>` +
      '<div id="isoWindowHost">' +
      '<canvas id="isoWindowCanvas"></canvas>' +
      '</div>' +
      '<div id="isoWindowStatus"></div>';
    window.ToolkitTheme?.attachWindow(win);
    const controlSlot = win.document.getElementById('isoWindowControlSlot');
    if (controlSlot && state.controls) controlSlot.appendChild(state.controls);
    window.toolkitI18n?.attachWindow(win);
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

  // A 2D pan or selection invalidates that canvas, but does not change the
  // isometric scene. Compare content only on static editor notifications.
  function editorChanged(staticChanged) {
    if (!staticChanged) { refresh(true); return; }
    const revision = window.castleEditor?.getDocumentRevision?.();
    const key = revision == null
      ? JSON.stringify([currentDocument(), window.castleEditor?.getActiveBuildStep?.()])
      : `${revision}:${window.castleEditor?.getActiveBuildStep?.()}`;
    const changed = key !== state.editorSceneKey;
    state.editorSceneKey = key;
    refresh(!changed, true, true);
  }

  function init() {
    // The toolbar button belongs to panel-view.js: it decides where this
    // view is shown, this file only knows how to be shown.
    bindSurface(document.getElementById('isoDockCanvas'));
    state.controls = document.getElementById('castleIsoControls');
    window.castleEditor?.addChangeListener?.(editorChanged);
    window.addEventListener('character-population-changed', troopCharacterChanged);
    troopCharacterChanged();
    loadUnitSprites();
    loadCatalogue();
  }

  window.isoView = { init, openWindow, closeWindow, mountDock, unmount, refresh, paint, fit, isMounted, panFromKey,
                     findControl: id => state.controls?.querySelector(`#${id}`),
                     setGameMap, setGameMapKeep, hasGameMap, gameMapInfo, reloadGameAssets,
                     viewRotation, turnView, currentRotation,
                     setMapTiles, hasMapTiles, analysisTerrain, setMapLoadError,
                     // Fuer das Pruefgeruest: wo die Kamera steht und welche Marken liegen.
                     viewInfo: () => ({ ...state.view, rotation: currentRotation(), hand: viewRotation() }),
                     startPlaceMarks };

  window.toolkitI18n?.onChange(() => {
    // The toolbar can be between documents during docking. Translate its
    // existing nodes explicitly instead of relying on a document-wide scan.
    if (state.controls) window.toolkitI18n?.applyBindings(state.controls);
    if (state.host?.kind === 'window' && !state.host.win.closed) {
      state.host.win.document.title = tr("viewport:2_5d_view_ai_toolkit");
    }
    if (state.host) refresh(true);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
