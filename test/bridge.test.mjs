import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Protocol fixture only: this is NOT an integration test against ChatGPT Desktop.
function fixture(serverTools = {}, messaging = false, options = {}) {
  let listener; const requests = [], notifications = [];
  const parent = { postMessage(message) {
    if (!Object.hasOwn(message, 'id')) { notifications.push(message); return; }
    requests.push(message);
    const result = message.method === 'ui/initialize'
      ? { protocolVersion: '2026-01-26', hostCapabilities: { ...(serverTools === false ? {} : { serverTools }), ...(messaging ? { message: { text: {} }, experimental: { 'openai/message': {} } } : {}), ...(options.openLinks ? {openLinks:{}} : {}) }, hostContext: { theme: 'dark' }, hostInfo: { name: 'Protocol fixture', version: '1' } }
      : { content: [], structuredContent: { boards: [] } };
    queueMicrotask(() => listener({ source: parent, data: { jsonrpc: '2.0', id: message.id, ...(message.method==='ui/open-link' && options.linkError ? {error:options.linkError} : {result}) } }));
  } };
  const window = { parent, addEventListener(name, fn) { if (name === 'message') listener = fn; } };
  const context = vm.createContext({ window, document: { documentElement: { dataset: { preview: 'false' } } }, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(new URL('../ui/bridge.js', import.meta.url), 'utf8') + '\nthis.Bridge = WorkbenchBridge;', context);
  return { bridge: new context.Bridge(), requests, notifications,
    emit(data, source = parent) { listener({ source, data }); } };
}
test('MCP App handshake precedes tool calls; host context and notifications delivered', async () => {
  const f = fixture(); let theme; f.bridge.onContext = context => { theme = context.theme; };
  await f.bridge.connect();
  assert.equal(theme, 'dark'); assert.equal(f.requests[0].method, 'ui/initialize');
  assert.equal(f.requests[0].params.protocolVersion, '2026-01-26');
  assert.equal(f.notifications[0].method, 'ui/notifications/initialized');
  const result = await f.bridge.call('team_snapshot'); assert.equal(result.boards.length, 0);
  assert.equal(f.requests[1].method, 'tools/call');
  let delivered = false; f.bridge.onResult = () => { delivered = true; };
  f.emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} }, {});
  assert.equal(delivered, false, 'Unrelated windows cannot inject tool results');
  f.emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} });
  assert.equal(delivered, true);
});
test('missing serverTools capability prevents unsupported host calls', async () => {
  const f = fixture(false); await f.bridge.connect();
  await assert.rejects(() => f.bridge.call('team_snapshot'), /工具调用能力/);
  assert.equal(f.requests.length, 1);
});
test('execution request uses advertised active-conversation message extension, never arbitrary thread targeting', async () => {
  const f = fixture({}, true); await f.bridge.connect();
  assert.equal(f.bridge.canMessageLead(), true);
  await f.bridge.messageLead('Execute the explicitly requested task');
  const sent = f.requests[1]; assert.equal(sent.method, 'ui/message');
  assert.equal(sent.params._meta['openai/message'].target, 'active');
  assert.equal(sent.params._meta['openai/message'].send, true);
  assert.equal(sent.params.role, 'user');
  assert(!Object.hasOwn(sent.params, 'threadId'));
});
test('execution request never sends without advertised host messaging capability', async () => {
  const f = fixture(); await f.bridge.connect();
  assert.equal(f.bridge.canMessageLead(), false);
  await assert.rejects(() => f.bridge.messageLead('No host support'), /does not advertise/);
  assert.equal(f.requests.length, 1);
});

test('native link uses advertised openLinks and exact UUID without ui/message', async () => {
  const f=fixture({},false,{openLinks:true});await f.bridge.connect();
  const id='00000000-0000-4000-8000-000000000801';
  assert.equal(f.bridge.canOpenLinks(),true);
  const result=await f.bridge.openNativeThread(id);
  assert.equal(result.accepted,true);assert.equal(result.viewConfirmed,false);
  assert.equal(f.requests[1].method,'ui/open-link');
  assert.equal(f.requests[1].params.url,`codex://threads/${id}`);
  assert(!f.requests.some(r=>r.method==='ui/message'));
  await assert.rejects(()=>f.bridge.openNativeThread('/root/fixture'),/UUID/);
  assert.equal(f.requests.length,2);
});

test('missing capability and host link refusal fail explicitly without a messaging fallback', async () => {
  const missing=fixture();await missing.bridge.connect();
  await assert.rejects(()=>missing.bridge.openNativeThread('00000000-0000-4000-8000-000000000801'),/链接/);
  assert.equal(missing.requests.length,1);
  const denied=fixture({},true,{openLinks:true,linkError:{code:-32000,message:'Policy violation: codex scheme denied'}});
  await denied.bridge.connect();
  await assert.rejects(()=>denied.bridge.openNativeThread('00000000-0000-4000-8000-000000000801'),/Policy violation: codex scheme denied/);
  assert.equal(denied.requests.filter(r=>r.method==='ui/open-link').length,1);
  assert(!denied.requests.some(r=>r.method==='ui/message'));
});
