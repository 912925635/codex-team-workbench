import { requireValue } from './validation.mjs';
import { isThreadId } from './history-sync.mjs';
// Consolidate only after exact UUID equality, never by name or shared session.
export function mergeNativeMember(board, keep, duplicate) {
  requireValue(keep !== duplicate && isThreadId(keep.nativeId) && keep.nativeId === duplicate.nativeId && !keep.historyOnly && !duplicate.historyOnly,
    'IDENTITY_CONFLICT', 'Only the same current native UUID can merge');
  requireValue(!keep.runtimeRef || !duplicate.runtimeRef || keep.runtimeRef === duplicate.runtimeRef,
    'REFERENCE_CONFLICT', 'Same UUID has conflicting runtime paths');
  if (duplicate.nativeTopology) requireValue(keep.parentId === duplicate.parentId || keep.relation === 'session_association',
    'PARENT_MISMATCH', 'Do not merge a spawn report with a different verified parent');
  if (duplicate.nativeTopology) { keep.parentId = duplicate.parentId; keep.relation = duplicate.relation; keep.nativeTopology = duplicate.nativeTopology; }
  keep.runtimeRef ??= duplicate.runtimeRef;
  if (Date.parse(duplicate.runtimeObservation?.observedAt ?? '') >= Date.parse(keep.runtimeObservation?.observedAt ?? '') || !keep.runtimeObservation) {
    for (const key of ['runtimeObservation','nativeLifecycle']) if (duplicate[key]) keep[key] = duplicate[key];
    if (duplicate.runtimeObservation) { keep.observedAt = duplicate.observedAt; keep.status = duplicate.status; }
  }
  if (duplicate.source === 'hook') { keep.source = 'hook'; keep.nativeIdentity ??= duplicate.nativeIdentity; }
  for (const m of board.members) if (m.parentId === duplicate.id) m.parentId = keep.id;
  for (const w of board.workflows ?? []) if (w.parentMemberId === duplicate.id) w.parentMemberId = keep.id;
  for (const task of board.tasks) if (task.ownerId === duplicate.id) task.ownerId = keep.id;
  for (const run of board.runs ?? []) for (const key of ['memberId','parentMemberId']) if (run[key] === duplicate.id) run[key] = keep.id;
  board.memberAliases ??= {};
  for (const [alias, id] of Object.entries(board.memberAliases)) if (id === duplicate.id) board.memberAliases[alias] = keep.id;
  board.memberAliases[duplicate.id] = keep.id;
  board.members.splice(board.members.indexOf(duplicate), 1);
  // Work records retain immutable payloads/digests and original node IDs;
  // readers follow aliases so no record needs destructive rewriting.
}
