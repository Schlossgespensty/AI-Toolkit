'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const source = read('src/js/character-editor.js');
const template = JSON.parse(read('config/template.json'));
const legacyKeyMap = JSON.parse(read('config/legacyKeyMap.json'));
// The first 169 AIC fields of the template are the game's indexes 0-168.
const standardNames = Object.keys(template.aic).slice(0, 169);

test('every UnknownNNN name is read as the standard AIC field with that index', () => {
  assert.equal(standardNames.at(-1), 'TargetChoice');
  // Fixed points from the UCP aicloader field index.
  for (const [index, name] of [[0, 'WallDecoration'], [40, 'AIRequestDelay'], [124, 'RaidRetargetDelay'], [130, 'AttAssaultDelay'], [146, 'AttUnitVanguard']])
    assert.equal(standardNames[index], name);
  standardNames.forEach((name, index) => {
    const unknown = `Unknown${String(index).padStart(3, '0')}`;
    assert.equal(legacyKeyMap[unknown] || unknown, name, unknown);
  });
  for (const [old, name] of Object.entries(legacyKeyMap)) assert.ok(name in template.aic, `${old} -> ${name}`);
});

test('a character written with UnknownNNN names loads without warnings under the standard names', () => {
  const start = source.indexOf('function renameKeysPreserveOrder(');
  const context = vm.createContext({legacyKeyMap});
  vm.runInContext(source.slice(start, source.indexOf('function applyTemplateOrder(', start)), context);
  vm.runInContext(source.slice(source.indexOf('function findUnknownKeys('), source.indexOf('function omitInheritedTroopFields(')), context);
  const character = {aic: {Unknown040: 3000, Unknown124: 900, Unknown001: 1, TaxesMin: 2, Mystery: 1}};
  assert.deepEqual([...context.findUnknownKeys(template, character)], ['aic.Mystery']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.renameKeysPreserveOrder(character))),
    {aic: {AIRequestDelay: 3000, RaidRetargetDelay: 900, Unknown001: 1, TaxesMin: 2, Mystery: 1}});
});
