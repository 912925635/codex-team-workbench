import { createHash } from 'node:crypto';
import { requireValue, BoardError, text } from './validation.mjs';
import { isThreadId } from './history-sync.mjs';
import { readBoundPublic, readBoundPublicAsync, topologyPlan } from './native-topology.mjs';
import { readRecords, saveRecord } from './browse.mjs';

export function readNativeHistory(request) {
  return readBoundPublic({ ...request, mode: 'history' });
}
export const readNativeHistoryAsync=(request,options)=>readBoundPublicAsync(request,options);

export function prepareNativeHistoryRead(store,input) {
  const original=store.read(input.boardId),{member,threadIds}=scope(original,input);
  return {original,request:{threadIds,rootThreadId:original.rootSessionId,runtimeRef:member.runtimeRef,cursor:null}};
}

function scope(board, input) {
  requireValue(!board.archivedAt, 'BOARD_ARCHIVED', 'Restore the workbench before synchronizing new history');
  const member = board.members.find(m => m.id === input.memberId);
  requireValue(member && !member.historyOnly, 'HISTORICAL_BINDING', 'Select a member of the current board binding');
  requireValue(isThreadId(board.rootSessionId) && isThreadId(member.nativeId), 'THREAD_BINDING_REQUIRED', 'Bind the exact root and member UUID before reading history');
  requireValue(member.nativeId === input.expectedNativeId, 'ACTION_TARGET_CHANGED', 'Member thread changed; refresh before reading');
  const ids = [], seen = new Set();
  let current = member;
  while (current && !seen.has(current.id) && ids.length < 100) {
    seen.add(current.id);
    requireValue(!current.historyOnly && isThreadId(current.nativeId), 'PARENT_ID_REQUIRED', 'Every recorded ancestor needs an exact current thread UUID');
    ids.push(current.nativeId);
    if (current.id === 'lead') break;
    current = board.members.find(m => m.id === current.parentId);
  }
  requireValue(current?.id === 'lead' && current.nativeId === board.rootSessionId, 'PARENT_ID_REQUIRED', 'The member must reach this workbench root through its recorded parents');
  return { member, threadIds: [...new Set(ids)] };
}

function sameScope(board, original, input) {
  const { member, threadIds } = scope(board, input), before = original.members.find(m => m.id === input.memberId);
  requireValue(board.rootSessionId === original.rootSessionId && (board.bindingGeneration ?? 0) === (original.bindingGeneration ?? 0)
    && member.runtimeRef === before.runtimeRef && member.parentId === before.parentId
    && JSON.stringify(threadIds) === JSON.stringify(scope(original,input).threadIds),
  'ACTION_TARGET_CHANGED', 'Board binding or member ancestry changed during the read; no page was saved');
  return member;
}

