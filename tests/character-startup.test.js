'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/js/character-editor.js'),'utf8');
test('character readiness waits for every config, including legacy names, before project loading', async () => {
  let release; const first = new Promise(resolve => { release = resolve; });
  const loaded=[]; let rendered=false;
  const context=vm.createContext({window:{electronAPI:{loadConfig:async name=>{
    if (name==='template.json') await first;
    loaded.push(name); return name==='legacyKeyMap.json'?{old:'lord'}:{};
  }}},console,alert:()=>{},savedCharacterSnapshot:'saved',setActiveTemplateButton:()=>{},render:()=>{rendered=true;}});
  vm.runInContext(source.slice(0,source.indexOf('function standardTemplate()')),context);
  const ready=vm.runInContext('characterReady',context);
  assert.equal(rendered,false); assert.equal(loaded.length,0);
  release(); await ready;
  assert.equal(rendered,true); assert.equal(loaded.length,11);
  assert.equal(vm.runInContext('legacyKeyMap.old',context),'lord');
  const library=fs.readFileSync(path.join(__dirname,'../src/js/ucp-library.js'),'utf8');
  assert.ok(library.indexOf('await window.characterEditor.ready') < library.indexOf('window.characterEditor.loadFromContent'));
});
test('configuration failures reject readiness instead of allowing a half-initialized project', async () => {
  const context=vm.createContext({window:{electronAPI:{loadConfig:async()=>{throw new Error('Missing configuration');}}},console:{error(){}},alert(){}});
  vm.runInContext(source.slice(0,source.indexOf('function standardTemplate()')),context);
  await assert.rejects(vm.runInContext('characterReady',context),/Missing configuration/);
  assert.equal(vm.runInContext('isInitialized',context),false);
});
