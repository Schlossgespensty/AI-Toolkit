const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const codecPromise = import('../src/node/aiv-codec.mjs');
const templates = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_templates.json'), 'utf8'));

function comparable(document) {
  return {
    pauseDelayAmount: Number(document.pauseDelayAmount) || 0,
    frames: (document.frames || []).map(frame => ({
      itemType: Number(frame.itemType),
      tilePositionOfsets: frame.tilePositionOfsets.map(Number),
      shouldPause: Boolean(frame.shouldPause)
    })),
    miscItems: (document.miscItems || []).map(item => ({
      positionOfset: Number(item.positionOfset),
      itemType: Number(item.itemType),
      number: Number(item.number)
    }))
  };
}

function collectAivFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) collectAivFiles(candidate, output);
    else if (/\.aiv$/i.test(entry.name)) output.push(candidate);
  }
  return output;
}

test('native codec returns the original bytes when an opened castle is unchanged', async () => {
  const codec = await codecPromise;
  const source = fs.readFileSync(path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aiv'));
  const document = codec.parseAiv(source);
  const output = codec.encodeAiv(document, templates, { source, unchanged: true });
  assert.equal(Buffer.from(output).equals(source), true);
});

test('native edits preserve untouched source sections and directory metadata', async () => {
  const codec = await codecPromise;
  const source = fs.readFileSync(path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aiv'));
  const document = codec.parseAiv(source);
  document.pauseDelayAmount += 1;
  document.frames[0].shouldPause = !document.frames[0].shouldPause;
  const output = codec.encodeAiv(document, templates, { source });
  const reopened = codec.parseAiv(output);
  assert.equal(reopened.pauseDelayAmount, document.pauseDelayAmount);
  assert.equal(reopened.frames[0].shouldPause, document.frames[0].shouldPause);
  assert.deepEqual(comparable(reopened), comparable(document));

  const before = codec.internals.readDirectory(source);
  const after = codec.internals.readDirectory(output);
  assert.equal(after.version, before.version);
  assert.equal(Buffer.from(after.directoryBytes.slice(12, 32)).equals(Buffer.from(before.directoryBytes.slice(12, 32))), true);
  assert.equal(Buffer.from(after.directoryBytes.slice(-4)).equals(Buffer.from(before.directoryBytes.slice(-4))), true);
  for (const id of [2001, 2002, 2003, 2006, 2010]) {
    const originalSection = before.entries.find(entry => entry.id === id);
    const savedSection = after.entries.find(entry => entry.id === id);
    assert.ok(originalSection && savedSection, `section ${id} is missing`);
    assert.equal(Buffer.from(savedSection.packed).equals(Buffer.from(originalSection.packed)), true, `section ${id} changed`);
  }
});

test('native codec opens and rewrites every legacy Hyaene castle', async () => {
  const codec = await codecPromise;
  const aivRoot = path.join(root, 'examples', 'Hyaene', 'aiv');
  const files = fs.readdirSync(aivRoot).filter(name => /\.aiv$/i.test(name)).sort();
  assert.equal(files.length, 8);
  for (const fileName of files) {
    const source = fs.readFileSync(path.join(aivRoot, fileName));
    const document = codec.parseAiv(source);
    const output = codec.encodeAiv(document, templates, { source });
    const reopened = codec.parseAiv(output);
    assert.ok(reopened.frames.length > 0, `${fileName} has no frames after native save`);
    assert.deepEqual(comparable(reopened), comparable(document), fileName);
  }
});

test('native codec opens every binary AIV in the reference library', async () => {
  const codec = await codecPromise;
  const files = collectAivFiles(path.join(root, 'examples'));
  assert.ok(files.length >= 294);
  for (const filePath of files) {
    const document = codec.parseAiv(fs.readFileSync(filePath));
    assert.ok(Array.isArray(document.frames), filePath);
    assert.ok(Array.isArray(document.miscItems), filePath);
  }
});

test('native codec creates a new binary AIV without a source file', async () => {
  const codec = await codecPromise;
  const document = {
    pauseDelayAmount: 100,
    frames: [{ itemType: 61, tilePositionOfsets: [4950], shouldPause: false }],
    miscItems: [{ positionOfset: 5050, itemType: 0, number: 0 }]
  };
  const output = codec.encodeAiv(document, templates);
  const reopened = codec.parseAiv(output);
  assert.deepEqual(comparable(reopened), comparable(document));
});
