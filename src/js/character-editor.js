let isInitialized = false;
let data = null;

async function loadConfig(name) {
  return await window.electronAPI.loadConfig(name);
}


let helpTexts;
let fieldPools;
let optionPools;
let numericBooleanFields;
let legacyKeyMap;

let template;
let groupBreaks;
let sections;

let templateOrdered;
let groupBreaksOrdered;
let sectionsOrdered

let activeTemplate;
let activeGroupBreaks;
let activeSections;

let pendingLoad = null;

let availablePopulation = 10;

async function init() {
  try {
    [template, helpTexts, fieldPools, optionPools, groupBreaks,
      numericBooleanFields, legacyKeyMap, sections, templateOrdered,
      groupBreaksOrdered, sectionsOrdered] = await Promise.all([
      "template.json", "helpTexts.json", "fieldPools.json", "optionPools.json",
      "groupBreaks.json", "numericBooleanFields.json", "legacyKeyMap.json",
      "sections.json", "templateOrdered.json", "groupBreaksOrdered.json",
      "sectionsOrdered.json"
    ].map(loadConfig));

    data = JSON.parse(JSON.stringify(template));

    activeTemplate = template;
    activeGroupBreaks = groupBreaks;
    activeSections = sections;

    setActiveTemplateButton("standard");

    render();
  } catch (e) {
    console.error("INIT FAILED:", e);
    alert("Failed to load config files.");
  }

  if (pendingLoad) {
  const { content, path } = pendingLoad;
  pendingLoad = null;

  try {
    loadFromContent(content, path);
  } catch (err) {
    alert("Error while loading file:\n\n" + err.message);
    console.error(err);
  }
}

  if (savedCharacterSnapshot === null && typeof data !== "undefined") markCharacterSaved();
  isInitialized = true;
}

init();

function standardTemplate() {
  activeTemplate = template;
  activeGroupBreaks = groupBreaks;
  activeSections = sections;

  setActiveTemplateButton("standard");

  data = applyTemplateOrder(activeTemplate, data);
  render();
  updateFilePathDisplay();
}

function orderedTemplate() {
  activeTemplate = templateOrdered;
  activeGroupBreaks = groupBreaksOrdered;
  activeSections = sectionsOrdered;

  setActiveTemplateButton("ordered");

  data = applyTemplateOrder(activeTemplate, data);
  render();
  updateFilePathDisplay();
}

function setActiveTemplateButton(type) {
  const standardBtn = document.getElementById("btnStandard");
  const orderedBtn = document.getElementById("btnOrdered");

  standardBtn.classList.remove("active");
  orderedBtn.classList.remove("active");

  if (type === "standard") {
    standardBtn.classList.add("active");
  } else {
    orderedBtn.classList.add("active");
  }
}

let searchQuery = "";
let searchRenderPending = false;
document.getElementById("search").oninput = (e)=>{
  searchQuery = e.target.value.toLowerCase();
  if (searchRenderPending) return;
  searchRenderPending = true;
  requestAnimationFrame(() => {
    searchRenderPending = false;
    render();
  });
};

let currentFilePath = null;
let currentFileReadOnly = false;
let AIName = "";
let savedCharacterSnapshot = null;

function showHelp(content) {
  const overlay = document.createElement("div");
  overlay.className = "helpOverlay";

  const box = document.createElement("div");
  box.className = "helpBox";

  const text = document.createElement("div");
  text.className = "helpText";
  text.textContent = String(content || '').replace(/<br\s*\/?>/gi, '\n');

  const close = document.createElement("button");
  close.textContent = "Close";

  const buttonWrap = document.createElement("div");
  buttonWrap.className = "helpButtonWrap";
  buttonWrap.appendChild(close);

  box.appendChild(text);
  box.appendChild(buttonWrap);
  close.onclick = () => document.body.removeChild(overlay);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function mergeDefaults(target, source) {
  for (let key in source) {
    if (target[key] === undefined) {
      target[key] = JSON.parse(JSON.stringify(source[key]));
    } else if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      typeof target[key] === "object"
    ) {
      mergeDefaults(target[key], source[key]);
    }
  }
}

