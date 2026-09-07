// Erzeugt src/js/castle-cost-data.js aus drei gemessenen Quellen:
//   1. AI-Toolkit config/aiv_constants.json  - die Typnummern, die der Editor benutzt
//   2. VillageStudio lib/gebaeude.json       - Mapper-Nummer <-> AIV-Nummer
//   3. VillageStudio lib/kosten.json         - AIV-Nummer -> Vanilla-Baukosten aus der exe
// Der Editor arbeitet mit MAPPER-Nummern (gemessen: 34 von 34 Namen decken sich
// ueber gebaeude.json), die Kostentabelle mit AIV-Nummern. Diese Datei schlaegt
// die Bruecke und backt sie ein, damit der Editor zur Laufzeit nichts von
// VillageStudio braucht.
'use strict';
const fs = require('fs');
const path = require('path');

const TOOLKIT = 'C:/Users/danie/Documents/PC_Affe/Games/Stronghold_Crusader/Stronghold Crusader Modding/Tools/AI-Toolkit';
const VS = 'C:/Users/danie/Documents/PC_Affe/Games/Stronghold_Crusader/Stronghold Crusader Modding/Tools/VillageStudio/lib';

const consts = JSON.parse(fs.readFileSync(path.join(TOOLKIT, 'config/aiv_constants.json'), 'utf8'));
const gebRoot = JSON.parse(fs.readFileSync(path.join(VS, 'gebaeude.json'), 'utf8'));
const geb = gebRoot.gebaeude;
const kostRoot = JSON.parse(fs.readFileSync(path.join(VS, 'kosten.json'), 'utf8'));
const kost = kostRoot.kosten;

// Mapper -> AIV. Mehrere AIV-Nummern koennen auf denselben Mapper zeigen
// (Wassergraben a-d), die erste gewinnt - sie unterscheiden sich nicht in Kosten.
const mapper2aiv = {};
for (const [aivNr, g] of Object.entries(geb)) {
  if (g.mapper != null && mapper2aiv[g.mapper] == null) mapper2aiv[g.mapper] = Number(aivNr);
}
const aiv2kost = {};
for (const [rt, k] of Object.entries(kost)) if (k.aiv != null) aiv2kost[k.aiv] = { rt: Number(rt), ...k };

// Was nichts kostet, und warum. Ohne diese Liste waere jede 0 zweideutig:
// "kostet nichts" und "wissen wir nicht" saehen gleich aus.
const GRATIS = {
  25: 'Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)',
  26: 'Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)',
  35: 'Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)',
  46: 'Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)',
  106: 'Wassergraben ist eine Kachel, kein Gebaeude - keine Laufzeitnummer, kein Kosteneintrag',
  181: 'Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)',
  182: 'Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)',
  183: 'Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)',
  184: 'Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)',
  185: 'Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)',
  186: 'Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)',
  61: 'Bergfried steht beim Spielstart schon da',
  52: 'Lagerplatz steht beim Spielstart schon da',
  200: 'Platzhalterschritt, kein Bauwerk',
  10001: 'Hilfstyp der Oberflaeche, kein Bauwerk',
  10002: 'Hilfstyp der Oberflaeche, kein Bauwerk'
};

// Beide Torhaus-Durchfahrten sind dasselbe Gebaeude. Die Laufzeit-Kostentabelle
// hat je Groesse nur EINE Nummer, die AIV kennt zwei Ausrichtungen.
const ERSATZ = { 144: 145, 146: 147 };

