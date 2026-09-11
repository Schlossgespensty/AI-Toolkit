'use strict';

/*
 * Zusatzwerkzeuge für den Burgeneditor.
 *
 * Diese Datei liegt bewusst NEBEN castle-editor.js und nicht darin. Sie haengt
 * sich von aussen an das an, was der Editor unter window.castleEditor schon
 * herausgibt; im Editor selbst steht nur eine einzige Zeile, die diese Datei
 * nachlaedt, und eine, die sein Innenleben unter .extras erreichbar macht.
 *
 * Zwei Dinge stehen hier:
 *
 *   1. Benannte Gruppen. Mehrfachauswahl und gemeinsames Verschieben gibt es
 *      schon; was fehlte, war der Name und das Wiederfinden. Eine Gruppe merkt
 *      sich Bautyp und Feld ihrer Mitglieder - nicht die laufende Nummer des
 *      Bauschritts, denn die verschiebt sich beim Umsortieren. Wird die Gruppe
 *      am Stueck verschoben, zieht sie mit; passiert etwas anderes, bleibt sie
 *      stehen, statt falsche Felder zu lernen.
 *
 *   2. Ein Kopierspeicher, der den Burgenwechsel ueberlebt. Der Editor legt
 *      seine Kopie in state.copyBuffer ab und wirft sie beim Laden einer
 *      anderen Burg weg. Hier wird sie zusaetzlich abgelegt und vor dem
 *      Einfuegen zurueckgereicht. Eingefuegt wird danach ueber den Weg des
 *      Editors selbst (placeCopy), damit die Pruefungen dieselben bleiben -
 *      Kartenrand, Hoechstzahl, Ueberlappung, gesperrte Bauschritte.
 */

