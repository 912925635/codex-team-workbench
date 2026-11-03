import { createInterface } from 'node:readline';
import { Store } from './store.mjs';
import { tools, callTool, UI_URI, LEGACY_UI_URI } from './tools.mjs';
import { appHtml, resourceMeta } from './ui-resource.mjs';

// Keep this connection's complete UI in memory. Plugin updates may prune the
// old version directory while an already connected stdio process is still alive.
let panelHtml, panelLoadError;
try { panelHtml = appHtml(); } catch (error) { panelLoadError = error; }

export function handle(store, message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  if (!Object.hasOwn(message, 'id')) return null;
  const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
  const error = (code, messageText) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: messageText } });
  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25'].includes(message.params?.protocolVersion)
        ? message.params.protocolVersion : '2025-11-25',
        serverInfo: { name: 'team-workbench', version: '0.5.2' },
        capabilities: { tools: {}, resources: {} },
        instructions: 'Use the team-workbench Skill for explicitly authorized native execution and exact source-labeled records. Ordinary panel CRUD, refresh and bound history reads call MCP directly and need no main-chat response. For protocolVersion 3 execution/continuation, first read only team_get_request using the exact board/request ID; do not load unrelated board/history. Native spawn/continuation still uses actual spawning-lead collaboration tools, never a separate app-server team or direct V2 input. Public history is bounded and parent-verified; optional explicitly labeled lead-assisted identity/history requests may use actual available host tools. Never substitute another parent/child, infer a UUID, or promote a link/message acknowledgment to visual success.' });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools });
    case 'tools/call':
      if (!message.params || typeof message.params.name !== 'string') return error(-32602, 'Tool name required');
      return reply(callTool(store, message.params.name, message.params.arguments ?? {},
        { anonymousSession: message.params._meta?.['openai/session'] }));
    case 'resources/list': return reply({ resources: [{ uri: UI_URI, name: 'Team Workbench', mimeType: 'text/html;profile=mcp-app' }] });
    case 'resources/read':
      // Cached tool metadata may name an older version while a new server is
      // connected. All versioned aliases resolve to THIS connection's cached UI.
      if (![UI_URI, LEGACY_UI_URI].includes(message.params?.uri) && !/^ui:\/\/team-workbench\/panel\/\d+\.\d+\.\d+$/.test(message.params?.uri ?? '')) return error(-32002, 'Resource not found');
      if (panelLoadError) return error(-32001, 'Team Workbench UI assets are unavailable for this connection. Reload the plugin connection; task data is retained.');
      return reply({ contents: [{ uri: message.params.uri, mimeType: 'text/html;profile=mcp-app', text: panelHtml, _meta: resourceMeta }] });
    default: return error(-32601, 'Method not found');
  }
}
const store = new Store();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    const response = handle(store, message);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  } catch (e) {
    const parse = e instanceof SyntaxError;
    if (!parse) console.error('[team-workbench] request failed:', e.message);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null,
      error: { code: parse ? -32700 : -32603, message: parse ? 'Parse error' : 'Internal error' } }) + '\n');
  }
});
lines.on('close', () => store.close());