// Editor-Typ -> Name in einer Balance-JSON (Ascension, Team-Liga).
// Handverlesen, weil die Namen sich nicht durchgaengig aus dem Editornamen
// ableiten lassen (House/Hovel, Healers/Apothecary, Windmill/Mill).
const BALANCE_NAME = {
  50: 'Fletcher', 51: 'Woodcutter hut', 54: 'Hovel', 65: 'Stables', 74: 'Mill',
  75: 'Bakery', 76: 'Brewery', 77: 'Marketplace', 78: 'Hunters hut',
  81: 'Armory', 82: 'Poleturner', 83: 'Blacksmith', 84: 'Armourer', 85: 'Tanner',
  86: 'Mercenary post', 87: 'Barracks', 88: 'Engineers guild', 89: 'Tunnelers guild',
  92: 'Inn', 93: 'Apothecary', 95: 'Chapel', 96: 'Church', 97: 'Cathedral',
  98: 'Killing pit', 105: 'Drawbridge',
  110: 'Tower one', 112: 'Tower three', 113: 'Tower four', 114: 'Tower five',
  144: 'Small gatehouse', 145: 'Small gatehouse',
  146: 'Large gatehouse', 147: 'Large gatehouse',
  166: 'Garden', 175: 'Maypole', 176: 'Gallows', 177: 'Stocks', 180: 'Oil smelter',
  301: 'Cesspit', 305: 'Burning stake', 306: 'Gibbet', 307: 'Dungeon',
  308: 'Stretching rack', 310: 'Chopping block', 311: 'Dunking stool',
  312: 'Dog cage', 313: 'Statue', 318: 'Shrine', 324: 'Dancing bear',
  330: 'Well', 342: 'Water pot'
};

// Gebaeude, die NICHT in der AIV stehen, sondern die KI nach ihrer AIC selbst
// setzt. Fuer die Bevoelkerungsrechnung gebraucht, darum mit dabei.
const AIC_GEBAEUDE = {
  quarry: { aiv: 62, balance: 'Quarry', arbeiter: 3 },
  iron: { aiv: 64, balance: 'Iron mine', arbeiter: 2 },
  wood: { aiv: 61, balance: 'Woodcutter hut', arbeiter: 1 },
  pitch: { aiv: 65, balance: 'Pitch rig', arbeiter: 1 },
  oxTethers: { aiv: 63, balance: null, arbeiter: 1 },
  wheatFarm: { aiv: 73, balance: 'Wheat farm', arbeiter: 1 },
  hopFarm: { aiv: 75, balance: 'Hop farm', arbeiter: 1 },
  appleFarm: { aiv: 71, balance: 'Apple farm', arbeiter: 1 },
  dairyFarm: { aiv: 72, balance: 'Dairy farm', arbeiter: 1 }
};

const kostenFuer = typ => {
  const quelle = ERSATZ[typ] != null ? ERSATZ[typ] : typ;
  const aivNr = mapper2aiv[quelle];
  if (aivNr == null) return null;
  const k = aiv2kost[aivNr];
  if (!k) return null;
  return { aivNr, name: k.name, kosten: [k.holz, k.stein, k.eisen, k.pech, k.gold] };
};

// Welche Typen kommen in echten AIV-Dateien vor? Nur die muessen abgedeckt sein.
// Gemessen ueber alle 128 AIV-Dateien in "SHC KCC 2024/aiv".
const BENUTZT = new Set([25, 26, 35, 46, 50, 51, 52, 54, 61, 65, 74, 75, 76, 77, 80, 81, 82, 83, 84,
  85, 86, 87, 88, 89, 92, 93, 95, 96, 97, 98, 99, 105, 106, 110, 111, 112, 113, 114, 144, 145, 146,
  147, 166, 169, 175, 176, 177, 180, 181, 182, 183, 184, 185, 301, 305, 306, 307, 308, 310, 311,
  313, 318, 324, 330, 342]);

