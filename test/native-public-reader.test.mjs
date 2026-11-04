import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { readPublicRequest, controlSocketPath, probePublicSocket } from '../src/native-public-reader.mjs';
import { nativeReadPlatformSupported, publicReaderStatus } from '../src/native-topology.mjs';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';
import { autoHistoryStatus } from '../src/auto-history.mjs';
import { reviewPublicFiles } from '../scripts/review-public.mjs';

const root='00000000-0000-4000-8000-000000000981',child='00000000-0000-4000-8000-000000000982';
const rows=[{id:root},{id:child,parentThreadId:root,source:{subAgent:{thread_spawn:{parent_thread_id:root,agent_path:'/root/linux_fixture'}}}}];
const history={data:[{id:'fixture-turn',status:'completed',items:[
  {id:'u',type:'userMessage',content:[{type:'text',text:'Visible fixture input'},{type:'image',data:'OMITTED_IMAGE_FIXTURE'}]},
  {id:'a',type:'agentMessage',text:'Visible fixture result'},
  {id:'r',type:'reasoning',text:'OMITTED_REASONING_FIXTURE'},
  {id:'c',type:'commandExecution',output:'OMITTED_TOOL_FIXTURE'}]}],nextCursor:'fixture-older'};
const input={threadIds:[child,root],rootThreadId:root,runtimeRef:'/root/linux_fixture',mode:'history',cursor:null};
function frame(bytes,opcode=1,fin=true){
  if(typeof bytes==='string')bytes=Buffer.from(bytes);
  const h=Buffer.alloc(bytes.length<126?2:bytes.length<=65535?4:10);h[0]=(fin?128:0)|opcode;
  if(bytes.length<126)h[1]=bytes.length;else if(bytes.length<=65535){h[1]=126;h.writeUInt16BE(bytes.length,2);}else{h[1]=127;h.writeBigUInt64BE(BigInt(bytes.length),2);}
  return Buffer.concat([h,bytes]);
}
async function fixture(t,options={}){
  const dir=mkdtempSync(join(tmpdir(),'workbench-public-reader-'));
  const path=options.socketPath??(process.platform==='win32'?`\\\\.\\pipe\\workbench-public-${randomUUID()}`:join(dir,'public.sock'));
  if(process.platform!=='win32')mkdirSync(dirname(path),{recursive:true});
  const connections=new Set(),calls=[],beforeCleanup=[];let count=0,pongs=0;
  const server=createServer();
  server.on('upgrade',(req,socket)=>{
    count++;connections.add(socket);socket.on('close',()=>connections.delete(socket));socket.on('error',()=>{});
    if(options.reject){socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');return;}
    const accept=options.badAccept?'invalid':createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer=Buffer.alloc(0);
    const send=value=>{
      const bytes=Buffer.from(JSON.stringify(value));
      if(options.fragment){const n=Math.floor(bytes.length/2);socket.write(frame(bytes.subarray(0,n),1,false));socket.write(frame(Buffer.from('ping'),9));socket.write(frame(bytes.subarray(n),0,true));}
      else socket.write(frame(bytes));
    };
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=2){
        const opcode=buffer[0]&15;assert(buffer[1]&128,'client frames must be masked');let n=buffer[1]&127,o=2;
        if(n===126){if(buffer.length<4)return;n=buffer.readUInt16BE(2);o=4;}
        assert.notEqual(n,127);if(buffer.length<o+4+n)return;
        const mask=buffer.subarray(o,o+4),b=Buffer.from(buffer.subarray(o+4,o+4+n));for(let i=0;i<b.length;i++)b[i]^=mask[i%4];buffer=buffer.subarray(o+4+n);
        if(opcode===10){pongs++;continue;}
        const msg=JSON.parse(b.toString());calls.push(msg);if(!msg.id)continue;
        if(options.hold)continue;
        if(options.oversize){const h=Buffer.alloc(10);h[0]=129;h[1]=127;h.writeBigUInt64BE(1048577n,2);socket.write(h);continue;}
        if(options.frameFlood){socket.write(Buffer.concat(Array.from({length:4097},(_,i)=>frame(Buffer.alloc(0),i?0:1,false))));continue;}
        if(options.handle){options.handle(msg,{send,socket});continue;}
        if(msg.method==='initialize')send({id:msg.id,result:{}});
        else if(msg.method==='thread/read')send({id:msg.id,result:{thread:{...rows.find(r=>r.id===msg.params.threadId),turns:[{text:'UNREQUESTED_METADATA_BODY_FIXTURE'}]}}});
        else if(msg.method==='thread/turns/list')send({id:msg.id,result:options.history??history});
        else assert.fail('Unexpected RPC '+msg.method);
      }
    });
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(path,yes);});
  t.after(async()=>{for(const close of beforeCleanup)await close();for(const socket of connections)socket.destroy();await new Promise(yes=>server.close(yes));assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  return {path,calls,read:(request=input,extra={})=>readPublicRequest(request,{socketPath:path,...extra}),count:()=>count,pongs:()=>pongs,dir,cleanupFirst:fn=>beforeCleanup.push(fn)};
}

// A separate test worker serves the synthetic RPCs while spawnSync blocks the
// test's main event loop. It never runs a model or the user's app-server.
async function backgroundFixture(t,options={}){
  const code=`
    const {parentPort,workerData}=require('node:worker_threads');
    const assert=require('node:assert/strict');const {createServer}=require('node:http');
    const {createHash,randomUUID}=require('node:crypto');const {mkdtempSync,mkdirSync,rmSync}=require('node:fs');
    const {tmpdir}=require('node:os');const {join,resolve,sep,dirname}=require('node:path');
    const rows=workerData.rows,history=workerData.history,cleanup=[];
    ${frame.toString()}
    ${fixture.toString()}
    fixture({after:fn=>cleanup.push(fn)},workerData.options).then(f=>{
      parentPort.postMessage({path:f.path});parentPort.once('message',async()=>{
        for(const fn of cleanup)await fn();parentPort.close();
      });
    });`;
  const worker=new Worker(code,{eval:true,execArgv:[],workerData:{rows,history,options}});
  const exited=new Promise((yes,no)=>{worker.once('exit',code=>code===0?yes():no(new Error('RPC fixture worker exited '+code)));worker.once('error',no);});
  // Attach a handler immediately; startup/close still report any worker error.
  exited.catch(()=>{});
  const first=await new Promise((yes,no)=>{worker.once('message',yes);worker.once('error',no);});
  let closed=false;
  const close=async()=>{
    if(closed)return;closed=true;worker.postMessage('close');let timer;
    try{await Promise.race([exited,new Promise((_,no)=>{timer=setTimeout(()=>no(new Error('Owned RPC fixture did not exit')),3000);})]);}
    catch(error){await worker.terminate();throw error;}finally{clearTimeout(timer);}
  };
  t?.after(close);return {path:first.path,close};
}

test('Node local WebSocket reader uses exact read-only RPCs and omits hidden/tool content before returning',async t=>{
  const f=await fixture(t),page=await f.read();
  assert.equal(page.threadId,child);assert.equal(page.turns[0].items.length,2);assert.equal(page.omittedItems,2);
  const body=JSON.stringify(page);for(const marker of ['OMITTED_REASONING_FIXTURE','OMITTED_TOOL_FIXTURE','OMITTED_IMAGE_FIXTURE','UNREQUESTED_METADATA_BODY_FIXTURE'])assert(!body.includes(marker));
  assert.deepEqual(f.calls.map(c=>c.method),['initialize','initialized','thread/read','thread/read','thread/turns/list']);
  assert.deepEqual(f.calls.find(c=>c.method==='thread/turns/list').params,{threadId:child,limit:1,sortDirection:'desc',itemsView:'full'});
  assert.equal(page.nextCursor,'fixture-older');
});

test('fragmented WebSocket text and interleaved ping frames preserve the bounded result',async t=>{
  const f=await fixture(t,{fragment:true});const page=await f.read();assert.equal(page.turns[0].items[1].text,'Visible fixture result');assert(f.pongs()>0);
});

test('wrong parent, runtime path or identity fails before requesting any history body',async t=>{
  for(const wrong of ['parent','path','identity']){
    const f=await fixture(t,{handle(msg,{send}){
      if(msg.method==='initialize'){send({id:msg.id,result:{}});return;}
      assert.equal(msg.method,'thread/read');const row=structuredClone(rows.find(r=>r.id===msg.params.threadId));
      if(row.id===child){if(wrong==='parent')row.parentThreadId='00000000-0000-4000-8000-000000000983';if(wrong==='path')row.source.subAgent.thread_spawn.agent_path='/root/wrong';if(wrong==='identity')row.id=root;}
      send({id:msg.id,result:{thread:row}});
    }});
    await assert.rejects(f.read(),error=>['PUBLIC_PARENT_UNVERIFIED','PUBLIC_ID_MISMATCH'].includes(error.code));
    assert(!f.calls.some(c=>c.method==='thread/turns/list'));
  }
});

test('untrusted request fields and missing exact root are rejected before connecting',async t=>{
  const f=await fixture(t);
  for(const request of [{...input,socketPath:'ignored'},{...input,threadIds:['short-id']},{...input,rootThreadId:undefined},{...input,cursor:'x'.repeat(4097)},{...input,threadIds:[child,child,root]}])
    await assert.rejects(f.read(request),{code:'INVALID_PUBLIC_SCOPE'});
  assert.equal(f.count(),0);
});

test('unsupported public RPC and rejected handshake produce specific errors without echoing host content',async t=>{
  const f=await fixture(t,{handle(msg,{send}){send({id:msg.id,error:{code:-32601,message:'UNSAFE_HOST_ERROR_BODY_FIXTURE'}});}});
  await assert.rejects(f.read(),error=>error.code==='PUBLIC_RPC_ERROR'&&error.message.includes('-32601')&&!error.message.includes('UNSAFE_HOST_ERROR_BODY_FIXTURE'));
  const denied=await fixture(t,{reject:true});await assert.rejects(denied.read(),error=>error.code==='PUBLIC_UPGRADE_REJECTED'&&error.message.includes('403'));
  const invalid=await fixture(t,{badAccept:true});await assert.rejects(invalid.read(),{code:'PUBLIC_UPGRADE_REJECTED'});
});

test('large raw pages, timeouts and cancellation fail within the bounded read lifetime',async t=>{
  const big=await fixture(t,{oversize:true});await assert.rejects(big.read(),{code:'PUBLIC_PAGE_TOO_LARGE'});
  const fragments=await fixture(t,{frameFlood:true});await assert.rejects(fragments.read(input,{timeoutMs:1000}),{code:'PUBLIC_PROTOCOL_INVALID'});
  const held=await fixture(t,{hold:true});await assert.rejects(held.read(input,{timeoutMs:40}),{code:'PUBLIC_READ_TIMEOUT'});
  const abort=new AbortController();const pending=held.read(input,{signal:abort.signal});setTimeout(()=>abort.abort(),20);await assert.rejects(pending,{code:'PUBLIC_READ_CANCELLED'});
});

test('visible text limits, older cursor and empty history never substitute parent messages',async t=>{
  const items=Array.from({length:25},(_,i)=>({id:`item-${i}`,type:'agentMessage',text:'x'.repeat(1200)}));
  const f=await fixture(t,{history:{data:[{id:'bounded-turn',status:'completed',items}],nextCursor:null}});const page=await f.read({...input,cursor:'explicit-older'});
  assert.equal(page.turns[0].items.length,8);assert.equal(page.turns[0].items.reduce((n,i)=>n+i.text.length,0),8000);assert.equal(page.truncated,true);
  assert.equal(f.calls.find(c=>c.method==='thread/turns/list').params.cursor,'explicit-older');
  const empty=await fixture(t,{history:{data:[],nextCursor:null}});const result=await empty.read();assert.deepEqual(result.turns,[]);assert.equal(result.threadId,child);
});

test('Linux path and readiness distinguish missing socket, permissions, plugin context and unsupported platform',()=>{
  assert.equal(controlSocketPath({platform:'linux',env:{},home:'/home/fixture'}),'/home/fixture/.codex/app-server-control/app-server-control.sock');
  assert.equal(controlSocketPath({platform:'linux',env:{CODEX_HOME:'/srv/fixture-codex'},home:'/home/fixture'}),'/srv/fixture-codex/app-server-control/app-server-control.sock');
  assert.throws(()=>controlSocketPath({platform:'linux',env:{CODEX_HOME:'relative'},home:'/home/fixture'}),{code:'INVALID_CODEX_HOME'});
  assert.equal(nativeReadPlatformSupported('linux'),true);assert.equal(nativeReadPlatformSupported('win32'),true);assert.equal(nativeReadPlatformSupported('freebsd'),false);
  const options={platform:'linux',env:{PLUGIN_DATA:'/fixture/plugin',CODEX_HOME:'/fixture/home'}};
  for(const [code,expected]of [['ENOENT','PUBLIC_SOCKET_MISSING'],['EACCES','PUBLIC_SOCKET_PERMISSION']])assert.equal(publicReaderStatus({...options,stat(){throw Object.assign(new Error('not echoed'),{code});}}).code,expected);
  assert.equal(publicReaderStatus({...options,stat:()=>({isSocket:()=>true})}).available,true);
  assert.equal(publicReaderStatus({...options,stat:()=>({isSocket:()=>false})}).code,'PUBLIC_SOCKET_NOT_SOCKET');
  assert.equal(publicReaderStatus({...options,env:{}}).code,'PUBLIC_PLUGIN_CONTEXT_MISSING');
  assert.equal(probePublicSocket({...options,stat(){throw Object.assign(new Error('fixture'),{code:'EPERM'});}}).available,false);
});

test('standalone cached Node helper runs in a synchronous child with only bounded selected JSON output',async t=>{
  const f=await backgroundFixture(t),source=readFileSync(new URL('../src/native-public-reader.mjs',import.meta.url),'utf8');
  const result=spawnSync(process.execPath,['--input-type=module','--eval',source+'\nawait runPublicReadCli({socketPath:process.argv[1]});',f.path],
    {input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:4000,maxBuffer:1048576});
  assert.equal(result.status,0,result.stderr);const page=JSON.parse(result.stdout);
  assert.equal(page.connected,true);assert.equal(page.threadId,child);assert.equal(page.turns[0].items.length,2);
  assert(!result.stdout.includes('OMITTED_REASONING_FIXTURE'));assert.equal(result.stderr,'');
});

test('public scanner allows the fixed WebSocket protocol GUID and still rejects other non-synthetic UUIDs',t=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-protocol-privacy-')),source=resolve(import.meta.dirname,'..');
  t.after(()=>{assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  const files=reviewPublicFiles(source);assert.deepEqual(files.findings,[]);
  for(const {path}of files.files){const out=join(dir,path);mkdirSync(dirname(out),{recursive:true});copyFileSync(join(source,path),out);}
  writeFileSync(join(dir,'docs','privacy-fixture.md'),'RFC protocol: 258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
  assert.deepEqual(reviewPublicFiles(dir).findings,[]);
  writeFileSync(join(dir,'docs','privacy-fixture.md'),'Synthetic generated UUID for rejection test: '+randomUUID());
  assert.deepEqual(reviewPublicFiles(dir).findings,[{path:'docs/privacy-fixture.md',reason:'non-synthetic UUID'}]);
});

test('automatic-sync diagnostics distinguish an unavailable endpoint and preserve explicit opt-in until disabled',async t=>{
  const f=await fixture(t),dir=join(f.dir,'data');let available=false,calls=0;
  const store=new Store(dir,{nativeEventJournal:join(dir,'native-events-probe.sqlite'),nativeHistoryAsyncReader:async()=>{calls++;throw new Error('Must not read a missing endpoint');},
    nativeReaderStatus:()=>({available,code:available?'PUBLIC_SOCKET_PRESENT':'PUBLIC_SOCKET_MISSING',message:available?'Fixture socket present':'Fixture socket missing'})});
  f.cleanupFirst(()=>store.close());let b=store.create('Synthetic diagnostics');b=store.bind(b.id,root,b.revision);
  const configure=enabled=>dispatch(store,'team_set_history_sync',{boardId:b.id,expectedRevision:store.read(b.id).revision,expectedRootSessionId:root,enabled,confirmed:true});
  let status=autoHistoryStatus(store,store.read(b.id));assert.equal(status.available,false);assert.equal(status.publicHistory.code,'PUBLIC_SOCKET_MISSING');assert.equal(status.hookJournal.configured,true);
  assert.throws(()=>configure(true),error=>error.code==='PUBLIC_HISTORY_UNAVAILABLE'&&error.message==='Fixture socket missing');
  available=true;configure(true);available=false;
  status=autoHistoryStatus(store,store.read(b.id));assert.equal(status.enabled,true);assert.equal(status.available,false);assert.equal(status.reason,'Fixture socket missing');assert.equal(calls,0);
  configure(false);assert.equal(autoHistoryStatus(store,store.read(b.id)).enabled,false);
});

test('Linux default readers use the actual Unix control path for sync, async and automatic Hook history', {skip:process.platform!=='linux'},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-linux-defaults-')),keys=['CODEX_HOME','PLUGIN_DATA','TEAM_WORKBENCH_DATA'];
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));let server,store;
  try{
    process.env.CODEX_HOME=join(dir,'home');process.env.PLUGIN_DATA=join(dir,'plugin');process.env.TEAM_WORKBENCH_DATA=join(dir,'data');
    server=await backgroundFixture(null,{socketPath:controlSocketPath()});store=new Store(process.env.TEAM_WORKBENCH_DATA);
    assert.equal(store.nativeReaderStatus().code,'PUBLIC_SOCKET_PRESENT');assert.equal(typeof store.nativeHistoryReader,'function');
    assert.equal(store.nativeMetadataReader([child,root]).length,2);
    assert.equal(store.nativeHistoryReader(input).threadId,child);assert.equal((await store.nativeHistoryAsyncReader(input)).threadId,child);
    let b=store.create('Synthetic Linux native defaults');b=store.bind(b.id,root,b.revision);
    store.reportMember(b.id,{memberId:'child',name:'Fixture',parentId:'lead',nativeId:child,runtimeRef:'/root/linux_fixture',evidence:'Synthetic Linux fixture',status:'unknown'});
    assert.equal(autoHistoryStatus(store,b).available,true);
    dispatch(store,'team_set_history_sync',{boardId:b.id,expectedRevision:store.read(b.id).revision,expectedRootSessionId:root,enabled:true,confirmed:true});
    const event={hook_event_name:'SubagentStop',session_id:root,agent_id:child,turn_id:'fixture-turn'};
    const callback=spawnSync(process.execPath,['src/native-hook.mjs'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env},input:JSON.stringify(event),encoding:'utf8',timeout:3000});
    assert.equal(callback.status,0);assert.equal(callback.stderr,'');
    await waitFor(()=>store.read(b.id).members.find(m=>m.id==='child').nativeHistoryRead?.status==='succeeded');
    assert.equal(dispatch(store,'team_read_records',{boardId:b.id,nodeKind:'member',nodeId:'child'}).latestHostPage.threadId,child);
  }finally{
    store?.close();await server?.close();for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];
    assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});
  }
});

