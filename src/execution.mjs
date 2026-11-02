import { randomUUID } from 'node:crypto';
import { requireValue, text } from './validation.mjs';
import { observation } from './browse.mjs';
const stamp = () => new Date().toISOString();
const terminal = new Set(['succeeded', 'failed']);

// Native agents are started by the lead's host tools, never by this MCP server.
// Receipts remain lead/worker reports, not authenticated runtime telemetry.
export function requestExecution(store, input) {
  return store.transact(input.boardId, b => {
    requireValue(!b.archivedAt, 'BOARD_ARCHIVED', 'Restore the workbench before requesting new execution');
    requireValue(!b.members.find(m=>m.id===(input.parentMemberId ?? 'lead'))?.historyOnly, 'HISTORICAL_BINDING', 'A historical member cannot parent a new binding execution');
    const t = b.tasks.find(t => t.id === input.taskId && t.status !== 'deleted');
    requireValue(t, 'TASK_NOT_FOUND', 'Task not found');
    requireValue(t.revision === input.expectedTaskRevision, 'STALE_REVISION', 'Task changed; refresh first');
    requireValue(t.status === 'pending' && store.ready(b, t), 'TASK_BLOCKED', 'Execution needs a pending, unblocked task');
    b.runs ??= [];
    requireValue(!b.runs.some(r => r.taskId === t.id && !terminal.has(r.status)), 'RUN_ACTIVE', 'Task already has an active request');
    requireValue(b.runs.length < 500, 'RUN_LIMIT', 'Maximum 500 execution records');
    const run = { id: `run-${randomUUID()}`, taskId: t.id, revision: 1, status: 'requested',
      instructions: text(input.instructions || t.description || t.title, 'instructions', 16384),
      parentMemberId: input.parentMemberId ?? 'lead', workflowId: input.workflowId ?? null, memberId: null, runtimeRef: null,
      runtimeKind: 'codex-native-via-lead', createdAt: stamp(), updatedAt: stamp(),
      result: null, artifacts: [], evidence: [{ at: stamp(), kind: 'execution-request', detail: 'Requested; this operation starts no agent' }] };
    requireValue(b.members.some(m => m.id === run.parentMemberId), 'MEMBER_NOT_FOUND', 'Parent member not found');
    if (run.workflowId) requireValue((b.workflows ?? []).some(w => w.id === run.workflowId && w.parentMemberId === run.parentMemberId), 'WORKFLOW_PARENT', 'Workflow group must belong to the actual agent parent');
    b.runs.push(run); store.event(b, 'execution_requested', `${run.id}: ${t.id}`);
  });
}
export function recordExecution(store, input) {
  return store.transact(input.boardId, b => {
    const run = b.runs?.find(r => r.id === input.runId);
    requireValue(run, 'RUN_NOT_FOUND', 'Execution request not found');
    requireValue(run.revision === input.expectedRevision, 'STALE_REVISION', 'Execution changed; refresh first');
    const t = b.tasks.find(t => t.id === run.taskId && t.status !== 'deleted');
    requireValue(t, 'TASK_NOT_FOUND', 'Execution task not found');
    requireValue(!terminal.has(run.status), 'RUN_TERMINAL', 'Execution already finished');
    const detail = text(input.evidence, 'evidence', 4000);
    let kind;
    switch (input.action) {
      case 'dispatched':
        requireValue(run.status === 'requested', 'INVALID_TRANSITION', 'Only a requested run can be dispatched');
        requireValue(t.status === 'pending' && store.ready(b, t), 'TASK_BLOCKED', 'Task no longer ready');
        run.runtimeRef = text(input.runtimeRef, 'runtimeRef', 300);
        run.memberId = `execution:${run.id}`;
        requireValue(b.members.length < 100, 'MEMBER_LIMIT', 'Maximum 100 members');
        b.members.push({ ...observation(input), id: run.memberId, name: input.memberName ? text(input.memberName, 'memberName', 100) : 'Native execution worker',
          role: 'member', parentId: run.parentMemberId, source: 'reported', status: 'unknown',
          nativeId: input.nativeId ?? null, runtimeRef: run.runtimeRef, workflowId: run.workflowId, observedAt: stamp(), relation: 'lead-reported-spawn' });
        t.status = 'in_progress'; t.ownerId = run.memberId; t.revision++; t.updatedAt = stamp();
        run.status = 'dispatched'; kind = 'lead-spawn-receipt'; break;
      case 'running':
        requireValue(run.status === 'dispatched', 'INVALID_TRANSITION', 'Spawn receipt required before worker start');
        run.status = 'running'; kind = 'worker-start-report'; break;
      case 'report_result':
        requireValue(run.status === 'running', 'INVALID_TRANSITION', 'Only a running worker can report a result');
        run.result = text(input.result, 'result', 16384);
        run.artifacts = (input.artifacts ?? []).map(p => {
          requireValue(typeof p === 'string' && !/^(?:[a-z]:|[\\/])/i.test(p) && !p.split(/[\\/]/).includes('..'), 'INVALID_ARGUMENT', 'Artifact references must be workspace-relative');
          return text(p, 'artifact', 500);
        });
        run.status = 'reported'; kind = 'worker-result-report'; break;
      case 'confirm':
        requireValue(run.status === 'reported', 'INVALID_TRANSITION', 'Worker report and parent collection required');
        requireValue(t.status === 'in_progress' && t.ownerId === run.memberId && store.ready(b, t), 'TASK_BLOCKED', 'Task changed or dependencies are incomplete');
        run.status = 'succeeded'; kind = 'lead-collected-result';
        t.status = 'completed'; t.revision++; t.updatedAt = stamp(); break;
      case 'fail':
        run.status = 'failed'; run.result = text(input.result || detail, 'result', 16384); kind = 'execution-failure-report';
        if (t.ownerId === run.memberId && t.status === 'in_progress') {
          t.status = 'pending'; t.ownerId = null; t.revision++; t.updatedAt = stamp();
        }
        break;
      default: requireValue(false, 'INVALID_ARGUMENT', 'Unknown execution action');
    }
    if (run.memberId) {
      const m = b.members.find(m => m.id === run.memberId);
      m.status = run.status === 'running' ? 'working' : run.status === 'succeeded' ? 'completed' : run.status === 'failed' ? 'blocked' : 'unknown';
      m.observedAt = stamp();
    }
    run.revision++; run.updatedAt = stamp(); run.evidence.push({ at: stamp(), kind, detail });
    store.event(b, 'execution_updated', `${run.id}: ${run.status}`);
  });
}
