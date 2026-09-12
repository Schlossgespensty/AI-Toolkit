'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const extras= require('../src/js/editor-extras');
const clipSource=read('src/js/editor-extras.js');
const projectSource=read('src/js/ucp-library.js');
const buffer=type=>({count:1,groups:[{kind:'frame',itemType:type,entries:[{type,dx:0,dy:0}]}]});

function clipboardWindow(store){
 const context={clipboard:null,rememberedBuffer:null,CLIP_STORE:'clipboard',sanitizeClipboard:extras.sanitizeClipboard,
   ex:{state:{copyBuffer:null},setStatus(){}},updateClipboardButton(){},
   readStore:(key,fallback)=>store.has(key)?JSON.parse(store.get(key)):fallback,
   writeStore:(key,value)=>value===null?store.delete(key):store.set(key,JSON.stringify(value))};
 vm.createContext(context);
 vm.runInContext(clipSource.slice(clipSource.indexOf('  function loadClipboard('),clipSource.indexOf('  function updateClipboardButton(')),context);
 return context;
}

test('two castle windows paste the newest copy, not their cached selection',()=>{
 const store=new Map(),a=clipboardWindow(store),b=clipboardWindow(store);
 a.ex.state.copyBuffer=buffer(25);a.rememberClipboard();
 b.ex.state.copyBuffer=buffer(73);b.rememberClipboard();
 // A plain mouse release in A must not publish its old copy over B's new one.
 a.rememberClipboard();
 assert.equal(a.armClipboard(),true);
 assert.equal(a.ex.state.copyBuffer.groups[0].itemType,73);
 // Placing a restored copy also must not overwrite a subsequent foreign copy.
 b.ex.state.copyBuffer=buffer(70);b.rememberClipboard();a.rememberClipboard();
 assert.equal(a.armClipboard(),true);
 assert.equal(a.ex.state.copyBuffer.groups[0].itemType,70);
 b.clearClipboard();
 assert.equal(a.armClipboard(),false);
 assert.equal(a.ex.state.copyBuffer,null);
});

test('a freshly opened castle window can use the persisted clipboard',()=>{
 const store=new Map(),a=clipboardWindow(store);
 a.ex.state.copyBuffer=buffer(73);a.rememberClipboard();
 const b=clipboardWindow(store);b.loadClipboard();
 assert.equal(b.armClipboard(),true);
 b.ex.state.copyBuffer.groups[0].entries[0].dx=8;
 assert.equal(JSON.parse(store.get('clipboard')).groups[0].entries[0].dx,0);
});

function projectWindow({restore=true,interrupt=false,castle='GreekSea.aiv',rootPath='D:/Games/Liga'}={}){
 const saved={gameRoot:rootPath,aiRoot:rootPath+'/ucp/plugins/Test/resources/ai/Gatekeeper',castleFile:castle,workspace:'character'};
 const store=new Map([['aiv.lastProject.v1',JSON.stringify(saved)]]),events=new Map(),opened=[],active=[];
 const state={initialized:false,gameRoot:null,library:null,loadedProject:null};
 const window={localStorage:{getItem:key=>store.get(key)||null,setItem:(key,v)=>store.set(key,v)},
   location:{search:'?restoreProject='+(restore?'1':'0')},
   addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key),
   electronAPI:{getUcpInstallation:async()=> 'D:/Games/Liga'},
   appWorkspace:{getActive:()=> 'castle',setActive:name=>active.push(name)}};
 const context={window,state,URLSearchParams,console,renderList(){},renderDetails(){},setStatus(){},
   scan:async()=>{state.library={ais:[{key:'gatekeeper',rootPath:'D:/Games/Liga/ucp/plugins/Test/resources/ai/Gatekeeper'}]};if(interrupt)events.get('pointerdown')();},
   openSelected:async options=>{opened.push(options);return true;}};
 vm.createContext(context);
 vm.runInContext(projectSource.slice(projectSource.indexOf('  const LAST_PROJECT'),projectSource.indexOf('  const placeholderPortrait')),context);
 vm.runInContext(projectSource.slice(projectSource.indexOf('  async function initialize('),projectSource.indexOf('  window.ucpLibrary =')),context);
 return {context,state,store,opened,active};
}

test('startup restores the exact project, selected castle and workspace',async()=>{
 const setup=projectWindow();await setup.context.initialize();
 assert.equal(setup.state.selectedKey,'gatekeeper');
 assert.equal(setup.opened[0].castleFile,'GreekSea.aiv');
 assert.deepEqual(setup.active,['character']);
 setup.state.loadedProject={aiRoot:'D:/Games/Liga/ucp/plugins/Test/resources/ai/Gatekeeper',castleFile:'Gatekeeper.aiv'};
 setup.context.rememberProject();
 assert.equal(JSON.parse(setup.store.get('aiv.lastProject.v1')).castleFile,'Gatekeeper.aiv');
});

test('new windows, user interaction, another installation and invalid castle paths prevent restore',async()=>{
 for(const options of [{restore:false},{interrupt:true},{rootPath:'E:/Different'},{castle:'../other.aiv'}]){
   const setup=projectWindow(options);await setup.context.initialize();
   assert.equal(setup.opened.length,0,JSON.stringify(options));
 }
});
