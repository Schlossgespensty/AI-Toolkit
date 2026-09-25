'use strict';
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { transformSync } = require('esbuild');
const yaml = require('js-yaml');
const { flatten } = require('./build-locales');
const root = path.resolve(__dirname, '..');
function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node,parent);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(value => walk(value, visit,node));
    else if (child && typeof child === 'object') walk(child, visit,node);
  }
}
function checkReferences() {
  const messages = new Map();
  for (const file of fs.readdirSync(path.join(root, 'locales/en')).filter(name => name.endsWith('.yaml'))) {
    const namespace = path.basename(file, '.yaml');
    const values = flatten(yaml.load(fs.readFileSync(path.join(root, 'locales/en', file), 'utf8')));
    messages.set(namespace, new Set(Object.keys(values).flatMap(key => [key,key.replace(/_(?:zero|one|two|few|many|other)$/,'')])));
  }
  const errors = [];
  let references = 0;
  function check(value, location) {
    const colon = value.indexOf(':');
    if (colon < 0 || !messages.has(value.slice(0, colon))) return;
    references++;
    if (!messages.get(value.slice(0, colon)).has(value.slice(colon + 1))) errors.push(location + ': ' + value);
  }
  const files = [
    ...fs.readdirSync(path.join(root, 'src/js')).filter(name => name.endsWith('.js') && name !== 'desktop-api.js').map(name => 'src/js/' + name),
    ...fs.readdirSync(path.join(root, 'src/desktop')).filter(name => name.endsWith('.ts')).map(name => 'src/desktop/' + name),
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const code = file.endsWith('.ts') ? transformSync(source, { loader:'ts', target:'es2022' }).code : source;
    const ast = acorn.parse(code, { ecmaVersion:'latest', locations:true, sourceType:'module' });
    walk(ast, (node,parent) => {
      if(parent?.type==='BinaryExpression' && parent.operator==='+')return;
      if(node.type==='Literal' && typeof node.value==='string') {
        const location = file+':'+node.loc.start.line;
        if (/^[a-z-]+=\w+:/.test(node.value)) {
          for (const binding of node.value.split(';')) check(binding.slice(binding.indexOf('=')+1), location);
        } else check(node.value,location);
      }
    });
  }
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  for(const match of html.matchAll(/data-i18n(?:-attrs)?="([^"]+)"/g)) {
    for(const binding of match[1].split(';')) check(binding.slice(binding.indexOf('=')+1), 'index.html');
  }
  if(errors.length) throw new Error('Unknown locale references:\n'+errors.join('\n'));
  return references;
}
if(require.main===module) console.log(checkReferences()+' explicit locale references checked');
module.exports={checkReferences};
