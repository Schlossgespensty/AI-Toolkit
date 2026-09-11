// Rechenteil der Bauschritt-Auswertung: Kosten, Zeit und Bevoelkerung bis zu
// einem gewaehlten Bauschritt. Kein DOM, damit sich alles ohne Fenster testen
// laesst - die Oberflaeche liegt in castle-cost-panel.js.
//
// Was hier belegt ist und was nicht, steht bei jeder Funktion dabei. Die Regel
// fuer die ganze Datei: lieber "unbekannt" melden als still eine Null addieren.
'use strict';
(() => {
  const RESSOURCEN = ['wood', 'stone', 'iron', 'pitch', 'gold'];

  // Bautempo, gemessen an der Messburg Burg_left_1: ein Bauschritt dauert genau
  // 50 Ticks, das ist ein Spieltag - 445 von 445 Schritten ohne Abweichung
  // (VillageStudio doku/Wissensstand.md, Abschnitt "Bautempo").
  const TICKS_JE_SCHRITT = 50;
  const TAGE_JE_MONAT = 16;   // Monat = 800 Ticks, Tag = 50 Ticks
  const MONATE_JE_JAHR = 12;  // Jahr = 9600 Ticks
  const TAGE_JE_JAHR = TAGE_JE_MONAT * MONATE_JE_JAHR;

  const leereKosten = () => ({ wood: 0, stone: 0, iron: 0, pitch: 0, gold: 0 });

  const alsKosten = liste => {
    if (!Array.isArray(liste) || liste.length < 5) return null;
    const out = leereKosten();
    RESSOURCEN.forEach((name, i) => { out[name] = Number(liste[i]) || 0; });
    return out;
  };

  // Preis einer Bauart. Eine Balance-Datei ueberschreibt nur, was sie wirklich
  // nennt: fehlt dort das Feld "cost", bleibt der Vanilla-Preis stehen. Das ist
  // kein Sonderfall, sondern der Normalfall - in ascension.json haben sechs
  // Gebaeude nur Lebenspunkte und keine Kosten.
  function preisFuer(typ, daten, balance) {
    const eintrag = daten.buildings[String(typ)];
    if (!eintrag) return { kosten: null, quelle: 'unknown', name: null };
    if (eintrag.free) return { kosten: leereKosten(), quelle: 'free', name: eintrag.name, grund: eintrag.free };
    const vanilla = alsKosten(eintrag.cost);
    if (balance && eintrag.balance) {
      const b = balance.buildings && balance.buildings[eintrag.balance];
      const ausBalance = b ? alsKosten(b.cost) : null;
      if (ausBalance) return { kosten: ausBalance, quelle: 'balance', name: eintrag.name };
    }
    return { kosten: vanilla, quelle: vanilla ? 'vanilla' : 'unknown', name: eintrag.name };
  }

  // Summe der Bauschritte 1..bisIndex (einschliesslich). bisIndex ist der
  // nullbasierte Index in frames; null heisst "kein Schritt gewaehlt".
  function kostenBis(frames, bisIndex, daten, balance) {
    const summe = leereKosten();
    const jeTyp = new Map();
    const unbekannt = new Map();
    let bauwerke = 0;
    const grenze = Number.isInteger(bisIndex) ? Math.min(bisIndex, frames.length - 1) : frames.length - 1;

    for (let i = 0; i <= grenze; i++) {
      const frame = frames[i];
      if (!frame) continue;
      const typ = Number(frame.itemType);
      const anzahl = Array.isArray(frame.tilePositionOfsets) ? frame.tilePositionOfsets.length : 0;
      if (!anzahl) continue;
      bauwerke += anzahl;
      const preis = preisFuer(typ, daten, balance);
      if (preis.quelle === 'unknown') {
        unbekannt.set(typ, (unbekannt.get(typ) || 0) + anzahl);
        continue;
      }
      const zeile = jeTyp.get(typ) || { type: typ, name: preis.name, count: 0, unit: preis.kosten, source: preis.quelle, reason: preis.grund || null };
      zeile.count += anzahl;
      zeile.unit = preis.kosten;
      zeile.source = preis.quelle;
      jeTyp.set(typ, zeile);
      for (const r of RESSOURCEN) summe[r] += preis.kosten[r] * anzahl;
    }

    // Was nachweislich nichts kostet (Mauern, Treppen, Bergfried), bleibt aus
    // der Aufstellung heraus. Eine Bauart, die eine Balance auf null gesetzt
    // hat, bleibt dagegen stehen - sonst verschwindet sie kommentarlos aus der
    // Liste und niemand sieht, dass die Balance sie verschenkt.
    const zeilen = [...jeTyp.values()]
      .filter(z => z.source !== 'free')
      .map(z => ({ ...z, total: Object.fromEntries(RESSOURCEN.map(r => [r, z.unit[r] * z.count])) }))
      .sort((a, b) => (b.total.gold + b.total.wood * 10 + b.total.stone * 10) - (a.total.gold + a.total.wood * 10 + a.total.stone * 10));

    return {
      cost: summe,
      rows: zeilen,
      buildings: bauwerke,
      unknown: [...unbekannt.entries()].map(([type, count]) => ({ type, count }))
    };
  }

  // Vergangene Spielzeit bis zum gewaehlten Schritt.
  // Belegt: ein Schritt = 50 Ticks = ein Spieltag, auch ein Schritt, der nicht
  // gebaut werden kann, verbraucht seinen Tag. Der erste Schritt ist der
  // Nullpunkt, nach n Schritten sind n-1 Tage vergangen.
  // NICHT belegt und darum als Vorbehalt in der Oberflaeche: hat die KI kein
  // Geld, wartet sie - dann ist diese Zahl die Untergrenze, nicht die Wahrheit.
  function zeitBis(schritte) {
    const tage = Math.max(0, schritte - 1);
    const jahre = Math.floor(tage / TAGE_JE_JAHR);
    const monate = Math.floor((tage % TAGE_JE_JAHR) / TAGE_JE_MONAT);
    const resttage = tage % TAGE_JE_MONAT;
    const teile = [];
    if (jahre) teile.push(`${jahre} year${jahre === 1 ? '' : 's'}`);
    if (monate) teile.push(`${monate} month${monate === 1 ? '' : 's'}`);
    if (resttage || !teile.length) teile.push(`${resttage} day${resttage === 1 ? '' : 's'}`);
    return {
      steps: schritte,
      days: tage,
      ticks: tage * TICKS_JE_SCHRITT,
      years: jahre,
      months: monate,
      remainderDays: resttage,
      totalMonths: Math.floor(tage / TAGE_JE_MONAT),
      label: teile.join(', ')
    };
  }

  // Bevoelkerung bis zum gewaehlten Schritt.
  // provides/requires stammen aus config/aiv_gamedata.json: Bergfried gibt 10,
  // Huette gibt 8, und eine Reihe von Bauten braucht je einen Arbeiter.
  function bevoelkerungBis(frames, bisIndex, popDaten) {
    const provides = (popDaten && popDaten.population_effects && popDaten.population_effects.provides) || {};
    const requires = (popDaten && popDaten.population_effects && popDaten.population_effects.requires) || {};
    let provided = 0;
    let required = 0;
    const grenze = Number.isInteger(bisIndex) ? Math.min(bisIndex, frames.length - 1) : frames.length - 1;
    for (let i = 0; i <= grenze; i++) {
      const frame = frames[i];
      if (!frame) continue;
      const key = String(Number(frame.itemType));
      const anzahl = Array.isArray(frame.tilePositionOfsets) ? frame.tilePositionOfsets.length : 0;
      provided += (Number(provides[key]) || 0) * anzahl;
      required += (Number(requires[key]) || 0) * anzahl;
    }
    return { provided, required, left: provided - required };
  }

  // Wie viele Farmen welcher Art die AIC bei dieser Bevoelkerung aufmacht.
  // Die Anzahl kommt aus dem schon vorhandenen Rechenweg der Figuren-Seite
  // (window.characterPopulation), die Art aus den Feldern Farm1..Farm8.
  function farmAufteilung(aic, farmAnzahl) {
    if (!aic) return null;
    const arten = [];
    for (let i = 1; i <= 8; i++) {
      const wert = aic[`Farm${i}`];
      if (wert == null || wert === 'None') continue;
      arten.push(String(wert));
    }
    if (!arten.length) return null;
    const genutzt = arten.slice(0, Math.max(0, Number(farmAnzahl) || 0));
    const zaehlung = {};
    for (const art of genutzt) zaehlung[art] = (zaehlung[art] || 0) + 1;
    return { slots: arten, used: genutzt, counts: zaehlung, hop: zaehlung.HopFarm || 0 };
  }

  function auswerten(options) {
    const frames = Array.isArray(options.frames) ? options.frames : [];
    const daten = options.data;
    const bisIndex = Number.isInteger(options.stepIndex) ? options.stepIndex : null;
    const schritte = bisIndex == null ? frames.length : Math.min(bisIndex + 1, frames.length);
    const kosten = kostenBis(frames, bisIndex, daten, options.balance || null);
    const wholeCastle = bisIndex == null || bisIndex >= frames.length - 1
      ? kosten : kostenBis(frames, null, daten, options.balance || null);
    const bevoelkerung = bevoelkerungBis(frames, bisIndex, options.populationData);
    const aicStats = typeof options.aicAt === 'function' ? options.aicAt(Math.max(0, bevoelkerung.provided)) : null;
    const aicBedarf = aicStats ? (Number(aicStats.population) || 0) : null;
    return {
      steps: schritte,
      totalSteps: frames.length,
      ...kosten,
      wholeCastleCost: wholeCastle.cost,
      wholeCastleUnknown: wholeCastle.unknown,
      time: zeitBis(schritte),
      population: {
        ...bevoelkerung,
        aic: aicStats,
        aicNeeded: aicBedarf,
        free: aicBedarf == null ? null : bevoelkerung.left - aicBedarf,
        farms: aicStats ? farmAufteilung(options.aic, aicStats.farms) : null
      }
    };
  }

  const API = { auswerten, kostenBis, zeitBis, bevoelkerungBis, farmAufteilung, preisFuer, RESSOURCEN, TICKS_JE_SCHRITT, TAGE_JE_MONAT, MONATE_JE_JAHR };
  if (typeof window !== 'undefined') window.castleCostModel = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