function createField(key, value, parent) {
  if (searchQuery && !key.toLowerCase().includes(searchQuery)) return null;

  const div = document.createElement("div");
  div.className = "field";
 if (!searchQuery && activeGroupBreaks.includes(key)) {
  div.classList.add("sectionDivider");
}
 
  const label = document.createElement("span");

  if (searchQuery) {
    const idx = key.toLowerCase().indexOf(searchQuery);
    if (idx !== -1) {
      const match = document.createElement('span');
      match.className = 'searchMatch';
      match.textContent = key.substring(idx, idx + searchQuery.length);
      label.append(
        document.createTextNode(key.substring(0, idx)),
        match,
        document.createTextNode(key.substring(idx + searchQuery.length))
      );
    } else label.textContent = key;
  } else label.textContent = key;

  div.appendChild(label);

  let input;

if (numericBooleanFields.includes(key)) {
  input = document.createElement("select");

  ["True", "False"].forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.text = v;

    if ((value === 1 && v === "True") || (value === 0 && v === "False")) {
      o.selected = true;
    }

    input.appendChild(o);
  });

  input.onchange = () => {
    parent[key] = (input.value === "True") ? 1 : 0;
    updateHeaderInfo();
  };
}


else if (typeof value === "number") {
  input = document.createElement("input");
  input.type = "text";

  const isDecimal = key === "StrengthMultiplier";

  input.value = value;

  input.oninput = () => {

    let val = input.value;

val = val.replace(/[^0-9.-]/g, "");

if (val.includes("-")) {
  val = val.replace(/-/g, "");
  val = "-" + val; 
}

if (isDecimal) {
  const firstDot = val.indexOf(".");
  if (firstDot !== -1) {
    val =
      val.substring(0, firstDot + 1) +
      val.substring(firstDot + 1).replace(/\./g, "");
  }
} else {

  val = val.replace(/\./g, "");
}

if (val === "-.") {
  val = "-0.";
}

if (val.startsWith(".")) {
  val = "0" + val;
}

if (val !== input.value) {
  input.value = val;
}
  };

  input.onblur = () => {
  let val = input.value;

  if (isDecimal) {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      parent[key] = num;
      updateHeaderInfo();
      input.value = num;
    } else {
      input.value = parent[key];
    }
  } else {
    const num = parseInt(val);
    if (!isNaN(num)) {
      parent[key] = num;
      updateHeaderInfo();
      input.value = num;
    } else {
      input.value = parent[key];
    }
  }
};
}

  else if (fieldPools[key]) {
    input = document.createElement("select");
    optionPools[fieldPools[key]].forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      o.text = v;
      if (v === value) o.selected = true;
      input.appendChild(o);
    });
    input.onchange = () => {
      parent[key] = input.value;
      updateHeaderInfo();
    }
  }
  else {
    input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.onchange = () => {
      parent[key] = input.value;
      updateHeaderInfo();
    }
  }

  div.appendChild(input);

  const help = document.createElement("div");
  help.className = "helpBtn";
  help.textContent = "?";
  help.onclick = () => showHelp((helpTexts[key] || "No description yet."));

  div.appendChild(help);

  return div;
}

function buildSection(title, keys, source, container) {
  const sec = document.createElement("details");
  if (searchQuery) sec.open = true;
  const sum = document.createElement("summary");
  sum.textContent = title;
  sec.appendChild(sum);

  keys.forEach(k=>{
    if(source[k]!==undefined){
      sec.appendChild(createField(k, source[k], source));
    }
  });

  container.appendChild(sec);
}

function flattenObject(obj, result = [], parent = null, path = "") {
  for (let key in obj) {
    if (key === "aic") continue;

    const value = obj[key];
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof value === "object" && value !== null) {
      flattenObject(value, result, value, currentPath);
    } else {
      result.push({
        key,
        value,
        parent,
        path: currentPath
      });
    }
  }

  if (obj.aic) {
    flattenObject(obj.aic, result, obj.aic, path ? `${path}.aic` : "aic");
  }

  return result;
}

