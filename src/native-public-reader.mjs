// Standalone, cached Node helper for documented read-only RPCs over the existing
// local app-server WebSocket. No Codex process, network listener or session files.
import { request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { statSync } from 'node:fs';
import { isUtf8 } from 'node:buffer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE = 1048576;
const failure = (code, message) => Object.assign(new Error(message), { code });
export function controlSocketPath({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const base = env.CODEX_HOME || paths.join(home, '.codex');
  if (!paths.isAbsolute(base)) throw failure('INVALID_CODEX_HOME', 'CODEX_HOME must be an absolute path');
  return paths.join(base, 'app-server-control', 'app-server-control.sock');
}

export function probePublicSocket(options = {}) {
  try {
    const socket = controlSocketPath(options);
    if (!(options.stat ?? statSync)(socket).isSocket())
      return { available: false, code: 'PUBLIC_SOCKET_NOT_SOCKET', message: '公开控制路径存在，但不是 Unix socket。' };
    return { available: true, code: 'PUBLIC_SOCKET_PRESENT', message: 'Unix socket 已存在；RPC 能力与线程权限将在读取时验证。', connectionVerified: false };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      return { available: false, code: 'PUBLIC_SOCKET_MISSING', message: '此后端用户的 CODEX_HOME 下没有可用的 app-server-control socket。服务器需已有同用户的原生宿主；插件不会另启 Codex。' };
    if (error.code === 'EACCES' || error.code === 'EPERM')
      return { available: false, code: 'PUBLIC_SOCKET_PERMISSION', message: '当前后端用户无权访问原生控制 socket；未修改权限或尝试绕过。' };
    return { available: false, code: 'PUBLIC_SOCKET_UNAVAILABLE', message: '无法检查公开控制 socket；请核对后端的 CODEX_HOME 和运行用户。' };
  }
}

function validateRequest(input) {
  const keys = ['threadIds', 'mode', 'rootThreadId', 'cursor', 'runtimeRef'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))
    || !Array.isArray(input.threadIds) || !input.threadIds.length || input.threadIds.length > 100
    || !input.threadIds.every(id => typeof id === 'string' && UUID.test(id)) || new Set(input.threadIds).size !== input.threadIds.length)
    throw failure('INVALID_PUBLIC_SCOPE', 'Invalid exact-thread public read scope');
  const mode = input.mode ?? 'metadata';
  if (!['metadata', 'history'].includes(mode)) throw failure('INVALID_PUBLIC_SCOPE', 'Unsupported public read operation');
  if (mode === 'history' && (typeof input.rootThreadId !== 'string' || !UUID.test(input.rootThreadId) || !input.threadIds.includes(input.rootThreadId)))
    throw failure('INVALID_PUBLIC_SCOPE', 'History requires an exact bound root in the requested metadata scope');
  if (input.cursor != null && (typeof input.cursor !== 'string' || input.cursor.length > 4096))
    throw failure('INVALID_PUBLIC_SCOPE', 'Invalid history page cursor');
  if (input.runtimeRef != null && (typeof input.runtimeRef !== 'string' || input.runtimeRef.length > 300))
    throw failure('INVALID_PUBLIC_SCOPE', 'Invalid recorded runtime reference');
  return { ...input, mode };
}

function maskedFrame(opcode, bytes) {
  const header = Buffer.alloc(bytes.length < 126 ? 6 : 8), mask = randomBytes(4);
  header[0] = 0x80 | opcode;
  if (bytes.length < 126) { header[1] = 0x80 | bytes.length; mask.copy(header, 2); }
  else { header[1] = 0x80 | 126; header.writeUInt16BE(bytes.length, 2); mask.copy(header, 4); }
  const payload = Buffer.from(bytes); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return Buffer.concat([header, payload]);
}

