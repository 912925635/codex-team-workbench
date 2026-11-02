import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,sep,join } from 'node:path';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';
const parentId='00000000-0000-4000-8000-000000000011',childId='00000000-0000-4000-8000-000000000012';
function fixture(t,{bindParent=true,path='/root/fixture_child'}={}) {
  const dir=mkdtempSync(join(tmpdir(),'workbench-identity-fixture-')),store=new Store(dir);
  t.after(()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  const board=store.create('Synthetic identity sync fixture');
  const call=(name,args={})=>dispatch(store,name,{boardId:board.id,...args});
  if(bindParent)call('team_report_member',{memberId:'lead',name:'Fixture lead',status:'unknown',nativeId:parentId,hostId:'fixture-host',evidence:'Explicit synthetic parent context'});
  call('team_report_member',{memberId:'child',name:'Fixture child',status:'completed',parentId:'lead',runtimeRef:path});
  const activity=(id='call-1',uuid=childId,agentPath=path)=>({id,type:'subAgentActivity',agentPath,agentThreadId:uuid,kind:'started'});
  const bind=extra=>call('team_bind_agent_activity',{memberId:'child',expectedRuntimeRef:path,sourceThreadId:parentId,sourceHostId:'fixture-host',activities:[activity()],...extra});
  return {store,board,call,bind,activity,path};
}
test('normal unbound child has a resolve plan; unique exact public activity binds and returns its own nextRead',t=>{
  const f=fixture(t);
  assert.equal(f.call('team_read_records',{nodeKind:'member',nodeId:'child'}).historySync.mode,'resolve-and-read');
  const result=f.bind({activities:[f.activity(),{...f.activity('done'),kind:'completed'}]});
  assert.equal(result.resolution.status,'mapped');assert.equal(result.nextRead.threadId,childId);
  assert.equal(result.nextRead.hostId,'fixture-host');
  const node=result.board.members.find(m=>m.id==='child');
  assert.equal(node.nativeId,childId);assert.equal(node.parentId,'lead');assert.equal(node.runtimeRef,f.path);
  assert.equal(node.nativeIdentity.sourceThreadId,parentId);
  assert.equal(f.call('team_read_records',{nodeKind:'member',nodeId:'child'}).historySync.mode,'read');
});
test('missing actual parent identity records a visible blocker and never falls back to another thread',t=>{
  const f=fixture(t,{bindParent:false});const result=f.bind();
  assert.equal(result.resolution.code,'PARENT_ID_REQUIRED');assert.equal(result.nextRead,null);
  assert.equal(result.board.members.find(m=>m.id==='child').nativeId,null);
});
test('another parent source is rejected without changing the child binding',t=>{
  const f=fixture(t);const before=f.store.read(f.board.id);
  assert.throws(()=>f.bind({sourceThreadId:'00000000-0000-4000-8000-000000000099'}),{code:'SOURCE_THREAD_MISMATCH'});
  assert.throws(()=>f.call('team_report_member',{memberId:'lead',name:'Wrong fixture origin',status:'unknown',nativeId:'00000000-0000-4000-8000-000000000099',evidence:'Another task cannot silently become this parent'}),{code:'IDENTITY_CONFLICT'});
  assert.deepEqual(f.store.read(f.board.id),before);
});
test('development child activity cannot replace workbench_smoke; zero activity is a visible terminal read result',t=>{
  const f=fixture(t,{path:'/root/workbench_smoke'});
  let result=f.bind({activities:[f.activity('dev',childId,'/root/native_execution_test')]});
  assert.equal(result.resolution.code,'ACTIVITY_NOT_FOUND');assert.equal(result.nextRead,null);
  assert.equal(result.board.members.find(m=>m.id==='child').nativeId,null);
  result=f.bind({activities:[]});assert.equal(result.resolution.status,'not_found');
});
test('multiple UUIDs require a previously recorded spawn call, not a caller guess',t=>{
  const f=fixture(t),other='00000000-0000-4000-8000-000000000013';
  const activities=[f.activity('call-1'),f.activity('call-2',other)];
  assert.equal(f.bind({activities}).resolution.status,'ambiguous');
  assert.throws(()=>f.bind({activities,spawnCallId:'call-2'}),{code:'SPAWN_CALL_MISMATCH'});
  f.call('team_report_member',{memberId:'child',name:'Fixture child',status:'completed',spawnCallId:'call-2',evidence:'Actual synthetic spawn receipt recorded before resolution'});
  assert.equal(f.bind({activities}).nextRead.threadId,other);
});
test('tool/history unavailability is recorded once as state, without inventing or clearing an identity',t=>{
  const f=fixture(t);f.bind();const result=f.bind({unavailableReason:'Public host tool unavailable in this fixture'});
  assert.equal(result.resolution.status,'blocked');assert.equal(result.nextRead,null);
  assert.equal(result.board.members.find(m=>m.id==='child').nativeId,childId);
});
test('a different UUID cannot silently overwrite an existing resolved child',t=>{
  const f=fixture(t);f.bind();const before=f.store.read(f.board.id);
  assert.throws(()=>f.bind({activities:[f.activity('new','00000000-0000-4000-8000-000000000014')]}),{code:'IDENTITY_CONFLICT'});
  assert.deepEqual(f.store.read(f.board.id),before);
});


test('a historical short-parent record is revalidated only by exact activity from the verified current parent', t=>{
  const f=fixture(t),before=f.store.read(f.board.id);
  f.store.transact(f.board.id,b=>{const m=b.members.find(m=>m.id==='child');m.historyOnly=true;m.historyBinding={sessionId:'00000000',parentThreadId:'00000000',generation:0};});
  assert.equal(f.call('team_read_records',{nodeKind:'member',nodeId:'child'}).historySync.historicalRevalidation,true);
  const absent=f.bind({activities:[]});assert.equal(absent.resolution.status,'not_found');assert.equal(absent.board.members.find(m=>m.id==='child').historyOnly,true);
  assert.throws(()=>f.bind({sourceThreadId:'00000000-0000-4000-8000-000000009004'}),{code:'SOURCE_THREAD_MISMATCH'});
  const result=f.bind();const child=result.board.members.find(m=>m.id==='child');
  assert.equal(child.nativeId,childId);assert.equal(child.historyOnly,false);assert.equal(child.historyBinding.parentThreadId,'00000000');assert.equal(child.historyBinding.revalidatedParentThreadId,parentId);
});


test('actual native observations require exact path, monotonic time and freshness, with terminal states stopping running',t=>{
  const f=fixture(t),now=new Date(),observe=extra=>f.call('team_observe_runtime',{memberId:'child',runtimeRef:f.path,sourceThreadId:parentId,expectedRevision:f.store.read(f.board.id).revision,state:'running',source:'collaboration.list_agents',resumeAvailable:true,observedAt:now.toISOString(),evidence:'Synthetic actual host observation',...extra});
  assert.throws(()=>observe({runtimeRef:'/root/other'}),{code:'RUNTIME_MISMATCH'});
  assert.throws(()=>observe({sourceThreadId:'00000000-0000-4000-8000-000000009004'}),{code:'SOURCE_THREAD_MISMATCH'});
  assert.throws(()=>observe({state:'unknown',resumeAvailable:true}),{code:'INVALID_ARGUMENT'});
  let b=observe({}).board;assert.equal(b.members.find(m=>m.id==='child').runtimeFresh,true);
  assert.throws(()=>observe({observedAt:new Date(now.getTime()-1000).toISOString()}),{code:'STALE_OBSERVATION'});
  b=observe({state:'completed',observedAt:new Date(now.getTime()+1).toISOString()}).board;assert.equal(b.members.find(m=>m.id==='child').runtimeObservation.state,'completed');
  f.store.transact(f.board.id,board=>{board.members.find(m=>m.id==='child').runtimeObservation.observedAt=new Date(Date.now()-121000).toISOString();});
  assert.equal(f.store.view(f.board.id).members.find(m=>m.id==='child').runtimeFresh,false);
});


test('exact public UUID binding consolidates auto-discovered and execution members without losing records',t=>{
 const f=fixture(t),duplicate='native:'+childId;
 f.store.transact(f.board.id,b=>b.members.push({id:duplicate,name:'Observed native',role:'member',source:'hook',status:'start_observed',parentId:'lead',relation:'session_association',nativeId:childId,runtimeRef:f.path,observedAt:new Date().toISOString(),runtimeObservation:{state:'running',source:'native-command-hook',observedAt:new Date().toISOString()}}));
 f.call('team_append_record',{nodeKind:'member',nodeId:duplicate,recordId:'before-merge',role:'note',text:'IMMUTABLE_FIXTURE_RECORD',evidence:'Fixture'});
 f.call('team_create_task',{title:'Fixture owner preservation'});f.call('team_update_task',{taskId:'task-1',expectedRevision:1,actorId:duplicate,action:'claim'});
 const before=f.store.db.prepare('SELECT payload,digest FROM work_records').get();
 const result=f.bind({});assert.equal(result.board.members.filter(m=>m.nativeId===childId).length,1);assert.equal(result.board.memberAliases[duplicate],'child');assert.equal(result.board.tasks[0].ownerId,'child');
 assert.equal(result.board.members.find(m=>m.id==='child').runtimeObservation.source,'native-command-hook');
 assert.deepEqual(f.store.db.prepare('SELECT payload,digest FROM work_records').get(),before);
 const page=f.call('team_read_records',{nodeKind:'member',nodeId:duplicate});assert.equal(page.node.id,'child');assert.equal(page.records[0].text,'IMMUTABLE_FIXTURE_RECORD');
 assert.throws(()=>f.call('team_report_member',{memberId:duplicate,name:'Duplicate',status:'unknown'}),{code:'MEMBER_MERGED'});
});
