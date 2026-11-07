/* eslint-disable @typescript-eslint/no-require-imports */
// Actual hook + request wrapper through isolated scheduling/network only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'verify-workspace-audit.cjs'),'utf8');
const boundary=source.indexOf('\nfunction workerStatus()');
assert(boundary>0,'Shared isolated harness boundary must exist');
const {harness}=new Function('require','__dirname',source.slice(0,boundary)+'\nreturn {harness};')(require,__dirname);
const key='KRX:005930';
const row=(note,version=1,deleted=false)=>({key,data:{note},version,deleted,updatedAt:'2026-11-07T01:00:00Z'});
async function ready(t){const h=harness('lib/cloud-saved.ts','NOTE','useCloudSaved');t.after(h.unmount);h.render();await h.flush();h.respond(0,{owner:'owner-A',items:[row('private-A')]});await h.flush();return h;}

for(const deletion of [false,true]) test(`${deletion?'DELETE':'PUT'} sends expected owner, clears stale state and reloads without write replay`,async t=>{
  const h=await ready(t), staleSave=h.tree().save;
  const pending=staleSave(key,deletion?null:{note:'draft-A'});await h.flush();
  assert.equal(h.requests[1].init.method,deletion?'DELETE':'PUT');
  assert.equal(h.requests[1].init.headers['X-StockPilot-Owner'],'owner-A');
  h.respond(1,{detail:{code:'OWNER_CHANGED',message:'계정 변경',current:row('do-not-merge-B',7)}},409);
  assert.equal(await pending,false);await h.flush();
  assert.equal(h.tree().authenticated,null);assert.equal(h.tree().owner,null);assert.equal(h.tree().items.length,0);
  assert(h.tree().error.includes('로그인 계정이 바뀌어'));
  assert.equal(h.requests.length,3);assert.equal(h.requests[2].url,'/api/personal/saved?kind=NOTE');assert(!h.requests[2].init.method);
  assert.equal(await staleSave(key,{note:'old-closure'}),false);
  assert.equal(await h.tree().save(key,{note:'pending-owner'}),false);assert.equal(h.requests.length,3);
  h.respond(2,{owner:'owner-B',items:[row('private-B')]});await h.flush();
  assert.equal(h.tree().owner,'owner-B');assert.equal(h.tree().items[0].data.note,'private-B');
  assert(h.tree().error.includes('변경을 적용하지 않았어요'));assert.equal(h.requests.length,3);
});

test('late callback bound to prior owner cannot initiate a new write after an identity refresh',async t=>{
  const h=await ready(t), saveA=h.tree().save;
  h.tree().refresh();await h.flush();h.respond(1,{owner:'owner-B',items:[row('private-B')]});await h.flush();
  assert.equal(await saveA(key,{note:'private-A'}),false);assert.equal(h.requests.length,2);
  const pending=h.tree().save(key,{note:'new-B'});await h.flush();
  assert.equal(h.requests[2].init.headers['X-StockPilot-Owner'],'owner-B');
  h.respond(2,row('new-B',2));assert.equal(await pending,true);await h.flush();
  assert.equal(h.tree().items[0].data.note,'new-B');assert(!h.requests[3].init.method);
});

test('failed owner-mismatch recovery stays empty and cannot write until a successful read',async t=>{
  const h=await ready(t);const pending=h.tree().save(key,{note:'draft-A'});await h.flush();
  h.respond(1,{detail:{code:'OWNER_CHANGED'}},409);assert.equal(await pending,false);await h.flush();
  h.respond(2,{detail:'isolated offline'},503);await h.flush();
  assert.equal(h.tree().owner,null);assert.equal(h.tree().authenticated,null);assert.equal(h.tree().items.length,0);
  assert(h.tree().error.includes('로그인 계정이 바뀌어'));assert(h.tree().error.includes('isolated offline'));
  assert.equal(await h.tree().save(key,{note:'must-not-write'}),false);assert.equal(h.requests.length,3);
  h.tree().refresh();await h.flush();assert(!h.requests[3].init.method);
});

test('unknown/blank owner prevents writes while retaining read-only recovery',async t=>{
  const h=harness('lib/cloud-saved.ts','NOTE','useCloudSaved');t.after(h.unmount);h.render();await h.flush();
  assert.equal(await h.tree().save(key,{note:'unknown'}),false);
  h.respond(0,{owner:' ',items:[]});await h.flush();assert.equal(h.tree().authenticated,null);
  assert.equal(await h.tree().save(key,{note:'unknown'}),false);assert.equal(h.requests.length,1);
});

test('late save acknowledgement after unmount cannot restore data or schedule requests',async t=>{
  const h=await ready(t);const pending=h.tree().save(key,{note:'late-A'});await h.flush();h.unmount();
  h.respond(1,row('late-A',2));assert.equal(await pending,false);await h.flush();
  assert.equal(h.tree().items[0].data.note,'private-A');assert.equal(h.requests.length,2);
});

test('changing saved kind drops private old rows and ignores the previous kind acknowledgement',async t=>{
  const h=await ready(t);const pending=h.tree().save(key,{note:'late-note'});await h.flush();
  h.props('FAVORITE');await h.flush();assert.equal(h.tree().items.length,0);
  h.respond(2,{owner:'owner-B',items:[]});await h.flush();
  h.respond(1,row('late-note',2));assert.equal(await pending,false);await h.flush();
  assert.equal(h.tree().items.length,0);assert.equal(h.requests[3].url,'/api/personal/saved?kind=FAVORITE');
  assert(!h.requests[3].init.method);h.respond(3,{owner:'owner-B',items:[]});await h.flush();assert.equal(h.tree().owner,'owner-B');
});
