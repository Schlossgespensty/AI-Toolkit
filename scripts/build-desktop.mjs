import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'desktop-dist');
for (const script of ['prepare-renderer.js', 'build-themes.mjs', 'build-locales.js']) {
  if (fs.existsSync(path.join(root, 'scripts', script))) execFileSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
}
fs.mkdirSync(path.join(root, 'src/vendor/i18next'), { recursive: true });
fs.copyFileSync(path.join(root,'node_modules/i18next/dist/umd/i18next.min.js'),path.join(root,'src/vendor/i18next/i18next.min.js'));
if (fs.existsSync(path.join(root, 'src/desktop/api.ts'))) await build({
  entryPoints: [path.join(root, 'src/desktop/api.ts')], outfile: path.join(root, 'src/js/desktop-api.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true,
});
// Only this generated directory is replaced; never touch source files or local game caches.
if (path.dirname(target) !== root || path.basename(target) !== 'desktop-dist') throw new Error('Invalid build output');
fs.rmSync(target, { recursive: true, force: true });
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(relative);
    else if (entry.isFile()) files.push(relative);
  }
}
for (const directory of ['src','assets','config']) collect(directory);
const isGameSprite = file => /^assets\/aiv\/iso\/.*\.png$/.test(file) || /^assets\/aiv\/skins\/(?:[1-9]|1\d|2[01])\.png$/.test(file);
const include = file => !isGameSprite(file) && !/^src\/(node|desktop)\//.test(file) && !/\.(?:map|md|ts)$/.test(file)
  && !file.endsWith('combined-blue.css') && !file.endsWith('icon.ico')
  && !/^assets\/aiv\/item-skins\.(png|json)$/.test(file)
  && !/^assets\/themes\/(?:theme\.schema\.json|[^/]+\/tokens\.json)$/.test(file)
  && !file.startsWith('src/shared/') // Shared source is bundled into the native/desktop entry points.
  && !/^assets\/aiv\/(background|village-sidebar)\.png$/.test(file);
for (const file of files.filter(include)) {
  const destination = path.join(target,file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  if (/\.(js|css)$/.test(file) && !file.includes('/vendor/')) {
    const result = await transform(fs.readFileSync(path.join(root,file),'utf8'),{loader:file.endsWith('.css')?'css':'js',minify:true,target:'es2022'});
    fs.writeFileSync(destination,result.code);
  } else if (file === 'src/index.html') {
    // Tauri supplies the complete CSP, including its scoped asset and IPC protocols.
    fs.writeFileSync(destination,fs.readFileSync(path.join(root,file),'utf8').replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i,''));
  } else fs.copyFileSync(path.join(root,file),destination);
}
// The native core reads the same metadata; no executable fallback renderer or game is packaged.
const count = files.filter(include).length;
const skins = Object.fromEntries(files.filter(file => /^assets\/aiv\/skins\/\d+\.(png|svg)$/.test(file) && include(file))
  .map(file=>[path.basename(file,path.extname(file)),path.basename(file)]));
fs.writeFileSync(path.join(target,'assets/aiv/skin-manifest.json'),JSON.stringify(skins));
console.log(`Desktop payload: ${count} files; game sprite PNGs and Node backend excluded.`);
