// Die Anzeige neben der Bauschritt-Liste: was die Burg bis zum gewaehlten
// Schritt gekostet hat, wie viel Zeit vergangen ist und wie die Bevoelkerung
// zu diesem Zeitpunkt dasteht.
//
// Die Oberflaeche wird hier im Code gebaut und in die vorhandene Bauleiste
// gehaengt, damit index.html und combined.css unberuehrt bleiben.
// Gerechnet wird nichts in dieser Datei - das steht in castle-cost-model.js.
'use strict';
(() => {
  const SPEICHER = 'aiv.castleCostBalances.v1';
  const SPEICHER_WAHL = 'aiv.castleCostBalanceChoice.v1';
  const RESSOURCEN = [
    { key: 'wood', label: 'Wood' },
    { key: 'stone', label: 'Stone' },
    { key: 'iron', label: 'Iron' },
    { key: 'pitch', label: 'Pitch' },
    { key: 'gold', label: 'Gold' }
  ];

  const state = {
    balances: {},        // Name -> { buildings: {...} }
    choice: 'vanilla',
    letzte: null,        // letzter Aufruf von update(), fuers Neuzeichnen
    aufgeklappt: false
  };
  const els = {};

  const zahl = n => Number(n || 0).toLocaleString('en-US');

  // localStorage kann in jedem Zugriff werfen (Privatfenster, gesperrte
  // Seitendaten). Darum jeder Zugriff eingepackt und mit brauchbarem Rueckfall.
  function lade() {
    try {
      const roh = window.localStorage.getItem(SPEICHER);
      if (roh) state.balances = JSON.parse(roh) || {};
      const wahl = window.localStorage.getItem(SPEICHER_WAHL);
      if (wahl) state.choice = wahl;
    } catch { /* ohne Gedaechtnis weiterarbeiten ist besser als gar nicht */ }
  }

  function sichere() {
    try {
      window.localStorage.setItem(SPEICHER, JSON.stringify(state.balances));
      window.localStorage.setItem(SPEICHER_WAHL, state.choice);
    } catch { /* siehe oben */ }
  }

  function baueOberflaeche() {
    const panel = document.querySelector('.castleBuildPanel');
    if (!panel) return false;
    const anker = panel.querySelector('.castlePopulationOverview');

    const wurzel = document.createElement('section');
    wurzel.className = 'castleCostOverview';
    wurzel.setAttribute('aria-label', 'Cost, timing and population up to the selected build step');
    wurzel.innerHTML = `
      <div class="costOverviewTitle">
        <span>Up to step</span>
        <strong id="castleCostStep">-</strong>
      </div>

      <div class="costBalanceRow">
        <label for="castleCostBalance">Balance</label>
        <select id="castleCostBalance"></select>
        <button type="button" id="castleCostLoadBalance" title="Load a balance JSON (Ascension, Team League, ...)">Load…</button>
      </div>
      <input type="file" id="castleCostBalanceFile" accept="application/json,.json" hidden>

      <div class="costGrid" id="castleCostGrid"></div>

      <div class="costNote" id="castleCostWarning" hidden></div>

      <div class="costSection">
        <div class="costSectionTitle">Elapsed game time</div>
        <div class="populationOverviewRow costTimeMain"><span id="castleCostTimeLabel">-</span><strong id="castleCostTimeDays">0</strong></div>
        <div class="costHint" id="castleCostTimeHint"></div>
      </div>

      <div class="costSection">
        <div class="costSectionTitle">Population up to this step</div>
        <div class="populationOverviewRow"><span>Provided by castle</span><strong id="castleCostPopProvided">0</strong></div>
        <div class="populationOverviewRow"><span>Required by castle</span><strong id="castleCostPopRequired">0</strong></div>
        <div class="populationOverviewRow"><span>Required by character (AIC)</span><strong id="castleCostPopAic">-</strong></div>
        <div class="populationOverviewRow populationOverviewPrimary"><span>Free</span><strong id="castleCostPopFree">-</strong></div>
        <div class="costHint" id="castleCostAicDetail"></div>
      </div>

      <button type="button" class="costToggle" id="castleCostToggle" aria-expanded="false">Show cost per building</button>
      <div class="costTable" id="castleCostTable" hidden></div>

      <div class="costHint costProvenance" id="castleCostProvenance"></div>
    `;

    if (anker) panel.insertBefore(wurzel, anker);
    else panel.appendChild(wurzel);

    els.wurzel = wurzel;
    els.step = wurzel.querySelector('#castleCostStep');
    els.balance = wurzel.querySelector('#castleCostBalance');
    els.loadBtn = wurzel.querySelector('#castleCostLoadBalance');
    els.file = wurzel.querySelector('#castleCostBalanceFile');
    els.grid = wurzel.querySelector('#castleCostGrid');
    els.warning = wurzel.querySelector('#castleCostWarning');
    els.timeLabel = wurzel.querySelector('#castleCostTimeLabel');
    els.timeDays = wurzel.querySelector('#castleCostTimeDays');
    els.timeHint = wurzel.querySelector('#castleCostTimeHint');
    els.popProvided = wurzel.querySelector('#castleCostPopProvided');
    els.popRequired = wurzel.querySelector('#castleCostPopRequired');
    els.popAic = wurzel.querySelector('#castleCostPopAic');
    els.popFree = wurzel.querySelector('#castleCostPopFree');
    els.aicDetail = wurzel.querySelector('#castleCostAicDetail');
    els.toggle = wurzel.querySelector('#castleCostToggle');
    els.table = wurzel.querySelector('#castleCostTable');
    els.provenance = wurzel.querySelector('#castleCostProvenance');

    for (const r of RESSOURCEN) {
      const zelle = document.createElement('div');
      zelle.className = 'costCell';
      zelle.innerHTML = `<span>${r.label}</span><strong data-res="${r.key}">0</strong>`;
      els.grid.appendChild(zelle);
    }

    els.balance.addEventListener('change', () => {
      state.choice = els.balance.value;
      sichere();
      zeichne();
    });
    els.loadBtn.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', onBalanceDatei);
    els.toggle.addEventListener('click', () => {
      state.aufgeklappt = !state.aufgeklappt;
      els.toggle.setAttribute('aria-expanded', String(state.aufgeklappt));
      els.toggle.textContent = state.aufgeklappt ? 'Hide cost per building' : 'Show cost per building';
      els.table.hidden = !state.aufgeklappt;
      zeichne();
    });

    fuelleBalanceListe();
    const daten = window.castleCostData;
    els.provenance.textContent = daten
      ? `Vanilla prices read from the game exe at ${daten._quelle && daten._quelle.kosten ? '0x005C21D0' : 'the build cost table'}. One build step = 50 ticks = one game day (measured, 445 of 445 steps).`
      : 'Cost table not loaded.';
    return true;
  }

  function fuelleBalanceListe() {
    if (!els.balance) return;
    els.balance.innerHTML = '';
    const eintraege = [['vanilla', 'Vanilla (game exe)'], ...Object.keys(state.balances).map(n => [n, n])];
    for (const [wert, text] of eintraege) {
      const opt = document.createElement('option');
      opt.value = wert;
      opt.textContent = text;
      els.balance.appendChild(opt);
    }
    if (!eintraege.some(([w]) => w === state.choice)) state.choice = 'vanilla';
    els.balance.value = state.choice;
  }

  function onBalanceDatei(event) {
    const datei = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!datei) return;
    const leser = new FileReader();
    leser.onload = () => {
      let inhalt;
      try { inhalt = JSON.parse(String(leser.result)); }
      catch (fehler) { meldeFehler(`${datei.name} is not valid JSON.`); return; }
      if (!inhalt || typeof inhalt.buildings !== 'object' || !inhalt.buildings) {
        meldeFehler(`${datei.name} has no "buildings" section - that is where the costs live.`);
        return;
      }
      const name = datei.name.replace(/\.json$/i, '');
      state.balances[name] = { buildings: inhalt.buildings };
      state.choice = name;
      sichere();
      fuelleBalanceListe();
      zeichne();
    };
    leser.onerror = () => meldeFehler(`${datei.name} could not be read.`);
    leser.readAsText(datei);
  }

  function meldeFehler(text) {
    if (!els.warning) return;
    els.warning.hidden = false;
    els.warning.textContent = text;
  }

  function aktiveBalance() {
    return state.choice === 'vanilla' ? null : (state.balances[state.choice] || null);
  }

  // Die Figuren-Seite rechnet die AIC-Ressourcengebaeude schon aus; hier wird
  // ihr Rechenweg nur mit der Bevoelkerung BIS ZU DIESEM SCHRITT gefuettert.
  function aicRechner() {
    const cp = window.characterPopulation;
    return cp && typeof cp.calculateAt === 'function' ? pop => cp.calculateAt(pop) : null;
  }

  function aicFelder() {
    try {
      const roh = window.characterEditor && window.characterEditor.getContent && window.characterEditor.getContent();
      if (!roh) return null;
      const geparst = JSON.parse(roh);
      return geparst && geparst.aic ? geparst.aic : null;
    } catch { return null; }
  }

  function zeichne() {
    if (!els.wurzel || !state.letzte) return;
    const daten = window.castleCostData;
    const modell = window.castleCostModel;
    if (!daten || !modell) return;

    const { frames, stepIndex, populationData } = state.letzte;
    const ergebnis = modell.auswerten({
      frames, stepIndex, data: daten, balance: aktiveBalance(),
      populationData, aicAt: aicRechner(), aic: aicFelder()
    });

    els.step.textContent = ergebnis.totalSteps
      ? `${ergebnis.steps} of ${ergebnis.totalSteps}`
      : 'no steps';

    for (const r of RESSOURCEN) {
      const feld = els.grid.querySelector(`[data-res="${r.key}"]`);
      if (feld) {
        feld.textContent = zahl(ergebnis.cost[r.key]);
        feld.classList.toggle('costZero', !ergebnis.cost[r.key]);
      }
    }

    if (ergebnis.unknown.length) {
      const namen = ergebnis.unknown
        .map(u => `${u.count}x ${(daten.buildings[String(u.type)] || {}).name || `type ${u.type}`}`)
        .join(', ');
      els.warning.hidden = false;
      els.warning.textContent = `Price unknown, not counted: ${namen}. The build cost table has no entry for these.`;
    } else {
      els.warning.hidden = true;
      els.warning.textContent = '';
    }

    els.timeLabel.textContent = ergebnis.time.label;
    els.timeDays.textContent = `${zahl(ergebnis.time.days)} days`;
    els.timeHint.textContent = `${zahl(ergebnis.time.ticks)} ticks - one step is one game day, and a step that cannot be built still uses its day. If the AI runs out of money it waits, so this is the earliest possible time, not a promise.`;

    const pop = ergebnis.population;
    els.popProvided.textContent = zahl(pop.provided);
    els.popRequired.textContent = zahl(pop.required);
    els.popAic.textContent = pop.aicNeeded == null ? 'no character file' : zahl(pop.aicNeeded);
    els.popFree.textContent = pop.free == null ? '-' : zahl(pop.free);
    els.popFree.classList.toggle('populationNegative', pop.free != null && pop.free < 0);

    if (pop.aic) {
      const mehrzahl = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
      const teile = [
        mehrzahl(pop.aic.quarries, 'quarry', 'quarries'),
        mehrzahl(pop.aic.iron, 'iron mine', 'iron mines'),
        mehrzahl(pop.aic.wood, 'woodcutter', 'woodcutters'),
        mehrzahl(pop.aic.farms, 'farm', 'farms'),
        mehrzahl(pop.aic.pitch, 'pitch rig', 'pitch rigs'),
        mehrzahl(pop.aic.oxTethers, 'ox tether', 'ox tethers')
      ];
      let satz = `At ${zahl(pop.provided)} population the AIC opens ${teile.join(', ')}.`;
      if (pop.farms && pop.farms.hop) {
        satz += ` ${pop.farms.hop === 1 ? '1 of those farms grows hops' : `${pop.farms.hop} of those farms grow hops`}.`;
      }
      els.aicDetail.textContent = satz;
    } else {
      els.aicDetail.textContent = 'Open a character file to see how many resource buildings the AIC would add here.';
    }

    if (state.aufgeklappt) zeichneTabelle(ergebnis);
  }

  function zeichneTabelle(ergebnis) {
    els.table.innerHTML = '';
    if (!ergebnis.rows.length) {
      els.table.textContent = 'Nothing with a price up to this step.';
      return;
    }
    for (const zeile of ergebnis.rows) {
      const teile = RESSOURCEN.filter(r => zeile.total[r.key]).map(r => `${zahl(zeile.total[r.key])} ${r.label.toLowerCase()}`);
      if (!teile.length) teile.push('no cost');
      const div = document.createElement('div');
      div.className = 'costTableRow';
      const name = document.createElement('span');
      name.className = 'costTableName';
      name.textContent = `${zeile.count}x ${zeile.name}`;
      const value = document.createElement('span');
      value.className = 'costTableValue';
      value.textContent = teile.join(', ');
      div.append(name, value);
      if (zeile.source === 'balance') div.classList.add('costFromBalance');
      div.title = zeile.source === 'balance'
        ? 'Price from the selected balance file'
        : 'Price from the game exe (vanilla)';
      els.table.appendChild(div);
    }
  }

  const API = {
    // Wird aus castle-editor.js bei jedem Neuzeichnen der Bauliste gerufen.
    update(daten) {
      state.letzte = {
        frames: Array.isArray(daten && daten.frames) ? daten.frames : [],
        stepIndex: Number.isInteger(daten && daten.stepIndex) ? daten.stepIndex : null,
        populationData: (daten && daten.populationData) || null
      };
      if (!els.wurzel && !baueOberflaeche()) return;
      zeichne();
    },
    redraw: zeichne,
    getBalanceNames: () => Object.keys(state.balances),
    getChoice: () => state.choice
  };

  lade();
  window.castleCostPanel = API;
  // Aendert sich die AIC, aendert sich der Arbeiterbedarf - dann neu rechnen.
  window.addEventListener('character-population-changed', () => zeichne());
})();
