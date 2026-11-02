import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { recordEvent, summarize, validateConfig, run } from '../examples/native-events/probe.mjs';
import { windowsPowerShellCommand } from '../examples/native-events/windows-command.mjs';
const parent = '00000000-0000-4000-8000-000000000101';
const event = { hook_event_name: 'SubagentStart', session_id: parent, agent_id: '/root/probe', agent_type: 'worker', turn_id: 'turn-1' };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-events-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { sessionIds: [parent], dataDirectory: join(dir, 'isolated-probe') };
}

test('probe ignores unrelated sessions/events before creating any data', t => {
  const config = fixture(t);
  assert.deepEqual(recordEvent(config, { ...event, session_id: 'unrelated' }), { accepted: false });
  assert.deepEqual(recordEvent(config, { ...event, hook_event_name: 'PreToolUse' }), { accepted: false });
  assert.equal(existsSync(config.dataDirectory), false);
  assert.throws(() => validateConfig({ ...config, sessionIds: ['00000000'] }));
  assert.throws(() => validateConfig({ ...config, dataDirectory: './relative' }));
});

test('start/stop events persist across connections without guessed identities or success', t => {
  const config = fixture(t);
  recordEvent(config, event);
  recordEvent(config, { ...event, hook_event_name: 'SubagentStop' });
  const rows = summarize(config);
  assert.deepEqual(rows.map(row => row.observation), ['running-observed', 'stop-observed']);
  assert.equal(rows[0].agentId, '/root/probe');
  assert.equal(rows[0].nativeThreadId, undefined);
  assert.equal(rows[1].success, undefined);
});

test('callbacks whitelist IDs only and never retain prompts, tool payloads or transcript paths', t => {
  const config = fixture(t);
  recordEvent(config, { ...event, transcript_path: 'PRIVATE', agent_transcript_path: 'PRIVATE',
    last_assistant_message: 'PRIVATE', tool_input: { secret: 'PRIVATE' }, cwd: 'PRIVATE', prompt: 'PRIVATE' });
  assert(!JSON.stringify(summarize(config)).includes('PRIVATE'));
});

test('retries deduplicate by turn and next turns are retained; missing identity does not collapse observations', t => {
  const config = fixture(t);
  assert.equal(recordEvent(config, event).inserted, true);
  assert.equal(recordEvent(config, event).inserted, false);
  recordEvent(config, { ...event, turn_id: 'turn-2' });
  recordEvent(config, { ...event, turn_id: undefined });
  recordEvent(config, { ...event, turn_id: undefined });
  assert.equal(summarize(config).length, 4);
});

test('malformed/oversized stdin fails open with valid empty JSON and no model steering', async t => {
  const config = fixture(t), configPath = join(config.dataDirectory, '..', 'config.json');
  writeFileSync(configPath, JSON.stringify(config));
  for (const body of ['bad json', 'x'.repeat(1048577)]) {
    let output = '', errors = '';
    await run(configPath, Readable.from([body]), { write: s => output += s }, { write: s => errors += s });
    assert.equal(output, '{}\n'); assert(errors.includes('skipped'));
  }
  assert.equal(existsSync(config.dataDirectory), false);
});

test('actual command entrypoint persists start and stop into the same isolated database', async t => {
  const config = fixture(t), configPath = join(config.dataDirectory, '..', 'config.json');
  writeFileSync(configPath, JSON.stringify(config));
  const call = payload => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['examples/native-events/probe.mjs', configPath], { windowsHide: true });
    let out = '', err = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    child.on('error', reject); child.on('exit', code => resolve({ code, out, err })); child.stdin.end(JSON.stringify(payload));
  });
  for (const kind of ['SubagentStart', 'SubagentStop']) {
    const result = await call({ ...event, hook_event_name: kind });
    assert.equal(result.code, 0); assert.equal(result.out, '{}\n'); assert(!result.err.includes('skipped'));
  }
  assert.equal(summarize(config).length, 2);
  // This verifies the real executable + SQLite chain using synthetic stdin,
  // not delivery of native host callbacks or any actual model run.
});

