const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

test('every AIV item has valid dimensions and exactly one category', () => {
  const constants = readJson('config/aiv_constants.json');
  const categories = readJson('config/aiv_categories.json').categories;
  const assignments = new Map();

  for (const [category, ids] of Object.entries(categories)) {
    for (const id of ids) {
      const key = String(id);
      if (!assignments.has(key)) assignments.set(key, []);
      assignments.get(key).push(category);
    }
  }

  for (const [id, info] of Object.entries(constants)) {
    assert.equal(Array.isArray(info.size), true, `item ${id} size`);
    assert.equal(info.size.length, 2, `item ${id} size dimensions`);
    assert.ok(info.size.every(value => Number(value) > 0), `item ${id} positive size`);
    assert.equal(assignments.get(id)?.length, 1, `item ${id} category assignments`);
  }
});

test('every visible AIV item has a valid bundled PNG skin', () => {
  const constants = readJson('config/aiv_constants.json');
  const skinDir = path.join(root, 'assets', 'aiv', 'skins');
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  for (const [id, info] of Object.entries(constants)) {
    if (info.name === 'Dummy Step') continue;
    const filePath = path.join(skinDir, `${id}.png`);
    assert.ok(fs.existsSync(filePath), `missing skin for ${info.name} [${id}]`);
    const signature = fs.readFileSync(filePath).subarray(0, 8);
    assert.deepEqual(signature, pngSignature, `invalid PNG for ${info.name} [${id}]`);
  }
});

test('Character editor implementation is loaded from its external script', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/character-editor\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>\s*let isInitialized/);
  assert.ok(fs.statSync(path.join(root, 'src', 'js', 'character-editor.js')).size > 0);
});
