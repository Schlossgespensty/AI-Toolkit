'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [path.join(root, 'main.js'), path.join(root, 'preload.js')];

function collectJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(filePath);
    else if (/\.m?js$/i.test(entry.name)) files.push(filePath);
  }
}

collectJavaScript(path.join(root, 'src'));
files.sort((one, two) => one.localeCompare(two));

for (const filePath of files) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Syntax OK (${files.length} JavaScript files).`);
