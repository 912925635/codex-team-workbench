import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topologyPlan, syncNativeTopology } from '../src/native-topology.mjs';
import { Store } from '../src/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root='00000000-0000-4000-8000-000000000301',a='00000000-0000-4000-8000-000000000302',b='00000000-0000-4000-8000-000000000303';
const members=[{id:'lead',nativeId:root},{id:'a',nativeId:a},{id:'b',nativeId:b}];
const row=(id,parent,path)=>({id,parentThreadId:parent,source:{subAgent:{thread_spawn:{parent_thread_id:parent,agent_path:path}}}});
test('verified metadata builds direct child and grandchild from exact IDs, never the shared session alone',()=>{
 const plans=topologyPlan(root,members,[row(a,root,'/root/a'),row(b,a,'/root/a/b')]);
 assert.equal(plans.find(p=>p.memberId==='a').parentId,'lead');assert.equal(plans.find(p=>p.memberId==='b').parentId,'a');
 assert(topologyPlan(root,members,[{id:a,sessionId:root}]).every(p=>!p.verified));
});
test('missing, contradictory, cyclic, historical and runtime-conflicting metadata never changes parentage',()=>{
 assert(topologyPlan(root,members,[row(a,b,'/root/a'),row(b,a,'/root/a/b')]).every(p=>!p.verified));
 const bad=row(a,root,'/root/a');bad.source.subAgent.thread_spawn.parent_thread_id=b;
 assert.equal(topologyPlan(root,members,[bad])[0].verified,false);
 assert.equal(topologyPlan(root,[...members.map(m=>m.id==='a'?{...m,runtimeRef:'/root/other'}:m)],[row(a,root,'/root/a')])[0].verified,false);
 assert(!topologyPlan(root,members.map(m=>({...m,historyOnly:true})),[]).length);
});
test('automatic metadata projection is idempotent, preserves lifecycle, and connection failures retain truthful association',t=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-topology-'));const s=new Store(dir,{nativeMetadataReader:()=>[row(a,root,'/root/a'),row(b,a,'/root/a/b')]});t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
 let x=s.create('Fixture');x=s.bind(x.id,root,x.revision);
 s.reportMember(x.id,{memberId:'a',name:'a',nativeId:a,evidence:'Fixture',status:'working'});
 s.reportMember(x.id,{memberId:'b',name:'b',nativeId:b,evidence:'Fixture',status:'working'});
 const first=syncNativeTopology(s,x.id);assert.equal(first.applied,2);const board=s.view(x.id);
 assert.equal(board.members.find(m=>m.id==='b').parentId,'a');assert.throws(()=>s.reportMember(x.id,{memberId:'b',name:'b',status:'unknown',parentId:'lead'}),{code:'VERIFIED_PARENT_CONFLICT'});assert.equal(board.members.find(m=>m.id==='a').runtimeRef,'/root/a');
 syncNativeTopology(s,x.id);assert.equal(s.read(x.id).revision,board.revision);
});
