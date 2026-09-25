(() => {
  'use strict';
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);

  const els = {
    choose: document.getElementById('ucpChooseInstallationBtn'),
    create: document.getElementById('ucpCreateAiBtn'),
    refresh: document.getElementById('ucpRefreshBtn'),
    openPlugins: document.getElementById('ucpOpenPluginsBtn'),
    installationPath: document.getElementById('ucpInstallationPath'),
    status: document.getElementById('ucpLibraryStatus'),
    search: document.getElementById('ucpLibrarySearch'),
    filter: document.getElementById('ucpLibraryFilter'),
    count: document.getElementById('ucpAiCount'),
    list: document.getElementById('ucpAiList'),
    empty: document.getElementById('ucpAiEmpty'),
    details: document.getElementById('ucpAiDetails'),
    portrait: document.getElementById('ucpAiPortrait'),
    name: document.getElementById('ucpAiName'),
    ownership: document.getElementById('ucpAiOwnership'),
    activity: document.getElementById('ucpAiActivity'),
    description: document.getElementById('ucpAiDescription'),
    author: document.getElementById('ucpAiAuthor'),
    version: document.getElementById('ucpAiVersion'),
    plugin: document.getElementById('ucpAiPlugin'),
    id: document.getElementById('ucpAiId'),
    openHint: document.getElementById('ucpOpenHint'),
    castle: document.getElementById('ucpCastleSelect'),
    castleSummary: document.getElementById('ucpCastleSummary'),
    open: document.getElementById('ucpOpenAiBtn'),
    openFolder: document.getElementById('ucpOpenAiFolderBtn'),
    cloneCard: document.getElementById('ucpCloneCard'),
    cloneName: document.getElementById('ucpCloneName'),
    cloneId: document.getElementById('ucpCloneId'),
    cloneVersion: document.getElementById('ucpCloneVersion'),
    clone: document.getElementById('ucpCloneBtn'),
    updateCard: document.getElementById('ucpUpdateCard'),
    update: document.getElementById('ucpUpdateBtn'),
    createDialog: document.getElementById('ucpCreateDialog'),
    createForm: document.getElementById('ucpCreateForm'),
    createName: document.getElementById('ucpCreateName'),
    createId: document.getElementById('ucpCreateId'),
    createAuthor: document.getElementById('ucpCreateAuthor'),
    createVersion: document.getElementById('ucpCreateVersion'),
    createCancel: document.getElementById('ucpCreateCancelBtn'),
    createConfirm: document.getElementById('ucpCreateConfirmBtn'),
    mappingDialog: document.getElementById('ucpCastleMappingDialog'),
    mappingForm: document.getElementById('ucpCastleMappingForm'),
    mappingHint: document.getElementById('ucpCastleMappingHint'),
    mappingFields: document.getElementById('ucpCastleMappingFields'),
    mappingCancel: document.getElementById('ucpCastleMappingCancelBtn'),
    mappingSave: document.getElementById('ucpCastleMappingSaveBtn')
  };

  const state = {
    gameRoot: null,
    library: null,
    selectedKey: null,
    loadedProject: null,
    initialized: false,
    busy: false
  };

  const LAST_PROJECT = 'aiv.lastProject.v1';
  function rememberProject() {
    const project = state.loadedProject;
    if (!project || !state.gameRoot) return;
    try {
      window.localStorage.setItem(LAST_PROJECT, JSON.stringify({
        gameRoot: state.gameRoot, aiRoot: project.aiRoot, aiKey: project.aiKey,
        castleFile: project.castleFile, workspace: window.appWorkspace?.getActive() || 'castle'
      }));
    } catch (error) { console.warn('Could not remember the AI project:', error); }
  }

  function previousProject() {
    try {
      const value = JSON.parse(window.localStorage.getItem(LAST_PROJECT));
      if (!value || typeof value.gameRoot !== 'string' || typeof value.aiRoot !== 'string') return null;
      if (value.castleFile != null && (typeof value.castleFile !== 'string' || /[\\/]/.test(value.castleFile))) return null;
      return value;
    } catch (_) { return null; }
  }

  function projectInLibrary(saved) {
    const normalized = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!saved || normalized(saved.gameRoot) !== normalized(state.gameRoot)) return null;
    const candidates = state.library?.ais.filter(ai => normalized(ai.rootPath) === normalized(saved.aiRoot)) || [];
    // Vanilla lords share one aiv folder, so the path alone is not an identity.
    if (saved.aiKey) return candidates.find(ai => ai.key === saved.aiKey) || null;
    if (candidates.length === 1) return candidates[0];
    // Recover older sessions by their castle name; never pick an arbitrary lord.
    const matching = candidates.filter(ai => ai.castles?.some(castle =>
      normalized(castle.fileName) === normalized(saved.castleFile)));
    return matching.length === 1 ? matching[0] : null;
  }

  window.addEventListener('focus', rememberProject);

  const placeholderPortrait = `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect width="128" height="128" fill="#242830"/>
      <path d="M64 18 99 32v27c0 24-14 40-35 51C43 99 29 83 29 59V32z" fill="#3a7bd5" opacity=".55"/>
      <text x="64" y="73" text-anchor="middle" fill="#eef1f6" font-family="monospace" font-size="31">AI</text>
    </svg>`)}`;

  function setStatus(message, type = '') {
    window.toolkitI18n.bindText(els.status, message);
    els.status.classList.toggle('error', type === 'error');
    els.status.classList.toggle('success', type === 'success');
    if (window.appWorkspace?.getActive() === 'ucp') window.appWorkspace.setStatus(message);
  }

  function setBusy(value) {
    state.busy = value;
    for (const button of [els.choose, els.create, els.refresh, els.openPlugins, els.open, els.openFolder, els.clone, els.update, els.createConfirm, els.mappingSave]) {
      if (button) button.disabled = value || button.dataset.available === 'false';
    }
    els.castle.disabled = value || els.castle.dataset.available !== 'true';
  }

  function germanSlug(value) {
    return String(value || '')
      .replace(/ä/gi, match => match === 'Ä' ? 'Ae' : 'ae')
      .replace(/ö/gi, match => match === 'Ö' ? 'Oe' : 'oe')
      .replace(/ü/gi, match => match === 'Ü' ? 'Ue' : 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-ai';
  }

  function selectedAi() {
    return state.library?.ais.find(ai => ai.key === state.selectedKey) || null;
  }

  function filteredAis() {
    let ais = state.library?.ais || [];
    if (els.filter.value === 'active') ais = ais.filter(ai => ai.active);
    if (els.filter.value === 'owned') ais = ais.filter(ai => ai.owned);
    const terms = String(els.search.value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!terms.length) return ais;
    return ais.filter(ai => {
      const searchable = [
        ai.name,
        ai.id,
        ai.folderName,
        ai.author,
        ai.description,
        ai.version,
        ai.plugin?.name,
        ai.plugin?.displayName,
        ai.plugin?.version
      ].join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }

  function canLoadCastle(castle) {
    return Boolean(
      castle?.valid &&
      (castle.exists || castle.jsonExists) &&
      castle.requiresFileAccess !== true
    );
  }

  function castleOne(ai) {
    return ai?.castles.find(castle => castle.slot === 1 && canLoadCastle(castle)) || null;
  }

  function loadedAi() {
    if (!state.loadedProject) return null;
    return state.library?.ais.find(ai => ai.key === state.loadedProject.aiKey) || state.loadedProject.ai || null;
  }

  async function chooseDocumentDisposition(kind, operation) {
    const ai = loadedAi();
    if (!state.loadedProject || !ai) return 'separate';
    if (state.busy) return 'cancel';
    return window.electronAPI.chooseAiDocumentAction({
      kind,
      operation,
      aiName: ai.name
    });
  }

  async function addCharacterDocument(content) {
    const ai = loadedAi();
    if (!state.loadedProject || !ai || state.busy) return null;
    setBusy(true);
    setStatus(() => tr('feedback:replacing_character', {name:ai.name}));
    try {
      const result = await window.electronAPI.addAiDocument({
        kind: 'character',
        gameRoot: state.gameRoot,
        aiRoot: state.loadedProject.aiRoot,
        content
      });
      if (!result) return null;
      state.loadedProject.characterPath = result.path;
      renderDetails();
      setStatus(() => tr("library:value_s_character_was_replaced", { name: ai.name }), 'success');
      return result;
    } catch (error) {
      setStatus(() => tr("library:could_not_add_character_to_value_value", { name: ai.name, message: error.message }), 'error');
      return null;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  async function addCastleDocument({
    document,
    suggestedFileName = null,
    sourcePath = null,
    sourceBytes = null,
    unchanged = true
  } = {}) {
    const ai = loadedAi();
    if (!state.loadedProject || !ai || state.busy) return null;
    const projectState = state.loadedProject;
    setBusy(true);
    setStatus(() => tr("library:adding_castle_to_value", { name: ai.name }));
    try {
      const result = await window.electronAPI.addAiDocument({
        kind: 'castle',
        gameRoot: state.gameRoot,
        aiRoot: projectState.aiRoot,
        document,
        suggestedFileName,
        sourcePath,
        sourceBytes,
        unchanged
      });
      if (!result) {
        setStatus(() => tr("library:adding_the_castle_was_cancelled"));
        return null;
      }
      projectState.castleFile = result.fileName;
      projectState.castlePath = result.path;
      rememberProject();
      await scan({ selectKey: projectState.aiKey, quiet: true });
      projectState.ai = loadedAi();
      populateCastleSwitcher(projectState.ai, result.fileName);
      renderDetails();
      setStatus(() => tr("library:value_was_added_to_value", { fileName: result.fileName, name: ai.name }), 'success');
      return result;
    } catch (error) {
      setStatus(() => tr("library:could_not_add_castle_to_value_value", { name: ai.name, message: error.message }), 'error');
      return null;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  function resetCastleSwitcher() {
    els.castle.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = tr("interface:no_ai_project");
    els.castle.appendChild(option);
    els.castle.dataset.available = 'false';
    els.castle.disabled = true;
  }

  function populateCastleSwitcher(ai, selectedFile = null) {
    els.castle.innerHTML = '';
    const castles = ai?.castles || [];
    if (!castles.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = tr("library:no_castles_available");
      els.castle.appendChild(option);
      els.castle.dataset.available = 'false';
      els.castle.disabled = true;
      return;
    }
    for (const castle of castles) {
      const option = document.createElement('option');
      option.value = castle.fileName;
      option.textContent = `${castle.slot == null ? tr("library:unmapped") : tr('feedback:castle_slot', {slot:castle.slot})} — ${castle.fileName}${canLoadCastle(castle) ? '' : tr("library:missing")}`;
      option.disabled = !canLoadCastle(castle);
      els.castle.appendChild(option);
    }
    const selected = castles.find(castle => castle.fileName === selectedFile && canLoadCastle(castle));
    if (selected) els.castle.value = selected.fileName;
    else els.castle.value = '';
    const available = castles.some(canLoadCastle);
    els.castle.dataset.available = available ? 'true' : 'false';
    els.castle.disabled = state.busy || !available;
  }

  function castleFileChoices(ai) {
    const files = new Map();
    for (const castle of ai?.castles || []) {
      if (!castle.valid || !castle.exists) continue;
      if (!files.has(castle.fileName.toLowerCase())) files.set(castle.fileName.toLowerCase(), castle.fileName);
    }
    return [...files.values()].sort((one, two) => one.localeCompare(two, undefined, { numeric: true }));
  }

  function showCastleMapping() {
    const ai = loadedAi();
    if (!state.loadedProject || !ai) {
      window.castleEditor?.setStatus?.(() => tr("library:open_an_ai_project_before_editing_its_castle_mapping"));
      return false;
    }
    if (state.busy) return false;
    const choices = castleFileChoices(ai);
    els.mappingFields.innerHTML = '';
    window.toolkitI18n.bindText(els.mappingHint, () => tr("library:choose_the_aiv_used_in_each_of_value_s_eight_castle_slots_the_same_file_", { name: ai.name }));
    for (let slot = 1; slot <= 8; slot += 1) {
      const label = document.createElement('label');
      label.textContent = tr('feedback:castle_slot', {slot});
      const select = document.createElement('select');
      select.dataset.slot = String(slot);
      const unused = document.createElement('option');
      unused.value = '';
      unused.textContent = tr("library:unused");
      select.appendChild(unused);
      for (const fileName of choices) {
        const option = document.createElement('option');
        option.value = fileName;
        option.textContent = fileName;
        select.appendChild(option);
      }
      select.value = ai.castles.find(castle => castle.slot === slot)?.fileName || '';
      label.appendChild(select);
      els.mappingFields.appendChild(label);
    }
    els.mappingDialog.showModal();
    return true;
  }

  async function saveCastleMapping(event) {
    event?.preventDefault();
    const ai = loadedAi();
    if (!state.loadedProject || !ai || state.busy) return false;
    const slots = [...els.mappingFields.querySelectorAll('select')].map(select => select.value);
    els.mappingDialog.close();
    setBusy(true);
    setStatus(() => tr("library:saving_value_s_castle_mapping", { name: ai.name }));
    try {
      const updated = await window.electronAPI.updateAiCastleMapping({
        gameRoot: state.gameRoot,
        aiRoot: ai.rootPath,
        slots
      });
      await scan({ selectKey: updated?.key || ai.key, quiet: true });
      populateCastleSwitcher(loadedAi(), state.loadedProject.castleFile);
      setStatus(() => tr("library:value_s_castle_mapping_saved", { name: ai.name }), 'success');
      return true;
    } catch (error) {
      setStatus(() => tr("library:could_not_save_castle_mapping_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  function setButtonAvailable(button, available) {
    button.dataset.available = available ? 'true' : 'false';
    button.disabled = state.busy || !available;
  }

  function renderList() {
    const ais = filteredAis();
    els.list.innerHTML = '';
    els.count.textContent = String(ais.length);
    els.count.title = state.library ? tr("library:value_of_value_ais_shown", { length: ais.length, length2: state.library.ais.length }) : '';
    if (!ais.length) {
      const empty = document.createElement('div');
      empty.className = 'ucpLibraryEmpty';
      empty.textContent = state.library
        ? (els.search.value.trim() ? tr("library:no_ais_match_this_search") : tr("library:no_ais_match_this_view"))
        : tr("interface:no_installation_selected");
      els.list.appendChild(empty);
      window.toolkitI18n.applyTextDirection(els.list);
      return;
    }
    for (const ai of ais) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ucpAiListItem';
      button.classList.toggle('selected', ai.key === state.selectedKey);

      const portrait = document.createElement('img');
      portrait.className = 'ucpAiListPortrait';
      portrait.src = ai.portraitDataUrl || placeholderPortrait;
      portrait.alt = '';

      const text = document.createElement('span');
      text.className = 'ucpAiListText';
      const name = document.createElement('span');
      name.className = 'ucpAiListName';
      name.textContent = ai.name;
      const source = document.createElement('span');
      source.className = 'ucpAiListSource';
      source.textContent = `${ai.owned ? tr("library:my_ais") : ai.plugin.displayName}${ai.active ? tr("library:active") : ''}`;
      text.append(name, source);
      button.append(portrait, text);
      button.addEventListener('click', () => selectAi(ai.key));
      els.list.appendChild(button);
    }
    window.toolkitI18n.applyTextDirection(els.list);
  }

  function renderCastleSummary() {
    const ai = selectedAi();
    if (!ai?.castles.length) {
      els.castleSummary.textContent = tr("library:no_mapped_binary_castles_were_found_the_character_can_still_be_opened");
      return;
    }
    const loadable = ai.castles.filter(canLoadCastle);
    const first = castleOne(ai);
    if (!first) {
      if (ai.castles.some(castle => castle.requiresFileAccess)) {
        els.castleSummary.textContent = tr("library:value_castle_mappingvalue_found_enable_castles_audio_all_ais_above_to_re", { quantityvalue2: tr("quantity:castle_mapping", { count: ai.castles.length }) });
        return;
      }
      els.castleSummary.textContent = tr("library:value_castlevalue_available_but_castle_1_was_not_found_the_character_wil", { quantityvalue2: tr("quantity:castle", { count: loadable.length }) });
      return;
    }
    const source = first.exists ? tr("library:binary_aiv_ready") : tr("library:json_fallback_available");
    els.castleSummary.textContent = tr("library:value_castlevalue_available_castle_1_opens_first_value_value", { fileName: first.fileName, source: source, quantityvalue2: tr("quantity:castle", { count: loadable.length }) });
  }

  function loadedSelectionMatches() {
    const ai = selectedAi();
    return Boolean(ai?.owned && state.loadedProject && state.loadedProject.aiKey === ai.key);
  }

  function renderDetails({ preserveDraft = false } = {}) {
    const ai = selectedAi();
    els.empty.hidden = Boolean(ai);
    els.details.hidden = !ai;
    if (!ai) return;

    els.portrait.src = ai.portraitDataUrl || placeholderPortrait;
    els.portrait.alt = ai.name;
    els.name.textContent = ai.name;
    els.description.textContent = ai.description || tr("library:no_description_provided");
    els.author.textContent = ai.author || '—';
    els.version.textContent = ai.version || '—';
    els.plugin.textContent = `${ai.plugin.displayName}${ai.plugin.version ? ` ${ai.plugin.version}` : ''}`;
    els.id.textContent = ai.id;

    els.ownership.textContent = ai.owned ? tr("library:my_ai") : tr("interface:installed");
    els.ownership.classList.toggle('owned', ai.owned);
    els.activity.textContent = ai.active ? tr("library:active_plugin") : tr("library:inactive_plugin");
    els.activity.classList.toggle('active', ai.active);

    els.open.textContent = tr("interface:open_in_editors");
    els.openHint.textContent = ai.owned
      ? tr("library:loads_the_managed_character_castle_1_lines_and_portraits_switch_castles_")
      : ai.castles.some(castle => castle.requiresFileAccess)
        ? tr("library:character_data_is_ready_enable_castles_audio_all_ais_above_before_openin")
        : tr("library:loads_this_ai_directly_from_its_source_plugin_changes_can_be_saved_back_");
    setButtonAvailable(els.open, ai.characterExists);
    setButtonAvailable(els.openFolder, true);

    els.cloneCard.hidden = ai.owned || Boolean(ai.vanilla);
    els.updateCard.hidden = !ai.owned;
    if (!ai.owned) {
      if (!preserveDraft) {
        els.cloneName.value = `${ai.name} (Custom)`;
        els.cloneId.value = `${germanSlug(ai.folderName || ai.name)}-custom`;
        els.cloneVersion.value = ai.version || '1.0.0';
      }
      setButtonAvailable(els.clone, true);
    } else {
      setButtonAvailable(els.update, loadedSelectionMatches());
      els.update.title = loadedSelectionMatches()
        ? tr("library:safely_update_the_managed_ucp_plugin_from_the_loaded_editors")
        : tr("library:open_this_ai_in_the_editors_first");
    }
    renderCastleSummary();
    window.toolkitI18n.applyTextDirection(els.details);
  }

  function selectAi(key) {
    state.selectedKey = key;
    renderList();
    renderDetails();
  }

  async function scan({ selectKey = state.selectedKey, quiet = false } = {}) {
    if (!state.gameRoot) return;
    if (!quiet) setStatus(() => tr("library:scanning_installed_ucp_plugins"));
    setBusy(true);
    try {
      state.library = await window.electronAPI.scanUcpAiLibrary(state.gameRoot);
      state.gameRoot = state.library.gameRoot;
      window.toolkitI18n.bindText(els.installationPath, state.library.gameRoot, 'ltr');
      els.installationPath.title = state.library.gameRoot;
      setButtonAvailable(els.refresh, true);
      setButtonAvailable(els.openPlugins, true);
      setButtonAvailable(els.create, true);
      updateAccessControl();
      const selected = state.library.ais.find(ai => ai.key === selectKey) || state.library.ais[0] || null;
      state.selectedKey = selected?.key || null;
      renderList();
      renderDetails();
      setStatus(() => {
        const diagnosticNote = state.library.diagnostics.length ? tr("library:value_package_issue_s_were_skipped", { length: state.library.diagnostics.length }) : '';
        const accessNote = state.library.fullFileAccess === false
          ? tr("library:enable_full_ai_access_to_load_castles_audio_video_and_inactive_plugins")
          : state.library.fullFileAccess === true ? tr("library:full_ai_file_access_is_enabled") : '';
        return tr("library:found_value_ai_packagevalue_in_value_pluginvalue_valuevalue", { diagnosticNote, accessNote, quantityvalue2: tr("quantity:ai_package", { count: state.library.ais.length }), quantityvalue4: tr("quantity:plugin", { count: state.library.plugins.length }) });
      });
    } catch (error) {
      state.library = null;
      state.selectedKey = null;
      renderList();
      renderDetails();
      setStatus(() => tr("library:could_not_scan_ucp_value", { message: error.message }), 'error');
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  async function chooseInstallation() {
    if (state.busy) return;
    try {
      const selected = await window.electronAPI.chooseUcpInstallation();
      if (!selected) return;
      state.gameRoot = selected;
      window.isoView?.setGameMap(null);
      await window.castleEditor?.reloadGameAssets?.();
      state.selectedKey = null;
      state.loadedProject = null;
    window.electronAPI.setDialogProject?.(null);
      resetCastleSwitcher();
      await scan({ selectKey: null });
    } catch (error) {
      setStatus(() => tr("library:could_not_use_that_folder_value", { message: error.message }), 'error');
    }
  }

  async function openSelected(options = {}) {
    const ai = selectedAi();
    if (!ai || !state.gameRoot || state.busy) return false;
    const requestedCastle = typeof options.castleFile === 'string' ? options.castleFile : null;
    const castle = requestedCastle ? ai.castles.find(candidate => candidate.fileName === requestedCastle) : castleOne(ai);
    if (requestedCastle && !castle) {
      setStatus(() => tr("library:the_last_castle_value_is_no_longer_in_this_project_choose_a_castle_to_op", { requestedCastle: requestedCastle }), 'error');
      return false;
    }
    if (castle?.requiresFileAccess) {
      setStatus(() => tr("library:castle_1_is_mapped_but_ucp_cannot_read_its_binary_file_yet_click_enable_"), 'error');
      els.choose.focus();
      return false;
    }
    if (!await window.unsavedChanges?.confirmAll(tr("library:opening_this_ai_project"))) return false;
    setBusy(true);
    setStatus(() => tr('feedback:opening', {name:ai.name}));
    try {
      await window.characterEditor.ready;
      if (options.shouldAbort?.()) return false;
      const project = await window.electronAPI.loadUcpAiProject({
        gameRoot: state.gameRoot,
        aiRoot: ai.rootPath,
        castleFile: castle?.fileName || null
      });
      if (options.shouldAbort?.()) return false;
      // Vanilla lords have editable castles but no character or dialogue files.
      if (project.character) {
        window.characterEditor.loadFromContent(project.character.content, project.character.path, {
          projectManaged: true
        });
      }
      if (project.castle) {
        window.castleEditor.loadDocument(project.castle.document, project.castle.path, {
          projectManaged: true,
          source: project.castle.source,
          sourceBytes: project.castle.sourceBytes
        });
      } else {
        window.castleEditor.loadDocument(
          { pauseDelayAmount: 100, frames: [], miscItems: [] },
          null,
          { projectManaged: true }
        );
      }
      if (!project.vanilla) window.aiContentEditor?.loadProject(project, ai, state.gameRoot);
      state.loadedProject = {
        aiKey: ai.key,
        ai,
        aiId: ai.id,
        aiRoot: ai.rootPath,
        owned: ai.owned,
        characterPath: project.character?.path || null,
        castleFile: project.castle?.fileName || null,
        castlePath: project.castle?.path || null
      };
      await window.electronAPI.setDialogProject?.(ai.rootPath);
      window.castleCostPanel?.loadProjectBalance?.();
      populateCastleSwitcher(ai, project.castle?.fileName || null);
      renderDetails();
      if (options.activateWorkspace !== false) window.appWorkspace?.setActive('castle');
      rememberProject();
      setStatus(() => tr("library:value_opened_for_editingvalue", { name: ai.name, value2: project.castle ? tr('feedback:with_castle', {name:project.castle.fileName}) : '' }), 'success');
      return true;
    } catch (error) {
      setStatus(() => tr("library:could_not_open_ai_project_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  async function switchCastle(fileName = els.castle.value) {
    const projectState = state.loadedProject;
    const ai = loadedAi();
    const castle = ai?.castles.find(candidate => candidate.fileName === fileName) || null;
    if (!projectState || !ai || !canLoadCastle(castle) || state.busy) {
      if (projectState) els.castle.value = projectState.castleFile || '';
      return false;
    }
    if (castle.fileName === projectState.castleFile) return true;
    if (!await window.unsavedChanges?.confirmEditor('castle', tr("library:switching_castles"))) {
      els.castle.value = projectState.castleFile || '';
      return false;
    }

    setBusy(true);
    setStatus(() => tr('feedback:opening', {name:ai.name+' — '+(castle.slot == null ? castle.fileName : tr('feedback:castle_slot', {slot:castle.slot}))}));
    try {
      const project = await window.electronAPI.loadUcpAiProject({
        gameRoot: state.gameRoot,
        aiRoot: ai.rootPath,
        castleFile: castle.fileName
      });
      if (!project.castle) throw new Error(tr("library:castle_value_could_not_be_loaded", { fileName: castle.fileName }));
      window.castleEditor.loadDocument(project.castle.document, project.castle.path, {
        projectManaged: true,
        source: project.castle.source,
        sourceBytes: project.castle.sourceBytes
      });
      projectState.castleFile = project.castle.fileName;
      projectState.castlePath = project.castle.path;
      rememberProject();
      populateCastleSwitcher(ai, project.castle.fileName);
      renderDetails();
      setStatus(() => tr('feedback:opened', {name:ai.name+' — '+(castle.slot == null ? castle.fileName : tr('feedback:castle_slot', {slot:castle.slot}))}), 'success');
      return true;
    } catch (error) {
      populateCastleSwitcher(ai, projectState.castleFile);
      setStatus(() => tr("library:could_not_switch_castle_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  function detachCastleProject() {
    state.loadedProject = null;
    window.electronAPI.setDialogProject?.(null);
    resetCastleSwitcher();
    renderDetails();
  }

  async function cloneSelected() {
    const ai = selectedAi();
    if (!ai || ai.owned || state.busy) return false;
    let clone = null;
    setBusy(true);
    setStatus(() => tr("library:cloning_value_into_my_ais", { name: ai.name }));
    try {
      clone = await window.electronAPI.cloneUcpAi({
        gameRoot: state.gameRoot,
        sourceAiRoot: ai.rootPath,
        aiId: els.cloneId.value,
        name: els.cloneName.value,
        version: els.cloneVersion.value
      });
      if (!clone) throw new Error(tr("library:the_cloned_ai_could_not_be_found_after_installation"));
      await scan({ selectKey: clone.key, quiet: true });
      setStatus(() => tr("library:value_was_installed_in_my_ais_activate_the_plugin_in_the_ucp_gui_when_re", { name: clone.name }), 'success');
    } catch (error) {
      setStatus(() => tr("library:could_not_clone_ai_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
    return openSelected();
  }

  function showCreateDialog() {
    if (!state.gameRoot || state.busy) return;
    els.createForm.reset();
    els.createVersion.value = '1.0.0';
    els.createId.dataset.manuallyEdited = 'false';
    els.createDialog.showModal();
    els.createName.focus();
  }

  async function createNewAi(event) {
    event?.preventDefault();
    if (!state.gameRoot || state.busy) return false;
    const name = els.createName.value.trim();
    const aiId = els.createId.value.trim();
    if (!name || !aiId) return false;

    els.createDialog.close();
    setBusy(true);
    setStatus(() => tr("library:creating_value_in_my_ais", { name: name }));
    let created = null;
    try {
      created = await window.electronAPI.createUcpAi({
        gameRoot: state.gameRoot,
        name,
        aiId,
        author: els.createAuthor.value.trim(),
        version: els.createVersion.value.trim() || '1.0.0'
      });
      if (!created) throw new Error(tr("library:the_new_ai_could_not_be_found_after_creation"));
      await scan({ selectKey: created.key, quiet: true });
      setStatus(() => tr("library:value_was_created_in_my_ais", { name: created.name }), 'success');
    } catch (error) {
      setStatus(() => tr("library:could_not_create_ai_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
    return openSelected();
  }

  async function refreshCurrent() {
    if (!state.gameRoot || state.busy) return;
    const currentKey = state.selectedKey;
    await scan({ selectKey: currentKey, quiet: true });
  }

  function samePath(one, two) {
    return String(one || '').replaceAll('\\', '/').toLowerCase() === String(two || '').replaceAll('\\', '/').toLowerCase();
  }

  async function updateSelected() {
    const ai = selectedAi();
    if (!ai?.owned || !loadedSelectionMatches() || state.busy) {
      setStatus(() => tr("library:open_this_my_ai_project_before_updating_it"), 'error');
      return false;
    }
    if (!samePath(window.characterEditor?.getPath?.(), state.loadedProject.characterPath)) {
      setStatus(() => tr("library:the_character_editor_is_showing_another_file_open_this_ai_project_again_"), 'error');
      return false;
    }
    if (state.loadedProject.castlePath && !samePath(window.castleEditor?.getPath?.(), state.loadedProject.castlePath)) {
      setStatus(() => tr("library:the_castle_editor_is_showing_another_file_open_the_ai_project_again_firs"), 'error');
      return false;
    }

    setBusy(true);
    setStatus(() => tr("library:updating_value_through_a_staging_folder", { name: ai.name }));
    try {
      const updated = await window.electronAPI.updateUcpAi({
        gameRoot: state.gameRoot,
        aiId: ai.id,
        characterContent: window.characterEditor.getContent(),
        castleFile: state.loadedProject.castleFile,
        castleDocument: state.loadedProject.castleFile ? window.castleEditor.getDocument() : null,
        castleUnchanged: !window.castleEditor.isDirty(),
        castleSourceBytes: state.loadedProject.castleFile ? window.castleEditor.getSourceBytes() : null
      });
      window.characterEditor.markSaved?.();
      if (state.loadedProject.castleFile) window.castleEditor.markSaved?.(updated?.savedCastleSourceBytes);
      await scan({ selectKey: updated?.key || ai.key, quiet: true });
      setStatus(() => tr("library:value_is_installed_and_up_to_date_in_my_ais", { name: ai.name }), 'success');
      return true;
    } catch (error) {
      setStatus(() => tr("library:could_not_update_my_ai_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  async function openPath(targetPath = null) {
    if (!state.gameRoot) return;
    try {
      await window.electronAPI.openUcpPath({ gameRoot: state.gameRoot, targetPath });
    } catch (error) {
      setStatus(() => tr("library:could_not_open_folder_value", { message: error.message }), 'error');
    }
  }

  els.choose.addEventListener('click', chooseInstallation);
  els.create.addEventListener('click', showCreateDialog);
  els.refresh.addEventListener('click', () => scan());
  els.openPlugins.addEventListener('click', () => openPath());
  function applyListFilters() {
    const visible = filteredAis();
    if (!visible.some(ai => ai.key === state.selectedKey)) state.selectedKey = visible[0]?.key || null;
    renderList();
    renderDetails();
  }

  els.search.addEventListener('input', applyListFilters);
  els.filter.addEventListener('change', applyListFilters);
  els.castle.addEventListener('change', () => switchCastle(els.castle.value));
  els.mappingCancel.addEventListener('click', () => els.mappingDialog.close());
  els.mappingForm.addEventListener('submit', saveCastleMapping);
  els.open.addEventListener('click', openSelected);
  els.openFolder.addEventListener('click', () => openPath(selectedAi()?.rootPath));
  els.clone.addEventListener('click', cloneSelected);
  els.update.addEventListener('click', updateSelected);
  els.createName.addEventListener('input', () => {
    if (els.createId.dataset.manuallyEdited !== 'true') els.createId.value = germanSlug(els.createName.value);
  });
  els.createId.addEventListener('input', () => {
    els.createId.dataset.manuallyEdited = els.createId.value ? 'true' : 'false';
  });
  els.createCancel.addEventListener('click', () => els.createDialog.close());
  els.createForm.addEventListener('submit', createNewAi);

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    const editors = [window.castleEditor, window.characterEditor, window.aiContentEditor].filter(Boolean);
    const initialPaths = editors.map(editor => editor.getPath?.());
    const initialRevision = window.castleEditor?.getDocumentRevision?.();
    const initialWorkspace = window.appWorkspace?.getActive();
    // Navigation and focusing the window are not document changes. Protect work
    // opened/edited during the asynchronous scan and project read instead.
    const shouldAbort = () => Boolean(state.loadedProject)
      || window.castleEditor?.getDocumentRevision?.() !== initialRevision
      || editors.some((editor, i) => editor.isDirty?.() || editor.getPath?.() !== initialPaths[i]);
    try {
      state.gameRoot = await window.electronAPI.getUcpInstallation();
      if (state.gameRoot) await scan();
      // Only the application's startup window restores a project. Explicit
      // Add Window / Load In New Window must never have its document replaced.
      if (!shouldAbort() && new URLSearchParams(window.location.search).get('restoreProject') === '1') {
        const saved = previousProject();
        const ai = projectInLibrary(saved);
        if (ai) {
          state.selectedKey = ai.key;
          renderList();
          renderDetails();
          if (await openSelected({ castleFile: saved.castleFile, shouldAbort, activateWorkspace: false })) {
            if (window.appWorkspace?.getActive() === initialWorkspace) {
              window.appWorkspace?.setActive(['castle', 'character', 'content', 'ucp'].includes(saved.workspace) ? saved.workspace : 'castle');
            }
            rememberProject();
          }
        } else if (saved) {
          setStatus(() => tr("library:the_last_ai_project_is_unavailable_in_this_installation_choose_a_project"));
        }
      }
    } catch (error) {
      setStatus(() => tr("library:could_not_restore_the_ucp_installation_value", { message: error.message }), 'error');
    }
  }

  function updateAccessControl() {
    if (typeof state.library?.fullFileAccess !== 'boolean') return;
    window.toolkitI18n.bindText(els.choose, state.library.fullFileAccess
      ? tr("library:full_ai_access_enabled")
      : tr("library:enable_castles_audio_all_ais"));
    els.choose.classList.toggle('primaryAction', !state.library.fullFileAccess);
    els.choose.title = state.library.fullFileAccess
      ? tr("library:folder_access_is_active_for_this_editor_sessionvalue", { value1: state.library.fileAccessLabel ? ` (${state.library.fileAccessLabel})` : '' })
      : tr("library:select_the_stronghold_crusader_ucp_plugins_folder_ucp_requires_this_perm");
  }

  window.toolkitI18n?.onChange(() => {
    updateAccessControl();
    renderList();
    renderDetails({ preserveDraft: true });
    renderCastleSummary();
  });
  window.ucpLibrary = {
    chooseInstallation,
    refresh: scan,
    refreshCurrent,
    openSelected,
    rememberProject,
    createNewAi,
    switchCastle,
    showCastleMapping,
    detachCastleProject,
    chooseDocumentDisposition,
    addCharacterDocument,
    addCastleDocument,
    updateSelected,
    onWorkspaceShown: initialize,
    getState: () => ({ ...state })
  };

  window.electronAPI.onTriggerEditCastleMapping(() => {
    if (window.appWorkspace?.getActive() === 'castle') showCastleMapping();
  });

  initialize();
})();
