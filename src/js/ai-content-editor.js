(() => {
  'use strict';
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);

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
    window.toolkitI18n.bindText(els.status, message);
    els.status.classList.toggle('success', type === 'success');
    els.status.classList.toggle('error', type === 'error');
    if (window.appWorkspace?.getActive() === 'content') window.appWorkspace.setStatus(message);
  }

  function updateDirtyDisplay() {
    const dirty = isDirty();
    els.dirty.textContent = dirty ? tr("common:state.unsaved") : tr("common:state.saved");
    els.dirty.classList.toggle('dirty', dirty);
  }

  function friendlyLabel(key) {
    const base=String(key).replace(/_\d+$/,''),number=String(key).match(/_(\d+)$/)?.[1];
    if(globalThis.toolkitI18n.engine.exists('dialogue:'+key))return tr('dialogue:'+key);
    if(globalThis.toolkitI18n.engine.exists('dialogue:'+base))return tr('dialogue:'+base)+(number?' '+number:'');
    return String(key);
  }

  // English field guidance translated from the supplied lines_base.json.
  // These are placeholders only, never default dialogue or saved content.
  const LINE_HINTS = Object.freeze({
    ai_name: "content:character_name",
    description: "content:character_description",
    unknown_1: "content:character_name",
    anger_1: "content:the_ai_s_attack_has_been_repelled",
    anger_2: "content:one_of_the_ai_s_buildings_has_been_destroyed",
    plead: "content:the_ai_has_been_defeated_if_enemy",
    victory_1: "content:the_ai_has_successfully_defended_itself",
    victory_2: "content:the_ai_destroys_a_building",
    victory_3: "content:the_ai_has_killed_the_player",
    victory_4: "content:the_ai_defeats_another_enemy_ai",
    request: "content:the_ai_requests_goods",
    thanks: "content:the_player_sends_goods_to_the_ai",
    ally_death: "content:the_ai_has_been_defeated_if_ally",
    congrats: "content:the_player_defeats_an_enemy_while_allied_with_this_ai",
    boast: "content:the_allied_ai_defeats_an_enemy",
    help: "content:the_ai_is_under_attack_and_asks_for_help",
    extra: "content:the_game_has_been_going_on_for_a_long_time",
    kick_player: "content:a_player_is_removed_from_the_map",
    add_player: "content:a_player_is_added_to_the_map",
    siege: "content:not_used",
    no_sent: "content:the_ai_does_not_send_the_requested_goods",
    sent: "content:the_ai_sends_the_requested_goods",
    team_winning: "content:the_team_is_winning",
    team_losing: "content:the_team_is_losing",
    help_sent: "content:the_ai_sends_the_requested_help",
    will_attack: "content:the_ai_will_attack_the_requested_enemy"
  });

  function lineHint(key) {
    if (/^title_[1-8]$/.test(key)) return tr("content:character_title_include_quotation_marks_for_a_quoted_title");
    if (/^complete_title_[1-8]$/.test(key)) return tr("content:character_name_followed_by_the_title_include_quotation_marks_for_a_quote");
    if (/^taunt_[1-4]$/.test(key)) return tr("content:the_ai_attacks_the_player");
    if (/^nervous_[1-2]$/.test(key)) return tr("content:the_player_attacks_the_ai");
    if (/^no_attack_[1-2]$/.test(key)) return tr("content:the_ai_refuses_to_attack_the_requested_enemy");
    if (/^no_help_[1-2]$/.test(key)) return tr("content:the_ai_refuses_a_request_for_help");
    return Object.hasOwn(LINE_HINTS, key) ? tr(LINE_HINTS[key]) : '';
  }

  function renderLines() {
    els.form.innerHTML = '';
    for (const key of Object.keys(state.lines)) {
      const label = document.createElement('label');
      label.className = `aiLineField${key === 'description' ? ' long' : ''}`;
      label.dataset.lineKey = key;
      const name = document.createElement('span');
      name.textContent = friendlyLabel(key);
      name.title = key;
      const input = document.createElement('textarea');
      input.rows = key === 'description' ? 4 : 2;
      input.value = state.lines[key] == null ? '' : String(state.lines[key]);
      input.placeholder = lineHint(key);
      input.spellcheck = true;
      input.addEventListener('input', () => {
        state.lines[key] = input.value;
        updateDirtyDisplay();
      });
      label.append(name, input);
      els.form.appendChild(label);
    }
    window.toolkitI18n.applyTextDirection(els.form);
    updateDirtyDisplay();
  }

  function translateLineLabels() {
    for (const label of els.form.querySelectorAll('.aiLineField')) {
      const key = label.dataset.lineKey;
      label.querySelector('span').textContent = friendlyLabel(key);
      label.querySelector('textarea').placeholder = lineHint(key);
    }
    window.toolkitI18n.applyTextDirection(els.form);
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
    if (parts.length === 1) return tr('common:preferences.defaultTheme');
    if (parts[0]?.toLowerCase() === 'lang' && parts.length >= 3) return tr('interface:language')+': '+parts[1];
    return parts.slice(0, -1).join(' / ') || tr('common:preferences.defaultTheme');
  }

  function speechLanguage(item) {
    if (item.language) return String(item.language);
    const parts = String(item.group || '').split('/').filter(Boolean);
    if (parts[0]?.toLowerCase() === 'lang' && parts.length >= 3) return parts[1];
    return state.defaultLanguage || 'default';
  }

  function languageLabel(language) {
    if (language === 'default') return tr('common:preferences.defaultTheme');
    return language === state.defaultLanguage ? `${language} (${tr('common:preferences.defaultTheme')})` : language;
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
      option.textContent = tr("interface:no_speech");
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
    return keys.length > 3 ? `${shown} +${keys.length - 3}` : shown;
  }

  function mediaEntryMatches(one, two) {
    return one.kind === two.kind &&
      one.mappingRelativePath === two.mappingRelativePath &&
      one.fileName.toLowerCase() === two.fileName.toLowerCase();
  }

  async function playSpeech(item, button, audio) {
    if (!item.exists || state.busy) return;
    button.disabled = true;
    button.textContent = tr("common:state.loading");
    setStatus(() => tr("content:loading_value", { fileName: item.fileName }));
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
      button.textContent = tr("content:replay");
      setStatus(() => tr('feedback:playing', {name:item.fileName}), 'success');
    } catch (error) {
      button.textContent = tr("content:play");
      setStatus(() => tr("content:could_not_play_value_here_value_use_open_externally", { fileName: item.fileName, message: error.message }), 'error');
    } finally {
      button.disabled = state.busy;
    }
  }

  async function openMedia(item) {
    if (!item.exists || state.busy) return false;
    try {
      const result = await window.electronAPI.openAiMedia(mediaRequest(item));
      setStatus(
        () => result?.action === 'downloaded'
          ? tr("content:downloaded_value_open_it_with_its_associated_program", { fileName: item.fileName })
          : tr("content:opened_value_in_its_associated_program", { fileName: item.fileName }),
        'success'
      );
      return true;
    } catch (error) {
      setStatus(() => tr("content:could_not_open_value_value", { fileName: item.fileName, message: error.message }), 'error');
      return false;
    }
  }

  async function replaceMedia(item) {
    if (!state.aiRoot || state.busy) return false;
    setBusy(true);
    setStatus(() => tr("content:choosing_a_replacement_for_value", { fileName: item.fileName }));
    try {
      const result = await window.electronAPI.replaceAiMedia(mediaRequest(item));
      if (!result) {
        setStatus(() => tr("content:media_replacement_cancelled"));
        return false;
      }
      const collection = state.media[item.kind];
      const index = collection.findIndex(candidate => mediaEntryMatches(candidate, item));
      if (index >= 0) collection[index] = result;
      renderMedia(item.kind);
      setStatus(() => tr('feedback:replaced_media', {name:item.fileName,size:formatBytes(result.size)}), 'success');
      return true;
    } catch (error) {
      setStatus(() => tr("content:could_not_replace_value_value", { fileName: item.fileName, message: error.message }), 'error');
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
        ? tr("content:no_mapped_wav_speech_files_found_for_value", { value1: languageLabel(state.speechLanguage) })
        : tr("content:no_mapped_value_files_found", { value1: speech ? tr('details:wav_speech') : tr('details:bink_video') });
      list.appendChild(empty);
      window.toolkitI18n.applyTextDirection(list);
      return;
    }

    for (const item of items) {
      const card = document.createElement('article');
      card.className = `aiMediaCard${item.exists ? '' : ' missing'}`;

      const heading = document.createElement('div');
      heading.className = 'aiMediaHeading';
      const title = document.createElement('h3');
      title.dataset.bidi = 'ltr';
      title.textContent = item.fileName;
      title.title = item.filePath;
      const badge = document.createElement('span');
      badge.className = 'aiMediaState';
      badge.textContent = item.exists ? formatBytes(item.size) : tr("content:missing");
      heading.append(title, badge);

      const meta = document.createElement('p');
      meta.className = 'aiMediaMeta';
      meta.textContent = `${mediaGroup(item)} · ${mediaUses(item) || tr("content:mapped_asset")}`;
      meta.title = `${mediaGroup(item)}\n${(item.keys || []).map(friendlyLabel).join(', ')}`;

      const actions = document.createElement('div');
      actions.className = 'aiMediaActions';
      let audio = null;
      if (speech) {
        const play = document.createElement('button');
        play.type = 'button';
        play.textContent = tr("content:play");
        play.dataset.available = item.exists ? 'true' : 'false';
        play.disabled = state.busy || !item.exists;
        play.addEventListener('click', () => playSpeech(item, play, audio));
        actions.appendChild(play);
        audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.hidden = true;
        audio.addEventListener('error', () => {
          setStatus(() => tr("content:this_wav_codec_cannot_play_in_the_editor_use_open_externally"), 'error');
        });
      }
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = speech ? tr("content:open_externally") : tr("content:open_play");
      open.dataset.available = item.exists ? 'true' : 'false';
      open.disabled = state.busy || !item.exists;
      open.addEventListener('click', () => openMedia(item));
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.textContent = tr("common:actions.replace");
      replace.dataset.available = 'true';
      replace.disabled = state.busy;
      replace.addEventListener('click', () => replaceMedia(item));
      actions.append(open, replace);
      card.append(heading, meta, actions);
      if (audio) card.appendChild(audio);
      list.appendChild(card);
    }
    window.toolkitI18n.applyTextDirection(list);
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
    window.toolkitI18n.bindText(els.path, state.linesPath, 'ltr');
    els.path.title = state.linesPath;
    els.portrait.src = state.portraits.portrait?.dataUrl || placeholder;
    els.portraitSmall.src = state.portraits.portraitSmall?.dataUrl || placeholder;
    renderLines();
    renderAllMedia();
    setBusy(false);
    setStatus(() => tr("content:value_content_loaded", { value1: state.aiName || 'AI' }));
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
    window.toolkitI18n.bindText(els.path, () => tr("interface:no_ai_project_loaded"));
    els.form.innerHTML = '';
    els.portrait.src = placeholder;
    els.portraitSmall.src = placeholder;
    renderAllMedia();
    setBusy(false);
    setStatus(() => tr("interface:open_an_ai_from_the_library_first"));
  }

  async function saveFile() {
    if (!state.linesPath || state.busy) return false;
    setBusy(true);
    setStatus(() => tr("content:saving_lines_json"));
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
      setStatus(() => tr("content:could_not_save_lines_json_value", { message: error.message }), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changePortrait(kind) {
    if (!state.aiRoot || state.busy) return false;
    setBusy(true);
    const small = kind === 'portraitSmall';
    setStatus(() => tr('feedback:choosing', {name:small ? 'portrait_small.png' : 'portrait.png'}));
    try {
      const result = await window.electronAPI.chooseAiPortrait({
        gameRoot: state.gameRoot,
        aiRoot: state.aiRoot,
        kind
      });
      if (!result) {
        setStatus(() => tr("content:portrait_change_cancelled"));
        return false;
      }
      state.portraits[kind] = result;
      (small ? els.portraitSmall : els.portrait).src = result.dataUrl;
      setStatus(() => tr("content:value_saved_as_value_value", { value1: small ? 'portrait_small.png' : 'portrait.png', width: result.width, height: result.height }), 'success');
      window.ucpLibrary?.refreshCurrent?.();
      return true;
    } catch (error) {
      setStatus(() => tr("content:could_not_change_portrait_value", { message: error.message }), 'error');
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

  window.toolkitI18n?.onChange(() => {
    translateLineLabels(); renderAllMedia(); updateDirtyDisplay();
  });
  clearProject();
})();
