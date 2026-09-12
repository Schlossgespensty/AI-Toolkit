'use strict';
const fs = require('node:fs');
const path = require('node:path');
function exportObserver(folder, appRoot) {
  const target = path.join(fs.realpathSync(folder), 'ai-toolkit-observer-0.1.0');
  const sources = ['definition.yml', 'init.lua'].map(name => ({ name,
    data: fs.readFileSync(path.join(appRoot, 'integrations/ai-toolkit-observer', name)) }));
  sources.push({ name: 'README.md', data: fs.readFileSync(path.join(appRoot, 'docs/game-simulation.md')) });
  // Preflight every file before making changes; preserve local modifications.
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Observer destination must not be a link.');
  for (const { name, data } of sources) {
    const file = path.join(target, name);
    if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || !fs.readFileSync(file).equals(data)))
      throw new Error('The existing observer differs. Choose another export folder to preserve your files.');
  }
  fs.mkdirSync(target, { recursive: true });
  for (const { name, data } of sources) if (!fs.existsSync(path.join(target, name))) fs.writeFileSync(path.join(target, name), data, { flag: 'wx' });
  return target;
}
module.exports = { exportObserver };
