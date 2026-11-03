import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sessionTree } from '../src/browse.mjs';
import { historySyncPlan } from '../src/history-sync.mjs';
// Deterministic DOM contract fixture. No browser/desktop control or visual test.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.open = false; this.hidden = false; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(_) { throw new Error('Record text must not become executable HTML'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = [...nodes]; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener() {}
  close() { this.open = false; }
  showModal() { this.open = true; }
}
function walk(node) { return [node, ...node.children.flatMap(walk)]; }
function fixture(call) {
  const ids = Object.fromEntries(['team-map','node-title','node-body','node-detail','close-node','task-detail'].map(id => [id, new Element()]));
  const document = { getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const context = { document }; vm.runInNewContext(readFileSync(new URL('../ui/browser.js', import.meta.url), 'utf8'), context);
  const board = { id: 'fixture-board', tasks: [], members: [
    { id:'lead',name:'Fixture lead',role:'lead',parentId:null,source:'manual',status:'unknown' },
    { id:'child',name:'Fixture child',parentId:'lead',source:'reported',status:'working',runtimeRef:'/root/fixture' },
    { id:'grandchild',name:'Fixture grandchild',parentId:'child',source:'reported',status:'completed' },
    { id:'grouped',name:'Fixture grouped',parentId:'child',workflowId:'workflow',source:'reported',status:'idle' }],
    workflows:[{id:'workflow',title:'Fixture workflow',parentMemberId:'child',status:'running',source:'reported'}] };
  board.sessionTree = sessionTree(board);
  const bridge={canOpenLinks:()=>true,openNativeThread:async()=>({accepted:true,viewConfirmed:false}), async call(name,args) {if(name==='team_request_host_action')return {action:{id:'host-fixture',revision:1,nativeId:args.expectedNativeId ?? board.members.find(m=>m.id===args.memberId)?.nativeId,parentThreadId:board.rootSessionId}};const page=await call(name,args);if(page?.nodeKind==='member')page.historySync??=historySyncPlan(board,page.node,page.latestHostPage);return page;} };
  const browser = new context.WorkbenchBrowser({ bridge,getBoard:()=>board,openTask:()=>{},runNames:{succeeded:'Confirmed fixture'} });
  return { ids, board, browser };
}
test('actual tree renderer nests grandchildren/groups, toggles branches and opens the selected node', async () => {
  let selected;
  const f = fixture(async (_, args) => { selected = args; return { node:f.board.members.find(m=>m.id===args.nodeId),nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0 }; });
  f.browser.renderMap(); assert(f.ids['team-map'].textContent.includes('Fixture grandchild')); assert(f.ids['team-map'].textContent.includes('Fixture workflow'));
  let toggle = walk(f.ids['team-map']).find(e=>e.attributes['aria-label']==='折叠 Fixture child');
  toggle.onclick(); assert(!f.ids['team-map'].textContent.includes('Fixture grandchild'));
  toggle = walk(f.ids['team-map']).find(e=>e.attributes['aria-label']==='展开 Fixture child'); toggle.onclick();
  const card = walk(f.ids['team-map']).find(e=>e.attributes['aria-label']==='查看成员：Fixture grandchild');
  await card.onclick(); assert.equal(selected.nodeId,'grandchild'); assert.equal(f.ids['node-detail'].open,true);
  assert(f.ids['node-body'].textContent.includes('尚未绑定原生会话'));
});
test('record reader pages reported text safely and never labels it a complete native transcript', async () => {
  const calls=[];
  const records=Array.from({length:27},(_,i)=>({seq:i+1,nodeId:'child',role:'tool',text:`<script>fixture-${i}</script>`,receivedAt:'2026-11-02T00:00:00Z',source:'reported',evidence:'Synthetic tool observation'}));
  const f = fixture(async (_,args)=>{ calls.push(args);const page=records.filter(r=>r.seq>(args.after??0)).slice(0,25);return {node:f.board.members[1],nodeKind:'member',records:page,nextCursor:page.at(-1).seq<27?page.at(-1).seq:null,executions:[],executionCount:0}; });
  await f.browser.open('member','child'); assert.equal(f.browser.entries.children.length,25);
  assert.equal(f.browser.more.hidden,false);await f.browser.more.onclick();
  assert.equal(f.browser.entries.children.length,27);assert.equal(f.browser.more.hidden,true);assert.equal(calls[1].after,25);
  assert(f.browser.entries.textContent.includes('<script>fixture-0</script>'));
  assert(f.ids['node-body'].textContent.includes('尚未绑定原生会话'));
  assert(!walk(f.ids['node-body']).some(e=>e.tagName==='button'&&e.textContent.includes('查看原生转录')));
  const sync=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='请求主会话关联并同步');assert.equal(sync.disabled,true);
});
test('closing a node invalidates an outstanding record read without reopening or overwriting the view', async () => {
  let settle;
  const f=fixture(()=>new Promise(resolve=>{settle=resolve;}));
  const pending=f.browser.open('member','child'); f.browser.close();
  const before=f.ids['node-body'].textContent;
  settle({node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0});await pending;
  assert.equal(f.ids['node-detail'].open,false);assert.equal(f.ids['node-body'].textContent,before);
});
test('host snapshots render as partial relayed text and earlier-page requests preserve exact identity/cursor', async () => {
  const threadId='00000000-0000-4000-8000-000000000005';
  const hostPage={threadId,hostId:'fixture-host',recordId:'fixture-page',nextCursor:'fixture-older-cursor',coverage:'selected-visible-items',turns:[{id:'fixture-turn',status:'completed',items:[{id:'fixture-item',type:'agentMessage',text:'<img src=x onerror=fixture>'}]}]};
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[{recordId:'fixture-page',source:'public-host-page-relayed',hostPage,observedAt:'2026-11-02T00:00:00Z',evidence:'Explicit synthetic host export'}],nextCursor:null,latestHostPage:hostPage,executions:[],executionCount:0}));
  f.board.members[1].nativeId=threadId;
  f.browser.bridge.canMessageLead=()=>true;
  let prompt;f.browser.bridge.messageLead=async value=>{prompt=value;};
  await f.browser.open('member','child');
  assert(f.browser.latestConversation.textContent.includes('公开宿主会话快照（主代理中继）'));
  assert(f.browser.latestConversation.textContent.includes('部分可见条目'));
  assert(f.ids['node-body'].textContent.includes('已同步 1 条可见消息'));
  assert(!f.ids['node-body'].textContent.includes('完整原生转录尚未连接'));
  assert(f.browser.latestConversation.textContent.includes('<img src=x onerror=fixture>'));
  assert(!f.browser.entries.textContent.includes('<img src=x onerror=fixture>'));
  const older=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='请求主会话读取更早页');
  assert.equal(older.disabled,false);await older.onclick();
  assert(prompt.includes(threadId));assert(prompt.includes('fixture-older-cursor'));assert(prompt.includes('host read tools'));
  assert(prompt.includes('team_import_thread_page'));assert(prompt.includes('omit reasoning'));
});
test('unbound spawned node offers one origin-resolution request with no guessed child thread ID',async()=>{
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  f.browser.bridge.canMessageLead=()=>true;
  let prompt;f.browser.bridge.messageLead=async value=>{prompt=value;};
  await f.browser.open('member','child');
  const sync=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='请求主会话关联并同步');
  assert.equal(sync.disabled,false);await sync.onclick();
  const request=JSON.parse(prompt.split('Request: ')[1]);
  assert.equal(request.action,'resolve-and-read');assert.equal(request.runtimeRef,'/root/fixture');
  assert.equal(request.parentMemberId,'lead');assert.equal(request.parentThreadId,null);
  assert(!Object.hasOwn(request,'threadId'));assert(prompt.includes('team_bind_agent_activity'));
  assert(prompt.includes('do not substitute a development/executor thread'));
});


