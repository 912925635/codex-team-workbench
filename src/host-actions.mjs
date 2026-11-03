import { randomUUID } from 'node:crypto';
import { requireValue, text } from './validation.mjs';
import { isThreadId } from './history-sync.mjs';
const hasFreshContinuation = (member, parent) => {
  const age = Date.now() - Date.parse(member.runtimeObservation?.observedAt ?? '');
  return Boolean(member.runtimeRef && member.runtimeObservation?.resumeAvailable && age >= -30000 && age <= 120000 &&
    isThreadId(parent?.nativeId) && member.runtimeObservation.sourceThreadId === parent.nativeId);
};
const hasVerifiedParent = (member, parent, board) => Boolean(member.runtimeRef &&
  isThreadId(parent?.nativeId) && member.nativeTopology?.source === 'app-server.thread/read metadata' &&
  member.nativeTopology.rootThreadId === board.rootSessionId && member.nativeTopology.parentThreadId === parent.nativeId);
export function requestHostAction(store, input) {
  let action;
  const board = store.transact(input.boardId, b => {
    const m = b.members.find(m => m.id === input.memberId && !m.historyOnly);
    requireValue(!b.archivedAt && m && isThreadId(m.nativeId), 'EXACT_TARGET_REQUIRED', 'Select a current member with an exact native UUID');
    requireValue(!input.expectedNativeId || input.expectedNativeId===m.nativeId, 'ACTION_TARGET_CHANGED', 'The selected native target changed; refresh before requesting');
    requireValue(!b.hostActions?.some(a => a.memberId === m.id && a.kind === input.kind && ['requested','sent'].includes(a.status)), 'ACTION_PENDING', 'This member already has a pending request');
    if (input.kind === 'resume') {
      const parent = b.members.find(p => p.id === m.parentId && !p.historyOnly);
      requireValue(hasFreshContinuation(m, parent) || hasVerifiedParent(m, parent, b),
        'RESUME_NOT_VERIFIED', 'An exact spawning parent/path is required before asking that parent to verify native continuation');
      text(input.instructions, 'instructions', 16384);
    }
    b.hostActions ??= [];requireValue(b.hostActions.length < 500, 'ACTION_LIMIT', 'Maximum 500 host action receipts');
    action = { id: `host-${randomUUID()}`, kind: input.kind, memberId: m.id, nativeId: m.nativeId,
      rootSessionId: b.rootSessionId, runtimeRef: m.runtimeRef ?? null, status: 'requested', revision: 1,
      parentThreadId: b.members.find(p => p.id === m.parentId)?.nativeId ?? null,
      instructions: input.kind === 'resume' ? input.instructions : null, createdAt: new Date().toISOString(),
      requiresCapabilityCheck: input.kind === 'resume',
      verification: 'host-result-not-yet-reported', result: null };
    b.hostActions.push(action);store.event(b, 'host_action_requested', `${action.kind}: ${m.id}`);
  });
  return { board, action };
}
export function recordHostAction(store, input) {
  let action;
  const board = store.transact(input.boardId, b => {
    action = b.hostActions?.find(a => a.id === input.actionId);
    requireValue(action && action.revision === input.expectedRevision, 'STALE_ACTION', 'Refresh this exact action receipt');
    requireValue(['requested','sent'].includes(action.status), 'ACTION_TERMINAL', 'Action already has a terminal receipt');
    const member = b.members.find(m => m.id === action.memberId && !m.historyOnly), cancel = input.status === 'cancelled';
    requireValue(input.nativeId === action.nativeId && (cancel || (b.rootSessionId === action.rootSessionId && member?.nativeId === action.nativeId)),
      'ACTION_TARGET_CHANGED', 'Never apply an old action to a different conversation or member');
    requireValue(!cancel || (['ui/message','panel-user-confirmation'].includes(input.source) && input.confirmed === true), 'CONFIRMATION_REQUIRED', 'Cancel only the explicitly selected workbench wait; this does not stop a host operation');
    const sources = cancel ? ['ui/message','panel-user-confirmation'] : action.kind === 'navigate' ? ['codex-app-tools.navigate_to_codex_page','ui/message','ui/open-link']
      : ['collaboration.followup_task','collaboration.send_message','ui/message'];
    requireValue(sources.includes(input.source), 'ACTION_SOURCE_MISMATCH', 'Provide the actual supported operation used');
    requireValue(input.status !== 'succeeded' || (!['ui/message','ui/open-link'].includes(input.source) && input.confirmed === true),
      'HOST_CONFIRMATION_REQUIRED', 'Message delivery alone does not confirm navigation or continuation');
    requireValue(input.status !== 'accepted' || (action.kind === 'navigate' && input.source === 'ui/open-link' && input.confirmed === true),
      'HOST_LINK_CONFIRMATION_REQUIRED', 'Only an actual host link acknowledgment may be accepted; the target view remains unverified');
    requireValue(input.source !== 'ui/open-link' || ['accepted','failed'].includes(input.status),
      'ACTION_SOURCE_MISMATCH', 'A host link response is accepted or failed, never a visual navigation confirmation');
    if (action.kind === 'resume' && input.status === 'succeeded') {
      const parent = b.members.find(p => p.id === member.parentId && !p.historyOnly);
      requireValue(member.runtimeRef === action.runtimeRef && parent?.nativeId === action.parentThreadId &&
        hasFreshContinuation(member, parent), 'RESUME_NOT_VERIFIED',
        'Record the actual spawning parent capability/agent observation and supported continuation receipt before success');
    }
    action.status = input.status;action.result = text(input.result, 'result', 2000);
    action.source = input.source;action.verification = cancel ? 'panel-user-confirmed-wait-cancelled' : input.source === 'ui/open-link'
      ? 'host-link-request-acknowledged-target-view-unverified' : 'lead-relayed-host-receipt-not-server-authenticated';
    action.updatedAt = new Date().toISOString();action.revision++;
    store.event(b, 'host_action_result', `${action.id}: ${action.status}`);
  });
  return { board, action };
}
