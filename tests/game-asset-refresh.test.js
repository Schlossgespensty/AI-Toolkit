'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/js/castle-editor'), 'utf8');

function harness() {
  const requests = [];
  const state = { skins: {} };
  let decodes = 0, buildingLoads = 0;
  const context = vm.createContext({ state, loadSkinImages: () => decodes++,
    renderPalette() {}, updateSelectedItemInfo() {}, scheduleDraw() {},
    window: { electronAPI: { loadAivSkins: () => new Promise(resolve => requests.push(resolve)) },
      isoView: { reloadGameAssets: async () => buildingLoads++ } } });
  vm.runInContext(source.slice(source.indexOf('  function applyLoadedSkins('), source.indexOf('  async function setSkin(')), context);
  return { context, requests, state, get decodes() { return decodes; }, get buildingLoads() { return buildingLoads; } };
}

test('game/folder refresh reuses unchanged sprites but adopts texture-pack revisions', () => {
  const h = harness();
  h.context.applyLoadedSkins({ skins: { 6: 'asset://revision1/archer.png' } });
  h.context.applyLoadedSkins({ skins: { 6: 'asset://revision1/archer.png' } });
  assert.equal(h.decodes, 1);
  h.context.applyLoadedSkins({ skins: { 6: 'asset://revision2/archer.png' }, customSkinTypes: ['6'] });
  assert.equal(h.decodes, 2);
  assert.ok(h.state.customSkinTypes.has('6'));
});

test('a late previous installation response cannot replace the selected game sprites', async () => {
  const h = harness();
  const first = h.context.reloadGameAssets(), latest = h.context.reloadGameAssets();
  h.requests[1]({ skins: { 6: 'asset://selected/archer.png' } });
  await latest;
  h.requests[0]({ skins: { 6: 'asset://previous/archer.png' } });
  await first;
  assert.equal(h.state.skins[6], 'asset://selected/archer.png');
  assert.equal(h.decodes, 1);
  assert.equal(h.buildingLoads, 2);
});
