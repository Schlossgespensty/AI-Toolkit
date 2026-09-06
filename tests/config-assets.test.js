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

test('every visible AIV item has a picture: its own, or the first piece of its recipe', () => {
  const constants = readJson('config/aiv_constants.json');
  const skinDir = path.join(root, 'assets', 'aiv', 'skins');
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  for (const [id, info] of Object.entries(constants)) {
    if (info.name === 'Dummy Step') continue;
    // An item with a lineSequence is a recipe: it is never placed itself,
    // it is drawn as a run of the real pieces it names, and the palette
    // shows the picture of the FIRST of them (see the check below). A file
    // under the recipe's own number would never be looked at, so the file
    // that has to be there is the piece's.
    const shown = Array.isArray(info.lineSequence) && info.lineSequence.length
      ? String(info.lineSequence[0])
      : id;
    const filePath = path.join(skinDir, `${shown}.png`);
    assert.ok(fs.existsSync(filePath),
      `missing skin for ${info.name} [${id}]` + (shown === id ? '' : ` - shown as ${shown}`));
    const signature = fs.readFileSync(filePath).subarray(0, 8);
    assert.deepEqual(signature, pngSignature, `invalid PNG for ${info.name} [${id}]`);
  }
});

test('and that exception is the rule the editor really follows', () => {
  // The test above lets a recipe borrow a picture. That is only allowed
  // because the palette does exactly this - if that line ever changes, the
  // exception has to go with it, so it is pinned here.
  const script = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  assert.match(script, /const thumbnailType = String\(sequence\[0\] \?\? id\)/);
});

test('Character editor implementation is loaded from its external script', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/character-editor\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>\s*let isInitialized/);
  assert.ok(fs.statSync(path.join(root, 'src', 'js', 'character-editor.js')).size > 0);
});
