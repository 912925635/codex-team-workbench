import { Store } from './store.mjs';
// Command hook entrypoint. Intentionally never reads transcript paths, cwd,
// prompts, last_assistant_message, tool inputs, or private session storage.
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1048576) throw new Error('Event too large');
  }
  const raw = JSON.parse(input);
  const event = { hook_event_name: raw.hook_event_name, session_id: raw.session_id,
    agent_id: raw.agent_id, agent_type: raw.agent_type };
  const store = new Store();
  try { store.observeHook(event); } finally { store.close(); }
} catch {
  console.error('[team-workbench] Observation skipped; agent execution continues.');
}
// Valid JSON required for Stop/SubagentStop; never blocks or steers the model.
process.stdout.write('{}\n');
