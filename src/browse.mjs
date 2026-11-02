import { createHash } from 'node:crypto';
import { requireValue, text } from './validation.mjs';
import { historySyncPlan } from './history-sync.mjs';
const now = () => new Date().toISOString();
const transcriptBoundary = { nativeAvailable: false, source: 'explicit-reports-execution-receipts-and-relayed-host-pages',
  reason: 'No direct complete-native reader is connected. These are reported work records, execution receipts or bounded public-host pages relayed by an agent, not the complete native conversation.' };

// Display groups never replace the actual agent parent. No IDs are inferred.
export function sessionTree(board) {
  const groups = board.workflows ?? [];
  const nodes = board.members.map(m => ({ id: `member:${m.id}`, kind: 'member', entityId: m.id, label: m.name,
    parentId: m.workflowId ? `workflow:${m.workflowId}` : m.parentId ? `member:${m.parentId}` : null,
    agentParentId: m.relation === 'session_association' ? null : m.parentId, workflowId: m.workflowId ?? null, source: m.source, status: m.status }));
  nodes.push(...groups.map(w => ({ id: `workflow:${w.id}`, kind: 'workflow', entityId: w.id, label: w.title,
    parentId: `member:${w.parentMemberId}`, agentParentId: null, source: 'reported', status: w.status })));
  return nodes;
}

export function recordWorkflow(store, input) {
  return store.transact(input.boardId, b => {
    b.workflows ??= [];
    const existing = b.workflows.find(w => w.id === input.workflowId);
    requireValue(!existing?.historyOnly,'HISTORICAL_BINDING','Register a new workflow for the current origin; keep historical workflow sources');
    requireValue((existing?.revision ?? 0) === input.expectedRevision, 'STALE_REVISION', 'Workflow changed; refresh first (new workflow revision is 0)');
    requireValue(b.members.some(m => m.id === input.parentMemberId), 'MEMBER_NOT_FOUND', 'Workflow owner not found');
    requireValue(!existing || existing.parentMemberId === input.parentMemberId, 'WORKFLOW_PARENT', 'Workflow grouping owner is immutable');
    if (!existing) requireValue(b.workflows.length < 100, 'WORKFLOW_LIMIT', 'Maximum 100 workflow groups');
    const w = { id: text(input.workflowId, 'workflowId'), title: text(input.title, 'title'), parentMemberId: input.parentMemberId,
      status: input.status, revision: (existing?.revision ?? 0) + 1, source: 'reported', observedAt: now(),
      evidence: text(input.evidence, 'evidence', 4000), createdAt: existing?.createdAt ?? now() };
    if (existing) b.workflows[b.workflows.indexOf(existing)] = w; else b.workflows.push(w);
    store.event(b, 'workflow_report', `${w.id}: ${w.status}`);
  });
}

function target(b, kind, id) {
  const node = (kind === 'member' ? b.members : b.workflows ?? []).find(n => n.id === id);
  requireValue(node, 'NODE_NOT_FOUND', 'Recorded node not found in this board');
  return node;
}
function timestamp(value) {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'INVALID_ARGUMENT', 'observedAt must be a date-time');
  return new Date(value).toISOString();
}
export function appendRecord(store, input) {
  const board = store.read(input.boardId), node = target(board, input.nodeKind, input.nodeId);
  const record = { boardId: board.id, recordId: text(input.recordId, 'recordId'), nodeKind: input.nodeKind, nodeId: input.nodeId,
    workflowId: input.nodeKind === 'workflow' ? node.id : node.workflowId ?? null,
    bindingGeneration:node.historyBinding?.generation ?? board.bindingGeneration ?? 0, originSessionId:node.historyBinding?.sessionId ?? board.rootSessionId ?? null,
    role: input.role, text: text(input.text, 'text', 16384), evidence: text(input.evidence, 'evidence', 4000),
    observedAt: input.observedAt ? timestamp(input.observedAt) : null, source: 'reported' };
  return saveRecord(store, record);
}
function saveRecord(store, record) {
  const hash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
  let saved;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const previous = store.db.prepare('SELECT seq, digest FROM work_records WHERE board_id=? AND record_id=?').get(record.boardId, record.recordId);
    if (previous) {
      requireValue(previous.digest === hash, 'RECORD_CONFLICT', 'Record ID already contains different content');
      saved = { seq: previous.seq, recordId: record.recordId, duplicate: true };
    } else {
      const count = store.db.prepare('SELECT count(*) AS n FROM work_records WHERE board_id=?').get(record.boardId).n;
      requireValue(count < 2000, 'RECORD_LIMIT', 'Maximum 2000 explicit work records per board');
      const receivedAt = now();
      const result = store.db.prepare('INSERT INTO work_records(board_id,record_id,node_kind,node_id,workflow_id,digest,payload) VALUES (?,?,?,?,?,?,?)')
        .run(record.boardId, record.recordId, record.nodeKind, record.nodeId, record.workflowId, hash, JSON.stringify({ ...record, receivedAt }));
      saved = { seq: Number(result.lastInsertRowid), recordId: record.recordId, duplicate: false };
    }
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
  return { recorded: saved, ...transcriptBoundary };
}

