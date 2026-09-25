(() => {
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);
  let active = 'ucp';
  const tabs = Array.from(document.querySelectorAll('.workspaceTab'));
  const workspaces = {
    character: document.getElementById('characterWorkspace'),
    castle: document.getElementById('castleWorkspace'),
    content: document.getElementById('aiContentWorkspace'),
    ucp: document.getElementById('ucpWorkspace')
  };
  const status = document.getElementById('workspaceStatus');

  function setActive(name) {
    if (!workspaces[name]) return;
    active = name;
    for (const [key, el] of Object.entries(workspaces)) {
      const enabled = key === name;
      el.classList.toggle('active', enabled);
      el.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    }
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.workspace === name);
    window.electronAPI.setActiveWorkspace(name);
    setStatus(() => name === 'castle'
      ? tr("shell:castle_editor")
      : name === 'content' ? tr("interface:ai_content")
      : name === 'ucp' ? tr("interface:ucp_ai_library") : tr("interface:character_editor"));
    // A frame later, so the boxes of the view tree have their size before
    // the editor measures the one its map ended up with.
    if (name === 'castle') requestAnimationFrame(() => {
      window.castlePanels?.onWorkspaceShown?.();
      window.castleEditor?.onWorkspaceShown();
    });
    if (name === 'content') window.aiContentEditor?.onWorkspaceShown?.();
    if (name === 'ucp') window.ucpLibrary?.onWorkspaceShown?.();
    window.ucpLibrary?.rememberProject?.();
  }

  function getActive() { return active; }
  function setStatus(text) { window.toolkitI18n.bindText(status, text); }

  function editorFor(name) {
    if (name === 'castle') return window.castleEditor;
    if (name === 'character') return window.characterEditor;
    if (name === 'content') return window.aiContentEditor;
    return null;
  }

  async function confirmEditor(name, action) {
    const editor = editorFor(name);
    if (!editor?.isDirty?.()) return true;
    const choice = await window.electronAPI.confirmUnsaved({
      documentName: name === 'castle' ? tr('details:castle_document') : name === 'content' ? 'lines.json' : tr('details:character_document'),
      action
    });
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return Boolean(await editor.saveFile?.());
  }

  async function confirmAll(action) {
    if (!await confirmEditor('character', action)) return false;
    if (!await confirmEditor('castle', action)) return false;
    return confirmEditor('content', action);
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => setActive(tab.dataset.workspace));
  }

  let closePromptOpen = false;
  window.electronAPI.onRequestWindowClose(async () => {
    if (closePromptOpen) return;
    closePromptOpen = true;
    try {
      if (await confirmAll(tr("shell:closing_this_window"))) window.electronAPI.confirmWindowClose();
    } finally {
      closePromptOpen = false;
    }
  });

  window.appWorkspace = { setActive, getActive, setStatus };
  window.unsavedChanges = { confirmEditor, confirmAll };
})();
