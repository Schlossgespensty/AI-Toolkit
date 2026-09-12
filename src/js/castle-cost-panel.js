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
    balanceSource: '',
    balanceError: '',
    balanceStatus: 'saved',
    icons: {}
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
      state.production = window.castleProduction.restoreSettings(
        JSON.parse(window.localStorage.getItem('aiv.production.v2') || 'null'),
        JSON.parse(window.localStorage.getItem('aiv.production.v1') || 'null'));
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
      <div class="costGrid" id="castleCostGrid" hidden></div>
      <div class="costCastleTotal"><span id="castleCostTotalLabel">Total through current step</span><strong id="castleCostStepTotal"></strong></div>
      <div class="costSectionTitle">Resources through this step</div>
      <div class="costHint" id="castleProductionTotals"></div>
      <div id="castleProductionComparison"></div>
      <div class="costNote" id="castleBalanceError" hidden></div>
      <details class="costProductionSettings"><summary>Production assumptions</summary>
        <p class="costHint">Reference estimate from Stronghold Heaven (original Stronghold), assuming full staffing as housing becomes available. These approximate rates are not verified Crusader simulation timings. Excludes construction delays, pauses, input shortages, consumption, trade, transport bottlenecks and fear/rest effects. These goods are not your stockpile balance.</p>
        <label>Resource distance <input id="productionDistance" type="number" min="0" max="1000"></label>
        <label>Per extra building <input id="productionExtraDistance" type="number" min="0" max="1000"></label>
        <label>Stockpile distance <input id="productionStockpileDistance" type="number" min="0" max="1000"></label>
        <label>Delivery store distance <input id="productionDeliveryDistance" type="number" min="0" max="1000"></label>
        <label>Between stores <input id="productionStoresDistance" type="number" min="0" max="1000"></label>
        <label>Walking speed multiplier <input id="productionWalkSpeed" type="number" min="0.1" max="10" step="0.1"></label>
        <label>Delivery productivity % <input id="productionProductivity" type="number" min="100" max="1000"></label>
        <label><input id="productionSkirmish" type="checkbox"> Skirmish delivery bonus where enabled by balance</label>
        <div id="productionWorkTicks"></div>
        <label>Workshop itinerary <select id="productionRecipe"></select></label>
        <p class="costHint" id="productionRecipeSummary"></p>
        <p class="costHint">Work ticks exclude the return journey: cycle = work ticks + 2 × distance × walking ticks. Each producer keeps its own progress and fractional delivery bonus. Stone is quarry output; ox transport is not simulated. Route overlay distances are separate layout diagnostics, not measured external-resource distances.</p>
      </details>
      <div class="costHint" id="castleBalanceSource"></div>

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
    els.stepTotal = wurzel.querySelector('#castleCostStepTotal');
    els.totalLabel = wurzel.querySelector('#castleCostTotalLabel');
    els.productionTotals = wurzel.querySelector('#castleProductionTotals');
    els.productionComparison = wurzel.querySelector('#castleProductionComparison');
    els.balanceSource = wurzel.querySelector('#castleBalanceSource');
    els.balanceError = wurzel.querySelector('#castleBalanceError');
    window.electronAPI.readResourceIcons?.().then(icons => { state.icons = icons; zeichne(); }).catch(() => {});
    const numericSettings = { productionDistance: 'distance', productionExtraDistance: 'extraDistance', productionStockpileDistance: 'stockpileDistance', productionDeliveryDistance: 'deliveryDistance', productionStoresDistance: 'storesDistance', productionWalkSpeed: 'walkSpeedMultiplier', productionProductivity: 'productivity' };
    const saveProduction = () => {
      try { window.localStorage.setItem('aiv.production.v2', JSON.stringify(state.production)); } catch { /* session only */ }
      renderRecipe(); zeichne();
    };
    const walkingOverrideLabel = document.createElement('label');
    walkingOverrideLabel.textContent = 'Travel ticks / tile override (blank: reference)';
    const walkingOverride = document.createElement('input');
    walkingOverride.type = 'number'; walkingOverride.min = '.01'; walkingOverride.max = '1000'; walkingOverride.step = '.01';
    walkingOverride.value = state.production.walkTicksOverride ?? '';
    walkingOverride.addEventListener('change', () => {
      state.production.walkTicksOverride = window.castleProduction.settings({ walkTicksOverride: walkingOverride.value }).walkTicksOverride;
      walkingOverride.value = state.production.walkTicksOverride ?? ''; saveProduction();
    });
    walkingOverrideLabel.appendChild(walkingOverride);
    wurzel.querySelector('#productionWorkTicks').before(walkingOverrideLabel);
    const recipeSelect = wurzel.querySelector('#productionRecipe');
    for (const name of Object.keys(window.castleProduction.recipes)) {
      const option=document.createElement('option'); option.value=name; option.textContent=name; recipeSelect.appendChild(option);
    }
    function renderRecipe() {
      const cycle=window.castleProduction.recipeCycle(recipeSelect.value,state.production);
      if (!cycle) return;
      const places={W:'workshop',S:'stockpile',D:'delivery store',C:'dairy farm'};
      wurzel.querySelector('#productionRecipeSummary').textContent = `${cycle.legs.map(l=>places[l.from]).concat(places[cycle.legs.at(-1).to]).join(' ? ')}. ${cycle.note}. ${zahl(cycle.tiles)} tiles; ${zahl(Math.round(cycle.travel))} walking ticks; ${cycle.ticks == null ? 'work duration unknown' : zahl(Math.round(cycle.ticks))+' ticks per reference cycle'}.`;
    }
    recipeSelect.addEventListener('change',renderRecipe); renderRecipe();
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
      label.textContent = `${good} reference ticks / batch`;
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '1000000';
      input.value = state.production.workTicks[good] ?? ''; input.placeholder = 'Unknown';
      input.addEventListener('change', () => {
        state.production = window.castleProduction.settings({ ...state.production, workTicks: { ...state.production.workTicks, [good]: input.value } });
        input.value = state.production.workTicks[good] ?? ''; input.placeholder = 'Unknown'; saveProduction();
      });
      label.appendChild(input); wurzel.querySelector('#productionWorkTicks').appendChild(label);
    }
    wurzel.querySelector('#castleCostUcpBalance').addEventListener('click', loadProjectBalance);
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
      zelle.innerHTML = `<span data-good="${r.key}">${r.label}</span><strong data-res="${r.key}">0</strong>`;
      els.grid.appendChild(zelle);
    }

    els.balance.addEventListener('change', () => {
      state.choice = els.balance.value;
      state.balanceSource = ''; state.balanceError = ''; state.balanceStatus = 'saved';
      fuelleBalanceListe();
      sichere();
      zeichne();
    });
    els.collapse.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      applyCollapsed();
      try { window.localStorage.setItem(COLLAPSE_STORAGE, String(state.collapsed)); } catch { /* session still works */ }
    });
    applyCollapsed();
    els.loadBtn.addEventListener('click', loadBalanceFile);
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
    const eintraege = [['vanilla', 'Vanilla (bundled)'], ...Object.keys(state.balances).map(n => [n,
      n === state.choice && state.balanceStatus === 'ready' ? n : `${n} (saved)`])];
    for (const [wert, text] of eintraege) {
      const opt = document.createElement('option');
      opt.value = wert;
      opt.textContent = text;
      els.balance.appendChild(opt);
    }
    if (!eintraege.some(([w]) => w === state.choice)) state.choice = 'vanilla';
    els.balance.value = state.choice;
    els.balance.title = eintraege.find(([key]) => key === state.choice)?.[1] || state.choice;
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

  async function loadBalanceFile() {
    try {
      const file = await window.electronAPI.openFile('balance');
      if (!file) return;
      const name = `File: ${file.path.split(/[\\/]/).pop()}`;
      state.balances[name] = window.castleBalance.validate(JSON.parse(file.content));
      state.balanceSource = file.path; state.balanceError = ''; state.choice = name; state.balanceStatus = 'ready';
      sichere(); fuelleBalanceListe(); zeichne();
    } catch (error) { state.balanceError = error.message; zeichne(); }
  }
  async function loadProjectBalance() {
    if (!els.wurzel && !baueOberflaeche()) return;
    const button = els.wurzel.querySelector('#castleCostUcpBalance');
    if (button.disabled) return;
    button.disabled = true;
    state.balanceStatus = 'loading'; state.balanceError = '';
    fuelleBalanceListe(); zeichne();
    try {
      const loaded = await window.electronAPI.readInstalledBalance();
      const name = `UCP: ${loaded.name}`;
      state.balances[name] = window.castleBalance.validate(loaded.profile);
      state.choice = name;
      state.balanceSource = `${loaded.exePath ? 'EXE + UCP' : 'Bundled base + UCP'}: ${loaded.filePath}`;
      state.balanceStatus = 'ready'; state.balanceError = ''; sichere(); fuelleBalanceListe();
      try { state.icons = await window.electronAPI.readResourceIcons?.() || state.icons; } catch { /* icons do not invalidate a loaded balance */ }
    } catch (error) {
      state.balanceStatus = 'failed';
      state.balanceError = `UCP balance could not be loaded. Still using ${state.choice === 'vanilla' ? 'bundled vanilla' : 'the saved snapshot of ' + state.choice}. ${error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`;
    } finally { button.disabled = false; fuelleBalanceListe(); zeichne(); }
  }
  function goodSymbol(good) {
    const label = good[0].toUpperCase() + good.slice(1);
    const element = document.createElement(state.icons[good] ? 'img' : 'span');
    if (state.icons[good]) { element.src = state.icons[good]; element.alt = label; element.className = 'costGoodIcon'; }
    else element.textContent = label;
    element.title = label;
    return element;
  }
  function renderCostChips(element, cost, partial = false) {
    element.replaceChildren(); element.classList.add('costChips');
    for (const r of RESSOURCEN.filter(r => cost[r.key])) {
      const chip = document.createElement('span'); chip.className = 'costChip';
      chip.title = `${r.label}: ${zahl(cost[r.key])}`;
      chip.append(goodSymbol(r.key), document.createTextNode(zahl(cost[r.key])));
      element.appendChild(chip);
    }
    if (!element.childNodes.length) element.textContent = '0';
    if (partial) element.appendChild(document.createTextNode(' (partial)'));
  }
  function renderResources(cost, production) {
    els.productionTotals.textContent = production ? '' : 'Open a character for production estimates.';
    const table = document.createElement('table'); table.className = 'costResourceTable';
    table.innerHTML = '<thead><tr><th scope="col">Good</th><th scope="col">Cost</th><th scope="col" title="Estimated gross production, not stockpile inventory">Produced*</th></tr></thead>';
    const body = document.createElement('tbody');
    const goods = [...RESSOURCEN.map(r => r.key), 'meat', 'fruit', 'cheese', 'hop', 'wheat'];
    for (const good of goods) {
      const produced = production?.[good[0].toUpperCase() + good.slice(1)]?.produced;
      if (!(good in cost) && !Object.hasOwn(production || {}, good[0].toUpperCase() + good.slice(1))) continue;
      const row = document.createElement('tr');
      const label = document.createElement('th'); label.scope = 'row'; label.appendChild(goodSymbol(good));
      const spent = document.createElement('td'); spent.textContent = zahl(cost[good]);
      const output = document.createElement('td'); output.textContent = produced == null ? '\u2014' : zahl(produced);
      row.append(label, spent, output); body.appendChild(row);
    }
    table.appendChild(body); els.productionComparison.replaceChildren(table);
    for (const r of RESSOURCEN) {
      els.grid.querySelector(`[data-good="${r.key}"]`)?.replaceChildren(goodSymbol(r.key));
    }
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
    renderResources(ergebnis.cost, production);
    els.balanceError.hidden = !state.balanceError;
    els.balanceError.textContent = state.balanceError;
    els.balanceSource.textContent = state.balanceStatus === 'loading' ? 'Reading selected installation…'
      : state.balanceStatus === 'ready' ? `Loaded: ${state.balanceSource.split(/[\\/]/).pop()}`
      : state.choice === 'vanilla' ? 'Using bundled vanilla prices' : `Using saved snapshot: ${state.choice}`;
    els.balanceSource.title = state.balanceSource + '\n' + 'Use UCP balance to refresh the selected installation. EXE + UCP reads the on-disk game cost table and overlays the configured rebalancer profile; it does not read process memory.';

    const schrittText = ergebnis.totalSteps
      ? `${ergebnis.steps} of ${ergebnis.totalSteps}`
      : 'no steps';
    els.step.textContent = schrittText;
    els.scope.textContent = ergebnis.steps ? `Cumulative total · steps 1–${ergebnis.steps}` : 'Cumulative total · no steps';
    els.totalLabel.textContent = `Total through step ${ergebnis.steps}`;
    renderCostChips(els.stepTotal, ergebnis.cost, ergebnis.unknown.length > 0);
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
      renderCostChips(value, zeile.total);
      div.append(name, value);
      if (zeile.source === 'balance') div.classList.add('costFromBalance');
      div.title = zeile.source === 'balance'
        ? 'Price from the selected balance file'
        : 'Price from the game exe (vanilla)';
      if (zeile.pitchGroup) div.title += `; 1 pitch per ${zeile.pitchGroup} tiles, grouped across steps; assumes a fresh placement counter`;
      els.table.appendChild(div);
    }
    const total = document.createElement('div');
    total.className = 'costTableRow costTableTotal';
    const label = document.createElement('strong');
    label.textContent = `Cumulative total through step ${ergebnis.steps}`;
    const value = document.createElement('span');
    renderCostChips(value, ergebnis.cost, ergebnis.unknown.length > 0);
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
    loadProjectBalance,
    getBalanceNames: () => Object.keys(state.balances),
    getChoice: () => state.choice
  };

  lade();
  window.castleCostPanel = API;
  // Aendert sich die AIC, aendert sich der Arbeiterbedarf - dann neu rechnen.
  window.addEventListener('character-population-changed', () => zeichne());
})();
