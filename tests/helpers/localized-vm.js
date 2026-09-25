'use strict';
// Renderer unit fixtures use the same English catalog and translation engine as
// the application. Extracted-function tests therefore exercise actual messages,
// rather than depending on hard-coded English literals in implementation files.
const vm = require('node:vm');
const toolkitI18n = require('../../src/js/i18n');
function localized(sandbox = {}) {
  sandbox.toolkitI18n ??= toolkitI18n;
  sandbox.tr ??= toolkitI18n.t;
  sandbox.trCharacter ??= toolkitI18n.t;
  if (sandbox.window) sandbox.window.toolkitI18n ??= toolkitI18n;
  if (sandbox.globalThis && sandbox.globalThis !== sandbox) sandbox.globalThis.toolkitI18n ??= toolkitI18n;
  // Status setters accept a render callback so their text can follow language
  // changes. Fixture spies observe the rendered message, as the real DOM does.
  for (const name of ['setStatus', 'changed']) {
    const callback = sandbox[name];
    if (typeof callback === 'function') sandbox[name] = (message, ...args) => callback(
      typeof message === 'function' ? message() : message, ...args,
    );
  }
  return sandbox;
}
module.exports = { ...vm,
  createContext: (sandbox, ...options) => vm.createContext(localized(sandbox), ...options),
  runInNewContext: (code, sandbox, ...options) => vm.runInNewContext(code, localized(sandbox), ...options)
};
