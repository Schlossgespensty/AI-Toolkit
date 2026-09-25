'use strict';

// Named selection snapshots and a persistent cross-castle clipboard.
// Placement always uses the editor's existing validation and undo pipeline.

(function (global) {
  const tr = (key, options) => (globalThis.toolkitI18n || require('./i18n')).t(key, options);

  // ---------------------------------------------------------------------
  // Reine Rechenteile. Sie kennen kein Fenster und keine Oberflaeche, damit
  // ein Test sie ohne Browser pruefen kann.
  // ---------------------------------------------------------------------

  // A persisted identity, not a display label: existing groups must survive
  // language changes and remain compatible with the original storage format.
  const UNSAVED_KEY = '(unsaved castle)';
  // Dieselbe Kantenlaenge wie im Editor: ein Feld-Versatz ist y * GRID + x.
  const GRID = 100;

  // Ein Ablageschluessel je Burg. Windows schreibt denselben Pfad mal mit
  // Schraegstrich, mal mit Gegenstrich und mal gross - drei Schluessel fuer
  // eine Burg waeren drei getrennte Gruppenlisten.
  function castleKeyForPath(path) {
    const text = String(path || '').trim();
    if (!text) return UNSAVED_KEY;
    return text.replace(/\\/g, '/').toLowerCase();
  }

  const isWholeNumber = value => Number.isInteger(value);

  // Was aus dem Speicher zurueckkommt, ist Fremdtext - es kann von einer
  // aelteren Fassung stammen oder von Hand veraendert worden sein. Es geht
  // erst weiter, wenn jedes Feld stimmt; sonst gilt der Speicher als leer.
  function sanitizeClipboard(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups)) return null;
    const groups = [];
    let count = 0;
    for (const group of raw.groups) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.entries)) return null;
      const kind = group.kind === 'unit' ? 'unit' : 'frame';
      const itemType = Number(group.itemType);
      if (!isWholeNumber(itemType)) return null;
      const entries = [];
      for (const entry of group.entries) {
        if (!entry || typeof entry !== 'object') return null;
        const type = Number(entry.type);
        const dx = Number(entry.dx);
        const dy = Number(entry.dy);
        if (!isWholeNumber(type) || !isWholeNumber(dx) || !isWholeNumber(dy)) return null;
        entries.push({ type, dx, dy });
      }
      if (!entries.length) return null;
      count += entries.length;
      groups.push({ kind, itemType, entries });
    }
    if (!groups.length) return null;
    return { groups, count };
  }

  function sanitizeGroups(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const used = new Set();
    for (const group of raw) {
      if (!group || typeof group !== 'object') continue;
      const name = String(group.name || '').trim().slice(0, 60);
      if (!name) continue;
      const members = [];
      for (const member of Array.isArray(group.members) ? group.members : []) {
        const type = Number(member?.type);
        const off = Number(member?.off);
        if (!isWholeNumber(type) || !isWholeNumber(off) || off < 0) continue;
        members.push({ type, off });
      }
      if (!members.length) continue;
      // Die Kennung traegt die Gruppe nur, damit die Oberflaeche sie
      // wiederfindet. Fehlt sie oder gibt es sie doppelt, bekommt die Gruppe
      // hier eine neue - sonst zeigen zwei Zeilen auf dieselbe.
      let id = String(group.id || '').trim();
      if (!id || used.has(id)) id = `g${out.length}-${Date.now().toString(36)}`;
      used.add(id);
      out.push({ id, name, members });
    }
    return out;
  }

  function clipboardFromMembers(members, definitions) {
    const items = members.filter(member => member.type !== 61 && definitions[member.type]);
    if (!items.length) return null;
    const x = Math.min(...items.map(item => item.off % GRID));
    const y = Math.min(...items.map(item => Math.floor(item.off / GRID)));
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.type)) groups.set(item.type, {kind: definitions[item.type].kind === 'unit' ? 'unit' : 'frame', itemType: item.type, entries: []});
      groups.get(item.type).entries.push({type: item.type, dx: item.off % GRID - x, dy: Math.floor(item.off / GRID) - y});
    }
    return {groups: [...groups.values()], count: items.length};
  }

  const pure = {
    clipboardFromMembers,
    UNSAVED_KEY,
    castleKeyForPath,
    sanitizeClipboard,
    sanitizeGroups
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (global) global.castleEditorExtras = pure;

  // Ohne Fenster ist hier Schluss - im Test wird nur oben gerechnet.
  if (!global || !global.document) return;

  // ---------------------------------------------------------------------
  // Ab hier die Oberflaeche.
  // ---------------------------------------------------------------------

  const doc = global.document;
  const GROUP_STORE = 'aiv.castleGroups.v1';
  const CLIP_STORE = 'aiv.castleClipboard.v1';

  let ed = null;         // window.castleEditor
  let ex = null;         // dessen Innenleben, in einer Zeile herausgereicht
  let castleKey = null;  // welche Burg gerade offen ist
  let groups = [];       // deren Gruppen
  let clipboard = null;  // Kopie, die den Burgenwechsel ueberlebt
  let rememberedBuffer = null;
  const els = {};

  function readStore(key, fallback) {
    try {
      const text = global.localStorage?.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      console.warn('Ignoring unreadable castle extras store:', key, error);
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      if (value === null) global.localStorage?.removeItem(key);
      else global.localStorage?.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Could not save castle extras store:', key, error);
    }
  }

  // --- 1. Gruppen -------------------------------------------------------

  function allGroupStores() {
    const stored = readStore(GROUP_STORE, {});
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  }

  function loadGroups(key) {
    groups = sanitizeGroups(allGroupStores()[key]);
  }

  function saveGroups() {
    const all = allGroupStores();
    if (groups.length) all[castleKey] = groups;
    else delete all[castleKey];
    writeStore(GROUP_STORE, all);
  }

  function placementList() {
    try {
      return ex.placementRefs();
    } catch (error) {
      console.warn('Castle extras: could not read the placements', error);
      return [];
    }
  }

  function selectedMembers() {
    const selected = ex.state.selected;
    if (!selected || !selected.size) return [];
    return placementList()
      .filter(placement => selected.has(placement.ref))
      .map(placement => ({ type: Number(placement.type), off: Number(placement.off) }));
  }

  function newGroupFromSelection(name) {
    const members = selectedMembers();
    if (!members.length) return tr("castle:select_something_on_the_map_first");
    if (groups.some(group => group.name.toLowerCase() === name.toLowerCase())) {
      return tr("castle:a_group_called_value_is_already_there", { name: name });
    }
    groups.push({ id: `g${Date.now().toString(36)}${groups.length}`, name, members });
    saveGroups();
    renderGroups();
    ex.setStatus(() => tr("castle:group_value_saved_with_value_placementvalue", { name: name, quantityvalue3: tr("quantity:placement", { count: members.length }) }));
    return '';
  }

  function setGroupError(text) {
    if (els.error) els.error.textContent = text || '';
  }

  function renderGroups() {
    if (!els.list) return;
    els.list.textContent = '';
    if (!groups.length) {
      const empty = doc.createElement('p');
      empty.className = 'castleGroupsEmpty';
      empty.textContent = tr("castle:no_groups_in_this_castle_yet_select_placements_on_the_map_give_them_a_na");
      els.list.appendChild(empty);
      global.toolkitI18n.applyTextDirection(els.list);
      return;
    }
    for (const group of groups) {
      const row = doc.createElement('div'); row.className = 'castleGroupEntry';
      row.appendChild(rowButton(group.name, tr("castle:copy_this_group_for_placement"), () => {
        const buffer = clipboardFromMembers(group.members, ed.getItemDefinitions());
        if (!buffer) return setGroupError(tr("castle:this_group_has_no_copyable_items"));
        ex.state.copyBuffer = buffer;
        rememberClipboard();
        ex.setTool('copy');
        els.dialog.close();
        ex.setStatus(() => tr('layout:move_copy'));
      }));
      const remove = rowButton('', tr("castle:delete_group_value", { name: group.name }), () => {
        groups = groups.filter(saved => saved.id !== group.id);
        saveGroups(); renderGroups();
      });
      remove.className = 'castleGroupRemove';
      remove.setAttribute('aria-label', tr("castle:delete_group_value", { name: group.name }));
      const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 18 20'); icon.setAttribute('aria-hidden', 'true');
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3 5h12M6 5V3h6v2M5 5l1 12h6l1-12M8 8v6M10 8v6');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      icon.appendChild(path); remove.appendChild(icon); row.appendChild(remove);
      els.list.appendChild(row);
    }
    global.toolkitI18n.applyTextDirection(els.list);
  }

  function rowButton(label, title, onClick) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  // --- 3. Kopierspeicher ueber Burgen hinweg ----------------------------

  function loadClipboard() {
    clipboard = sanitizeClipboard(readStore(CLIP_STORE, null));
  }

  // Was der Editor gerade in der Hand hat, kommt hier zusaetzlich in den
  // Speicher. Das laeuft nach seinem eigenen Kopieren - mit der Maus wie mit
  // Strg+C -, damit es genau dieselbe Kopie ist und keine zweite Bauart.
  function rememberClipboard() {
    if (ex.state.copyBuffer === rememberedBuffer) return;
    const buffer = sanitizeClipboard(ex.state.copyBuffer);
    if (!buffer) return;
    rememberedBuffer = ex.state.copyBuffer;
    clipboard = buffer;
    if (JSON.stringify(readStore(CLIP_STORE, null)) !== JSON.stringify(buffer)) writeStore(CLIP_STORE, clipboard);
    updateClipboardButton();
  }

  // Vor dem Einfuegen: hat der Editor selbst nichts, bekommt er das aus dem
  // Speicher zurueckgelegt. Eingefuegt wird danach von ihm - mit seinen
  // Pruefungen, nicht mit eigenen.
  function armClipboard() {
    // Another castle window may have copied since this window last had focus.
    // Read at paste time as well as on storage events, which can arrive later.
    clipboard = sanitizeClipboard(readStore(CLIP_STORE, null));
    updateClipboardButton();
    ex.state.copyBuffer = null;
    rememberedBuffer = null;
    if (!clipboard) return false;
    ex.state.copyBuffer = JSON.parse(JSON.stringify(clipboard));
    rememberedBuffer = ex.state.copyBuffer;
    return true;
  }

  function clearClipboard() {
    clipboard = null;
    ex.state.copyBuffer = null;
    rememberedBuffer = null;
    if (ex.state.tool === 'copy') ex.setTool('select');
    ex.scheduleDraw();
    writeStore(CLIP_STORE, null);
    updateClipboardButton();
    ex.setStatus(() => tr("castle:clipboard_emptied"));
  }

  function updateClipboardButton() {
    if (!els.clipboard) return;
    const count = clipboard?.count || 0;
    const key = ed.getShortcut('paste');
    els.clipboard.textContent = count ? `${tr('common:actions.paste')} ${count}${key ? ' (' + key.toUpperCase() + ')' : ''}` : tr("common:actions.paste");
    els.clipboard.parentElement.hidden = !count;
    els.clipboard.disabled = !count;
    els.clipboard.title = count
      ? tr("castle:value_placementvalue_copied_works_in_every_castle_click_then_click_on_th", { quantityvalue2: tr("quantity:placement", { count: count }) })
      : tr("castle:nothing_copied_yet_copy_something_with_ctrl_c_or_the_copy_tool");
    if (els.clipboardClear) els.clipboardClear.hidden = !count;
  }

  // --- Oberflaeche einhaengen -------------------------------------------

  function addStylesheet(owner = doc) {
    if (owner.querySelector('link[data-castle-extras]')) return;
    const link = owner.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('css/editor-extras.css', doc.baseURI).href;
    link.dataset.castleExtras = 'true';
    owner.head.appendChild(link);
  }

  function toolbarButton(id, label, title, onClick) {
    const button = doc.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function addClipboardStatus() {
    const status = doc.querySelector('.castleStatusBar');
    if (!status) return;
    const group = doc.createElement('span');
    group.className = 'castleClipboardStatus';
    els.clipboard = toolbarButton('castleClipboardBtn', tr('common:actions.paste'), tr("castle:paste_at_the_cursor"), () => {
      if (!armClipboard()) return;
      ex.setTool('copy');
      ex.setStatus(() => tr('layout:move_copy'));
    });
    els.clipboardClear = toolbarButton('castleClipboardClearBtn', tr('common:actions.remove'), tr("castle:empty_the_clipboard"), clearClipboard);
    group.append(els.clipboard, els.clipboardClear);
    status.appendChild(group);
    updateClipboardButton();
  }

  function addGroupsDialog() {
    const dialog = doc.createElement('dialog');
    dialog.id = 'castleGroupsDialog';
    dialog.className = 'castleGroupsDialog';
    dialog.dataset.i18nAttrs = 'aria-label=castle:groups';
    const form = doc.createElement('form'); form.id = 'castleGroupsForm';
    const nameRow = doc.createElement('div'); nameRow.className = 'castleGroupsNew';
    const name = doc.createElement('input'); name.id = 'castleGroupNameInput';
    name.dataset.i18nAttrs = 'placeholder=castle:group_name;aria-label=castle:group_name';
    name.maxLength = 60; name.autocomplete = 'off';
    const save = doc.createElement('button'); save.type = 'submit'; save.dataset.i18n = 'castle:save_group';
    nameRow.append(name, save);
    const list = doc.createElement('div'); list.id = 'castleGroupsList'; list.className = 'castleGroupsList';
    const error = doc.createElement('div'); error.setAttribute('role', 'alert');
    form.append(nameRow, list, error); dialog.appendChild(form); doc.body.appendChild(dialog);
    global.toolkitI18n.applyBindings(dialog);
    Object.assign(els, {dialog, name, nameRow, list, error});
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = name.value.trim();
      const problem = value ? newGroupFromSelection(value) : tr("castle:enter_a_group_name");
      if (problem) return setGroupError(problem);
      name.value = ''; dialog.close();
    });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
  }

  function openGroupsDialog(event) {
    const selected = selectedMembers().length > 0;
    els.nameRow.hidden = !selected;
    els.list.hidden = selected;
    renderGroups(); setGroupError('');
    const position = event?.detail;
    const owner = position?.document || doc;
    addStylesheet(owner);
    if (els.dialog.open) els.dialog.close();
    if (els.dialog.ownerDocument !== owner) owner.body.appendChild(els.dialog);
    els.dialog.style.margin = position ? '0' : 'auto';
    els.dialog.style.left = position ? `${Math.max(8, Math.min(position.x, owner.defaultView.innerWidth - 328))}px` : '';
    els.dialog.style.top = position ? `${Math.max(8, Math.min(position.y, owner.defaultView.innerHeight - 280))}px` : '';
    els.dialog.showModal();
    if (selected) els.name.focus();
    else els.list.querySelector('button')?.focus();
  }

  // --- Was sich waehrend der Arbeit aendert ------------------------------

  function watchCastle() {
    ed.addChangeListener(staticChanged => {
      const key = castleKeyForPath(ed.getPath?.());
      if (key !== castleKey) {
        // Aus "noch nicht gespeichert" wird beim Speichern ein echter Pfad.
        // Die Gruppen wandern mit, sonst waeren sie im Moment des Speicherns
        // verschwunden.
        if (castleKey === UNSAVED_KEY && groups.length && !sanitizeGroups(allGroupStores()[key]).length) {
          const all = allGroupStores();
          all[key] = groups;
          delete all[UNSAVED_KEY];
          writeStore(GROUP_STORE, all);
        }
        castleKey = key;
        loadGroups(key);
        // Immer neu zeichnen, auch bei geschlossenem Fenster: sonst stehen im
        // zugeklappten Fenster noch die Gruppen der vorigen Burg.
        renderGroups();
        return;
      }
    });
  }

  function watchKeys() {
    global.addEventListener('storage', event => {
      if (event.key !== CLIP_STORE && event.key !== null) return;
      loadClipboard();
      updateClipboardButton();
    });
    // Copy/cut dispatch this after the action, independent of its assigned keys
    // and whether the gesture originated in the docked or detached view.
    global.addEventListener('castle-clipboard-changed', rememberClipboard);
    global.addEventListener('castle-prepare-paste', armClipboard);
    global.addEventListener('castle-open-groups', openGroupsDialog);

    // Mit der Maus kopiert wird beim Loslassen. Dieser Hoerer haengt spaeter
    // am selben Element als der des Editors und kommt deshalb danach dran.
    const canvas = doc.getElementById('castleCanvas');
    canvas?.addEventListener('pointerup', () => global.setTimeout(rememberClipboard, 0));
    // The detached 2.5D view forwards gestures instead of DOM pointer events.
    const originalPointer = ed.pointerFromOutside;
    if (typeof originalPointer === 'function' && !originalPointer.castleExtrasWrapped) {
      const wrappedPointer = function (phase, event) {
        const result = originalPointer.call(ed, phase, event);
        if (phase === 'up') global.setTimeout(rememberClipboard, 0);
        return result;
      };
      wrappedPointer.castleExtrasWrapped = true;
      ed.pointerFromOutside = wrappedPointer;
    }
  }

  function start() {
    ed = global.castleEditor;
    ex = ed?.extras;
    if (!ed || !ex || !ex.state) return false;
    addStylesheet();
    addClipboardStatus();
    addGroupsDialog();
    castleKey = castleKeyForPath(ed.getPath?.());
    loadGroups(castleKey);
    loadClipboard();
    updateClipboardButton();
    watchCastle();
    watchKeys();
    return true;
  }

  // Diese Datei wird vom Editor nachgeladen und ist damit nicht an seiner
  // Reihenfolge festgemacht. Ist er noch nicht fertig, wird kurz gewartet -
  // aber nicht endlos, damit ein Fehler sichtbar bleibt.
  global.toolkitI18n?.onChange(() => {
    updateClipboardButton();
    renderGroups();
    if (els.clipboardClear) {
      els.clipboardClear.textContent = tr('common:actions.remove');
      els.clipboardClear.title = tr('castle:empty_the_clipboard');
    }
  });
  let attempts = 0;
  (function tryStart() {
    if (start()) return;
    if (++attempts > 40) {
      console.warn('Castle extras: the editor never showed up, groups and clipboard stay off.');
      return;
    }
    global.setTimeout(tryStart, 50);
  })();

})(typeof window !== 'undefined' ? window : null);
