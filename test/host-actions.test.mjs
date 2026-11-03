import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';import {join} from 'node:path';import{tmpdir}from'node:os';
import {Store}from'../src/store.mjs';import{dispatch}from'../src/tools.mjs';
import {syncNativeTopology} from '../src/native-topology.mjs';
const root='00000000-0000-4000-8000-000000000401',child='00000000-0000-4000-8000-000000000402';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'workbench-action-'));const s=new Store(dir);t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});let b=s.create('Fixture');s.bind(b.id,root,b.revision);s.reportMember(b.id,{memberId:'a',name:'a',nativeId:child,evidence:'Fixture',status:'unknown'});return{s,id:b.id};}

test('direct link acknowledgment is accepted, never visual success, and requires the exact recorded target',t=>{
 const{s,id}=fixture(t);
 assert.throws(()=>dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate',expectedNativeId:root}),{code:'ACTION_TARGET_CHANGED'});
 assert.equal(s.read(id).hostActions,undefined);
 const a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate',expectedNativeId:child}).action;
 const args={boardId:id,actionId:a.id,expectedRevision:a.revision,nativeId:child,source:'ui/open-link',confirmed:true,result:'Fixture actual host link acknowledgment'};
 assert.throws(()=>dispatch(s,'team_record_host_action',{...args,status:'succeeded'}),{code:'HOST_CONFIRMATION_REQUIRED'});
 assert.throws(()=>dispatch(s,'team_record_host_action',{...args,status:'accepted',confirmed:false}),{code:'HOST_LINK_CONFIRMATION_REQUIRED'});
 const receipt=dispatch(s,'team_record_host_action',{...args,status:'accepted'}).action;
 assert.equal(receipt.status,'accepted');assert.equal(receipt.verification,'host-link-request-acknowledged-target-view-unverified');
 assert(dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate',expectedNativeId:child}).action.id!==a.id);
});

test('panel cancellation has its own source and does not pretend to send a chat message or stop the worker',t=>{
 const{s,id}=fixture(t),a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action;
 const args={boardId:id,actionId:a.id,expectedRevision:1,nativeId:child,status:'cancelled',source:'panel-user-confirmation',result:'Synthetic user closed only workbench wait'};
 assert.throws(()=>dispatch(s,'team_record_host_action',args),{code:'CONFIRMATION_REQUIRED'});
 const result=dispatch(s,'team_record_host_action',{...args,confirmed:true}).action;
 assert.equal(result.status,'cancelled');assert.equal(result.source,'panel-user-confirmation');assert.equal(result.verification,'panel-user-confirmed-wait-cancelled');
});
test('message delivery cannot succeed navigation; positive host acknowledgment is recorded once',t=>{
 const{s,id}=fixture(t),a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action;
 assert.throws(()=>dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}),{code:'ACTION_PENDING'});
 const input={boardId:id,actionId:a.id,expectedRevision:1,nativeId:child,status:'succeeded',confirmed:true,result:'Fixture receipt',source:'ui/message'};
 assert.throws(()=>dispatch(s,'team_record_host_action',input),{code:'HOST_CONFIRMATION_REQUIRED'});
 const done=dispatch(s,'team_record_host_action',{...input,source:'codex-app-tools.navigate_to_codex_page'});assert.equal(done.action.status,'succeeded');
 assert.throws(()=>dispatch(s,'team_record_host_action',{...input,expectedRevision:2}),{code:'ACTION_TERMINAL'});
});
test('unverified continuation and changed target reject without executing a substitute',t=>{
 const{s,id}=fixture(t);assert.throws(()=>dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'resume',instructions:'Fixture'}),{code:'RESUME_NOT_VERIFIED'});
 const a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action;
 assert.throws(()=>dispatch(s,'team_record_host_action',{boardId:id,actionId:a.id,expectedRevision:1,nativeId:root,status:'failed',source:'ui/message',result:'Fixture mismatch'}),{code:'ACTION_TARGET_CHANGED'});
});
test('failed host request is visible and a new explicit request may retry',t=>{
 const{s,id}=fixture(t),a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action;
 dispatch(s,'team_record_host_action',{boardId:id,actionId:a.id,expectedRevision:1,nativeId:child,status:'failed',source:'codex-app-tools.navigate_to_codex_page',result:'Fixture host route unavailable'});
 const page=dispatch(s,'team_read_records',{boardId:id,nodeKind:'member',nodeId:'a'});assert.equal(page.hostActions[0].status,'failed');
 assert(dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action.id!==a.id);
});


