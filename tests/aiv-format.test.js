const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

const categories = readJson('config/aiv_categories.json').categories;
const constants = readJson('config/aiv_constants.json');
const sample = readJson('examples/Castle.aivjson');
const unitCategory = Object.entries(categories).find(([name]) => name.toLowerCase() === 'units');
const unitIds = new Set((unitCategory?.[1] || []).map(Number));

test('every configured unit is a capped, freely overlapping rallypoint', () => {
  assert.equal(unitIds.size, 21);
  for (const type of unitIds) {
    assert.equal(constants[String(type)].overlap, 'allow', `unit ${type} overlap`);
    assert.equal(constants[String(type)].maxAmount, 10, `unit ${type} maxAmount`);
  }
});

test('sample keeps units out of the ordered build frames', () => {
  const unitFrames = sample.frames.filter(frame => unitIds.has(Number(frame.itemType)));
  assert.deepEqual(unitFrames, []);
});

test('sample rallypoints use miscItems and sequential per-type numbering', () => {
  const expectedNumber = new Map();
  for (const [index, item] of sample.miscItems.entries()) {
    const type = Number(item.itemType);
    assert.ok(unitIds.has(type), `miscItems[${index}] is not a configured unit`);
    const expected = expectedNumber.get(type) || 0;
    assert.equal(item.number, expected, `miscItems[${index}] numbering`);
    assert.ok(item.positionOfset >= 0 && item.positionOfset <= 9999);
    expectedNumber.set(type, expected + 1);
  }

  for (const [type, count] of expectedNumber) {
    assert.ok(count <= constants[String(type)].maxAmount, `unit ${type} exceeds maxAmount`);
  }
});

test('sample build data remains unchanged in scale and pause behavior', () => {
  const placements = sample.frames.reduce((total, frame) => total + frame.tilePositionOfsets.length, 0);
  assert.equal(sample.frames.length, 504);
  assert.equal(placements, 661);
  assert.equal(sample.miscItems.length, 31);
  assert.ok(sample.frames.every(frame => frame.shouldPause === false));
});
