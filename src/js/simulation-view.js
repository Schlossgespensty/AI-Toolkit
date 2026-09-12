'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const model = window.simulationModel;
  const dialog = $('gameSimulationDialog'), canvas = $('simulationCanvas');
  const ctx = canvas.getContext('2d');
  let trace = null, background = null, zoom = 2.4, panX = 200, panY = 15, drag = null;
  let cached = null;
  const point = (x, y) => [panX + (x - y + 199) / 2 * zoom, panY + (x + y - 199) / 2 * zoom];
  function outline(x, y, n, color, fill = null) {
    ctx.beginPath();
    [[x,y],[x+n,y],[x+n,y+n],[x,y+n]].forEach(([gx,gy], i) => {
      const [px,py] = point(gx,gy); if (i) ctx.lineTo(px,py); else ctx.moveTo(px,py);
    });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.stroke();
  }
  function linePaths(paths, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    for (const path of paths) for (const segment of path.segments) {
      ctx.beginPath();
      segment.forEach((p,i) => { const [x,y] = point(p.x+.5,p.y+.5); if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
      ctx.stroke();
    }
  }
  function paint() {
    ctx.fillStyle = '#171d17'; ctx.fillRect(0,0,canvas.width,canvas.height);
    if (!trace) return;
    if (background?.complete && background.naturalWidth) ctx.drawImage(background,panX,panY,200*zoom,200*zoom);
    const index = Number($('simulationTick').value), frame = trace.frames[index];
    const frames = model.range(trace, 0, index), selected = $('simulationWorker').value;
    if (!cached || cached.trace !== trace || cached.index !== index || cached.selected !== selected)
      cached = { trace, index, selected, heat: model.fireOccupancy(frames),
        routes: model.trails(frames,'workers',selected), sparks: model.trails(frames,'sparks'),
        summary: selected ? model.workerSummary(frames,selected) : null };
    const worker = frame.workers.find(w => model.key(w) === selected);
    for (const building of frame.buildings) {
      const chosen = worker && building[0] === worker[8];
      outline(building[4],building[5],building[6],chosen ? '#f1c169' : '#ffffff44');
      if (chosen && building[7] >= 0 && building[8] >= 0)
        outline(building[7],building[8],1,'#f1c169','#f1c169');
    }
    if ($('simulationFire').checked) for (const cell of cached.heat)
      outline(cell.x,cell.y,1,'#e8403299',`rgba(255,126,20,${.12+.65*cell.fraction})`);
    if ($('simulationRoutes').checked) linePaths(cached.routes,'#64e8ef');
    if ($('simulationSparks').checked) linePaths(cached.sparks,'#ffbb4f');
    for (const w of frame.workers) {
      if (selected && model.key(w) !== selected) continue;
      const [x,y] = point(w[4]+.5,w[5]+.5);
      ctx.fillStyle = '#64e8ef'; ctx.fillRect(x-2,y-2,4,4);
    }
    $('simulationTickValue').textContent = frame.tick;
    let details = `${frame.workers.length} workers · ${frame.fires.length} fires · ${frame.sparks.length} sparks. Fire intensity is recorded occupancy, not future probability.`;
    if (selected) {
      const summary = cached.summary;
      const cycles = summary.cycles;
      details = `${summary.distance.toFixed(1)} tiles travelled · ${summary.unloads.length} cargo unloads` +
        (cycles.length ? ` · observed unload intervals ${Math.min(...cycles)}–${Math.max(...cycles)} ticks` : '') +
        (worker ? ` · position ${worker[4]}, ${worker[5]} · height ${worker[6]} · building height ${worker[7]} · cargo good ${worker[9]}: ${worker[10]}` : ' · worker absent at this tick') +
        '. Unloads are counter transitions; they are not all necessarily new production.';
    }
    $('simulationDetails').textContent = details;
  }
  function fit() { zoom=Math.min(canvas.width,canvas.height)/210;panX=(canvas.width-200*zoom)/2;panY=10;paint(); }
  $('openGameSimulation').addEventListener('click',()=>{dialog.showModal();fit();});
  $('simulationClose').addEventListener('click',()=>dialog.close());
  $('simulationFit').addEventListener('click',fit);
  for (const id of ['simulationTick','simulationWorker','simulationRoutes','simulationFire','simulationSparks']) $(id).addEventListener('input',paint);
  $('simulationOpen').addEventListener('click',async()=>{
    try {
      const result = await window.electronAPI.openSimulationCapture();
      if (!result) return;
      trace=result; background=null;
      if (trace.background) { background=new Image(); background.onload=paint; background.src=trace.background; }
      $('simulationTick').max=trace.frames.length-1; $('simulationTick').value=trace.frames.length-1;
      const workers=new Map();
      for (const frame of trace.frames) for (const w of frame.workers) workers.set(model.key(w),w);
      $('simulationWorker').replaceChildren(new Option('All workers',''));
      for (const [key,w] of workers) $('simulationWorker').add(new Option(`Player ${w[3]} · worker ${w[0]} · type ${w[2]}`,key));
      $('simulationMessage').textContent = `${trace.header.source} · ${trace.frames.length} ticks captured. `+
        (trace.backgroundNotice || 'Starting save and UCP settings verified.')+
        (trace.partial ? ' Incomplete last line ignored.' : '')+(trace.end ? ` ${trace.end}.` : '');
      fit();
    } catch (error) { $('simulationMessage').textContent=error.message; }
  });
  $('simulationExport').addEventListener('click',async()=>{
    try {
      const folder=await window.electronAPI.exportSimulationObserver();
      if (folder) $('simulationMessage').textContent=`Exported to ${folder}. Put this folder under ucp/modules and enable it with Recorder 0.51.x (tick-observer API v1). See its README; it has not yet had an in-game performance pass.`;
    } catch (error) { $('simulationMessage').textContent=error.message; }
  });
  const local=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};};
  canvas.addEventListener('wheel',e=>{e.preventDefault();const p=local(e),next=Math.max(.5,Math.min(64,zoom*Math.exp(-e.deltaY*.001)));panX=p.x-(p.x-panX)*next/zoom;panY=p.y-(p.y-panY)*next/zoom;zoom=next;paint();},{passive:false});
  canvas.addEventListener('pointerdown',e=>{drag=local(e);canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=local(e);panX+=p.x-drag.x;panY+=p.y-drag.y;drag=p;paint();});
  canvas.addEventListener('pointerup',()=>{drag=null;});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
})();
