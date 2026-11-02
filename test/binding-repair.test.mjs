import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';

const full = '12345678-1234-4000-8000-000000000001';
function fixture(t, legacy = false) {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-binding-repair-')), store = new Store(dir), board = store.create('Binding fixture');
  if (legacy) store.transact(board.id, b => { b.rootSessionId = '12345678'; b.members[0].nativeId = '12345678'; });
  t.after(() => { store.close(); assert(resolve(dir).startsWith(resolve(tmpdir()) + sep)); rmSync(dir, { recursive: true, force: true }); });
  const bind = extra => dispatch(store, 'team_bind_session', { boardId: board.id, sessionId: full, expectedRevision: store.read(board.id).revision, ...extra });
  return { store, board, bind };
}

test('new conversation bindings reject short, anonymous and path identifiers without writing', t => {
  const f = fixture(t), before = f.store.read(f.board.id);
  for (const sessionId of ['12345678', 'anonymous-session', '/root/worker']) assert.throws(() => f.bind({ sessionId }), { code: 'INVALID_THREAD_ID' });
  assert.deepEqual(f.store.read(f.board.id), before);
  assert.equal(f.bind({}).board.members[0].nativeId, full);
});

test('legacy or valid binding changes require exact previous value, explicit confirmation and evidence', t => {
  const f=fixture(t,true),before=f.store.read(f.board.id);
  assert.throws(()=>f.bind({}),{code:'BINDING_CORRECTION_REQUIRED'});
  assert.throws(()=>f.bind({previousSessionId:'12345678'}),{code:'BINDING_CONFIRMATION_REQUIRED'});
  assert.throws(()=>f.bind({previousSessionId:'12345678',confirmRebind:true}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(f.store.read(f.board.id),before);
  const changed=f.bind({previousSessionId:'12345678',confirmRebind:true,nativeIdSource:'user-supplied',evidence:'Explicit user confirmation of the shown old and new identities'}).board;
  assert.equal(changed.rootSessionId,full);assert.equal(changed.bindingHistory[0].sessionId,'12345678');
  const next='99999999-1234-4000-8000-000000000002';
  const result=f.bind({sessionId:next,previousSessionId:full,confirmRebind:true,evidence:'Explicit user correction, different full ID is allowed after confirmation'}).board;
  assert.equal(result.rootSessionId,next);assert.equal(result.bindingHistory.length,2);
});

test('confirmed rebind preserves tasks and old sources but prevents old members/snapshots from syncing under the new parent',t=>{
  const f=fixture(t);f.bind({});
  const call=(name,args)=>dispatch(f.store,name,{boardId:f.board.id,...args});
  const child='12345678-1234-4000-8000-000000000003',next='99999999-1234-4000-8000-000000000004';
  call('team_report_member',{memberId:'child',name:'Old child',status:'completed',parentId:'lead',runtimeRef:'/root/old_child',nativeId:child,evidence:'Synthetic old origin'});
  call('team_create_task',{title:'Keep old task'});
  call('team_request_execution',{taskId:'task-1',expectedTaskRevision:1});
  const page=(memberId,threadId,recordId)=>({memberId,threadId,recordId,readAt:'2026-11-02T00:00:00Z',evidence:'Explicit synthetic old page',turns:[{id:'t',status:'completed',items:[{id:'i',type:'agentMessage',text:'Keep original source'}]}]});
  call('team_import_thread_page',page('lead',full,'old-lead-page'));
  call('team_import_thread_page',page('child',child,'old-child-page'));
  const before=f.store.read(f.board.id);
  const after=f.bind({sessionId:next,previousSessionId:full,confirmRebind:true,evidence:'User confirmed this binding change'}).board;
  assert.deepEqual(f.store.read(f.board.id).tasks,before.tasks);assert.equal(after.runs[0].originBinding.sessionId,full);
  assert.equal(after.members.find(m=>m.id==='child').nativeId,child);
  assert.equal(after.members.find(m=>m.id==='child').historyOnly,true);
  assert.equal(after.members.find(m=>m.id==='child').historyBinding.parentThreadId,full);
  const lead=call('team_read_records',{nodeKind:'member',nodeId:'lead'});
  assert.equal(lead.latestHostPage,null);assert.equal(lead.records[0].historicalBinding,true);assert.equal(lead.records[0].originSessionId,full);
  const oldChild=call('team_read_records',{nodeKind:'member',nodeId:'child'});
  assert.equal(oldChild.historySync.mode,'unavailable');assert.equal(oldChild.latestHostPage.threadId,child);
  assert.throws(()=>call('team_import_thread_page',page('child',child,'bad-new-import')),{code:'HISTORICAL_BINDING'});
  assert.throws(()=>call('team_bind_agent_activity',{memberId:'child',expectedRuntimeRef:'/root/old_child',sourceThreadId:next,activities:[]}),{code:'HISTORICAL_BINDING'});
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,2);
});

test('archive hides one workbench and restore preserves all records without deleting data',t=>{
  const f=fixture(t);f.store.createTask(f.board.id,{title:'Preserved task'});
  const before=f.store.read(f.board.id),call=(action,confirmed=true,rev=f.store.read(f.board.id).revision)=>dispatch(f.store,'team_archive_board',{boardId:f.board.id,action,confirmed,expectedRevision:rev});
  assert.throws(()=>call('archive',false),{code:'CONFIRMATION_REQUIRED'});
  assert.throws(()=>call('archive',true,1),{code:'STALE_REVISION'});
  const archived=call('archive');assert.equal(archived.board,null);assert.equal(archived.boards.length,0);assert.equal(archived.archivedBoards.length,1);
  const snapshot=dispatch(f.store,'team_snapshot',{boardId:f.board.id});assert.equal(snapshot.board,null);
  assert.deepEqual(f.store.read(f.board.id).tasks,before.tasks);
  const restored=call('restore');assert.equal(restored.boards.length,1);assert.equal(restored.archivedBoards.length,0);assert.equal(restored.board.archivedAt,null);
  assert.deepEqual(f.store.read(f.board.id).tasks,before.tasks);assert.deepEqual(f.store.read(f.board.id).members,before.members);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM boards').get().n,1);
});
