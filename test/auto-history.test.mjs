import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';
import { scheduleAutoHistory, autoHistoryStatus } from '../src/auto-history.mjs';
import { recordEvent } from '../examples/native-events/probe.mjs';

const root='00000000-0000-4000-8000-000000000961',child='00000000-0000-4000-8000-000000000962';
const metadata=[{id:root},{id:child,parentThreadId:root,source:{subAgent:{thread_spawn:{parent_thread_id:root,agent_path:'/root/auto_fixture'}}}}];
const page=()=>({connected:true,threadId:child,threads:metadata,turns:[{id:'fixture-turn',status:'completed',items:[{id:'fixture-message',type:'agentMessage',text:'ASYNC_VISIBLE_RESULT'}]}],nextCursor:null,truncated:false});
async function waitFor(condition) {
  const deadline=Date.now()+2500;
  while(!condition()){if(Date.now()>deadline)throw new Error('Isolated background condition timed out');await new Promise(r=>setTimeout(r,10));}
}
function fixture(t,reader=async()=>page(),extra={}) {
  const dir=mkdtempSync(join(tmpdir(),'workbench-auto-history-')),config={sessionIds:[root],dataDirectory:join(dir,'journal')};mkdirSync(config.dataDirectory);
  const store=new Store(join(dir,'boards'),{nativeEventJournal:join(config.dataDirectory,'native-events-probe.sqlite'),nativeMetadataReader:()=>metadata,nativeHistoryAsyncReader:reader,...extra});
  t.after(()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  let b=store.create('Synthetic automatic history fixture');b=store.bind(b.id,root,b.revision);
  store.reportMember(b.id,{memberId:'child',name:'Child fixture',parentId:'lead',nativeId:child,runtimeRef:'/root/auto_fixture',status:'unknown',evidence:'Synthetic exact identity'});
  const configure=enabled=>dispatch(store,'team_set_history_sync',{boardId:b.id,expectedRevision:store.read(b.id).revision,expectedRootSessionId:root,enabled,confirmed:true});
  const member=()=>store.read(b.id).members.find(m=>m.id==='child');
  const stop=()=>store.transact(b.id,current=>{current.members.find(m=>m.id==='child').runtimeObservation={state:'idle',source:'native-command-hook',turnId:'fixture-turn',observedAt:new Date().toISOString()};});
  return{store,directory:join(dir,'boards'),config,id:b.id,configure,member,stop};
}

test('synthetic Hook journal events trigger actual filesystem watch, automatic direct read and persistence with no snapshot/lead call',async t=>{
  let calls=0;const f=fixture(t,async request=>{calls++;assert.deepEqual(request.threadIds,[child,root]);return page();});
  assert.equal(autoHistoryStatus(f.store,f.store.read(f.id)).enabled,false);
  f.configure(true);
  const event={session_id:root,agent_id:child,agent_type:'fixture',turn_id:'fixture-turn'};
  recordEvent(f.config,{...event,hook_event_name:'SubagentStart'});
  await waitFor(()=>f.member().runtimeObservation?.state==='running');assert.equal(calls,0);
  recordEvent(f.config,{...event,hook_event_name:'SubagentStop'});
  await waitFor(()=>f.member().nativeHistoryRead?.status==='succeeded');
  const records=dispatch(f.store,'team_read_records',{boardId:f.id,nodeKind:'member',nodeId:'child'});
  assert.equal(records.latestHostPage.source,'public-app-server-page');assert.equal(records.latestHostPage.turns[0].items[0].text,'ASYNC_VISIBLE_RESULT');assert.equal(calls,1);
  recordEvent(f.config,{...event,hook_event_name:'SubagentStop'});scheduleAutoHistory(f.store,f.id);await new Promise(r=>setTimeout(r,150));
  assert.equal(calls,1);assert(f.member().nativeHistoryRead.autoEventKey);
});

test('automatic history is opt-in with exact root confirmation and never collects a running-only node',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return page();});
  f.stop();scheduleAutoHistory(f.store,f.id);await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);
  const args={boardId:f.id,expectedRevision:f.store.read(f.id).revision,expectedRootSessionId:root,enabled:true,confirmed:false};
  assert.throws(()=>dispatch(f.store,'team_set_history_sync',args),{code:'CONFIRMATION_REQUIRED'});
  assert.throws(()=>dispatch(f.store,'team_set_history_sync',{...args,confirmed:true,enabled:'true'}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>dispatch(f.store,'team_set_history_sync',{...args,confirmed:true,expectedRootSessionId:child}),{code:'THREAD_BINDING_REQUIRED'});
  f.store.transact(f.id,b=>{b.members.find(m=>m.id==='child').runtimeObservation.state='running';});
  f.configure(true);await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);
});