function openPublicSocket(socketPath, { signal, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let socket, buffer = Buffer.alloc(0), fragments = null, fragmentBytes = 0, messages = 0, frames = 0, ended = false, upgraded = false;
    const pending = new Map(), key = randomBytes(16).toString('base64');
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const req = httpRequest({ socketPath, path: '/', method: 'GET', host: 'localhost', maxHeaderSize: 8192,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    const finish = error => {
      if (ended) return; ended = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      req.destroy(); socket?.destroy(); for (const waiter of pending.values()) waiter.reject(error); pending.clear();
      if (!upgraded) reject(error);
    };
    const abort = () => finish(failure('PUBLIC_READ_CANCELLED', 'Public history read cancelled'));
    const timer = setTimeout(() => finish(failure('PUBLIC_READ_TIMEOUT', 'Public app-server read timed out')), timeoutMs);
    const transportError = error => finish(failure(error.code === 'EACCES' || error.code === 'EPERM' ? 'PUBLIC_SOCKET_PERMISSION' : 'PUBLIC_SOCKET_UNAVAILABLE',
      `Public app-server socket unavailable (${['EACCES','EPERM','ENOENT','ECONNREFUSED','ECONNRESET'].includes(error.code) ? error.code : 'transport error'})`));
    const textMessage = bytes => {
      if (++messages > 1000 || !isUtf8(bytes)) throw failure('PUBLIC_PROTOCOL_INVALID', 'Invalid or excessive public WebSocket messages');
      let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { throw failure('PUBLIC_PROTOCOL_INVALID', 'Invalid public JSON response'); }
      const waiter = pending.get(value?.id);
      if (!waiter) return; // Discard notifications/unrequested responses without retaining their content.
      pending.delete(value.id);
      if (value.error) waiter.reject(failure('PUBLIC_RPC_ERROR', `Public ${waiter.method} RPC error ${Number.isInteger(value.error.code) ? value.error.code : 'unknown'}`));
      else if (Object.hasOwn(value, 'result')) waiter.resolve(value.result);
      else waiter.reject(failure('PUBLIC_PROTOCOL_INVALID', 'Public RPC response has no result'));
    };
    const consume = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const a = buffer[0], b = buffer[1], fin = !!(a & 128), opcode = a & 15; let length = b & 127, offset = 2;
        if (a & 112 || b & 128 || ![0,1,8,9,10].includes(opcode)) throw failure('PUBLIC_PROTOCOL_INVALID', 'Unsupported public WebSocket frame');
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (buffer.length < 10) return; const n = buffer.readBigUInt64BE(2); if (n > BigInt(MAX_MESSAGE)) throw failure('PUBLIC_PAGE_TOO_LARGE', 'Public message exceeds 1 MiB'); length = Number(n); offset = 10; }
        if (length > MAX_MESSAGE || opcode < 8 && fragmentBytes + length > MAX_MESSAGE) throw failure('PUBLIC_PAGE_TOO_LARGE', 'Public message exceeds 1 MiB');
        if (opcode >= 8 && (!fin || length > 125)) throw failure('PUBLIC_PROTOCOL_INVALID', 'Invalid public control frame');
        if (buffer.length < offset + length) return;
        if (++frames > 4096) throw failure('PUBLIC_PROTOCOL_INVALID', 'Excessive public WebSocket fragments');
        const payload = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length);
        if (opcode === 8) { finish(failure('PUBLIC_SOCKET_CLOSED', 'Public app-server closed the read connection')); return; }
        if (opcode === 9) { socket.write(maskedFrame(10, payload)); continue; }
        if (opcode === 10) continue;
        if (opcode === 1) { if (fragments) throw failure('PUBLIC_PROTOCOL_INVALID', 'Overlapping public messages'); fragments = []; fragmentBytes = 0; }
        else if (!fragments) throw failure('PUBLIC_PROTOCOL_INVALID', 'Unexpected public continuation frame');
        fragments.push(payload); fragmentBytes += payload.length;
        if (fin) { const bytes = Buffer.concat(fragments); fragments = null; fragmentBytes = 0; textMessage(bytes); }
      }
    };
    req.on('upgrade', (res, stream, head) => {
      socket = stream;
      if (res.headers['sec-websocket-accept'] !== accept || res.headers.upgrade?.toLowerCase() !== 'websocket') {
        finish(failure('PUBLIC_UPGRADE_REJECTED', 'Public WebSocket handshake rejected')); return;
      }
      upgraded = true;
      socket.on('error', transportError);
      socket.on('close', () => finish(failure('PUBLIC_SOCKET_CLOSED', 'Public app-server closed the read connection')));
      socket.on('data', chunk => { try { consume(chunk); } catch (error) { finish(error); } });
      let next = 1;
      resolve({
        request(method, params) {
          if (ended) return Promise.reject(failure('PUBLIC_SOCKET_CLOSED', 'Public read connection is closed'));
          return new Promise((yes, no) => { const id = next++; pending.set(id, { resolve: yes, reject: no, method }); socket.write(maskedFrame(1, Buffer.from(JSON.stringify({ id, method, params })))); });
        },
        initialized() { socket.write(maskedFrame(1, Buffer.from(JSON.stringify({ method: 'initialized', params: {} })))); },
        close() { finish(failure('PUBLIC_READ_CLOSED', 'Public read connection closed')); }
      });
      if (head.length) { try { consume(head); } catch (error) { finish(error); } }
    });
    req.on('response', res => { res.resume(); finish(failure('PUBLIC_UPGRADE_REJECTED', `Public WebSocket upgrade rejected (HTTP ${res.statusCode})`)); });
    req.on('error', transportError);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else req.end();
  });
}

function metadata(thread, expected) {
  if (!thread || thread.id !== expected) throw failure('PUBLIC_ID_MISMATCH', 'Public thread/read identity mismatch');
  const row = { id: expected };
  if (typeof thread.parentThreadId === 'string') row.parentThreadId = thread.parentThreadId;
  const source = thread.source?.subAgent?.thread_spawn;
  if (source && typeof source === 'object') {
    const spawn = {};
    for (const key of ['parent_thread_id', 'agent_path']) if (typeof source[key] === 'string') spawn[key] = source[key];
    row.source = { subAgent: { thread_spawn: spawn } };
  }
  return row;
}

