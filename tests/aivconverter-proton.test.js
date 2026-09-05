const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'dist', 'aivconverter-proton', 'aivconverter.exe');
const correctedReference = path.join(root, 'plugins', 'aivconverter.exe');

function comparable(value) {
  return {
    pauseDelayAmount: Number(value?.pauseDelayAmount) || 0,
    frames: (value?.frames || []).filter(frame => (
      frame && Number.isFinite(Number(frame.itemType)) &&
      Array.isArray(frame.tilePositionOfsets) && frame.tilePositionOfsets.length > 0
    )).map(frame => ({
      itemType: Number(frame.itemType),
      tilePositionOfsets: frame.tilePositionOfsets.map(Number),
      shouldPause: Boolean(frame.shouldPause)
    })),
    miscItems: (value?.miscItems || []).map(item => ({
      positionOfset: Number(item.positionOfset),
      itemType: Number(item.itemType),
      number: Number(item.number)
    }))
  };
}

test('standalone converter EXE is self-contained and preserves editor data', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(executable)) {
    t.skip('The built Windows converter is unavailable on this platform.');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv converter proton '));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const inputJson = path.join(temporary, 'castle input.aivjson');
  const outputAiv = path.join(temporary, 'castle output.aiv');
  fs.copyFileSync(path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aivjson'), inputJson);

  const toAiv = await execFileAsync(executable, [inputJson, outputAiv], {
    cwd: temporary,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  assert.match(toAiv.stderr, /Successfully created/);
  assert.ok(fs.statSync(outputAiv).size > 0);

  const toJson = await execFileAsync(executable, [outputAiv, '-'], {
    cwd: temporary,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  const before = comparable(JSON.parse(fs.readFileSync(inputJson, 'utf8')));
  const after = comparable(JSON.parse(toJson.stdout));
  assert.deepEqual(after, before);
});

test('standalone converter EXE supports drag-and-drop style batch input', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(executable)) {
    t.skip('The built Windows converter is unavailable on this platform.');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv converter batch '));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const inputs = ['one.aiv', 'two.aiv'].map((name, index) => {
    const destination = path.join(temporary, name);
    fs.copyFileSync(path.join(root, 'examples', 'Hyaene', 'aiv', `Hyaene${index + 1}.aiv`), destination);
    return destination;
  });

  await execFileAsync(executable, inputs, {
    cwd: temporary,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  for (const input of inputs) {
    const output = input.replace(/\.aiv$/i, '.aivjson');
    const document = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.ok(document.frames.length > 0);
    assert.ok(document.frames.some(frame => frame?.tilePositionOfsets?.length > 0));
  }
});

test('Proton runtime build matches the corrected reference converter', async t => {
  if (process.platform !== 'win32' || !fs.existsSync(executable) || !fs.existsSync(correctedReference)) {
    t.skip('Both Windows converter builds are required for comparison.');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aiv converter parity '));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const sourceAiv = path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aiv');
  const sourceJson = path.join(root, 'examples', 'Jeanne', 'aiv', 'jeanne1.aivjson');
  const protonJson = path.join(temporary, 'proton.aivjson');
  const referenceJson = path.join(temporary, 'reference.aivjson');
  const protonAiv = path.join(temporary, 'proton.aiv');
  const referenceAiv = path.join(temporary, 'reference.aiv');
  const options = { windowsHide: true, maxBuffer: 32 * 1024 * 1024 };

  await execFileAsync(executable, [sourceAiv, protonJson], { ...options, cwd: path.dirname(executable) });
  await execFileAsync(correctedReference, [sourceAiv, referenceJson], { ...options, cwd: path.dirname(correctedReference) });
  assert.deepEqual(JSON.parse(fs.readFileSync(protonJson, 'utf8')), JSON.parse(fs.readFileSync(referenceJson, 'utf8')));

  await execFileAsync(executable, [sourceJson, protonAiv], { ...options, cwd: path.dirname(executable) });
  await execFileAsync(correctedReference, [sourceJson, referenceAiv], { ...options, cwd: path.dirname(correctedReference) });
  assert.equal(fs.readFileSync(protonAiv).equals(fs.readFileSync(referenceAiv)), true);
});
