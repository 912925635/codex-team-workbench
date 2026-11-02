import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));

// Uses this plugin's actual stdio transport. Never launches Codex or a model.
export async function withClient(directory, operation) {
  if (!directory) throw new Error('An explicit plugin-owned data directory is required');
  const child = spawn(process.execPath, ['src/server.mjs'], { cwd: project, windowsHide: true,
    env: { ...process.env, TEAM_WORKBENCH_DATA: directory }, stdio: ['pipe', 'pipe', 'pipe'] });
  let serial = 0, stderr = ''; const pending = new Map();
  const finish = new Promise(resolve => child.once('exit', code => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(`MCP process exited (${code}): ${stderr}`)); }
    pending.clear(); resolve(code);
  }));
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const p = pending.get(response.id);
    if (!p) return; pending.delete(response.id); clearTimeout(p.timer);
    response.error ? p.reject(new Error(response.error.message)) : p.resolve(response.result);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP request timed out')); }, 10000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  child.on('error', error => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear();
  });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'team-workbench-cli', version: '0.4.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return await operation({ async call(name, args = {}) {
      const result = await request('tools/call', { name, arguments: args });
      if (result.isError) { const e = new Error(result.structuredContent?.error?.message ?? result.content?.[0]?.text); e.code = result.structuredContent?.error?.code; throw e; }
      return result.structuredContent;
    } });
  } finally { child.stdin.end(); await finish; lines.close(); }
}
