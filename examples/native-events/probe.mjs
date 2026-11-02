// Opt-in feasibility probe, not registered by any plugin manifest.
// Receives documented hook stdin. Never opens host transcripts or session stores.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_./:@-]{1,200}$/.test(value);
const events = new Set(['SubagentStart', 'SubagentStop', 'PreModelRequest']);

export function validateConfig(config) {
  if (!config || !Array.isArray(config.sessionIds) || config.sessionIds.length < 1 ||
      config.sessionIds.length > 10 || !config.sessionIds.every(id => typeof id === 'string' && uuid.test(id)) ||
      typeof config.dataDirectory !== 'string' || !isAbsolute(config.dataDirectory)) throw new Error('Invalid explicit probe configuration');
  return { sessionIds: [...new Set(config.sessionIds)], dataDirectory: config.dataDirectory };
}

export function sanitizeEvent(raw, config) {
  if (!raw || !events.has(raw.hook_event_name) || !config.sessionIds.includes(raw.session_id)) return null;
  if (raw.hook_event_name === 'PreModelRequest' && raw.agent_id == null) return null;
  if (!token(raw.agent_id) || (raw.turn_id != null && !token(raw.turn_id))) throw new Error('Invalid lifecycle identifiers');
  return { event: raw.hook_event_name, sessionId: raw.session_id, agentId: raw.agent_id,
    turnId: raw.turn_id ?? null, agentType: token(raw.agent_type) ? raw.agent_type : null };
}

export function recordEvent(configInput, raw, observedAt = new Date().toISOString()) {
  const config = validateConfig(configInput), event = sanitizeEvent(raw, config);
  // Unrelated events must not create a directory or database.
  if (!event) return { accepted: false };
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation time');
  mkdirSync(config.dataDirectory, { recursive: true });
  const db = new DatabaseSync(join(config.dataDirectory, 'native-events-probe.sqlite'));
  try {
    db.exec(`PRAGMA busy_timeout=1500; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,
        identity TEXT UNIQUE, payload TEXT NOT NULL, observed_at TEXT NOT NULL)`);
    // Without turn_id there is no reliable event identity: retain separate observations.
    const identity = event.turnId && event.event !== 'PreModelRequest' ? createHash('sha256').update(JSON.stringify([
      event.event, event.sessionId, event.agentId, event.turnId])).digest('hex') : null;
    const result = db.prepare('INSERT OR IGNORE INTO events(identity,payload,observed_at) VALUES (?,?,?)')
      .run(identity, JSON.stringify(event), observedAt);
    return { accepted: true, inserted: result.changes === 1 };
  } finally { db.close(); }
}

export function summarize(configInput) {
  const config = validateConfig(configInput);
  // A read-only open fails explicitly when no callback has created the probe DB.
  const db = new DatabaseSync(join(config.dataDirectory, 'native-events-probe.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT seq,payload,observed_at FROM events ORDER BY seq').all().map(row => ({
      ...JSON.parse(row.payload), observedAt: row.observed_at,
      observation: JSON.parse(row.payload).event === 'SubagentStop' ? 'stop-observed' : 'running-observed',
      source: 'command-hook-input', verification: 'local-input-not-attested'
    }));
  } finally { db.close(); }
}

export async function run(configPath, input = process.stdin, output = process.stdout, error = process.stderr) {
  let phase = 'entry', eventType = null;
  let matchedOnly = false, diagnosticAllowed = false;
  // This diagnostic records no session/agent IDs, prompts, paths or payloads.
  // Its location is beside the explicit probe config, never a host session store.
  const diagnostic = (stage, fields = {}) => {
    if (matchedOnly && !diagnosticAllowed) return;
    try {
      const path = join(dirname(resolve(configPath)), 'probe-diagnostics.jsonl');
      appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), eventType, stage, ...fields }) + '\n');
    } catch { /* Diagnostic failure must not change agent behavior. */ }
  };
  try {
    phase = 'config';
    const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    matchedOnly = rawConfig.diagnosticsOnlyForAllowedSession === true;
    const config = validateConfig(rawConfig);
    if (!matchedOnly) diagnostic('invoked');
    phase = 'stdin';
    let body = '', bytes = 0;
    for await (const chunk of input) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1048576) throw new Error('Hook input exceeds limit');
      body += chunk;
    }
    phase = 'parse';
    const raw = JSON.parse(body);
    eventType = events.has(raw?.hook_event_name) ? raw.hook_event_name : 'other';
    phase = 'filter';
    const accepted = sanitizeEvent(raw, config) !== null;
    diagnosticAllowed = accepted;
    if (matchedOnly && accepted) diagnostic('invoked');
    diagnostic('filtered', { accepted });
    phase = 'persist';
    const result = recordEvent(config, raw);
    diagnostic('finished', { accepted: result.accepted, inserted: result.inserted ?? false });
  } catch {
    diagnostic('failed', { phase });
    error.write('[team-workbench] Native event probe skipped; execution continues.\n');
  } finally {
    // No decision/context/prompt: never blocks, resumes, or steers the agent.
    output.write('{}\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--summary') {
    try { process.stdout.write(JSON.stringify(summarize(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2) + '\n'); }
    catch { process.stderr.write('No readable probe observations.\n'); process.exitCode = 1; }
  } else await run(process.argv[2]);
}
