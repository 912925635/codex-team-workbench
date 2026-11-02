import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';
import { withClient } from '../src/mcp-client.mjs';
function location(t) {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-browse-fixture-'));
  let close = () => {};
  t.after(() => { close(); assert(resolve(dir).startsWith(resolve(tmpdir()) + sep)); rmSync(dir, { recursive: true, force: true }); });
  return { dir, onClose(fn) { close = fn; } };
}
function fixture(t) {
  const temp = location(t), { dir } = temp, store = new Store(dir); temp.onClose(() => store.close());
  const board = store.create('Explicit fixture; no real agents');
  const call = (name, args) => dispatch(store, name, { boardId: board.id, ...args });
  const member = (id, parentId = 'lead', extra = {}) => call('team_report_member', { memberId: id, parentId, name: `Fixture ${id}`, status: 'unknown', ...extra }).board;
  const workflow = (id, parentMemberId = 'lead', expectedRevision = 0) => call('team_record_workflow', { workflowId: id, parentMemberId, expectedRevision, title: `Fixture ${id}`, status: 'running', evidence: 'Deterministic workflow fixture' }).board;
  return { dir, store, board, call, member, workflow };
}
test('multilevel display groups preserve actual parent edges, CAS and cycle rejection', t => {
  const f = fixture(t); f.member('child'); f.member('grandchild', 'child'); f.member('deep', 'grandchild');
  f.workflow('group', 'child'); let b = f.member('grouped', 'child', { workflowId: 'group' });
  const tree = new Map(b.sessionTree.map(n => [n.id, n]));
  assert.equal(tree.get('member:grandchild').parentId, 'member:child');
  assert.equal(tree.get('member:deep').parentId, 'member:grandchild');
  assert.equal(tree.get('member:grouped').parentId, 'workflow:group');
  assert.equal(tree.get('member:grouped').agentParentId, 'child');
  assert.equal(tree.get('workflow:group').parentId, 'member:child');
  assert.equal(b.members.find(m => m.id === 'grouped').parentId, 'child');
  const before = f.store.read(f.board.id);
  assert.throws(() => f.workflow('group', 'child', 0), { code: 'STALE_REVISION' });
  assert.throws(() => f.workflow('group', 'lead', 1), { code: 'WORKFLOW_PARENT' });
  assert.throws(() => f.member('child', 'deep'), { code: 'MEMBER_CYCLE' });
  assert.throws(() => f.member('wrong', 'lead', { workflowId: 'group' }), { code: 'WORKFLOW_PARENT' });
  assert.deepEqual(f.store.read(f.board.id), before);
});
test('native UUID requires evidence, runtime paths stay separate, optional metrics keep source and time', t => {
  const f = fixture(t); f.member('parent'); f.member('child', 'parent', { runtimeRef: '/root/fixture-child' });
  assert.throws(() => f.member('child', 'parent', { nativeId: '/root/fixture-child', evidence: 'fixture' }), { code: 'INVALID_THREAD_ID' });
  assert.throws(() => f.member('child', 'parent', { nativeId: '00000000-0000-4000-8000-000000000001' }), { code: 'INVALID_ARGUMENT' });
  let b = f.member('child', 'parent', { nativeId: '00000000-0000-4000-8000-000000000001', nativeIdSource: 'host-spawn-receipt', tokenTotal: 0, durationMs: 2000, evidence: 'Explicit synthetic identity/usage fixture' });
  const child = b.members.find(m => m.id === 'child');
  assert.equal(child.runtimeRef, '/root/fixture-child'); assert.equal(child.nativeIdentity.verification, 'reported-unverified');
  assert.equal(child.metrics.tokenTotal, 0); assert.equal(child.metrics.durationMs, 2000); assert.equal(child.metrics.source, 'reported');
  assert(Number.isFinite(Date.parse(child.metrics.observedAt))); assert.equal(child.resumable, null);
  b = f.call('team_report_member', { memberId: 'child', name: 'Updated fixture', status: 'idle' }).board;
  assert.equal(b.members.find(m => m.id === 'child').parentId, 'parent');
  assert.deepEqual(b.members.find(m => m.id === 'child').nativeIdentity, child.nativeIdentity);
  assert.throws(() => f.member('child', 'parent', { tokenTotal: -1, evidence: 'fixture' }), { code: 'INVALID_ARGUMENT' });
});
test('reported records are idempotent, paginated, restart-safe and board/node-scoped', async t => {
  const f = fixture(t); f.workflow('group'); f.member('a', 'lead', { workflowId: 'group' }); f.member('b');
  const args = i => ({ nodeKind: 'member', nodeId: 'a', recordId: `fixture-${i}`, role: 'tool', text: `<script>fixture-${i}</script>`, evidence: 'Synthetic text; never executed' });
  for (let i = 0; i < 27; i++) f.call('team_append_record', args(i));
  const before = f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n;
  assert.equal(f.call('team_append_record', args(0)).recorded.duplicate, true);
  assert.throws(() => f.call('team_append_record', { ...args(0), text: 'changed' }), { code: 'RECORD_CONFLICT' });
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n, before);
  let page = f.call('team_read_records', { nodeKind: 'member', nodeId: 'a', limit: 10 });
  const records = [...page.records]; assert.equal(page.nativeAvailable, false);
  while (page.nextCursor !== null) { page = f.call('team_read_records', { nodeKind: 'member', nodeId: 'a', limit: 10, after: page.nextCursor }); records.push(...page.records); }
  assert.equal(records.length, 27); assert.equal(new Set(records.map(r => r.seq)).size, 27);
  assert.equal(f.call('team_read_records', { nodeKind: 'member', nodeId: 'b' }).records.length, 0);
  assert.equal(f.call('team_read_records', { nodeKind: 'workflow', nodeId: 'group', limit: 100 }).records.length, 27);
  const other = f.store.create('Other fixture');
  assert.equal(dispatch(f.store, 'team_read_records', { boardId: other.id, nodeKind: 'member', nodeId: 'lead' }).records.length, 0);
  assert.throws(() => f.call('team_read_records', { nodeKind: 'member', nodeId: 'unknown' }), { code: 'NODE_NOT_FOUND' });
  assert.throws(() => f.call('team_read_records', { nodeKind: 'member', nodeId: 'a', transcript_path: '/private' }), { code: 'INVALID_ARGUMENT' });
  await withClient(f.dir, async c => {
    const read = await c.call('team_read_records', { boardId: f.board.id, nodeKind: 'member', nodeId: 'a', limit: 100 });
    assert.equal(read.records.length, 27); assert.equal(read.records[0].source, 'reported');
  });
});
test('legacy database gains a separate records table without rewriting 27 tasks or two members', t => {
  const temp = location(t), { dir } = temp, db = new DatabaseSync(join(dir, 'workbench.sqlite'));
  db.exec('CREATE TABLE boards(id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE panel_sessions(session_hash TEXT PRIMARY KEY,board_id TEXT NOT NULL)');
  const legacy = { id: 'fixture-legacy', title: 'Legacy fixture', revision: 4, tasks: Array.from({ length: 27 }, (_, i) => ({ id: `task-${i}`, status: 'pending', blockedBy: [] })),
    members: [{ id: 'lead', name: 'Fixture lead', parentId: null, source: 'manual', observedAt: new Date().toISOString() }, { id: 'child', name: 'Fixture child', parentId: 'lead', source: 'reported', observedAt: new Date().toISOString() }], events: [] };
  const original = JSON.stringify(legacy);
  db.prepare('INSERT INTO boards VALUES (?,?)').run(legacy.id, original); db.close();
  const store = new Store(dir); temp.onClose(() => store.close());
  assert.equal(store.view(legacy.id).sessionTree.length, 2);
  dispatch(store, 'team_append_record', { boardId: legacy.id, nodeKind: 'member', nodeId: 'child', recordId: 'fixture-record', role: 'note', text: 'Fixture observation', evidence: 'Migration test' });
  assert.equal(store.db.prepare('SELECT state FROM boards WHERE id=?').get(legacy.id).state, original);
  assert.equal(store.view(legacy.id).tasks.length, 27); assert.equal(store.view(legacy.id).members.length, 2);
});
test('nested execution registers the supplied actual parent and workflow without inventing native IDs', t => {
  const f = fixture(t); f.member('parent'); f.workflow('nested-work', 'parent');
  let b = f.call('team_create_task', { title: 'Fixture nested task' }).board;
  b = f.call('team_request_execution', { taskId: b.tasks[0].id, expectedTaskRevision: 1, parentMemberId: 'parent', workflowId: 'nested-work' }).board;
  const run = b.runs.at(-1);
  b = f.call('team_record_execution', { runId: run.id, expectedRevision: 1, action: 'dispatched', runtimeRef: '/root/fixture/nested', evidence: 'Synthetic host receipt' }).board;
  const child = b.members.find(m => m.id === run.memberId) ?? b.members.at(-1);
  assert.equal(child.parentId, 'parent'); assert.equal(child.workflowId, 'nested-work'); assert.equal(child.nativeId, null);
  const page = f.call('team_read_records', { nodeKind: 'workflow', nodeId: 'nested-work' });
  assert.equal(page.executions.length, 1); assert.equal(page.executions[0].runtimeRef, '/root/fixture/nested');
});