test('continuation requires a fresh actual observation from the current exact parent',t=>{
 const{s,id}=fixture(t);s.reportMember(id,{memberId:'a',name:'a',nativeId:child,runtimeRef:'/root/a',evidence:'Fixture',status:'idle'});
 s.observeRuntime(id,{memberId:'a',expectedRevision:s.read(id).revision,runtimeRef:'/root/a',sourceThreadId:root,state:'completed',resumeAvailable:true,observedAt:new Date().toISOString(),source:'collaboration.list_agents',evidence:'Fixture actual observation'});
 const request=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'resume',instructions:'Resume the same fixture'}).action;
 assert.equal(request.nativeId,child);assert.equal(request.parentThreadId,root);assert.equal(request.runtimeRef,'/root/a');
 const result=dispatch(s,'team_record_host_action',{boardId:id,actionId:request.id,expectedRevision:1,nativeId:child,status:'succeeded',source:'collaboration.followup_task',confirmed:true,result:'Fixture native receipt'});
 assert.equal(result.action.status,'succeeded');
 s.reportMember(id,{memberId:'other',name:'other',nativeId:'00000000-0000-4000-8000-000000000403',status:'unknown',evidence:'Fixture parent'});
 s.reportMember(id,{memberId:'a',name:'a',status:'idle',parentId:'other'});
 assert.throws(()=>dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'resume',instructions:'Fixture'}),{code:'RESUME_NOT_VERIFIED'});
});


test('user can close a stuck wait without reporting native success or cancelling an agent',t=>{
 const{s,id}=fixture(t),a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action;
 const args={boardId:id,actionId:a.id,expectedRevision:1,nativeId:child,status:'cancelled',source:'ui/message',result:'Fixture closes only UI wait'};
 assert.throws(()=>dispatch(s,'team_record_host_action',args),{code:'CONFIRMATION_REQUIRED'});
 const result=dispatch(s,'team_record_host_action',{...args,confirmed:true});assert.equal(result.action.status,'cancelled');
 assert.equal(result.board.members[1].status,'unknown');assert.equal(result.board.tasks.length,0);
 assert(dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate'}).action.id!==a.id);
});

test('verified native topology allows a check-and-resume request but never unverified success',t=>{
 const{s,id}=fixture(t);
 s.nativeMetadataReader=()=>[{id:child,parentThreadId:root,source:{subAgent:{thread_spawn:{parent_thread_id:root,agent_path:'/root/a'}}}}];
 syncNativeTopology(s,id);
 const a=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'resume',instructions:'Continue only this actual agent'}).action;
 assert.equal(a.requiresCapabilityCheck,true);assert.equal(a.runtimeRef,'/root/a');assert.equal(a.parentThreadId,root);
 const input={boardId:id,actionId:a.id,expectedRevision:1,nativeId:child,status:'succeeded',source:'collaboration.followup_task',confirmed:true,result:'Fixture host receipt'};
 assert.throws(()=>dispatch(s,'team_record_host_action',input),{code:'RESUME_NOT_VERIFIED'});
 assert.equal(s.read(id).hostActions[0].status,'requested');
 s.observeRuntime(id,{memberId:'a',expectedRevision:s.read(id).revision,runtimeRef:'/root/a',sourceThreadId:root,state:'completed',resumeAvailable:true,observedAt:new Date().toISOString(),source:'collaboration.list_agents',evidence:'Fixture exact spawning parent confirms original agent is present'});
 assert.equal(dispatch(s,'team_record_host_action',input).action.status,'succeeded');
});