const eintraege = {};
const offen = [];
for (const [typStr, c] of Object.entries(consts)) {
  const typ = Number(typStr);
  const treffer = kostenFuer(typ);
  if (treffer) {
    eintraege[typ] = {
      name: c.name,
      aiv: treffer.aivNr,
      cost: treffer.kosten,
      balance: BALANCE_NAME[typ] || null,
      via: ERSATZ[typ] != null ? `Kosten der anderen Durchfahrt (Typ ${ERSATZ[typ]})` : null
    };
  } else if (GRATIS[typ]) {
    eintraege[typ] = { name: c.name, aiv: mapper2aiv[typ] ?? null, cost: [0, 0, 0, 0, 0], free: GRATIS[typ], balance: null };
  } else {
    offen.push({ typ, name: c.name, aiv: mapper2aiv[typ] ?? null });
  }
}

// Bauarten, die in echten AIV-Dateien vorkommen, aber keinen Kosteneintrag
// haben, kommen MIT NAMEN und ohne Preis in die Tabelle. So kann die
// Oberflaeche "Preis unbekannt: 2x Town Garden" sagen statt "2x type 169" -
// und rechnet die Luecke nicht still als Null mit.
for (const o of offen) {
  if (!BENUTZT.has(o.typ)) continue;
  eintraege[o.typ] = {
    name: o.name,
    aiv: o.aiv,
    unknownPrice: 'Die Laufzeit-Kostentabelle hat fuer diese AIV-Nummer keinen Eintrag - der Preis ist ungeklaert und wird nicht geraten.',
    balance: null
  };
}


const luecken = offen.filter(o => BENUTZT.has(o.typ));
console.log('Eintraege mit Kosten oder Gratis-Begruendung:', Object.keys(eintraege).length);
console.log('Ohne Zuordnung insgesamt:', offen.length);
console.log('Davon in echten AIV-Dateien benutzt (echte Luecken):', luecken.length);
for (const l of luecken) console.log('   LUECKE', l.typ, l.name, 'AIV', l.aiv);

const ausgabe = {
  _quelle: {
    typnummern: 'AI-Toolkit config/aiv_constants.json (Mapper-Nummern)',
    bruecke: `VillageStudio lib/gebaeude.json, Stand ${gebRoot._stand}`,
    kosten: kostRoot._quelle,
    reihenfolge: 'holz, stein, eisen, pech, gold'
  },
  _erzeugt: new Date().toISOString().slice(0, 10),
  buildings: eintraege,
  aicBuildings: AIC_GEBAEUDE,
  aicCosts: Object.fromEntries(Object.entries(AIC_GEBAEUDE).map(([k, v]) => {
    const kk = aiv2kost[v.aiv];
    return [k, kk ? [kk.holz, kk.stein, kk.eisen, kk.pech, kk.gold] : null];
  }))
};

const kopf = `// ERZEUGTE DATEI - nicht von Hand aendern.
// Erzeugt von src/js/castle-cost-data.build.js am ${ausgabe._erzeugt}.
//
// Was hier steht: je Bauart des Editors die Vanilla-Baukosten in der
// Reihenfolge Holz, Stein, Eisen, Pech, Gold - und der Name, unter dem
// dieselbe Bauart in einer Balance-JSON (Ascension, Team-Liga) steht.
//
// Die Bruecke zwischen beiden Nummernsaetzen:
//   Editor-Typ  = Mapper-Nummer   (aiv_constants.json)
//   ueber gebaeude.json           -> AIV-Nummer
//   ueber kosten.json             -> Kosten aus der exe bei 0x005C21D0
//
// "free" heisst: kostet nachweislich nichts, mit Begruendung.
// Fehlt eine Bauart ganz, ist ihr Preis unbekannt - die Oberflaeche sagt das
// dann auch, statt still 0 zu rechnen.
'use strict';
(() => {
  const DATEN = `;

const fuss = `;
  if (typeof window !== 'undefined') window.castleCostData = DATEN;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATEN;
})();
`;

const ziel = path.join(TOOLKIT, 'src/js/castle-cost-data.js');
fs.writeFileSync(ziel, kopf + JSON.stringify(ausgabe, null, 2) + fuss, 'utf8');
console.log('geschrieben:', ziel);
