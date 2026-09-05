(() => {
  'use strict';

  const els = {
    workspace: document.getElementById('aiContentWorkspace'),
    empty: document.getElementById('aiContentEmpty'),
    editor: document.getElementById('aiContentEditor'),
    save: document.getElementById('aiContentSaveBtn'),
    status: document.getElementById('aiContentStatus'),
    path: document.getElementById('aiContentPath'),
    form: document.getElementById('aiLinesForm'),
    dirty: document.getElementById('aiLinesDirtyBadge'),
    portrait: document.getElementById('aiPortraitPreview'),
    portraitSmall: document.getElementById('aiPortraitSmallPreview'),
    changePortrait: document.getElementById('aiPortraitChangeBtn'),
    changePortraitSmall: document.getElementById('aiPortraitSmallChangeBtn'),
    speechList: document.getElementById('aiSpeechList'),
    speechCount: document.getElementById('aiSpeechCount'),
    speechLanguage: document.getElementById('aiSpeechLanguage'),
    binkList: document.getElementById('aiBinkList'),
    binkCount: document.getElementById('aiBinkCount')
  };

  const state = {
    gameRoot: null,
    aiRoot: null,
    aiName: '',
    linesPath: null,
    lines: {},
    savedSnapshot: null,
    portraits: { portrait: null, portraitSmall: null },
    media: { speech: [], binks: [], diagnostics: [] },
    defaultLanguage: '',
    speechLanguage: '',
    busy: false
  };

  let speechAudioContext = null;
  let activeSpeechSource = null;

  const placeholder = `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">
      <rect width="72" height="72" fill="#242830"/>
      <path d="M36 9 57 19v17c0 14-8 24-21 31-13-7-21-17-21-31V19z" fill="#3a7bd5" opacity=".7"/>
      <text x="36" y="43" text-anchor="middle" fill="#eef1f6" font-family="sans-serif" font-size="18">AI</text>
    </svg>`)}`;

  function snapshot() {
    return JSON.stringify(state.lines);
  }

  function isDirty() {
    return Boolean(state.linesPath && state.savedSnapshot !== snapshot());
  }

  function setStatus(message, type = '') {
    els.status.textContent = message;
    els.status.classList.toggle('success', type === 'success');
    els.status.classList.toggle('error', type === 'error');
    if (window.appWorkspace?.getActive() === 'content') window.appWorkspace.setStatus(message);
  }

  function updateDirtyDisplay() {
    const dirty = isDirty();
    els.dirty.textContent = dirty ? 'Unsaved' : 'Saved';
    els.dirty.classList.toggle('dirty', dirty);
  }

  function friendlyLabel(key) {
    return String(key)
      .replaceAll('_', ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function renderLines() {
    els.form.innerHTML = '';
    for (const key of Object.keys(state.lines)) {
      const label = document.createElement('label');
      label.className = `aiLineField${key === 'description' ? ' long' : ''}`;
      const name = document.createElement('span');
      name.textContent = friendlyLabel(key);
      name.title = key;
      const input = document.createElement('textarea');
      input.rows = key === 'description' ? 4 : 2;
      input.value = state.lines[key] == null ? '' : String(state.lines[key]);
      input.spellcheck = true;
      input.addEventListener('input', () => {
        state.lines[key] = input.value;
        updateDirtyDisplay();
      });
      label.append(name, input);
      els.form.appendChild(label);
    }
    updateDirtyDisplay();
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function mediaRequest(item) {
    return {
      gameRoot: state.gameRoot,
      aiRoot: state.aiRoot,
      kind: item.kind,
      mappingRelativePath: item.mappingRelativePath,
      fileName: item.fileName
    };
  }

  function mediaGroup(item) {
    const parts = String(item.group || '').split('/').filter(Boolean);
    if (parts.length === 1) return 'Default';
    if (parts[0]?.toLowerCase() === 'lang' && parts.length >= 3) return `Language: ${parts[1]}`;
    return parts.slice(0, -1).join(' / ') || 'Default';
  }

  function speechLanguage(item) {
    if (item.language) return String(item.language);
    const parts = String(item.group || '').split('/').filter(Boolean);
    if (parts[0]?.toLowerCase() === 'lang' && parts.length >= 3) return parts[1];
    return state.defaultLanguage || 'default';
  }

  function languageLabel(language) {
    if (language === 'default') return 'Default';
    return language === state.defaultLanguage ? `${language} (default)` : language;
  }

  function populateSpeechLanguages(preferred = state.speechLanguage) {
    const languages = [...new Set((state.media.speech || []).map(speechLanguage))]
      .sort((one, two) => {
        if (one === state.defaultLanguage) return -1;
        if (two === state.defaultLanguage) return 1;
        if (one === 'default') return -1;
        if (two === 'default') return 1;
        return one.localeCompare(two, undefined, { numeric: true });
      });
    els.speechLanguage.innerHTML = '';
    if (!languages.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No speech';
      els.speechLanguage.appendChild(option);
      els.speechLanguage.disabled = true;
      state.speechLanguage = '';
      return;
    }
    for (const language of languages) {
      const option = document.createElement('option');
      option.value = language;
      option.textContent = languageLabel(language);
      els.speechLanguage.appendChild(option);
    }
    state.speechLanguage = languages.includes(preferred) ? preferred : languages[0];
    els.speechLanguage.value = state.speechLanguage;
    els.speechLanguage.disabled = state.busy;
  }

  function mediaUses(item) {
    const keys = item.keys || [];
    const shown = keys.slice(0, 3).map(friendlyLabel).join(', ');
    return keys.length > 3 ? `${shown} +${keys.length - 3} more` : shown;
  }

  function mediaEntryMatches(one, two) {
    return one.kind === two.kind &&
      one.mappingRelativePath === two.mappingRelativePath &&
      one.fileName.toLowerCase() === two.fileName.toLowerCase();
  }

  async function playSpeech(item, button, audio) {
    if (!item.exists || state.busy) return;
    button.disabled = true;
    button.textContent = 'Loading…';
    setStatus(`Loading ${item.fileName}…`);
    try {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (AudioContextType && !speechAudioContext) speechAudioContext = new AudioContextType();
      await speechAudioContext?.resume?.();
      const result = await window.electronAPI.loadAiMediaData(mediaRequest(item));
      const binary = result.bytes
        ? (result.bytes instanceof Uint8Array ? result.bytes : Uint8Array.from(result.bytes))
        : null;
      if (speechAudioContext && binary?.length) {
        activeSpeechSource?.stop?.();
        const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
        const decoded = await speechAudioContext.decodeAudioData(buffer);
        const source = speechAudioContext.createBufferSource();
        source.buffer = decoded;
        source.connect(speechAudioContext.destination);
        source.start();
        activeSpeechSource = source;
        source.addEventListener?.('ended', () => {
          if (activeSpeechSource === source) activeSpeechSource = null;
        }, { once: true });
      } else {
        audio.src = result.dataUrl;
        audio.hidden = false;
        await audio.play();
      }
      button.textContent = 'Replay';
      setStatus(`Playing ${item.fileName}`, 'success');
    } catch (error) {
      button.textContent = 'Play';
      setStatus(`Could not play ${item.fileName} here: ${error.message} Use Open externally.`, 'error');
    } finally {
      button.disabled = state.busy;
    }
  }

  async function openMedia(item) {
    if (!item.exists || state.busy) return false;
    try {
      const result = await window.electronAPI.openAiMedia(mediaRequest(item));
      setStatus(
        result?.action === 'downloaded'
          ? `Downloaded ${item.fileName}. Open it with its associated program.`
          : `Opened ${item.fileName} in its associated program.`,
        'success'
      );
      return true;
    } catch (error) {
      setStatus(`Could not open ${item.fileName}: ${error.message}`, 'error');
      return false;
    }
  }

  async function replaceMedia(item) {
    if (!state.aiRoot || state.busy) return false;
    setBusy(true);
    setStatus(`Choosing a replacement for ${item.fileName}…`);
    try {
      const result = await window.electronAPI.replaceAiMedia(mediaRequest(item));
      if (!result) {
        setStatus('Media replacement cancelled');
        return false;
      }
      const collection = state.media[item.kind];
      const index = collection.findIndex(candidate => mediaEntryMatches(candidate, item));
      if (index >= 0) collection[index] = result;
      renderMedia(item.kind);
      setStatus(`✓ ${item.fileName} replaced (${formatBytes(result.size)})`, 'success');
      return true;
    } catch (error) {
      setStatus(`Could not replace ${item.fileName}: ${error.message}`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function renderMedia(kind) {
    const speech = kind === 'speech';
    const list = speech ? els.speechList : els.binkList;
    const count = speech ? els.speechCount : els.binkCount;
    const allItems = state.media[kind] || [];
    const items = speech && state.speechLanguage
      ? allItems.filter(item => speechLanguage(item) === state.speechLanguage)
      : allItems;
    count.textContent = String(items.length);
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'aiMediaEmpty';
      empty.textContent = speech && state.speechLanguage
        ? `No mapped WAV speech files found for ${languageLabel(state.speechLanguage)}.`
        : `No mapped ${speech ? 'WAV speech' : 'Bink video'} files found.`;
      list.appendChild(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement('article');
      card.className = `aiMediaCard${item.exists ? '' : ' missing'}`;

      const heading = document.createElement('div');
      heading.className = 'aiMediaHeading';
      const title = document.createElement('h3');
      title.textContent = item.fileName;
      title.title = item.filePath;
      const badge = document.createElement('span');
      badge.className = 'aiMediaState';
      badge.textContent = item.exists ? formatBytes(item.size) : 'Missing';
      heading.append(title, badge);

      const meta = document.createElement('p');
      meta.className = 'aiMediaMeta';
      meta.textContent = `${mediaGroup(item)} · ${mediaUses(item) || 'Mapped asset'}`;
      meta.title = `${item.group}\n${(item.keys || []).join(', ')}`;

      const actions = document.createElement('div');
      actions.className = 'aiMediaActions';
      let audio = null;
      if (speech) {
        const play = document.createElement('button');
        play.type = 'button';
        play.textContent = 'Play';
        play.dataset.available = item.exists ? 'true' : 'false';
        play.disabled = state.busy || !item.exists;
        play.addEventListener('click', () => playSpeech(item, play, audio));
        actions.appendChild(play);
        audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.hidden = true;
        audio.addEventListener('error', () => {
          setStatus(`This WAV codec cannot play in the editor. Use Open externally.`, 'error');
        });
      }
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = speech ? 'Open externally' : 'Open / play';
      open.dataset.available = item.exists ? 'true' : 'false';
      open.disabled = state.busy || !item.exists;
      open.addEventListener('click', () => openMedia(item));
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.textContent = 'Replace';
      replace.dataset.available = 'true';
      replace.disabled = state.busy;
      replace.addEventListener('click', () => replaceMedia(item));
      actions.append(open, replace);
      card.append(heading, meta, actions);
      if (audio) card.appendChild(audio);
      list.appendChild(card);
    }
  }

  function renderAllMedia() {
    populateSpeechLanguages();
    renderMedia('speech');
    renderMedia('binks');
  }

  function setBusy(value) {
    state.busy = value;
    els.save.disabled = value || !state.linesPath;
    els.changePortrait.disabled = value || !state.aiRoot;
    els.changePortraitSmall.disabled = value || !state.aiRoot;
    els.speechLanguage.disabled = value || !(state.media.speech || []).length;
    for (const button of els.editor.querySelectorAll('.aiMediaCard button')) {
      button.disabled = value || button.dataset.available === 'false';
    }
  }

  function loadProject(project, ai, gameRoot) {
    const lines = JSON.parse(project.lines?.content || '{}');
    if (!lines || typeof lines !== 'object' || Array.isArray(lines)) throw new Error('lines.json must contain a JSON object.');
    state.gameRoot = gameRoot;
    state.aiRoot = project.aiRoot;
    state.aiName = ai?.name || '';
    state.linesPath = project.lines?.path || `${project.aiRoot}\\lines.json`;
    state.lines = lines;
    state.savedSnapshot = snapshot();
    state.portraits = project.portraits || { portrait: null, portraitSmall: null };
    state.media = project.media || { speech: [], binks: [], diagnostics: [] };
    state.defaultLanguage = String(ai?.defaultLang || '').trim();
    state.speechLanguage = state.defaultLanguage;
    els.empty.hidden = true;
    els.editor.hidden = false;
    els.path.textContent = state.linesPath;
    els.path.title = state.linesPath;
    els.portrait.src = state.portraits.portrait?.dataUrl || placeholder;
    els.portraitSmall.src = state.portraits.portraitSmall?.dataUrl || placeholder;
    renderLines();
    renderAllMedia();
    setBusy(false);
    setStatus(`${state.aiName || 'AI'} content loaded`);
  }

  function clearProject() {
    state.gameRoot = null;
    state.aiRoot = null;
    state.aiName = '';
    state.linesPath = null;
    state.lines = {};
    state.savedSnapshot = null;
    state.portraits = { portrait: null, portraitSmall: null };
    state.media = { speech: [], binks: [], diagnostics: [] };
    state.defaultLanguage = '';
    state.speechLanguage = '';
    els.empty.hidden = false;
    els.editor.hidden = true;
    els.path.textContent = 'No AI project loaded';
    els.form.innerHTML = '';
    els.portrait.src = placeholder;
    els.portraitSmall.src = placeholder;
    renderAllMedia();
    setBusy(false);
    setStatus('Open an AI from the Library first.');
  }

  async function saveFile() {
    if (!state.linesPath || state.busy) return false;
    setBusy(true);
    setStatus('Saving lines.json…');
    try {
      await window.electronAPI.quickSaveFile({
        path: state.linesPath,
        content: `${JSON.stringify(state.lines, null, 2)}\n`,
        kind: 'json'
      });
      state.savedSnapshot = snapshot();
      updateDirtyDisplay();
      setStatus('✓ lines.json saved', 'success');
      return true;
    } catch (error) {
      setStatus(`Could not save lines.json: ${error.message}`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changePortrait(kind) {
    if (!state.aiRoot || state.busy) return false;
    setBusy(true);
    const small = kind === 'portraitSmall';
    setStatus(`Choosing ${small ? 'portrait_small.png' : 'portrait.png'}…`);
    try {
      const result = await window.electronAPI.chooseAiPortrait({
        gameRoot: state.gameRoot,
        aiRoot: state.aiRoot,
        kind
      });
      if (!result) {
        setStatus('Portrait change cancelled');
        return false;
      }
      state.portraits[kind] = result;
      (small ? els.portraitSmall : els.portrait).src = result.dataUrl;
      setStatus(`✓ ${small ? 'portrait_small.png' : 'portrait.png'} saved as ${result.width}×${result.height}`, 'success');
      window.ucpLibrary?.refreshCurrent?.();
      return true;
    } catch (error) {
      setStatus(`Could not change portrait: ${error.message}`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  els.save.addEventListener('click', saveFile);
  els.changePortrait.addEventListener('click', () => changePortrait('portrait'));
  els.changePortraitSmall.addEventListener('click', () => changePortrait('portraitSmall'));
  els.speechLanguage.addEventListener('change', () => {
    state.speechLanguage = els.speechLanguage.value;
    renderMedia('speech');
  });

  window.aiContentEditor = {
    loadProject,
    clearProject,
    saveFile,
    isDirty,
    getPath: () => state.linesPath,
    markSaved: () => { state.savedSnapshot = snapshot(); updateDirtyDisplay(); },
    onWorkspaceShown: () => updateDirtyDisplay()
  };

  clearProject();
})();