test('opening a bound child calls ui/open-link for exactly that child without messaging the lead',async()=>{
  const threadId='00000000-0000-4000-8000-000000000005';
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  f.board.members[1].nativeId=threadId;f.browser.bridge.canMessageLead=()=>true;
  let opened,messages=0;f.browser.bridge.openNativeThread=async id=>{opened=id;return {accepted:true,viewConfirmed:false};};f.browser.bridge.messageLead=async()=>{messages++;};
  await f.browser.open('member','child');
  const open=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='打开对应子代理会话');
  assert.equal(open.disabled,false);await open.onclick();
  assert.equal(opened,threadId);assert.equal(messages,0);assert(f.ids['node-body'].textContent.includes('客户端已接受打开请求'));assert(f.ids['node-body'].textContent.includes('未验证目标画面'));
});


test('only fresh actual running observation animates a branch and confirmed continuation targets the exact native path',async()=>{
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  const child=f.board.members[1];child.nativeId='00000000-0000-4000-8000-000000000804';f.board.members[0].nativeId='00000000-0000-4000-8000-000000000803';child.runtimeFresh=true;child.runtimeObservation={state:'running',resumeAvailable:true,sourceThreadId:f.board.members[0].nativeId,observedAt:new Date().toISOString(),source:'collaboration.list_agents',evidence:'Synthetic lead observation'};
  f.browser.bridge.canMessageLead=()=>true;let prompt;f.browser.bridge.messageLead=async p=>{prompt=p;};
  f.browser.renderMap();assert(walk(f.ids['team-map']).some(e=>e.className?.includes('runtime-active')));
  child.runtimeFresh=false;f.browser.renderMap();assert(!walk(f.ids['team-map']).some(e=>e.className?.includes('runtime-active')));
  child.runtimeFresh=true;child.runtimeObservation.state='completed';f.browser.renderMap();assert(!walk(f.ids['team-map']).some(e=>e.className?.includes('runtime-active')));
  await f.browser.open('member','child');const resume=walk(f.ids['node-body']).find(e=>e.textContent==='请求续接代理');assert.equal(resume.disabled,false);resume.onclick();
  const form=walk(f.ids['node-body']).find(e=>e.tagName==='form'),input=walk(form).find(e=>e.tagName==='textarea');input.value='Synthetic continuation';await form.onsubmit({preventDefault(){}});
  const request=JSON.parse(prompt.split('Request: ')[1]);assert.equal(request.nativeId,child.nativeId);assert.equal(request.actionId,'host-fixture');assert(!Object.hasOwn(request,'instructions'));assert(!prompt.includes('Synthetic continuation'));assert(prompt.includes('never use direct app-server input'));
  child.runtimeFresh=false;await f.browser.open('member','child');assert.equal(walk(f.ids['node-body']).find(e=>e.textContent==='请求续接代理').disabled,true);
});


