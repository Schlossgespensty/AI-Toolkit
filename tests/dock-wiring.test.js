// How the docking is wired into the app, checked by reading the files.
//
// None of this needs a screen, and every one of these tests stands for a
// mistake that only shows up when the app is already running: a panel in the
// wrong grid cell, a rule that only made it into one of the two stylesheets,
// a hidden attribute that quietly beats the layout, a drag that measures a
// different box than the one it draws.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const html = read('src', 'index.html');
const isoView = read('src', 'js', 'iso-view.js');
const dockView = read('src', 'js', 'dock-view.js');
const editor = read('src', 'js', 'castle-editor.js');
const shell = read('src', 'js', 'app-shell.js');
const pkg = JSON.parse(read('package.json'));

const cssDir = path.join(root, 'src', 'css');
// Every stylesheet that carries the castle column, not two file names: a
// third copy of the theme must not be able to slip past this.
const stylesheets = fs.readdirSync(cssDir)
  .filter(name => name.endsWith('.css'))
  .map(name => ({ name, text: fs.readFileSync(path.join(cssDir, name), 'utf8') }))
  .filter(sheet => sheet.text.includes('.castleCanvasColumn'));

// the closing tag has to be the one after the opening tag: the page has more
// than one <main>
const columnStart = html.indexOf('<main class="castleCanvasColumn"');
const column = html.slice(columnStart, html.indexOf('</main>', columnStart));

// ------------------------------------------------------------------ html

test('at least two stylesheets carry the castle column', () => {
  assert.ok(stylesheets.length >= 2, `found ${stylesheets.length}: ${stylesheets.map(s => s.name)}`);
});

test('map, panel, overlay and status bar are all children of the one column', () => {
  for (const id of ['castleCanvasHost', 'isoDockSplitter', 'isoDockPanel', 'castleDockOverlay'])
    assert.ok(column.includes(`id="${id}"`), `#${id} is not inside the castle column`);
  assert.ok(column.includes('class="castleStatusBar"'), 'the status bar stays in the column');
});

test('the source order is map, splitter, panel, overlay, status bar', () => {
  const at = needle => {
    const index = column.indexOf(needle);
    assert.ok(index > 0, 'not found: ' + needle);
    return index;
  };
  const order = [
    at('id="castleCanvasHost"'),
    at('id="isoDockSplitter"'),
    at('id="isoDockPanel"'),
    at('id="castleDockOverlay"'),
    at('class="castleStatusBar"')
  ];
  for (let i = 1; i < order.length; i++)
    assert.ok(order[i - 1] < order[i], 'element ' + i + ' comes too early');
});

test('every element the docking needs exists', () => {
  const ids = ['castleCanvasColumn', 'isoDockSplitter', 'isoDockPanel', 'isoDockGrip',
               'isoDockBody', 'isoDockCanvas', 'isoDockStatus', 'isoFitBtn', 'isoPopOutBtn',
               'isoDockCloseBtn', 'castleDockOverlay', 'castleDockPreview', 'castleDockHint'];
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `the html is missing #${id}`);
  for (const side of ['top', 'right', 'bottom', 'left'])
    assert.ok(html.includes(`data-zone="${side}"`), `no drop zone for ${side}`);
});

test('the panel carries no hidden attribute — data-dock alone decides', () => {
  const tag = html.slice(html.indexOf('<aside id="isoDockPanel"'));
  const opening = tag.slice(0, tag.indexOf('>'));
  assert.ok(!/\bhidden\b/.test(opening),
    'hidden brings its own display:none and would beat the grid layout');
  assert.ok(html.includes('data-dock="off"'), 'the column starts without a dock');
});

