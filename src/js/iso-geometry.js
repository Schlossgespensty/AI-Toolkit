// Geometry for the 2.5D view — pure functions, no canvas, no DOM.
// Kept separate from iso-view.js so it can be tested with node --test.
//
// Two coordinate systems meet here:
//
//   Editor:  offset = y * 100 + x, and y counts UPWARDS
//            (screen row = 99 - y, see screenRectForFootprintRect)
//   Sprites: x to the right, y DOWNWARDS, like the .gm1 tiles are laid out
//
// So the translation is gx = x, gy = 99 - y. Everything else follows from it.

(function exposeIsoGeometry(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.isoGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const GRID = 100;
  const HALF_W = 16;          // half a tile in game points
  const HALF_H = 8;

  // Editor offset -> grid coordinates of the item's top-left tile
  function gridFromOffset(offset) {
    const x = offset % GRID;
    const y = Math.floor(offset / GRID);
    return { gx: x, gy: (GRID - 1) - y };
  }

  function offsetFromGrid(gx, gy) {
    return ((GRID - 1) - gy) * GRID + gx;
  }

  // Screen point of a grid corner
  function isoPoint(gx, gy, view) {
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    return [view.panX + (gx - gy) * hw, view.panY + (gx + gy) * hh];
  }

  // The other way round: which tile is under a point on screen? Solving
  //   px = panX + (gx - gy) * hw
  //   py = panY + (gx + gy) * hh
  // for gx and gy. Returns null outside the grid.
  function tileFromPoint(px, py, view) {
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    const a = (px - view.panX) / hw;      // gx - gy
    const b = (py - view.panY) / hh;      // gx + gy
    const gx = Math.floor((a + b) / 2);
    const gy = Math.floor((b - a) / 2);
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return null;
    return { gx, gy };
  }

  // A point on screen straight into the editor's own tile coordinates
  function editorTileFromPoint(px, py, view) {
    const grid = tileFromPoint(px, py, view);
    if (!grid) return null;
    return { x: grid.gx, y: (GRID - 1) - grid.gy };
  }

  // What is further back has to be painted first. The measure is the lowest
  // corner of the item: an item of n tiles reaches n-1 further in both
  // directions.
  function depth(item) {
    return item.gx + item.gy + 2 * ((item.tiles || 1) - 1);
  }

  // Eine Mauer hat kein festes Bild. Das Spiel rechnet jedes Feld neu, und
  // zwei Fragen entscheiden - beide beantwortet computeWallCornerRenderRotation
  // (0x004fc650):
  //
  //  1. LAEUFT die Mauer durch dieses Feld? Sie tut es, wenn BEIDE Nachbarn
  //     derselben Achse Mauer sind und keiner mehr als 16 Punkte niedriger
  //     ist (isWallConnectionHeightValid 0x004f8840). Laeuft sie in x, liegt
  //     das naechste Feld 16 Punkte rechts und verdeckt die rechte Haelfte -
  //     sichtbar bleibt die besonnte Seite. Laeuft sie in y, liegt es 16
  //     Punkte links, sichtbar bleibt die beschattete. Dafuer traegt der
  //     Katalog zwei Saetze Bilder: laengs und quer. Laeuft sie nicht durch,
  //     entscheidet allein, wer das Feld verdeckt: ein Nachbar in x nimmt
  //     die rechte Haelfte weg (rand.laengs), einer in y die linke
  //     (rand.quer), gar keiner nichts (rand.allein, der freistehende
  //     Pfeiler mit beiden Seiten). Im Spiel sind das 0x30, 0x3f und 0x21.
  //  2. WELCHES der sechzehn Bilder eines Satzes? Das sagt x & 15 bzw.
  //     y & 15, damit sich das Mauerwerk nicht alle paar Felder wiederholt.
  //
  // Die Krone wechselt unabhaengig davon: Klotz bei x + y ungerade, sonst die
  // flache Scharte - placeDefensiveStructureTile (0x005034a0) setzt dafuer
  // LogicLayer 0x400000. gy zaehlt den Bildschirm hinunter, darum wird die
  // Editor-Koordinate y zuerst zurueckgerechnet.
  //
  // mauerAn(gx, gy) liefert den Mauereintrag eines Nachbarfeldes oder null.
  // Fehlt er, bleibt es beim Einzelbild - die Ansicht sieht dann aus wie
  // vorher, statt zu bruchlanden.
  // Eine Treppe hat, anders als bisher gezeichnet, eine HOEHE - und zwar je
  // Stufe eine andere. Gemessen in placeDefensiveStructureTile (0x005034a0):
  // Mapper 181 steht 80 Punkte ueber dem Boden, 182 auf 64, 183 auf 48,
  // 184 auf 32, 185 auf 16, 186 auf 0. Die fertigen Bilder bringen diese Hoehe
  // schon als Koerper mit (lib/webbilder.js, TREPPEN_HOEHE), darum steigt eine
  // gezogene Treppe von allein: das Bild von Stufe 1 ist 64 Punkte hoeher als
  // das von Stufe 5, und spriteRect setzt beide auf ihrer Kachel ab.
  //
  // Zu entscheiden bleibt nur, WELCHE der vier Ansichten ein Feld bekommt.
  // Das Spiel sucht dafuer den hoeheren Nachbarn - eine hoehere Treppe
  // (hasHigherNeighborWithStairs) oder eine hoehere Mauer
  // (hasHigherPlainNeighborWithWallOrGatehouse) - und nimmt das Bild dieser
  // Seite; findet es keinen, das flache Podest.
  //
  // Aus dem Programm gelesen: Richtung 0 -> #134, 2 -> #135, 4 -> #136,
  // 6 -> #133 (updateGfxLayer 0x00509180). Welches NACHBARFELD Richtung 0
  // ist, steht dort nicht - directionTranslationMatrix wird erst im laufenden
  // Spiel gefuellt. Diese Tabelle ist darum am Bild gemessen, mit einem
  // harten Kriterium: eine Treppe von fuenf Stufen an einer Mauer wurde in
  // jede Richtung mit jedem der vier Bilder gezeichnet, und genau eine
  // Zuordnung setzt die fuenf Stufen zu EINEM durchgehenden Treppenlauf
  // zusammen - bei den anderen drei stehen fuenf einzelne, quer stehende
  // Treppchen da. Probebilder vom 06.09.2026 (11_richtung_*, 12_gy_*,
  // 13_gxplus_*): gx-1 -> r6, gy-1 -> r0, gx+1 -> r2, und damit gy+1 -> r4.
  const TREPPEN_NACHBAR = [
    ['r0', 0, -1],   // hoeherer Nachbar bei gy-1, Bildschirm rechts oben
    ['r2', 1, 0],    //                     gx+1,             rechts unten
    ['r4', 0, 1],    //                     gy+1,             links unten
    ['r6', -1, 0],   //                     gx-1,             links oben
  ];

  // Die Reihenfolge ist nicht beliebig: updateGfxLayer fragt ERST alle vier
  // Richtungen nach einer hoeheren TREPPE ab und danach erst alle vier nach
  // einer hoeheren MAUER. Das ist kein Feinschliff, sondern der Normalfall -
  // jedes Treppenfeld einer AIV liegt an einer Steinmauer, also hat fast jede
  // Stufe beides als Nachbarn. Wer nur einmal durchlaeuft, richtet die halbe
  // Treppe zur Mauer statt zur naechsten Stufe.
  function treppenFassung(sprite, gx, gy, hoeheAn) {
    const treppe = sprite.treppe;
    let gewaehlt = treppe.richtungen.allein;
    if (typeof hoeheAn === 'function') {
      const suche = (art) => {
        for (const [richtung, dx, dy] of TREPPEN_NACHBAR) {
          const nachbar = hoeheAn(gx + dx, gy + dy);
          if (!nachbar || nachbar.art !== art) continue;
          if (nachbar.hoehe > treppe.hoehe && treppe.richtungen[richtung])
            return treppe.richtungen[richtung];
        }
        return null;
      };
      gewaehlt = suche('treppe') || suche('mauer') || gewaehlt;
    }
    if (!gewaehlt) return sprite;
    return { bild: gewaehlt.bild, breite: gewaehlt.breite,
             hoehe: gewaehlt.hoehe, kacheln: sprite.kacheln };
  }

  function variantFor(sprite, gx, gy, mauerAn, hoeheAn) {
    if (!sprite) return sprite;
    if (sprite.treppe) return treppenFassung(sprite, gx, gy, hoeheAn);
    const y = (GRID - 1) - gy;
    const klotz = (((gx + y) % 2) + 2) % 2 === 1;
    const mauer = sprite.mauer;
    if (!mauer) {
      if (!sprite.wechselBild || klotz) return sprite;
      return { bild: sprite.wechselBild, breite: sprite.wechselBreite,
               hoehe: sprite.wechselHoehe, kacheln: sprite.kacheln };
    }
    const welche = (klotz || !mauer.rand.allein.scharte) ? 'klotz' : 'scharte';
    let gewaehlt = mauer.rand.allein[welche];
    if (typeof mauerAn === 'function') {
      const traegt = (nx, ny) => {
        const nachbar = mauerAn(nx, ny);
        return !!nachbar && nachbar.hoehe >= mauer.hoehe - 16;
      };
      // Was VOR diesem Feld liegt, wird spaeter gemalt und verdeckt es zur
      // Haelfte: (gx+1, gy) nimmt die rechte, (gx, gy+1) die linke.
      if (traegt(gx - 1, gy) && traegt(gx + 1, gy)) gewaehlt = mauer.laengs[welche][gx & 15];
      else if (traegt(gx, gy - 1) && traegt(gx, gy + 1)) gewaehlt = mauer.quer[welche][y & 15];
      else if (traegt(gx + 1, gy)) gewaehlt = mauer.rand.laengs[welche];
      else if (traegt(gx, gy + 1)) gewaehlt = mauer.rand.quer[welche];
    }
    if (!gewaehlt) gewaehlt = mauer.rand.allein[welche];
    return { bild: gewaehlt.bild, breite: gewaehlt.breite,
             hoehe: gewaehlt.hoehe, kacheln: sprite.kacheln };
  }

  // Nachschlagewerk fuer die Regel oben: welches Feld traegt eine Mauer.
  // Aus den Gegenstaenden, die ohnehin schon eingesammelt sind.
  function wallLookup(items, extra) {
    const felder = new Map();
    const eintragen = (gx, gy, entry) => {
      if (entry && entry.mauer) felder.set(gx + ':' + gy, entry.mauer);
    };
    for (const item of items || []) eintragen(item.gx, item.gy, item.entry);
    for (const item of extra || []) eintragen(item.gx, item.gy, item.entry);
    return (gx, gy) => felder.get(gx + ':' + gy) || null;
  }

  // Wie hoch ein Feld ist und was darauf steht - fuer die Treppenregel oben.
  // Eine Hoehe tragen bisher nur Mauern und Treppen; alles andere liefert
  // null, denn was das Spiel als Hoehe verbucht, ist bei den uebrigen Bauten
  // nicht gemessen. Zurueck kommt { hoehe, art } mit art 'treppe', 'mauer'
  // oder 'zinne'.
  //
  // 'zinne' steht getrennt, weil eine Zinnenmauer fuer die Treppe NICHT
  // zaehlt: hasHigherPlainNeighborWithWallOrGatehouse (0x004f8ac0) verlangt
  // L_WALL_OR_GATEHOUSE und schliesst L_CRENEL (0x200) aus.
  //
  // Liegen zwei Dinge auf einem Feld, gilt das hoehere.
  function hoehenLookup(items, extra) {
    const felder = new Map();
    const eintragen = (gx, gy, entry) => {
      if (!entry) return;
      const wert = entry.treppe ? { hoehe: entry.treppe.hoehe, art: 'treppe' }
                 : entry.mauer ? { hoehe: entry.mauer.hoehe, art: entry.mauer.zinne ? 'zinne' : 'mauer' }
                 : null;
      if (!wert) return;
      const schluessel = gx + ':' + gy;
      const bisher = felder.get(schluessel);
      if (!bisher || wert.hoehe > bisher.hoehe) felder.set(schluessel, wert);
    };
    for (const item of items || []) eintragen(item.gx, item.gy, item.entry);
    for (const item of extra || []) eintragen(item.gx, item.gy, item.entry);
    return (gx, gy) => felder.get(gx + ':' + gy) || null;
  }

  // Where a sprite goes: centred on the lowest tile, its bottom edge one
  // half tile below that tile's centre - the same rule the .gm1 files use.

  function spriteRect(sprite, gx, gy, tiles, view) {
    const [sx, sy] = isoPoint(gx + tiles - 1, gy + tiles - 1, view);
    const k = view.zoom;
    return {
      x: sx - (sprite.breite / 2) * k,
      y: sy - (sprite.hoehe - HALF_H * 2) * k,
      w: sprite.breite * k,
      h: sprite.hoehe * k
    };
  }

  // Every placed item of a castle document, ready to be sorted and drawn.
  // Der Umriss eines Auswahlkastens in Iso-Punkten. Das Rechteck kommt in
  // Editor-Koordinaten, wo y nach OBEN zaehlt; hier wird es in das
  // Bildschirmsystem gedreht (gy = 99 - y) und um eine Kachel erweitert, weil
  // der Kasten die Felder umschliesst und nicht ihre Mittelpunkte.
  // Die Ecken sind Gitterpunkte, keine Felder: Feld (gx,gy) belegt das Quadrat
  // von (gx,gy) bis (gx+1,gy+1). Ein Gitterpunkt dreht sich darum mit GRID-p
  // und nicht mit GRID-1-p - eine Eins Unterschied, aber sie verschoebe den
  // Kasten um ein ganzes Feld.
  function rotateCorner(gx, gy, orientation) {
    switch (Number(orientation) || 0) {
      case 2: return [gy, GRID - gx];
      case 4: return [GRID - gx, GRID - gy];
      case 6: return [GRID - gy, gx];
      default: return [gx, gy];
    }
  }

  function marqueeOutline(box, view, orientation) {
    if (!box) return null;
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1) + 1;
    const yLow = Math.min(box.y0, box.y1), yHigh = Math.max(box.y0, box.y1);
    const gy0 = GRID - 1 - yHigh, gy1 = GRID - 1 - yLow + 1;
    return [[x0, gy0], [x1, gy0], [x1, gy1], [x0, gy1]]
      .map(([gx, gy]) => rotateCorner(gx, gy, orientation))
      .map(([gx, gy]) => isoPoint(gx, gy, view));
  }

  function collectItems(document_, catalogue) {
    const out = [];
    if (!document_ || !Array.isArray(document_.frames)) return out;
    const items = (catalogue && catalogue.gegenstaende) || {};
    document_.frames.forEach((frame, frameIndex) => {
      const entry = items[String(frame.itemType)] || null;
      const offsets = Array.isArray(frame.tilePositionOfsets) ? frame.tilePositionOfsets : [];
      offsets.forEach((offset, offsetIndex) => {
        const { gx, gy } = gridFromOffset(offset);
        out.push({
          gx, gy, entry, frameIndex, offsetIndex,
          // Derselbe Schluessel, den castle-editor.js fuer die Auswahl
          // vergibt (frameRefKey). Ohne ihn koennte die Ansicht nicht sagen,
          // welcher Gegenstand ausgewaehlt ist.
          ref: 'f:' + frameIndex + ':' + offsetIndex,
          itemType: frame.itemType,
          tiles: entry ? entry.kacheln : 1
        });
      });
    });
    return out;
  }

  // Ground plates that belong next to an item (keep courtyard, training
  // grounds, guild yards). Their offsets are counted from the item's
  // top-left tile, in the sprite coordinate system.
  function collectPlates(items) {
    const out = [];
    for (const item of items) {
      const plates = (item.entry && item.entry.platten) || [];
      for (const plate of plates) {
        out.push({
          gx: item.gx + plate.dx,
          gy: item.gy + plate.dy,
          tiles: plate.kacheln,
          sprite: plate
        });
      }
    }
    return out;
  }

  function byDepth(a, b) { return depth(a) - depth(b); }

  // ------------------------------------------------- eine Karte des Spiels
  //
  // Eine .map bringt ein Vorschaubild von 200x200 Punkten mit. Das ist die
  // ganze Karte, senkrecht von oben - und zwar die um 45 Grad GEDREHTE Raute
  // (VillageStudio/doku/Wissensstand.md, Abschnitt 1b5):
  //
  //   Kartenfeld -> Vorschaupunkt, nur fuer mx+my ungerade:
  //     px = (mx - my + 199) / 2      py = (mx + my - 199) / 2
  //
  // Unsere 2.5D-Ansicht dreht ihr eigenes Raster um genau dieselben 45 Grad:
  //     Sx = panX + (gx - gy) * 16z   Sy = panY + (gx + gy) * 8z
  //
  // ZWEIMAL DIESELBE DREHUNG HEBT SICH AUF. Wer die Vorschau fuer ein Quadrat
  // haelt und sie schraeg stellt, dreht ein zweites Mal und liegt schief. Das
  // Bild braucht KEINE Drehung, nur eine Verschiebung und eine Streckung 2:1 -
  // ein Vorschaupunkt ist so breit wie eine Kachel (32) und so hoch wie eine
  // Kachel (16). Nachgerechnet, nicht ausprobiert:
  //
  //   mx = keep.x - 43 + gx           my = keep.y - 43 + gy
  //   => gx - gy = 2*px - (keep.x - keep.y + 199)
  //      gx + gy = 2*py - (keep.x + keep.y - 285)
  //
  // Setzt man das in Sx/Sy ein, fallen px und py mit dem Faktor 32z bzw. 16z
  // heraus, und uebrig bleibt eine feste Ecke. Genau die liefert mapPreviewRect.
  const MAP_PREVIEW_EDGE = 200;   // Kantenlaenge des Vorschaubildes
  const KEEP_TILE = 43;           // Dorffeld (43,43) sitzt auf dem Startplatz

  // ------------------------------------------------------------ die Drehung
  //
  // WELCHE Drehung eine Burg bekommt, entscheidet das Spiel allein aus der
  // Lage des Startplatzes zur Kartenmitte (200,200). Zwei Funktionen:
  //
  //   calculatePreferredRelativeOrientation (0x0046c9e0) liefert 0 bis 7,
  //   setKeepOffsetAndOrientation (0x004ecf70) nimmt davon das unterste Bit
  //   weg UND VERTAUSCHT DANN 2 MIT 6. Der Tausch steht woertlich dort und ist
  //   leicht zu ueberlesen - ohne ihn stehen zwei von vier Burgen quer.
  //
  // Heraus kommt 0, 2, 4 oder 6. Nur ein Startplatz genau auf (200,200) gaebe
  // 14, was rotateAIV gar nicht kennt; auf keiner der 113 Karten des Spiels
  // kommt das vor (nachgezaehlt), hier wird es wie 0 behandelt.
  const MAP_CENTRE = 200;

  function keepOrientation(x, y) {
    const dx = Math.abs(x - MAP_CENTRE);
    const dy = Math.abs(y - MAP_CENTRE);
    let orientation;
    if (dy * 2 < dx) orientation = x > MAP_CENTRE ? 6 : 2;
    else if (dx * 2 < dy) orientation = y > MAP_CENTRE ? 0 : 4;
    else if (y > MAP_CENTRE) orientation = x <= MAP_CENTRE ? 1 : 7;
    else if (y < MAP_CENTRE) orientation = x > MAP_CENTRE ? 5 : 3;
    else return 0;
    const even = orientation & 0xfffe;
    if (even === 2) return 6;
    if (even === 6) return 2;
    return even;
  }

  //
  // Das Spiel stellt eine Burg nicht so hin, wie sie in der Datei steht: als
  // ERSTES ruft applyAIV (0x004ef0d0) rotateAIV (0x004ed0b0) und dreht das
  // ganze 100x100-Raster. Erst danach wird jedes Feld auf die Karte gelegt.
  // Der Ansatzpunkt bleibt dabei unveraendert - Dorffeld (43,43) sitzt immer
  // auf dem Startplatz, gedreht oder nicht.
  //
  // Die drei Kopierschleifen in rotateAIV, zurueckgelesen als Abbildung
  // "wohin wandert ein Feld" (vorwaerts, nicht rueckwaerts):
  //
  //   0: (x, y)          2: (y, 99-x)      4: (99-x, 99-y)     6: (99-y, x)
  //
  // Gegenprobe im selben Programm: applyAIV rechnet die Truppenplaetze mit
  // genau diesen vier Faellen um (99-y/99-x fuer 4, y/99-x fuer 2, ...).
  //
  // gx und gy sind hier dieselben Zahlen wie im Dorfraster: der Editor legt
  // seine Versaetze mit umgedrehter Zeile ab (Bergfried (43,43) -> 5643), und
  // gridFromOffset dreht sie wieder um. Zweimal gedreht ist gerade.
  //
  // WARUM DIE KACHELZAHL MITMUSS: ein Gebaeude von n Feldern haengt an seiner
  // Ecke mit dem kleinsten gx und gy. Nach einer Vierteldrehung ist das eine
  // ANDERE Ecke des Bauwerks, also muss der Ansatz um n-1 zurueckgesetzt
  // werden. Wer das vergisst, verschiebt jedes grosse Gebaeude um seine eigene
  // Groesse - beim Bergfried um sieben Felder.
  function rotateGrid(gx, gy, tiles, orientation) {
    const n = Math.max(1, Number(tiles) || 1);
    const last = GRID - n;            // groesster Ansatz, den ein n-Feld-Bau hat
    switch (Number(orientation) || 0) {
      case 2: return { gx: gy, gy: last - gx };
      case 4: return { gx: last - gx, gy: last - gy };
      case 6: return { gx: last - gy, gy: gx };
      default: return { gx, gy };
    }
  }

  // Und zurueck - fuer die Maus. Was auf dem Bildschirm angeklickt wird, ist
  // ein gedrehtes Feld; der Editor kennt aber nur das ungedrehte.
  function unrotateGrid(gx, gy, orientation) {
    const last = GRID - 1;
    switch (Number(orientation) || 0) {
      case 2: return { gx: last - gy, gy: gx };
      case 4: return { gx: last - gx, gy: last - gy };
      case 6: return { gx: gy, gy: last - gx };
      default: return { gx, gy };
    }
  }

  // Welches Kartenfeld unter einem Dorffeld liegt.
  function mapTileForGrid(gx, gy, keep) {
    return { mx: keep.x - KEEP_TILE + gx, my: keep.y - KEEP_TILE + gy };
  }

  // Und welchen Punkt der Vorschau ein Kartenfeld belegt. Nur Felder mit
  // ungeradem mx+my haben einen eigenen Punkt; die anderen liegen dazwischen.
  function previewPointForMapTile(mx, my) {
    return { px: (mx - my + MAP_PREVIEW_EDGE - 1) / 2,
             py: (mx + my - (MAP_PREVIEW_EDGE - 1)) / 2 };
  }

  // Hat eine Karte keinen Startplatz, wird das Dorf in die Kartenmitte
  // gestellt: Dorffeld (50,50) auf den mittleren Vorschaupunkt (100,100),
  // also auf das Kartenfeld (200,199).
  // Ohne Startplatz gibt es auch keine Drehung: die Drehung kommt aus der Lage
  // des Startplatzes, und einen erfundenen Platz zu drehen hiesse, eine Zahl
  // zu erfinden.
  function centreKeep() {
    return { x: MAP_PREVIEW_EDGE - GRID / 2 + KEEP_TILE,
             y: (MAP_PREVIEW_EDGE - 1) - GRID / 2 + KEEP_TILE,
             player: null, orientation: 0 };
  }

  // Wohin das Vorschaubild gehoert, damit ein Kartenfeld auf einem Editorfeld
  // liegt. Groesse und Ecke, fertig fuer ctx.drawImage.
  function mapPreviewRect(keep, view) {
    if (!keep) return null;
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    return {
      x: view.panX - hw * (keep.x - keep.y + MAP_PREVIEW_EDGE),
      y: view.panY - hh * (keep.x + keep.y - (MAP_PREVIEW_EDGE - 1 + 2 * KEEP_TILE)),
      w: MAP_PREVIEW_EDGE * 2 * hw,
      h: MAP_PREVIEW_EDGE * 2 * hh
    };
  }

  // Zoom and offset so that the whole 100x100 grid fits into a box
  function fitView(width, height) {
    const zoom = Math.max(0.15, Math.min(width / (GRID * HALF_W * 2),
                                         height / (GRID * HALF_H * 2)) * 0.95);
    return { zoom, panX: width / 2, panY: height / 2 - GRID * HALF_H * zoom };
  }

  return { GRID, HALF_W, HALF_H, MAP_PREVIEW_EDGE, KEEP_TILE,
           gridFromOffset, offsetFromGrid, isoPoint,
           tileFromPoint, editorTileFromPoint,
           depth, byDepth, spriteRect, variantFor, wallLookup, hoehenLookup,
           collectItems, collectPlates, marqueeOutline, fitView,
           rotateGrid, unrotateGrid, keepOrientation,
           mapTileForGrid, previewPointForMapTile, centreKeep, mapPreviewRect };
});
