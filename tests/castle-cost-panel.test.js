// Tests fuer die Bauschritt-Auswertung. Alle Testdaten sind eingebettet, damit
// die Suite weder eine Spielinstallation noch eine private AIV-Sammlung braucht.
//
// Was diese Tests NICHT beweisen: dass die KI im laufenden Spiel genau diese
// Summe abbucht. Dafuer muesste das Spiel laufen. Belegt ist die Kostentabelle
// (aus der exe gelesen, gegen sieben Spielpreise geprueft) und das Bautempo
// (445 von 445 Schritten) - nicht die Buchung Schritt fuer Schritt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const daten = require(path.join(root, 'src', 'js', 'castle-cost-data.js'));
const modell = require(path.join(root, 'src', 'js', 'castle-cost-model.js'));

test('cumulative and entire-castle totals use the same balance but different step limits', () => {
  const frames = [
    { itemType: 61, tilePositionOfsets: [5643] },
    { itemType: 54, tilePositionOfsets: [100, 200] },
    { itemType: 95, tilePositionOfsets: [500] }
  ];
  const balance = { buildings: { Hovel: { cost: [5, 0, 0, 0, 2] }, Chapel: { cost: [0, 8, 0, 0, 75] } } };
  const result = modell.auswerten({ frames, stepIndex: 1, data: daten, balance });
  assert.deepEqual(result.cost, { wood: 10, stone: 0, iron: 0, pitch: 0, gold: 4 });
  assert.deepEqual(result.wholeCastleCost, { wood: 10, stone: 8, iron: 0, pitch: 0, gold: 79 });
  const end = modell.auswerten({ frames, stepIndex: null, data: daten, balance });
  assert.deepEqual(end.cost, end.wholeCastleCost);
  assert.deepEqual(result.rows.reduce((sum, row) => {
    for (const key of modell.RESSOURCEN) sum[key] += row.total[key];
    return sum;
  }, { wood: 0, stone: 0, iron: 0, pitch: 0, gold: 0 }), result.cost);
});

test('unknown future prices mark the whole total as partial without contaminating the selected-step total', () => {
  const frames = [{ itemType: 54, tilePositionOfsets: [100] }, { itemType: 999999, tilePositionOfsets: [200] }];
  const result = modell.auswerten({ frames, stepIndex: 0, data: daten });
  assert.equal(result.unknown.length, 0);
  assert.equal(result.wholeCastleUnknown.length, 1);
  const empty = modell.auswerten({ frames: [], stepIndex: null, data: daten });
  assert.deepEqual(empty.cost, empty.wholeCastleCost);
});

