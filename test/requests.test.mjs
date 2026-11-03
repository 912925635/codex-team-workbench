import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';

test('compact lead request returns exact saved instructions and revisions without unrelated board/history content',t=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-request-')),s=new Store(dir);
 t.after(()=>{s.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 let b=s.create('Synthetic request fixture');const id=b.id;
 const root='00000000-0000-4000-8000-000000000951',child='00000000-0000-4000-8000-000000000952';
 b=s.bind(id,root,b.revision);b=s.createTask(id,{title:'Requested fixture',description:'EXACT_REQUEST_INSTRUCTIONS'});
 const task=b.tasks[0];s.createTask(id,{title:'UNRELATED_PRIVATE_TASK_FIXTURE',description:'UNRELATED_DESCRIPTION_FIXTURE'});
 b=dispatch(s,'team_request_execution',{boardId:id,taskId:task.id,expectedTaskRevision:task.revision}).board;
 const request=b.runs[0],result=dispatch(s,'team_get_request',{boardId:id,requestId:request.id,kind:'execution'});
 assert.equal(result.request.instructions,'EXACT_REQUEST_INSTRUCTIONS');assert.equal(result.task.revision,task.revision);
 assert.equal(result.parent.nativeId,root);assert(!JSON.stringify(result).includes('UNRELATED_'));
 assert(!Object.hasOwn(result.board,'tasks'));assert(!Object.hasOwn(result.board,'events'));
 s.reportMember(id,{memberId:'a',name:'Child fixture',nativeId:child,status:'unknown',evidence:'Synthetic member'});
 const action=dispatch(s,'team_request_host_action',{boardId:id,memberId:'a',kind:'navigate',expectedNativeId:child}).action;
 const navigation=dispatch(s,'team_get_request',{boardId:id,requestId:action.id,kind:'host-action'});
 assert.equal(navigation.target.nativeId,child);assert.equal(navigation.parent.nativeId,root);
 assert.throws(()=>dispatch(s,'team_get_request',{boardId:id,requestId:'not-this-request',kind:'execution'}),{code:'REQUEST_NOT_FOUND'});
});
