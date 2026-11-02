import { validate, BoardError } from './validation.mjs';
import { requestExecution, recordExecution } from './execution.mjs';
import { recordWorkflow, appendRecord, readRecords, importThreadPage } from './browse.mjs';
import { bindAgentActivity } from './history-sync.mjs';
import { syncNativeEvents } from './native-events.mjs';
import { syncNativeTopology } from './native-topology.mjs';
import { requestHostAction, recordHostAction } from './host-actions.mjs';
const str = (maxLength = 200) => ({ type: 'string', minLength: 1, maxLength });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ids = { type: 'array', items: str(), maxItems: 100 };
const revision = { type: 'integer', minimum: 1 };
const natural = { type: 'integer', minimum: 0 };
const identityFields = { runtimeRef: str(300), nativeId: str(), hostId:str(), spawnCallId:str(), nativeIdSource: { type: 'string', enum: ['host-env', 'host-spawn-receipt', 'public-thread-read', 'user-supplied'] }, evidence: str(4000) };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
// Version the view independently of any host-cached old tool/resource metadata.
export const UI_URI = 'ui://team-workbench/panel/0.5.1';
export const LEGACY_UI_URI = 'ui://team-workbench/panel';
export const tools = [
  { name: 'team_panel', title: '团队工作台', description: 'Open the persistent shared task board and team map. With boardId, remember that selection if the host supplies anonymous session metadata; {} reopens it. This correlation is not a native Codex thread ID. Does not discover or control agents.',
    inputSchema: obj({ boardId: str() }), annotations: write,
    _meta: { ui: { resourceUri: UI_URI }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } } },
  {name:'team_request_host_action',description:'Record a user-requested exact-target navigation or supported continuation. Does not execute the host operation. A message acknowledgment is not success.',inputSchema:obj({boardId:str(),memberId:str(),kind:{type:'string',enum:['navigate','resume']},instructions:str(16384)},['boardId','memberId','kind']),annotations:write},
  {name:'team_record_host_action',description:'Record the actual supported host result for one exact pending action. Success requires a positive host receipt; ui/message delivery alone cannot succeed. User-confirmed cancelled only closes the workbench wait and never stops a native operation. Remains labeled lead-relayed.',inputSchema:obj({boardId:str(),actionId:str(),expectedRevision:revision,nativeId:str(),status:{type:'string',enum:['sent','succeeded','failed','cancelled']},source:{type:'string',enum:['codex-app-tools.navigate_to_codex_page','collaboration.followup_task','collaboration.send_message','ui/message']},confirmed:{type:'boolean'},result:str(2000)},['boardId','actionId','expectedRevision','nativeId','status','source','result']),annotations:write},
  { name: 'team_snapshot', description: 'List boards or read one board, including task revisions and source-labeled member observations. No native agent discovery.',
    inputSchema: obj({ boardId: str() }), annotations: readOnly },
  { name: 'team_create_board', description: 'Create an empty local team board. Does not create any agent or thread.',
    inputSchema: obj({ title: str() }, ['title']), annotations: write },
  { name: 'team_bind_session', description: 'Bind or explicitly change a board conversation using a full native UUID. A change requires exact previousSessionId, confirmRebind=true and evidence after showing old/new IDs and history isolation to the user. Old members, executions and snapshots retain their original source and cannot be synced under the new origin. Never guess an ID.',
    inputSchema: obj({ boardId: str(), sessionId: str(), expectedRevision: revision, previousSessionId: str(), confirmRebind: {type:'boolean'}, nativeIdSource: {type:'string',enum:['public-thread-read','user-supplied']}, evidence: str(4000) }, ['boardId', 'sessionId', 'expectedRevision']), annotations: write },
  { name: 'team_archive_board', description: 'Archive or restore a workbench after explicit user confirmation of scope. This is reversible; it never deletes tasks, member records, transcripts or project files and does not stop agents.',
    inputSchema: obj({boardId:str(),expectedRevision:revision,action:{type:'string',enum:['archive','restore']},confirmed:{type:'boolean'}},['boardId','expectedRevision','action','confirmed']),annotations:write },
  { name:'team_observe_runtime',description:'Record an actual collaboration list_agents or wait_agent state for the exact recorded runtime path. Evidence and observation time are lead-relayed and not server-authenticated; stale observations cannot overwrite newer ones. resumeAvailable is only true when the lead actually sees the exact agent and has the supported followup tool.',
    inputSchema:obj({boardId:str(),memberId:str(),runtimeRef:str(300),sourceThreadId:str(),expectedRevision:revision,state:{type:'string',enum:['running','idle','completed','failed','cancelled','unknown']},observedAt:str(100),source:{type:'string',enum:['collaboration.list_agents','collaboration.wait_agent']},resumeAvailable:{type:'boolean'},evidence:str(4000)},['boardId','memberId','runtimeRef','sourceThreadId','expectedRevision','state','observedAt','source','resumeAvailable','evidence']),annotations:write },
  { name: 'team_report_member', description: 'Record a caller-reported member and state, labeled reported. Does not create, verify, resume, or control a native agent. actor IDs are conventions, not authenticated identities.',
    inputSchema: obj({ boardId: str(), memberId: str(), name: str(100), parentId: str(), ...identityFields,
      workflowId: { type: 'string', maxLength: 200 }, tokenTotal: natural, durationMs: natural,
      status: { type: 'string', enum: ['unknown', 'working', 'idle', 'completed', 'blocked'] } }, ['boardId', 'memberId', 'name', 'status']), annotations: write },
  { name: 'team_create_task', description: 'Create an unassigned pending task with optional dependencies. Task assignment alone does not dispatch work to any agent.',
    inputSchema: obj({ boardId: str(), title: str(), description: { type: 'string', maxLength: 16384 }, blockedBy: ids }, ['boardId', 'title']), annotations: write },
  { name: 'team_update_task', description: 'Update a shared task with expectedRevision. Refresh after STALE_REVISION. actorId declares a workflow role, not host identity. Supports claim, release, complete, reopen, edit, dependencies, reassign, soft delete.',
    inputSchema: obj({ boardId: str(), taskId: str(), expectedRevision: revision, actorId: str(),
      action: { type: 'string', enum: ['claim', 'release', 'complete', 'reopen', 'edit', 'set_dependencies', 'reassign', 'delete'] },
      ownerId: { type: 'string', maxLength: 200 }, title: str(), description: { type: 'string', maxLength: 16384 }, blockedBy: ids },
    ['boardId', 'taskId', 'expectedRevision', 'actorId', 'action']), annotations: { ...write, destructiveHint: true } },
  { name: 'team_request_execution', description: 'Request native execution through the lead. Starts no agent; the lead must use actual host collaboration tools and record their returned reference.',
    inputSchema: obj({ boardId: str(), taskId: str(), expectedTaskRevision: revision, instructions: str(16384), parentMemberId: str(), workflowId: str() },
      ['boardId', 'taskId', 'expectedTaskRevision']), annotations: write },
  { name: 'team_record_execution', description: 'Record a real lead spawn receipt, worker start/result, or parent-collected result. These are reported observations, not authenticated runtime telemetry. Never invent runtimeRef or success. confirm completes the task only after worker report and collection.',
    inputSchema: obj({ boardId: str(), runId: str(), expectedRevision: revision,
      action: { type: 'string', enum: ['dispatched', 'running', 'report_result', 'confirm', 'fail'] },
      ...identityFields, memberName: str(100), result: str(16384),
      artifacts: { type: 'array', items: str(500), maxItems: 30 } },
      ['boardId', 'runId', 'expectedRevision', 'action', 'evidence']), annotations: write },
  { name: 'team_record_workflow', description: 'Record an actual caller-owned workflow/run group, with source evidence and revision. This groups agents visually and does not replace their actual parent relationships or start any work. Use expectedRevision=0 for a new group.',
    inputSchema: obj({ boardId: str(), workflowId: str(), title: str(), parentMemberId: str(), expectedRevision: natural,
      status: { type: 'string', enum: ['unknown', 'running', 'completed', 'failed', 'cancelled'] }, evidence: str(4000) },
      ['boardId', 'workflowId', 'title', 'parentMemberId', 'expectedRevision', 'status', 'evidence']), annotations: write },
  { name: 'team_append_record', description: 'Append an explicitly agent-reported, user-visible work record, not a native transcript. Use a unique recordId for idempotent retry. Do not collect hidden reasoning, credentials, or private session files. All content stays labeled reported.',
    inputSchema: obj({ boardId: str(), nodeKind: { type: 'string', enum: ['member', 'workflow'] }, nodeId: str(), recordId: str(),
      role: { type: 'string', enum: ['user', 'assistant', 'tool', 'note'] }, text: str(16384), evidence: str(4000), observedAt: str(100) },
      ['boardId', 'nodeKind', 'nodeId', 'recordId', 'role', 'text', 'evidence']), annotations: write },
  { name: 'team_read_records', description: 'Page recorded work observations, relayed public-host snapshots and execution receipts for one node. Does not directly read native threads or private host sessions/databases. Complete-native access is explicitly distinguished from stored bounded snapshots.',
    inputSchema: obj({ boardId: str(), nodeKind: { type: 'string', enum: ['member', 'workflow'] }, nodeId: str(), after: natural, limit: { type: 'integer', minimum: 1 } },
      ['boardId', 'nodeKind', 'nodeId']), annotations: readOnly },
  { name: 'team_import_thread_page', description: 'Relay a bounded page actually returned by the public codex-app-tools.read_thread host tool for an explicitly bound member. Starts no model and calls no host API itself. Exact threadId binding required. Import selected visible messages/status/tool summaries, never reasoning or credentials. Snapshots remain marked agent-relayed, paginated/possibly truncated, not complete native transcripts.',
    inputSchema: obj({ boardId:str(), memberId:str(), recordId:str(), threadId:str(), hostId:str(), readAt:str(100), cursor:str(16384), nextCursor:str(16384), evidence:str(4000),
      turns:{type:'array',maxItems:5,items:obj({id:str(),status:str(100),items:{type:'array',maxItems:50,items:obj({id:str(),type:{type:'string',enum:['userMessage','agentMessage','commandExecution','fileChange','functionCallOutput','turnStatus']},text:str(8000)},['id','type','text'])}},['id','status','items'])} },
      ['boardId','memberId','recordId','threadId','readAt','evidence','turns']), annotations:write },
  { name:'team_bind_agent_activity',description:'Resolve and register one recorded child using exact subAgentActivity path/UUID items relayed from its recorded spawning parent. Does not read host history itself. Never substitutes another parent or guesses a UUID. Returns nextRead only after unique mapping; missing/ambiguous/unavailable sources are stored as visible resolution states.',
    inputSchema:obj({boardId:str(),memberId:str(),expectedRuntimeRef:str(300),sourceThreadId:str(),sourceHostId:str(),spawnCallId:str(),unavailableReason:str(2000),
      activities:{type:'array',maxItems:200,items:obj({id:str(),type:{type:'string',enum:['subAgentActivity']},agentPath:str(300),agentThreadId:str(),kind:str(100)},['id','type','agentPath','agentThreadId','kind'])}},
      ['boardId','memberId','expectedRuntimeRef']),annotations:write }
];
export function dispatch(store, name, args = {}, context = {}) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new BoardError('TOOL_NOT_FOUND', 'Unknown tool');
  validate(tool.inputSchema, args);
  let board;
  switch (name) {
    case 'team_request_host_action': return requestHostAction(store,args);
    case 'team_record_host_action': return recordHostAction(store,args);
    case 'team_panel': case 'team_snapshot': {
      const boardId = args.boardId ?? store.selectedBoard(context.anonymousSession);
      if (name === 'team_panel' && args.boardId) store.selectBoard(context.anonymousSession, args.boardId);
      let nativeEvents = { enabled: false, state: 'disabled', applied: 0 };
      if (boardId) {
        try { nativeEvents = syncNativeEvents(store, boardId); }
        catch { nativeEvents = { enabled: !!store.nativeEventJournal, state: 'error-reading-local-hook-journal', applied: 0 }; }
      }
      const nativeTopology = boardId ? syncNativeTopology(store, boardId) : { state: 'unbound' };
      const selected = boardId ? store.view(boardId) : null;
      return { boards: store.list(), archivedBoards: store.list({includeArchived:true}).filter(b=>b.archivedAt), board: selected?.archivedAt ? null : selected,
        nativeEvents,
        nativeTopology,
        conversationAssociation: store.sessionHash(context.anonymousSession) ? 'anonymous-host-session' : 'not-provided' };
    }
    case 'team_create_board': board = store.view(store.create(args.title)); break;
    case 'team_bind_session': board = store.bind(args.boardId, args.sessionId, args.expectedRevision, args); break;
    case 'team_archive_board': {
      board = store.archive(args.boardId,args.expectedRevision,args.action,args.confirmed);
      if (args.action === 'restore') store.selectBoard(context.anonymousSession,board.id);
      return {boards:store.list(),archivedBoards:store.list({includeArchived:true}).filter(b=>b.archivedAt),board:args.action==='archive'?null:board};
    }
    case 'team_report_member': board = store.reportMember(args.boardId, args); break;
    case 'team_observe_runtime': board = store.observeRuntime(args.boardId,args); break;
    case 'team_create_task': board = store.createTask(args.boardId, args); break;
    case 'team_update_task': board = store.updateTask(args.boardId, args); break;
    case 'team_request_execution': board = requestExecution(store, args); break;
    case 'team_record_execution': board = recordExecution(store, args); break;
    case 'team_record_workflow': board = recordWorkflow(store, args); break;
    case 'team_append_record': return appendRecord(store, args);
    case 'team_read_records': return readRecords(store, args);
    case 'team_import_thread_page': return importThreadPage(store,args);
    case 'team_bind_agent_activity': return bindAgentActivity(store,args);
  }
  if (name === 'team_create_board') store.selectBoard(context.anonymousSession, board.id);
  return { boards: store.list(), archivedBoards:store.list({includeArchived:true}).filter(b=>b.archivedAt), board };
}
export function callTool(store, name, args, context) {
  try {
    const result = dispatch(store, name, args, context);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (e) {
    if (!(e instanceof BoardError)) console.error('[team-workbench] Internal operation failed:', e.message);
    const error = { code: e instanceof BoardError ? e.code : 'INTERNAL_ERROR', message: e instanceof BoardError ? e.message : 'Local storage operation failed' };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(error) }], structuredContent: { error } };
  }
}
