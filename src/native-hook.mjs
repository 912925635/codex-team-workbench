import { Store, dataDirectory } from './store.mjs';
import { recordEvent } from '../examples/native-events/probe.mjs';
// Packaged hook. Observes only sessions explicitly bound to active workbenches.
// No transcripts, prompts, messages, tool payloads or host session stores.
try {
  let body = '', bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1048576) throw new Error('Event too large');
    body += chunk;
  }
  // Hook execution remains metadata-only; history jobs belong to the long-lived
  // MCP backend, never to a lifecycle callback command.
  const raw = JSON.parse(body), store = new Store(dataDirectory(),{autoHistory:false});
  let sessionIds;
  try { sessionIds = store.list().map(b => b.rootSessionId).filter(id => typeof id === 'string'); }
  finally { store.close(); }
  // Validate only the matched root; no unrelated session is persisted.
  if (sessionIds.includes(raw.session_id)) recordEvent({ sessionIds: [raw.session_id], dataDirectory: dataDirectory() }, raw);
} catch { process.stderr.write('[team-workbench] Native lifecycle observation skipped.\n'); }
process.stdout.write('{}\n');
