// ERZEUGTE DATEI - nicht von Hand aendern.
// Erzeugt von src/js/castle-cost-data.build.js am 2026-09-07.
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
  const DATEN = {
  "_quelle": {
    "typnummern": "AI-Toolkit config/aiv_constants.json (Mapper-Nummern)",
    "bruecke": "VillageStudio lib/gebaeude.json, Stand 2026-09-05",
    "kosten": "Aus der exe gelesen ab 0x005C21D0 (BuildingDefinedData +0xA85C), int[110][5]. Index ist die Laufzeit-Gebaeudenummer. Im laufenden Spiel steht dieselbe Tabelle bei BuildingsState +0x18C7D4 = 0x01124CF4 und ist dort schreibbar.",
    "reihenfolge": "holz, stein, eisen, pech, gold"
  },
  "_erzeugt": "2026-09-07",
  "buildings": {
    "25": {
      "name": "High Wall",
      "aiv": 10,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)",
      "balance": null
    },
    "26": {
      "name": "High Crenel",
      "aiv": 12,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)",
      "balance": null
    },
    "35": {
      "name": "Low Crenel",
      "aiv": 13,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)",
      "balance": null
    },
    "46": {
      "name": "Low Wall",
      "aiv": 11,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Mauern kosten die KI nichts (Wissensstand Abschnitt 5, aus dem Programm abgelesen)",
      "balance": null
    },
    "50": {
      "name": "Fletcher",
      "aiv": 51,
      "cost": [
        20,
        0,
        0,
        0,
        100
      ],
      "balance": "Fletcher",
      "via": null
    },
    "51": {
      "name": "Woodcutter",
      "aiv": 61,
      "cost": [
        3,
        0,
        0,
        0,
        0
      ],
      "balance": "Woodcutter hut",
      "via": null
    },
    "52": {
      "name": "Stockpile",
      "aiv": 60,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Lagerplatz steht beim Spielstart schon da",
      "balance": null
    },
    "54": {
      "name": "House",
      "aiv": 80,
      "cost": [
        6,
        0,
        0,
        0,
        0
      ],
      "balance": "Hovel",
      "via": null
    },
    "55": {
      "name": "Ox Tether",
      "aiv": 63,
      "cost": [
        5,
        0,
        0,
        0,
        0
      ],
      "balance": null,
      "via": null
    },
    "61": {
      "name": "Keep",
      "aiv": 38,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Bergfried steht beim Spielstart schon da",
      "balance": null
    },
    "65": {
      "name": "Stables",
      "aiv": 59,
      "cost": [
        20,
        0,
        0,
        0,
        400
      ],
      "balance": "Stables",
      "via": null
    },
    "74": {
      "name": "Windmill",
      "aiv": 76,
      "cost": [
        20,
        0,
        0,
        0,
        0
      ],
      "balance": "Mill",
      "via": null
    },
    "75": {
      "name": "Bakery",
      "aiv": 77,
      "cost": [
        10,
        0,
        0,
        0,
        0
      ],
      "balance": "Bakery",
      "via": null
    },
    "76": {
      "name": "Brewery",
      "aiv": 78,
      "cost": [
        10,
        0,
        0,
        0,
        0
      ],
      "balance": "Brewery",
      "via": null
    },
    "77": {
      "name": "Trading Post",
      "aiv": 66,
      "cost": [
        5,
        0,
        0,
        0,
        0
      ],
      "balance": "Marketplace",
      "via": null
    },
    "78": {
      "name": "Hunter's Post",
      "aiv": 74,
      "cost": [
        5,
        0,
        0,
        0,
        0
      ],
      "balance": "Hunters hut",
      "via": null
    },
    "80": {
      "name": "Granary",
      "aiv": 70,
      "cost": [
        5,
        0,
        0,
        0,
        0
      ],
      "balance": null,
      "via": null
    },
    "81": {
      "name": "Armoury",
      "aiv": 56,
      "cost": [
        5,
        0,
        0,
        0,
        0
      ],
      "balance": "Armory",
      "via": null
    },
    "82": {
      "name": "Poleturner",
      "aiv": 50,
      "cost": [
        10,
        0,
        0,
        0,
        100
      ],
      "balance": "Poleturner",
      "via": null
    },
    "83": {
      "name": "Blacksmith",
      "aiv": 52,
      "cost": [
        20,
        0,
        0,
        0,
        200
      ],
      "balance": "Blacksmith",
      "via": null
    },
    "84": {
      "name": "Armourer",
      "aiv": 54,
      "cost": [
        20,
        0,
        0,
        0,
        100
      ],
      "balance": "Armourer",
      "via": null
    },
    "85": {
      "name": "Tanner",
      "aiv": 53,
      "cost": [
        10,
        0,
        0,
        0,
        100
      ],
      "balance": "Tanner",
      "via": null
    },
    "86": {
      "name": "Mercenary Post",
      "aiv": 39,
      "cost": [
        10,
        0,
        0,
        0,
        0
      ],
      "balance": "Mercenary post",
      "via": null
    },
    "87": {
      "name": "Barracks",
      "aiv": 55,
      "cost": [
        0,
        15,
        0,
        0,
        0
      ],
      "balance": "Barracks",
      "via": null
    },
    "88": {
      "name": "Engineering Guild",
      "aiv": 57,
      "cost": [
        10,
        0,
        0,
        0,
        100
      ],
      "balance": "Engineers guild",
      "via": null
    },
    "89": {
      "name": "Tunnelors Guild",
      "aiv": 58,
      "cost": [
        10,
        0,
        0,
        0,
        100
      ],
      "balance": "Tunnelers guild",
      "via": null
    },
    "92": {
      "name": "Inn",
      "aiv": 79,
      "cost": [
        20,
        0,
        0,
        0,
        100
      ],
      "balance": "Inn",
      "via": null
    },
    "93": {
      "name": "Healers",
      "aiv": 84,
      "cost": [
        20,
        0,
        0,
        0,
        150
      ],
      "balance": "Apothecary",
      "via": null
    },
    "95": {
      "name": "Chapel",
      "aiv": 81,
      "cost": [
        0,
        0,
        0,
        0,
        250
      ],
      "balance": "Chapel",
      "via": null
    },
    "96": {
      "name": "Church",
      "aiv": 82,
      "cost": [
        0,
        0,
        0,
        0,
        500
      ],
      "balance": "Church",
      "via": null
    },
    "97": {
      "name": "Cathedral",
      "aiv": 83,
      "cost": [
        0,
        0,
        0,
        0,
        1000
      ],
      "balance": "Cathedral",
      "via": null
    },
    "98": {
      "name": "Killing Pit",
      "aiv": 37,
      "cost": [
        6,
        0,
        0,
        0,
        0
      ],
      "balance": "Killing pit",
      "via": null
    },
    "99": {
      "name": "Pitch",
      "aiv": 24,
      "cost": [
        0,
        0,
        0,
        1,
        0
      ],
      "balance": null,
      "via": null
    },
    "105": {
      "name": "Drawbridge",
      "aiv": 44,
      "cost": [
        10,
        0,
        0,
        0,
        0
      ],
      "balance": "Drawbridge",
      "via": null
    },
    "106": {
      "name": "Moat x1",
      "aiv": 20,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Wassergraben ist eine Kachel, kein Gebaeude - keine Laufzeitnummer, kein Kosteneintrag",
      "balance": null
    },
    "110": {
      "name": "Tower1",
      "aiv": 30,
      "cost": [
        0,
        10,
        0,
        0,
        0
      ],
      "balance": "Tower one",
      "via": null
    },
    "111": {
      "name": "Tower2",
      "aiv": 31,
      "cost": [
        0,
        10,
        0,
        0,
        0
      ],
      "balance": null,
      "via": null
    },
    "112": {
      "name": "Tower3",
      "aiv": 32,
      "cost": [
        0,
        15,
        0,
        0,
        0
      ],
      "balance": "Tower three",
      "via": null
    },
    "113": {
      "name": "Tower4",
      "aiv": 33,
      "cost": [
        0,
        35,
        0,
        0,
        0
      ],
      "balance": "Tower four",
      "via": null
    },
    "114": {
      "name": "Tower5",
      "aiv": 34,
      "cost": [
        0,
        40,
        0,
        0,
        0
      ],
      "balance": "Tower five",
      "via": null
    },
    "144": {
      "name": "Small Gate NS",
      "aiv": 41,
      "cost": [
        0,
        10,
        0,
        0,
        0
      ],
      "balance": "Small gatehouse",
      "via": "Kosten der anderen Durchfahrt (Typ 145)"
    },
    "145": {
      "name": "Small Gate EW",
      "aiv": 41,
      "cost": [
        0,
        10,
        0,
        0,
        0
      ],
      "balance": "Small gatehouse",
      "via": null
    },
    "146": {
      "name": "Large Gate NS",
      "aiv": 43,
      "cost": [
        0,
        20,
        0,
        0,
        0
      ],
      "balance": "Large gatehouse",
      "via": "Kosten der anderen Durchfahrt (Typ 147)"
    },
    "147": {
      "name": "Large Gate EW",
      "aiv": 43,
      "cost": [
        0,
        20,
        0,
        0,
        0
      ],
      "balance": "Large gatehouse",
      "via": null
    },
    "166": {
      "name": "Communal Garden",
      "aiv": 95,
      "cost": [
        0,
        0,
        0,
        0,
        30
      ],
      "balance": "Garden",
      "via": null
    },
    "169": {
      "name": "Town Garden",
      "aiv": 94,
      "unknownPrice": "Die Laufzeit-Kostentabelle hat fuer diese AIV-Nummer keinen Eintrag - der Preis ist ungeklaert und wird nicht geraten.",
      "balance": null
    },
    "175": {
      "name": "Maypole",
      "aiv": 90,
      "cost": [
        0,
        0,
        0,
        0,
        25
      ],
      "balance": "Maypole",
      "via": null
    },
    "176": {
      "name": "Gallows",
      "aiv": 100,
      "cost": [
        0,
        0,
        0,
        0,
        50
      ],
      "balance": "Gallows",
      "via": null
    },
    "177": {
      "name": "Stocks",
      "aiv": 102,
      "cost": [
        0,
        0,
        0,
        0,
        45
      ],
      "balance": "Stocks",
      "via": null
    },
    "180": {
      "name": "Oil Smelter",
      "aiv": 35,
      "cost": [
        0,
        0,
        10,
        0,
        100
      ],
      "balance": "Oil smelter",
      "via": null
    },
    "181": {
      "name": "Stair 1 (highest)",
      "aiv": 14,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)",
      "balance": null
    },
    "182": {
      "name": "Stair 2",
      "aiv": 15,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)",
      "balance": null
    },
    "183": {
      "name": "Stair 3",
      "aiv": 16,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)",
      "balance": null
    },
    "184": {
      "name": "Stair 4",
      "aiv": 17,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)",
      "balance": null
    },
    "185": {
      "name": "Stair 5 (lowest)",
      "aiv": 18,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)",
      "balance": null
    },
    "186": {
      "name": "Stair6 (Floor)",
      "aiv": 19,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Treppen sind Kachelbits, kein Gebaeude (Wissensstand Abschnitt 5)",
      "balance": null
    },
    "200": {
      "name": "Dummy Step",
      "aiv": null,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Platzhalterschritt, kein Bauwerk",
      "balance": null
    },
    "301": {
      "name": "Cess Pit",
      "aiv": 101,
      "cost": [
        0,
        0,
        0,
        0,
        40
      ],
      "balance": "Cesspit",
      "via": null
    },
    "305": {
      "name": "Burning Stake",
      "aiv": 103,
      "cost": [
        0,
        0,
        0,
        0,
        45
      ],
      "balance": "Burning stake",
      "via": null
    },
    "306": {
      "name": "Gibbet",
      "aiv": 106,
      "cost": [
        0,
        0,
        0,
        0,
        50
      ],
      "balance": "Gibbet",
      "via": null
    },
    "307": {
      "name": "Dungeon",
      "aiv": 104,
      "cost": [
        0,
        0,
        0,
        0,
        40
      ],
      "balance": "Dungeon",
      "via": null
    },
    "308": {
      "name": "Rack",
      "aiv": 105,
      "cost": [
        0,
        0,
        0,
        0,
        45
      ],
      "balance": "Stretching rack",
      "via": null
    },
    "310": {
      "name": "Chopping Block",
      "aiv": 107,
      "cost": [
        0,
        0,
        0,
        0,
        45
      ],
      "balance": "Chopping block",
      "via": null
    },
    "311": {
      "name": "Dunking Pool",
      "aiv": 108,
      "cost": [
        0,
        0,
        0,
        0,
        40
      ],
      "balance": "Dunking stool",
      "via": null
    },
    "312": {
      "name": "Caged War Dogs",
      "aiv": 36,
      "cost": [
        10,
        0,
        0,
        0,
        100
      ],
      "balance": "Dog cage",
      "via": null
    },
    "313": {
      "name": "Statue",
      "aiv": 92,
      "cost": [
        0,
        0,
        0,
        0,
        30
      ],
      "balance": "Statue",
      "via": null
    },
    "318": {
      "name": "Shrine",
      "aiv": 93,
      "cost": [
        0,
        0,
        0,
        0,
        30
      ],
      "balance": "Shrine",
      "via": null
    },
    "324": {
      "name": "Dancing Bear",
      "aiv": 91,
      "cost": [
        0,
        0,
        0,
        0,
        20
      ],
      "balance": "Dancing bear",
      "via": null
    },
    "330": {
      "name": "Well",
      "aiv": 85,
      "cost": [
        0,
        0,
        0,
        0,
        30
      ],
      "balance": "Well",
      "via": null
    },
    "342": {
      "name": "Water Pot",
      "aiv": 86,
      "cost": [
        0,
        0,
        0,
        0,
        60
      ],
      "balance": "Water pot",
      "via": null
    },
    "10001": {
      "name": "High Stair",
      "aiv": null,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Hilfstyp der Oberflaeche, kein Bauwerk",
      "balance": null
    },
    "10002": {
      "name": "Low Stair",
      "aiv": null,
      "cost": [
        0,
        0,
        0,
        0,
        0
      ],
      "free": "Hilfstyp der Oberflaeche, kein Bauwerk",
      "balance": null
    }
  },
  "aicBuildings": {
    "quarry": {
      "aiv": 62,
      "balance": "Quarry",
      "arbeiter": 3
    },
    "iron": {
      "aiv": 64,
      "balance": "Iron mine",
      "arbeiter": 2
    },
    "wood": {
      "aiv": 61,
      "balance": "Woodcutter hut",
      "arbeiter": 1
    },
    "pitch": {
      "aiv": 65,
      "balance": "Pitch rig",
      "arbeiter": 1
    },
    "oxTethers": {
      "aiv": 63,
      "balance": null,
      "arbeiter": 1
    },
    "wheatFarm": {
      "aiv": 73,
      "balance": "Wheat farm",
      "arbeiter": 1
    },
    "hopFarm": {
      "aiv": 75,
      "balance": "Hop farm",
      "arbeiter": 1
    },
    "appleFarm": {
      "aiv": 71,
      "balance": "Apple farm",
      "arbeiter": 1
    },
    "dairyFarm": {
      "aiv": 72,
      "balance": "Dairy farm",
      "arbeiter": 1
    }
  },
  "aicCosts": {
    "quarry": [
      20,
      0,
      0,
      0,
      0
    ],
    "iron": [
      20,
      0,
      0,
      0,
      0
    ],
    "wood": [
      3,
      0,
      0,
      0,
      0
    ],
    "pitch": [
      20,
      0,
      0,
      0,
      0
    ],
    "oxTethers": [
      5,
      0,
      0,
      0,
      0
    ],
    "wheatFarm": [
      15,
      0,
      0,
      0,
      0
    ],
    "hopFarm": [
      15,
      0,
      0,
      0,
      0
    ],
    "appleFarm": [
      5,
      0,
      0,
      0,
      0
    ],
    "dairyFarm": [
      10,
      0,
      0,
      0,
      0
    ]
  }
};
  if (typeof window !== 'undefined') window.castleCostData = DATEN;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATEN;
})();