// Explicit host-tool relay. No private host files, native API calls or model starts.
export function importThreadPage(store, input) {
  const b = store.read(input.boardId), node = target(b, 'member', input.memberId);
  requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.threadId), 'INVALID_THREAD_ID', 'A public export needs an actual recorded thread UUID');
  requireValue(!node.historyOnly, 'HISTORICAL_BINDING', 'Old member snapshots cannot be imported under a new board binding');
  requireValue(node.nativeId && node.nativeId === input.threadId, 'THREAD_BINDING_REQUIRED', 'The exported thread must exactly match this member\'s explicitly recorded native ID');
  requireValue(input.turns.length > 0, 'INVALID_ARGUMENT', 'A page needs at least one returned turn');
  const turns = input.turns.map(t => ({ id: text(t.id,'turnId'), status: text(t.status,'status',100), items: t.items.map(item => ({
    id:text(item.id,'itemId'), type:item.type, text:text(item.text,'item text',8000),
  })) }));
  const record = { boardId:b.id, recordId:text(input.recordId,'recordId'), nodeKind:'member', nodeId:node.id, workflowId:node.workflowId ?? null,
    bindingGeneration:b.bindingGeneration ?? 0, originSessionId:b.rootSessionId ?? null,
    role:'note', source:'public-host-page-relayed', verification:'relayed-by-agent-not-server-authenticated',
    text:'Bounded public host conversation snapshot; selected visible items, not a complete native transcript.',
    evidence:text(input.evidence,'evidence',4000), observedAt:timestamp(input.readAt),
    hostPage:{ threadId:input.threadId, hostId:input.hostId ?? null, cursor:input.cursor ?? null, nextCursor:input.nextCursor ?? null,
      coverage:'selected-visible-items', sourceTool:'codex-app-tools.read_thread', turns } };
  requireValue(Buffer.byteLength(JSON.stringify(record),'utf8') <= 48000, 'PAGE_TOO_LARGE', 'Export at most 48KB of selected visible items per snapshot; preserve truncation in evidence');
  return saveRecord(store,record);
}

export function readRecords(store, input) {
  const b = store.view(input.boardId), node = target(b, input.nodeKind, input.nodeId);
  const filter = input.nodeKind === 'workflow' ? '(workflow_id=?)' : '(node_kind=\'member\' AND node_id=?)';
  const limit = input.limit ?? 25;
  requireValue(limit > 0 && limit <= 100, 'INVALID_ARGUMENT', 'Page size must be between 1 and 100');
  const rows = store.db.prepare(`SELECT seq,payload FROM work_records WHERE board_id=? AND ${filter} AND seq>? ORDER BY seq LIMIT ?`)
    .all(b.id, node.id, input.after ?? 0, limit + 1);
  const page = rows.slice(0, limit).map(r => { const record=JSON.parse(r.payload), generation=record.bindingGeneration ?? 0;
    return {...record,seq:r.seq,historicalBinding:node.historyOnly || generation < (b.bindingGeneration ?? 0),originSessionId:record.originSessionId ?? b.bindingHistory?.find(h=>h.generation===generation)?.sessionId ?? null}; });
  const runs = b.runs.filter(r => input.nodeKind === 'workflow' ? r.workflowId === node.id : r.memberId === node.id || r.parentMemberId === node.id);
  const lastHost = input.nodeKind === 'member' ? store.db.prepare("SELECT payload FROM work_records WHERE board_id=? AND node_kind='member' AND node_id=? AND json_extract(payload,'$.source')='public-host-page-relayed' AND json_extract(payload,'$.hostPage.threadId')=? ORDER BY seq DESC LIMIT 1").get(b.id,node.id,node.nativeId ?? null) : null;
  const lastRecord=lastHost ? JSON.parse(lastHost.payload) : null;
  const hostPage=lastRecord ? {...lastRecord.hostPage,recordId:lastRecord.recordId,readAt:lastRecord.observedAt,evidence:lastRecord.evidence} : null;
  return { ...transcriptBoundary, boardId: b.id, nodeKind: input.nodeKind, node,
    records: page, nextCursor: rows.length > limit ? page.at(-1).seq : null,
    executions: runs.slice(-50).reverse(), executionCount: runs.length,
    latestHostPage:hostPage, historySync:input.nodeKind==='member'?historySyncPlan(b,node,hostPage):null };
}

export function observation(input, previous = {}) {
  const out = { ...previous };
  if (input.runtimeRef !== undefined) out.runtimeRef = text(input.runtimeRef, 'runtimeRef', 300);
  if (input.spawnCallId !== undefined) { out.spawnCallId=text(input.spawnCallId,'spawnCallId');out.spawnCallEvidence=text(input.evidence,'evidence',4000); }
  if (input.nativeId !== undefined) {
    const id = text(input.nativeId, 'nativeId');
    requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id), 'INVALID_THREAD_ID', 'Supply an actual native UUID; a runtime path is not a native thread ID');
    out.nativeId = id;
    out.nativeIdentity = { source: input.nativeIdSource ?? 'caller-supplied', evidence: text(input.evidence, 'evidence', 4000), observedAt: now(), verification: 'reported-unverified', hostId:input.hostId ?? previous.nativeIdentity?.hostId ?? null };
  }
  if (input.tokenTotal !== undefined || input.durationMs !== undefined) {
    out.metrics = { ...previous.metrics, source: 'reported', observedAt: now(), evidence: text(input.evidence, 'evidence', 4000) };
    for (const key of ['tokenTotal', 'durationMs']) if (input[key] !== undefined) {
      requireValue(Number.isSafeInteger(input[key]) && input[key] >= 0, 'INVALID_ARGUMENT', 'Metrics must be nonnegative integers');
      out.metrics[key] = input[key];
    }
  }
  return out;
}
