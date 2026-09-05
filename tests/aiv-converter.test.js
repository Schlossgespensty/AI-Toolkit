const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const test = require('node:test');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const converter = path.join(root, 'plugins', 'aivconverter.exe');

function comparable(value) {
  return {
    pauseDelayAmount: Number(value?.pauseDelayAmount) || 0,
    frames: (value?.frames || []).filter(frame => (
      frame && Number.isInteger(Number(frame.itemType)) &&
      Array.isArray(frame.tilePositionOfsets) && frame.tilePositionOfsets.length > 0
    )).map(frame => ({
      itemType: Number(frame.itemType),
      tilePositionOfsets: (frame.tilePositionOfsets || []).map(Number),
      shouldPause: Boolean(frame.shouldPause)
    })),
    miscItems: (value?.miscItems || []).map(item => ({
      positionOfset: Number(item.positionOfset),
      itemType: Number(item.itemType),
      number: Number(item.number)
    }))
  };
}

test('converter preserves editor data through JSON -> AIV -> JSON', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(converter)) {
    t.skip('Bundled Windows converter is unavailable on this platform.');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-converter-test-'));
  const sourcePath = path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aivjson');
  const jsonPath = path.join(tempDir, 'castle.aivjson');
  const aivPath = path.join(tempDir, 'castle.aiv');
  try {
    fs.copyFileSync(sourcePath, jsonPath);
    await execFileAsync(converter, [jsonPath, aivPath], {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    assert.ok(fs.statSync(aivPath).size > 0);

    const { stdout } = await execFileAsync(converter, [aivPath, '-'], {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    const before = comparable(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    const after = comparable(JSON.parse(stdout));
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('converter creates the blank Castle 1 used by a new AI', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(converter)) {
    t.skip('Bundled Windows converter is unavailable on this platform.');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-empty-castle-test-'));
  const jsonPath = path.join(tempDir, 'castle1.aivjson');
  const aivPath = path.join(tempDir, 'castle1.aiv');
  const blank = {
    pauseDelayAmount: 100,
    frames: [{ itemType: 61, tilePositionOfsets: [4950], shouldPause: false }],
    miscItems: []
  };
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(blank, null, 2));
    await execFileAsync(converter, [jsonPath, aivPath], {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    assert.ok(fs.statSync(aivPath).size > 0);
    const { stdout } = await execFileAsync(converter, [aivPath, '-'], {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    assert.deepEqual(comparable(JSON.parse(stdout)), blank);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('all Hyaene castles open after legacy empty steps are compacted', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(converter)) {
    t.skip('Bundled Windows converter is unavailable on this platform.');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv-legacy-test-'));
  const originalDir = path.join(tempDir, 'original');
  const roundTripDir = path.join(tempDir, 'roundtrip');
  const checkDir = path.join(tempDir, 'check');
  fs.mkdirSync(originalDir);
  fs.mkdirSync(roundTripDir);
  fs.mkdirSync(checkDir);

  try {
    const sourceDir = path.join(root, 'examples', 'Hyaene', 'aiv');
    const names = fs.readdirSync(sourceDir).filter(name => name.endsWith('.aiv')).sort();
    assert.equal(names.length, 8);

    const originalAivPaths = names.map(name => {
      const target = path.join(originalDir, name);
      fs.copyFileSync(path.join(sourceDir, name), target);
      return target;
    });
    await execFileAsync(converter, originalAivPaths, {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });

    const expected = new Map();
    const compactJsonPaths = names.map(name => {
      const jsonName = name.replace(/\.aiv$/i, '.aivjson');
      const document = JSON.parse(fs.readFileSync(path.join(originalDir, jsonName), 'utf8'));
      const emptySteps = document.frames.length - comparable(document).frames.length;
      assert.ok(emptySteps > 0, `${name} should contain legacy empty steps`);
      const compact = comparable(document);
      expected.set(name, compact);
      const target = path.join(roundTripDir, jsonName);
      fs.writeFileSync(target, JSON.stringify(compact, null, 2));
      return target;
    });

    await execFileAsync(converter, compactJsonPaths, {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });

    const checkAivPaths = names.map(name => {
      const target = path.join(checkDir, name);
      fs.copyFileSync(path.join(roundTripDir, name), target);
      return target;
    });
    await execFileAsync(converter, checkAivPaths, {
      cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });

    for (const name of names) {
      const jsonName = name.replace(/\.aiv$/i, '.aivjson');
      const reopened = JSON.parse(fs.readFileSync(path.join(checkDir, jsonName), 'utf8'));
      assert.deepEqual(comparable(reopened), expected.get(name), name);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
