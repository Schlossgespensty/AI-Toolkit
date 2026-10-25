/* Theme data -> native CSS variables. Layout and accessibility stay in shared CSS. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ToolkitTheme = api;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', () => api.init(), { once: true });
    else api.init();
  }
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const BUILTINS = Object.freeze([{ id: 'default', name: 'Default' }, { id: 'ucp', name: 'UCP' }]);
  const SLOTS = Object.freeze(['control', 'controlHover', 'controlPressed', 'panel', 'panelSurface', 'ornament', 'checkbox', 'checkboxChecked', 'sidebar', 'backdrop', "tab", "tabActive", "input", "value", "dropdown", "outline", "rangeTrack", "rangeStart", "rangeEnd", "rangeThumb", "rangeThumbActive", "scrollTrack", "scrollThumb", "moveUp", "moveUpHover", "moveUpPressed", "moveDown", "moveDownHover", "moveDownPressed", "add", "addHover", "remove", "removeHover"]);
  const IDENTIFIER = /^[a-z][a-z0-9-]{0,47}$/;
  const STORAGE_KEY = 'ai-toolkit-theme';
  const hyphenate = value => value.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());

  /** Validate the intentionally small manifest; token interpretation belongs to Style Dictionary. */
  function validateManifest(value, expectedId) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || !IDENTIFIER.test(value.id) || (expectedId && value.id !== expectedId)) throw new Error('Invalid theme manifest identity');
    const keys = ['schemaVersion', 'id', 'name', 'version', 'extends', 'variables', 'colorScheme', 'controlWeight', 'textures', 'attribution'];
    if (Object.keys(value).some(key => !keys.includes(key)) || (value.extends && value.extends !== 'default') || value.variables !== 'variables.css' || !['dark', 'light'].includes(value.colorScheme) || ![undefined, 'bold', 'regular'].includes(value.controlWeight)) throw new Error('Unsupported theme manifest');
    if (typeof value.name !== 'string' || !value.name || value.name.length > 80 || typeof value.version !== 'string' || !value.version || value.version.length > 40) throw new Error('Invalid theme metadata');
    if (!Array.isArray(value.attribution) || value.attribution.some(entry => !entry || ['author', 'scope', 'permission'].some(key => typeof entry[key] !== 'string'))) throw new Error('Missing theme attribution');
    if (!value.textures || typeof value.textures !== 'object' || Array.isArray(value.textures)) throw new Error('Invalid theme textures');
    for (const [slot, texture] of Object.entries(value.textures)) {
      if (!SLOTS.includes(slot) || !texture || Object.keys(texture).some(key => !['file', 'mode', 'slice', 'width', 'fill'].includes(key))) throw new Error('Unknown theme texture slot');
      if (!/^textures\/[a-zA-Z0-9_/-]+\.(png|webp|svg)$/.test(texture.file) || texture.file.includes('//') || !['frame', 'tile', 'cover', 'contain'].includes(texture.mode)) throw new Error('Unsafe theme texture path or mode');
      if (texture.mode === 'frame' && (!Number.isInteger(texture.slice) || texture.slice < 1 || texture.slice > 64 || !Number.isFinite(texture.width) || texture.width < 1 || texture.width > 32)) throw new Error('Invalid texture frame');
      if (texture.fill !== undefined && typeof texture.fill !== 'boolean') throw new Error('Invalid texture frame fill');
    }
    return value;
  }

  /** CSSOM does the parsing; packs may only supply known variable declarations, never selectors. */
  function readVariables(css, allowedNames, CSSSheet = root.CSSStyleSheet) {
    if (typeof css !== 'string' || css.length > 65536 || /@|url\s*\(|expression\s*\(|[<>\\]/i.test(css)) throw new Error('Theme variables contain unsupported CSS');
    const sheet = new CSSSheet();
    sheet.replaceSync(css);
    if (sheet.cssRules.length !== 1 || sheet.cssRules[0].selectorText !== ':root') throw new Error('Theme variables must contain one :root declaration');
    const declaration = sheet.cssRules[0].style;
    const values = {};
    for (let i = 0; i < declaration.length; i++) {
      const name = declaration[i];
      if (!/^--(?:primitive|semantic|component)-[a-z0-9-]+$/.test(name) || (allowedNames && !allowedNames.has(name))) throw new Error('Unknown theme variable: ' + name);
      if (declaration.getPropertyPriority(name)) throw new Error('Theme variables cannot override CSS priority');
      const value = declaration.getPropertyValue(name).trim();
      for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) if (allowedNames && !allowedNames.has(match[1])) throw new Error('Unknown theme variable reference');
      values[name] = value;
    }
    if (!Object.keys(values).length) throw new Error('Empty theme variables');
    return values;
  }

  function createController(environment = root) {
    const document = environment.document;
    const scriptBase = document ? new URL('../', document.currentScript?.src || new URL('js/theme.js', document.baseURI)).href : '';
    const themeBase = scriptBase ? new URL('../assets/themes/', scriptBase).href : '';
    const packs = new Map(BUILTINS.map(pack => [pack.id, { ...pack, baseUrl: new URL(pack.id + '/', themeBase || 'file:///themes/').href }]));
    const loaded = new Map();
    const windows = new Set();
    const listeners = new Set();
    let current = null;
    let generation = 0;
    let initialized;
    let allowedNames;
    if (document) windows.add(environment);

    async function read(url, type) {
      const response = await environment.fetch(url);
      if (!response.ok) throw new Error('Cannot load theme file: ' + url);
      return response[type]();
    }

    async function textureValue(texture, baseUrl) {
      const url = new URL(texture.file, baseUrl).href;
      if (typeof environment.Image === 'function') {
        const image = new environment.Image();
        image.src = url;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 16384 || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > 64000000) throw new Error('Theme texture dimensions exceed the limit');
      }
      return { ...texture, url };
    }

    function load(id) {
      if (loaded.has(id)) return loaded.get(id);
      const entry = packs.get(id);
      if (!entry) return Promise.reject(new Error('Unknown theme: ' + id));
      const pending = (async () => {
        const [raw, css] = await Promise.all([read(new URL('theme.json', entry.baseUrl), 'json'), read(new URL('variables.css', entry.baseUrl), 'text')]);
        const manifest = validateManifest(raw, id);
        const inherited = id === 'default' ? null : await load('default');
        const variables = { ...inherited?.variables, ...readVariables(css, allowedNames, environment.CSSStyleSheet) };
        if (id === 'default') allowedNames = new Set(Object.keys(variables));
        const textures = { ...inherited?.textures };
        await Promise.all(Object.entries(manifest.textures).map(async ([slot, texture]) => {
          try { textures[slot] = await textureValue(texture, entry.baseUrl); }
          catch (error) { environment.console?.warn('Theme texture unavailable; using its default:', slot, error); }
        }));
        for (const [base, states] of Object.entries({ control: ['Hover', 'Pressed'], tab: ['Active'], moveUp: ['Hover', 'Pressed'], moveDown: ['Hover', 'Pressed'], add: ['Hover'], remove: ['Hover'], rangeThumb: ['Active'] })) {
          if (textures[base]) for (const state of states) textures[base + state] ||= textures[base];
        }
        return { ...manifest, variables, textures };
      })();
      loaded.set(id, pending);
      pending.catch(() => loaded.delete(id));
      return pending;
    }

    function applyToWindow(win, pack) {
      if (win.closed) { windows.delete(win); return; }
      const element = win.document.documentElement;
      for (const [name, value] of Object.entries(pack.variables)) element.style.setProperty(name, value);
      for (const slot of SLOTS) {
        const texture = pack.textures[slot];
        const name = '--texture-' + hyphenate(slot);
        element.style.setProperty(name, texture ? `url("${texture.url.replaceAll('"', '%22')}")` : 'none');
        element.style.setProperty(name + '-slice', texture?.mode === 'frame' ? String(texture.slice) + (texture.fill ? ' fill' : '') : '0');
        // The frame alone, for controls that must paint their own middle.
        element.style.setProperty(name + '-edge-slice', texture?.mode === 'frame' ? String(texture.slice) : '0');
        element.style.setProperty(name + '-width', texture?.mode === 'frame' ? texture.width + 'px' : '0px');
        element.style.setProperty(name + '-repeat', texture?.mode === 'tile' ? 'repeat' : 'no-repeat');
        element.style.setProperty(name + '-size', texture?.mode === 'tile' ? 'auto' : texture?.mode === 'cover' ? 'cover' : 'contain');
      }
      element.dataset.theme = pack.id;
      element.dataset.controlWeight = pack.controlWeight || 'bold';
      element.dataset.themedControls = pack.textures.control ? 'true' : 'false';
      element.dataset.themedCheckboxes = pack.textures.checkbox && pack.textures.checkboxChecked ? 'true' : 'false';
      // Optional artwork changes paint only for roles that have a complete set.
      const roles = { Panels: ['panel', 'panelSurface'], Tabs: ['tab', 'tabActive'], Fields: ['input', 'value', 'dropdown'], Reorder: ['moveUp', 'moveDown'], Stepper: ['add', 'remove'], Range: ['rangeTrack', 'rangeThumb'], Scrollbars: ['scrollTrack', 'scrollThumb'] };
      for (const [role, slots] of Object.entries(roles)) element.dataset['themed' + role] = slots.every(slot => pack.textures[slot]) ? 'true' : 'false';
      element.style.colorScheme = pack.colorScheme;
      win.dispatchEvent?.(new win.CustomEvent('toolkit-theme-changed', { detail: { id: pack.id } }));
    }

    async function refresh() {
      const registered = await environment.electronAPI?.listThemes?.();
      for (const entry of registered || []) if (IDENTIFIER.test(entry.id) && entry.baseUrl && !packs.has(entry.id)) {
        const url = new URL(entry.baseUrl);
        const local = ['file:', 'asset:', 'tauri:'].includes(url.protocol) || (['http:', 'https:'].includes(url.protocol) && ['asset.localhost', 'tauri.localhost', 'localhost', '127.0.0.1'].includes(url.hostname));
        if (local) packs.set(entry.id, { id: entry.id, name: String(entry.name || entry.id), baseUrl: url.href.replace(/\/?$/, '/') });
      }
    }

    async function apply(id) {
      const request = ++generation;
      if (!packs.has(id)) await refresh();
      const pack = await load(packs.has(id) ? id : 'default');
      if (request !== generation) return current;
      current = pack;
      for (const win of windows) applyToWindow(win, pack);
      for (const listener of listeners) listener(pack.id);
      return pack;
    }

    async function select(id) {
      if (!packs.has(id)) await refresh();
      if (!packs.has(id)) throw new Error('Unknown theme: ' + id);
      await apply(id);
      const bridge = environment.electronAPI;
      if (bridge?.setTheme) await bridge.setTheme(id);
      else try { environment.localStorage?.setItem(STORAGE_KEY, id); } catch (_) { /* Private browser storage. */ }
      return id;
    }

    function attachWindow(win) {
      if (!win?.document || windows.has(win)) return;
      windows.add(win);
      const link = win.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('css/theme-detached.css', scriptBase).href;
      win.document.head.appendChild(link);
      if (current) applyToWindow(win, current);
      win.addEventListener?.('unload', () => windows.delete(win), { once: true });
    }

    function init() {
      if (initialized) return initialized;
      initialized = (async () => {
        const bridge = environment.electronAPI;
        let preference = 'default';
        try { preference = environment.localStorage?.getItem(STORAGE_KEY) || preference; } catch (_) { /* Storage optional. */ }
        try {
          const settings = await bridge?.getInterfaceSettings?.();
          preference = settings?.theme || preference;
          await refresh();
        } catch (error) { environment.console?.warn('Theme settings unavailable:', error); }
        bridge?.onThemeChanged?.(value => apply(typeof value === 'string' ? value : value?.theme || 'default').catch(error => environment.console?.warn('Theme switch failed:', error)));
        environment.addEventListener?.('storage', event => {
          if (!bridge?.setTheme && event.key === STORAGE_KEY) apply(event.newValue || 'default').catch(() => {});
        });
        try { await apply(preference); }
        catch (error) { environment.console?.warn('Theme unavailable; using Default:', error); await apply('default'); }
        return current;
      })();
      return initialized;
    }

    return {
      init, select, apply, attachWindow, refresh,
      list: () => [...packs.values()].map(({ id, name }) => ({ id, name })),
      get current() { return current?.id || 'default'; },
      texture: slot => current?.textures[slot]?.url || null,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
  }
  return Object.assign(createController(root), { validateManifest, readVariables, createController });
});