function buildForm(obj, container) {
  const flat = flattenObject(obj);

  let currentSection = null;

  function startSection(title) {
    const sec = document.createElement("details");
    sec.open = !!searchQuery;

    const sum = document.createElement("summary");
    sum.textContent = title;

    sec.appendChild(sum);
    container.appendChild(sec);

    return sec;
  }

  flat.forEach(({ key, value, parent, path }) => {  

    if (!toggleOx.checked && path.includes("AIOx")) return;
    if (!toggleRun.checked && path.includes("RunningUnits")) return;

    const sectionName = Object.keys(activeSections || {}).find(s =>
    activeSections[s].includes(path)
    );

    if (sectionName && (!currentSection || currentSection.dataset.name !== sectionName)) {
      currentSection = startSection(sectionName);
      currentSection.dataset.name = sectionName;
    }

    const field = createField(key, value, parent);
    if (!field) return;

    if (activeGroupBreaks.includes(key)) {
      field.classList.add("sectionDivider");
    }

    if (currentSection) {
      currentSection.appendChild(field);
    } else {
      container.appendChild(field);
    }
  });
}

function render(){
  const c = document.getElementById("form");
  c.innerHTML = "";
  buildForm(data, c);
  updateHeaderInfo();
}

function expandAll() {
  document.querySelectorAll("#form details").forEach(d => {
    d.open = true;
  });
}

function collapseAll() {
  document.querySelectorAll("#form details").forEach(d => {
    d.open = false;
  });
}

function loadFromContent(content, path, options = {}) {
  data = JSON.parse(content);

  const unknownKeys = findUnknownKeys(activeTemplate, data);
  if (unknownKeys.length > 0) {
    alert("Unknown parameters found:\n\n" + unknownKeys.join("\n"));
  }

  data = renameKeysPreserveOrder(data);
  data = applyTemplateOrder(activeTemplate, data);

  mergeDefaults(data, activeTemplate);

  currentFilePath = path || null;
  currentFileReadOnly = Boolean(options.readOnly);

  if (!options.projectManaged) window.ucpLibrary?.detachCastleProject?.();

  const parts = String(currentFilePath || '').split(/[\\/]/);
  AIName = parts[parts.length - 2] || "";

  document.getElementById("aiName").textContent =
  AIName || "No Character Loaded";

render();
markCharacterSaved();
}

async function loadFile() {
  if (!await window.unsavedChanges?.confirmEditor('character', 'opening another Character file')) return false;
  const result = await window.electronAPI.openFile();
  if (!result) return false;

  const { content, path } = result;

  try {
    JSON.parse(content);
    const disposition = await window.ucpLibrary?.chooseDocumentDisposition?.('character', 'open') || 'separate';
    if (disposition === 'cancel') return false;
    if (disposition === 'project') {
      const added = await window.ucpLibrary.addCharacterDocument(content);
      if (!added) return false;
      loadFromContent(content, added.path, { projectManaged: true });
    } else {
      loadFromContent(content, path);
    }
  } catch (err) {
    alert(`Could not open Character file:\n\n${err.message}`);
    console.error(err);
    return false;
  }
  updateHeaderInfo();
  return true;
}

async function newCharacterFile() {
  if (!isInitialized) return false;
  if (!await window.unsavedChanges?.confirmEditor('character', 'creating a new Character')) return false;
  const disposition = await window.ucpLibrary?.chooseDocumentDisposition?.('character', 'new') || 'separate';
  if (disposition === 'cancel') return false;
  let projectPath = null;
  if (disposition === 'project') {
    const added = await window.ucpLibrary.addCharacterDocument(JSON.stringify(template, null, 2));
    if (!added) return false;
    projectPath = added.path;
  }
  activeTemplate = template;
  activeGroupBreaks = groupBreaks;
  activeSections = sections;
  data = JSON.parse(JSON.stringify(template));
  currentFilePath = projectPath;
  currentFileReadOnly = false;
  AIName = projectPath ? projectPath.split(/[\\/]/).slice(-2, -1)[0] || '' : '';
  searchQuery = '';
  document.getElementById('search').value = '';
  document.getElementById('toggleOx').checked = true;
  document.getElementById('toggleRun').checked = true;
  document.getElementById('aiName').textContent = AIName || 'No Character Loaded';
  setActiveTemplateButton('standard');
  if (disposition !== 'project') window.ucpLibrary?.detachCastleProject?.();
  render();
  markCharacterSaved();
  window.appWorkspace?.setStatus(projectPath ? 'New Character added to the loaded AI' : 'New Character');
  return true;
}

