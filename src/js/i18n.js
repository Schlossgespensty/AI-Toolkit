(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(root, node ? require('i18next').createInstance() : root.i18next.createInstance(),
    node ? { registry: require('../locales/registry.json'), resources: require('../locales/en.json') } : root.toolkitLocaleBootstrap);
  root.toolkitI18n = api;
  if (node) module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis, (root, engine, bootstrap) => {
  'use strict';
  const { registry, resources } = bootstrap;
  let preference = 'system', generation = 0;
  const loaded = new Set(['en']);
  const listeners = new Set();
  const documents = new Set();
  const ownedText = new Map();
  const textCache = new Map();
  const numberFormats = new Map();
  const textElements = '[data-i18n], [data-bidi], input, textarea, select, option, button, label, p, h1, h2, h3, h4, span, strong, small, summary, th, td, dt, dd, div, code, kbd';
  const textInputTypes = new Set(['text', 'search', 'password', 'email', 'url', 'tel']);
  const literalInputTypes = new Set(['number', 'range', 'email', 'url', 'tel']);
  const isRtl = language => registry.languages.find(item => item.id === language)?.dir === 'rtl';
  engine.init({ lng: 'en', fallbackLng: 'en', supportedLngs: registry.languages.map(item => item.id),
    resources: { en: resources }, defaultNS: 'common', ns: Object.keys(resources), nsSeparator: ':', keySeparator: '.',
    initImmediate: false, initAsync: false, interpolation: { escapeValue: false }, returnNull: false });
  engine.services.formatter.add('bidi', isolateInterpolation);
  // Isolate inserted filenames, numbers and names from adjacent Persian text.
  // These Unicode isolates are the plain-text equivalent of <bdi>; source data
  // and editable values are never modified.
  function isolateInterpolation(value, language) {
    if (!isRtl(language) || value === '' || value == null) return value;
    const numeric = typeof value === 'number' || /^[\p{Decimal_Number}+\-\u2212.,\u066b\u066c%\u066a\s]+$/u.test(value);
    return (numeric ? '\u2066' : '\u2068') + value + '\u2069';
  }
  function isolateResourceArguments(resource) {
    if (typeof resource === 'string') {
      return resource.replace(/\{\{([^{}]+)\}\}/g, (_match, expression) => `{{${expression}, bidi}}`);
    }
    return Object.fromEntries(Object.entries(resource).map(([key, value]) => [key, isolateResourceArguments(value)]));
  }
  /** @param {import('./i18n-keys').TranslationKey} key @param {Record<string, unknown>} [options] */
  function t(key, options) {
    if (options) return engine.t(key, options);
    if (!textCache.has(key)) textCache.set(key, engine.t(key));
    return textCache.get(key);
  }
  function resolveLanguage(value, system = root.navigator?.language || 'en') {
    const requested = value === 'system' ? system : value;
    const normalized = String(requested || 'en').toLowerCase();
    return registry.languages.find(item => [item.id, ...(item.aliases || [])].some(alias => alias.toLowerCase() === normalized))?.id
      || registry.languages.find(item => [item.id, ...(item.aliases || [])].some(alias => alias.toLowerCase() === normalized.split('-')[0]))?.id || 'en';
  }
  /**
   * Dynamic content belongs to its editor, never to an initial HTML fallback.
   * @param {HTMLElement | null} element
   * @param {string | (() => string)} value
   * @param {'auto' | 'ltr'} [direction]
   */
  function bindText(element, value, direction = 'auto') {
    if (!element) return;
    if (element.dataset) {
      if (element.dataset.i18n) delete element.dataset.i18n;
      const bidi = direction === 'ltr' ? 'ltr' : 'text';
      if (element.dataset.bidi !== bidi) element.dataset.bidi = bidi;
    }
    if (typeof value === 'function') ownedText.set(element, value);
    else ownedText.delete(element);
    element.textContent = typeof value === 'function' ? value() : value;
    setTextDirection(element);
  }
  // Direction belongs to text, never to the editor's flex/grid/table layout.
  // Native dir=auto also follows the user's writing in text fields without an
  // input handler, extra characters in values, or changes to caret selection.
  function setTextDirection(element) {
    if (!element) return;
    const tag = element.tagName?.toLowerCase();
    const type = (element.type || 'text').toLowerCase();
    const literal = element.dataset?.bidi === 'ltr' || tag === 'code' || tag === 'kbd'
      || (tag === 'input' && (literalInputTypes.has(type) || element.readOnly || /^(?:numeric|decimal)$/.test(element.inputMode)));
    if (literal || tag === 'select' || tag === 'summary') {
      if (element.dir !== 'ltr') element.dir = 'ltr';
      return;
    }
    const editable = tag === 'textarea' || (tag === 'input' && textInputTypes.has(type));
    if (tag === 'input' && !editable) return;
    if (editable || element.dataset?.bidi === 'text'
      || (!element.childElementCount && (element.textContent?.trim() || element.dataset?.i18n))) {
      if ((!editable || !element.dir) && element.dir !== 'auto') element.dir = 'auto';
      if (element.classList && !element.classList.contains('i18nText')) element.classList.add('i18nText');
    }
  }
  function applyTextDirection(container = root.document) {
    if (!container?.querySelectorAll) return;
    if (container.matches?.(textElements)) setTextDirection(container);
    for (const element of container.querySelectorAll(textElements)) setTextDirection(element);
  }
  function applyBindings(container = root.document) {
    if (!container?.querySelectorAll) return;
    const nodes = [...(container.matches?.('[data-i18n], [data-i18n-attrs]') ? [container] : []), ...container.querySelectorAll('[data-i18n], [data-i18n-attrs]')];
    for (const element of nodes) {
      if (element.dataset.i18n) element.textContent = t(element.dataset.i18n);
      for (const binding of (element.dataset.i18nAttrs || '').split(';').filter(Boolean)) {
        const colon = binding.indexOf('=');
        if (colon !== -1) element.setAttribute(binding.slice(0, colon), t(binding.slice(colon + 1)));
      }
    }
    applyTextDirection(container);
  }
  function updateDocument(document, locale) {
    if (!document) return;
    document.documentElement.lang = locale;
    // All languages share the same editor pane, tab, tool and world ordering.
    document.documentElement.dir = 'ltr';
    applyBindings(document);
  }
  async function changeLanguage(value, { persist = true } = {}) {
    const revision = ++generation, locale = resolveLanguage(value);
    if (!loaded.has(locale)) {
      const response = await fetch(new URL(`../locales/${locale}.json`, scriptUrl));
      if (!response.ok) throw new Error(`Could not load interface language ${locale}: ${response.status}`);
      const namespaces = await response.json();
      // Format interpolation runs once at load time through i18next's standard
      // formatter chain; plural counts and saved catalogue strings stay intact.
      for (const [namespace, values] of Object.entries(namespaces)) {
        engine.addResourceBundle(locale, namespace, isRtl(locale) ? isolateResourceArguments(values) : values, true, true);
      }
      loaded.add(locale);
    }
    if (revision !== generation) return;
    await engine.changeLanguage(locale);
    if (revision !== generation) return;
    textCache.clear();
    numberFormats.clear();
    preference = value;
    updateDocument(root.document, locale);
    for (const win of documents) {
      if (win.closed) { documents.delete(win); continue; }
      updateDocument(win.document, locale);
    }
    for (const [element, render] of ownedText) {
      if (element.isConnected === false) { ownedText.delete(element); continue; }
      element.textContent = render();
      setTextDirection(element);
    }
    for (const listener of listeners) listener(locale);
    applyTextDirection(root.document);
    for (const win of documents) if (!win.closed) applyTextDirection(win.document);
    root.dispatchEvent?.(new CustomEvent('toolkit-language-changed', { detail: { language: preference, locale } }));
    if (persist) await root.electronAPI?.setLanguage?.(value);
  }
  const scriptUrl = root.document?.currentScript?.src || 'http://localhost/src/js/i18n.js';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  function number(value, options) {
    const key = options ? JSON.stringify(options) : '';
    if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat(engine.resolvedLanguage || 'en', options));
    return numberFormats.get(key).format(value);
  }
  function attachWindow(win) {
    documents.add(win);
    updateDocument(win.document, api.locale);
    const detach = () => documents.delete(win);
    win.addEventListener('unload', detach, { once: true });
    return detach;
  }
  const api = { t, html: (key, options) => escapeHtml(t(key, options)), resolveLanguage, applyBindings, changeLanguage,
    attachWindow, bindText, applyTextDirection,
    get locale() { return engine.resolvedLanguage || 'en'; },
    get language() { return engine.resolvedLanguage || 'en'; },
    get preference() { return preference; },
    languages: registry.languages, number,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }, engine };
  api.ready = (async () => {
    if (!root.document) return;
    if (root.document.readyState === 'loading') await new Promise(resolve => root.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    const settings = await root.electronAPI?.getInterfaceSettings?.();
    await changeLanguage(settings?.language || 'system', { persist: false });
    root.electronAPI?.onLanguageChanged?.(settings => changeLanguage(typeof settings === 'string' ? settings : settings.language, { persist: false }));
  })();
  return api;
});