test('sync failure keeps an earlier successful snapshot visible with its failure reason',async()=>{
  const page={threadId:'00000000-0000-4000-8000-000000000005',readAt:'2026-11-02T00:00:00Z',recordId:'fixture-old-page',turns:[{id:'t',status:'completed',items:[{id:'m',type:'agentMessage',text:'Saved actual page fixture'}]}]};
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0,latestHostPage:page}));
  f.board.members[1].nativeId=page.threadId;f.board.members[1].identityResolution={status:'blocked',reason:'Fixture host unavailable',attemptedAt:'2026-11-02T00:01:00Z'};
  await f.browser.open('member','child');assert(f.ids['node-body'].textContent.includes('Fixture host unavailable'));assert(f.ids['node-body'].textContent.includes('Saved actual page fixture'));assert(f.ids['node-body'].textContent.includes('已同步 1 条可见消息'));
});


test('expired native running observation stays explicitly unconfirmed, not completed or idle',()=>{
 const f=fixture(async()=>({}));const m=f.board.members[1];m.source='hook';m.status='start_observed';m.runtimeFresh=false;m.runtimeObservation={source:'native-command-hook',state:'running'};m.runtimeStatus={label:'运行后未收到停止 · 当前活跃性待确认'};
 f.browser.renderMap();assert(f.ids['team-map'].textContent.includes('当前活跃性待确认'));
 const branch=walk(f.ids['team-map']).find(e=>e.className?.includes('runtime-active'));assert.equal(branch,undefined);
});

test('node shows original dispatch instructions, source-labeled result and actual host failure receipt',async()=>{
 const f=fixture(async()=>({node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executionCount:1,
 executions:[{id:'run-fixture',taskId:'task-fixture',status:'succeeded',createdAt:'2026-01-01T00:00:00Z',instructions:'ORIGINAL_DISPATCH_TEXT',result:'REPORTED_RESULT_TEXT',evidence:[]}],
 hostActions:[{kind:'navigate',status:'failed',result:'HOST_ROUTE_UNAVAILABLE_FIXTURE',nativeId:'fixture-id'}]}));
 await f.browser.open('member','child');const text=f.ids['node-body'].textContent;
 for(const expected of ['ORIGINAL_DISPATCH_TEXT','REPORTED_RESULT_TEXT','HOST_ROUTE_UNAVAILABLE_FIXTURE','非完整转录'])assert(text.includes(expected));
});


