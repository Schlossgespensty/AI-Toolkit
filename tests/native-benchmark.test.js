const test = require('node:test');
const assert = require('node:assert/strict');
const helper = import('../scripts/lib/cdp-client.mjs');

test('benchmark accepts debug transport loss only after its owned child exits successfully', async () => {
  const {closeOwnedEditor,CdpDisconnectedError}=await helper;
  for(const disconnect of [false,true]) {
    const child={exitCode:null};let calls=0;
    const client={evaluate:async()=>{if(++calls===1)return false;child.exitCode=0;if(disconnect)throw new CdpDisconnectedError('closed');}};
    const result=await closeOwnedEditor(client,child);
    assert.equal(result.exitCode,0);assert.equal(result.debugDisconnect,disconnect?'closed':undefined);
  }
});

test('benchmark never disguises a live child, bad exit or evaluation error as normal teardown', async () => {
  const {closeOwnedEditor,CdpDisconnectedError}=await helper;
  for(const [exitCode,error,expected] of [
    [null,new CdpDisconnectedError('closed'),/did not close/],
    [3,new CdpDisconnectedError('closed'),/exited with 3/],
    [0,new Error('close command rejected'),/close command rejected/],
  ]) {
    const child={exitCode:null};let calls=0;
    const client={evaluate:async()=>{if(++calls===1)return false;child.exitCode=exitCode;throw error;}};
    await assert.rejects(closeOwnedEditor(client,child,0),expected);
  }
});

test('benchmark refuses to close dirty documents or an already exited child', async () => {
  const {closeOwnedEditor}=await helper;let calls=0;
  const client={evaluate:async()=>{calls++;return true;}};
  await assert.rejects(closeOwnedEditor(client,{exitCode:null}),/dirty/);
  assert.equal(calls,1);
  await assert.rejects(closeOwnedEditor(client,{exitCode:0}),/already exited/);
  assert.equal(calls,1);
});
