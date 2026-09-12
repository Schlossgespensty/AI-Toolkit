const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/js/castle-cost-panel.js'),'utf8');
const methods = source.slice(source.indexOf('  function cancelBalanceRefresh()'),source.indexOf('  function goodSymbol('));
function setup() {
  const button={disabled:false}, pending=[];
  const state={balanceLoadToken:0,balances:{},choice:'vanilla',icons:{}};
  const context={state,els:{wurzel:{querySelector:()=>button}},baueOberflaeche:()=>true,
    fuelleBalanceListe:()=>{},zeichne:()=>{},sichere:()=>{},
    window:{castleBalance:{validate:value=>value},electronAPI:{readInstalledBalance:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}}};
  vm.runInNewContext(methods+'\nthis.load=loadProjectBalance;this.cancel=cancelBalanceRefresh;',context);
  return {context,state,button,pending};
}
test('a slow earlier project cannot replace the current project balance',async()=>{
  const {context,state,button,pending}=setup();
  const first=context.load(),second=context.load();
  pending[1].resolve({name:'new',profile:{buildings:{}},filePath:'new.json'});await second;
  pending[0].resolve({name:'old',profile:{buildings:{}},filePath:'old.json'});await first;
  assert.equal(state.choice,'UCP: new');assert.equal(state.balanceStatus,'ready');assert.equal(button.disabled,false);
  assert.equal(state.balances['UCP: old'],undefined);
});
test('a manual choice survives an earlier failed automatic refresh',async()=>{
  const {context,state,button,pending}=setup();const request=context.load();
  context.cancel();state.choice='File: chosen';state.balanceStatus='ready';state.balanceError='';
  pending[0].reject(new Error('old failure'));await request;
  assert.equal(state.choice,'File: chosen');assert.equal(state.balanceError,'');assert.equal(button.disabled,false);
});
