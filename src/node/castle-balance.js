'use strict';
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { validate } = require('../js/castle-balance');

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function resolveSelector(gameRoot, selector, loadOrder = null) {
  const root = fs.realpathSync(gameRoot);
  const parts = String(selector).replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '..' || part === '.' || /[:?\[\]]/.test(part))) throw new Error('Unsupported balance path.');
  let candidates = [root];
  for (const [index, part] of parts.entries()) {
    const pattern = new RegExp(`^${part.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
    // UCP selects extension versions via its resolved load order. Other
    // installed versions are not competing balance profiles for this session.
    const extensionWildcard = index === 2 && parts[0].toLowerCase() === 'ucp'
      && ['plugins','modules'].includes(parts[1].toLowerCase()) && part.includes('*');
    const selected = extensionWildcard && Array.isArray(loadOrder)
      ? new Set(loadOrder.filter(e => typeof e?.extension === 'string' && e.version != null)
        .map(e => `${e.extension}-${e.version}`.toLowerCase())) : null;
    candidates = candidates.flatMap(dir => fs.readdirSync(dir)
      .filter(name => pattern.test(name) && (!selected || selected.has(name.toLowerCase()))).map(name => {
      const resolved = fs.realpathSync(path.join(dir, name));
      if (!contained(root, resolved)) throw new Error('Balance path escapes the game installation.');
      return resolved;
    }));
  }
  if (candidates.length !== 1) throw new Error(`Balance path matched ${candidates.length} files. Load the intended profile explicitly.`);
  return candidates[0];
}
function readInstalledBalance(gameRoot) {
  if (!gameRoot) throw new Error('Choose a UCP installation in Library first.');
  const configPath = path.join(gameRoot, 'ucp-config.yml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8'), { schema: yaml.JSON_SCHEMA });
  if (config?.active === false) throw new Error('The selected UCP configuration is inactive.');
  const full = config?.['config-full'] || config?.config;
  const sparse = config?.['config-sparse'];
  if (Array.isArray(full?.['load-order']) && !full['load-order'].some(entry => entry?.extension === 'rebalancer')) {
    throw new Error('Rebalancer is not enabled in the resolved UCP load order.');
  }
  const section = full?.modules?.rebalancer || sparse?.modules?.rebalancer;
  const leaf = section?.config?.balance_config_file_selector;
  const contents = leaf?.contents || leaf;
  const selector = typeof contents === 'string' ? contents : contents?.value;
  if (typeof selector !== 'string' || !selector.trim()) throw new Error('No resolved rebalancer profile in ucp-config.yml. Load the balance JSON explicitly.');
  const filePath = resolveSelector(gameRoot, selector, full?.['load-order']);
  if (fs.statSync(filePath).size > 4 * 1024 * 1024) throw new Error('Balance profile is too large.');
  const profile = validate(yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: yaml.JSON_SCHEMA }));
  const baseline = require('./castle-exe-costs').readExeCosts(gameRoot);
  if (baseline) {
    const overrides = profile.buildings || {};
    profile.buildings = { ...baseline.buildings };
    for (const [name, patch] of Object.entries(overrides)) {
      profile.buildings[name] = { ...profile.buildings[name], ...patch };
    }
  }
  return { profile, name: path.basename(filePath), filePath, configPath,
    exePath: baseline?.filePath || null };
}
module.exports = { readInstalledBalance, resolveSelector };
