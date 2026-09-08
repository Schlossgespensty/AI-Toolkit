const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

const categories = readJson('config/aiv_categories.json').categories;
const constants = readJson('config/aiv_constants.json');
const unitCategory = Object.entries(categories).find(([name]) => name.toLowerCase() === 'units');
const unitIds = new Set((unitCategory?.[1] || []).map(Number));

test('every configured unit is a capped, freely overlapping rallypoint', () => {
  assert.equal(unitIds.size, 21);
  for (const type of unitIds) {
    assert.equal(constants[String(type)].overlap, 'allow', `unit ${type} overlap`);
    assert.ok(Number.isInteger(constants[String(type)].maxAmount), `unit ${type} maxAmount integer`);
    assert.ok(constants[String(type)].maxAmount >= 1 && constants[String(type)].maxAmount <= 10,
      `unit ${type} maxAmount cap`);
  }
});
