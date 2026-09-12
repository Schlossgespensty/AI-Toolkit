'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const split = require('../src/js/castle-sidebar-layout');

test('divider collapses either end while preserving the prior split for restoration', () => {
  const initial={ratio:.7,collapsed:null};
  const top=split.drag(initial,10,600);
  assert.equal(top.collapsed,'top');
  assert.deepEqual(split.toggle(top,'top'),initial);
  const bottom=split.drag(initial,590,600);
  assert.equal(bottom.collapsed,'bottom');
  assert.deepEqual(split.toggle(bottom,'bottom'),initial);
  assert.deepEqual(split.drag(bottom,300,600),{ratio:.5,collapsed:null});
  assert.deepEqual(split.drag(initial,10,0),initial);
  assert.deepEqual(split.normalize({ratio:NaN,collapsed:'both'}),{ratio:.6,collapsed:null});
});

function setup(store = new Map()) {
  class Element {
    constructor(overview=false) { this.children=[];this.overview=overview;this.hidden=false;this.attrs={};this.events={};this.style={};this.classList={add(){}};this.offsetHeight=30; }
    appendChild(child) { if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);this.children.push(child);child.parentElement=this;return child; }
    append(...children) { children.forEach(child=>this.appendChild(child)); }
    matches() { return this.overview; }
    setAttribute(k,v) { this.attrs[k]=v; }
    addEventListener(k,fn) { this.events[k]=fn; }
    setPointerCapture() {}
    getBoundingClientRect() { return {top:100,height:630}; }
  }
  const left=new Element(),right=new Element(),overview=new Element(true),steps=new Element();
  left.append(steps,overview);right.append(new Element());
  const context={window:{},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
    document:{createElement:()=>new Element(),querySelector:s=>s==='.castleBuildPanel'?left:right}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/js/castle-sidebar-layout.js'),'utf8'),context);
  return {left,right,overview,steps,api:context.window.castleSidebarLayout,store};
}

test('sidebar controls resize, collapse, restore and survive moving overviews between sides', () => {
  const {left,right,overview,steps,api,store}=setup();
  const [top,bar,bottom]=left.children;
  const [topButton,grip,bottomButton]=bar.children;
  assert.equal(steps.parentElement,top);
  assert.equal(overview.parentElement,bottom);
  bottomButton.events.click();
  assert.equal(bottom.hidden,true);
  assert.equal(top.hidden,false);
  assert.equal(bottomButton.attrs['aria-expanded'],'false');
  bottomButton.events.click();
  assert.equal(bottom.hidden,false);
  grip.events.pointerdown({button:0,pointerId:1,preventDefault(){}});
  grip.events.pointermove({pointerId:1,clientY:415});
  grip.events.pointerup({pointerId:1});
  assert.equal(grip.attrs['aria-valuenow'],'50');
  topButton.events.click();
  assert.equal(top.hidden,true);
  assert.equal(bottom.hidden,false);
  const reopened=setup(store);
  assert.equal(reopened.left.children[0].hidden,true);
  assert.equal(reopened.left.children[1].children[1].attrs['aria-valuenow'],'0');
  api.containerFor(right).appendChild(overview);api.refresh();
  assert.equal(bar.hidden,true);
  assert.equal(top.hidden,false); // never leave an empty sidebar after moving its overview
  assert.equal(right.children[1].hidden,false);
  api.containerFor(left).appendChild(overview);api.refresh();
  assert.equal(top.hidden,true); // restores this side's saved choice
});

test('cost total UI reads the selected-step aggregate, excluding future unknown prices', () => {
  const source=fs.readFileSync(path.join(__dirname,'../src/js/castle-cost-panel.js'),'utf8');
  const start=source.indexOf('    els.totalLabel.textContent =');
  const end=source.indexOf('\n',source.indexOf("' (partial: unknown prices)'",start));
  const statement=source.slice(start,end);
  const els={totalLabel:{},stepTotal:{}};
  vm.runInNewContext(statement,{els,ergebnis:{steps:2,cost:{wood:15},unknown:[],wholeCastleCost:{wood:999},wholeCastleUnknown:[999]},costSummary:c=>`${c.wood} wood`});
  assert.equal(els.totalLabel.textContent,'Total through step 2');
  assert.equal(els.stepTotal.textContent,'15 wood');
  assert.ok(source.indexOf('id="castleCostStepTotal"')<source.indexOf('id="castleProductionTotals"'));
});
