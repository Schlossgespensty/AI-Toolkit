// Opt-in startup measurement on an isolated profile; no user process is touched.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { connectCdp, closeOwnedEditor } from './lib/cdp-client.mjs';

const { values } = parseArgs({ options: {
  exe: { type: 'string' }, profile: { type: 'string' }, seed: { type: 'string' },
  port: { type: 'string' }, output: { type: 'string' },
} });
if (!values.exe || !values.profile || !values.seed || !values.output) {
  throw new Error('Required: --exe <preview.exe> --profile <new-directory> --seed <settings-profile> --port <unused-port> --output <report.json>');
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Supply an unused debug port.');
const executable = await fs.realpath(values.exe), profile = path.resolve(values.profile);
const seed = await fs.realpath(values.seed);
try {
  await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  throw new Error('Debug port is already in use.');
} catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
// mkdir is intentionally non-recursive and fails if the requested profile exists.
await fs.mkdir(profile);
for (const name of ['settings.json', 'electron-preferences.json']) {
  await fs.copyFile(path.join(seed, name), path.join(profile, name));
}
const report = {
  executable, profile, port, pollingResolutionMs: 50,
  note: 'First run has a fresh app asset cache; OS filesystem caches are not flushed. Ready timings are data/DOM readiness, not GPU presentation.',
  runs: [],
};
for (const mode of ['fresh-profile', 'warm-restart']) {
  const started = performance.now();
  const child = spawn(executable, [], { cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, AI_TOOLKIT_USER_DATA: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  let client;
  const run = { mode };
  try {
    while (!client && performance.now() - started < 45000) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Editor exited with ${child.exitCode}.`);
      try { client = await connectCdp(port); } catch { await delay(50); }
    }
    if (!client) throw new Error('Editor did not expose its isolated debug target.');
    run.debugTargetMs = performance.now() - started;
    let sample;
    while (performance.now() - started < 45000) {
      sample = await client.evaluate(`(()=>{
        const navigation=performance.getEntriesByType('navigation')[0];
        return {dom:document.readyState==='complete',domContentLoadedMs:navigation?.domContentLoadedEventEnd,
          path:window.castleEditor?.getPath?.(),steps:window.castleEditor?.getDocument?.()?.frames?.length,
          map:window.isoView?.hasMapTiles?.(),dirty:!!(window.castleEditor?.isDirty?.()||window.characterEditor?.isDirty?.()||window.aiContentEditor?.isDirty?.())};
      })()`);
      const elapsed = performance.now() - started;
      if (sample.dom && run.domReadyMs === undefined) run.domReadyMs = elapsed;
      if (sample.path && sample.steps > 1 && run.projectReadyMs === undefined) run.projectReadyMs = elapsed;
      if (sample.map && run.mapDataReadyMs === undefined) run.mapDataReadyMs = elapsed;
      if (run.domReadyMs && run.projectReadyMs && run.mapDataReadyMs) break;
      await delay(50);
    }
    run.sample = sample;
    if (!run.domReadyMs || !run.projectReadyMs || !run.mapDataReadyMs) throw new Error('Seed must restore a saved castle with a game map. Readiness timed out.');
    if (sample.dirty) throw new Error('QA profile became dirty; leaving it open.');
    report.runs.push(run);
    try { run.close = await closeOwnedEditor(client, child); }
    catch (error) { run.closeError = error.message; throw error; }
    finally { await fs.writeFile(values.output, JSON.stringify(report, null, 2)); }
    console.log(JSON.stringify(run));
  } finally { client?.close(); }
}
