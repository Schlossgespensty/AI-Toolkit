// Die beiden Anzeigen am Rand des Burgeditors: Kosten und Bevoelkerung bis
// zum gewaehlten Bauschritt. Ihre statischen Einhaengepunkte stehen in der
// Seite, damit der Benutzer beide Anzeigen unabhaengig verschieben kann.
// Gerechnet wird nichts in dieser Datei - das steht in castle-cost-model.js.
'use strict';
(() => {
  const SPEICHER = 'aiv.castleCostBalances.v1';
  const SPEICHER_WAHL = 'aiv.castleCostBalanceChoice.v1';
  const COLLAPSE_STORAGE = 'aiv.castleCostPanelCollapsed.v1';
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
    aufgeklappt: false,
    collapsed: false,
    production: window.castleProduction.settings(),
    balanceSource: ''
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
      state.collapsed = window.localStorage.getItem(COLLAPSE_STORAGE) === 'true';
      state.production = window.castleProduction.settings(JSON.parse(window.localStorage.getItem('aiv.production.v1') || '{}'));
    } catch { /* ohne Gedaechtnis weiterarbeiten ist besser als gar nicht */ }
  }

  function sichere() {
    try {
      window.localStorage.setItem(SPEICHER, JSON.stringify(state.balances));
      window.localStorage.setItem(SPEICHER_WAHL, state.choice);
    } catch { /* siehe oben */ }
  }

  function baueOberflaeche() {
    const wurzel = document.getElementById('castleCostOverview');
    const bevoelkerung = document.getElementById('castlePopulationOverview');
    if (!wurzel || !bevoelkerung) return false;
    wurzel.innerHTML = `
      <div class="costOverviewTitle castleOverviewTitle">
        <button type="button" id="castleCostCollapse" class="costCollapse" aria-controls="castleCostBody" aria-expanded="true">Castle costs ▾</button>
        <span class="castleOverviewTitleActions">
          <strong id="castleCostStep">-</strong>
          <button type="button" class="castleOverviewInfoButton" data-info-target="castleCostInfo" aria-label="About the castle cost overview" aria-expanded="false">i</button>
        </span>
      </div>

      <div id="castleCostBody">
      <div class="costBalanceRow">
        <label for="castleCostBalance">Balance</label>
        <select id="castleCostBalance"></select>
        <button type="button" id="castleCostLoadBalance" title="Load a balance JSON (Ascension, Team League, ...)">Load…</button>
        <button type="button" id="castleCostUcpBalance">Use UCP balance</button>
      </div>
      <input type="file" id="castleCostBalanceFile" accept="application/json,.json" hidden>

      <div class="costSectionTitle" id="castleCostScope">Cumulative through selected step</div>
      <div class="costGrid" id="castleCostGrid"></div>
      <div class="costSectionTitle">Estimated gross production through this step</div>
      <div class="costHint" id="castleProductionTotals"></div>
      <div class="costHint" id="castleProductionComparison"></div>
      <details class="costProductionSettings"><summary>Production assumptions</summary>
        <p class="costHint">Potential AIC production, assuming full staffing as housing becomes available. Timings below are planning defaults, not measured game rates. Excludes construction delays, pauses, input shortages, consumption, trade, transport bottlenecks and fear/rest effects. These goods are not your stockpile balance.</p>
        <label>Resource distance <input id="productionDistance" type="number" min="0" max="1000"></label>
        <label>Per extra building <input id="productionExtraDistance" type="number" min="0" max="1000"></label>
        <label>Walking ticks / tile <input id="productionWalkTicks" type="number" min="0.01" max="1000" step="0.1"></label>
        <label>Delivery productivity % <input id="productionProductivity" type="number" min="100" max="1000"></label>
        <label><input id="productionSkirmish" type="checkbox"> Skirmish delivery bonus where enabled by balance</label>
        <div id="productionWorkTicks"></div>
        <p class="costHint">Work ticks exclude the return journey: cycle = work ticks + 2 × distance × walking ticks. Each producer keeps its own progress and fractional delivery bonus. Stone is quarry output; ox transport is not simulated. Route overlay distances are separate layout diagnostics, not measured external-resource distances.</p>
      </details>
      <div class="costHint" id="castleBalanceSource"></div>
      <div class="costCastleTotal"><span>Entire castle total</span><strong id="castleCostWholeTotal"></strong></div>

      <div class="costNote" id="castleCostWarning" hidden></div>

      <div class="costSection">
        <div class="costSectionTitle">Elapsed game time</div>
        <div class="populationOverviewRow costTimeMain"><span id="castleCostTimeLabel">-</span><strong id="castleCostTimeDays">0</strong></div>
      </div>

      <button type="button" class="costToggle" id="castleCostToggle" aria-expanded="false">Show cost per building</button>
      <div class="costTable" id="castleCostTable" hidden></div>

      <div id="castleCostInfo" class="castleOverviewInfo" hidden>
        <p class="costHint" id="castleCostTimeHint"></p>
        <p class="costHint costProvenance" id="castleCostProvenance"></p>
      </div>
      </div>
    `;

    els.wurzel = wurzel;
    els.collapse = wurzel.querySelector('#castleCostCollapse');
    els.body = wurzel.querySelector('#castleCostBody');
    els.scope = wurzel.querySelector('#castleCostScope');
    els.wholeTotal = wurzel.querySelector('#castleCostWholeTotal');
    els.productionTotals = wurzel.querySelector('#castleProductionTotals');
    els.productionComparison = wurzel.querySelector('#castleProductionComparison');
    els.balanceSource = wurzel.querySelector('#castleBalanceSource');
    const numericSettings = { productionDistance: 'distance', productionExtraDistance: 'extraDistance', productionWalkTicks: 'walkTicks', productionProductivity: 'productivity' };
    const saveProduction = () => {
      try { window.localStorage.setItem('aiv.production.v1', JSON.stringify(state.production)); } catch { /* session only */ }
      zeichne();
    };
    for (const [id, key] of Object.entries(numericSettings)) {
      const input = wurzel.querySelector(`#${id}`);
      input.value = state.production[key];
      input.addEventListener('change', () => {
        state.production = window.castleProduction.settings({ ...state.production, [key]: input.value });
        input.value = state.production[key]; saveProduction();
      });
    }
    const skirmish = wurzel.querySelector('#productionSkirmish');
    skirmish.checked = state.production.skirmish;
    skirmish.addEventListener('change', () => { state.production.skirmish = skirmish.checked; saveProduction(); });
    for (const good of Object.keys(window.castleProduction.GOODS)) {
      const label = document.createElement('label');
      label.textContent = `${good} work ticks / delivery`;
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '1000000';
      input.value = state.production.workTicks[good];
      input.addEventListener('change', () => {
        state.production = window.castleProduction.settings({ ...state.production, workTicks: { ...state.production.workTicks, [good]: input.value } });
        input.value = state.production.workTicks[good]; saveProduction();
      });
      label.appendChild(input); wurzel.querySelector('#productionWorkTicks').appendChild(label);
    }
    wurzel.querySelector('#castleCostUcpBalance').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        const loaded = await window.electronAPI.readInstalledBalance();
        const name = `UCP: ${loaded.name}`;
        state.balances[name] = window.castleBalance.validate(loaded.profile);
        state.choice = name; state.balanceSource = loaded.filePath;
        sichere(); fuelleBalanceListe(); zeichne();
      } catch (error) { meldeFehler(error.message); }
      finally { button.disabled = false; }
    });
    els.step = wurzel.querySelector('#castleCostStep');
    els.populationStep = bevoelkerung.querySelector('#castlePopulationStep');
    els.balance = wurzel.querySelector('#castleCostBalance');
    els.loadBtn = wurzel.querySelector('#castleCostLoadBalance');
    els.file = wurzel.querySelector('#castleCostBalanceFile');
    els.grid = wurzel.querySelector('#castleCostGrid');
    els.warning = wurzel.querySelector('#castleCostWarning');
    els.timeLabel = wurzel.querySelector('#castleCostTimeLabel');
    els.timeDays = wurzel.querySelector('#castleCostTimeDays');
    els.timeHint = wurzel.querySelector('#castleCostTimeHint');
    els.popProvided = bevoelkerung.querySelector('#castleCostPopProvided');
    els.popRequired = bevoelkerung.querySelector('#castleCostPopRequired');
    els.popAic = bevoelkerung.querySelector('#castleCostPopAic');
    els.popFree = bevoelkerung.querySelector('#castleCostPopFree');
    els.aicDetail = bevoelkerung.querySelector('#castleCostAicDetail');
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
      state.balanceSource = '';
      sichere();
      zeichne();
    });
    els.collapse.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      applyCollapsed();
      try { window.localStorage.setItem(COLLAPSE_STORAGE, String(state.collapsed)); } catch { /* session still works */ }
    });
    applyCollapsed();
    els.loadBtn.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', onBalanceDatei);
    els.toggle.addEventListener('click', () => {
      state.aufgeklappt = !state.aufgeklappt;
      els.toggle.setAttribute('aria-expanded', String(state.aufgeklappt));
      els.toggle.textContent = state.aufgeklappt ? 'Hide cost per building' : 'Show cost per building';
      els.table.hidden = !state.aufgeklappt;
      zeichne();
    });
    for (const button of document.querySelectorAll('.castleOverviewInfoButton')) {
      button.addEventListener('click', () => {
        const info = document.getElementById(button.dataset.infoTarget || '');
        if (!info) return;
        if (button.dataset.infoTarget === 'castleCostInfo' && state.collapsed) {
          state.collapsed = false;
          applyCollapsed();
          try { window.localStorage.setItem(COLLAPSE_STORAGE, 'false'); } catch { /* session still works */ }
        }
        const expanded = info.hidden;
        info.hidden = !expanded;
        button.setAttribute('aria-expanded', String(expanded));
      });
    }

    fuelleBalanceListe();
    const daten = window.castleCostData;
    els.provenance.textContent = daten
      ? `Bundled vanilla prices were extracted from the game exe at ${daten._quelle && daten._quelle.kosten ? '0x005C21D0' : 'the build cost table'}. Load a plugin balance JSON to override building prices; missing overrides retain vanilla prices. This does not read the currently running game. One build step = 50 ticks = one game day (measured, 445 of 445 steps).`
      : 'Cost table not loaded.';
    if (window.castleEditor && typeof window.castleEditor.refreshOverviewLayout === 'function') {
      window.castleEditor.refreshOverviewLayout();
    }
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

  function applyCollapsed() {
    els.body.hidden = state.collapsed;
    els.wurzel.classList.toggle('costCollapsed', state.collapsed);
    els.collapse.setAttribute('aria-expanded', String(!state.collapsed));
    els.collapse.textContent = state.collapsed ? 'Castle costs ▸' : 'Castle costs ▾';
  }

  function costSummary(cost) {
    return RESSOURCEN.map(r => `${zahl(cost[r.key])} ${r.label.toLowerCase()}`).join(' · ');
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
      try { inhalt = window.castleBalance.validate(inhalt); }
      catch (error) { meldeFehler(error.message); return; }
      const name = datei.name.replace(/\.json$/i, '');
      state.balances[name] = inhalt;
      state.balanceSource = datei.name;
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
    const production = window.castleProduction.estimate({ frames, stepIndex, populationData,
      aicAt: aicRechner(), aic: aicFelder(), balance: aktiveBalance(), options: state.production, costModel: modell, data: daten });
    els.productionTotals.textContent = production
      ? Object.entries(production).map(([good, result]) => `${zahl(result.produced)} ${good.toLowerCase()}`).join(' · ')
      : 'Open a character to estimate production from its AIC.';
    els.productionComparison.textContent = production
      ? ['wood', 'stone', 'iron', 'pitch'].map(good => `${good}: ${zahl(ergebnis.cost[good])} construction / ${zahl(production[good[0].toUpperCase() + good.slice(1)].produced)} potential output`).join(' · ')
      : '';
    els.balanceSource.textContent = state.balanceSource ? `Loaded snapshot: ${state.balanceSource}. Reload after UCP changes.`
      : state.choice === 'vanilla' ? 'Bundled vanilla prices. Use UCP balance to read your configured profile.' : 'Saved balance snapshot. Reload after UCP changes.';

    const schrittText = ergebnis.totalSteps
      ? `${ergebnis.steps} of ${ergebnis.totalSteps}`
      : 'no steps';
    els.step.textContent = schrittText;
    els.scope.textContent = ergebnis.steps ? `Cumulative total · steps 1–${ergebnis.steps}` : 'Cumulative total · no steps';
    els.wholeTotal.textContent = costSummary(ergebnis.wholeCastleCost)
      + (ergebnis.wholeCastleUnknown.length ? ' (partial: unknown prices)' : '');
    els.collapse.title = `Through step ${ergebnis.steps}: ${costSummary(ergebnis.cost)}`
      + (ergebnis.unknown.length ? ' (partial: unknown prices)' : '');
    if (els.populationStep) els.populationStep.textContent = schrittText;

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
      els.table.textContent = 'Nothing with a known price up to this step.';
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
    const total = document.createElement('div');
    total.className = 'costTableRow costTableTotal';
    const label = document.createElement('strong');
    label.textContent = `Cumulative total through step ${ergebnis.steps}`;
    const value = document.createElement('span');
    value.textContent = costSummary(ergebnis.cost) + (ergebnis.unknown.length ? ' (partial)' : '');
    total.append(label, value);
    els.table.appendChild(total);
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