test('cost overview collapses independently of the breakdown and preserves a cumulative footer', () => {
  const panel = fs.readFileSync(path.join(root, 'src/js/castle-cost-panel.js'), 'utf8');
  assert.match(panel, /aria-controls="castleCostBody"/);
  assert.match(panel, /els\.body\.hidden = state\.collapsed/);
  assert.match(panel, /setItem\(COLLAPSE_STORAGE/);
  assert.match(panel, /costTableRow costTableTotal/);
  assert.match(panel, /Cumulative total through step/);
  assert.match(panel, /Total through current step/);
  assert.doesNotMatch(panel, /Entire castle total/);
});

// Vergleichsproben aus den beiden echten Balance-Dateien, am 07.09.2026 geholt:
//   ascension = Krarilotus/Ascension, Zweig ucp3-ascension,
//               extension-Ascension-Balance/resources/balance/ascension.json
//   liga      = Nevikov/Mod-KI-Team-Liga, Zweig main,
//               resources/balance/liga_ai.json
// Uebernommen ist nur der Kostenteil der 49 Gebaeude, auf die die Zuordnung in
// castle-cost-data.js zeigt. Ein leeres Objekt heisst: die Datei nennt fuer
// dieses Gebaeude keine Kosten - dann gilt weiter der Vanilla-Preis.
// Beide Dateien kennen alle 49 Namen. Haette ich die Namen erfunden, waeren sie
// nicht in zwei unabhaengig gepflegten Dateien vollstaendig wiederzufinden.
const BALANCE_PROBEN = {
  ascension: {
    // Resource-building cost samples refreshed 2026-09-12 from the same profiles.
    "Quarry": { cost: [15, 0, 0, 0, 0] },
    "Wheat farm": { cost: [15, 0, 0, 0, 0] },
    "Hop farm": { cost: [15, 0, 0, 0, 20] },
    "Apple farm": { cost: [5, 0, 0, 0, 0] },
    "Dairy farm": { cost: [10, 0, 0, 0, 0] },
    "Iron mine": { cost: [15, 4, 0, 0, 0] },
    "Pitch rig": { cost: [20, 0, 0, 0, 0] },
    "Fletcher": {},
    "Woodcutter hut": { cost: [3, 0, 0, 0, 0] },
    "Hovel": { cost: [5, 0, 0, 0, 0] },
    "Stables": { cost: [50, 36, 0, 0, 500] },
    "Mill": {},
    "Bakery": { cost: [10, 0, 0, 0, 0] },
    "Brewery": { cost: [15, 0, 0, 0, 0] },
    "Marketplace": { cost: [0, 0, 0, 0, 0] },
    "Hunters hut": {},
    "Armory": {},
    "Poleturner": { cost: [10, 3, 0, 0, 50] },
    "Blacksmith": { cost: [20, 6, 2, 0, 0] },
    "Armourer": { cost: [20, 12, 6, 0, 0] },
    "Tanner": { cost: [20, 6, 0, 0, 50] },
    "Mercenary post": { cost: [0, 0, 0, 0, 50] },
    "Barracks": { cost: [0, 10, 0, 0, 0] },
    "Engineers guild": { cost: [10, 0, 0, 0, 50] },
    "Tunnelers guild": { cost: [15, 0, 0, 0, 0] },
    "Inn": { cost: [15, 8, 0, 0, 50] },
    "Apothecary": { cost: [25, 0, 0, 0, 100] },
    "Chapel": { cost: [0, 8, 0, 0, 75] },
    "Church": { cost: [0, 18, 0, 0, 150] },
    "Cathedral": { cost: [0, 36, 0, 0, 500] },
    "Killing pit": { cost: [4, 0, 0, 0, 0] },
    "Drawbridge": {},
    "Tower one": { cost: [0, 12, 0, 0, 0] },
    "Tower three": { cost: [0, 12, 0, 0, 0] },
    "Tower four": { cost: [0, 25, 0, 0, 0] },
    "Tower five": { cost: [0, 40, 0, 0, 0] },
    "Small gatehouse": { cost: [0, 10, 0, 0, 0] },
    "Large gatehouse": { cost: [0, 18, 0, 0, 0] },
    "Garden": { cost: [0, 4, 0, 0, 12] },
    "Maypole": { cost: [10, 0, 0, 0, 15] },
    "Gallows": { cost: [25, 0, 0, 0, 0] },
    "Stocks": { cost: [15, 0, 0, 0, 32] },
    "Oil smelter": { cost: [0, 0, 1, 0, 0] },
    "Cesspit": { cost: [0, 0, 0, 0, 65] },
    "Burning stake": { cost: [5, 0, 0, 3, 0] },
    "Gibbet": { cost: [15, 0, 1, 0, 0] },
    "Dungeon": { cost: [0, 7, 0, 0, 0] },
    "Stretching rack": { cost: [0, 0, 2, 0, 0] },
    "Chopping block": { cost: [0, 4, 0, 0, 32] },
    "Dunking stool": { cost: [15, 0, 0, 0, 20] },
    "Dog cage": { cost: [10, 0, 0, 0, 50] },
    "Statue": { cost: [0, 5, 0, 0, 0] },
    "Shrine": { cost: [0, 5, 0, 0, 0] },
    "Dancing bear": { cost: [5, 0, 0, 0, 20] },
    "Well": { cost: [0, 2, 0, 0, 0] },
    "Water pot": {}
  },
  liga: {
    "Quarry": { cost: [25, 0, 0, 0, 0] },
    "Wheat farm": { cost: [13, 0, 0, 0, 15] },
    "Hop farm": { cost: [10, 0, 0, 0, 35] },
    "Apple farm": { cost: [3, 0, 0, 0, 15] },
    "Dairy farm": { cost: [7, 0, 0, 0, 15] },
    "Iron mine": { cost: [20, 6, 0, 0, 0] },
    "Pitch rig": { cost: [25, 0, 0, 0, 0] },
    "Fletcher": { cost: [18, 0, 0, 0, 100] },
    "Woodcutter hut": { cost: [5, 0, 0, 0, 0] },
    "Hovel": { cost: [5, 0, 0, 0, 0] },
    "Stables": { cost: [50, 25, 0, 0, 500] },
    "Mill": { cost: [18, 0, 0, 0, 0] },
    "Bakery": { cost: [10, 3, 0, 0, 0] },
    "Brewery": { cost: [16, 0, 0, 0, 0] },
    "Marketplace": { cost: [0, 0, 0, 0, 0] },
    "Hunters hut": { cost: [3, 0, 0, 0, 60] },
    "Armory": {},
    "Poleturner": { cost: [10, 3, 0, 0, 50] },
    "Blacksmith": { cost: [20, 8, 0, 0, 0] },
    "Armourer": { cost: [20, 12, 6, 0, 0] },
    "Tanner": { cost: [15, 3, 0, 0, 75] },
    "Mercenary post": { cost: [0, 0, 0, 0, 120] },
    "Barracks": { cost: [0, 12, 0, 0, 0] },
    "Engineers guild": { cost: [10, 0, 0, 0, 50] },
    "Tunnelers guild": { cost: [10, 0, 0, 0, 30] },
    "Inn": { cost: [16, 12, 0, 0, 50] },
    "Apothecary": { cost: [30, 0, 0, 0, 100] },
    "Chapel": { cost: [0, 10, 0, 0, 75] },
    "Church": { cost: [0, 25, 0, 0, 150] },
    "Cathedral": { cost: [0, 50, 0, 0, 500] },
    "Killing pit": { cost: [4, 0, 0, 0, 0] },
    "Drawbridge": {},
    "Tower one": { cost: [0, 12, 0, 0, 0] },
    "Tower three": { cost: [0, 16, 0, 0, 0] },
    "Tower four": { cost: [0, 35, 0, 0, 0] },
    "Tower five": { cost: [0, 50, 0, 0, 0] },
    "Small gatehouse": { cost: [0, 15, 0, 0, 0] },
    "Large gatehouse": { cost: [0, 25, 0, 0, 0] },
    "Garden": { cost: [0, 0, 0, 0, 30] },
    "Maypole": { cost: [0, 0, 0, 0, 30] },
    "Gallows": { cost: [0, 0, 0, 0, 40] },
    "Stocks": { cost: [0, 0, 0, 0, 40] },
    "Oil smelter": { cost: [0, 0, 8, 0, 100] },
    "Cesspit": { cost: [0, 0, 0, 0, 30] },
    "Burning stake": { cost: [0, 0, 0, 0, 40] },
    "Gibbet": { cost: [0, 0, 0, 0, 40] },
    "Dungeon": { cost: [0, 0, 0, 0, 30] },
    "Stretching rack": { cost: [0, 0, 0, 0, 30] },
    "Chopping block": { cost: [0, 0, 0, 0, 40] },
    "Dunking stool": { cost: [0, 0, 0, 0, 40] },
    "Dog cage": { cost: [5, 0, 0, 0, 75] },
    "Statue": { cost: [0, 0, 0, 0, 40] },
    "Shrine": { cost: [0, 0, 0, 0, 40] },
    "Dancing bear": { cost: [0, 0, 0, 0, 30] },
    "Well": { cost: [0, 3, 0, 0, 0] },
    "Water pot": {}
  }
};

test('T1: die sieben bekannten Spielpreise stehen auf der richtigen Bauart', () => {
  const erwartet = {
    54: [6, 0, 0, 0, 0],      // House / Huette
    51: [3, 0, 0, 0, 0],      // Woodcutter
    330: [0, 0, 0, 0, 30],    // Well
    65: [20, 0, 0, 0, 400],   // Stables
    95: [0, 0, 0, 0, 250],    // Chapel
    96: [0, 0, 0, 0, 500],    // Church
    97: [0, 0, 0, 0, 1000]    // Cathedral
  };
  for (const [typ, kosten] of Object.entries(erwartet)) {
    const eintrag = daten.buildings[typ];
    assert.ok(eintrag, `Bauart ${typ} fehlt in der Kostentabelle`);
    assert.deepEqual(eintrag.cost, kosten, `Bauart ${typ} (${eintrag.name}) hat den falschen Preis`);
  }
});

test('T3: geordnete Familien halten in Vanilla und in beiden Balance-Dateien', () => {
  const familien = [
    { was: 'Kapelle < Kirche < Kathedrale (Gold)', typen: [95, 96, 97], spalte: 4 },
    { was: 'kleines < grosses Torhaus (Stein)', typen: [145, 147], spalte: 1 },
    { was: 'Turm3 < Turm4 < Turm5 (Stein)', typen: [112, 113, 114], spalte: 1 }
  ];
  const balancen = [
    { name: 'vanilla', b: null },
    { name: 'ascension', b: { buildings: BALANCE_PROBEN.ascension } },
    { name: 'liga', b: { buildings: BALANCE_PROBEN.liga } }
  ];
  let vergleiche = 0;
  for (const { name, b } of balancen) {
    for (const fam of familien) {
      const werte = fam.typen.map(t => {
        const preis = modell.preisFuer(t, daten, b);
        assert.ok(preis.kosten, `${name}: Bauart ${t} ohne Preis`);
        return preis.kosten[modell.RESSOURCEN[fam.spalte]];
      });
      for (let i = 1; i < werte.length; i++) {
        assert.ok(werte[i] >= werte[i - 1], `${name}: ${fam.was} ist verdreht (${werte.join(' / ')})`);
        vergleiche++;
      }
    }
  }
  assert.ok(vergleiche >= 12, `zu wenige Ordnungsvergleiche: ${vergleiche}`);
});

test('Jeder Balance-Name der Zuordnung steht in beiden echten Balance-Dateien', () => {
  const namen = [...new Set(Object.values(daten.buildings).map(e => e.balance).filter(Boolean))];
  assert.ok(namen.length >= 45, `zu wenige zugeordnete Namen: ${namen.length}`);
  const fehlt = { ascension: [], liga: [] };
  for (const n of namen) {
    if (!(n in BALANCE_PROBEN.ascension)) fehlt.ascension.push(n);
    if (!(n in BALANCE_PROBEN.liga)) fehlt.liga.push(n);
  }
  assert.deepEqual(fehlt, { ascension: [], liga: [] });
});

test('Town Garden and Communal Garden share runtime Garden cost and balance overrides', () => {
  const frames = [{ itemType: 169, tilePositionOfsets: [1, 2, 3] }];
  const result = modell.auswerten({ frames, stepIndex: 0, data: daten });
  assert.deepEqual(result.unknown, []);
  assert.equal(result.cost.gold, 90);
  for (const type of [166,169]) {
    assert.equal(modell.preisFuer(type, daten, {buildings:{Garden:{cost:[0,0,0,0,15]}}}).kosten.gold,15);
  }
});

test('T5: eine Balance ohne "cost" laesst den Vanilla-Preis stehen', () => {
  const balance = { buildings: { Fletcher: { health: 400 }, Chapel: { cost: [0, 8, 0, 0, 75] } } };
  const bogenmacher = modell.preisFuer(50, daten, balance);
  assert.equal(bogenmacher.quelle, 'vanilla');
  assert.deepEqual(bogenmacher.kosten, { wood: 20, stone: 0, iron: 0, pitch: 0, gold: 100 });
  const kapelle = modell.preisFuer(95, daten, balance);
  assert.equal(kapelle.quelle, 'balance');
  assert.deepEqual(kapelle.kosten, { wood: 0, stone: 8, iron: 0, pitch: 0, gold: 75 });
});

test('T6: 450 Bauschritte sind 449 Spieltage, also 2 Jahre, 4 Monate, 1 Tag', () => {
  const zeit = modell.zeitBis(450);
  assert.equal(zeit.days, 449);
  assert.equal(zeit.ticks, 22450);
  assert.equal(zeit.years, 2);
  assert.equal(zeit.months, 4);
  assert.equal(zeit.remainderDays, 1);
  assert.equal(zeit.label, '2 years, 4 months, 1 day');
  assert.equal(modell.zeitBis(1).days, 0);
  assert.equal(modell.zeitBis(17).label, '1 month');
  assert.equal(modell.zeitBis(18).label, '1 month, 1 day');
});

test('Mauern, Treppen, Bergfried und Lagerplatz kosten nichts - mit Begruendung', () => {
  for (const typ of [25, 26, 35, 46, 61, 52, 106, 181, 185]) {
    const e = daten.buildings[String(typ)];
    assert.ok(e, `Bauart ${typ} fehlt`);
    assert.ok(e.free, `Bauart ${typ} (${e.name}) hat keine Begruendung fuer den Nullpreis`);
    assert.deepEqual(e.cost, [0, 0, 0, 0, 0]);
  }
  const frames = [{ itemType: 25, tilePositionOfsets: new Array(500).fill(0) }];
  const ergebnis = modell.auswerten({ frames, stepIndex: 0, data: daten });
  assert.deepEqual(ergebnis.cost, { wood: 0, stone: 0, iron: 0, pitch: 0, gold: 0 });
  assert.equal(ergebnis.unknown.length, 0);
});

test('Bevoelkerung zaehlt nur bis zum gewaehlten Schritt', () => {
  const popDaten = { population_effects: { provides: { 61: 10, 54: 8 }, requires: { 50: 1 } } };
  const frames = [
    { itemType: 61, tilePositionOfsets: [1] },
    { itemType: 54, tilePositionOfsets: [2, 3] },
    { itemType: 50, tilePositionOfsets: [4] },
    { itemType: 54, tilePositionOfsets: [5] }
  ];
  assert.deepEqual(modell.bevoelkerungBis(frames, 0, popDaten), { provided: 10, required: 0, left: 10 });
  assert.deepEqual(modell.bevoelkerungBis(frames, 1, popDaten), { provided: 26, required: 0, left: 26 });
  assert.deepEqual(modell.bevoelkerungBis(frames, 2, popDaten), { provided: 26, required: 1, left: 25 });
  assert.deepEqual(modell.bevoelkerungBis(frames, null, popDaten), { provided: 34, required: 1, left: 33 });
});

test('Die AIC-Bedarfsrechnung wird mit der bis dahin gestellten Bevoelkerung gefuettert', () => {
  const popDaten = { population_effects: { provides: { 54: 8 }, requires: {} } };
  const frames = [
    { itemType: 54, tilePositionOfsets: [1] },
    { itemType: 54, tilePositionOfsets: [2] }
  ];
  const gesehen = [];
  const ergebnis = modell.auswerten({
    frames, stepIndex: 0, data: daten, populationData: popDaten,
    aicAt: pop => { gesehen.push(pop); return { population: 5, farms: 2, quarries: 1, iron: 0, wood: 1, pitch: 0, oxTethers: 0 }; },
    aic: { Farm1: 'WheatFarm', Farm2: 'HopFarm', Farm3: 'None' }
  });
  assert.deepEqual(gesehen, [8]);
  assert.equal(ergebnis.population.aicNeeded, 5);
  assert.equal(ergebnis.population.free, 3);
  assert.equal(ergebnis.population.farms.hop, 1);
  assert.deepEqual(ergebnis.population.farms.used, ['WheatFarm', 'HopFarm']);
});

test('Kosten und Schritt-Bevoelkerung haben getrennte, verschiebbare Oberflaechen', () => {
  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(editor, /castle-cost-data\.js/);
  assert.match(editor, /castle-cost-model\.js/);
  assert.match(editor, /castle-cost-panel\.js/);
  assert.match(editor, /castle-cost-panel\.css/);
  assert.match(editor, /castleCostPanel/);
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /id="castlePopulationOverview"/);
  assert.match(html, /id="castleCostOverview"/);
  assert.match(html, /id="castlePopulationStep"/);
  assert.match(html, /data-info-target="castlePopulationInfo"/);
  assert.doesNotMatch(html, /castlePopulationProvided|castlePopulationRequired|castlePopulationLeft|castleCharacterPopulationNeeded|castlePopulationAfterCharacter/,
    'die Anzeige fuer die vollstaendige Burg ist entfernt');
  assert.doesNotMatch(html, /castleSetSkinBtn|castleRemoveSkinBtn|castleOpenSkinsBtn/,
    'die Haut-Auswahl gibt ihren Platz an die Kosten ab');
  assert.match(editor, /const OVERVIEW_STORAGE_KEY/);
  assert.match(editor, /function applyOverviewLayout/);
  assert.match(editor, /onTriggerCastleOverview/);
  const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');
  assert.match(css, /castleOverviewInfoButton/);
  assert.match(css, /\.castlePalette \{ flex: 1 1 0; \}/,
    'die Kosten bleiben am unteren Rand und die Gegenstandsliste nimmt den freien Platz');
});
