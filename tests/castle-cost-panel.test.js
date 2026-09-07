// Totschlagtests fuer die Bauschritt-Auswertung.
//
// Vorher aufgeschrieben, damit hinterher nicht die Messlatte wandert:
//   T1  Sieben im Spiel bekannte Preise muessen auf der richtigen Bauart landen.
//   T2  Handnachrechnung an einer echten AIV: ein zweiter, unabhaengiger
//       Zaehlweg im Test selbst muss aufs Stueck genau dasselbe ergeben.
//   T3  Drei geordnete Familien (Kapelle<Kirche<Kathedrale, klein<gross beim
//       Torhaus, Turm3<Turm4<Turm5) muessen in Vanilla UND in beiden
//       Balance-Dateien die Ordnung behalten. Waere die Namenszuordnung
//       durcheinander, faellt das hier auf.
//   T4  Jede Bauart, die in echten AIV-Dateien vorkommt, ist entweder bepreist
//       oder ausdruecklich als kostenlos begruendet. Was uebrig bleibt, muss
//       das Modell als "unbekannt" melden - nie still als 0 mitrechnen.
//   T5  Eine Balance-Datei ohne "cost" laesst den Vanilla-Preis stehen.
//   T6  Zeit: 450 Bauschritte sind 449 Spieltage, und das sind 2 Jahre,
//       4 Monate, 1 Tag.
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

const AIV_ORDNER = 'C:/Users/danie/Documents/PC_Affe/Games/Stronghold_Crusader/SHC KCC 2024/aiv';
const hatAivs = fs.existsSync(AIV_ORDNER);

const ladeAiv = async datei => {
  const { parseAiv } = await import('file://' + path.join(root, 'src', 'node', 'aiv-codec.mjs').replace(/\\/g, '/'));
  return parseAiv(fs.readFileSync(path.join(AIV_ORDNER, datei)));
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

test('T2: Handnachrechnung an einer echten AIV trifft aufs Stueck', { skip: !hatAivs && 'AIV-Sammlung nicht vorhanden' }, async () => {
  const doc = await ladeAiv('Abbot1.aiv');
  for (const bisIndex of [0, 9, 40, doc.frames.length - 1]) {
    // Zweiter Zaehlweg: erst ein Histogramm, dann Stueckpreis mal Anzahl.
    // Bewusst NICHT ueber das Modell, sonst prueft der Test sich selbst.
    const histogramm = new Map();
    for (let i = 0; i <= bisIndex; i++) {
      const f = doc.frames[i];
      const n = (f.tilePositionOfsets || []).length;
      histogramm.set(f.itemType, (histogramm.get(f.itemType) || 0) + n);
    }
    const handSumme = { wood: 0, stone: 0, iron: 0, pitch: 0, gold: 0 };
    let unbekannt = 0;
    for (const [typ, n] of histogramm) {
      const e = daten.buildings[String(typ)];
      if (!e) { unbekannt += n; continue; }
      ['wood', 'stone', 'iron', 'pitch', 'gold'].forEach((r, k) => { handSumme[r] += (e.cost[k] || 0) * n; });
    }
    const gerechnet = modell.auswerten({ frames: doc.frames, stepIndex: bisIndex, data: daten });
    assert.deepEqual(gerechnet.cost, handSumme, `Summe bis Schritt ${bisIndex + 1} weicht ab`);
    assert.equal(gerechnet.unknown.reduce((s, u) => s + u.count, 0), unbekannt);
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

test('T4: jede in echten AIV-Dateien benutzte Bauart ist bepreist oder begruendet gratis', { skip: !hatAivs && 'AIV-Sammlung nicht vorhanden' }, async () => {
  const { parseAiv } = await import('file://' + path.join(root, 'src', 'node', 'aiv-codec.mjs').replace(/\\/g, '/'));
  const dateien = fs.readdirSync(AIV_ORDNER).filter(f => f.toLowerCase().endsWith('.aiv'));
  assert.ok(dateien.length > 50, 'zu wenige AIV-Dateien fuer eine belastbare Abdeckung');
  const benutzt = new Set();
  for (const f of dateien) {
    const doc = parseAiv(fs.readFileSync(path.join(AIV_ORDNER, f)));
    for (const fr of doc.frames) benutzt.add(Number(fr.itemType));
  }
  const fehlen = [...benutzt].filter(t => !daten.buildings[String(t)]).sort((a, b) => a - b);
  assert.deepEqual(fehlen, [], `Bauarten ohne jeden Eintrag: ${fehlen.join(', ')}`);
  const ohnePreis = [...benutzt]
    .filter(t => daten.buildings[String(t)].unknownPrice)
    .sort((a, b) => a - b);
  // Bekannte Luecke, bewusst offengelassen statt geraten: der Stadtgarten
  // (AIV 94) hat in der Laufzeit-Kostentabelle keinen zugeordneten Eintrag.
  // Er steht mit Namen und ohne Preis in der Tabelle, damit die Oberflaeche
  // ihn benennen kann statt ihn stillschweigend als 0 mitzurechnen.
  assert.deepEqual(ohnePreis, [169], `unerwartete Luecken: ${ohnePreis.join(', ')}`);
  assert.equal(daten.buildings['169'].name, 'Town Garden');

  // Und die Luecke muss sichtbar werden, nicht als 0 durchrutschen.
  const frames = [{ itemType: 169, tilePositionOfsets: [1, 2, 3] }];
  const ergebnis = modell.auswerten({ frames, stepIndex: 0, data: daten });
  assert.deepEqual(ergebnis.unknown, [{ type: 169, count: 3 }]);
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

test('Die Oberflaeche wird aus castle-editor.js nachgeladen, ohne index.html anzufassen', () => {
  const editor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(editor, /castle-cost-data\.js/);
  assert.match(editor, /castle-cost-model\.js/);
  assert.match(editor, /castle-cost-panel\.js/);
  assert.match(editor, /castle-cost-panel\.css/);
  assert.match(editor, /castleCostPanel/);
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /castle-cost/, 'index.html darf unberuehrt bleiben');
  const css = fs.readFileSync(path.join(root, 'src', 'css', 'combined.css'), 'utf8');
  assert.doesNotMatch(css, /castleCostOverview/, 'combined.css darf unberuehrt bleiben');
});