function visiblePage(data) {
  if (!data || !Array.isArray(data.data) || data.data.length > 1) throw failure('PUBLIC_PROTOCOL_INVALID', 'Expected at most one public history turn');
  const nextCursor = data.nextCursor ?? null;
  if (nextCursor !== null && (typeof nextCursor !== 'string' || nextCursor.length > 4096)) throw failure('PUBLIC_PROTOCOL_INVALID', 'Invalid public page cursor');
  let truncated = false, omittedItems = 0, budget = 8000;
  const turns = data.data.map(turn => {
    if (typeof turn.id !== 'string' || !turn.id || typeof turn.status !== 'string' || !Array.isArray(turn.items)) throw failure('PUBLIC_PROTOCOL_INVALID', 'Invalid public history turn');
    const items = [];
    for (const item of turn.items) {
      if (!['userMessage', 'agentMessage'].includes(item?.type)) { omittedItems++; continue; }
      if (items.length >= 20 || budget <= 0) { truncated = true; omittedItems++; continue; }
      let body = typeof item.text === 'string' ? item.text : item.type === 'userMessage' && Array.isArray(item.content)
        ? item.content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';
      if (!body.trim() || typeof item.id !== 'string' || !item.id) { omittedItems++; continue; }
      const max = Math.min(1000, budget); if (body.length > max) { body = body.slice(0, max); truncated = true; }
      budget -= body.length; items.push({ id: item.id, type: item.type, text: body });
    }
    return { id: turn.id, status: turn.status, items };
  });
  return { turns, nextCursor, truncated, omittedItems };
}

export async function readPublicRequest(input, options = {}) {
  const request = validateRequest(input), socket = await openPublicSocket(options.socketPath ?? controlSocketPath(), options);
  try {
    await socket.request('initialize', { clientInfo: { name: 'team_workbench_readonly', version: '0.5.4' } });
    socket.initialized();
    const threads = [], rows = new Map();
    for (const id of request.threadIds) {
      let value;
      try { value = await socket.request('thread/read', { threadId: id, includeTurns: false }); }
      catch (error) { if (error.code !== 'PUBLIC_RPC_ERROR' || request.mode === 'history') throw error; threads.push({ id, metadataAvailable: false }); continue; }
      const row = metadata(value?.thread, id); rows.set(id, row); threads.push(row);
    }
    if (request.mode === 'metadata') return { connected: true, threads };
    const target = request.threadIds[0], seen = new Set(); let current = target;
    if (!rows.has(request.rootThreadId)) throw failure('PUBLIC_PARENT_UNVERIFIED', 'Bound root metadata unavailable');
    while (current !== request.rootThreadId) {
      const row = rows.get(current), spawn = row?.source?.subAgent?.thread_spawn;
      if (seen.has(current) || seen.size >= 100 || !row || !UUID.test(row.parentThreadId ?? '')) throw failure('PUBLIC_PARENT_UNVERIFIED', 'Exact bound parent chain unavailable');
      seen.add(current);
      if (spawn?.parent_thread_id && spawn.parent_thread_id !== row.parentThreadId) throw failure('PUBLIC_PARENT_UNVERIFIED', 'Conflicting public parent metadata');
      if (current === target && request.runtimeRef && spawn?.agent_path && spawn.agent_path !== request.runtimeRef) throw failure('PUBLIC_PARENT_UNVERIFIED', 'Recorded runtime path does not match public metadata');
      current = row.parentThreadId;
    }
    const params = { threadId: target, limit: 1, sortDirection: 'desc', itemsView: 'full' };
    if (request.cursor) params.cursor = request.cursor;
    const page = visiblePage(await socket.request('thread/turns/list', params));
    return { connected: true, threads, threadId: target, ...page, sourceTool: 'app-server.thread/turns/list' };
  } finally { socket.close(); }
}

export async function runPublicReadCli(options = {}) {
  try {
    let body = '', bytes = 0;
    for await (const part of process.stdin) { bytes += Buffer.byteLength(part); if (bytes > 65536) throw failure('INVALID_PUBLIC_SCOPE', 'Public read request exceeds limit'); body += part; }
    let input; try { input = JSON.parse(body); } catch { throw failure('INVALID_PUBLIC_SCOPE', 'Invalid public read request'); }
    process.stdout.write(JSON.stringify(await readPublicRequest(input, options)));
  } catch (error) {
    const known = typeof error.code === 'string' && /^(?:PUBLIC_|INVALID_)/.test(error.code);
    process.stdout.write(JSON.stringify({ connected: false, error: known ? error.code : 'PUBLIC_READ_UNAVAILABLE', message: known ? error.message : 'Public app-server read unavailable' }));
    process.exitCode = 1;
  }
}
