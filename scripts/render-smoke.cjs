'use strict';
// Local reproduction requires an explicit isolated, hidden test window.
const isolated = process.argv.includes('--isolated');
if (process.env.GITHUB_ACTIONS !== 'true' && !isolated) throw new Error('Use GitHub Actions or --isolated for this rendering check.');
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname,'../artifacts/render');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-render-')));
fs.writeFileSync(path.join(app.getPath('userData'),'settings.json'),JSON.stringify({language:'en',theme:'ucp'}));
app.disableHardwareAcceleration();
// Release parsing has separate tests; this renderer fixture never needs the
// public GitHub API or the runner's unauthenticated rate-limit allowance.
const updates = require('../src/node/release-updates');
const releaseChecker = updates.createReleaseChecker;
updates.createReleaseChecker = installed => releaseChecker(installed, async url => {
  assert.match(new URL(url).pathname, /^\/repos\/Schlossgespensty\/AI-Toolkit\/(forks|releases)$/);
  return {ok:true,json:async()=>[]};
});
const loaded = new Promise(resolve => app.once('browser-window-created',(_event,win) => {
  if (isolated) { win.setFocusable(false); win.hide(); }
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
const timer = setTimeout(()=>{console.error('Renderer smoke check timed out.');app.exit(1);},45000);
require('../main');
(async()=>{
  try {
    const win = await loaded;
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
      if(!window.toolkitI18n?.bindText)throw new Error('Renderer translation runtime was not prepared');
      await window.toolkitI18n.ready;
      await window.toolkitI18n.changeLanguage('en',{persist:false});
      for(let i=0;i<200&&!window.castleEditor?.extras.state.constants['73'];i++)await pause();
      if(!window.castleEditor?.extras.state.constants['73'])throw new Error('Castle renderer did not initialize');
      const errors=[];
      window.addEventListener('error',event=>errors.push(event.message));
      window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
      window.alert=message=>{throw new Error(message)};
      // This software-rendering suite inspects Canvas calls and pixels. Exercise
      // the compatibility renderer explicitly, independently of overlay state;
      // fire overlays now correctly retain the GPU renderer when available.
      window.castleGpuStage=null;
      window.appWorkspace.setActive('character');
      await window.characterEditor.ready;
      const troopToggle=document.getElementById('toggleTroops');
      if(!troopToggle.checked)throw new Error('Troop plugin not enabled by default');
      const untouched=window.characterEditor.getContent();
      window.characterEditor.loadFromContent(untouched,'C:/AI/Troop-A/character.json');
      troopToggle.checked=false;troopToggle.dispatchEvent(new Event('change'));
      window.characterEditor.loadFromContent(untouched,'C:/AI/Troop-B/character.json');
      if(!troopToggle.checked)throw new Error('Opt-out leaked into another AI');
      window.characterEditor.loadFromContent(untouched,'C:/AI/Troop-A/character.json');
      if(troopToggle.checked)throw new Error('Explicit troop opt-out not restored');
      troopToggle.checked=true;troopToggle.dispatchEvent(new Event('change'));
      if(document.querySelectorAll('select[data-aic-field]').length!==32)throw new Error('Missing troop behaviour fields');
      if(Object.keys(JSON.parse(window.characterEditor.getContent()).aic).some(k=>k.startsWith('AIVTroops_')))throw new Error('Inherited overrides leaked into saved AIC');
      const slave=document.querySelector('[data-aic-field="AIVTroops_InitialRole_Slave"]');
      slave.value='dig';slave.dispatchEvent(new Event('change'));
      if(JSON.parse(window.characterEditor.getContent()).aic.AIVTroops_InitialRole_Slave!=='dig')throw new Error('Troop role did not save');
      troopToggle.checked=false;troopToggle.dispatchEvent(new Event('change'));
      if(document.querySelector('[data-aic-field]') || Object.keys(JSON.parse(window.characterEditor.getContent()).aic).some(k=>k.startsWith('AIVTroops_')))throw new Error('Disabled troop plugin still displayed or saved');
      troopToggle.checked=true;troopToggle.dispatchEvent(new Event('change'));
      if(JSON.parse(window.characterEditor.getContent()).aic.AIVTroops_InitialRole_Slave!=='dig')throw new Error('Troop toggle lost override');
      const roundtrip=window.characterEditor.getContent();window.characterEditor.loadFromContent(roundtrip,null);
      const reloaded=document.querySelector('[data-aic-field="AIVTroops_InitialRole_Slave"]');
      if(reloaded.value!=='dig')throw new Error('Troop role did not reload');
      reloaded.value='';reloaded.dispatchEvent(new Event('change'));
      if('AIVTroops_InitialRole_Slave' in JSON.parse(window.characterEditor.getContent()).aic)throw new Error('Inherit did not remove override');
      const originalCharacter=window.characterEditor.getContent();
      const character=JSON.parse(originalCharacter);
      Object.assign(character.aic,{MaxWood:48,MaxStone:48,MaxResourceVariance:1,MaxFood:100,Farm1:'DairyFarm',Farm2:'AppleFarm',MaxEquipment:6,FletcherSetting:'Both'});
      window.characterEditor.loadFromContent(JSON.stringify(character),null);
      const helperFrame=(itemType,x,y)=>({itemType,tilePositionOfsets:[y*100+x]});
      window.castleEditor.loadDocument({frames:[helperFrame(61,43,43),helperFrame(80,15,15),helperFrame(81,25,25),helperFrame(50,30,30),helperFrame(50,35,35),helperFrame(175,40,40)]},null);
      if(window.characterPopulation.getAvailablePopulation()!==window.castleEditor.getPopulationSummary().provided)throw new Error('Castle population is not the default');
      if(!document.querySelector('.populationSourceRow').hidden)throw new Error('Matching population shows reset button');
      window.characterPopulation.setAvailablePopulation(100);
      if(document.querySelector('.populationSourceRow').hidden)throw new Error('Different population hides reset button');
      document.getElementById('useCastlePopulationBtn').click();
      if(!document.querySelector('.populationSourceRow').hidden)throw new Error('Reset button did not hide after matching population');
      window.characterPopulation.setAvailablePopulation(100);
      window.characterEditor.loadFromContent(JSON.stringify(character),null);
      if(window.characterPopulation.getAvailablePopulation()!==window.castleEditor.getPopulationSummary().provided)throw new Error('Reopening Character did not restore castle population');
      window.characterPopulation.setAvailablePopulation(16);
      if(document.getElementById('characterFearLevel').textContent!=='+1')throw new Error('Fear did not update from castle and population');
      if(!document.getElementById('characterStorage').textContent.includes('Crossbows'))throw new Error('Mixed workshop output missing');
      const cards=[...document.querySelectorAll('[data-character-card]')];
      for(const card of cards){
        card.querySelector(':scope > summary').click();
        if(card.open)throw new Error('Sidebar card did not collapse');
        card.querySelector(':scope > summary').click();
        if(!card.open)throw new Error('Sidebar card did not expand');
      }
      window.characterPopulation.setAvailablePopulation(17);
      if(document.getElementById('characterFearLevel').textContent!=='0')throw new Error('Fear population boundary did not update');
      window.characterEditor.loadFromContent(originalCharacter,null);
      const search=document.getElementById('search');search.value='wood';
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
      if(document.activeElement!==search || search.selectionStart!==0 || search.selectionEnd!==4)throw new Error('Character Ctrl+F did not focus and select the search');
      search.value='';window.appWorkspace.setActive('castle');search.blur();
      const otherFind=new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true});
      document.dispatchEvent(otherFind);
      if(otherFind.defaultPrevented || document.activeElement===search)throw new Error('Character search stole another workspace shortcut');
      let atlasDraws=0;
      const original=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
        if(image?.src?.endsWith('building-parts.png'))atlasDraws++;
        return original.call(this,image,...args);
      };
      const frame=(itemType,x,y)=>({itemType,tilePositionOfsets:[(99-y)*100+x]});
      window.castleEditor.loadDocument({frames:[
        frame(61,43,43),frame(70,25,35),frame(71,38,25),frame(72,55,25),frame(73,66,39),
        frame(144,35,55),frame(105,35,60),frame(145,55,55),frame(105,50,55),
        frame(50,42,64),frame(90,48,68),frame(91,55,67)
      ]},null);
      window.appWorkspace.setActive('castle');
      window.castlePanels.open('iso');
      await window.isoView.mountDock();
      const box=document.getElementById('isoDockBody');
      Object.assign(box.style,{position:'fixed',left:'0',top:'0',width:'1400px',height:'850px',zIndex:'10000'});
      window.isoView.fit();
      for(let i=0;i<200&&atlasDraws<300;i++){window.isoView.paint();await pause();}
      const canvas=document.getElementById('isoDockCanvas'), rect=canvas.getBoundingClientRect();
      for(let i=0;i<2;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,cancelable:true}));
      window.isoView.paint();await pause();
      const png=canvas.toDataURL('image/png');
      const slider=document.getElementById('castleBuildSlider');
      slider.value='1';slider.dispatchEvent(new Event('input',{bubbles:true}));
      await pause();window.isoView.paint();await pause();
      const firstStepStatus=document.getElementById('isoDockStatus').textContent;
      slider.value=slider.max;slider.dispatchEvent(new Event('input',{bubbles:true}));
      await pause();window.isoView.paint();await pause();
      const lastStepStatus=document.getElementById('isoDockStatus').textContent;
      // Real sprite/terrain pixels must be identical after partial and full
      // redraws, including scrubbing backwards. This runs only on CI.
      for(const step of ['2','6','3',slider.max]){
        slider.value=step;slider.dispatchEvent(new Event('input',{bubbles:true}));
        await pause();window.isoView.paint();await pause();
        const partial=canvas.toDataURL();
        window.isoView.refresh();window.isoView.paint();
        if(canvas.toDataURL()!==partial)throw new Error('Partial step redraw differs from full render at step '+step);
      }
      const unchangedRow=document.getElementById('castleBuildList').firstElementChild;
      const completeScene=canvas.toDataURL();
      slider.value='1';slider.dispatchEvent(new Event('input',{bubbles:true}));
      await pause();window.isoView.paint();await pause();
      const incrementalScene=canvas.toDataURL();
      window.isoView.refresh();window.isoView.paint();
      if(canvas.toDataURL()!==incrementalScene)throw new Error('Incremental step differs from a full scene rebuild');

      slider.value=slider.max;slider.dispatchEvent(new Event('input',{bubbles:true}));
      await pause();window.isoView.paint();await pause();
      if(document.getElementById('castleBuildList').firstElementChild!==unchangedRow)throw new Error('Stepping recreated the build list');
      if(canvas.toDataURL()!==completeScene)throw new Error('Step round-trip changed scene pixels');

      for(const id of ['castleShowFire','castleShowRoutes']) {
        const toggle=document.getElementById(id);
        if(!toggle)throw new Error('Missing checkbox '+id);
        toggle.checked=true;toggle.dispatchEvent(new Event('change'));
      }
      let overlay;
      for(let i=0;i<200;i++) {
        overlay=window.castleEditor.getAnalysisOverlay();
        if(!overlay.pending && overlay.image)break;
        await pause();
      }
      if(!overlay.image || overlay.error || !overlay.routes.length)throw new Error('Overlay worker failed: '+JSON.stringify(overlay));
      if(!overlay.routes.some(r=>r.path.length))throw new Error('No worker reaches the keep stockpile');
      if(overlay.routes.some(r=>!r.entry || !(r.workers>0)))throw new Error('Worker entrance marker missing');
      if(overlay.walkability?.length!==10000)throw new Error('Walkability grid missing');
      const overlayResult={routes:overlay.routes.length,reachable:overlay.routes.filter(r=>r.path.length).length};
      window.isoView.paint();await pause();
      const overlayPNG=canvas.toDataURL('image/png');
      const cameraFrames=[];
      const atlas=document.createElement('canvas');atlas.width=120;atlas.height=16;
      const atlasContext=atlas.getContext('2d');
      ['#ff3030','#30ff30','#3030ff','#ffff30'].forEach((color,i)=>{
        atlasContext.fillStyle=color;atlasContext.beginPath();
        atlasContext.moveTo(i*30+15,0);atlasContext.lineTo(i*30+30,8);
        atlasContext.lineTo(i*30+15,16);atlasContext.lineTo(i*30,8);atlasContext.fill();
      });
      const mapAtlases=[0,2,4,6].map(orientation=>{
        atlasContext.fillStyle='rgb('+orientation+',0,0)';atlasContext.fillRect(0,0,1,1);
        return atlas.toDataURL();
      });
      const mapAtlas=mapAtlases[0], locations=new Uint16Array(400*400);locations.fill(65535);
      [[22,31],[72,32],[21,69],[73,70]].forEach(([x,y],i)=>locations[(y+157)*400+x+157]=i);
      const encode=array=>{let text='';for(const byte of new Uint8Array(array.buffer))text+=String.fromCharCode(byte);return btoa(text)};
      const mapDraws=[];
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
        const camera=mapAtlases.indexOf(image?.src);
        if(camera>=0)mapDraws.push({camera:camera*2,tile:args[0]/30,x:args[4],y:args[5]});
        return original.call(this,image,...args);
      };
      const emptyTerrain=encode(new Uint8Array(160000));
      window.isoView.setGameMap({name:'Camera fixture',path:'camera-fixture.map',dataUrl:mapAtlas,keeps:[{x:200,y:200,orientation:0}],
        pathTerrain:{version:5,fingerprint:'camera-fixture',blocked:emptyTerrain,hardBlocked:emptyTerrain,
          heights:emptyTerrain,constructionLift:emptyTerrain,buildFlags:encode(new Uint32Array(160000))}});
      await window.isoView.setMapTiles({path:'camera-fixture.map',atlas:mapAtlas,plaetze:encode(locations),spalten:4,kachelBreite:30,kachelHoehe:16});
      if(window.isoView.turnView(1)!==2)throw new Error('Loaded saved terrain must support rotation without camera captures');
      if(window.isoView.turnView(-1)!==0)throw new Error('Saved terrain rotation did not restore the camera');
      mapDraws.length=0;
      await window.isoView.setMapTiles({path:'camera-fixture.map',nativeRenderer:true,cameras:mapAtlases.map(atlas=>({atlas,plaetze:encode(locations),spalten:4,kachelBreite:30,kachelHoehe:16}))});
      await pause();
      for(let turn=0;turn<=4;turn++){
        if(turn){mapDraws.length=0;window.isoView.turnView(1);}
        await pause();window.isoView.paint();
        cameraFrames.push({orientation:window.isoView.viewRotation(),tiles:[...new Map(mapDraws.map(tile=>[tile.tile,tile])).values()],png:canvas.toDataURL('image/png')});
      }
      mapDraws.length=0;
      window.isoView.paint();
      if(mapDraws.length)throw new Error('Cached redraw replayed terrain draws');
      if(document.getElementById('gameSimulationDialog'))throw new Error('Rejected capture dialog is still present');
      box.removeAttribute('style');
      window.castleEditor.showShortcutDialog();
      await pause();
      const camera=document.querySelector('.castleCameraKey');
      const style=getComputedStyle(camera);
      return {overlayResult, png,atlasDraws,errors,firstStepStatus,lastStepStatus,cameraFrames,cameraBackground:style.backgroundColor,cameraText:style.color,
        status:document.getElementById('isoDockStatus').textContent};
    })().catch(error=>{throw new Error(error.stack||String(error));})`,true);
    fs.writeFileSync(path.join(output,'native-building-components.png'),Buffer.from(result.png.split(',')[1],'base64'));
    const screenshot=await win.webContents.capturePage();
    fs.writeFileSync(path.join(output,'camera-controls.png'),screenshot.toPNG());
    delete result.png;
    for(const [i,frame] of result.cameraFrames.entries()){
      fs.writeFileSync(path.join(output,'camera-rotation-'+i+'.png'),Buffer.from(frame.png.split(',')[1],'base64'));
      delete frame.png;
      assert.equal(frame.tiles.length,4,'All four map markers must remain visible after rotation');
      assert.ok(frame.tiles.every(tile=>tile.camera===frame.orientation),'The selected native camera atlas must match the scene orientation');
    }
    const first=result.cameraFrames[0],last=result.cameraFrames[4];
    for(const tile of first.tiles){
      const restored=last.tiles.find(p=>p.tile===tile.tile);
      assert.ok(Math.abs(tile.x-restored.x)<.0001&&Math.abs(tile.y-restored.y)<.0001,'Four turns must restore map placement');
    }
    assert.notDeepEqual(first.tiles,result.cameraFrames[1].tiles,'The map must turn with the castle');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));
    assert.ok(result.atlasDraws>=300,'Native component atlas did not render');
    assert.deepEqual(result.errors,[],'Renderer errors');
    assert.match(result.firstStepStatus,/^1 items\b/,'First step must hide later buildings');
    assert.match(result.lastStepStatus,/^12 items\b/,'Returning to the last step must restore the castle');
    assert.notEqual(result.cameraBackground,'rgb(255, 255, 255)','Camera control has an unthemed white background');
    assert.notEqual(result.cameraBackground,result.cameraText,'Camera text has no contrast');
    assert.doesNotMatch(result.status,/without a sprite/);
    console.log('Electron renderer passed: native building/farm/bridge components and themed camera controls.');
    clearTimeout(timer);app.exit(0);
  } catch(error) {
    console.error(error);
    for(const win of BrowserWindow.getAllWindows()) {
      try{fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());}catch{}
    }
    clearTimeout(timer);app.exit(1);
  }
})();