export function syncNativeHistory(store, input, prepared = null) {
  const original = prepared?.original ?? store.read(input.boardId), { member, threadIds } = scope(original, input);
  requireValue(store.nativeHistoryReader || prepared?.page, 'PUBLIC_HISTORY_UNAVAILABLE', 'This MCP connection has no supported direct history reader; no main-chat message was sent');
  let cursor = null;
  if (input.beforeRecordId) {
    const row = store.db.prepare('SELECT payload FROM work_records WHERE board_id=? AND record_id=?').get(original.id, input.beforeRecordId);
    const previous = row ? JSON.parse(row.payload) : null;
    requireValue(previous?.nodeId === member.id && previous?.source === 'public-app-server-page'
      && previous.hostPage?.threadId === member.nativeId && previous.originSessionId === original.rootSessionId
      && (previous.bindingGeneration ?? 0) === (original.bindingGeneration ?? 0),
    'CURSOR_SCOPE_MISMATCH', 'Older-page cursor must come from a saved direct page of this exact member and binding');
    cursor = previous.hostPage.nextCursor;
    requireValue(typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 4096, 'NO_OLDER_PAGE', 'This page has no older-page cursor');
  }
  const readAt = new Date().toISOString();
  try {
    const page = prepared?.page ?? store.nativeHistoryReader({ threadIds, rootThreadId: original.rootSessionId, runtimeRef: member.runtimeRef, cursor });
    requireValue(page?.connected && page.threadId === member.nativeId && Array.isArray(page.threads), 'THREAD_READ_MISMATCH', 'Public read did not return the exact requested thread');
    if (member.id === 'lead') requireValue(page.threads.some(m => m.id === original.rootSessionId), 'PARENT_UNVERIFIED', 'Bound root metadata was not returned');
    else requireValue(topologyPlan(original.rootSessionId, original.members, page.threads).some(p => p.memberId === member.id && p.verified),
      'PARENT_UNVERIFIED', 'Public metadata did not verify the member parent chain and runtime path');
    requireValue(Array.isArray(page.turns) && page.turns.length <= 1, 'INVALID_HISTORY_PAGE', 'Expected at most one turn');
    const turns = page.turns.map(turn => ({ id: text(turn.id, 'turnId'), status: text(turn.status, 'status', 100),
      items: turn.items.filter(item => ['userMessage', 'agentMessage'].includes(item.type)).slice(0, 20)
        .map(item => ({ id: text(item.id, 'itemId'), type: item.type, text: text(item.text, 'message', 1000) })) }));
    const nextCursor = page.nextCursor ?? null;
    requireValue(nextCursor === null || typeof nextCursor === 'string' && nextCursor.length <= 4096, 'INVALID_HISTORY_PAGE', 'Invalid public page cursor');
    const hostPage = { threadId: member.nativeId, cursor, nextCursor, coverage: 'selected-visible-items',
      sourceTool: 'app-server.thread/turns/list', truncated: !!page.truncated, omittedItems: page.omittedItems ?? 0, turns };
    const digest = createHash('sha256').update(JSON.stringify({ bindingGeneration: original.bindingGeneration ?? 0, root: original.rootSessionId, memberId: member.id, hostPage })).digest('hex');
    const recordId = `native-page-${digest}`;
    const previous = store.db.prepare('SELECT payload FROM work_records WHERE board_id=? AND record_id=?').get(original.id, recordId);
    const record = previous ? JSON.parse(previous.payload) : { boardId: original.id, recordId, nodeKind: 'member', nodeId: member.id,
      workflowId: member.workflowId ?? null, bindingGeneration: original.bindingGeneration ?? 0, originSessionId: original.rootSessionId,
      role: 'note', source: 'public-app-server-page', verification: 'public-api-exact-parent-chain',
      text: 'Bounded visible message page read directly from the public app-server API; not a complete transcript.', observedAt: readAt,
      evidence: 'Exact bound UUID and public parent metadata verified before thread/turns/list. One turn, at most 20 user/agent text items, 1000 characters each. No model run or main-chat message. Reasoning and tool bodies omitted.', hostPage };
    delete record.receivedAt;
    requireValue(Buffer.byteLength(JSON.stringify(record), 'utf8') <= 48000, 'PAGE_TOO_LARGE', 'Public page exceeds the local snapshot limit');
    const result = saveRecord(store, record, () => {
      const current = store.read(original.id), node = sameScope(current, original, input);
      requireValue(!prepared?.guard || prepared.guard(current),'AUTOMATIC_SYNC_DISABLED','Automatic history scope changed during the read; no page saved');
      node.nativeHistoryRead = { autoEventKey:node.nativeHistoryRead?.autoEventKey, status: 'succeeded', readAt, recordId, nativeId: node.nativeId,
        rootThreadId: current.rootSessionId, bindingGeneration: current.bindingGeneration ?? 0, source: 'app-server.thread/turns/list' };
      current.revision++; current.updatedAt = readAt;
      store.db.prepare('UPDATE boards SET state=? WHERE id=?').run(JSON.stringify(current), current.id);
    });
    return { ...readRecords(store, { boardId: original.id, nodeKind: 'member', nodeId: member.id }), sync: { readAt, duplicate: result.recorded.duplicate, empty: !turns.length, source: 'app-server.thread/turns/list' } };
  } catch (error) {
    try { store.transact(original.id, current => {
      const node = sameScope(current, original, input);
      if(prepared?.guard && !prepared.guard(current))return false;
      node.nativeHistoryRead = { ...node.nativeHistoryRead, status: 'failed', attemptedAt: readAt, nativeId: node.nativeId,
        rootThreadId: current.rootSessionId, bindingGeneration: current.bindingGeneration ?? 0, reason: String(error.message).slice(0, 1000) };
    }); } catch {}
    if (error instanceof BoardError) throw error;
    throw new BoardError('PUBLIC_HISTORY_UNAVAILABLE', `Direct public history read failed: ${String(error.message).slice(0, 1000)}. No main-chat message was sent.`);
  }
}
