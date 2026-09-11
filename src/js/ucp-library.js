(() => {
  'use strict';

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
        gameRoot: state.gameRoot, aiRoot: project.aiRoot,
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
    return state.library?.ais.find(ai => normalized(ai.rootPath) === normalized(saved.aiRoot)) || null;
  }

  window.addEventListener('focus', rememberProject);

  const placeholderPortrait = `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect width="128" height="128" fill="#242830"/>
      <path d="M64 18 99 32v27c0 24-14 40-35 51C43 99 29 83 29 59V32z" fill="#3a7bd5" opacity=".55"/>
      <text x="64" y="73" text-anchor="middle" fill="#eef1f6" font-family="monospace" font-size="31">AI</text>
    </svg>`)}`;

  function setStatus(message, type = '') {
    els.status.textContent = message;
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
    setStatus(`Replacing ${ai.name}'s Character…`);
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
      setStatus(`${ai.name}'s Character was replaced.`, 'success');
      return result;
    } catch (error) {
      setStatus(`Could not add Character to ${ai.name}: ${error.message}`, 'error');
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
    setStatus(`Adding castle to ${ai.name}…`);
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
        setStatus('Adding the castle was cancelled.');
        return null;
      }
      projectState.castleFile = result.fileName;
      projectState.castlePath = result.path;
      rememberProject();
      await scan({ selectKey: projectState.aiKey, quiet: true });
      projectState.ai = loadedAi();
      populateCastleSwitcher(projectState.ai, result.fileName);
      renderDetails();
      setStatus(`${result.fileName} was added to ${ai.name}.`, 'success');
      return result;
    } catch (error) {
      setStatus(`Could not add castle to ${ai.name}: ${error.message}`, 'error');
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
    option.textContent = 'No AI project';
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
      option.textContent = 'No castles available';
      els.castle.appendChild(option);
      els.castle.dataset.available = 'false';
      els.castle.disabled = true;
      return;
    }
    for (const castle of castles) {
      const option = document.createElement('option');
      option.value = castle.fileName;
      option.textContent = `${castle.slot == null ? 'Unmapped' : `Castle ${castle.slot}`} — ${castle.fileName}${canLoadCastle(castle) ? '' : ' (missing)'}`;
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
      window.castleEditor?.setStatus?.('Open an AI project before editing its castle mapping');
      return false;
    }
    if (state.busy) return false;
    const choices = castleFileChoices(ai);
    els.mappingFields.innerHTML = '';
    els.mappingHint.textContent = `Choose the AIV used in each of ${ai.name}'s eight castle slots. The same file may be selected more than once.`;
    for (let slot = 1; slot <= 8; slot += 1) {
      const label = document.createElement('label');
      label.textContent = `Castle ${slot}`;
      const select = document.createElement('select');
      select.dataset.slot = String(slot);
      const unused = document.createElement('option');
      unused.value = '';
      unused.textContent = 'Unused';
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
    setStatus(`Saving ${ai.name}'s castle mapping…`);
    try {
      const updated = await window.electronAPI.updateAiCastleMapping({
        gameRoot: state.gameRoot,
        aiRoot: ai.rootPath,
        slots
      });
      await scan({ selectKey: updated?.key || ai.key, quiet: true });
      populateCastleSwitcher(loadedAi(), state.loadedProject.castleFile);
      setStatus(`✓ ${ai.name}'s castle mapping saved`, 'success');
      return true;
    } catch (error) {
      setStatus(`Could not save castle mapping: ${error.message}`, 'error');
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
    els.count.title = state.library ? `${ais.length} of ${state.library.ais.length} AIs shown` : '';
    if (!ais.length) {
      const empty = document.createElement('div');
      empty.className = 'ucpLibraryEmpty';
      empty.textContent = state.library
        ? (els.search.value.trim() ? 'No AIs match this search.' : 'No AIs match this view.')
        : 'No installation selected.';
      els.list.appendChild(empty);
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
      source.textContent = `${ai.owned ? 'My AIs' : ai.plugin.displayName}${ai.active ? ' · active' : ''}`;
      text.append(name, source);
      button.append(portrait, text);
      button.addEventListener('click', () => selectAi(ai.key));
      els.list.appendChild(button);
    }
  }

  function renderCastleSummary() {
    const ai = selectedAi();
    if (!ai?.castles.length) {
      els.castleSummary.textContent = 'No mapped binary castles were found. The Character can still be opened.';
      return;
    }
    const loadable = ai.castles.filter(canLoadCastle);
    const first = castleOne(ai);
    if (!first) {
      if (ai.castles.some(castle => castle.requiresFileAccess)) {
        els.castleSummary.textContent = `${ai.castles.length} castle mapping${ai.castles.length === 1 ? '' : 's'} found · enable castles, audio & all AIs above to read the binary AIV files.`;
        return;
      }
      els.castleSummary.textContent = `${loadable.length} castle${loadable.length === 1 ? '' : 's'} available, but Castle 1 was not found. The Character will open with a blank Castle editor.`;
      return;
    }
    const source = first.exists ? 'binary AIV ready' : 'JSON fallback available';
    els.castleSummary.textContent = `${loadable.length} castle${loadable.length === 1 ? '' : 's'} available · Castle 1 opens first · ${first.fileName} · ${source}`;
  }

  function loadedSelectionMatches() {
    const ai = selectedAi();
    return Boolean(ai?.owned && state.loadedProject && state.loadedProject.aiKey === ai.key);
  }

  function renderDetails() {
    const ai = selectedAi();
    els.empty.hidden = Boolean(ai);
    els.details.hidden = !ai;
    if (!ai) return;

    els.portrait.src = ai.portraitDataUrl || placeholderPortrait;
    els.portrait.alt = ai.name;
    els.name.textContent = ai.name;
    els.description.textContent = ai.description || 'No description provided.';
    els.author.textContent = ai.author || '—';
    els.version.textContent = ai.version || '—';
    els.plugin.textContent = `${ai.plugin.displayName}${ai.plugin.version ? ` ${ai.plugin.version}` : ''}`;
    els.id.textContent = ai.id;

    els.ownership.textContent = ai.owned ? 'My AI' : 'Installed';
    els.ownership.classList.toggle('owned', ai.owned);
    els.activity.textContent = ai.active ? 'Active plugin' : 'Inactive plugin';
    els.activity.classList.toggle('active', ai.active);

    els.open.textContent = 'Open in editors';
    els.openHint.textContent = ai.owned
      ? 'Loads the managed Character, Castle 1, lines and portraits. Switch castles from the Castle editor.'
      : ai.castles.some(castle => castle.requiresFileAccess)
        ? 'Character data is ready. Enable castles, audio & all AIs above before opening to include its binary castle and sound files.'
        : 'Loads this AI directly from its source plugin. Changes can be saved back to that plugin.';
    setButtonAvailable(els.open, ai.characterExists);
    setButtonAvailable(els.openFolder, true);

    els.cloneCard.hidden = ai.owned || Boolean(ai.vanilla);
    els.updateCard.hidden = !ai.owned;
    if (!ai.owned) {
      els.cloneName.value = `${ai.name} (Custom)`;
      els.cloneId.value = `${germanSlug(ai.folderName || ai.name)}-custom`;
      els.cloneVersion.value = ai.version || '1.0.0';
      setButtonAvailable(els.clone, true);
    } else {
      setButtonAvailable(els.update, loadedSelectionMatches());
      els.update.title = loadedSelectionMatches()
        ? 'Safely update the managed UCP plugin from the loaded editors.'
        : 'Open this AI in the editors first.';
    }
    renderCastleSummary();
  }

  function selectAi(key) {
    state.selectedKey = key;
    renderList();
    renderDetails();
  }

  async function scan({ selectKey = state.selectedKey, quiet = false } = {}) {
    if (!state.gameRoot) return;
    if (!quiet) setStatus('Scanning installed UCP plugins…');
    setBusy(true);
    try {
      state.library = await window.electronAPI.scanUcpAiLibrary(state.gameRoot);
      state.gameRoot = state.library.gameRoot;
      els.installationPath.textContent = state.library.gameRoot;
      els.installationPath.title = state.library.gameRoot;
      setButtonAvailable(els.refresh, true);
      setButtonAvailable(els.openPlugins, true);
      setButtonAvailable(els.create, true);
      if (typeof state.library.fullFileAccess === 'boolean') {
        els.choose.textContent = state.library.fullFileAccess
          ? 'Full AI access enabled ✓'
          : 'Enable castles, audio & all AIs…';
        els.choose.classList.toggle('primaryAction', !state.library.fullFileAccess);
        els.choose.title = state.library.fullFileAccess
          ? `Folder access is active for this editor session${state.library.fileAccessLabel ? ` (${state.library.fileAccessLabel})` : ''}.`
          : 'Select the Stronghold Crusader/ucp/plugins folder. UCP requires this permission for binary castles, audio, video and inactive plugins.';
      }
      const selected = state.library.ais.find(ai => ai.key === selectKey) || state.library.ais[0] || null;
      state.selectedKey = selected?.key || null;
      renderList();
      renderDetails();
      const diagnosticNote = state.library.diagnostics.length ? ` ${state.library.diagnostics.length} package issue(s) were skipped.` : '';
      const accessNote = state.library.fullFileAccess === false
        ? ' Enable full AI access to load castles, audio, video and inactive plugins.'
        : state.library.fullFileAccess === true ? ' Full AI file access is enabled.' : '';
      setStatus(`Found ${state.library.ais.length} AI package${state.library.ais.length === 1 ? '' : 's'} in ${state.library.plugins.length} plugin${state.library.plugins.length === 1 ? '' : 's'}.${diagnosticNote}${accessNote}`);
    } catch (error) {
      state.library = null;
      state.selectedKey = null;
      renderList();
      renderDetails();
      setStatus(`Could not scan UCP: ${error.message}`, 'error');
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
      state.selectedKey = null;
      state.loadedProject = null;
      resetCastleSwitcher();
      await scan({ selectKey: null });
    } catch (error) {
      setStatus(`Could not use that folder: ${error.message}`, 'error');
    }
  }

  async function openSelected(options = {}) {
    const ai = selectedAi();
    if (!ai || !state.gameRoot || state.busy) return false;
    const requestedCastle = typeof options.castleFile === 'string' ? options.castleFile : null;
    const castle = requestedCastle ? ai.castles.find(candidate => candidate.fileName === requestedCastle) : castleOne(ai);
    if (requestedCastle && !castle) {
      setStatus(`The last castle '${requestedCastle}' is no longer in this project. Choose a castle to open.`, 'error');
      return false;
    }
    if (castle?.requiresFileAccess) {
      setStatus('Castle 1 is mapped but UCP cannot read its binary file yet. Click Enable castles, audio & all AIs and select the ucp/plugins folder.', 'error');
      els.choose.focus();
      return false;
    }
    if (!await window.unsavedChanges?.confirmAll('opening this AI project')) return false;
    setBusy(true);
    setStatus(`Opening ${ai.name}…`);
    try {
      const project = await window.electronAPI.loadUcpAiProject({
        gameRoot: state.gameRoot,
        aiRoot: ai.rootPath,
        castleFile: castle?.fileName || null
      });
      if (options.shouldAbort?.()) return false;
      // Eine Vanilla-KI hat keine Figur und darf nicht beschrieben werden -
      // ihre Burgen gehoeren dem Spielordner (siehe vanillaCastles).
      if (project.character) {
        window.characterEditor.loadFromContent(project.character.content, project.character.path, {
          readOnly: false,
          projectManaged: true
        });
      }
      if (project.castle) {
        window.castleEditor.loadDocument(project.castle.document, project.castle.path, {
          readOnly: Boolean(project.readOnly),
          projectManaged: !project.readOnly,
          source: project.castle.source,
          sourceBytes: project.castle.sourceBytes
        });
      } else {
        window.castleEditor.loadDocument(
          { pauseDelayAmount: 100, frames: [], miscItems: [] },
          null,
          { readOnly: false, projectManaged: true }
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
      populateCastleSwitcher(ai, project.castle?.fileName || null);
      renderDetails();
      window.appWorkspace?.setActive('castle');
      rememberProject();
      setStatus(`${ai.name} opened for editing${project.castle ? ` with ${project.castle.fileName}` : ''}.`, 'success');
      return true;
    } catch (error) {
      setStatus(`Could not open AI project: ${error.message}`, 'error');
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
    if (!await window.unsavedChanges?.confirmEditor('castle', 'switching castles')) {
      els.castle.value = projectState.castleFile || '';
      return false;
    }

    setBusy(true);
    setStatus(`Opening ${ai.name} — Castle ${castle.slot ?? castle.fileName}…`);
    try {
      const project = await window.electronAPI.loadUcpAiProject({
        gameRoot: state.gameRoot,
        aiRoot: ai.rootPath,
        castleFile: castle.fileName
      });
      if (!project.castle) throw new Error(`Castle '${castle.fileName}' could not be loaded.`);
      window.castleEditor.loadDocument(project.castle.document, project.castle.path, {
        readOnly: Boolean(project.readOnly),
        projectManaged: !project.readOnly,
        source: project.castle.source,
        sourceBytes: project.castle.sourceBytes
      });
      projectState.castleFile = project.castle.fileName;
      projectState.castlePath = project.castle.path;
      rememberProject();
      populateCastleSwitcher(ai, project.castle.fileName);
      renderDetails();
      setStatus(`${ai.name} — ${castle.slot == null ? castle.fileName : `Castle ${castle.slot}`} opened.`, 'success');
      return true;
    } catch (error) {
      populateCastleSwitcher(ai, projectState.castleFile);
      setStatus(`Could not switch castle: ${error.message}`, 'error');
      return false;
    } finally {
      setBusy(false);
      renderDetails();
    }
  }

  function detachCastleProject() {
    state.loadedProject = null;
    resetCastleSwitcher();
    renderDetails();
  }

  async function cloneSelected() {
    const ai = selectedAi();
    if (!ai || ai.owned || state.busy) return false;
    let clone = null;
    setBusy(true);
    setStatus(`Cloning ${ai.name} into My AIs…`);
    try {
      clone = await window.electronAPI.cloneUcpAi({
        gameRoot: state.gameRoot,
        sourceAiRoot: ai.rootPath,
        aiId: els.cloneId.value,
        name: els.cloneName.value,
        version: els.cloneVersion.value
      });
      if (!clone) throw new Error('The cloned AI could not be found after installation.');
      await scan({ selectKey: clone.key, quiet: true });
      setStatus(`${clone.name} was installed in My AIs. Activate the plugin in the UCP GUI when ready.`, 'success');
    } catch (error) {
      setStatus(`Could not clone AI: ${error.message}`, 'error');
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
    setStatus(`Creating ${name} in My AIs…`);
    let created = null;
    try {
      created = await window.electronAPI.createUcpAi({
        gameRoot: state.gameRoot,
        name,
        aiId,
        author: els.createAuthor.value.trim(),
        version: els.createVersion.value.trim() || '1.0.0'
      });
      if (!created) throw new Error('The new AI could not be found after creation.');
      await scan({ selectKey: created.key, quiet: true });
      setStatus(`${created.name} was created in My AIs.`, 'success');
    } catch (error) {
      setStatus(`Could not create AI: ${error.message}`, 'error');
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
      setStatus('Open this My AI project before updating it.', 'error');
      return false;
    }
    if (!samePath(window.characterEditor?.getPath?.(), state.loadedProject.characterPath)) {
      setStatus('The Character editor is showing another file. Open this AI project again first.', 'error');
      return false;
    }
    if (state.loadedProject.castlePath && !samePath(window.castleEditor?.getPath?.(), state.loadedProject.castlePath)) {
      setStatus('The Castle editor is showing another file. Open the AI project again first.', 'error');
      return false;
    }

    setBusy(true);
    setStatus(`Updating ${ai.name} through a staging folder…`);
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
      setStatus(`${ai.name} is installed and up to date in My AIs.`, 'success');
      return true;
    } catch (error) {
      setStatus(`Could not update My AI: ${error.message}`, 'error');
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
      setStatus(`Could not open folder: ${error.message}`, 'error');
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
    let interrupted = false;
    const interrupt = () => { interrupted = true; };
    window.addEventListener('pointerdown', interrupt, true);
    window.addEventListener('keydown', interrupt, true);
    try {
      state.gameRoot = await window.electronAPI.getUcpInstallation();
      if (state.gameRoot) await scan();
      // Only the application's startup window restores a project. Explicit
      // Add Window / Load In New Window must never have its document replaced.
      if (!interrupted && new URLSearchParams(window.location.search).get('restoreProject') === '1') {
        const saved = previousProject();
        const ai = projectInLibrary(saved);
        if (ai) {
          state.selectedKey = ai.key;
          renderList();
          renderDetails();
          if (await openSelected({ castleFile: saved.castleFile, shouldAbort: () => interrupted })) {
            window.appWorkspace?.setActive(['castle', 'character', 'content', 'ucp'].includes(saved.workspace) ? saved.workspace : 'castle');
          }
        } else if (saved) {
          setStatus('The last AI project is unavailable in this installation. Choose a project to continue.');
        }
      }
    } catch (error) {
      setStatus(`Could not restore the UCP installation: ${error.message}`, 'error');
    } finally {
      window.removeEventListener('pointerdown', interrupt, true);
      window.removeEventListener('keydown', interrupt, true);
    }
  }

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