async function waitFor(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw new Error('Isolated Hook/read condition timed out');await new Promise(r=>setTimeout(r,10));}}
test('packaged Hook command to real file watcher to Node public RPC fixture saves one page without a lead message',async t=>{
  const f=await fixture(t),data=join(f.dir,'plugin-data');
  const store=new Store(data,{nativeEventJournal:join(data,'native-events-probe.sqlite'),nativeMetadataReader:()=>rows,
    nativeHistoryAsyncReader:(request,options)=>f.read({...request,mode:'history'},options)});
  f.cleanupFirst(()=>store.close());let b=store.create('Synthetic cross-platform Hook pipeline');b=store.bind(b.id,root,b.revision);
  store.reportMember(b.id,{memberId:'child',name:'Fixture',parentId:'lead',nativeId:child,runtimeRef:'/root/linux_fixture',evidence:'Synthetic test',status:'unknown'});
  dispatch(store,'team_set_history_sync',{boardId:b.id,expectedRevision:store.read(b.id).revision,expectedRootSessionId:root,enabled:true,confirmed:true});
  const hook=event=>{const p=spawnSync(process.execPath,['src/native-hook.mjs'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,TEAM_WORKBENCH_DATA:data},input:JSON.stringify({hook_event_name:event,session_id:root,agent_id:child,turn_id:'fixture-turn',prompt:'OMITTED_PROMPT_FIXTURE'}),encoding:'utf8',windowsHide:true});assert.equal(p.status,0);assert.equal(p.stdout.trim(),'{}');assert.equal(p.stderr,'');};
  hook('SubagentStart');await waitFor(()=>store.read(b.id).members.find(m=>m.id==='child').runtimeObservation?.state==='running');
  hook('SubagentStop');await waitFor(()=>store.read(b.id).members.find(m=>m.id==='child').nativeHistoryRead?.status==='succeeded');
  const records=dispatch(store,'team_read_records',{boardId:b.id,nodeKind:'member',nodeId:'child'});
  assert.equal(records.latestHostPage.threadId,child);assert.equal(records.latestHostPage.turns[0].items[1].text,'Visible fixture result');
  assert(!JSON.stringify(records).includes('OMITTED_PROMPT_FIXTURE'));assert.equal(f.calls.filter(c=>c.method==='thread/turns/list').length,1);
  const status=autoHistoryStatus(store,store.read(b.id));assert.equal(status.available,true);assert.equal(status.hookJournal.configured,true);
});
