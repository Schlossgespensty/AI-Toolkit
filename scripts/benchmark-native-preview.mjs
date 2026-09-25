// Development-only CDP test: actual pointer drags in the loaded, maximized editor.
import fs from "node:fs";
import { connectCdp } from './lib/cdp-client.mjs';
const { send, evaluate, close } = await connectCdp(Number(process.env.AI_TOOLKIT_DEBUG_PORT));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let measuring = false, profiling = false, pointerDown = false, pointer;
try {
  const ready = await evaluate(
    `({dirty:castleEditor.isDirty()||characterEditor.isDirty(),steps:castleEditor.getDocument().frames.length,tiles:isoView.hasMapTiles()})`,
  );
  if (ready.dirty || ready.steps < 901 || !ready.tiles)
    throw new Error(
      "Use an unchanged castle with at least 901 steps and a loaded game map.",
    );
  await evaluate(
    `(async()=>{await __TAURI__.window.getCurrentWindow().maximize();${process.argv.includes('--fit') ? 'isoView.fit();' : ''}return true;})()`,
  );
  await delay(600);
  const context = await evaluate(
    `(()=>{const e=document.getElementById('castleBuildSlider'),r=e.getBoundingClientRect();return{viewport:[innerWidth,innerHeight],view:isoView.viewInfo(),map:isoView.gameMapInfo(),steps:castleEditor.getDocument().frames.length,slider:{x:r.x,y:r.y,width:r.width,height:r.height,min:+e.min,max:+e.max},canvas:[...document.querySelectorAll('canvas')].filter(c=>c.getClientRects().length).map(c=>({width:c.width,height:c.height,css:[c.clientWidth,c.clientHeight]}))}})()`,
  );
  measuring = true;
  await evaluate(
    `(()=>{const data=window.previewMeasurement={frames:[],inputToFrame:[],longTasks:[],inputValues:[],alive:true};let last=performance.now();function tick(now){if(!data.alive)return;data.frames.push(now-last);last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);data.observer=new PerformanceObserver(list=>data.longTasks.push(...list.getEntries().map(e=>e.duration)));data.observer.observe({type:'longtask'});data.handler=()=>{const time=performance.now();data.inputValues.push(+document.getElementById('castleBuildSlider').value);requestAnimationFrame(()=>data.inputToFrame.push(performance.now()-time));};document.getElementById('castleBuildSlider').addEventListener('input',data.handler);return true;})()`,
  );
  const rect = context.slider;
  if (context.canvas.length < 4)
    throw new Error(
      "Both GPU surfaces must be active; refusing to benchmark a silent fallback.",
    );
  const profileRequested = process.argv.includes("--profile");
  if (profileRequested) {
    await send("Profiler.enable");
    await send("Profiler.start");
    profiling = true;
  }
  // Account for the thumb width, just as the native range control does.
  const x = (value) =>
    rect.x +
    8 +
    ((rect.width - 16) * (value - rect.min)) / (rect.max - rect.min);
  const y = rect.y + rect.height / 2;
  pointer = {x:x(100),y};
  pointerDown = true;
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: x(100),
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  const started = performance.now(),
    events = [];
  for (let i = 0; i < 60; i++) {
    await delay(Math.max(0, started + i * 100 - performance.now()));
    const value =
      i % 4 === 0 ? 900 : i % 4 === 1 ? 101 : i % 4 === 2 ? 899 : 100;
    const start = performance.now();
    pointer = {x:x(value),y};
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x(value),
      y,
      button: "left",
      buttons: 1,
    });
    events.push({
      target: value,
      dispatchMs: performance.now() - start,
      atMs: start - started,
    });
  }
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x(100),
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  pointerDown = false;
  await delay(200);
  const profile = profileRequested ? await send("Profiler.stop") : null;
  profiling = false;
  const measured = await evaluate(
    `(()=>{const d=previewMeasurement;d.alive=false;d.observer.disconnect();document.getElementById('castleBuildSlider').removeEventListener('input',d.handler);return{frames:d.frames,inputToFrame:d.inputToFrame,longTasks:d.longTasks,inputValues:d.inputValues,dirty:castleEditor.isDirty(),selected:castleEditor.getActiveBuildStep()};})()`,
  );
  const stats = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return {
      samples: values.length,
      median: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted.at(-1),
    };
  };
  const output = {
    context,
    stats: {
      frames: stats(measured.frames),
      inputToFrame: stats(measured.inputToFrame),
      dispatch: stats(events.map((e) => e.dispatchMs)),
      longTasks: measured.longTasks,
    },
    events,
    measured,
  };
  const filename =
    process.argv.slice(2).find((argument) => !argument.startsWith("--")) ||
    "native-preview-performance.json";
  fs.writeFileSync(filename, JSON.stringify(output, null, 2));
  if (profile)
    fs.writeFileSync(filename + ".cpuprofile", JSON.stringify(profile.profile));
  console.log(
    JSON.stringify({
      file: filename,
      context,
      stats: output.stats,
      values: measured.inputValues.length,
      dirty: measured.dirty,
    }),
  );
} finally {
  // Failed runs must not leave callbacks or an active synthetic drag behind
  // and change the behavior measured by the next run on this owned QA window.
  if (pointerDown) await send('Input.dispatchMouseEvent', {
    type:'mouseReleased', ...pointer, button:'left', buttons:0, clickCount:1,
  }).catch(() => {});
  if (profiling) await send('Profiler.stop').catch(() => {});
  if (measuring) await evaluate(`(()=>{const d=window.previewMeasurement;if(!d)return;d.alive=false;d.observer?.disconnect();document.getElementById('castleBuildSlider')?.removeEventListener('input',d.handler);})()`)
    .catch(() => {});
  close();
}
