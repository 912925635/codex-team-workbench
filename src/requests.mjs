import { requireValue } from './validation.mjs';

// A lead needs one exact request, not the whole workbench or unrelated history.
export function getRequest(store, input) {
  const board=store.view(input.boardId);
  requireValue(!board.archivedAt,'BOARD_ARCHIVED','Restore the workbench before processing a request');
  const execution=input.kind==='execution';
  const request=((execution?board.runs:board.hostActions) ?? []).find(r=>r.id===input.requestId);
  requireValue(request,'REQUEST_NOT_FOUND','Exact pending request not found in this workbench');
  requireValue(execution?!request.originBinding:request.rootSessionId===board.rootSessionId,
    'HISTORICAL_BINDING','Do not process a historical request under another conversation binding');
  const parent=board.members.find(m=>m.id===(execution?request.parentMemberId:board.members.find(m=>m.id===request.memberId)?.parentId));
  const target=execution?null:board.members.find(m=>m.id===request.memberId && !m.historyOnly);
  if(!execution)requireValue(target?.nativeId===request.nativeId,'ACTION_TARGET_CHANGED','The requested member thread has changed');
  const task=execution?board.tasks.find(t=>t.id===request.taskId):null;
  return {board:{id:board.id,rootSessionId:board.rootSessionId,bindingGeneration:board.bindingGeneration ?? 0,revision:board.revision},
    backendSync:{directHistoryAvailable:!!store.nativeHistoryReader,automaticHistoryEnabled:!!board.nativeHistorySync?.enabled && board.nativeHistorySync.rootThreadId===board.rootSessionId,nativeJournalConfigured:!!store.nativeEventJournal},
    request, parent:parent?{id:parent.id,nativeId:parent.nativeId,runtimeRef:parent.runtimeRef ?? null}:null,
    ...(task?{task:{id:task.id,title:task.title,revision:task.revision,status:task.status,ready:task.ready}}:{}),
    ...(target?{target:{id:target.id,nativeId:target.nativeId,runtimeRef:target.runtimeRef,runtimeObservation:target.runtimeObservation ?? null,runtimeFresh:target.runtimeFresh}}:{})};
}