function renameKeysPreserveOrder(obj) {
  if (!obj || typeof obj !== "object") return obj;

  const newObj = {};

  for (const key of Object.keys(obj)) {
    let newKey = legacyKeyMap[key] || key;

    let value = obj[key];

    if (typeof value === "object" && value !== null) {
      value = renameKeysPreserveOrder(value);
    }

    if (!(newKey in newObj)) {
      newObj[newKey] = value;
    }
  }

  return newObj;
}

function applyTemplateOrder(activeTemplate, data) {
  if (typeof activeTemplate !== "object" || activeTemplate === null) {
    return data;
  }

  const result = {};

  for (const key of Object.keys(activeTemplate)) {
    if (data && key in data) {
      if (
        typeof activeTemplate[key] === "object" &&
        activeTemplate[key] !== null
      ) {
        result[key] = applyTemplateOrder(activeTemplate[key], data[key]);
      } else {
        result[key] = data[key];
      }
    } else {
      result[key] = JSON.parse(JSON.stringify(activeTemplate[key]));
    }
  }

  for (const key of Object.keys(data || {})) {
    if (!(key in result)) {
      result[key] = data[key];
    }
  }

  return result;
}

function findUnknownKeys(activeTemplate, data, path = "") {
  let unknown = [];

  if (!data || typeof data !== "object") return unknown;

  for (const key of Object.keys(data)) {
    const currentPath = path ? `${path}.${key}` : key;

    const isInTemplate = activeTemplate && key in activeTemplate;
    const isLegacyKey = key in legacyKeyMap;

    if (!isInTemplate && !isLegacyKey) {
      unknown.push(currentPath);
    }

    if (
      typeof data[key] === "object" &&
      data[key] !== null
    ) {
      const subTemplate = activeTemplate ? activeTemplate[key] : undefined;
      unknown.push(...findUnknownKeys(subTemplate, data[key], currentPath));
    }
  }

  return unknown;
}

function prepareOutputData() {
  let output = JSON.parse(JSON.stringify(data));

  if (!toggleOx.checked) {
    Object.keys(output.aic).forEach(k => {
      if (k.startsWith("AIOx")) delete output.aic[k];
    });
  }

  if (!toggleRun.checked) {
    Object.keys(output.aic).forEach(k => {
      if (k.startsWith("RunningUnits")) delete output.aic[k];
    });
  }

  return output;
}

function characterSnapshot() {
  return JSON.stringify(prepareOutputData());
}

function isCharacterDirty() {
  return savedCharacterSnapshot !== null && characterSnapshot() !== savedCharacterSnapshot;
}

function markCharacterSaved() {
  savedCharacterSnapshot = characterSnapshot();
  updateFilePathDisplay();
}

async function quickSaveFile() {
  const btn = document.getElementById("saveBtn");
  const originalText = btn.textContent;

  const output = JSON.stringify(prepareOutputData(), null, 2);

  if (!currentFilePath) {
    return saveFile();
  }

  
  btn.textContent = "Saving...";
  btn.disabled = true;

  try {
    await window.electronAPI.quickSaveFile({
    path: currentFilePath,
    content: output
    });

    markCharacterSaved();
    btn.textContent = "Saved!";

    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);
    return true;

  } catch (e) {
    console.error(e);
    btn.textContent = "Error!";
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 2000);
    return false;
  }
}

async function saveFile() {
  try {
    const output = prepareOutputData();
    const content = JSON.stringify(output, null, 2);
    const newPath = await window.electronAPI.saveFile(content);
    if (!newPath) return false;
    currentFilePath = newPath;
    currentFileReadOnly = false;
    markCharacterSaved();
    return true;
  } catch (err) {
    alert(`Could not save Character file:\n\n${err.message}`);
    console.error(err);
    return false;
  }
}

function updateFilePathDisplay() {
  const el = document.getElementById("filePath");
  document.getElementById("saveBtn").disabled = false;
  document.getElementById("saveAsBtn").disabled = false;
  const dirtyMarker = isCharacterDirty() ? " *" : "";
  const readOnlyMarker = currentFileReadOnly ? " [read-only]" : "";

  if (!currentFilePath) {
    el.textContent = `No file loaded${dirtyMarker}${readOnlyMarker}`;
    el.style.fontSize = "12px";
    return;
  }

  const parts = currentFilePath.split(/[\\/]/);
  const separator = currentFilePath.includes("\\") ? "\\" : "/";

  const lastParts = parts.length > 5 ? parts.slice(-5) : parts;
  const shortPath = parts.length > 5
    ? "..." + lastParts.join(separator)
    : currentFilePath;

  el.textContent = `${shortPath}${dirtyMarker}${readOnlyMarker}`;
  el.title = currentFilePath;
  el.style.fontSize = "12px";
}

