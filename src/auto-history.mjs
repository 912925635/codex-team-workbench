import { watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireValue } from './validation.mjs';
import { isThreadId } from './history-sync.mjs';
import { syncNativeEvents } from './native-events.mjs';
import { syncNativeTopology } from './native-topology.mjs';
import { prepareNativeHistoryRead, syncNativeHistory } from './native-history.mjs';

const enabled=b=>!b.archivedAt && b.nativeHistorySync?.enabled && b.nativeHistorySync.rootThreadId===b.rootSessionId;
const eventKey=(b,m)=>JSON.stringify([b.bindingGeneration??0,b.rootSessionId,m.nativeId,m.parentId,m.nativeTopology?.parentThreadId,m.runtimeObservation?.turnId,m.runtimeObservation?.observedAt]);
const stopped=m=>!m.historyOnly && m.id!=='lead' && isThreadId(m.nativeId) && m.runtimeObservation?.source==='native-command-hook' && m.runtimeObservation.state==='idle';
function runtime(store) {
  return store.autoHistory ??= {owner:randomUUID(),queue:[],attempts:new Map(),running:null,watcher:null,watchState:'not-started',retryTimers:new Set(),closed:false};
}
export function autoHistoryStatus(store,board) {
  const r=runtime(store);
  return {available:store.autoHistoryEnabled!==false && !!store.nativeHistoryAsyncReader && !!store.nativeEventJournal,enabled:!!board && !!enabled(board),
    state:r.watchState,pending:r.queue.length+(r.running?1:0)};
}
export function configureAutoHistory(store,input) {
  requireValue(input.confirmed===true,'CONFIRMATION_REQUIRED','Confirm this workbench scoped visible-text collection before changing automatic sync');
  if(input.enabled)requireValue(store.nativeHistoryAsyncReader && store.nativeEventJournal,'PUBLIC_HISTORY_UNAVAILABLE','Automatic history needs an existing Hook journal and supported direct public reader');
  const board=store.transact(input.boardId,b=>{
    requireValue(!b.archivedAt && b.revision===input.expectedRevision,'STALE_REVISION','Refresh the current active board before changing automatic sync');
    requireValue(isThreadId(b.rootSessionId) && b.rootSessionId===input.expectedRootSessionId,'THREAD_BINDING_REQUIRED','Confirm this exact bound root UUID');
    b.nativeHistorySync={enabled:input.enabled,rootThreadId:b.rootSessionId,generation:(b.nativeHistorySync?.generation??0)+1,
      updatedAt:new Date().toISOString(),coverage:'one-latest-turn-visible-text-on-native-stop'};
    if(input.enabled)store.db.prepare("DELETE FROM native_history_claims WHERE board_id=? AND state='pending'").run(b.id);
    store.event(b,'automatic_history_setting',input.enabled?'Enabled for the exact current board root':'Disabled; saved history retained');
  });
  const r=runtime(store);
  for(const key of r.attempts.keys())if(key.startsWith(`${board.id}:`))r.attempts.delete(key);
  if(r.running?.boardId===board.id)r.running.abort.abort();
  ensureAutoHistoryWatch(store);scheduleAutoHistory(store,board.id);
  return {boards:store.list(),archivedBoards:store.list({includeArchived:true}).filter(b=>b.archivedAt),board:store.view(board),nativeAutoHistory:autoHistoryStatus(store,board)};
}

// Watch only the configured plugin-owned metadata journal, never host sessions.
// Existing snapshot reads remain a recovery path if an OS file event is missed.
export function ensureAutoHistoryWatch(store) {
  const r=runtime(store);
  if(r.closed || store.autoHistoryEnabled===false || !store.nativeEventJournal || !store.nativeHistoryAsyncReader)return;
  const active=store.list().map(b=>store.read(b.id)).filter(enabled);
  if(!active.length){r.watcher?.close();r.watcher=null;r.watchState='disabled';return;}
  if(r.watcher)return;
  const name=basename(store.nativeEventJournal);
  try {
    r.watcher=watch(dirname(store.nativeEventJournal),(_event,file)=>{
      if(file && ![name,`${name}-wal`].includes(String(file)))return;
      clearTimeout(r.debounce);
      r.debounce=setTimeout(()=>{
        if(r.closed)return;
        for(const item of store.list()) {
          if(!enabled(store.read(item.id)))continue;
          try{syncNativeEvents(store,item.id);syncNativeTopology(store,item.id);scheduleAutoHistory(store,item.id);}catch{r.watchState='journal-refresh-failed';}
        }
      },100);r.debounce.unref();
    });
    r.watcher.on('error',()=>{r.watcher?.close();r.watcher=null;r.watchState='watch-unavailable-use-snapshot';});
    r.watcher.unref();r.watchState='watching-plugin-journal';
    for(const b of active)scheduleAutoHistory(store,b.id);
  }catch{r.watchState='watch-unavailable-use-snapshot';}
}