test('missing openLinks prevents direct navigation and leaves no pending action',async()=>{
 let created=0;const f=fixture(async()=>({node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
 f.board.members[1].nativeId='00000000-0000-4000-8000-000000000602';await f.browser.open('member','child');
 f.browser.bridge.canOpenLinks=()=>false;const original=f.browser.bridge.call;f.browser.bridge.call=async(name,args)=>{if(name==='team_request_host_action')created++;return original(name,args);};
 await f.browser.requestNativeNavigation({boardId:f.board.id,node:f.board.members[1],historySync:{mode:'read',threadId:f.board.members[1].nativeId}});
 assert.equal(created,0);assert(f.ids['node-body'].textContent.includes('未提供'));
});

test('host message failure records failed exact-target receipt instead of a permanent pending request',async()=>{
 const calls=[];const f=fixture(async(name,args)=>{if(name==='team_record_host_action'){calls.push(args);return{};}return{boardId:'fixture-board',node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0};});
 const id='00000000-0000-4000-8000-000000000603';f.board.members[1].nativeId=id;f.browser.bridge.canMessageLead=()=>true;f.browser.bridge.messageLead=async()=>{throw new Error('FIXTURE_DELIVERY_FAILED');};
 await f.browser.open('member','child');await f.browser.requestLeadNavigation({boardId:f.board.id,node:f.board.members[1],historySync:{mode:'read',threadId:id}});
 assert.equal(calls.length,1);assert.equal(calls[0].status,'failed');assert.equal(calls[0].nativeId,id);assert.equal(calls[0].source,'ui/message');
 assert(f.ids['node-body'].textContent.includes('FIXTURE_DELIVERY_FAILED'));
});


test('auto-discovered exact-parent member can request verification without pretending resume capability',async()=>{
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  const root='00000000-0000-4000-8000-000000000701', child='00000000-0000-4000-8000-000000000702';
  f.board.rootSessionId=root;f.board.members[0].nativeId=root;
  const node=f.board.members[1];node.nativeId=child;node.source='hook';node.runtimeFresh=true;
  node.nativeTopology={source:'app-server.thread/read metadata',rootThreadId:root,parentThreadId:root};
  node.runtimeObservation={state:'idle',resumeAvailable:false,source:'native-command-hook',observedAt:new Date().toISOString()};
  let calls=0,prompt;const original=f.browser.bridge.call;
  f.browser.bridge.call=async(name,args)=>{if(name==='team_request_host_action'){calls++;return {action:{id:'host-fixture',revision:1,parentThreadId:root,nativeId:child}};}return original(name,args);};
  f.browser.bridge.canMessageLead=()=>true;f.browser.bridge.messageLead=async p=>{prompt=p;};
  await f.browser.open('member','child');
  const resume=walk(f.ids['node-body']).find(e=>e.textContent==='请求续接代理');assert.equal(resume.disabled,false);assert.equal(calls,0);
  resume.onclick();const form=walk(f.ids['node-body']).find(e=>e.tagName==='form');walk(form).find(e=>e.tagName==='textarea').value='Verify the same actual agent first';
  await form.onsubmit({preventDefault(){}});assert.equal(calls,1);
  const request=JSON.parse(prompt.split('Request: ')[1]);assert.equal(request.nativeId,child);assert(!Object.hasOwn(request,'instructions'));assert(!prompt.includes('Verify the same actual agent first'));
  assert(prompt.includes('record fresh capability before/after'));assert(prompt.includes('never use direct app-server input'));
  assert.equal(node.runtimeObservation.resumeAvailable,false);
  f.board.members[0].nativeId='00000000-0000-4000-8000-000000000703';
  assert.equal(f.browser.canRequestContinuation(node),false);
});

test('actual direct history handler sends no lead message, guards double clicks, and renders the returned page',async()=>{
 const calls=[];let release,updated=false,messages=0;
 const threadId='00000000-0000-4000-8000-000000000811';
 const page=()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0,directHistoryAvailable:true,
   latestHostPage:updated?{threadId,source:'public-app-server-page',recordId:'direct-fixture-page',readAt:'2026-11-03T00:00:00Z',turns:[{id:'turn',status:'completed',items:[{id:'message',type:'agentMessage',text:'DIRECT_PAGE_RESULT'}]}]}:null});
 const f=fixture(async(name,args)=>{calls.push({name,args});if(name==='team_sync_native_history')return new Promise(resolve=>{release=()=>{updated=true;resolve({...page(),sync:{duplicate:false,empty:false}});};});return page();});
 f.board.members[1].nativeId=threadId;f.browser.bridge.messageLead=async()=>{messages++;};
 await f.browser.open('member','child');
 const sync=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='同步可见对话');assert.equal(sync.disabled,false);
 const pending=sync.onclick();assert(f.ids['node-body'].textContent.includes('正在通过公开接口读取'));await sync.onclick();
 assert.equal(calls.filter(c=>c.name==='team_sync_native_history').length,1);
 assert.equal(calls.at(-1).args.expectedNativeId,threadId);release();await pending;
 assert.equal(messages,0);assert(f.ids['node-body'].textContent.includes('DIRECT_PAGE_RESULT'));assert(f.ids['node-body'].textContent.includes('插件直读'));
 assert(f.ids['node-body'].textContent.includes('未发送主对话消息'));
});