function openNewWindow() {
  window.electronAPI.openNewWindow();
}

async function loadInWindow() {
  await window.electronAPI.loadFileInNewWindow();
}

window.electronAPI.onLoadFile(({ content, document, path, kind, source, sourceBytes }) => {
  if (kind === "aiv") {
    window.appWorkspace?.setActive("castle");
    window.castleEditor?.loadDocument(document, path, { source, sourceBytes });
    return;
  }

  if (!isInitialized) {
    pendingLoad = { content, path };
    return;
  }

  try {
    window.appWorkspace?.setActive("character");
    loadFromContent(content, path);
  } catch (err) {
    alert("Error while loading file:\n\n" + err.message);
    console.error(err);
  }
});

function toggleOxTethers() {
  const checkbox = document.getElementById("toggleOx");
  checkbox.checked = !checkbox.checked;
  render();
  updateFilePathDisplay();
}

function toggleRunningUnits() {
  const checkbox = document.getElementById("toggleRun");
  checkbox.checked = !checkbox.checked;
  render();
  updateFilePathDisplay();
}

function toggleSections() {
    const sections = document.querySelectorAll("#form details");
    const anyOpen = Array.from(sections).some(d => d.open);

    if (anyOpen) {
      collapseAll();
    } else {
      expandAll();
    }
  }

//for actual pop needed calc
let headerUpdatePending = false;
document.getElementById("availablePopulation").addEventListener("input", () => {
    if (headerUpdatePending) return;
    headerUpdatePending = true;
    requestAnimationFrame(() => {
        headerUpdatePending = false;
        updateHeaderInfo();
    });
});

document.getElementById("availablePopulation").addEventListener("change", event => {
    setAvailablePopulation(event.currentTarget.value);
});

function updateHeaderInfo() {

    document.getElementById("maxPopNeeded").textContent =
        calculateMaxPopNeeded();

    const stats = calculateActualPopNeeded();

    document.getElementById("actualPopNeeded").textContent =
        stats.population;

    document.getElementById("quarryCount").textContent =
        stats.quarries;

    document.getElementById("tetherCount").textContent =
        stats.oxTethers;

    document.getElementById("ironmineCount").textContent =
        stats.iron;

    document.getElementById("woodcutterCount").textContent =
        stats.wood;

    document.getElementById("pitchrigCount").textContent =
        stats.pitch;

    document.getElementById("farmCount").textContent =
        stats.farms;

    updateCharacterCastlePopulationInfo(undefined, stats);
    window.dispatchEvent(new CustomEvent("character-population-changed", {
      detail: {
        availablePopulation: getAvailablePopulationValue(),
        stats
      }
    }));
}

function calculateMaxPopNeeded() {

    if (!data || !data.aic) return 0;

    const a = data.aic;

    const woodcutters = Math.max(Number(a.MaxWoodcutters) || 0, 1);
    const ironmines   = Math.max(Number(a.MaxIronmines) || 0, 1);
    const quarries    = Math.max(Number(a.MaxQuarries) || 0, 1);
    const farms       = Math.max(Number(a.MaxFarms) || 0, 1);
    const pitchrigs   = Math.max(Number(a.MaxPitchrigs) || 0, 1);
 
    const option1 =
        (Number(a.AIOxTethers_MaximumOxTethersPerQuarry) || 0)
        * quarries;

    const option2 =
        (Number(a.AIOxTethers_DynamicMaxOxTethers) || 0)
        * quarries;

    const option3 =
        Number(a.AIOxTethers_MaxOxTethers) || 0;

    const oxTethers = Math.min(option1, option2, option3);

    return (
        quarries * 3 +
        ironmines * 2 +
        woodcutters +
        farms +
        pitchrigs +
        oxTethers
    );
}

function getQuarryLikeBuildings(pop, popPer, max) {
  
    pop     = Number(pop) || 0;
    popPer  = Math.max(Number(popPer) || 0, 1);
    max     = Math.max(Number(max) || 0, 1);

    const q = Math.floor(pop / popPer);

    if (q === 0)
        return 0;

    return Math.min(
        q + 1,
        max
    );
}

