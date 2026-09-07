const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('castle saving uses the native binary codec without an AIVJSON detour', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const aivFile = fs.readFileSync(path.join(root, 'src', 'node', 'aiv-file.js'), 'utf8');
  const castleEditor = fs.readFileSync(path.join(root, 'src', 'js', 'castle-editor.js'), 'utf8');
  const start = main.indexOf('async function writeAivDocument');
  const end = main.indexOf('function placeholderPortrait', start);
  assert.ok(start >= 0 && end > start);
  const saveConversion = main.slice(start, end);
  assert.match(saveConversion, /writeNativeAiv/);
  assert.match(aivFile, /codec\.encodeAiv/);
  assert.match(aivFile, /atomicWriteFile/);
  assert.doesNotMatch(saveConversion, /aivconverter|aivjson|execFile|roundTrip/i);
  assert.doesNotMatch(aivFile, /aivconverter|aivjson|execFile|roundTrip/i);
  assert.match(castleEditor, /content:\s*outputDocument\(\)/);
  assert.match(castleEditor, /sourceBytes:\s*state\.sourceBytes/);
  assert.match(castleEditor, /state\.sourceBytes\s*=\s*retainSourceBytes\(result\.sourceBytes\)/);
  assert.doesNotMatch(castleEditor, /content:\s*outputContent\(\),\s*kind:\s*'aiv'/);
});

test('packaged runtime no longer depends on the legacy project plugins folder', () => {
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.equal(fs.existsSync(path.join(root, 'config', 'aiv_templates.json')), true);
  assert.equal(packageJson.build.extraFiles.some(entry => entry.from === 'plugins'), false);
  assert.doesNotMatch(main, /projectRoot\(\),\s*'plugins'/);
});

test('saving does not treat the encoder as if it returned a promise', () => {
  // writeNativeAiv ist SYNCHRON. Ein .then() daran wirft
  // "writeNativeAiv(...).then is not a function" - und dann geht weder
  // Speichern noch Schnellspeichern. Genau das ist am 07.09.2026 passiert,
  // gemeldet von Monsterfish aus der ausgelieferten Fassung.
  const geber = fs.readFileSync(path.join(root, 'src', 'node', 'aiv-file.js'), 'utf8');
  const quelle = geber.slice(geber.indexOf('function writeNativeAiv'));
  assert.ok(!/^async function writeNativeAiv/m.test(quelle),
    'writeNativeAiv gibt ein Ergebnis zurueck, kein Versprechen');

  const haupt = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const stelle = haupt.slice(haupt.indexOf('async function writeAivDocument'),
                             haupt.indexOf('function placeholderPortrait'));
  assert.ok(!/writeNativeAiv\([\s\S]*?\}\)\s*\.then/.test(stelle),
    'kein .then an writeNativeAiv');
  assert.match(stelle, /const ergebnis = writeNativeAiv\(/);
  assert.match(stelle, /if \(locks !== null\) writeLockSidecar\(destination, locks\);/,
    'die Sperr-Begleitdatei wird trotzdem geschrieben');
});