test('direct history failure keeps saved content and never silently falls back to the main chat',async()=>{
 let messages=0;
 const f=fixture(async(name)=>{if(name==='team_sync_native_history')throw new Error('PUBLIC_HISTORY_UNAVAILABLE_FIXTURE');return {boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0,directHistoryAvailable:true,
 latestHostPage:{threadId:f.board.members[1].nativeId,source:'public-app-server-page',recordId:'saved-page',turns:[{id:'turn',status:'completed',items:[{id:'message',type:'agentMessage',text:'PRESERVED_SAVED_MESSAGE'}]}]}};});
 f.board.members[1].nativeId='00000000-0000-4000-8000-000000000812';f.browser.bridge.messageLead=async()=>{messages++;};
 await f.browser.open('member','child');const sync=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='同步可见对话');await sync.onclick();
 assert.equal(messages,0);assert(f.ids['node-body'].textContent.includes('PRESERVED_SAVED_MESSAGE'));assert(f.ids['node-body'].textContent.includes('PUBLIC_HISTORY_UNAVAILABLE_FIXTURE'));
 assert(f.ids['node-body'].textContent.includes('未自动转发'));
});

test('refused native link records the actual host failure without ui/message or an OS fallback',async()=>{
 const receipts=[];let opened=0,messages=0,release;
 const f=fixture(async(name,args)=>{if(name==='team_record_host_action'){receipts.push(args);return{};}return{boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0};});
 f.board.members[1].nativeId='00000000-0000-4000-8000-000000000813';
 f.browser.bridge.messageLead=async()=>{messages++;};f.browser.bridge.openNativeThread=()=>{opened++;return new Promise((_,reject)=>{release=()=>reject(new Error('Policy violation (RPC -32000)'));});};
 await f.browser.open('member','child');const open=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='打开对应子代理会话');
 const pending=open.onclick();await new Promise(setImmediate);await open.onclick();assert.equal(opened,1);release();await pending;
 assert.equal(messages,0);assert.equal(receipts.length,1);assert.equal(receipts[0].source,'ui/open-link');assert.equal(receipts[0].status,'failed');
 assert(receipts[0].result.includes('RPC -32000'));assert(f.ids['node-body'].textContent.includes('未自动向主对话发送消息'));
});

test('runtime and saved-record refresh use direct MCP calls with changed/unchanged/error feedback',async()=>{
 let messages=0,changed=false,fail=false;
 const f=fixture(async(name)=>{
  if(fail)throw new Error('DIRECT_REFRESH_FAILURE');
  if(name==='team_snapshot')return{board:{...f.board,members:f.board.members.map(m=>m.id==='child'?{...m,runtimeObservation:{state:'idle',observedAt:'2026-11-03T00:00:00Z'}}:m)}};
  return {boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:changed?[{nodeId:'child',role:'note',text:'UPDATED_RECORD_FIXTURE',source:'reported',evidence:'Synthetic fixture'}]:[],nextCursor:null,executions:[],executionCount:0};
 });
 f.browser.bridge.messageLead=async()=>{messages++;};f.browser.onSnapshot=s=>Object.assign(f.board,s.board);
 await f.browser.open('member','child');
 await f.browser.refreshSavedRecords();assert(f.ids['node-body'].textContent.includes('数据未变化'));
 changed=true;await f.browser.refreshSavedRecords();assert(f.ids['node-body'].textContent.includes('数据已更新'));assert(f.ids['node-body'].textContent.includes('UPDATED_RECORD_FIXTURE'));
 await f.browser.requestRuntimeRefresh({boardId:f.board.id,node:f.board.members[1]});assert(f.ids['node-body'].textContent.includes('无新事件')||f.ids['node-body'].textContent.includes('数据已更新'));
 fail=true;await f.browser.refreshSavedRecords();assert(f.ids['node-body'].textContent.includes('DIRECT_REFRESH_FAILURE'));assert.equal(messages,0);
});
