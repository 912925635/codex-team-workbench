import { requireValue, text } from './validation.mjs';
import { mergeNativeMember } from './native-members.mjs';
export const isThreadId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const isPath = ref => typeof ref === 'string' && /^\/root(?:\/[a-z0-9_]+)+$/.test(ref);

export function historySyncPlan(board, member, lastPage = null) {
  if (member.historyOnly) {
    const parent=board.members.find(m=>m.id===member.parentId), old=member.historyBinding?.parentThreadId;
    if (parent && isThreadId(parent.nativeId) && /^[0-9a-f]{8}$/i.test(old ?? '') && parent.nativeId.toLowerCase().startsWith(old.toLowerCase()+'-') && isPath(member.runtimeRef))
      return {mode:'resolve-and-read',memberId:member.id,runtimeRef:member.runtimeRef,parentMemberId:parent.id,parentThreadId:parent.nativeId,hostId:parent.nativeIdentity?.hostId ?? null,historicalRevalidation:true};
    return {mode:'unavailable',memberId:member.id,reason:'Historical member from a previous board binding; stored history remains readable but cannot sync under the new origin.'};
  }
  if (isThreadId(member.nativeId)) return { mode:'read', memberId:member.id, threadId:member.nativeId,
    hostId:lastPage?.hostId ?? member.nativeIdentity?.hostId ?? null };
  const parent=board.members.find(m=>m.id===member.parentId);
  if (parent && isPath(member.runtimeRef)) return { mode:'resolve-and-read',memberId:member.id,runtimeRef:member.runtimeRef,
    parentMemberId:parent.id,parentThreadId:isThreadId(parent.nativeId)?parent.nativeId:null,
    hostId:parent.nativeIdentity?.hostId ?? null };
  return { mode:'unavailable',memberId:member.id,reason:'No recorded native UUID or spawned-agent runtime path is available.' };
}

export function selectAgentActivity(runtimeRef, activities, spawnCallId) {
  const matches=activities.filter(a=>a.type==='subAgentActivity' && a.agentPath===runtimeRef && (!spawnCallId || a.id===spawnCallId));
  if (!matches.length) return { status:'not_found',code:'ACTIVITY_NOT_FOUND',reason:'The provided authorized parent activity pages contain no exact match for this runtime path.' };
  requireValue(matches.every(a=>isThreadId(a.agentThreadId)), 'INVALID_THREAD_ID','Activity must supply actual native thread UUIDs');
  const ids=[...new Set(matches.map(a=>a.agentThreadId))];
  if (ids.length!==1) return { status:'ambiguous',code:'AMBIGUOUS_ACTIVITY',reason:'The runtime path matches multiple thread UUIDs; an exact spawn call ID is required.' };
  return {status:'mapped',nativeId:ids[0],activityItemIds:matches.map(a=>a.id)};
}

// Host calls remain in the actual lead. This code owns exact matching/binding.
export function bindAgentActivity(store,input) {
  let resolution;
  const board=store.transact(input.boardId,b=>{
    const member=b.members.find(m=>m.id===input.memberId);
    requireValue(member,'MEMBER_NOT_FOUND','Member not found');

    requireValue(member.runtimeRef===input.expectedRuntimeRef,'STALE_REFERENCE','Member runtime reference changed; refresh');
    requireValue(isPath(member.runtimeRef) && member.parentId,'INVALID_REFERENCE','Only a recorded spawned child can resolve through parent activity');
    const parent=b.members.find(m=>m.id===member.parentId);
    requireValue(parent,'MEMBER_NOT_FOUND','Recorded spawning parent not found');
    if (member.historyOnly) {
      const old=member.historyBinding?.parentThreadId;
      requireValue(isThreadId(parent.nativeId) && /^[0-9a-f]{8}$/i.test(old ?? '') && parent.nativeId.toLowerCase().startsWith(old.toLowerCase()+'-'), 'HISTORICAL_BINDING', 'Historical source does not match the current parent; cannot revalidate');
    }
    const at=new Date().toISOString();
    if (input.unavailableReason) {
      resolution={status:'blocked',code:'HOST_READ_UNAVAILABLE',reason:text(input.unavailableReason,'unavailableReason',2000)};
    } else if (!isThreadId(parent.nativeId)) {
      resolution={status:'blocked',code:'PARENT_ID_REQUIRED',reason:'The actual spawning conversation must record its own exact thread identity first.'};
    } else {
      requireValue(isThreadId(input.sourceThreadId) && input.sourceThreadId===parent.nativeId,'SOURCE_THREAD_MISMATCH','Read the exact recorded spawning parent; another task cannot substitute for it');
      requireValue(Array.isArray(input.activities),'INVALID_ARGUMENT','Supply the actual public activity items, including an empty array for a zero-activity page');
      if (input.spawnCallId) requireValue(member.spawnCallId===input.spawnCallId,'SPAWN_CALL_MISMATCH','Only an already recorded actual spawn call ID can disambiguate history');
      resolution=selectAgentActivity(member.runtimeRef,input.activities,member.spawnCallId);
      if (resolution.status==='mapped') {
        requireValue(!member.nativeId || member.nativeId===resolution.nativeId,'IDENTITY_CONFLICT','A different native ID is already recorded; do not silently replace it');
        if (member.historyOnly) {
          member.historyOnly=false;
          member.historyBinding={...member.historyBinding,revalidatedAt:at,revalidatedParentThreadId:input.sourceThreadId,revalidation:'exact-public-parent-activity-relayed-not-authenticated'};
        }
        member.nativeId=resolution.nativeId;
        member.nativeIdentity={source:'public-subagent-activity',sourceThreadId:input.sourceThreadId,hostId:input.sourceHostId ?? null,
          activityItemIds:resolution.activityItemIds,observedAt:at,verification:'relayed-by-agent-not-server-authenticated'};
        const duplicate=b.members.find(m=>m!==member && !m.historyOnly && m.nativeId===member.nativeId);
        if(duplicate)mergeNativeMember(b,member,duplicate);
      }
    }
    member.identityResolution={...resolution,attemptedAt:at,sourceThreadId:input.sourceThreadId ?? null,
      source:'lead-relayed-public-activity',runtimeRef:member.runtimeRef};
    store.event(b,'identity_resolution',`${member.id}: ${resolution.status}`);
  });
  const member=board.members.find(m=>m.id===input.memberId);
  return {boards:store.list(),board,resolution:member.identityResolution,
    nextRead:resolution.status==='mapped'?{threadId:member.nativeId,...(input.sourceHostId?{hostId:input.sourceHostId}:{}),turnLimit:1,includeOutputs:false,maxOutputCharsPerItem:1000}:null};
}