export function scheduleAutoHistory(store,boardId) {
  const r=runtime(store);
  if(r.closed || store.autoHistoryEnabled===false || !store.nativeHistoryAsyncReader)return;
  const b=store.read(boardId);if(!enabled(b))return;
  for(const m of b.members.filter(stopped)) {
    const key=eventKey(b,m),id=`${b.id}:${m.id}:${key}`,attempt=r.attempts.get(id);
    if(m.nativeHistoryRead?.autoEventKey===key || r.running?.id===id || r.queue.some(j=>j.id===id)
      || attempt?.count>=3 || attempt?.nextAt>Date.now())continue;
    for(const previous of r.attempts.keys())if(previous.startsWith(`${b.id}:${m.id}:`) && previous!==id)r.attempts.delete(previous);
    r.queue.push({id,key,boardId:b.id,memberId:m.id,nativeId:m.nativeId,settingGeneration:b.nativeHistorySync.generation});
  }
  if(!r.running && r.queue.length)kick(store);
}
const kick=store=>queueMicrotask(()=>{drain(store).catch(()=>{runtime(store).watchState='history-job-failed';});});
async function drain(store) {
  const r=runtime(store);if(r.running || r.closed)return;
  const job=r.queue.shift();if(!job)return;
  const abort=new AbortController();r.running={...job,abort};
  let claimed=null;
  const input={boardId:job.boardId,memberId:job.memberId,expectedNativeId:job.nativeId};
  const matches=b=>{
    const m=b.members.find(m=>m.id===job.memberId);
    return enabled(b) && b.nativeHistorySync.generation===job.settingGeneration && m && stopped(m) && eventKey(b,m)===job.key;
  };
  const current=()=>!r.closed && matches(store.read(job.boardId));
  const ownsClaim=()=>store.db.prepare("SELECT 1 FROM native_history_claims WHERE job_id=? AND owner=? AND state='working' AND lease_until>?").get(job.id,r.owner,Date.now());
  try {
    if(!current())return;
    const now=Date.now();
    claimed=store.db.prepare("INSERT INTO native_history_claims(job_id,board_id,owner,lease_until,attempts,state) VALUES(?,?,?,?,1,'working') ON CONFLICT(job_id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,attempts=native_history_claims.attempts+1,state='working' WHERE native_history_claims.state<>'done' AND native_history_claims.lease_until<=? AND native_history_claims.attempts<3 RETURNING attempts").get(job.id,job.boardId,r.owner,now+30000,now);
    if(!claimed){const other=store.db.prepare('SELECT attempts,lease_until,state FROM native_history_claims WHERE job_id=?').get(job.id);r.attempts.set(job.id,{count:other?.state==='done'?3:other?.attempts??0,nextAt:Math.min(other?.lease_until??now+1000,now+1000)});return;}
    const prepared=prepareNativeHistoryRead(store,input);
    const page=await store.nativeHistoryAsyncReader(prepared.request,{signal:abort.signal});
    if(!current() || abort.signal.aborted || !ownsClaim())return;
    const observed=prepared.original.members.find(m=>m.id===job.memberId).runtimeObservation;
    if(!page.turns?.length || (observed.turnId && !page.turns.some(t=>t.id===observed.turnId)) || page.turns.some(t=>t.status==='inProgress')) {
      const error=new Error('The observed stopped turn is not yet available as a completed public history page');error.code='HISTORY_PAGE_NOT_READY';throw error;
    }
    syncNativeHistory(store,input,{...prepared,page,guard:b=>matches(b) && ownsClaim()});
    store.transact(job.boardId,b=>{
      if(!matches(b) || !ownsClaim())return false;
      b.members.find(m=>m.id===job.memberId).nativeHistoryRead.autoEventKey=job.key;
      store.db.prepare("UPDATE native_history_claims SET state='done',lease_until=0 WHERE job_id=? AND owner=?").run(job.id,r.owner);
    });
    r.attempts.delete(job.id);
  }catch(error) {
    if(!r.closed && !abort.signal.aborted && current() && claimed && ownsClaim()) {
      const count=claimed.attempts,delay=store.autoHistoryRetryMs??(error.code==='HISTORY_PAGE_NOT_READY'?count*1000:30000);
      r.attempts.set(job.id,{count,nextAt:Date.now()+delay});
      store.db.prepare("UPDATE native_history_claims SET state='pending',lease_until=? WHERE job_id=? AND owner=?").run(Date.now()+delay,job.id,r.owner);
      store.transact(job.boardId,b=>{
        const m=b.members.find(m=>m.id===job.memberId);
        m.nativeHistoryRead={...m.nativeHistoryRead,status:'failed',attemptedAt:new Date().toISOString(),reason:String(error.message).slice(0,1000)};
      });
      if(count<3){const timer=setTimeout(()=>{r.retryTimers.delete(timer);if(!r.closed)scheduleAutoHistory(store,job.boardId);},delay);r.retryTimers.add(timer);timer.unref();}
    }
  }finally{
    try{if(!r.closed && claimed)store.db.prepare("UPDATE native_history_claims SET state='pending',lease_until=0 WHERE job_id=? AND owner=? AND state='working'").run(job.id,r.owner);}
    finally{r.running=null;if(!r.closed && r.queue.length)kick(store);}
  }
}
export function stopAutoHistory(store) {
  const r=store.autoHistory;if(!r)return;
  r.closed=true;r.watcher?.close();clearTimeout(r.debounce);
  for(const timer of r.retryTimers)clearTimeout(timer);r.retryTimers.clear();
  r.running?.abort.abort();r.queue.length=0;
  store.db.prepare("UPDATE native_history_claims SET state='pending',lease_until=0 WHERE owner=? AND state='working'").run(r.owner);
}
