import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { startPreview } from '../src/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function client(dir) {
  const child = spawn(process.execPath, ['src/server.mjs'], { cwd: root,
    env: { ...process.env, TEAM_WORKBENCH_DATA: dir }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, stderr = ''; const pending = new Map();
  child.stderr.on('data', d => { stderr += d; });
  createInterface({ input: child.stdout }).on('line', line => {
    const response = JSON.parse(line); const waiter = pending.get(response.id);
    if (waiter) { clearTimeout(waiter.timer); pending.delete(response.id); waiter.resolve(response); }
  });
  const ended = new Promise(resolve => child.on('exit', resolve));
  return {
    request(method, params = {}) { return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error('MCP timeout: ' + stderr)), 8000);
      pending.set(requestId, { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    }); },
    async close() { child.stdin.end(); await ended; assert.equal(stderr, ''); },
    async tool(name, args) { return (await this.request('tools/call', { name, arguments: args })).result; }
  };
}
test('actual stdio process: discovery, app resource, real tool calls and restart persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-workbench-protocol-'));
  let c = client(dir);
  try {
    const init = await c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'team-workbench');
    const list = (await c.request('tools/list')).result.tools;
    assert.equal(list.length, 16);
    for (const name of ['team_record_workflow', 'team_append_record', 'team_read_records', 'team_import_thread_page', 'team_bind_agent_activity']) assert(list.some(t => t.name === name));
    assert.deepEqual(list[0]._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
    const resource = await c.request('resources/read', { uri: 'ui://team-workbench/panel' });
    assert.equal(resource.result.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert(resource.result.contents[0].text.includes('ui/initialize'));
    assert(resource.result.contents[0].text.includes('class WorkbenchBrowser'));
    assert(resource.result.contents[0].text.includes('browse-branch-head'));
    assert(!resource.result.contents[0].text.includes('/* APP_JS */'));
    const board = (await c.tool('team_create_board', { title: 'Persisted board' })).structuredContent.board;
    const associated = await c.request('tools/call', { name: 'team_panel', arguments: { boardId: board.id }, _meta: { 'openai/session': 'anonymous-fixture-only' } });
    assert.equal(associated.result.structuredContent.conversationAssociation, 'anonymous-host-session');
    const selected = await c.request('tools/call', { name: 'team_panel', arguments: {}, _meta: { 'openai/session': 'anonymous-fixture-only' } });
    assert.equal(selected.result.structuredContent.board.id, board.id);
    const isolated = await c.request('tools/call', { name: 'team_panel', arguments: {}, _meta: { 'openai/session': 'different-anonymous-fixture' } });
    assert.equal(isolated.result.structuredContent.board, null);
    const result = await c.tool('team_create_task', { boardId: board.id, title: 'Real task' });
    assert.equal(result.structuredContent.board.tasks[0].title, 'Real task');
    assert.equal((await c.request('unrecognized')).error.code, -32601);
    assert.equal((await c.tool('team_create_task', { boardId: board.id, title: '' })).isError, true);
    await c.close(); c = client(dir);
    const saved = await c.tool('team_snapshot', { boardId: board.id });
    assert.equal(saved.structuredContent.board.tasks.length, 1);
    await c.close(); c = null;
  } finally { if (c) await c.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('two independent MCP processes cannot both claim the same revision', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-workbench-race-'));
  const first = client(dir), second = client(dir);
  try {
    const b = (await first.tool('team_create_board', { title: 'Concurrent board' })).structuredContent.board;
    await first.tool('team_create_task', { boardId: b.id, title: 'One claim only' });
    const args = { boardId: b.id, taskId: 'task-1', expectedRevision: 1, actorId: 'lead', action: 'claim' };
    const results = await Promise.all([first.tool('team_update_task', args), second.tool('team_update_task', args)]);
    assert.equal(results.filter(r => !r.isError).length, 1);
    assert.equal(results.find(r => r.isError).structuredContent.error.code, 'STALE_REVISION');
  } finally { await first.close(); await second.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('actual hook command ignores transcript/content and returns non-blocking JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-workbench-hook-'));
  const store = new Store(dir), b = store.create('Hook fixture'); store.bind(b.id, '00000000-0000-4000-8000-000000000077', 1);
  try {
    const child = spawn(process.execPath, ['src/hook.mjs'], { cwd: root, windowsHide: true,
      env: { ...process.env, TEAM_WORKBENCH_DATA: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStop', session_id: '00000000-0000-4000-8000-000000000077', agent_id: 'fixture-agent', agent_type: 'worker', transcript_path: '/nonexistent-private-file', last_assistant_message: 'PRIVATE-FIXTURE' }));
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 0); assert.deepEqual(JSON.parse(stdout), {}); assert.equal(stderr, '');
    const observed = store.view(b.id); assert.equal(observed.members[1].status, 'stop_observed');
    assert(!JSON.stringify(observed).includes('PRIVATE-FIXTURE'));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('loopback preview: real writes, origin/token checks, and self-contained UI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-workbench-http-'));
  const preview = await startPreview({ directory: dir });
  try {
    const html = await (await fetch(preview.url)).text();
    const token = html.match(/'X-Workbench-Token': '([a-f0-9]+)'/)[1];
    const body = JSON.stringify({ name: 'team_create_board', arguments: { title: 'HTTP board' } });
    assert.equal((await fetch(preview.url + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(preview.url + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': token, Origin: 'https://untrusted.example' }, body })).status, 403);
    const result = await (await fetch(preview.url + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': token }, body })).json();
    assert.equal(result.structuredContent.board.title, 'HTTP board');
    assert.equal(preview.store.list().length, 1);
    assert.equal((await fetch(preview.url + '/private-file')).status, 404);
    assert(!html.includes('src="https://'));
  } finally { await preview.close(); rmSync(dir, { recursive: true, force: true }); }
});
