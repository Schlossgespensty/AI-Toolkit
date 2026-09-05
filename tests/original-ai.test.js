const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const geometry = require('../src/js/castle-geometry');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const aiRoot = path.join(root, 'examples', 'TheMeridian');
const aivRoot = path.join(aiRoot, 'aiv');
const constants = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_constants.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_categories.json'), 'utf8')).categories;
const gameData = JSON.parse(fs.readFileSync(path.join(root, 'config', 'aiv_gamedata.json'), 'utf8')).population_effects;
const template = JSON.parse(fs.readFileSync(path.join(root, 'config', 'template.json'), 'utf8'));
const character = JSON.parse(fs.readFileSync(path.join(aiRoot, 'character.json'), 'utf8'));
const castle = JSON.parse(fs.readFileSync(path.join(aivRoot, 'the_meridian.aivjson'), 'utf8'));
const unitTypes = new Set((categories.Units || []).map(Number));

function footprint(type, itemOffset) {
  const x = itemOffset % 100;
  const y = Math.floor(itemOffset / 100);
  return geometry.footprintRectsAtXY(type, x, y, constants[String(type)]?.size || [1, 1]);
}

function validateClearanceAndCollisions(document) {
  const occupied = [];
  const bounds = { left: 99, bottom: 99, right: 0, top: 0 };
  for (const frame of document.frames) {
    assert.equal(unitTypes.has(Number(frame.itemType)), false);
    assert.equal(frame.shouldPause, false);
    for (const itemOffset of frame.tilePositionOfsets) {
      const rects = footprint(Number(frame.itemType), Number(itemOffset));
      const itemBounds = geometry.footprintBounds(rects);
      bounds.left = Math.min(bounds.left, itemBounds.left);
      bounds.bottom = Math.min(bounds.bottom, itemBounds.bottom);
      bounds.right = Math.max(bounds.right, itemBounds.right);
      bounds.top = Math.max(bounds.top, itemBounds.top);
      assert.ok(itemBounds.left >= 14 && itemBounds.bottom >= 14);
      assert.ok(itemBounds.right <= 85 && itemBounds.top <= 85);
      for (const previous of occupied) assert.equal(geometry.footprintsIntersect(rects, previous), false);
      occupied.push(rects);
    }
  }
  return bounds;
}

test('The Meridian Character is complete and internally coherent', () => {
  assert.deepEqual(Object.keys(character).sort(), Object.keys(template).sort());
  assert.deepEqual(Object.keys(character.aic).sort(), Object.keys(template.aic).sort());
  for (const mode of ['normal', 'crusader', 'deathmatch']) {
    assert.deepEqual(Object.keys(character.startTroops[mode]).sort(), Object.keys(template.startTroops[mode]).sort());
  }
  assert.equal(character.aic.FletcherSetting, 'Crossbows');
  assert.equal(character.aic.PoleturnerSetting, 'Pikes');
  assert.equal(character.aic.BlacksmithSetting, 'Maces');
  assert.equal(character.aic.TargetChoice, 'Balanced');
  assert.equal(character.aic.RecruitProbDefDefault + character.aic.RecruitProbRaidDefault + character.aic.RecruitProbAttackDefault, 100);
  assert.equal(character.aic.RecruitProbDefWeak + character.aic.RecruitProbRaidWeak + character.aic.RecruitProbAttackWeak, 100);
  assert.equal(character.aic.RecruitProbDefStrong + character.aic.RecruitProbRaidStrong + character.aic.RecruitProbAttackStrong, 100);
});

test('Compass Hold has clear borders, no physical overlaps, and valid rallypoints', () => {
  assert.equal(castle.frames.length, 76);
  assert.equal(castle.frames.reduce((total, frame) => total + frame.tilePositionOfsets.length, 0), 861);
  assert.equal(castle.miscItems.length, 30);
  assert.deepEqual(validateClearanceAndCollisions(castle), { left: 17, bottom: 17, right: 82, top: 82 });

  const nextNumber = new Map();
  for (const item of castle.miscItems) {
    assert.ok(unitTypes.has(Number(item.itemType)));
    const expected = nextNumber.get(Number(item.itemType)) || 0;
    assert.equal(item.number, expected);
    const x = item.positionOfset % 100;
    const y = Math.floor(item.positionOfset / 100);
    assert.ok(x >= 14 && x <= 85 && y >= 14 && y <= 85);
    nextNumber.set(Number(item.itemType), expected + 1);
  }

  const counts = new Map();
  for (const frame of castle.frames) counts.set(String(frame.itemType), (counts.get(String(frame.itemType)) || 0) + frame.tilePositionOfsets.length);
  const provided = [...counts].reduce((total, [type, count]) => total + (Number(gameData.provides[type]) || 0) * count, 0);
  const required = [...counts].reduce((total, [type, count]) => total + (Number(gameData.requires[type]) || 0) * count, 0);
  assert.equal(provided, 90);
  assert.equal(required, 19);
});

test('The Meridian binary AIV reopens with the intended structure', async t => {
  const converter = path.join(root, 'plugins', 'aivconverter.exe');
  if (process.platform !== 'win32' || !fs.existsSync(converter)) {
    t.skip('Bundled Windows converter is unavailable on this platform.');
    return;
  }
  const aivPath = path.join(aivRoot, 'the_meridian.aiv');
  assert.ok(fs.statSync(aivPath).size > 0);
  const { stdout } = await execFileAsync(converter, [aivPath, '-'], {
    cwd: path.dirname(converter), windowsHide: true, maxBuffer: 32 * 1024 * 1024
  });
  const reopened = JSON.parse(stdout);
  assert.equal(reopened.frames.length, 76);
  assert.equal(reopened.frames.reduce((total, frame) => total + frame.tilePositionOfsets.length, 0), 861);
  assert.equal(reopened.miscItems.length, 30);
  assert.deepEqual(validateClearanceAndCollisions(reopened), { left: 17, bottom: 17, right: 82, top: 82 });
});
