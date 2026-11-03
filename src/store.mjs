// Task transitions and revision semantics adapted from DeepSeek Harness (MIT).
// See THIRD_PARTY_NOTICES.md and LICENSES/DeepSeek-Harness-MIT.txt.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { requireValue, text, BoardError } from './validation.mjs';
import { sessionTree, observation } from './browse.mjs';
import { isThreadId } from './history-sync.mjs';
import { runtimeView } from './runtime-view.mjs';
import { readNativeMetadata } from './native-topology.mjs';
import { readNativeHistory, readNativeHistoryAsync } from './native-history.mjs';
import { ensureAutoHistoryWatch, stopAutoHistory } from './auto-history.mjs';

export function dataDirectory() {
  return resolve(process.env.TEAM_WORKBENCH_DATA || (process.env.PLUGIN_DATA
    ? join(process.env.PLUGIN_DATA, 'team-workbench') : '.team-workbench'));
}
const now = () => new Date().toISOString();
const startupWait = new Int32Array(new SharedArrayBuffer(4));
function initializeDatabase(db) {
  // SQLite can return BUSY immediately when two first connections switch the
  // same new database to WAL. Retry only this bounded, idempotent setup; never
  // retry task mutations or hide revision conflicts.
  db.exec('PRAGMA busy_timeout=200');
  const deadline=Date.now()+2000;
  for (;;) {
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS panel_sessions (session_hash TEXT PRIMARY KEY, board_id TEXT NOT NULL)');
      db.exec('CREATE TABLE IF NOT EXISTS work_records (seq INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT NOT NULL, record_id TEXT NOT NULL, node_kind TEXT NOT NULL, node_id TEXT NOT NULL, workflow_id TEXT, digest TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(board_id,record_id)); CREATE INDEX IF NOT EXISTS work_records_node ON work_records(board_id,node_kind,node_id,seq); CREATE INDEX IF NOT EXISTS work_records_workflow ON work_records(board_id,workflow_id,seq)');
      db.exec('CREATE TABLE IF NOT EXISTS native_event_receipts (board_id TEXT NOT NULL, source TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(board_id,source,seq))');
      db.exec('CREATE TABLE IF NOT EXISTS native_history_claims (job_id TEXT PRIMARY KEY, board_id TEXT NOT NULL, owner TEXT NOT NULL, lease_until INTEGER NOT NULL, attempts INTEGER NOT NULL, state TEXT NOT NULL)');
      break;
    } catch(error) {
      if(![5,6].includes(error.errcode & 255) || Date.now()>=deadline)throw error;
      Atomics.wait(startupWait,0,0,50);
    }
  }
  db.exec('PRAGMA busy_timeout=5000');
}
export class Store {
  constructor(directory = dataDirectory(), options = {}) {
    this.autoHistoryEnabled=options.autoHistory!==false;
    this.nativeEventJournal = options.nativeEventJournal ?? (process.env.TEAM_WORKBENCH_NATIVE_EVENTS ||
      (process.env.PLUGIN_DATA ? join(directory, 'native-events-probe.sqlite') : null));
    this.nativeMetadataReader = options.nativeMetadataReader ??
      (process.env.PLUGIN_DATA && process.platform === 'win32' ? readNativeMetadata : null);
    this.nativeHistoryReader = options.nativeHistoryReader ??
      (process.env.PLUGIN_DATA && process.platform === 'win32' ? readNativeHistory : null);
    this.nativeHistoryAsyncReader = options.nativeHistoryAsyncReader ??
      (process.env.PLUGIN_DATA && process.platform === 'win32' ? readNativeHistoryAsync : null);
    this.autoHistoryRetryMs=options.autoHistoryRetryMs;
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'workbench.sqlite'));
    // Additive plugin-owned table; existing board JSON/tasks are not rewritten.
    try { initializeDatabase(this.db); } catch(error) { this.db.close(); throw error; }
    if(this.autoHistoryEnabled)ensureAutoHistoryWatch(this);
  }
  close() { stopAutoHistory(this);this.db.close(); }
  sessionHash(session) {
    return typeof session === 'string' && session.length > 0 && session.length <= 1024
      ? createHash('sha256').update(session).digest('hex') : null;
  }
  selectedBoard(session) {
    const hash = this.sessionHash(session);
    return hash ? this.db.prepare('SELECT board_id FROM panel_sessions WHERE session_hash=?').get(hash)?.board_id ?? null : null;
  }
  selectBoard(session, boardId) {
    const hash = this.sessionHash(session);
    if (!hash) return;
    this.read(boardId);
    this.db.prepare('INSERT INTO panel_sessions (session_hash,board_id) VALUES (?,?) ON CONFLICT(session_hash) DO UPDATE SET board_id=excluded.board_id').run(hash, boardId);
  }
  list({ includeArchived = false } = {}) {
    return this.db.prepare('SELECT state FROM boards ORDER BY rowid').all().map(row => {
      const b = JSON.parse(row.state);
      return { id: b.id, title: b.title, revision: b.revision, rootSessionId: b.rootSessionId, updatedAt: b.updatedAt, archivedAt: b.archivedAt ?? null };
    }).filter(b => includeArchived || !b.archivedAt);
  }
  read(id) {
    const row = this.db.prepare('SELECT state FROM boards WHERE id=?').get(id);
    requireValue(row, 'BOARD_NOT_FOUND', 'Board not found');
    return JSON.parse(row.state);
  }
  create(title) {
    const stamp = now();
    const board = { id: randomUUID(), title: text(title, 'title'), revision: 1, nextTask: 1,
      rootSessionId: null, createdAt: stamp, updatedAt: stamp, tasks: [], events: [],
      members: [{ id: 'lead', name: '协调者', role: 'lead', parentId: null,
        source: 'manual', status: 'unknown', observedAt: stamp, nativeId: null }] };
    this.db.prepare('INSERT INTO boards (id,state) VALUES (?,?)').run(board.id, JSON.stringify(board));
    return board;
  }
  transact(id, operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const board = this.read(id);
      if (operation(board) === false) { this.db.exec('COMMIT'); return this.view(board); }
      board.revision++; board.updatedAt = now();
      this.db.prepare('UPDATE boards SET state=? WHERE id=?').run(JSON.stringify(board), id);
      this.db.exec('COMMIT');
      return this.view(board);
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(b, kind, detail) {
    b.events.push({ at: now(), kind, detail });
    b.events = b.events.slice(-150);
  }
  bind(id, sessionId, expectedRevision, correction = {}) {
    return this.transact(id, b => {
      requireValue(b.revision === expectedRevision, 'STALE_REVISION', 'Board changed; refresh before binding');
      const session = text(sessionId, 'sessionId', 200);
      requireValue(isThreadId(session), 'INVALID_THREAD_ID', 'Supply the full 36-character native thread UUID. A short label or anonymous session ID cannot bind a conversation.');
      const previous = b.rootSessionId, lead = b.members.find(m => m.id === 'lead');
      requireValue(lead, 'MEMBER_NOT_FOUND', 'Lead member not found');
      if (previous && previous !== session) {
        requireValue(correction.previousSessionId === previous, 'BINDING_CORRECTION_REQUIRED', 'Acknowledge the exact previous binding');
        requireValue(correction.confirmRebind === true, 'BINDING_CONFIRMATION_REQUIRED', 'Confirm the displayed old/new identity and history isolation before changing the binding');
        const evidence = text(correction.evidence, 'evidence', 4000), generation = b.bindingGeneration ?? 0;
        b.bindingHistory ??= [];
        b.bindingHistory.push({ sessionId: previous, generation, changedAt: now(), evidence, lead: { ...lead } });
        b.bindingGeneration = generation + 1;
        for (const member of b.members.filter(m => m.id !== 'lead' && !m.historyOnly)) {
          member.historyOnly = true;
          member.historyBinding = { sessionId: previous, generation, parentThreadId: b.members.find(m => m.id === member.parentId)?.nativeId ?? null };
        }
        for (const workflow of b.workflows ?? []) if (!workflow.historyOnly) { workflow.historyOnly = true; workflow.historyBinding = { sessionId: previous, generation }; }
        for (const run of b.runs ?? []) run.originBinding ??= { sessionId: previous, generation };
      } else {
        requireValue(!lead.nativeId || lead.nativeId === session, 'IDENTITY_CONFLICT', 'The lead already has a different native identity');
      }
      b.rootSessionId = session;
      lead.nativeId = session;
      lead.nativeIdentity = { source: correction.nativeIdSource ?? 'user-supplied', evidence: correction.evidence ?? 'Full thread UUID explicitly supplied through session binding', observedAt: now(), verification: 'reported-unverified' };
      this.event(b, previous && previous !== session ? 'session_binding_changed' : 'session_bound', 'Full UUID explicitly supplied; old execution sources retained separately');
    });
  }
  observeRuntime(id, input) {
    return this.transact(id, b => {
      requireValue(b.revision === input.expectedRevision, 'STALE_REVISION', 'Board changed; refresh before recording runtime state');
      const m=b.members.find(m=>m.id===input.memberId);
      requireValue(m && !m.historyOnly && m.runtimeRef===input.runtimeRef, 'RUNTIME_MISMATCH', 'Observe only the exact currently recorded member path');
      const parent=b.members.find(p=>p.id===m.parentId);
      requireValue(parent && isThreadId(parent.nativeId) && input.sourceThreadId===parent.nativeId, 'SOURCE_THREAD_MISMATCH', 'Observe only from the exact recorded spawning parent conversation');
      const when=Date.parse(input.observedAt);
      requireValue(Number.isFinite(when) && when<=Date.now()+30000, 'INVALID_ARGUMENT', 'Provide the actual observation time');
      requireValue(!m.runtimeObservation || when>=Date.parse(m.runtimeObservation.observedAt), 'STALE_OBSERVATION', 'An older observation cannot overwrite newer state');
      requireValue(input.source==='collaboration.list_agents' || input.source==='collaboration.wait_agent', 'INVALID_ARGUMENT', 'Only an actual supported collaboration observation can drive runtime state');
      requireValue(!input.resumeAvailable || ['running','idle','completed'].includes(input.state), 'INVALID_ARGUMENT', 'Resume cannot be available when agent status is failed, cancelled or unknown');
      m.runtimeObservation={state:input.state, observedAt:new Date(when).toISOString(), source:input.source, sourceThreadId:input.sourceThreadId,
        evidence:text(input.evidence,'evidence',4000), resumeAvailable:input.resumeAvailable===true,
        verification:'lead-relayed-not-server-authenticated'};
      m.status=({running:'working',idle:'idle',completed:'completed',failed:'blocked',cancelled:'cancelled',unknown:'unknown'})[input.state];
      m.observedAt=m.runtimeObservation.observedAt;m.source='reported';
      this.event(b,'runtime_observed',`${m.id}: ${input.state}`);
    });
  }
  archive(id, expectedRevision, action, confirmed) {
    requireValue(confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm archive/restore scope first');
    return this.transact(id, b => {
      requireValue(b.revision === expectedRevision, 'STALE_REVISION', 'Board changed; refresh first');
      b.archivedAt = action === 'archive' ? now() : null;
      this.event(b, action === 'archive' ? 'board_archived' : 'board_restored', 'Only the workbench visibility changed; all records and project files retained');
    });
  }
  reportMember(id, input) {
    return this.transact(id, b => {
      const memberId = text(input.memberId, 'memberId');
      requireValue(!b.memberAliases?.[memberId], 'MEMBER_MERGED', 'This exact native member was consolidated; refresh and use its canonical ID');
      const existing = b.members.find(m => m.id === memberId);
      requireValue(!existing?.historyOnly, 'HISTORICAL_BINDING', 'This member belongs to a previous conversation binding; register a new member ID');
      requireValue(!existing || existing.source !== 'hook', 'OBSERVED_MEMBER', 'Hook observations cannot be overwritten by reports');
      if (existing?.nativeId && input.nativeId) requireValue(existing.nativeId===input.nativeId,'IDENTITY_CONFLICT','A recorded native identity cannot be silently replaced');
      if (existing?.runtimeRef && input.runtimeRef) requireValue(existing.runtimeRef===input.runtimeRef,'REFERENCE_CONFLICT','A recorded runtime reference cannot be silently replaced');
      const parentId = memberId === 'lead' ? null : (input.parentId ?? existing?.parentId ?? 'lead');
      requireValue(!existing?.nativeTopology || parentId === existing.parentId, 'VERIFIED_PARENT_CONFLICT', 'A caller report cannot replace verified native parentage');
      requireValue(parentId === null || b.members.some(m => m.id === parentId), 'MEMBER_NOT_FOUND', 'Parent member not found');
      let cursor = parentId;
      while (cursor) {
        requireValue(cursor !== memberId, 'MEMBER_CYCLE', 'Member relationship cannot form a cycle');
        cursor = b.members.find(m => m.id === cursor)?.parentId;
      }
      const workflowId = input.workflowId === '' ? null : input.workflowId ?? existing?.workflowId ?? null;
      if (workflowId) requireValue((b.workflows ?? []).some(w => w.id === workflowId && w.parentMemberId === parentId), 'WORKFLOW_PARENT', 'Workflow group must belong to the actual agent parent');
      const member = { ...observation(input, existing), id: memberId, name: text(input.name, 'name', 100),
        role: memberId === 'lead' ? 'lead' : 'member', parentId, source: 'reported',
        status: input.status ?? 'unknown', nativeId: input.nativeId ?? existing?.nativeId ?? null, workflowId,
        observedAt: now() };
      if (existing) b.members[b.members.indexOf(existing)] = member;
      else { requireValue(b.members.length < 100, 'MEMBER_LIMIT', 'Maximum 100 members'); b.members.push(member); }
      this.event(b, 'member_report', `${member.name}: ${member.status}`);
    });
  }
  dependencies(b, ids, self) {
    requireValue(Array.isArray(ids) && ids.length <= 100 && new Set(ids).size === ids.length, 'INVALID_ARGUMENT', 'Dependencies must be unique task IDs');
    for (const id of ids) {
      requireValue(id !== self, 'DEPENDENCY_CYCLE', 'A task cannot depend on itself');
      requireValue(b.tasks.some(t => t.id === id && t.status !== 'deleted'), 'TASK_NOT_FOUND', `Dependency ${id} not found`);
    }
    return [...ids];
  }
  graph(b) {
    const tasks = new Map(b.tasks.filter(t => t.status !== 'deleted').map(t => [t.id, t]));
    const done = new Set(), active = new Set();
    function visit(id) {
      requireValue(!active.has(id), 'DEPENDENCY_CYCLE', 'Task dependencies cannot form a cycle');
      if (done.has(id)) return;
      active.add(id);
      for (const dependency of tasks.get(id).blockedBy) visit(dependency);
      active.delete(id); done.add(id);
    }
    for (const id of tasks.keys()) visit(id);
  }
  ready(b, t) { return t.blockedBy.every(id => b.tasks.find(d => d.id === id)?.status === 'completed'); }
  createTask(id, input) {
    return this.transact(id, b => {
      requireValue(b.tasks.filter(t => t.status !== 'deleted').length < 500, 'TASK_LIMIT', 'Maximum 500 tasks');
      const task = { id: `task-${b.nextTask++}`, title: text(input.title, 'title'),
        description: input.description ? text(input.description, 'description', 16384) : '',
        blockedBy: this.dependencies(b, input.blockedBy ?? []), status: 'pending',
        ownerId: null, revision: 1, updatedAt: now() };
      b.tasks.push(task); this.graph(b); this.event(b, 'task_created', `${task.id}: ${task.title}`);
    });
  }
  updateTask(id, input) {
    return this.transact(id, b => {
      const t = b.tasks.find(t => t.id === input.taskId);
      requireValue(t && t.status !== 'deleted', 'TASK_NOT_FOUND', 'Task not found');
      requireValue(t.revision === input.expectedRevision, 'STALE_REVISION', `Task changed (current revision ${t.revision}); refresh and retry`);
      // actorId is a workflow convention supplied by the caller, NOT an authenticated identity.
      const actor = b.members.find(m => m.id === input.actorId);
      requireValue(actor, 'MEMBER_NOT_FOUND', 'Actor member not found');
      const ownerOrLead = () => requireValue(actor.role === 'lead' || t.ownerId === actor.id, 'OWNER_REQUIRED', 'Only the declared owner or lead can perform this transition');
      if (input.action === 'complete') requireValue(!(b.runs ?? []).some(r => r.taskId === t.id && !['succeeded', 'failed'].includes(r.status)),
        'RUN_ACTIVE', 'Collect and confirm the execution result before completing this task');
      switch (input.action) {
        case 'claim':
          requireValue(t.status === 'pending' && this.ready(b, t), 'TASK_BLOCKED', 'Task is not ready to claim');
          requireValue(!t.ownerId || t.ownerId === actor.id, 'ALREADY_CLAIMED', 'Task already owned');
          t.status = 'in_progress'; t.ownerId = actor.id; break;
        case 'release':
          ownerOrLead(); requireValue(t.status === 'in_progress', 'INVALID_TRANSITION', 'Only an in-progress task can be released');
          t.status = 'pending'; t.ownerId = null; break;
        case 'complete':
          ownerOrLead(); requireValue(t.status === 'in_progress' && this.ready(b, t), 'TASK_BLOCKED', 'Only an in-progress, unblocked task can complete');
          t.status = 'completed'; break;
        case 'reopen':
          ownerOrLead(); requireValue(t.status === 'completed', 'INVALID_TRANSITION', 'Only a completed task can reopen');
          t.status = 'pending'; t.ownerId = null; break;
        case 'reassign': {
          requireValue(actor.role === 'lead', 'LEAD_REQUIRED', 'Only the declared lead can reassign');
          requireValue(t.status !== 'completed', 'INVALID_TRANSITION', 'Reopen a completed task first');
          const assignee = input.ownerId;
          if (!assignee) { t.status = 'pending'; t.ownerId = null; break; }
          requireValue(b.members.some(m => m.id === assignee), 'MEMBER_NOT_FOUND', 'Assignee not found');
          requireValue(this.ready(b, t), 'TASK_BLOCKED', 'Task has unfinished dependencies');
          t.status = 'in_progress'; t.ownerId = assignee; break;
        }
        case 'edit':
          ownerOrLead(); requireValue(input.title !== undefined || input.description !== undefined, 'INVALID_ARGUMENT', 'Edit needs a title or description');
          if (input.title !== undefined) t.title = text(input.title, 'title');
          if (input.description !== undefined) t.description = text(input.description, 'description', 16384, true);
          break;
        case 'set_dependencies':
          ownerOrLead(); requireValue(input.blockedBy !== undefined, 'INVALID_ARGUMENT', 'Dependencies required');
          requireValue(t.status !== 'completed', 'INVALID_TRANSITION', 'Reopen before changing dependencies');
          t.blockedBy = this.dependencies(b, input.blockedBy, t.id); break;
        case 'delete':
          ownerOrLead(); requireValue(!b.tasks.some(d => d.status !== 'deleted' && d.blockedBy.includes(t.id)), 'HAS_DEPENDENTS', 'Other tasks still depend on this task');
          t.status = 'deleted'; break;
        default: throw new BoardError('INVALID_ARGUMENT', 'Unknown action');
      }
      this.graph(b); t.revision++; t.updatedAt = now();
      this.event(b, 'task_updated', `${t.id}: ${input.action}`);
    });
  }
  observeHook(event) {
    const supported = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
    requireValue(supported.includes(event.hook_event_name), 'UNSUPPORTED_EVENT', 'Unsupported lifecycle event');
    const session = text(event.session_id, 'session_id');
    const child = event.hook_event_name.startsWith('Subagent');
    if (child) text(event.agent_id, 'agent_id');
    // Only explicitly bound boards receive events. Never scan transcripts or session databases.
    const targets = this.list().filter(b => b.rootSessionId === session);
    for (const target of targets) this.transact(target.id, b => {
      const memberId = child ? `native:${event.agent_id}` : 'lead';
      const previous = b.members.find(m => m.id === memberId);
      const status = ['SubagentStart', 'UserPromptSubmit'].includes(event.hook_event_name) ? 'start_observed'
        : ['SubagentStop', 'Stop'].includes(event.hook_event_name) ? 'stop_observed'
          : event.hook_event_name === 'SessionEnd' ? 'end_observed'
            : event.hook_event_name === 'Interrupt' ? 'interrupt_observed' : 'session_observed';
      const member = { id: memberId, name: child ? text(event.agent_type || 'subagent', 'agent_type', 100) : b.members[0].name,
        role: child ? 'member' : 'lead', parentId: child ? 'lead' : null,
        source: 'hook', status, nativeId: isThreadId(child ? event.agent_id : session) ? (child ? event.agent_id : session) : null, hookSessionRef: child ? event.agent_id : session, observedAt: now(),
        relation: child ? 'session_association' : null };
      if (previous) b.members[b.members.indexOf(previous)] = member;
      else { requireValue(b.members.length < 100, 'MEMBER_LIMIT', 'Maximum 100 members'); b.members.push(member); }
      this.event(b, 'lifecycle', `${event.hook_event_name}: ${memberId}`);
    });
    return targets.length;
  }
  view(boardOrId) {
    const b = typeof boardOrId === 'string' ? this.read(boardOrId) : boardOrId;
    return { ...b, runs: b.runs ?? [], workflows: (b.workflows ?? []).map(w => ({ ...w, stale: Date.now() - Date.parse(w.observedAt) > 120000 })), sessionTree: sessionTree(b), tasks: b.tasks.filter(t => t.status !== 'deleted').map(t => ({ ...t,
      ready: this.ready(b, t), unresolved: t.blockedBy.filter(id => b.tasks.find(d => d.id === id)?.status !== 'completed') })),
      members: b.members.map(m => ({ ...m,
        runtimeStatus: runtimeView(m),
        stale: Date.now() - Date.parse(m.observedAt) > 120000,
        runtimeFresh: !!m.runtimeObservation && Date.now()-Date.parse(m.runtimeObservation.observedAt) <= 120000 && Date.now()>=Date.parse(m.runtimeObservation.observedAt)-30000,
        resumable: null })),
      capabilities: { nativeDiscovery: !!this.nativeEventJournal, nativeJump: false, nativeResume: false,
        hostConversationId: false, nativeExecution: 'lead-orchestrated-reported', lifecycle: 'optional-local-hooks-unverified-in-host',
        identity: 'caller-declared-not-authenticated', nativeTranscript: false, workRecords: 'explicit-reports-only' } };
  }
}
