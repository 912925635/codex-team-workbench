import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'execution-test-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const board = dispatch(store, 'team_create_board', { title: 'Isolated execution fixture' }).board;
  const call = (name, args = {}) => dispatch(store, name, { boardId: board.id, ...args }).board;
  const create = title => call('team_create_task', { title });
  const request = task => call('team_request_execution', { taskId: task.id, expectedTaskRevision: task.revision });
  const record = (run, action, extra = {}) => call('team_record_execution', { runId: run.id, expectedRevision: run.revision, action, evidence: `fixture ${action}`, ...extra });
  return { store, board, call, create, request, record };
}
const last = xs => xs.at(-1);

test('request records intent without allocating a worker or claiming the task', t => {
  const f = fixture(t); const before = f.create('Task'); const b = f.request(last(before.tasks));
  assert.equal(last(b.runs).status, 'requested');
  assert.equal(last(b.runs).memberId, null); assert.equal(last(b.runs).runtimeRef, null);
  assert.deepEqual(b.members, before.members); assert.deepEqual(b.tasks, before.tasks);
  assert.equal(last(b.runs).evidence[0].kind, 'execution-request');
});

test('dispatch receipt is required before running or confirmation', t => {
  const f = fixture(t); let b = f.request(last(f.create('Task').tasks)); const run = last(b.runs);
  for (const action of ['running', 'confirm']) assert.throws(() => f.record(run, action), { code: 'INVALID_TRANSITION' });
  assert.throws(() => f.record(run, 'dispatched'), { code: 'INVALID_ARGUMENT' });
  assert.deepEqual(f.call('team_snapshot'), b);
  b = f.record(run, 'dispatched', { runtimeRef: 'fixture-host-returned-ref' });
  assert.equal(last(b.runs).status, 'dispatched'); assert.equal(last(b.runs).runtimeRef, 'fixture-host-returned-ref');
  assert.equal(last(b.runs).evidence.at(-1).kind, 'lead-spawn-receipt');
  assert.equal(last(b.tasks).status, 'in_progress'); assert.equal(last(b.tasks).ownerId, last(b.runs).memberId);
});

test('worker report leaves task in progress until parent confirms', t => {
  const f = fixture(t); let b = f.request(last(f.create('Task').tasks));
  b = f.record(last(b.runs), 'dispatched', { runtimeRef: 'fixture-ref' });
  b = f.record(last(b.runs), 'running');
  b = f.record(last(b.runs), 'report_result', { result: 'Tests passed', artifacts: ['test/example.mjs'] });
  assert.equal(last(b.runs).status, 'reported'); assert.equal(last(b.tasks).status, 'in_progress');
  assert.deepEqual(last(b.runs).artifacts, ['test/example.mjs']);
  b = f.record(last(b.runs), 'confirm');
  assert.equal(last(b.runs).status, 'succeeded'); assert.equal(last(b.tasks).status, 'completed');
  assert.equal(last(b.runs).evidence.at(-1).kind, 'lead-collected-result');
});

test('stale revisions and duplicate active requests are rejected without mutation', t => {
  const f = fixture(t); let b = f.create('Task'); const task = last(b.tasks);
  assert.throws(() => f.call('team_request_execution', { taskId: task.id, expectedTaskRevision: task.revision + 1 }), { code: 'STALE_REVISION' });
  b = f.request(task); const run = last(b.runs);
  assert.throws(() => f.request(task), { code: 'RUN_ACTIVE' });
  b = f.record(run, 'dispatched', { runtimeRef: 'fixture-ref' });
  assert.throws(() => f.record(run, 'running'), { code: 'STALE_REVISION' });
  assert.deepEqual(f.call('team_snapshot'), b);
});

test('failed execution does not complete the task and can be retried', t => {
  const f = fixture(t); let b = f.request(last(f.create('Task').tasks));
  b = f.record(last(b.runs), 'dispatched', { runtimeRef: 'fixture-ref' });
  b = f.record(last(b.runs), 'running');
  b = f.record(last(b.runs), 'fail', { result: 'Test command failed' });
  assert.equal(last(b.runs).status, 'failed'); assert.equal(last(b.tasks).status, 'pending');
  assert.equal(last(b.tasks).ownerId, null); assert.equal(last(b.members).status, 'blocked');
  assert.throws(() => f.record(last(b.runs), 'confirm'), { code: 'RUN_TERMINAL' });
  b = f.request(last(b.tasks)); assert.equal(last(b.runs).status, 'requested');
});

test('executing a new task preserves 27 existing task records exactly', t => {
  const f = fixture(t); let b;
  for (let i = 1; i <= 27; i++) b = f.create(`Existing task ${i}`);
  const original = JSON.stringify(f.store.read(f.board.id).tasks);
  b = f.create('New execution'); b = f.request(last(b.tasks));
  b = f.record(last(b.runs), 'dispatched', { runtimeRef: 'fixture-ref' });
  b = f.record(last(b.runs), 'running');
  b = f.record(last(b.runs), 'report_result', { result: 'Completed fixture work' });
  b = f.record(last(b.runs), 'confirm');
  assert.equal(JSON.stringify(f.store.read(f.board.id).tasks.slice(0, 27)), original);
  assert.equal(last(b.tasks).status, 'completed');
});

test('unfinished dependencies block execution and active runs cannot be manually completed', t => {
  const f = fixture(t); let b = f.create('Dependency');
  b = f.call('team_create_task', { title: 'Blocked work', blockedBy: ['task-1'] });
  assert.throws(() => f.request(last(b.tasks)), { code: 'TASK_BLOCKED' });
  b = f.request(b.tasks[0]);
  b = f.record(last(b.runs), 'dispatched', { runtimeRef: 'fixture-ref' });
  assert.throws(() => f.call('team_update_task', { taskId: 'task-1', expectedRevision: b.tasks[0].revision, actorId: 'lead', action: 'complete' }), { code: 'RUN_ACTIVE' });
});


test('spawn receipt reuses an already observed native member and preserves original instructions', t => {
 const f=fixture(t);let b=f.call('team_create_task',{title:'Original',description:'Original instructions'});const task=last(b.tasks);b=f.request(task);const run=last(b.runs);
 const id='00000000-0000-4000-8000-000000000501';
 f.store.transact(f.board.id,b=>b.members.push({id:'native:'+id,nativeId:id,source:'hook',role:'member',name:'Observed',parentId:'lead',relation:'session_association',status:'start_observed',nativeLifecycle:{event:'SubagentStart',observedAt:new Date().toISOString()},runtimeObservation:{state:'running',source:'native-command-hook',observedAt:new Date().toISOString()}}));
 b=f.record(run,'dispatched',{nativeId:id,runtimeRef:'/root/fixture_observed',evidence:'Actual receipt fixture'});
 assert.equal(b.members.filter(m=>m.nativeId===id).length,1);assert.equal(last(b.runs).memberId,'native:'+id);assert.equal(b.tasks[0].ownerId,'native:'+id);
 assert.equal(last(b.runs).instructions,'Original instructions');assert.equal(b.members.find(m=>m.nativeId===id).runtimeObservation.source,'native-command-hook');
});
