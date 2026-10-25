'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');const config=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../config',name),'utf8'));
test('troop behaviour schema exposes 32 optional fields and restricts digging',()=>{
 const pools=config('fieldPools.json'),options=config('optionPools.json');
 const keys=Object.keys(pools).filter(k=>k.startsWith('AIVTroops_'));assert.equal(keys.length,32);
 assert.deepEqual(keys.filter(k=>options[pools[k]].includes('dig')).map(k=>k.split('_').at(-1)).sort(),['Archer','Engineer','Maceman','Pikeman','Slave','Spearman']);
 for(const file of ['template.json','templateOrdered.json'])for(const key of keys)assert.equal(config(file).aic[key],'');
 for(const file of ['sections.json','sectionsOrdered.json'])assert.deepEqual(config(file)['AIV Troop Behaviour'],['aic.AIVTroops_InitialRole']);
 assert.deepEqual(options[pools.AIVTroops_Movement],['','hold','patrol']);
});
test('inherited troop fields are omitted while explicit and unknown plugin data survives saving',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/js/character-editor.js'),'utf8');
 const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function omitInheritedTroopFields('),source.indexOf('function prepareOutputData(')),context);
 const output={aic:{AIVTroops_InitialRole:'',AIVTroops_Movement:'hold',AIVTroops_InitialRole_Slave:'dig',AIVTroops_Unknown:123,MaxFood:42}};
 context.output=output;vm.runInContext('omitInheritedTroopFields(output)',context);
 assert.deepEqual(output.aic,{AIVTroops_Movement:'hold',AIVTroops_InitialRole_Slave:'dig',AIVTroops_Unknown:123,MaxFood:42});
});

test('ox estimates follow plugin checkbox and disabled custom logic',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/js/character-editor.js'),'utf8');
 const context=vm.createContext({toggleOx:{checked:false}});
 vm.runInContext(source.slice(source.indexOf('function calculateOxTethers('),source.indexOf('function calculateMaxPopNeeded(')),context);
 context.a={AIOxTethers_Logic:1,AIOxTethers_MaximumOxTethersPerQuarry:4,AIOxTethers_DynamicMaxOxTethers:3,AIOxTethers_MaxOxTethers:5};
 assert.equal(vm.runInContext('calculateOxTethers(2,a)',context),2);
 context.toggleOx.checked=true;assert.equal(vm.runInContext('calculateOxTethers(2,a)',context),5);
 context.a.AIOxTethers_Logic=0;context.a.AIOxTethers_DisableInitialOxTether=1;assert.equal(vm.runInContext('calculateOxTethers(2,a)',context),0);
 context.a.AIOxTethers_DisableInitialOxTether=0;assert.equal(vm.runInContext('calculateOxTethers(2,a)',context),2);
});

test('troop plugin defaults on and remembers explicit per-file opt-out',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/js/character-editor.js'),'utf8'),stored=new Map();
 const context=vm.createContext({window:{localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)}}});
 vm.runInContext(source.slice(source.indexOf('function troopPluginPreferenceKey('),source.indexOf('function loadFromContent(')),context);
 assert.equal(vm.runInContext('loadTroopPluginPreference(null)',context),true);
 assert.equal(vm.runInContext('loadTroopPluginPreference("C:/AI/A/character.json")',context),true);
 vm.runInContext('saveTroopPluginPreference("C:/AI/A/character.json",false)',context);
 assert.equal(vm.runInContext('loadTroopPluginPreference("c:/ai/a/character.json")',context),false);
 assert.equal(vm.runInContext('loadTroopPluginPreference("C:/AI/B/character.json")',context),true);
 vm.runInContext('saveTroopPluginPreference("C:/AI/A/character.json",true)',context);
 assert.equal(vm.runInContext('loadTroopPluginPreference("C:/AI/A/character.json")',context),true);
});

test('starting troops show as picture tiles with their count, game sprite or letter badge',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/js/character-editor.js'),'utf8');
 const el=tag=>{const e={tagName:tag.toUpperCase(),children:[],dataset:{},style:{},attributes:{},classes:new Set(),textContent:'',
  get className(){return [...e.classes].join(' ');},set className(v){e.classes=new Set(String(v).split(/\s+/).filter(Boolean));},
  classList:{add:n=>e.classes.add(n),contains:n=>e.classes.has(n)},
  appendChild(c){e.children.push(c);return c;},append(...c){e.children.push(...c);},replaceChildren(){e.children=[];},
  setAttribute(k,v){e.attributes[k]=v;},querySelector:t=>e.children.find(c=>c.tagName===t.toUpperCase())||null};return e;};
 let resolveSkins;
 const context=vm.createContext({document:{createElement:el},console,Promise,
  window:{electronAPI:{loadAivSkins:()=>new Promise(r=>{resolveSkins=r;})},
   castlePalette:{unitBadge:t=>t===6?{text:'Arc',fill:'#3d6fb6',ink:'#fff'}:null}},
  createField:(key,value)=>{const f=el('div');const s=el('span');s.textContent=key;const i=el('input');i.value=value;f.append(s,i);return f;}});
 vm.runInContext(source.slice(source.indexOf('const START_TROOP_UNITS'),source.indexOf('function sectionHeading(')),context);
 const tile=vm.runInContext('createUnitTile("EuropArcher",5,{})',context);
 assert.equal(tile.tagName,'LABEL');
 assert.ok(tile.classList.contains('characterUnitTile')&&tile.classList.contains('characterUnitRowStart'));
 const [picture,name,input]=tile.children;
 assert.equal(input.value,5);assert.equal(input.attributes['aria-label'],'EuropArcher');
 assert.equal(picture.children[0].textContent,'Arc','letter badge until game art arrives');
 resolveSkins({skins:{6:'asset://units/archer.png','unit-monk':'asset://units/monk.png'}});await new Promise(r=>setTimeout(r,0));
 assert.equal(picture.children[0].tagName,'IMG');assert.equal(picture.children[0].src,'asset://units/archer.png');
 const monk=vm.runInContext('createUnitTile("Monk",0,{})',context);
 assert.equal(monk.children[0].children[0].textContent,'Mon','without art or badge the name shows first');
 await new Promise(r=>setTimeout(r,0));
 assert.equal(monk.children[0].children[0].src,'asset://units/monk.png','the monk has no marker, only its own key');
 assert.ok(!monk.classList.contains('characterUnitRowStart'));
});

test('character sections use two columns only from 1000 px of form width',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/css/combined.css'),'utf8');
 assert.match(css,/\.characterForm \{[^}]*container: characterForm \/ inline-size;/);
 const block=css.slice(css.indexOf('@container characterForm (min-width: 1000px)'));
 assert.ok(block.length<css.length,'two-column container query exists');
 assert.match(block.slice(0,block.indexOf('\n}\n')),/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
 const source=fs.readFileSync(path.join(__dirname,'../src/js/character-editor.js'),'utf8');
 assert.match(source,/sec\.fields\.className = "characterFieldGrid"/);
});
