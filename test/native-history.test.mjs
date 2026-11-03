import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';
const root='00000000-0000-4000-8000-000000000901',child='00000000-0000-4000-8000-000000000902',grand='00000000-0000-4000-8000-000000000903';
const row=(id,parent,path)=>({id,parentThreadId:parent,source:{subAgent:{thread_spawn:{parent_thread_id:parent,agent_path:path}}}});
function page(threadId=child,extra={}) {return {connected:true,threadId,threads:[{id:root},row(child,root,'/root/fixture'),row(grand,child,'/root/fixture/grand')],
  turns:[{id:'fixture-turn',status:'completed',items:[{id:'fixture-message',type:'agentMessage',text:'Visible fixture result'},{id:'fixture-hidden',type:'reasoning',text:'Must never be retained'}]}],nextCursor:'fixture-older-cursor',truncated:false,...extra};}
function fixture(t,reader=()=>page()) {
  const dir=mkdtempSync(join(tmpdir(),'workbench-direct-history-')),store=new Store(dir,{nativeHistoryReader:reader});
  t.after(()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  let b=store.create('Synthetic direct history test');b=store.bind(b.id,root,b.revision);
  store.reportMember(b.id,{memberId:'child',name:'Child fixture',parentId:'lead',nativeId:child,runtimeRef:'/root/fixture',status:'unknown',evidence:'Synthetic exact identity'});
  const args={boardId:b.id,memberId:'child',expectedNativeId:child};
  return {store,args,read:()=>dispatch(store,'team_read_records',{boardId:b.id,nodeKind:'member',nodeId:'child'}),sync:(more={})=>dispatch(store,'team_sync_native_history',{...args,...more})};
}

test('direct page verifies exact parent chain, filters reasoning, and repeat reads update time without duplicate records',t=>{
  const requests=[],f=fixture(t,r=>{requests.push(r);return page();});
  const a=f.sync(),b=f.sync();
  assert.equal(a.latestHostPage.source,'public-app-server-page');assert.equal(a.latestHostPage.threadId,child);
  assert.equal(a.latestHostPage.turns[0].items.length,1);assert.equal(a.latestHostPage.turns[0].items[0].text,'Visible fixture result');
  assert.equal(b.sync.duplicate,true);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,1);
  assert.equal(b.node.nativeHistoryRead.status,'succeeded');assert.equal(b.latestHostPage.readAt,b.node.nativeHistoryRead.readAt);
  assert.deepEqual(requests[0].threadIds,[child,root]);assert.equal(requests[0].rootThreadId,root);
  assert.equal(requests[0].runtimeRef,'/root/fixture');assert.equal(requests[0].cursor,null);
  assert(!JSON.stringify(f.read()).includes('Must never be retained'));
});

test('older pages only use a saved direct cursor from the same exact board/member/generation',t=>{
  const requests=[],f=fixture(t,r=>{requests.push(r);return r.cursor?page(child,{turns:[{id:'older-turn',status:'completed',items:[]}],nextCursor:null}):page();});
  const a=f.sync(),b=f.sync({beforeRecordId:a.latestHostPage.recordId});
  assert.equal(requests[1].cursor,'fixture-older-cursor');assert.equal(b.latestHostPage.turns[0].id,'older-turn');
  assert.throws(()=>f.sync({beforeRecordId:b.latestHostPage.recordId}),{code:'NO_OLDER_PAGE'});
  assert.throws(()=>f.sync({beforeRecordId:'not-this-members-page'}),{code:'CURSOR_SCOPE_MISMATCH'});
  const latest=f.sync();assert.equal(latest.latestHostPage.recordId,a.latestHostPage.recordId);
  assert.equal(latest.sync.duplicate,true);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,2);
});

test('public empty history stays empty and never substitutes the root conversation',t=>{
  const f=fixture(t,()=>page(child,{turns:[],nextCursor:null})),result=f.sync();
  assert.equal(result.sync.empty,true);assert.equal(result.latestHostPage.threadId,child);
  assert.deepEqual(result.latestHostPage.turns,[]);assert.equal(result.latestHostPage.sourceTool,'app-server.thread/turns/list');
});

test('direct read failure retains old page with a dated visible failure and no fabricated success',t=>{
  let fail=false;const f=fixture(t,()=>{if(fail)throw new Error('thread/turns/list RPC error -32601');return page();});
  const before=f.sync();fail=true;
  assert.throws(()=>f.sync(),e=>e.code==='PUBLIC_HISTORY_UNAVAILABLE'&&e.message.includes('-32601'));
  const after=f.read();assert.equal(after.latestHostPage.recordId,before.latestHostPage.recordId);
  assert.equal(after.node.nativeHistoryRead.status,'failed');assert(after.node.nativeHistoryRead.reason.includes('-32601'));
});

test('mismatched IDs, conflicting metadata and paths never persist a conversation page',t=>{
  let response;const f=fixture(t,()=>response);
  for(const bad of [page(root),page(child,{threads:[{id:root},row(child,grand,'/root/fixture')]}),page(child,{threads:[{id:root},row(child,root,'/root/wrong')]}),page(child,{turns:[{},{}]})]) {
    response=bad;assert.throws(()=>f.sync());
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,0);
  }
});

test('grandchild reads use the full recorded/public ancestry, not a shared session assumption',t=>{
  let requested;const f=fixture(t,r=>{requested=r;return page(grand);});
  f.store.reportMember(f.args.boardId,{memberId:'grand',name:'Grandchild',parentId:'child',nativeId:grand,runtimeRef:'/root/fixture/grand',status:'unknown',evidence:'Synthetic nested member'});
  const result=f.sync({memberId:'grand',expectedNativeId:grand});
  assert.deepEqual(requested.threadIds,[grand,child,root]);assert.equal(result.latestHostPage.threadId,grand);
});

test('stale target, archive and unbound boards fail before calling the public reader',t=>{
  let calls=0;const f=fixture(t,()=>{calls++;return page();});
  assert.throws(()=>f.sync({expectedNativeId:grand}),{code:'ACTION_TARGET_CHANGED'});assert.equal(calls,0);
  f.store.archive(f.args.boardId,f.store.read(f.args.boardId).revision,'archive',true);
  assert.throws(()=>f.sync(),{code:'BOARD_ARCHIVED'});assert.equal(calls,0);
});

test('binding changed during public read atomically rejects saved history under the new origin',t=>{
  let f;f=fixture(t,()=>{
    const b=f.store.read(f.args.boardId);
    f.store.bind(b.id,grand,b.revision,{previousSessionId:root,confirmRebind:true,evidence:'Synthetic explicit rebind race'});
    return page();
  });
  assert.throws(()=>f.sync());assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,0);
  assert.equal(f.store.read(f.args.boardId).rootSessionId,grand);
});
