// Authoring only: produce a complete, editable pack without inherited artwork.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import StyleDictionary from 'style-dictionary';
import themeRuntime from '../src/js/theme.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const themes = path.join(root, 'assets/themes');
const read = file => readFile(path.join(themes, file));
const json = async file => JSON.parse(await read(file));
const [base, ucp, schema] = await Promise.all([
  json('default/theme.json'), json('ucp/theme.json'), json('theme.schema.json'),
]);
const id = 'monsterfish-theme';
const manifest = {
  ...ucp, id, name: 'Monsterfish Theme', version: '1.6.0',
  textures: { ...base.textures, ...ucp.textures },
  attribution: [...base.attribution, ...ucp.attribution],
};
delete manifest.extends;
themeRuntime.validateManifest(manifest, id);
assert.deepEqual(Object.keys(manifest.textures).sort(), Object.keys(schema.properties.textures.properties).sort());

// Reuse the theme builder's merge semantics, including ordered font fallbacks.
const dictionary = new StyleDictionary({
  usesDtcg: true,
  include: [path.join(themes, 'default/tokens.json')],
  source: [path.join(themes, 'ucp/tokens.json')],
});
await dictionary.hasInitialized;
const tokens = JSON.parse(JSON.stringify(dictionary.tokens, (key, value) =>
  key === 'filePath' || key === 'isSource' ? undefined : value));
const css = await read('ucp/variables.css');
const variableNames = bytes => [...bytes.toString().matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]).sort();
assert.deepEqual(variableNames(css), variableNames(await read('default/variables.css')));
const names = new Set(variableNames(css));
for (const [, name] of css.toString().matchAll(/var\(\s*(--[a-z0-9-]+)/g)) assert.ok(names.has(name), `Missing variable: ${name}`);

const entries = {};
const add = (name, data) => { entries[`${id}/${name}`] = Buffer.from(data); };
const addJson = (name, data) => add(name, JSON.stringify(data, null, 2) + '\n');
addJson('theme.json', manifest);
addJson('tokens.json', tokens);
addJson('theme.schema.json', schema);
add('variables.css', css);
add('README.md', await readFile(path.join(root, 'docs/theme-starter.de.md')));
add('ATTRIBUTION.md', `${await read('default/ATTRIBUTION.md')}\n${await read('ucp/ATTRIBUTION.md')}`);
for (const [slot, texture] of Object.entries(manifest.textures)) {
  const source = Object.hasOwn(ucp.textures, slot) ? 'ucp' : 'default';
  const bytes = await read(`${source}/${texture.file}`);
  if (entries[`${id}/${texture.file}`]) assert.deepEqual(entries[`${id}/${texture.file}`], bytes);
  add(texture.file, bytes);
}
add('TEXTURE-ROLES.md', '# Texturrollen\n\nAlle Bildzuweisungen stehen in `theme.json`. Mehrere Rollen dürfen dieselbe Datei nutzen.\n\n| Rolle | Datei | Darstellung |\n| --- | --- | --- |\n' +
  Object.entries(manifest.textures).map(([slot, t]) => `| ${slot} | ${t.file} | ${t.mode} |`).join('\n') + '\n');

const archive = zipSync(Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, [bytes, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') }]])));
const unpacked = unzipSync(archive);
for (const [name, bytes] of Object.entries(entries)) assert.deepEqual(Buffer.from(unpacked[name]), bytes);
const output = path.resolve(process.argv[2] || path.join(root, 'dist/Monsterfish-Theme-Starter.zip'));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, archive);
console.log(JSON.stringify({ output, bytes: archive.length, files: Object.keys(entries).length, textureRoles: Object.keys(manifest.textures).length, variables: names.size }));
