import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';

const root='00000000-0000-4000-8000-000000000971',child='00000000-0000-4000-8000-000000000972';
function fixture(t,available=true){
  const dir=mkdtempSync(join(tmpdir(),'workbench-initialization-'));
  const store=new Store(dir,{nativeEventJournal:join(dir,'native-events-probe.sqlite'),nativeMetadataReader:()=>[],
    nativeHistoryAsyncReader:async()=>{throw new Error('No history read without a real stop event');},
    nativeReaderStatus:()=>({available,code:available?'PUBLIC_READER_PROVIDED':'PUBLIC_SOCKET_MISSING',message:'Synthetic initialization fixture'})});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;
}
const lead=(id=root)=>({memberId:'lead',name:'Originating lead',status:'unknown',nativeId:id,nativeIdSource:'host-env',evidence:'Synthetic exact main identity'});

test('create with an exact root and explicit sync consent returns a bound enabled workbench',t=>{
  const s=fixture(t),r=dispatch(s,'team_create_board',{title:'Synthetic initialized board',sessionId:root,automaticHistory:true,confirmed:true});
  assert.equal(r.board.rootSessionId,root);assert.equal(r.board.members[0].nativeId,root);
  assert.equal(r.board.nativeHistorySync.enabled,true);assert.equal(r.nativeAutoHistory.enabled,true);
  assert.equal(r.board.syncInitialization.requested,false);
});
test('pending consent completes automatically when the real lead identity is reported',t=>{
  const s=fixture(t),b=dispatch(s,'team_create_board',{title:'Synthetic pending board',automaticHistory:true,confirmed:true}).board;
  assert.equal(b.rootSessionId,null);assert.equal(b.syncInitialization.state,'waiting-for-identity');
  const r=dispatch(s,'team_report_member',{boardId:b.id,...lead()});
  assert.equal(r.board.rootSessionId,root);assert.equal(r.nativeAutoHistory.enabled,true);
  dispatch(s,'team_set_history_sync',{boardId:b.id,expectedRevision:r.board.revision,expectedRootSessionId:root,enabled:false,confirmed:true});
  const again=dispatch(s,'team_report_member',{boardId:b.id,...lead()});
  assert.equal(again.board.nativeHistorySync.enabled,false);
});
test('a sourced lead identity fixes association without silently opting into content sync',t=>{
  const s=fixture(t),b=s.create('Synthetic manual board');
  const r=dispatch(s,'team_report_member',{boardId:b.id,...lead()});
  assert.equal(r.board.rootSessionId,root);assert.equal(r.nativeAutoHistory.enabled,false);
});
test('child reports and unsourced lead identities never establish a board root',t=>{
  const s=fixture(t),b=s.create('Synthetic identity boundary');
  s.reportMember(b.id,{...lead(child),memberId:'child'});assert.equal(s.read(b.id).rootSessionId,null);
  const input=lead();delete input.nativeIdSource;s.reportMember(b.id,input);assert.equal(s.read(b.id).rootSessionId,null);
});
test('initialization consent and UUID validation fail before creating any board',t=>{
  const s=fixture(t);
  assert.throws(()=>dispatch(s,'team_create_board',{title:'No consent',sessionId:root,automaticHistory:true}),{code:'CONFIRMATION_REQUIRED'});
  assert.throws(()=>dispatch(s,'team_create_board',{title:'Anonymous is not native',sessionId:'anonymous-session'}),{code:'INVALID_THREAD_ID'});
  assert.equal(s.list().length,0);
});
test('pending unbound initialization can be cancelled and is not revived by a later lead report',t=>{
  const s=fixture(t),b=s.create('Synthetic cancelled setup',{automaticHistory:true,confirmed:true});
  dispatch(s,'team_set_history_sync',{boardId:b.id,expectedRevision:b.revision,expectedRootSessionId:'',enabled:false,confirmed:true});
  const r=dispatch(s,'team_report_member',{boardId:b.id,...lead()});
  assert.equal(r.board.rootSessionId,root);assert.equal(r.nativeAutoHistory.enabled,false);assert.equal(r.board.syncInitialization.requested,false);
});
test('one initialization call can bind an existing board and enable sync; existing roots cannot be replaced',t=>{
  const s=fixture(t),b=s.create('Synthetic existing board');
  assert.throws(()=>dispatch(s,'team_bind_session',{boardId:b.id,sessionId:root,expectedRevision:b.revision,automaticHistory:true}),{code:'CONFIRMATION_REQUIRED'});
  const r=dispatch(s,'team_bind_session',{boardId:b.id,sessionId:root,expectedRevision:b.revision,automaticHistory:true,confirmed:true});
  assert.equal(r.board.nativeHistorySync.rootThreadId,root);
  assert.throws(()=>dispatch(s,'team_report_member',{boardId:b.id,...lead(child)}),{code:'IDENTITY_CONFLICT'});
  assert.equal(s.read(b.id).rootSessionId,root);
});
test('unavailable readers retain the pending choice without claiming synchronization is enabled',t=>{
  const s=fixture(t,false),r=dispatch(s,'team_create_board',{title:'Synthetic unavailable reader',sessionId:root,automaticHistory:true,confirmed:true});
  assert.equal(r.board.rootSessionId,root);assert.equal(r.board.syncInitialization.requested,true);
  assert.equal(r.nativeAutoHistory.enabled,false);assert.equal(r.nativeAutoHistory.available,false);
});
test('a pending board completes on a later normal snapshot when its reader becomes available',t=>{
  const s=fixture(t,false),b=s.create('Synthetic recovered initialization',{sessionId:root,automaticHistory:true,confirmed:true});
  s.nativeReaderStatus=()=>({available:true,code:'PUBLIC_READER_PROVIDED',message:'Synthetic restored endpoint'});
  const r=dispatch(s,'team_snapshot',{boardId:b.id});
  assert.equal(r.nativeAutoHistory.enabled,true);assert.equal(r.board.syncInitialization.requested,false);
});
test('a root change cannot transfer pending automatic-sync consent to the new origin',t=>{
  const s=fixture(t,false),b=s.create('Synthetic scoped initialization',{sessionId:root,automaticHistory:true,confirmed:true});
  s.bind(b.id,child,b.revision,{previousSessionId:root,confirmRebind:true,evidence:'Synthetic explicit root correction'});
  s.nativeReaderStatus=()=>({available:true,code:'PUBLIC_READER_PROVIDED',message:'Synthetic restored endpoint'});
  const r=dispatch(s,'team_snapshot',{boardId:b.id});
  assert.equal(r.board.rootSessionId,child);assert.equal(r.nativeAutoHistory.enabled,false);assert.equal(r.board.syncInitialization.requested,false);
});