test('host-page relay requires an exact explicit thread binding and preserves partial-source provenance', t => {
  const f=fixture(t),threadId='00000000-0000-4000-8000-000000000002';
  f.member('child');
  const args={memberId:'child',recordId:'fixture-public-page',threadId,hostId:'fixture-host',readAt:'2026-11-02T00:00:00Z',nextCursor:'fixture-opaque-page',evidence:'Synthetic public host tool result, selected visible items only',turns:[{id:'fixture-turn',status:'completed',items:[{id:'fixture-item',type:'agentMessage',text:'Fixture visible answer'}]}]};
  assert.throws(()=>f.call('team_import_thread_page',args),{code:'THREAD_BINDING_REQUIRED'});
  f.member('child','lead',{nativeId:threadId,nativeIdSource:'user-supplied',evidence:'Explicit fixture mapping'});
  f.call('team_import_thread_page',args);
  const page=f.call('team_read_records',{nodeKind:'member',nodeId:'child'});
  assert.equal(page.records[0].source,'public-host-page-relayed');
  assert.equal(page.records[0].verification,'relayed-by-agent-not-server-authenticated');
  assert.equal(page.latestHostPage.nextCursor,'fixture-opaque-page');
  assert.equal(page.latestHostPage.coverage,'selected-visible-items');
  assert.equal(page.nativeAvailable,false);
  assert.equal(f.call('team_import_thread_page',args).recorded.duplicate,true);
});
test('host-page relay rejects reasoning, identity mismatch and oversized exports without saving partial pages', t => {
  const f=fixture(t),threadId='00000000-0000-4000-8000-000000000003';
  f.member('child','lead',{nativeId:threadId,evidence:'Explicit synthetic mapping'});
  const args={memberId:'child',recordId:'fixture-page',threadId,readAt:'2026-11-02T00:00:00Z',evidence:'Synthetic public page',turns:[{id:'t',status:'completed',items:[{id:'i',type:'reasoning',text:'Must not be imported'}]}]};
  assert.throws(()=>f.call('team_import_thread_page',args),{code:'INVALID_ARGUMENT'});
  args.turns[0].items=[{id:'i',type:'agentMessage',text:'Visible fixture'}];
  assert.throws(()=>f.call('team_import_thread_page',{...args,threadId:'00000000-0000-4000-8000-000000000004'}),{code:'THREAD_BINDING_REQUIRED'});
  args.turns[0].items=Array.from({length:7},(_,i)=>({id:`i${i}`,type:'agentMessage',text:'x'.repeat(8000)}));
  assert.throws(()=>f.call('team_import_thread_page',args),{code:'PAGE_TOO_LARGE'});
  assert.equal(f.call('team_read_records',{nodeKind:'member',nodeId:'child'}).records.length,0);
});
