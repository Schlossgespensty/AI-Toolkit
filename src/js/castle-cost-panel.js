// Die beiden Anzeigen am Rand des Burgeditors: Kosten und Bevoelkerung bis
// zum gewaehlten Bauschritt. Ihre statischen Einhaengepunkte stehen in der
// Seite, damit der Benutzer beide Anzeigen unabhaengig verschieben kann.
// Gerechnet wird nichts in dieser Datei - das steht in castle-cost-model.js.
'use strict';
(() => {
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);
  const SPEICHER = 'aiv.castleCostBalances.v1';
  const SPEICHER_WAHL = 'aiv.castleCostBalanceChoice.v1';
  const COLLAPSE_STORAGE = 'aiv.castleCostPanelCollapsed.v1';
  const RESSOURCEN = [
    { key: 'wood', get label() { return tr('costs:wood'); } },
    { key: 'stone', get label() { return tr('costs:stone'); } },
    { key: 'iron', get label() { return tr('costs:iron'); } },
    { key: 'pitch', get label() { return tr('costs:pitch'); } },
    { key: 'gold', get label() { return tr('costs:gold'); } }
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
    balanceLoadToken: 0,
    icons: {}
  };
  const els = {};

  const zahl = n => globalThis.toolkitI18n.number(Number(n || 0));

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
        <button type="button" id="castleCostCollapse" class="costCollapse" aria-controls="castleCostBody" aria-expanded="true">${globalThis.toolkitI18n.html("costs:castle_costs_2")}</button>
        <span class="castleOverviewTitleActions">
          <strong id="castleCostStep">-</strong>
          <button type="button" class="castleOverviewInfoButton" data-info-target="castleCostInfo" aria-label="${globalThis.toolkitI18n.html("costs:about_the_castle_cost_overview")}" aria-expanded="false">i</button>
        </span>
      </div>

      <div id="castleCostBody">
      <div class="costBalanceRow">
        <label for="castleCostBalance">${globalThis.toolkitI18n.html("costs:balance")}</label>
        <select id="castleCostBalance"></select>
        <button type="button" id="castleCostLoadBalance" title="${globalThis.toolkitI18n.html("costs:load_a_balance_json_ascension_team_league")}">${globalThis.toolkitI18n.html("costs:load")}</button>
        <button type="button" id="castleCostUcpBalance">${globalThis.toolkitI18n.html("costs:use_ucp_balance")}</button>
      </div>
      <input type="file" id="castleCostBalanceFile" accept="application/json,.json" hidden>

      <div class="costSectionTitle" id="castleCostScope">${globalThis.toolkitI18n.html("costs:cumulative_through_selected_step")}</div>
      <div class="costGrid" id="castleCostGrid" hidden></div>
      <div class="costCastleTotal"><span id="castleCostTotalLabel">${globalThis.toolkitI18n.html("costs:total_through_current_step")}</span><strong id="castleCostStepTotal"></strong></div>
      <div class="costSectionTitle">${globalThis.toolkitI18n.html("costs:resources_through_this_step")}</div>
      <div class="costHint" id="castleProductionTotals"></div>
      <div id="castleProductionComparison"></div>
      <div class="costNote" id="castleBalanceError" hidden></div>
      <details class="costProductionSettings"><summary>${globalThis.toolkitI18n.html("costs:production_assumptions")}</summary>
        <p class="costHint">${globalThis.toolkitI18n.html("costs:reference_estimate_from_stronghold_heaven_original_stronghold_assuming_f")}</p>
        <label>${globalThis.toolkitI18n.html("costs:resource_distance")} <input id="productionDistance" type="number" min="0" max="1000"></label>
        <label>${globalThis.toolkitI18n.html("costs:per_extra_building")} <input id="productionExtraDistance" type="number" min="0" max="1000"></label>
        <label>${globalThis.toolkitI18n.html("costs:stockpile_distance")} <input id="productionStockpileDistance" type="number" min="0" max="1000"></label>
        <label>${globalThis.toolkitI18n.html("costs:delivery_store_distance")} <input id="productionDeliveryDistance" type="number" min="0" max="1000"></label>
        <label>${globalThis.toolkitI18n.html("costs:between_stores")} <input id="productionStoresDistance" type="number" min="0" max="1000"></label>
        <label>${globalThis.toolkitI18n.html("costs:walking_speed_multiplier")} <input id="productionWalkSpeed" type="number" min="0.1" max="10" step="0.1"></label>
        <label>${globalThis.toolkitI18n.html("costs:delivery_productivity")} <input id="productionProductivity" type="number" min="100" max="1000"></label>
        <label><input id="productionSkirmish" type="checkbox"> ${globalThis.toolkitI18n.html("costs:skirmish_delivery_bonus_where_enabled_by_balance")}</label>
        <div id="productionWorkTicks"></div>
        <label>${globalThis.toolkitI18n.html("costs:workshop_itinerary")} <select id="productionRecipe"></select></label>
        <p class="costHint" id="productionRecipeSummary"></p>
        <p class="costHint">${globalThis.toolkitI18n.html("costs:work_ticks_exclude_the_return_journey_cycle_work_ticks_2_distance_walkin")}</p>
      </details>
      <div class="costHint" id="castleBalanceSource"></div>

      <div class="costNote" id="castleCostWarning" hidden></div>

      <div class="costSection">
        <div class="costSectionTitle">${globalThis.toolkitI18n.html("costs:elapsed_game_time")}</div>
        <div class="populationOverviewRow costTimeMain"><span id="castleCostTimeLabel">-</span><strong id="castleCostTimeDays">0</strong></div>
      </div>

      <button type="button" class="costToggle" id="castleCostToggle" aria-expanded="false">${globalThis.toolkitI18n.html("costs:show_cost_per_building")}</button>
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
    walkingOverrideLabel.textContent = tr("costs:travel_ticks_tile_override_blank_reference");
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
      const option=document.createElement('option'); option.value=name; option.textContent=tr('options:'+({Bow:'Bows',Crossbow:'Crossbows',Spear:'Spears',Pike:'Pikes',Sword:'Swords',Mace:'Maces',Armour:'IronArmors',Leather:'LeatherArmors',Ale:'Beer'}[name]||name)); recipeSelect.appendChild(option);
    }
    function renderRecipe() {
      const cycle=window.castleProduction.recipeCycle(recipeSelect.value,state.production);
      if (!cycle) return;
      const places={W:tr('details:workshop'),S:tr('items:52'),D:tr("costs:delivery_store"),C:tr("costs:dairy_farm")};
      wurzel.querySelector('#productionRecipeSummary').textContent = tr("costs:value_value_value_tiles_value_walking_ticks_value", { value1: cycle.legs.map(l=>places[l.from]).concat(places[cycle.legs.at(-1).to]).join(' \u2192 '), note: tr(cycle.note), value3: zahl(cycle.tiles), value4: zahl(Math.round(cycle.travel)), value5: cycle.ticks == null ? tr('details:work_unknown') : tr('details:cycle_ticks',{count:Math.round(cycle.ticks)}) });
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
      label.textContent = tr("costs:value_reference_ticks_batch", { good: good });
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '1000000';
      input.value = state.production.workTicks[good] ?? ''; input.placeholder = tr("costs:unknown");
      input.addEventListener('change', () => {
        state.production = window.castleProduction.settings({ ...state.production, workTicks: { ...state.production.workTicks, [good]: input.value } });
        input.value = state.production.workTicks[good] ?? ''; input.placeholder = tr("costs:unknown"); saveProduction();
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
      cancelBalanceRefresh();
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
      els.toggle.textContent = state.aufgeklappt ? tr("costs:hide_cost_per_building") : tr("costs:show_cost_per_building");
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
      ? tr("costs:bundled_vanilla_prices_were_extracted_from_the_game_exe_at_value_load_a_", { value1: daten._quelle && daten._quelle.kosten ? '0x005C21D0' : tr('details:cost_table') })
      : tr("costs:cost_table_not_loaded");
    if (window.castleEditor && typeof window.castleEditor.refreshOverviewLayout === 'function') {
      window.castleEditor.refreshOverviewLayout();
    }
    return true;
  }

  function fuelleBalanceListe() {
    if (!els.balance) return;
    els.balance.innerHTML = '';
    const balanceLabel = name => name.startsWith('File: ') ? tr('feedback:file_label', {name:name.slice(6)}) : name;
    const eintraege = [['vanilla', tr('details:bundled_vanilla')], ...Object.keys(state.balances).map(n => [n,
      n === state.choice && state.balanceStatus === 'ready' ? balanceLabel(n) : tr('feedback:saved_label', {name:balanceLabel(n)})])];
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
    els.collapse.textContent = state.collapsed ? tr("costs:castle_costs") : tr("costs:castle_costs_2");
  }

  function costSummary(cost) {
    return RESSOURCEN.map(r => `${zahl(cost[r.key])} ${r.label.toLowerCase()}`).join(' · ');
  }

  async function loadBalanceFile() {
    try {
      const file = await window.electronAPI.openFile('balance');
      if (!file) return;
      cancelBalanceRefresh();
      const name = `File: ${file.path.split(/[\\/]/).pop()}`;
      state.balances[name] = window.castleBalance.validate(JSON.parse(file.content));
      state.balanceSource = file.path; state.balanceError = ''; state.choice = name; state.balanceStatus = 'ready';
      sichere(); fuelleBalanceListe(); zeichne();
    } catch (error) { state.balanceError = error.message; zeichne(); }
  }
  function cancelBalanceRefresh() {
    state.balanceLoadToken++;
    const button = els.wurzel?.querySelector('#castleCostUcpBalance');
    if (button) button.disabled = false;
  }
  async function loadProjectBalance() {
    if (!els.wurzel && !baueOberflaeche()) return;
    const button = els.wurzel.querySelector('#castleCostUcpBalance');
    const token = ++state.balanceLoadToken;
    button.disabled = true;
    state.balanceStatus = 'loading'; state.balanceError = '';
    fuelleBalanceListe(); zeichne();
    try {
      const loaded = await window.electronAPI.readInstalledBalance();
      if (token !== state.balanceLoadToken) return;
      const name = `UCP: ${loaded.name}`;
      state.balances[name] = window.castleBalance.validate(loaded.profile);
      state.choice = name;
      state.balanceSource = `${loaded.exePath ? 'EXE + UCP' : tr("costs:bundled_base_ucp")}: ${loaded.filePath}`;
      state.balanceStatus = 'ready'; state.balanceError = ''; sichere(); fuelleBalanceListe();
      try {
        const icons = await window.electronAPI.readResourceIcons?.();
        if (token === state.balanceLoadToken && icons) state.icons = icons;
      } catch { /* icons do not invalidate a loaded balance */ }
    } catch (error) {
      if (token !== state.balanceLoadToken) return;
      state.balanceStatus = 'failed';
      state.balanceError = tr("costs:ucp_balance_could_not_be_loaded_still_using_value_value", { value1: state.choice === 'vanilla' ? tr('details:bundled_vanilla') : tr('details:saved_balance',{name:state.choice}), value2: error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') });
    } finally {
      if (token === state.balanceLoadToken) { button.disabled = false; fuelleBalanceListe(); zeichne(); }
    }
  }
  function goodSymbol(good) {
    const label = tr(good==='fruit'?'details:fruit':good==='gold'?'costs:gold':'options:'+(good[0].toUpperCase()+good.slice(1)));
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
    if (partial) element.appendChild(document.createTextNode(tr("costs:partial")));
  }
  function renderResources(cost, production) {
    els.productionTotals.textContent = production ? '' : tr("costs:open_a_character_for_production_estimates");
    const table = document.createElement('table'); table.className = 'costResourceTable';
    table.innerHTML = `<thead><tr><th scope="col">${globalThis.toolkitI18n.html("costs:good")}</th><th scope="col">${globalThis.toolkitI18n.html("costs:cost")}</th><th scope="col" title="${globalThis.toolkitI18n.html("costs:estimated_gross_production_not_stockpile_inventory")}">${globalThis.toolkitI18n.html("costs:produced")}</th></tr></thead>`;
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

  let analysisHealthKey = null;
  function zeichne() {
    const healthKey = JSON.stringify(Object.entries(aktiveBalance()?.buildings || {})
      .map(([name, stats]) => [name, stats.health]).filter(([, health]) => health !== undefined));
    if (healthKey !== analysisHealthKey) {
      analysisHealthKey = healthKey;
      window.dispatchEvent(new Event('castle-balance-changed'));
    }
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
    els.balanceSource.textContent = state.balanceStatus === 'loading' ? tr("costs:reading_selected_installation")
      : state.balanceStatus === 'ready' ? tr('feedback:loaded_label', {name:state.balanceSource.split(/[\\/]/).pop()})
      : state.choice === 'vanilla' ? tr("costs:using_bundled_vanilla_prices") : tr("costs:using_saved_snapshot_value", { choice: state.choice });
    els.balanceSource.title = state.balanceSource + '\n' + tr('feedback:balance_help');

    const schrittText = ergebnis.totalSteps
      ? `${ergebnis.steps} / ${ergebnis.totalSteps}`
      : tr("costs:no_steps");
    els.step.textContent = schrittText;
    els.scope.textContent = ergebnis.steps ? tr("costs:cumulative_total_steps_1_value", { steps: ergebnis.steps }) : tr("costs:cumulative_total_no_steps");
    els.totalLabel.textContent = tr("costs:total_through_step_value", { steps: ergebnis.steps });
    renderCostChips(els.stepTotal, ergebnis.cost, ergebnis.unknown.length > 0);
    els.collapse.title = tr("costs:through_step_value_value", { steps: ergebnis.steps, value2: costSummary(ergebnis.cost) })
      + (ergebnis.unknown.length ? tr("costs:partial_unknown_prices") : '');
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
        .map(u => `${u.count}× ${window.castlePalette?.itemName(window.castleEditor?.getItemDefinitions?.(), u.type) || tr('feedback:item', {id:u.type})}`)
        .join(', ');
      els.warning.hidden = false;
      els.warning.textContent = tr("costs:price_unknown_not_counted_value_the_build_cost_table_has_no_entry_for_th", { namen: namen });
    } else {
      els.warning.hidden = true;
      els.warning.textContent = '';
    }

    const time = ergebnis.time;
    els.timeLabel.textContent = [[time.years,'year'],[time.months,'month'],[time.remainderDays,'day']].filter(([count,unit])=>count || (unit==='day' && !time.years && !time.months)).map(([count,unit])=>tr('details:'+unit,{count})).join(', ');
    els.timeDays.textContent = tr('details:day',{count:ergebnis.time.days});
    els.timeHint.textContent = tr("costs:value_ticks_one_step_is_one_game_day_and_a_step_that_cannot_be_built_sti", { value1: zahl(ergebnis.time.ticks) });

    const pop = ergebnis.population;
    els.popProvided.textContent = zahl(pop.provided);
    els.popRequired.textContent = zahl(pop.required);
    els.popAic.textContent = pop.aicNeeded == null ? tr("costs:no_character_file") : zahl(pop.aicNeeded);
    els.popFree.textContent = pop.free == null ? '-' : zahl(pop.free);
    els.popFree.classList.toggle('populationNegative', pop.free != null && pop.free < 0);

    if (pop.aic) {
      const teile = [[pop.aic.quarries,'quarry'],[pop.aic.iron,'iron_mine'],[pop.aic.wood,'woodcutter'],[pop.aic.farms,'farm'],[pop.aic.pitch,'pitch_rig'],[pop.aic.oxTethers,'ox_tether']].map(([count,unit])=>tr('details:'+unit,{count}));
      let satz = tr("costs:at_value_population_the_aic_opens_value", { value1: zahl(pop.provided), value2: teile.join(', ') });
      if (pop.farms && pop.farms.hop) {
        satz += ' '+tr('details:hop_farms',{count:pop.farms.hop});
      }
      els.aicDetail.textContent = satz;
    } else {
      els.aicDetail.textContent = tr("costs:open_a_character_file_to_see_how_many_resource_buildings_the_aic_would_a");
    }

    if (state.aufgeklappt) zeichneTabelle(ergebnis);
  }

  function zeichneTabelle(ergebnis) {
    els.table.innerHTML = '';
    if (!ergebnis.rows.length) {
      els.table.textContent = tr("costs:nothing_with_a_known_price_up_to_this_step");
    }
    for (const zeile of ergebnis.rows) {
      const teile = RESSOURCEN.filter(r => zeile.total[r.key]).map(r => `${zahl(zeile.total[r.key])} ${r.label.toLowerCase()}`);
      if (!teile.length) teile.push(tr("costs:no_cost"));
      const div = document.createElement('div');
      div.className = 'costTableRow';
      const name = document.createElement('span');
      name.className = 'costTableName';
      name.textContent = `${zeile.count}× ${tr('items:'+zeile.type,{defaultValue:zeile.name})}`;
      const value = document.createElement('span');
      value.className = 'costTableValue';
      renderCostChips(value, zeile.total);
      div.append(name, value);
      if (zeile.source === 'balance') div.classList.add('costFromBalance');
      div.title = zeile.source === 'balance'
        ? tr("costs:price_from_the_selected_balance_file")
        : tr("costs:price_from_the_game_exe_vanilla");
      if (zeile.pitchGroup) div.title += tr("costs:1_pitch_per_value_tiles_grouped_across_steps_assumes_a_fresh_placement_c", { pitchGroup: zeile.pitchGroup });
      els.table.appendChild(div);
    }
    const total = document.createElement('div');
    total.className = 'costTableRow costTableTotal';
    const label = document.createElement('strong');
    label.textContent = tr("costs:cumulative_total_through_step_value", { steps: ergebnis.steps });
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
    getActiveBalance: aktiveBalance,
    getChoice: () => state.choice
  };

  lade();
  window.castleCostPanel = API;
  // Aendert sich die AIC, aendert sich der Arbeiterbedarf - dann neu rechnen.
  window.addEventListener('character-population-changed', () => zeichne());
  window.toolkitI18n?.onChange(() => { if(els.wurzel) { baueOberflaeche(); zeichne(); } });
})();