test('the overlay is hidden by visibility, never by display', () => {
  // It is the rectangle every zone, every preview and every drop is measured
  // against. With display:none that rectangle is 0 by 0, the bands would be
  // invisible and no drop could ever hit a side.
  const tag = html.slice(html.indexOf('<div id="castleDockOverlay"'));
  const opening = tag.slice(0, tag.indexOf('>'));
  assert.ok(!/\bhidden\b(?!=)/.test(opening.replace(/aria-hidden="[^"]*"/g, '')),
    'the overlay must not carry the hidden attribute');
  assert.ok(!dockView.includes('overlay.hidden'), 'and dock-view must not set it either');
  for (const { name, text } of stylesheets) {
    assert.ok(/\.dockOverlay\s*\{[^}]*visibility:\s*hidden/.test(text), `${name}: no resting state`);
    assert.ok(/\.dockOverlay\.showing\s*\{[^}]*visibility:\s*visible/.test(text), `${name}: no shown state`);
  }
});

test('the toolbar button says what it does and shows whether it is on', () => {
  const tag = html.slice(html.indexOf('<button id="castleIsoBtn"'));
  const opening = tag.slice(0, tag.indexOf('>'));
  assert.ok(opening.includes('aria-pressed'), 'the button needs a pressed state');
  assert.ok(/dock/i.test(opening), 'the title has to mention docking');
});

test('the scripts load in the order they depend on each other', () => {
  const at = file => html.indexOf('js/' + file);
  for (const file of ['iso-geometry.js', 'iso-view.js', 'dock-geometry.js', 'dock-model.js', 'dock-view.js'])
    assert.ok(at(file) > 0, file + ' is not included');
  const order = ['iso-geometry.js', 'iso-view.js', 'dock-geometry.js', 'dock-model.js', 'dock-view.js'].map(at);
  for (let i = 1; i < order.length; i++)
    assert.ok(order[i - 1] < order[i], 'script ' + i + ' is loaded too early');
});

// ------------------------------------------------------------------- css

test('every stylesheet knows all five layouts', () => {
  for (const { name, text } of stylesheets) {
    for (const side of ['off', 'left', 'right', 'top', 'bottom'])
      assert.ok(text.includes(`[data-dock="${side}"]`), `${name} has no rule for data-dock="${side}"`);
    assert.ok(/\.castleCanvasColumn\s*\{[^}]*position:\s*relative/.test(text),
      `${name}: the column has to be the containing block of the overlay`);
    assert.ok(/\[data-dock="off"\][^{]*\.dockPanel[^{]*\{[^}]*display:\s*none/.test(text),
      `${name}: nothing hides the panel when it is switched off`);
  }
});

test('the overlay never takes a click, and the grip never scrolls the page', () => {
  for (const { name, text } of stylesheets) {
    assert.ok(/\.dockOverlay\s*\{[^}]*pointer-events:\s*none/.test(text),
      `${name}: the overlay would swallow clicks meant for the map`);
    assert.ok(/\.dockGrip\s*\{[^}]*touch-action:\s*none/.test(text),
      `${name}: a touch drag on the grip would scroll instead of move`);
  }
});

test('the overlay ends exactly where the status bar begins', () => {
  // The overlay rectangle is what dock-geometry measures. If it covered the
  // status bar too, the bottom zone would be drawn over a bar it can never
  // reach, and the drop would land somewhere else than the preview showed.
  for (const { name, text } of stylesheets) {
    const bar = text.match(/"bar"\s+(\d+)px/);
    const overlay = text.match(/\.dockOverlay\s*\{[^}]*bottom:\s*(\d+)px/);
    assert.ok(bar && overlay, `${name}: cannot find both heights`);
    assert.equal(overlay[1], bar[1], `${name}: overlay stops at ${overlay[1]}, bar is ${bar[1]} tall`);
  }
});

test('every grid area is both named and filled', () => {
  // A typo on either side is invisible: the panel simply does not appear,
  // and nothing in the console says why.
  for (const { name, text } of stylesheets) {
    const assigned = new Set([...text.matchAll(/\.castleCanvasColumn > [^{]*\{\s*grid-area:\s*(\w+)/g)]
      .map(m => m[1]));
    assert.deepEqual([...assigned].sort(), ['bar', 'dock', 'map', 'split'], name + ': wrong area names');
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const rule = text.match(new RegExp(`\\[data-dock="${side}"\\]\\s*\\{([^}]*)\\}`));
      assert.ok(rule, `${name}: no rule for ${side}`);
      const named = new Set((rule[1].match(/"([^"]*)"/g) || []).join(' ').replace(/"/g, '').split(/\s+/).filter(Boolean));
      for (const area of assigned)
        assert.ok(named.has(area), `${name}: data-dock="${side}" never places "${area}"`);
    }
  }
});

test('no transition on the grid tracks', () => {
  for (const { name, text } of stylesheets) {
    for (const block of text.match(/\.castleCanvasColumn[^{]*\{[^}]*\}/g) || [])
      assert.ok(!block.includes('transition'),
        `${name}: an animated track resizes three canvas buffers per frame -> ${block.slice(0, 40)}`);
  }
});

test('the rules of the old, never-built 2.5D workspace are gone', () => {
  for (const { name, text } of stylesheets) {
    assert.ok(!text.includes('#isoWorkspace'), `${name} still styles a workspace that does not exist`);
    assert.ok(!text.includes('.isoLayout'), `${name} still styles a layout that does not exist`);
  }
});

// -------------------------------------------------------------- the js

test('the editor lets others watch, and hands out its key handler', () => {
  assert.ok(/function handleCastleKey\(/.test(editor), 'the key handler is a function of its own');
  assert.ok(/handleKey:\s*handleCastleKey/.test(editor), 'and it is exported as handleKey');
  assert.ok(/window\.addEventListener\('keydown', handleCastleKey\)/.test(editor),
    'the main window still uses the same handler');
  assert.ok(/function addChangeListener\(/.test(editor), 'watchers can register');
  assert.ok(/\n\s*addChangeListener,/.test(editor), 'and addChangeListener is exported');
  const scheduleDraw = editor.slice(editor.indexOf('function scheduleDraw'));
  assert.ok(scheduleDraw.slice(0, 500).includes('changeListeners'),
    'scheduleDraw has to tell the watchers, or the docked view never updates');
});

test('the editor knows nothing about the 2.5D view by name', () => {
  assert.ok(!editor.includes('isoView'), 'the editor must not reach into the view');
  assert.ok(!editor.includes('dockView'), 'nor into the docking');
});

test('the view measures its box, not its canvas, and survives a lost pointer', () => {
  assert.ok(!isoView.includes('state.win.innerWidth'),
    'the window size is not the size of the drawing surface any more');
  assert.ok(isoView.includes('getBoundingClientRect'), 'the box is measured');
  assert.ok(isoView.includes('ResizeObserver'), 'a docked panel has no resize event of its own');
  const captures = (isoView.match(/setPointerCapture\(/g) || []).length;
  const guarded = (isoView.match(/try \{ [^;]*setPointerCapture\(/g) || []).length;
  assert.equal(captures, guarded, `${captures} captures, only ${guarded} of them guarded`);
});

test('the view refuses to draw into a box of no size', () => {
  const surface = isoView.slice(isoView.indexOf('function surface('));
  assert.ok(/width <= 0 \|\| height <= 0/.test(surface.slice(0, 900)),
    'a hidden castle tab measures 0 by 0, and fitView(0, 0) destroys the view');
});

test('the docking view hands out gestures and draws nothing', () => {
  for (const forbidden of ['getContext', 'drawImage', 'ctx.', 'isoGeometry'])
    assert.ok(!dockView.includes(forbidden), 'dock-view.js must not contain ' + forbidden);
  assert.ok(dockView.includes('dockGeometry') && dockView.includes('dockModel'),
    'it gets its answers from the two tested files');
});

test('the docking view measures one box, in one place', () => {
  const measurements = (dockView.match(/getBoundingClientRect\(/g) || []).length;
  assert.equal(measurements, 1, 'every rectangle comes from hostRect(), or two of them drift apart');
  assert.ok(/function hostRect\(\)[\s\S]{0,200}castleDockOverlay|els\.overlay\.getBoundingClientRect/.test(dockView),
    'and that box is the overlay');
});

test('the panel is applied before the map is measured', () => {
  const dock = shell.indexOf('dockView?.onWorkspaceShown');
  const castle = shell.indexOf('castleEditor?.onWorkspaceShown');
  assert.ok(dock > 0 && castle > 0, 'the shell tells both of them');
  assert.ok(dock < castle, 'the grid track has to change before the canvas is measured');
});

test('npm run check syntax-checks every file of the 2.5D view', () => {
  for (const file of ['src/js/iso-geometry.js', 'src/js/iso-view.js', 'src/js/dock-geometry.js',
                      'src/js/dock-model.js', 'src/js/dock-view.js'])
    assert.ok(pkg.scripts.check.includes(file), `npm run check never looks at ${file}`);
});

test('a pointer from the 2.5D view is never taken away from it', () => {
  // While the 2.5D view was a window of its own, its pointer id did not exist
  // in this document: capturing it on the map threw and the empty catch
  // swallowed it. Docked, both canvases share one document and the id is
  // real, so the call succeeds - and takes the rest of the stroke with it.
  // Every further move and the release would land on the map, be measured
  // against the map's rectangle instead of the tile that was clicked, and the
  // 2.5D view would never see its own release: it would stay drawing.
  const captures = [...editor.matchAll(/^.*\.(?:set|release)PointerCapture\(.*$/gm)].map(m => m[0]);
  assert.ok(captures.length >= 4, 'found the capture calls at all: ' + captures.length);
  for (const line of captures) {
    assert.match(line, /!outside|!fromOutside\(event\)/, 'unguarded capture: ' + line.trim());
  }
  assert.match(editor, /if \(!outside\) els\.canvas\.focus\(\)/,
    'the keyboard focus has to stay where the click was, too');
});