(function (global) {

  // ---------------------------------------------------------------------
  // Reine Rechenteile. Sie kennen kein Fenster und keine Oberflaeche, damit
  // ein Test sie ohne Browser pruefen kann.
  // ---------------------------------------------------------------------

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

  // Eine Gruppe merkt sich Bautyp und Feld, nicht die Nummer des Bauschritts.
  // Beim Wiederfinden wird jedes Mitglied genau einer Setzung zugeordnet -
  // liegen zwei gleiche Bauwerke auf demselben Feld, bekommt jedes seine
  // eigene, statt beide auf dieselbe zu zeigen.
  function matchMembersToRefs(members, placements) {
    const byKey = new Map();
    for (const placement of Array.isArray(placements) ? placements : []) {
      const key = `${Number(placement.type)}@${Number(placement.off)}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(placement.ref);
    }
    const refs = [];
    let missing = 0;
    for (const member of Array.isArray(members) ? members : []) {
      const bucket = byKey.get(`${Number(member.type)}@${Number(member.off)}`);
      if (bucket && bucket.length) refs.push(bucket.shift());
      else missing += 1;
    }
    return { refs, missing };
  }

  // Sind alle Mitglieder um denselben Betrag gewandert, war es ein
  // gemeinsames Verschieben - und nur dann darf die Gruppe die neuen Felder
  // lernen. Alles andere (geloescht, ersetzt, umsortiert) laesst sie in Ruhe,
  // damit sie sich nie stillschweigend etwas Falsches merkt.
  function uniformDelta(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after)) return null;
    if (!before.length || before.length !== after.length) return null;
    let dx = null;
    let dy = null;
    for (let i = 0; i < before.length; i++) {
      if (Number(before[i].type) !== Number(after[i].type)) return null;
      const oldX = Number(before[i].off) % GRID;
      const oldY = Math.floor(Number(before[i].off) / GRID);
      const newX = Number(after[i].off) % GRID;
      const newY = Math.floor(Number(after[i].off) / GRID);
      const stepX = newX - oldX;
      const stepY = newY - oldY;
      if (dx === null) { dx = stepX; dy = stepY; continue; }
      if (stepX !== dx || stepY !== dy) return null;
    }
    return { dx, dy };
  }

  const pure = {
    UNSAVED_KEY,
    castleKeyForPath,
    sanitizeClipboard,
    sanitizeGroups,
    matchMembersToRefs,
    uniformDelta
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
  let active = null;     // zuletzt geholte Gruppe - sie folgt einem Verschieben
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
    if (!members.length) return 'Select something on the map first.';
    if (groups.some(group => group.name.toLowerCase() === name.toLowerCase())) {
      return `A group called "${name}" is already there.`;
    }
    groups.push({ id: `g${Date.now().toString(36)}${groups.length}`, name, members });
    saveGroups();
    renderGroups();
    ex.setStatus(`Group "${name}" saved with ${members.length} placement${members.length === 1 ? '' : 's'}`);
    return '';
  }

  function selectGroup(group) {
    const placements = placementList();
    const { refs, missing } = matchMembersToRefs(group.members, placements);
    if (!refs.length) {
      setGroupError(`Nothing of "${group.name}" is on the map any more.`);
      active = null;
      return;
    }
    const byRef = new Map(placements.map(entry => [entry.ref, entry]));
    ex.state.selected = new Set(refs);
    ex.setTool('select');
    ex.renderBuildList();
    ex.scheduleDraw();
    active = {
      id: group.id,
      refs: refs.slice(),
      members: refs.map(ref => ({ type: Number(byRef.get(ref).type), off: Number(byRef.get(ref).off) }))
    };
    const note = missing ? ` (${missing} gone)` : '';
    ex.setStatus(`Group "${group.name}": ${refs.length} placement${refs.length === 1 ? '' : 's'} selected${note} — drag to move them together`);
    setGroupError('');
  }

  function updateGroupFromSelection(group) {
    const members = selectedMembers();
    if (!members.length) return setGroupError('Select something on the map first.');
    group.members = members;
    saveGroups();
    renderGroups();
    ex.setStatus(`Group "${group.name}" now holds ${members.length} placement${members.length === 1 ? '' : 's'}`);
    setGroupError('');
  }

  // Nach jeder Aenderung nachsehen, ob die zuletzt geholte Gruppe am Stueck
  // gewandert ist. Nur dann lernt sie die neuen Felder; sonst wird sie
  // losgelassen und bleibt so, wie der Nutzer sie abgelegt hat.
  function followActiveGroup() {
    if (!active) return;
    const group = groups.find(entry => entry.id === active.id);
    if (!group) { active = null; return; }
    const byRef = new Map(placementList().map(entry => [entry.ref, entry]));
    const now = [];
    for (const ref of active.refs) {
      const placement = byRef.get(ref);
      if (!placement) { active = null; return; }
      now.push({ type: Number(placement.type), off: Number(placement.off) });
    }
    const delta = uniformDelta(active.members, now);
    if (!delta) { active = null; return; }
    if (delta.dx === 0 && delta.dy === 0) return;
    group.members = now;
    active.members = now;
    saveGroups();
    if (els.dialog?.open) renderGroups();
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
      empty.textContent = 'No groups in this castle yet. Select placements on the map, give them a name and save.';
      els.list.appendChild(empty);
      return;
    }
    for (const group of groups) {
      const row = doc.createElement('div');
      row.className = 'castleGroupRow';

      const name = doc.createElement('span');
      name.className = 'castleGroupName';
      name.textContent = group.name;
      row.appendChild(name);

      const count = doc.createElement('span');
      count.className = 'castleGroupCount';
      count.textContent = `${group.members.length}`;
      count.title = `${group.members.length} placement${group.members.length === 1 ? '' : 's'}`;
      row.appendChild(count);

      row.appendChild(rowButton('Select', 'Select this group on the map, then drag to move it', () => selectGroup(group)));
      row.appendChild(rowButton('Update', 'Replace this group with whatever is selected now', () => updateGroupFromSelection(group)));
      row.appendChild(rowButton('Rename', 'Give this group another name', () => renameGroup(group)));
      row.appendChild(rowButton('Delete', 'Remove this group — the buildings stay', () => deleteGroup(group)));

      els.list.appendChild(row);
    }
  }

  function rowButton(label, title, onClick) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function renameGroup(group) {
    const wanted = String(global.prompt?.('New name for this group', group.name) ?? '').trim().slice(0, 60);
    if (!wanted || wanted === group.name) return;
    if (groups.some(other => other !== group && other.name.toLowerCase() === wanted.toLowerCase())) {
      return setGroupError(`A group called "${wanted}" is already there.`);
    }
    group.name = wanted;
    saveGroups();
    renderGroups();
    setGroupError('');
  }

  function deleteGroup(group) {
    groups = groups.filter(entry => entry !== group);
    if (active?.id === group.id) active = null;
    saveGroups();
    renderGroups();
    ex.setStatus(`Group "${group.name}" removed — the buildings are untouched`);
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
    writeStore(CLIP_STORE, null);
    updateClipboardButton();
    ex.setStatus('Clipboard emptied');
  }

  function updateClipboardButton() {
    if (!els.clipboard) return;
    const count = clipboard?.count || 0;
    els.clipboard.textContent = count ? `Clipboard (${count})` : 'Clipboard';
    els.clipboard.disabled = !count;
    els.clipboard.title = count
      ? `${count} placement${count === 1 ? '' : 's'} copied — works in every castle. Click, then click on the map, or press Ctrl+V.`
      : 'Nothing copied yet. Copy something with Ctrl+C or the Copy tool.';
    if (els.clipboardClear) els.clipboardClear.hidden = !count;
  }

  // --- Oberflaeche einhaengen -------------------------------------------

  function addStylesheet() {
    if (doc.querySelector('link[data-castle-extras]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/editor-extras.css';
    link.dataset.castleExtras = 'true';
    doc.head.appendChild(link);
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

  function addToolbar() {
    const toolbar = doc.querySelector('#castleWorkspace .castleToolbar');
    if (!toolbar || doc.getElementById('castleGroupsBtn')) return;
    const group = doc.createElement('div');
    group.className = 'toolbarGroup castleExtrasGroup';
    group.setAttribute('aria-label', 'Groups, clipboard and shortcuts');

    group.appendChild(toolbarButton('castleGroupsBtn', 'Groups',
      'Give a selection a name, find it again later and move it as one',
      openGroupsDialog));

    els.clipboard = toolbarButton('castleClipboardBtn', 'Clipboard',
      'Nothing copied yet.',
      () => {
        if (!armClipboard()) return ex.setStatus('Nothing copied yet — use Ctrl+C or the Copy tool first');
        ex.setTool('copy');
        ex.setStatus(`Clipboard ready: ${clipboard.count} placement${clipboard.count === 1 ? '' : 's'} — click on the map to place them`);
      });
    group.appendChild(els.clipboard);

    els.clipboardClear = toolbarButton('castleClipboardClearBtn', '×',
      'Empty the clipboard', clearClipboard);
    els.clipboardClear.hidden = true;
    group.appendChild(els.clipboardClear);

    group.appendChild(toolbarButton('castleShortcutsBtn', 'Shortcuts',
      'Choose your own keys for the tools',
      () => ed.showShortcutDialog()));

    toolbar.appendChild(group);
    updateClipboardButton();
  }

  function addGroupsDialog() {
    if (doc.getElementById('castleGroupsDialog')) return;
    const dialog = doc.createElement('dialog');
    dialog.id = 'castleGroupsDialog';
    dialog.className = 'ucpCreateDialog castleGroupsDialog';

    const form = doc.createElement('form');
    form.id = 'castleGroupsForm';

    const heading = doc.createElement('div');
    heading.className = 'ucpCreateHeading';
    const title = doc.createElement('h2');
    title.textContent = 'Groups';
    const hint = doc.createElement('p');
    hint.textContent = 'A group remembers which buildings belong together. Select them on the map, save them under a name, and pick them up again any time — moving them stays the same drag as before.';
    heading.appendChild(title);
    heading.appendChild(hint);
    form.appendChild(heading);

    const newRow = doc.createElement('div');
    newRow.className = 'castleGroupsNew';
    els.name = doc.createElement('input');
    els.name.type = 'text';
    els.name.id = 'castleGroupNameInput';
    els.name.placeholder = 'Name for the current selection';
    els.name.maxLength = 60;
    els.name.autocomplete = 'off';
    newRow.appendChild(els.name);
    const saveBtn = doc.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save selection';
    newRow.appendChild(saveBtn);
    form.appendChild(newRow);

    els.list = doc.createElement('div');
    els.list.id = 'castleGroupsList';
    els.list.className = 'castleGroupsList';
    form.appendChild(els.list);

    els.error = doc.createElement('div');
    els.error.id = 'castleGroupsError';
    els.error.className = 'castleShortcutError';
    els.error.setAttribute('role', 'alert');
    form.appendChild(els.error);

    const actions = doc.createElement('div');
    actions.className = 'ucpCreateActions castleShortcutActions';
    const spacer = doc.createElement('span');
    spacer.className = 'castleShortcutActionSpacer';
    actions.appendChild(spacer);
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => dialog.close());
    actions.appendChild(closeBtn);
    form.appendChild(actions);

    form.addEventListener('submit', event => {
      event.preventDefault();
      const name = String(els.name.value || '').trim().slice(0, 60);
      if (!name) return setGroupError('Give the group a name first.');
      const problem = newGroupFromSelection(name);
      if (problem) return setGroupError(problem);
      els.name.value = '';
      setGroupError('');
    });

    // Tasten im Fenster gehoeren dem Fenster. Ohne das wuerde ein "1" im
    // Namensfeld nebenbei das Werkzeug umschalten.
    dialog.addEventListener('keydown', event => event.stopPropagation());

    dialog.appendChild(form);
    doc.body.appendChild(dialog);
    els.dialog = dialog;
  }

  function openGroupsDialog() {
    renderGroups();
    setGroupError('');
    const selected = ex.state.selected?.size || 0;
    els.name.placeholder = selected
      ? `Name for the ${selected} selected placement${selected === 1 ? '' : 's'}`
      : 'Select something on the map first';
    els.dialog.showModal();
    els.name.focus();
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
        active = null;
        loadGroups(key);
        // Immer neu zeichnen, auch bei geschlossenem Fenster: sonst stehen im
        // zugeklappten Fenster noch die Gruppen der vorigen Burg.
        renderGroups();
        return;
      }
      if (staticChanged) followActiveGroup();
    });
  }

  function watchKeys() {
    global.addEventListener('storage', event => {
      if (event.key !== CLIP_STORE && event.key !== null) return;
      loadClipboard();
      updateClipboardButton();
    });
    // In der Anfassphase - damit der Speicher zurueckliegt, BEVOR der Editor
    // sein Ctrl+V abarbeitet. Sein eigener Hoerer haengt am Fenster und kommt
    // erst danach dran.
    global.addEventListener('keydown', event => {
      if (els.dialog?.open) return;
      // Nur in der Burg. Im Charakter-Editor gehoert Strg+C dem Textfeld.
      if (global.appWorkspace && global.appWorkspace.getActive() !== 'castle') return;
      if (!event.ctrlKey && !event.metaKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'v') armClipboard();
      else if (key === 'c') global.setTimeout(rememberClipboard, 0);
    }, true);

    // Die 2.5D-Ansicht ist ein eigenes Fenster; ihre Tasten erreichen den
    // Hoerer oben nie, sondern kommen ueber handleKey herein.
    const original = ed.handleKey;
    if (typeof original === 'function' && !original.castleExtrasWrapped) {
      const wrapped = function (event) {
        if (event?.ctrlKey || event?.metaKey) {
          const key = String(event.key || '').toLowerCase();
          if (key === 'v') armClipboard();
          else if (key === 'c') global.setTimeout(rememberClipboard, 0);
        }
        return original(event);
      };
      wrapped.castleExtrasWrapped = true;
      ed.handleKey = wrapped;
    }

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
    addToolbar();
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