function getFarms(pop, popPer, max) {

    pop     = Number(pop) || 0;
    popPer  = Math.max(Number(popPer) || 0, 1);
    max     = Math.max(Number(max) || 0, 1);

    const q = Math.floor(pop / popPer);

    return Math.min(
        q + 1,
        max
    );
}

function getPitchRigs(pop, popPer, max) {

    pop     = Number(pop) || 0;
    popPer  = Math.max(Number(popPer) || 0, 1);
    max     = Math.max(Number(max) || 0, 1);

    const q = Math.floor(pop / popPer);

    return Math.min(
        q,
        max
    );
}

function calculateActualPopNeededAt(populationValue) {

    if (!data || !data.aic)
        return {
            quarries: 0,
            iron: 0,
            wood: 0,
            farms: 1,
            pitch: 0,
            oxTethers: 0,
            population: 1
        };

    const a = data.aic;
    const pop = Math.max(0, Number(populationValue) || 0);

    const quarries = getQuarryLikeBuildings(
        pop,
        a.PopulationPerQuarry,
        a.MaxQuarries
    );

    const iron = getQuarryLikeBuildings(
        pop,
        a.PopulationPerIronmine,
        a.MaxIronmines
    );

    const wood = getQuarryLikeBuildings(
        pop,
        a.PopulationPerWoodcutter,
        a.MaxWoodcutters
    );

    const farms = getFarms(
        pop,
        a.PopulationPerFarm,
        a.MaxFarms
    );

    const pitch = getPitchRigs(
        pop,
        a.PopulationPerPitchrig,
        a.MaxPitchrigs
    );

    const oxTethers = Math.min(
        quarries * (Number(a.AIOxTethers_MaximumOxTethersPerQuarry) || 0),
        quarries * (Number(a.AIOxTethers_DynamicMaxOxTethers) || 0),
        Number(a.AIOxTethers_MaxOxTethers) || 0
    );

    const population =
        quarries * 3 +
        iron * 2 +
        wood +
        farms +
        pitch +
        oxTethers;

    return {
        quarries,
        iron,
        wood,
        farms,
        pitch,
        oxTethers,
        population
    };
}

function calculateActualPopNeeded() {
    return calculateActualPopNeededAt(getAvailablePopulationValue());
}

function getAvailablePopulationValue() {
    return Math.max(10, Number(document.getElementById("availablePopulation").value) || 10);
}

function getCastlePopulationSummary() {
    return window.castleEditor?.getPopulationSummary?.() || { provided: 0, required: 0, left: 0 };
}

function updateCharacterCastlePopulationInfo(summary = getCastlePopulationSummary(), currentStats = null) {
    const provided = Number(summary?.provided) || 0;
    const left = Number(summary?.left) || 0;
    const castleRequired = Number(summary?.required) || 0;
    const availablePopulation = getAvailablePopulationValue();
    const characterNeeded = Number((currentStats || calculateActualPopNeededAt(availablePopulation)).population) || 0;
    const afterCastleAndCharacter = availablePopulation - castleRequired - characterNeeded;
    const providedEl = document.getElementById("castleProvidedForCharacter");
    const leftEl = document.getElementById("characterCastlePopulationLeft");
    const combinedLeftEl = document.getElementById("characterCastlePopulationAfterCharacter");
    if (providedEl) providedEl.textContent = String(provided);
    if (leftEl) {
      leftEl.textContent = String(left);
      leftEl.classList.toggle("populationNegative", left < 0);
    }
    if (combinedLeftEl) {
      combinedLeftEl.textContent = String(afterCastleAndCharacter);
      combinedLeftEl.classList.toggle("populationNegative", afterCastleAndCharacter < 0);
    }
}

function setAvailablePopulation(value) {
    const input = document.getElementById("availablePopulation");
    const numeric = Math.max(10, Math.round(Number(value) || 10));
    input.value = String(numeric);
    updateHeaderInfo();
}

window.characterPopulation = {
    getAvailablePopulation: getAvailablePopulationValue,
    getStats: calculateActualPopNeeded,
    calculateAt: calculateActualPopNeededAt,
    setAvailablePopulation,
    refresh: updateHeaderInfo
};

