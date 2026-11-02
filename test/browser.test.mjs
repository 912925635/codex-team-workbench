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
  const bridge={ async call(name,args) {const page=await call(name,args);if(page?.nodeKind==='member')page.historySync??=historySyncPlan(board,page.node,page.latestHostPage);return page;} };
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
  const sync=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='关联并同步子代理记录');assert.equal(sync.disabled,true);
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
  const older=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='请求更早一页');
  assert.equal(older.disabled,false);await older.onclick();
  assert(prompt.includes(threadId));assert(prompt.includes('fixture-older-cursor'));assert(prompt.includes('codex-app-tools.read_thread'));
  assert(prompt.includes('team_import_thread_page'));assert(prompt.includes('Omit reasoning'));
});
test('unbound spawned node offers one origin-resolution request with no guessed child thread ID',async()=>{
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  f.browser.bridge.canMessageLead=()=>true;
  let prompt;f.browser.bridge.messageLead=async value=>{prompt=value;};
  await f.browser.open('member','child');
  const sync=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='关联并同步子代理记录');
  assert.equal(sync.disabled,false);await sync.onclick();
  const request=JSON.parse(prompt.split('Request: ')[1]);
  assert.equal(request.action,'resolve-and-read');assert.equal(request.runtimeRef,'/root/fixture');
  assert.equal(request.parentMemberId,'lead');assert.equal(request.parentThreadId,null);
  assert(!Object.hasOwn(request,'threadId'));assert(prompt.includes('team_bind_agent_activity'));
  assert(prompt.includes('do not substitute a development/executor thread'));
});


test('opening a bound child requests public host navigation for exactly that child',async()=>{
  const threadId='00000000-0000-4000-8000-000000000005';
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  f.board.members[1].nativeId=threadId;f.browser.bridge.canMessageLead=()=>true;
  let prompt;f.browser.bridge.messageLead=async p=>{prompt=p;};
  await f.browser.open('member','child');
  const open=walk(f.ids['node-body']).find(e=>e.tagName==='button'&&e.textContent==='打开对应子代理会话');
  assert.equal(open.disabled,false);await open.onclick();
  const request=JSON.parse(prompt.split('Request: ')[1]);assert.equal(request.threadId,threadId);assert.equal(request.memberId,'child');
  assert(prompt.includes('navigate_to_codex_page'));assert(prompt.includes('not proof'));
});


test('only fresh actual running observation animates a branch and confirmed continuation targets the exact native path',async()=>{
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0}));
  const child=f.board.members[1];child.runtimeFresh=true;child.runtimeObservation={state:'running',resumeAvailable:true,observedAt:new Date().toISOString(),source:'collaboration.list_agents',evidence:'Synthetic lead observation'};
  f.browser.bridge.canMessageLead=()=>true;let prompt;f.browser.bridge.messageLead=async p=>{prompt=p;};
  f.browser.renderMap();assert(walk(f.ids['team-map']).some(e=>e.className?.includes('runtime-active')));
  child.runtimeFresh=false;f.browser.renderMap();assert(!walk(f.ids['team-map']).some(e=>e.className?.includes('runtime-active')));
  child.runtimeFresh=true;child.runtimeObservation.state='completed';f.browser.renderMap();assert(!walk(f.ids['team-map']).some(e=>e.className?.includes('runtime-active')));
  await f.browser.open('member','child');const resume=walk(f.ids['node-body']).find(e=>e.textContent==='续接代理');assert.equal(resume.disabled,false);resume.onclick();
  const form=walk(f.ids['node-body']).find(e=>e.tagName==='form'),input=walk(form).find(e=>e.tagName==='textarea');input.value='Synthetic continuation';await form.onsubmit({preventDefault(){}});
  const request=JSON.parse(prompt.split('Request: ')[1]);assert.equal(request.runtimeRef,'/root/fixture');assert.equal(request.instructions,'Synthetic continuation');assert(prompt.includes('never use direct app-server input'));
  child.runtimeFresh=false;await f.browser.open('member','child');assert.equal(walk(f.ids['node-body']).find(e=>e.textContent==='续接代理').disabled,true);
});


test('sync failure keeps an earlier successful snapshot visible with its failure reason',async()=>{
  const page={threadId:'00000000-0000-4000-8000-000000000005',readAt:'2026-11-02T00:00:00Z',recordId:'fixture-old-page',turns:[{id:'t',status:'completed',items:[{id:'m',type:'agentMessage',text:'Saved actual page fixture'}]}]};
  const f=fixture(async()=>({boardId:f.board.id,node:f.board.members[1],nodeKind:'member',records:[],nextCursor:null,executions:[],executionCount:0,latestHostPage:page}));
  f.board.members[1].nativeId=page.threadId;f.board.members[1].identityResolution={status:'blocked',reason:'Fixture host unavailable',attemptedAt:'2026-11-02T00:01:00Z'};
  await f.browser.open('member','child');assert(f.ids['node-body'].textContent.includes('Fixture host unavailable'));assert(f.ids['node-body'].textContent.includes('Saved actual page fixture'));assert(f.ids['node-body'].textContent.includes('已同步 1 条可见消息'));
});
