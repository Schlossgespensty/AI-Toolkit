'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {OFFICIAL, createReleaseChecker} = require('../src/node/release-updates');

const fork = 'Krarilotus/AI-Toolkit';
const sourceCode = fs.readFileSync(path.join(__dirname, '../src/js/release-updates.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
function element() {
  const classes = new Set(), events = new Map();
  return {
    textContent: '', title: '', disabled: false, value: '', options: [],
    classList: {contains: name => classes.has(name), remove: (...names) => names.forEach(name => classes.delete(name)), toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)},
    addEventListener: (name, callback) => events.set(name, callback),
    dispatch: (name, event = {}) => events.get(name)?.(event),
    add(option) {this.options.push(option);},
    replaceChildren() {this.options = [];},
    querySelector(selector) {const value = selector.match(/value="([^"]+)"/)?.[1]; return this.options.find(option => option.value === value) || null;},
    querySelectorAll() {return this.options;},
  };
}
async function renderer(api, confirmAll = async () => true) {
  const ids = ['releaseUpdateButton', 'releaseSourceSelect', 'releaseSourceDialog', 'releaseSourceCancel', 'releaseSourceForm', 'releaseSourceRepo', 'releaseSourceError'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const i18n = {t: (key, values) => key.includes('install_value') ? `Install ${values.latest || values.version}` : key, onChange() {}};
  const window = {electronAPI: api, toolkitI18n: i18n, unsavedChanges: {confirmAll}, appWorkspace: {setStatus() {}}};
  vm.runInNewContext(sourceCode, {window, toolkitI18n: i18n, document: {getElementById: id => elements[id], createElement: element}, Date, setTimeout() {}});
  for (let i = 0; i < 20 && elements.releaseUpdateButton.disabled; i++) await turn();
  await turn();
  return {button: elements.releaseUpdateButton, select: elements.releaseSourceSelect};
}

test('a failed install retry refreshes a cached old release before another download', async () => {
  const release = (id, tag, date) => ({id, tag_name: tag, published_at: date, prerelease: true, draft: false, assets: [{id: id * 10, name: `AI-Toolkit-${tag}.zip`, size: 100, digest: `sha256:${String(id).repeat(64)}`}]});
  const old = release(2, 'old-native-without-asar', '2026-09-22T19:00:00Z');
  const newest = release(3, 'native-migration-package', '2026-09-22T20:16:00Z');
  let releases = [old], requests = 0;
  const request = async url => ({ok: true, json: async () => {
    requests++;
    if (url.includes(`${OFFICIAL}/releases?`)) return [{id: 1, tag_name: 'stable', published_at: '2026-09-01T00:00:00Z', assets: []}];
    if (url.includes('/releases?')) return releases;
    return {fork: true, full_name: fork, source: {full_name: OFFICIAL}};
  }});
  const check = createReleaseChecker(null, request, () => Date.parse('2026-09-22T20:32:00Z'));
  const checks = [], prepared = []; let installed = 0;
  const api = {
    listUpdateSources: async () => ({selected: fork, repos: [OFFICIAL, fork]}),
    checkReleaseUpdate: force => {checks.push(force); return check({repo: fork, force});},
    prepareReleaseUpdate: async key => {
      const build = await check({repo: fork}); prepared.push(build);
      assert.equal(build.key, key);
      if (build.latest === old.tag_name) throw Error('Incomplete Windows release.');
      return {version: build.latest, key};
    },
    installReleaseUpdate: async () => {installed++;},
  };
  const {button, select} = await renderer(api);
  assert.equal(button.textContent, `Install ${old.tag_name}`);
  releases = [newest, old];
  const cachedRequests = requests;
  await button.dispatch('click');
  assert.equal(requests, cachedRequests, 'First install uses the old checker result still cached within the hour');
  assert.match(button.title, /Incomplete Windows release/);
  assert.equal(button.classList.contains('releaseAvailable'), false);
  assert.equal(button.disabled, false); assert.equal(select.disabled, false);

  await button.dispatch('click');
  assert.deepEqual(checks, [false, true]);
  assert.equal(prepared.length, 1, 'Retry only refreshes; it cannot silently download the newly discovered release');
  assert.equal(button.textContent, `Install ${newest.tag_name}`);
  assert.equal(button.classList.contains('releaseAvailable'), true);
  await button.dispatch('click');
  assert.deepEqual(prepared.map(build => build.latest), [old.tag_name, newest.tag_name]);
  assert.equal(installed, 1);
});

test('busy clicks stay ignored and unsaved-work cancellation retains the prepared build', async () => {
  const build = {status: 'available', repo: fork, key: 'verified-build', latest: 'snapshot-current'};
  let finishPreparation, prepares = 0, installs = 0, confirmations = 0;
  const checks = [];
  const api = {
    listUpdateSources: async () => ({selected: fork, repos: [OFFICIAL, fork]}),
    checkReleaseUpdate: async force => {checks.push(force); return build;},
    prepareReleaseUpdate: async key => {
      assert.equal(key, build.key); prepares++;
      if (prepares === 1) await new Promise(resolve => {finishPreparation = resolve;});
      return {version: build.latest, key};
    },
    installReleaseUpdate: async () => {installs++;},
  };
  const {button, select} = await renderer(api, async () => ++confirmations > 1);
  const firstClick = button.dispatch('click');
  await turn();
  assert.equal(button.disabled, true); assert.equal(select.disabled, true);
  await button.dispatch('click'); assert.equal(prepares, 1);
  finishPreparation(); await firstClick;
  assert.equal(installs, 0); assert.equal(button.textContent, `Install ${build.latest}`);
  assert.equal(button.classList.contains('releaseAvailable'), true);
  await button.dispatch('click');
  assert.equal(prepares, 2); assert.equal(installs, 1);
  assert.deepEqual(checks, [false], 'Cancel keeps the verified build available without forcing a refresh');
});
