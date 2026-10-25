const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

const categories = readJson('config/aiv_categories.json').categories;
const constants = readJson('config/aiv_constants.json');
const unitIds = new Set(Object.entries(constants).filter(([, item]) => item.kind === 'unit').map(([id]) => Number(id)));

test('every configured unit is a capped, freely overlapping rallypoint', () => {
  assert.equal(unitIds.size, 29);
  for (const type of unitIds) {
    assert.equal(constants[String(type)].overlap, 'allow', `unit ${type} overlap`);
    assert.ok(Number.isInteger(constants[String(type)].maxAmount), `unit ${type} maxAmount integer`);
    const native=type>9000?type-9000:type;
    const expanded=(native>=6&&native<=19)||(native>=22&&native<=28);
    assert.equal(constants[String(type)].maxAmount,expanded?30:type===1?9:10,
      `unit ${type} maxAmount cap`);
  }
});