window.characterEditor = {
    openFile: loadFile,
    newFile: newCharacterFile,
    saveFile: quickSaveFile,
    saveAs: saveFile,
    loadFromContent,
    getContent: () => JSON.stringify(prepareOutputData(), null, 2) + "\n",
    isDirty: isCharacterDirty,
    getPath: () => currentFilePath,
    isReadOnly: () => currentFileReadOnly,
    markSaved: markCharacterSaved
};

document.getElementById("useCastlePopulationBtn").addEventListener("click", () => {
    const summary = getCastlePopulationSummary();
    setAvailablePopulation(summary.provided);
});

document.getElementById("populationMinusEight").addEventListener("click", () => {
    setAvailablePopulation(getAvailablePopulationValue() - 8);
});

document.getElementById("populationPlusEight").addEventListener("click", () => {
    setAvailablePopulation(getAvailablePopulationValue() + 8);
});

window.addEventListener("castle-population-changed", event => {
    updateCharacterCastlePopulationInfo(event.detail);
});

updateCharacterCastlePopulationInfo();
window.castleEditor?.refreshPopulation?.();

window.electronAPI.onTriggerLoad(() => {
  const active = window.appWorkspace?.getActive();
  if (active === "castle") window.castleEditor?.openFile();
  else if (active === "content") window.appWorkspace?.setStatus('Open an AI from the Library to edit its content');
  else if (active === "ucp") window.ucpLibrary?.chooseInstallation?.();
  else loadFile();
});

window.electronAPI.onTriggerNewDocument(() => {
  const active = window.appWorkspace?.getActive();
  if (active === 'castle') window.castleEditor?.newFile();
  else if (active === 'character') newCharacterFile();
});

window.electronAPI.onTriggerSave(() => {
  const active = window.appWorkspace?.getActive();
  if (active === "castle") window.castleEditor?.saveFile();
  else if (active === "content") window.aiContentEditor?.saveFile?.();
  else if (active === "ucp") window.ucpLibrary?.updateSelected?.();
  else quickSaveFile();
});

window.electronAPI.onTriggerSaveAs(() => {
  const active = window.appWorkspace?.getActive();
  if (active === "castle") window.castleEditor?.saveAs();
  else if (active === "content") window.aiContentEditor?.saveFile?.();
  else if (active === "ucp") window.ucpLibrary?.updateSelected?.();
  else saveFile();
});

window.electronAPI.onTriggerNewWindow(() => {
  openNewWindow();
});

window.electronAPI.onTriggerLoadInWindow(() => {
  const active = window.appWorkspace?.getActive();
  if (active === "castle") window.electronAPI.loadFileInNewWindow("aiv");
  else if (active === "content") window.appWorkspace?.setStatus('AI Content belongs to the loaded AI project');
  else if (active === "ucp") window.ucpLibrary?.openSelected?.();
  else loadInWindow();
});

window.electronAPI.onTriggerToggleOx(() => {
  toggleOxTethers();
});

window.electronAPI.onTriggerToggleRunning(() => {
  toggleRunningUnits();
});

window.electronAPI.onTriggerStandardOrder(() => {
  standardTemplate();
});

window.electronAPI.onTriggerOrderedOrder(() => {
  orderedTemplate();
});

window.electronAPI.onTriggerToggleSections(() => {
  toggleSections();
});

window.electronAPI.onTriggerWorkspace((workspace) => {
  window.appWorkspace?.setActive(workspace);
});

const characterWorkspace = document.getElementById("characterWorkspace");
const refreshCharacterDirtyDisplay = () => queueMicrotask(updateFilePathDisplay);
characterWorkspace.addEventListener("input", refreshCharacterDirtyDisplay);
characterWorkspace.addEventListener("change", refreshCharacterDirtyDisplay);

document.getElementById('characterOpenBtn').addEventListener('click', loadFile);
document.getElementById('saveBtn').addEventListener('click', quickSaveFile);
document.getElementById('saveAsBtn').addEventListener('click', saveFile);
document.getElementById('characterExpandAllBtn').addEventListener('click', expandAll);
document.getElementById('characterCollapseAllBtn').addEventListener('click', collapseAll);
document.getElementById('btnStandard').addEventListener('click', standardTemplate);
document.getElementById('btnOrdered').addEventListener('click', orderedTemplate);

toggleOx.onchange=render;
toggleRun.onchange=render;
