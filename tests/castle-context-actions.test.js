const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm');
const geometry = require('../src/js/castle-geometry');
const {direction} = require('../src/js/castle-pie-menu');
const {clipboardFromMembers} = require('../src/js/editor-extras');
const definitions = require('../config/aiv_constants.json');

test('right drag has a neutral center and four stable directional actions', () => {
  for (const [x,y,action] of [[0,0,'deselect'],[23,0,'deselect'],[0,-70,'merge'],[80,1,'replace'],[0,80,'cut'],[-80,0,'groups'],[10,90,'cut']]) assert.equal(direction(x,y),action);
});

test('placement matrix protects surface tools, allows buildings over surfaces and excludes stairs from merges', () => {
  for (const next of [99,106]) for (const old of [25,26,35,46,99,106,52,145]) assert.equal(geometry.placementOverlap(next,old,definitions),'block');
  for (const next of [52,145,110,79,53]) for (const old of [25,26,35,46,99,106]) assert.equal(geometry.placementOverlap(next,old,definitions),'replace');
  assert.equal(geometry.placementOverlap(25,25,definitions),'block');
  assert.equal(geometry.placementOverlap(52,52,definitions),'block');
  assert.equal(geometry.placementOverlap(6,25,definitions),'allow');
  assert.deepEqual(geometry.MERGEABLE_TYPES,[25,26,35,46,99,106]);
});

test('saved group is a reusable relative clipboard even after its original placements are deleted', () => {
  const members=[{type:61,off:0},{type:25,off:2030},{type:25,off:2031},{type:9022,off:2130}];
  const buffer=clipboardFromMembers(members,definitions);
  assert.equal(buffer.count,3);
  assert.deepEqual(buffer.groups[0],{kind:'frame',itemType:25,entries:[{type:25,dx:0,dy:0},{type:25,dx:1,dy:0}]});
  assert.equal(buffer.groups[1].kind,'unit');
  assert.equal(buffer.groups[1].entries[0].dy,1);
  assert.equal(members.length,4);
});

test('placement validation refuses locked replacements and protects moat from pitch', () => {
  const source=fs.readFileSync(require.resolve('../src/js/castle-editor'),'utf8');
  let locked=false, old=25;
  const context=vm.createContext({geometry,state:{constants:definitions},Set,
    offsetToXY:()=>({x:0,y:0}), boundsError:()=>'',maxAmount:()=>null,
    countType:()=>0, overlapMode:type=>definitions[type]?.overlap||'block',
    footprintRects:()=>[{left:0,right:0,bottom:0,top:0}],
    placementRefs:()=>[{type:old,off:0,ref:'f:1:0'}],refIsLocked:()=>locked,itemName:type=>definitions[type].name});
  vm.runInContext(source.slice(source.indexOf('  function validatePlacement('),source.indexOf('  function lineObstacleMap(')),context);
  assert.equal(context.validatePlacement(52,0).ok,true);
  locked=true; assert.equal(context.validatePlacement(52,0).ok,false);
  locked=false;old=106;assert.equal(context.validatePlacement(99,0).ok,false);
});

