import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
function fixture(t, { missingUi = false, automaticHistory = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-resource-regression-'));
  for (const name of ['src', 'ui']) cpSync(join(root, name), join(dir, name), { recursive: true });
  if (missingUi) rmSync(join(dir, 'ui'), { recursive: true });
  const child = spawn(process.execPath, [join(dir, 'src/server.mjs')], {
    cwd: dir, env: { ...process.env, TEAM_WORKBENCH_DATA: join(dir, 'isolated-data'),...(automaticHistory?{PLUGIN_DATA:join(dir,'isolated-plugin-data')}:{}) },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let next = 0, stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  createInterface({ input: child.stdout }).on('line', line => {
    const response = JSON.parse(line), waiter = pending.get(response.id);
    if (waiter) { clearTimeout(waiter.timer); pending.delete(response.id); waiter.resolve(response); }
  });
  const ended = new Promise(resolve => child.on('exit', resolve));
  t.after(async () => {
    child.stdin.end(); await ended;
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    assert(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
    assert.equal(stderr, '');
  });
  return { dir, request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP resource response timeout')); }, 3000);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }};
}
async function initialize(c) {
  return c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'isolated-resource-regression', version: '1' } });
}
const resource = c => c.request('resources/read', { uri: 'ui://team-workbench/panel' });

test('inline history cards preserve fullscreen support and the manual thread entrypoint', async t => {
  const c = fixture(t); await initialize(c);
  const tool = (await c.request('tools/list')).result.tools.find(tool => tool.name === 'team_panel');
  assert.deepEqual(tool._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
  const uris = [tool._meta.ui.resourceUri, 'ui://team-workbench/panel',
    'ui://team-workbench/panel/0.5.1', 'ui://team-workbench/panel/0.5.2', tool._meta.ui.resourceUri];
  for (const uri of uris) {
    const response = await c.request('resources/read', { uri });
    assert.equal(response.error, undefined);
    const content = response.result.contents[0];
    assert.equal(content.uri, uri);
    assert.equal(content.mimeType, 'text/html;profile=mcp-app');
    assert.equal(content._meta['openai/ui'].preferredDisplayMode, 'inline',
      'remounted tool-result cards must not request fullscreen as their initial mode');
    assert(content._meta['openai/ui'].availableDisplayModes.includes('fullscreen'),
      'explicit thread entrypoint must retain fullscreen support');
    assert(content._meta['openai/ui'].availableDisplayModes.includes('inline'));
    assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  }
  // The host invokes a thread entrypoint with {} and chooses fullscreen itself.
  const opened = await c.request('tools/call', { name: 'team_panel', arguments: {} });
  assert.equal(opened.result.isError, undefined);
  assert.deepEqual(opened.result.structuredContent.boards, [],
    'resource reads and opening an empty entrypoint must not create workbench data');
});

test('a running MCP connection retains its complete UI after an upgrade prunes its old UI directory', async t => {
  const c = fixture(t); await initialize(c);
  const before = (await resource(c)).result.contents[0];
  assert(before.text.includes('请求主会话关联并同步'));
  assert(!before.text.includes('/* APP_JS */'));
  for(const version of ['0.4.2','0.5.1','0.5.2']){
    const oldUri=`ui://team-workbench/panel/${version}`;
    const alias=await c.request('resources/read',{uri:oldUri});
    assert.equal(alias.result.contents[0].uri,oldUri);assert.equal(alias.result.contents[0].text,before.text);
  }
  assert.equal((await c.request('resources/read',{uri:'ui://unrelated/panel/0.5.1'})).error.code,-32002);
  rmSync(join(c.dir, 'ui'), { recursive: true }); // Only this isolated fixture.
  const after = await resource(c);
  assert.equal(after.result.contents[0].text, before.text);
  assert.equal(after.result.contents[0].mimeType, 'text/html;profile=mcp-app');
});

test('missing UI files return an error with the original request ID while task tools remain usable', async t => {
  const c = fixture(t, { missingUi: true }); await initialize(c);
  const response = await resource(c);
  assert.equal(typeof response.id, 'number');
  assert.equal(response.error.code, -32001);
  assert(response.error.message.includes('Reload the plugin connection'));
  const data = await c.request('tools/call', { name: 'team_snapshot', arguments: {} });
  assert.equal(data.result.isError, undefined);
  assert(Array.isArray(data.result.structuredContent.boards));
});

class Element {
  constructor(tag = 'div', text = '') { this.tagName = tag; this.children = []; this.attributes = {}; this.open = false; this.hidden = false; this._text = text; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = [...nodes]; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener() {}
  close() { this.open = false; }
  showModal() { this.open = true; }
}

test('the actual resources/read HTML boots through ui/initialize and tools/call with all bundled scripts', async t => {
  const c = fixture(t,{automaticHistory:true}); await initialize(c);
  const discovery = (await c.request('tools/list')).result.tools.find(tool => tool.name === 'team_panel');
  const uri = discovery._meta.ui.resourceUri;
  assert.equal(uri, 'ui://team-workbench/panel/0.5.3');
  const legacy = await resource(c);
  assert.equal(legacy.result.contents[0].uri, 'ui://team-workbench/panel');
  const board = (await c.request('tools/call', { name: 'team_create_board', arguments: { title: 'Full resource fixture' } })).result.structuredContent.board;
  await c.request('tools/call', { name: 'team_create_task', arguments: { boardId: board.id, title: 'Resource fixture task' } });
  const html = (await c.request('resources/read', { uri })).result.contents[0].text;
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.equal(scripts.length, 1);
  const ids = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  ids['editor-form'].append(ids['editor-fields']);
  const document = { hidden: false, documentElement: { dataset: { preview: 'false' }, style: { setProperty() {} } },
    getElementById: id => ids[id], createElement: tag => new Element(tag) };
  let listener, settle, reject, holdSnapshot=false, releaseSnapshot, failSnapshot=false;
  const completed = new Promise((yes, no) => { settle = yes; reject = no; });
  const methods = [];
  const window = { addEventListener(type, fn) { if (type === 'message') listener = fn; } };
  window.parent = { postMessage(message) {
    if (!message.id) return;
    methods.push(message.method);
    (async () => {
      const isSnapshot=message.method==='tools/call' && message.params.name==='team_snapshot';
      if(isSnapshot && holdSnapshot)await new Promise(resolve=>{releaseSnapshot=resolve;});
      const result = isSnapshot && failSnapshot ? {isError:true,structuredContent:{error:{code:'TEST_FAILURE',message:'Fixture refresh failed'}}}
        : message.method === 'ui/initialize'
        ? { hostCapabilities: { serverTools: {}, message:{text:{}}, experimental:{'openai/message':{}} }, hostContext: {}, hostInfo: { name: 'Deterministic fixture' } }
        : message.method==='ui/message' ? {}
        : (await c.request(message.method, { ...message.params, arguments: { ...message.params.arguments, ...(['team_snapshot','team_panel'].includes(message.params.name)?{boardId:message.params.arguments.boardId ?? board.id}:{}) } })).result;
      listener({ source: window.parent, data: { jsonrpc: '2.0', id: message.id, result } });
      if (message.method === 'tools/call') setImmediate(settle);
    })().catch(reject);
  }};
  const context = { document, window, Option: class extends Element { constructor(text, value) { super('option', text); this.value = value; } },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, console, FormData: class {
      constructor(form) {const all=n=>[n,...n.children.flatMap(all)];this.values=new Map(all(form).filter(n=>n.name && (n.type!=='checkbox'||n.checked)).map(n=>[n.name,n.type==='checkbox'?'on':n.value]));}
      get(name) {return this.values.get(name) ?? null;}
      getAll(name) {return this.values.has(name)?[this.values.get(name)]:[];}
    } };
  vm.runInNewContext(scripts[0], context, { filename: 'actual-mcp-resource.js', timeout: 1000 });
  await completed;
  assert.deepEqual(methods, ['ui/initialize', 'tools/call']);
  assert.equal(ids['board-title'].textContent, 'Full resource fixture');
  assert.equal(ids['stat-total'].textContent, '1');
  assert(ids['task-list'].textContent.includes('Resource fixture task'));
  assert.equal(ids['error'].hidden, true);
  const walk=n=>[n,...n.children.flatMap(walk)];
  await ids['refresh'].onclick();
  assert(ids['refresh-status'].textContent.includes('数据未变化'));
  await c.request('tools/call',{name:'team_create_task',arguments:{boardId:board.id,title:'External refresh change'}});
  await ids['refresh'].onclick();
  assert(ids['refresh-status'].textContent.includes('数据已更新'));assert.equal(ids['stat-total'].textContent,'2');
  holdSnapshot=true;const count=methods.length,pendingRefresh=ids['refresh'].onclick();
  assert.equal(ids['refresh'].disabled,true);assert(ids['refresh-status'].textContent.includes('正在刷新'));
  await ids['refresh'].onclick();assert.equal(methods.length,count+1);
  holdSnapshot=false;releaseSnapshot();await pendingRefresh;assert.equal(ids['refresh'].disabled,false);
  const leadCard=walk(ids['team-map']).find(n=>n.attributes['aria-label']==='查看成员：协调者');await leadCard.onclick();
  await c.request('tools/call',{name:'team_append_record',arguments:{boardId:board.id,nodeKind:'member',nodeId:'lead',recordId:'refresh-new-record',role:'note',text:'New saved node record',evidence:'Isolated stdio refresh regression'}});
  await ids['refresh'].onclick();assert(ids['node-body'].textContent.includes('New saved node record'));assert(ids['refresh-status'].textContent.includes('数据已更新'));
  ids['close-node'].onclick();failSnapshot=true;await ids['refresh'].onclick();
  assert(ids['refresh-status'].textContent.includes('刷新失败'));assert(ids['error'].textContent.includes('Fixture refresh failed'));assert.equal(ids['refresh'].disabled,false);
  failSnapshot=false;

  // Exercise the actual bundled UI handlers against a real isolated stdio MCP.
  // The host frame is a protocol fixture, never a real Desktop acceptance claim.
  const submit=()=>ids['editor-form'].onsubmit({preventDefault(){}});
  const fieldByName=name=>walk(ids['editor-fields']).find(n=>n.name===name);
  const clickDetail=label=>walk(ids['detail-body']).find(n=>n.tagName==='button'&&n.textContent===label).onclick();
  const openTask=title=>walk(ids['task-list']).find(n=>n.className?.includes('task-row')&&n.textContent.includes(title)).onclick();
  ids['new-task'].onclick();fieldByName('title').value='Direct CRUD fixture';fieldByName('description').value='PRIVATE_TASK_INSTRUCTIONS_FIXTURE';await submit();
  let saved=(await c.request('tools/call',{name:'team_snapshot',arguments:{boardId:board.id}})).result.structuredContent.board;
  assert(saved.tasks.some(t=>t.title==='Direct CRUD fixture'));
  openTask('Direct CRUD fixture');await clickDetail('由协调者领取');await clickDetail('释放任务');await clickDetail('由协调者领取');await clickDetail('标记完成');await clickDetail('重新打开');
  await clickDetail('编辑');fieldByName('title').value='Edited direct CRUD fixture';await submit();
  openTask('Edited direct CRUD fixture');await clickDetail('转派');fieldByName('ownerId').value='lead';await submit();
  openTask('Edited direct CRUD fixture');await clickDetail('释放任务');await clickDetail('编辑依赖');await submit();
  saved=(await c.request('tools/call',{name:'team_snapshot',arguments:{boardId:board.id}})).result.structuredContent.board;
  const target=saved.tasks.find(t=>t.title==='Edited direct CRUD fixture');assert.equal(target.status,'pending');assert.deepEqual(target.blockedBy,[]);
  const beforeCancel=methods.length;ids['new-task'].onclick();ids['cancel-editor'].onclick();assert.equal(methods.length,beforeCancel);
  assert.equal(methods.filter(m=>m==='ui/message').length,0,'CRUD, saved refresh, opening details and cancel do not message the lead');
  openTask('Edited direct CRUD fixture');
  const execution=walk(ids['detail-body']).find(n=>n.tagName==='button'&&n.textContent==='请求执行（主会话）');
  assert(execution);assert.equal(execution.disabled,false);assert(ids['detail-body'].textContent.includes('消息只携带请求标识'));
  const pending=execution.onclick();await execution.onclick();await pending;
  assert.equal(methods.filter(m=>m==='ui/message').length,1,'Only the explicit execution button sends one compact request');
  saved=(await c.request('tools/call',{name:'team_snapshot',arguments:{boardId:board.id}})).result.structuredContent.board;
  assert.equal(saved.runs.filter(r=>r.taskId===target.id).length,1);
  assert.equal(saved.runs.find(r=>r.taskId===target.id).instructions,'PRIVATE_TASK_INSTRUCTIONS_FIXTURE');
  ids['close-detail'].onclick();

  ids['bind-session'].onclick();
  const field=walk(ids['editor-fields']).find(n=>n.name==='sessionId');
  assert.notEqual(field.readOnly,true);field.value='00000000-0000-4000-8000-000000009001';
  await ids['editor-form'].onsubmit({preventDefault(){}});
  assert.equal(ids['editor'].open,true);assert(ids['editor-fields'].textContent.includes('新绑定'));
  assert.equal((await c.request('tools/call',{name:'team_snapshot',arguments:{boardId:board.id}})).result.structuredContent.board.rootSessionId,null);
  walk(ids['editor-fields']).find(n=>n.name==='confirmed').checked=true;
  await ids['editor-form'].onsubmit({preventDefault(){}});
  assert.equal((await c.request('tools/call',{name:'team_snapshot',arguments:{boardId:board.id}})).result.structuredContent.board.rootSessionId,field.value);
  if(process.platform==='win32'){
    assert.equal(ids['auto-history'].disabled,false);ids['auto-history'].onclick();
    await submit();assert.equal(ids['editor'].open,true);assert(ids['form-error'].textContent.includes('确认'));
    assert.equal((await c.request('tools/call',{name:'team_snapshot',arguments:{boardId:board.id}})).result.structuredContent.board.nativeHistorySync,undefined);
    fieldByName('confirmed').checked=true;await submit();assert(ids['auto-history'].textContent.includes('开'));
    ids['auto-history'].onclick();fieldByName('confirmed').checked=true;await submit();assert(ids['auto-history'].textContent.includes('关'));
    assert.equal(methods.filter(m=>m==='ui/message').length,1,'Automatic-sync configuration uses MCP and requires no main-chat request');
  }else assert.equal(ids['auto-history'].disabled,true);
  ids['archive-board'].onclick();
  assert(ids['editor-fields'].textContent.includes('不会删除项目文件'));
  walk(ids['editor-fields']).find(n=>n.name==='confirmed').checked=true;
  await ids['editor-form'].onsubmit({preventDefault(){}});
  assert.equal(ids['workspace'].hidden,true);assert(ids['archived-boards'].textContent.includes('1'));
  ids['archived-boards'].onclick();walk(ids['editor-fields']).find(n=>n.name==='confirmed').checked=true;await submit();
  assert.equal(ids['workspace'].hidden,false);assert.equal(methods.filter(m=>m==='ui/message').length,1);
  ids['new-board'].onclick();fieldByName('title').value='Another direct board fixture';await submit();
  assert.equal(ids['board-title'].textContent,'Another direct board fixture');assert.equal(methods.filter(m=>m==='ui/message').length,1);
});
