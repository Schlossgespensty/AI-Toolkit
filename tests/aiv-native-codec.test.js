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

function sampleDocument() {
  return {
    pauseDelayAmount: 100,
    frames: [
      { itemType: 61, tilePositionOfsets: [4950], shouldPause: false },
      { itemType: 25, tilePositionOfsets: [4949], shouldPause: true },
      { itemType: 25, tilePositionOfsets: [5049], shouldPause: false }
    ],
    miscItems: [{ positionOfset: 5050, itemType: 0, number: 0 }]
  };
}

test('native codec returns the original bytes when an opened castle is unchanged', async () => {
  const codec = await codecPromise;
  const source = Buffer.from(codec.encodeAiv(sampleDocument(), templates));
  const document = codec.parseAiv(source);
  const output = codec.encodeAiv(document, templates, { source, unchanged: true });
  assert.equal(Buffer.from(output).equals(source), true);
});

test('native edits preserve untouched source sections and directory metadata', async () => {
  const codec = await codecPromise;
  const source = Buffer.from(codec.encodeAiv(sampleDocument(), templates));
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

test('native codec creates a new binary AIV without a source file', async () => {
  const codec = await codecPromise;
  const document = sampleDocument();
  const output = codec.encodeAiv(document, templates);
  const reopened = codec.parseAiv(output);
  assert.deepEqual(comparable(reopened), comparable(document));
});
