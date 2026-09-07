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

  // Screen point of a grid corner. hebung sind Bildpunkte des SPIELS, um die
  // der Boden dort hoeher liegt - senkrecht nach oben, denn eine Kachel ist
  // beim Spiel wie bei uns 16 Punkte hoch, also zaehlt eine Hoehe eins zu eins
  // (siehe game-map.js, HEIGHT_SECTION).
  function isoPoint(gx, gy, view, hebung) {
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    return [view.panX + (gx - gy) * hw,
            view.panY + (gx + gy) * hh - (Number(hebung) || 0) * view.zoom];
  }

  // The other way round: which tile is under a point on screen? Solving
  //   px = panX + (gx - gy) * hw
  //   py = panY + (gx + gy) * hh
  // for gx and gy. Returns null outside the grid.
  //
  // Mit Hoehen wird daraus eine Suche: ein Punkt auf dem Bildschirm gehoert zu
  // dem Feld, das um SEINE eigene Hoehe nach oben gerueckt ist - man kennt die
  // Hoehe aber erst, wenn man das Feld kennt.
  //
  // An einer Steilkante gibt es dabei zwei richtige Antworten: das hohe Feld
  // davor und das tiefe dahinter liegen an derselben Stelle auf dem
  // Bildschirm. Genommen wird, was ein Mensch dort sieht - das VORDERE, also
  // das mit dem groessten gx+gy; das Spiel malt aus demselben Grund von hinten
  // nach vorn.
  function flatTileFromPoint(px, py, view) {
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    const a = (px - view.panX) / hw;      // gx - gy
    const b = (py - view.panY) / hh;      // gx + gy
    const gx = Math.floor((a + b) / 2);
    const gy = Math.floor((b - a) / 2);
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return null;
    return { gx, gy };
  }

  // Geraten wird nicht, sondern durchprobiert: ein Feld traegt den Punkt genau
  // dann, wenn es bei SEINER Hoehe dorthin faellt. Die in Frage kommenden
  // Felder liegen alle auf einer Linie - je 16 Punkte Hoehe ein Feld weiter
  // nach vorn -, und mehr als 255 Punkte kann eine Hoehe nicht haben (ein
  // Byte). Also 64 Schritte zu 4 Punkten, das deckt jedes erreichbare Feld ab
  // und kostet nichts. Passen mehrere, gewinnt das vorderste.
  const MAX_HOEHE = 255;

  function tileFromPoint(px, py, view, hoeheAn) {
    if (typeof hoeheAn !== 'function') return flatTileFromPoint(px, py, view);
    let treffer = null;
    let letzt = null;
    for (let probe = 0; probe <= MAX_HOEHE; probe += 4) {
      const feld = flatTileFromPoint(px, py + probe * view.zoom, view);
      if (!feld) continue;
      if (letzt && feld.gx === letzt.gx && feld.gy === letzt.gy) continue;
      letzt = feld;
      const hebung = Number(hoeheAn(feld.gx, feld.gy)) || 0;
      const zurueck = flatTileFromPoint(px, py + hebung * view.zoom, view);
      if (!zurueck || zurueck.gx !== feld.gx || zurueck.gy !== feld.gy) continue;
      if (!treffer || feld.gx + feld.gy > treffer.gx + treffer.gy) treffer = feld;
    }
    // Trifft gar nichts - etwa weil der Zeiger ueber einer Steilkante steht,
    // deren Oberkante zu keinem Feld gehoert -, gilt der flache Platz.
    return treffer || flatTileFromPoint(px, py, view);
  }

  // A point on screen straight into the editor's own tile coordinates
  function editorTileFromPoint(px, py, view, hoeheAn) {
    const grid = tileFromPoint(px, py, view, hoeheAn);
    if (!grid) return null;
    return { x: grid.gx, y: (GRID - 1) - grid.gy };
  }

  // Was weiter hinten steht, wird zuerst gemalt. WELCHE Zahl das entscheidet,
  // war bis zum 07.09.2026 falsch - Monsterfish hat es an Torhaus und Turm
  // gesehen: sie lagen vor der Treppe, obwohl sie dahinter gehoeren.
  //
  // WIE DAS SPIEL SORTIERT, nachgesehen statt geraten:
  // renderMap (0x004e8cf0) hat gar keine Liste von Gebaeuden, die es sortiert.
  // Es laeuft den BILDSCHIRM Feld fuer Feld ab (screenPointToTileNumber, von
  // hinten nach vorn) und malt je Feld, was dessen Schichten sagen. Ein
  // mehrfeldriges Gebaeude ist dabei kein Bild, sondern n*n Bilder:
  // updateBuildingGraphicsLayer (0x00506370) laeuft ueber
  // constructionTileCount Felder, holt sich zu jedem Feld ueber
  // getBuildingSizeIndexMappingData den Versatz (buildingX/buildingY) und
  // schreibt GfxLayer[Feld] EINZELN. Jedes Feld eines Torhauses hat also sein
  // eigenes Teilbild und seine eigene Tiefe.
  //
  // Unsere Bilder sind ganze Gebaeude, nicht Teilbilder - wir koennen also
  // nicht Feld fuer Feld malen. Gebraucht wird eine Zahl je Gegenstand, die
  // dieselbe Reihenfolge ergibt. Sie lautet
  //
  //     tiefe = gx + gy + (n - 1)          statt vorher gx + gy + 2*(n-1)
  //
  // also die Diagonale durch die OST- und die SUEDECKE des Grundrisses (die
  // breiteste Zeile des Gebaeudes), nicht die durch seine vordere Spitze.
  //
  // Warum das stimmt, fuer quadratische Grundrisse durchgerechnet: Gegenstand
  // A liegt hinter B, wenn er ganz kleinere gx hat (A.gx+nA-1 < B.gx) oder
  // ganz kleinere gy. Sei A ein Bau von n Feldern ab (x,y), B ein Feld (a,b).
  //   B hinten in x: a <= x-1, und b <= y+n-1 (sonst ueberlappen sie sich auf
  //     dem Bildschirm gar nicht) -> a+b <= x+y+n-2 < x+y+n-1.
  //   B vorn in x:   a >= x+n und b >= y     -> a+b >= x+y+n > x+y+n-1.
  // Fuer y dasselbe, und fuer zwei mehrfeldrige Bauten ebenso. Die Faelle, in
  // denen beide Richtungen zugleich gelten wuerden (A hinten in x UND vorn in
  // y), sind genau die, in denen sich die Bilder auf dem Bildschirm nicht
  // beruehren - dort ist die Reihenfolge gleichgueltig.
  //
  // Das gilt, weil ein Bild genau so breit ist wie sein Grundriss: der Katalog
  // fuehrt breite = 32*n - 2 - nachgezaehlt an allen 322 Bildern der 73
  // Eintraege, keine einzige Abweichung. Ein Bild,
  // das seitlich ueber seine Felder hinausragt, waere hiervon nicht gedeckt.
  function depth(item) {
    return item.gx + item.gy + ((item.tiles || 1) - 1);
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

  function spriteRect(sprite, gx, gy, tiles, view, hebung) {
    const [sx, sy] = isoPoint(gx + tiles - 1, gy + tiles - 1, view, hebung);
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
  const KEEP_EDGE = 7;            // und der Bergfried ist 7x7 Felder gross

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
  //
  // Der VERSATZ bleibt dabei unveraendert: keepXOffset = keepX - 43 wird in
  // setKeepOffsetAndOrientation (0x004ecf70) EINMAL gesetzt und danach von
  // niemandem mehr angefasst - nachgesehen an allen Verweisen auf
  // aivs[].keepXOffset/keepYOffset, geschrieben nur dort, gelesen nur in
  // applyAIV und computeAIVPlacementFit (0x004ef8c0). Dorffeld (43,43) liegt
  // also immer auf dem Startplatz der Karte.
  //
  // DER BERGFRIED LIEGT TROTZDEM NICHT IMMER DORT. Er belegt in der Datei die
  // Felder (43,43) bis (49,49) - gemessen an allen 128 .aiv des Spiels, je 49
  // Felder mit Bauwert 38 (AIVBT_KEEP2), Rahmen immer (43,43)-(49,49). Gedreht
  // wird um die MITTE des 100x100-Rasters, und die Mitte des Bergfrieds liegt
  // 3,5 Felder daneben. Nach einer Vierteldrehung sitzt er darum auf
  //   Drehung 0: (43,43)   2: (43,50)   4: (50,50)   6: (50,43)
  // und liegt damit bis zu 7 Felder neben dem 7x7-Block, den die Karte selbst
  // traegt. Das ist kein Rechenfehler, sondern was das Spiel tut:
  //   applyAIV baut den Bergfried NICHT als Bauschritt (Bauwert 38 faellt in
  //   den eigenen Zweig, der nur DAT_AIVState.keepX/keepY setzt - der erste
  //   38er im gedrehten Raster, zeilenweise gesucht, plus keepXOffset;
  //   geschrieben nach 0x018a5b60/0x018a5b64 bei 0x004ef199 und 0x004ef1ae).
  //   LaunchSkirmishGame (0x00441270) liest genau diese beiden Zellen bei
  //   0x00441eb4/0x00441eb9 und ruft damit placeBuilding(..., M_MAPPER_KEEP2,
  //   7, keepOrientation). Den Bergfried, den die Karte mitbringt, hat es
  //   vorher zerstoert (destroyBuildingAndLinkedDuplicates, derselbe Ablauf,
  //   nachdem es dessen x/y als Startplatz gemerkt hat).
  // Der gezeichnete Bergfried gehoert also auf den GEDREHTEN Platz, nicht auf
  // den Block der Karte. Wer ihn "zurechtrueckt", baut den Fehler erst ein.
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
  // Wo der Bergfried nach der Drehung im Dorfraster sitzt.
  //
  // Gedreht wird um die Rastermitte (rotateGrid, so wie rotateAIV 0x004ed0b0
  // es im Spiel tut). Danach steht der Bergfried NICHT mehr auf Dorffeld
  // (43,43) - bei einer Vierteldrehung wandert er 7 Felder zur Seite. Das
  // Spiel faengt das mit setKeepOffsetAndOrientation (0x004ecf70) ab: erst
  // drehen, dann so verschieben, dass der Bergfried wieder auf dem Startplatz
  // liegt. Genau dieser zweite Schritt fehlte hier.
  //
  // GEMESSEN am 07.09.2026, Dorffeld (43,43) durch rotateGrid geschickt:
  //   A Friend Indeed (84,223) Drehung 6 -> Dorffeld (50,43), 7 Felder daneben
  //   Armenia        (131,200) Drehung 6 -> Dorffeld (50,43), 7 Felder daneben
  //   A New Land      (218,86) Drehung 4 -> Dorffeld (50,50), 7 in beide
  // Ohne Drehung ist der Anker wieder (43,43), also bleibt alles wie vorher.
  function keepAnchor(keep) {
    return rotateGrid(KEEP_TILE, KEEP_TILE, KEEP_EDGE, keep && keep.orientation);
  }

  function mapTileForGrid(gx, gy, keep) {
    const anker = keepAnchor(keep);
    return { mx: keep.x - anker.gx + gx, my: keep.y - anker.gy + gy };
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

  // Wohin ein Bild gehoert, das den Ausschnitt (px0,py0) bis (px0+cells,
  // py0+cells) der Vorschau abdeckt. Groesse und Ecke, fertig fuer
  // ctx.drawImage. Ein Vorschaupunkt ist genau eine Kachel breit und hoch,
  // also 2*hw mal 2*hh gross - px0 und py0 verschieben nur die Ecke.
  // Das gilt fuer die Vorschau wie fuer das echte Gelaende: beide sind
  // Ausschnitte DESSELBEN Rasters, nur verschieden fein gemalt. Zwei Rechnungen
  // waeren zwei Rechnungen, und eine davon laege irgendwann schief.
  // oben: so viele Punkte steht das Bild ueber dem flachen Rahmen, weil das
  // Gelaende seine Berge nach oben herausschiebt (game-map.js gibt das als
  // terrain.top zurueck). Senkrecht ist ein Bildpunkt des Spiels genau ein
  // Punkt der Ansicht mal Zoom - die Kachelhoehe ist hier wie dort 16.
  function mapImageRect(keep, view, px0, py0, cells, oben) {
    if (!keep) return null;
    const hw = HALF_W * view.zoom;
    const hh = HALF_H * view.zoom;
    const left = Number(px0) || 0;
    const top = Number(py0) || 0;
    const edge = Number(cells) || MAP_PREVIEW_EDGE;
    const luft = (Number(oben) || 0) * view.zoom;
    const anker = keepAnchor(keep);
    return {
      // Der Anker, nicht die feste 43: nach einer Drehung sitzt der Bergfried
      // auf einem anderen Dorffeld, und das Bild muss mitwandern. Bei (43,43)
      // ist ax-ay = 0 und ax+ay = 86 - dann steht hier wieder das Alte.
      x: view.panX - hw * (keep.x - keep.y + MAP_PREVIEW_EDGE - (anker.gx - anker.gy)) + left * 2 * hw,
      y: view.panY - hh * (keep.x + keep.y - (MAP_PREVIEW_EDGE - 1 + anker.gx + anker.gy)) + top * 2 * hh - luft,
      w: edge * 2 * hw,
      h: edge * 2 * hh + luft
    };
  }

  // Wohin das Vorschaubild gehoert: der Sonderfall "ganze Karte".
  function mapPreviewRect(keep, view) {
    return mapImageRect(keep, view, 0, 0, MAP_PREVIEW_EDGE);
  }

  // Welches Stueck der Karte das Dorf von 100x100 Feldern einnimmt, gemessen
  // in Vorschaupunkten. Der Hauptprozess malt genau dieses Stueck als echtes
  // Gelaende, die Ansicht legt es mit mapImageRect an dieselbe Stelle - beide
  // rechnen es hier aus, damit sie nicht auseinanderlaufen koennen.
  //
  // Die vier Ecken des Dorfes reichen: die Abbildung Feld -> Vorschaupunkt ist
  // eine Drehung, ein Viereck bleibt ein Viereck. Der Rahmen ist 100x100 Punkte
  // gross, das Dorf selbst fuellt darin eine Raute, also die Haelfte.
  // Warum die Kante trotzdem 101 sein kann: liegt keep.x + keep.y gerade, so
  // fallen die Ecken auf halbe Punkte, und der Rahmen braucht einen Punkt mehr.
  function villageWindow(keep) {
    if (!keep) return null;
    let pxLow = Infinity, pxHigh = -Infinity, pyLow = Infinity, pyHigh = -Infinity;
    for (const [gx, gy] of [[0, 0], [GRID - 1, 0], [0, GRID - 1], [GRID - 1, GRID - 1]]) {
      const tile = mapTileForGrid(gx, gy, keep);
      const point = previewPointForMapTile(tile.mx, tile.my);
      pxLow = Math.min(pxLow, point.px); pxHigh = Math.max(pxHigh, point.px);
      pyLow = Math.min(pyLow, point.py); pyHigh = Math.max(pyHigh, point.py);
    }
    const px0 = Math.floor(pxLow);
    const py0 = Math.floor(pyLow);
    return { px0, py0, cells: Math.max(Math.ceil(pxHigh) - px0, Math.ceil(pyHigh) - py0) + 1 };
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
           mapTileForGrid, keepAnchor, previewPointForMapTile, centreKeep,
           mapPreviewRect, mapImageRect, villageWindow };
});