test('disabling while a read is in flight prevents the late page from being saved',async t=>{
  let release,started=false;const f=fixture(t,()=>{started=true;return new Promise(r=>{release=r;});});
  f.stop();f.configure(true);await waitFor(()=>started);
  f.configure(false);release(page());await waitFor(()=>!f.store.autoHistory.running);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,0);assert.equal(f.member().nativeHistoryRead,undefined);
  assert.equal(autoHistoryStatus(f.store,f.store.read(f.id)).enabled,false);
});

test('a changed root cannot reuse automatic consent or save an old pending page',async t=>{
  let release,started=false;const f=fixture(t,()=>{started=true;return new Promise(r=>{release=r;});});
  f.stop();f.configure(true);await waitFor(()=>started);
  const b=f.store.read(f.id);f.store.bind(f.id,child,b.revision,{previousSessionId:root,confirmRebind:true,evidence:'Synthetic explicit binding change'});
  release(page());await waitFor(()=>!f.store.autoHistory.running);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,0);
  assert.equal(autoHistoryStatus(f.store,f.store.read(f.id)).enabled,false);
});

test('background failures preserve records, have bounded retries, and stop after three attempts for the same event',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;throw new Error('PUBLIC_READER_FAILURE_FIXTURE');},{autoHistoryRetryMs:10});
  f.stop();f.configure(true);await waitFor(()=>calls===3 && !f.store.autoHistory.running);
  assert.equal(f.member().nativeHistoryRead.status,'failed');assert(f.member().nativeHistoryRead.reason.includes('PUBLIC_READER_FAILURE_FIXTURE'));
  scheduleAutoHistory(f.store,f.id);await new Promise(r=>setTimeout(r,30));assert.equal(calls,3);
});

test('a stop that precedes public history persistence retries without saving an unrelated or empty turn',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return calls===1?{...page(),turns:[]}:page();},{autoHistoryRetryMs:10});
  f.stop();f.configure(true);await waitFor(()=>f.member().nativeHistoryRead?.autoEventKey && !f.store.autoHistory.running);
  assert.equal(calls,2);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM work_records').get().n,1);
});

test('persisted event keys prevent automatic rereading after a new MCP Store connection',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return page();});f.stop();f.configure(true);
  await waitFor(()=>f.member().nativeHistoryRead?.autoEventKey && !f.store.autoHistory.running);assert.equal(calls,1);
  const reopened=new Store(f.directory,{nativeEventJournal:f.store.nativeEventJournal,nativeHistoryAsyncReader:async()=>{calls++;return page();}});
  try{await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);assert.equal(reopened.read(f.id).members.find(m=>m.id==='child').nativeHistoryRead.status,'succeeded');}
  finally{reopened.close();}
});

test('two independent SQLite/Store connections share a job lease and perform only one background history read',async t=>{
  let calls=0,release;const reader=()=>{calls++;return new Promise(r=>{release=r;});};
  const f=fixture(t,reader);f.stop();dispatch(f.store,'team_snapshot',{boardId:f.id});
  const second=new Store(f.directory,{nativeEventJournal:f.store.nativeEventJournal,nativeMetadataReader:()=>metadata,nativeHistoryAsyncReader:reader});
  try {
    f.configure(true);dispatch(second,'team_snapshot',{boardId:f.id});
    await waitFor(()=>calls===1);await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
    release(page());await waitFor(()=>f.member().nativeHistoryRead?.autoEventKey && !f.store.autoHistory.running);
    scheduleAutoHistory(second,f.id);await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
    const claim=f.store.db.prepare('SELECT state,attempts FROM native_history_claims').get();assert.equal(claim.state,'done');assert.equal(claim.attempts,1);
  }finally{second.close();}
});

test('metadata-only Hook Store does not start a watcher/history job even when the board has enabled it',async t=>{
  const f=fixture(t);f.configure(true);let calls=0;
  const hookStore=new Store(f.directory,{autoHistory:false,nativeEventJournal:f.store.nativeEventJournal,nativeHistoryAsyncReader:async()=>{calls++;return page();}});
  try{assert.equal(hookStore.autoHistory,undefined);assert.equal(autoHistoryStatus(hookStore,hookStore.read(f.id)).available,false);scheduleAutoHistory(hookStore,f.id);await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);}
  finally{hookStore.close();}
});
