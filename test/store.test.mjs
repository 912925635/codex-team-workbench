import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { dispatch, callTool } from '../src/tools.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'team-workbench-test-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, board: store.create('Test workspace') };
}
function update(store, board, task, action, extra = {}) {
  return dispatch(store, 'team_update_task', { boardId: board.id, taskId: task.id,
    expectedRevision: task.revision, actorId: 'lead', action, ...extra }).board;
}
test('empty board is persistent and contains no simulated workers', t => {
  const { dir, store, board } = fixture(t);
  const second = new Store(dir);
  try {
    assert.equal(second.read(board.id).title, 'Test workspace');
    assert.equal(second.view(board.id).members.length, 1);
    assert.equal(second.view(board.id).members[0].source, 'manual');
    assert.deepEqual(second.view(board.id).tasks, []);
    assert.equal(second.view(board.id).capabilities.nativeResume, false);
  } finally { second.close(); }
});
test('anonymous host correlation remembers panel selection, never binds native session', t => {
  const { store, board } = fixture(t);
  const result = dispatch(store, 'team_panel', { boardId: board.id }, { anonymousSession: 'opaque-correlation-fixture' });
  assert.equal(result.conversationAssociation, 'anonymous-host-session');
  assert.equal(store.selectedBoard('opaque-correlation-fixture'), board.id);
  assert.equal(store.selectedBoard('other-fixture'), null);
  assert.equal(store.read(board.id).rootSessionId, null);
  assert.notEqual(store.sessionHash('opaque-correlation-fixture'), 'opaque-correlation-fixture');
  assert.equal(store.selectedBoard({ unexpected: 'shape' }), null);
});
test('dependency readiness, blocked claim and completion, revision conflicts, reopen', t => {
  const { store, board } = fixture(t);
  store.createTask(board.id, { title: 'Prepare' });
  let b = store.createTask(board.id, { title: 'Review', blockedBy: ['task-1'] });
  assert.equal(b.tasks[1].ready, false);
  assert.throws(() => update(store, board, b.tasks[1], 'claim'), { code: 'TASK_BLOCKED' });
  b = update(store, board, b.tasks[0], 'claim');
  assert.throws(() => update(store, board, { ...b.tasks[0], revision: 1 }, 'complete'), { code: 'STALE_REVISION' });
  b = update(store, board, b.tasks[0], 'complete');
  assert.equal(b.tasks[1].ready, true);
  b = update(store, board, b.tasks[1], 'claim');
  b = update(store, board, b.tasks[0], 'reopen');
  assert.throws(() => update(store, board, b.tasks[1], 'complete'), { code: 'TASK_BLOCKED' });
  assert.equal(b.tasks[0].ownerId, null);
});
test('dependency cycle and deletion rejection roll back the whole transaction', t => {
  const { store, board } = fixture(t);
  store.createTask(board.id, { title: 'A' });
  const b = store.createTask(board.id, { title: 'B', blockedBy: ['task-1'] });
  assert.throws(() => update(store, board, b.tasks[0], 'set_dependencies', { blockedBy: ['task-2'] }), { code: 'DEPENDENCY_CYCLE' });
  assert.throws(() => update(store, board, b.tasks[0], 'delete'), { code: 'HAS_DEPENDENTS' });
  assert.deepEqual(store.view(board.id), b);
  assert.throws(() => store.createTask(board.id, { title: 'Bad', blockedBy: ['missing'] }), { code: 'TASK_NOT_FOUND' });
  assert.equal(store.read(board.id).nextTask, 3);
});
test('reported member topology, declared role transitions, and reassign', t => {
  const { store, board } = fixture(t);
  store.reportMember(board.id, { memberId: 'reviewer', name: 'Reviewer', status: 'idle' });
  store.reportMember(board.id, { memberId: 'tester', name: 'Tester', status: 'working', parentId: 'reviewer' });
  assert.throws(() => store.reportMember(board.id, { memberId: 'reviewer', name: 'Reviewer', parentId: 'tester' }), { code: 'MEMBER_CYCLE' });
  let b = store.createTask(board.id, { title: 'Review' });
  b = update(store, board, b.tasks[0], 'reassign', { ownerId: 'reviewer' });
  assert.equal(b.tasks[0].ownerId, 'reviewer');
  assert.throws(() => update(store, board, b.tasks[0], 'release', { actorId: 'tester' }), { code: 'OWNER_REQUIRED' });
  b = update(store, board, b.tasks[0], 'complete', { actorId: 'reviewer' });
  assert.equal(b.tasks[0].status, 'completed');
  assert.equal(b.members[1].source, 'reported');
  assert.equal(b.members[1].resumable, null);
});
test('strict tool schemas reject extra fields, bad types and missing fields', t => {
  const { store, board } = fixture(t);
  const invalid = [
    ['team_create_task', { boardId: board.id, title: 'x', secret: 'not allowed' }],
    ['team_update_task', { boardId: board.id, taskId: 'task-1', expectedRevision: '1', action: 'claim', actorId: 'lead' }],
    ['team_create_board', {}], ['team_snapshot', null]
  ];
  for (const [name, args] of invalid) {
    const result = callTool(store, name, args);
    assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, 'INVALID_ARGUMENT');
  }
});
test('hook ingestion is opt-in, sanitized, source-labeled and session-scoped', t => {
  const { store, board } = fixture(t);
  const event = { hook_event_name: 'SubagentStart', session_id: '00000000-0000-4000-8000-000000000077', agent_id: 'fixture-worker', agent_type: 'reviewer',
    transcript_path: 'DO-NOT-READ', agent_transcript_path: 'DO-NOT-READ', last_assistant_message: 'DO-NOT-PERSIST', cwd: 'DO-NOT-PERSIST' };
  assert.equal(store.observeHook(event), 0);
  assert.equal(store.view(board.id).members.length, 1);
  const other = store.create('Another');
  store.bind(board.id, '00000000-0000-4000-8000-000000000077', 1);
  assert.equal(store.observeHook(event), 1);
  let b = store.view(board.id);
  assert.equal(b.members[1].source, 'hook');
  assert.equal(b.members[1].status, 'start_observed');
  assert.equal(b.members[1].relation, 'session_association');
  assert.equal(b.sessionTree.find(n => n.entityId === b.members[1].id).agentParentId, null);
  assert.equal(store.view(other.id).members.length, 1);
  assert(!JSON.stringify(store.read(board.id)).includes('DO-NOT'));
  store.observeHook({ ...event, hook_event_name: 'SubagentStop' });
  b = store.view(board.id); assert.equal(b.members[1].status, 'stop_observed');
  assert.throws(() => store.reportMember(board.id, { memberId: 'native:fixture-worker', name: 'Spoof' }), { code: 'OBSERVED_MEMBER' });
  assert.throws(() => store.bind(board.id, '00000000-0000-4000-8000-000000000078', b.revision), { code: 'BINDING_CORRECTION_REQUIRED' });
});