test('Windows cmd hook launch with quoted Node/script/config paths works without PATH lookup', { skip: process.platform !== 'win32' }, t => {
  const config = fixture(t), configPath = join(config.dataDirectory, '..', 'probe config with spaces.json');
  writeFileSync(configPath, JSON.stringify(config));
  const script = new URL('../examples/native-events/probe.mjs', import.meta.url);
  const scriptPath = decodeURIComponent(script.pathname).replace(/^\/([a-z]:)/i, '$1');
  const command = `"${process.execPath}" "${scriptPath}" "${configPath}"`;
  // Mirrors the documented public command runner's Windows /C + outer raw quotes.
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/C', `"${command}"`], {
    windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8',
    input: JSON.stringify(event), timeout: 3000,
    env: { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{}\n');
  assert.equal(summarize(config).length, 1);
});

test('diagnostics distinguish rejected callback and parse failure without retaining any IDs or payload', async t => {
  const config = fixture(t), configPath = join(config.dataDirectory, '..', 'config.json');
  writeFileSync(configPath, JSON.stringify(config));
  for (const body of [JSON.stringify({ ...event, session_id: 'private-other-id', prompt: 'PRIVATE-PROMPT' }), 'invalid']) {
    await run(configPath, Readable.from([body]), { write() {} }, { write() {} });
  }
  const content = readFileSync(join(config.dataDirectory, '..', 'probe-diagnostics.jsonl'), 'utf8');
  const rows = content.trim().split('\n').map(s => JSON.parse(s));
  assert(rows.some(r => r.stage === 'invoked'));
  assert(rows.some(r => r.stage === 'filtered' && r.accepted === false));
  assert(rows.some(r => r.stage === 'failed' && r.phase === 'parse'));
  for (const privateValue of ['private-other-id', 'PRIVATE-PROMPT', event.agent_id, parent]) assert(!content.includes(privateValue));
  assert.equal(existsSync(config.dataDirectory), false);
});

test('Windows PowerShell hook command fixes quoted-executable parser failure and runs real entrypoint', { skip: process.platform !== 'win32' }, t => {
  const config = fixture(t), configPath = join(config.dataDirectory, '..', "probe config's file.json");
  writeFileSync(configPath, JSON.stringify(config));
  const scriptPath = fileURLToPath(new URL('../examples/native-events/probe.mjs', import.meta.url));
  const oldCommand = `"${process.execPath}" "${scriptPath}" "${configPath}"`;
  const parser = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    '$e=$null; [System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$null,[ref]$e) | Out-Null; @($e).Count'],
    { input: oldCommand, windowsHide: true, encoding: 'utf8', timeout: 3000 });
  assert(Number(parser.stdout.trim()) > 0, 'Old quoted-executable command must reproduce its PowerShell parse failure');
  const command = windowsPowerShellCommand(process.execPath, [scriptPath, configPath]);
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', input: JSON.stringify(event), timeout: 3000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{}\n');
  assert.equal(summarize(config).length, 1);
  const rows = readFileSync(join(config.dataDirectory, '..', 'probe-diagnostics.jsonl'), 'utf8');
  assert(rows.includes('"stage":"invoked"'));
  assert(rows.includes('"accepted":true'));
  assert(!rows.includes(parent));
  assert.throws(() => windowsPowerShellCommand('node', ['bad\nargument']));
});


test('matched-only diagnostics do not record any rejected model request', async t => {
 const config=fixture(t),path=join(config.dataDirectory,'..','model-config.json');writeFileSync(path,JSON.stringify({...config,diagnosticsOnlyForAllowedSession:true}));
 await run(path,Readable.from([JSON.stringify({...event,hook_event_name:'PreModelRequest',session_id:'unrelated-private-fixture'})]),{write(){}},{write(){}});
 assert.equal(existsSync(join(config.dataDirectory,'..','probe-diagnostics.jsonl')),false);
 assert.equal(existsSync(config.dataDirectory),false);
});