test('right gestures release capture; cancellation and focus loss never invoke an action', () => {
  const {bind} = require('../src/js/castle-pie-menu');
  function target() {
    const handlers = {};
    return {handlers, addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      fire(type, values={}) { for (const fn of handlers[type] || []) fn({button:2,pointerId:1,clientX:300,clientY:300,preventDefault(){},stopImmediatePropagation(){},...values}); }};
  }
  const win=Object.assign(target(),{innerWidth:1000,innerHeight:800});
  let menusShown=0;
  const doc=Object.assign(target(),{defaultView:win,body:{appendChild(){menusShown++;}},createElement(){return {
    style:{},dataset:{},children:[],setAttribute(){},addEventListener(){},remove(){},
    appendChild(child){this.children.push(child);},querySelector(){return {focus(){}};}
  };}});
  let captured=false;
  const canvas=Object.assign(target(),{ownerDocument:doc,setPointerCapture(){captured=true;},hasPointerCapture(){return captured;},releasePointerCapture(){captured=false;}});
  let neutral='deselect';
  const actions=[]; bind(canvas, action=>actions.push(action), () => '', () => neutral); bind(canvas,()=>assert.fail('bound twice'));
  canvas.fire('pointerdown');
  assert.equal(menusShown,1,'active right press retains the existing pie menu');
  canvas.fire('pointermove',{clientY:310});
  assert.equal(menusShown,1,'pointer jitter does not create another menu');
  canvas.fire('pointermove',{clientY:220});
  assert.equal(menusShown,1,'directional drag reuses the active menu');
  assert.equal(captured,true,'opening the menu keeps capture until release');
  canvas.fire('pointerup',{clientY:220});
  assert.deepEqual(actions,['merge']);assert.equal(captured,false);
  for (const cancel of [()=>canvas.fire('pointercancel'),()=>win.fire('blur'),()=>doc.fire('keydown',{key:'Escape'})]) {
    canvas.fire('pointerdown');cancel();canvas.fire('pointerup',{clientX:400});
    assert.equal(captured,false);assert.deepEqual(actions,['merge']);
  }
  canvas.fire('pointerdown');canvas.fire('pointerup');assert.deepEqual(actions,['merge','deselect']);
  assert.equal(menusShown,5,'active selection gestures retain the previous menu behavior');
  neutral='groups';canvas.fire('pointerdown');canvas.fire('pointerup');
  assert.deepEqual(actions,['merge','deselect','groups'],'idle right-click opens groups directly');
  canvas.fire('pointerdown');canvas.fire('pointermove',{clientY:200});canvas.fire('pointerup',{clientY:200});
  assert.equal(actions.at(-1),'groups');assert.equal(menusShown,5,'idle right-click never shows the full pie');
  // Windows fires contextmenu after the release, on the groups dialog now under
  // the pointer; only that one is swallowed, later menus in text fields work.
  const menu=()=>{let blocked=false;doc.fire('contextmenu',{preventDefault(){blocked=true;}});return blocked;};
  canvas.fire('pointerdown');canvas.fire('pointerup');
  assert.equal(menu(),true,'the browser menu never covers the groups dialog');
  assert.equal(menu(),false);
});

test('only an idle canvas uses direct groups; selections and placement previews retain the pie', () => {
  const source=fs.readFileSync(require.resolve('../src/js/castle-editor'),'utf8');
  const start=source.indexOf('    neutralContextAction:');
  const code='({' + source.slice(start,source.indexOf('    runContextAction(',start)) + '})';
  const state={selected:new Set(),currentItemType:null,tool:'select',copyBuffer:null};
  const api=vm.runInNewContext(code,{state,isPlacementTool: tool=>['single','line','brush','bucket'].includes(tool)});
  assert.equal(api.neutralContextAction(),'groups');
  state.selected.add('f:1:0');assert.equal(api.neutralContextAction(),'deselect');
  state.selected.clear();state.currentItemType=25;assert.equal(api.neutralContextAction(),'groups','Select/Move is not holding the last palette item');
  state.tool='single';assert.equal(api.neutralContextAction(),'deselect');
  state.currentItemType=null;state.tool='copy';state.copyBuffer={count:1};assert.equal(api.neutralContextAction(),'deselect');
  state.copyBuffer=null;assert.equal(api.neutralContextAction(),'groups');
});


test('Replace and Merge are selection commands, never persistent tools', () => {
  const source=fs.readFileSync(require.resolve('../src/js/castle-editor'),'utf8');
  const start=source.indexOf('    runContextAction(action, position)');
  const code='({' + source.slice(start,source.indexOf('    openFile,',start)) + '})';
  const state={tool:'brush',selected:new Set()};
  const opened=[];
  const api=vm.runInNewContext(code,{state,setTool:tool=>{state.tool=tool;},setStatus(){},
    openReplacementDialog:()=>opened.push('replace'),mergeArea:()=>opened.push('merge')});
  for (const action of ['replace','merge']) {
    state.tool='brush';api.runContextAction(action);
    assert.equal(state.tool,'select');assert.equal(opened.length,0);
  }
  state.selected.add('f:1:0');
  for (const action of ['replace','merge']) {
    state.tool='brush';api.runContextAction(action);assert.equal(state.tool,'select');
  }
  assert.deepEqual(opened,['replace','merge']);
});
