const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeNativeAiv } = require('../src/node/aiv-file');

const root = path.resolve(__dirname, '..');
const codecPromise = import('../src/node/aiv-codec.mjs');
const templates = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_templates.json'), 'utf8'));
const atomicWriteFile = (destination, content) => fs.writeFileSync(destination, content);

test('saves an edited castle from its in-memory binary after the original disappears', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-memory-save-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const codec = await codecPromise;
  const sourcePath = path.join(temporary, 'castle.aiv');
  const original = fs.readFileSync(path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aiv'));
  fs.writeFileSync(sourcePath, original);
  const document = codec.parseAiv(original);
  document.pauseDelayAmount += 7;
  fs.unlinkSync(sourcePath);

  const saved = writeNativeAiv({
    codec,
    document,
    destination: sourcePath,
    templates,
    atomicWriteFile,
    sourcePath,
    sourceBytes: Uint8Array.from(original)
  });

  assert.equal(saved.sourceOrigin, 'memory');
  assert.equal(saved.preservedSource, true);
  assert.ok(saved.sourceBytes instanceof Uint8Array);
  assert.equal(codec.parseAiv(fs.readFileSync(sourcePath)).pauseDelayAmount, document.pauseDelayAmount);
});

test('builds a fresh native castle when neither source path nor cached bytes remain', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-fallback-save-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const codec = await codecPromise;
  const destination = path.join(temporary, 'recovered.aiv');
  const document = {
    pauseDelayAmount: 100,
    frames: [{ itemType: 61, tilePositionOfsets: [5643], shouldPause: false }],
    miscItems: []
  };

  const saved = writeNativeAiv({
    codec,
    document,
    destination,
    templates,
    atomicWriteFile,
    sourcePath: path.join(temporary, 'missing-original.aiv')
  });

  assert.equal(saved.sourceOrigin, null);
  assert.equal(saved.preservedSource, false);
  assert.deepEqual(codec.parseAiv(fs.readFileSync(destination)).frames, document.frames);
});
