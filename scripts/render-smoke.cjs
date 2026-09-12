'use strict';
// Real Electron rendering on GitHub's Windows runner only. This deliberately
// refuses local execution so it cannot interrupt an active editing session.
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run this rendering check on GitHub Actions, not the workstation.');
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname,'../artifacts/render');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-render-')));
app.disableHardwareAcceleration();
const loaded = new Promise(resolve => app.once('browser-window-created',(_event,win) => {
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
const timer = setTimeout(()=>{console.error('Renderer smoke check timed out.');app.exit(1);},45000);
require('../main');
(async()=>{
  try {
    const win = await loaded;
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
      for(let i=0;i<200&&!window.castleEditor?.extras.state.constants['73'];i++)await pause();
      const errors=[];
      window.addEventListener('error',event=>errors.push(event.message));
      window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
      window.alert=message=>{throw new Error(message)};
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
      box.removeAttribute('style');
      window.castleEditor.showShortcutDialog();
      await pause();
      const camera=document.querySelector('.castleCameraKey');
      const style=getComputedStyle(camera);
      return {png,atlasDraws,errors,firstStepStatus,lastStepStatus,cameraBackground:style.backgroundColor,cameraText:style.color,
        status:document.getElementById('isoDockStatus').textContent};
    })()`,true);
    fs.writeFileSync(path.join(output,'native-building-components.png'),Buffer.from(result.png.split(',')[1],'base64'));
    const screenshot=await win.webContents.capturePage();
    fs.writeFileSync(path.join(output,'camera-controls.png'),screenshot.toPNG());
    delete result.png;
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
