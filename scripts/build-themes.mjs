// Authoring only: Style Dictionary is deliberately not shipped in the editor.
import StyleDictionary from 'style-dictionary';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../assets/themes/', import.meta.url));
const packs = JSON.parse(await readFile(path.join(directory, 'registry.json'), 'utf8'));
for (const { id } of packs) {
  const theme = JSON.parse(await readFile(path.join(directory, id, 'theme.json'), 'utf8'));
  const dictionary = new StyleDictionary({
    usesDtcg: true,
    include: theme.extends ? [path.join(directory, theme.extends, 'tokens.json')] : [],
    source: [path.join(directory, id, 'tokens.json')],
    platforms: {
      css: {
        transformGroup: 'css',
        buildPath: path.join(directory, id) + path.sep,
        files: [{
          destination: 'variables.css',
          format: 'css/variables',
          options: { outputReferences: true, showFileHeader: false },
        }],
      },
    },
  });
  await dictionary.buildAllPlatforms();
}
