import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { dispatch } from '../src/tools.mjs';
import { recordEvent } from '../examples/native-events/probe.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const parent = '00000000-0000-4000-8000-000000000201';
const child = '00000000-0000-4000-8000-000000000202';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-native-projection-'));
  const config = { sessionIds: [parent], dataDirectory: join(dir, 'journal') };
  const journal = join(config.dataDirectory, 'native-events-probe.sqlite');
  const store = new Store(join(dir, 'board'), { nativeEventJournal: journal });
  const cleanup = [];
  t.after(() => { for (const close of cleanup) close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  let board = store.create('Native fixture'); board = store.bind(board.id, parent, board.revision);
  return { store, config, journal, board, cleanup };
}
const raw = { hook_event_name: 'SubagentStart', session_id: parent, agent_id: child, agent_type: 'fixture', turn_id: 'turn-1' };
const snapshot = (store, board) => dispatch(store, 'team_snapshot', { boardId: board.id });

test('normal snapshot automatically projects real hook journal schema, start/stop and idempotent refresh', t => {
  const { store, config, board } = fixture(t);
  assert.equal(snapshot(store, board).nativeEvents.state, 'waiting-for-callback');
  recordEvent(config, raw);
  let result = snapshot(store, board);
  assert.equal(result.nativeEvents.applied, 1);
  const member = result.board.members.find(m => m.nativeId === child);
  assert.equal(member.source, 'hook'); assert.equal(member.runtimeObservation.state, 'running');
  assert.equal(member.runtimeFresh, true);
  assert.equal(result.board.sessionTree.find(n => n.entityId === member.id).agentParentId, null);
  assert.equal(result.board.sessionTree.find(n => n.entityId === member.id).parentId, null);
  const revision = result.board.revision;
  assert.equal(snapshot(store, board).board.revision, revision);
  recordEvent(config, { ...raw, hook_event_name: 'SubagentStop' });
  result = snapshot(store, board);
  const stopped = result.board.members.find(m => m.id === member.id);
  assert.equal(stopped.runtimeObservation.state, 'idle');
  assert.equal(stopped.runtimeObservation.terminalSuccess, null);
  assert.equal(stopped.runtimeObservation.resumeAvailable, false);
  assert.equal(result.board.tasks.length, 0);
  assert.equal(snapshot(store, board).nativeEvents.applied, 0);
});

test('wrong source sessions, archive and changed binding cannot receive old lifecycle state', t => {
  const { store, config, board } = fixture(t);
  recordEvent(config, raw);
  store.archive(board.id, store.read(board.id).revision, 'archive', true);
  assert.equal(snapshot(store, board).nativeEvents.state, 'unbound-or-archived');
  store.archive(board.id, store.read(board.id).revision, 'restore', true);
  store.bind(board.id, child, store.read(board.id).revision, { previousSessionId: parent, confirmRebind: true, evidence: 'Fixture rebind' });
  assert.equal(snapshot(store, board).nativeEvents.applied, 0);
  assert.equal(store.read(board.id).members.length, 1);
});

test('another Store instance deduplicates journal receipts and malformed journal fails visibly without losing board', t => {
  const { store, config, journal, board } = fixture(t);
  recordEvent(config, raw);
  const first = snapshot(store, board);
  const second = new Store(join(config.dataDirectory, '..', 'board'), { nativeEventJournal: journal });
  try { assert.equal(snapshot(second, board).board.revision, first.board.revision); }
  finally { second.close(); }
  const db = new DatabaseSync(journal);
  db.prepare('INSERT INTO events(identity,payload,observed_at) VALUES (?,?,?)').run('bad', 'bad json', new Date().toISOString());db.close();
  const result = snapshot(store, board);
  assert.equal(result.nativeEvents.state, 'error-reading-local-hook-journal');
  assert.equal(result.board.id, board.id); assert.equal(result.board.members.length, 2);
});

test('journal ingestion is disabled by default and never guesses a directory', t => {
  const { store, config, board } = fixture(t);
  recordEvent(config, raw);
  store.nativeEventJournal = null;
  assert.equal(snapshot(store, board).nativeEvents.state, 'disabled');
  assert.equal(store.read(board.id).members.length, 1);
});

test('packaged native hook and normal plugin store share PLUGIN_DATA without private-path configuration', t => {
  const { config, cleanup } = fixture(t);
  const pluginData = join(config.dataDirectory, '..', 'plugin-data');
  const pluginStore = new Store(join(pluginData, 'team-workbench'));
  cleanup.push(() => pluginStore.close());
  let b = pluginStore.create('Packaged hook fixture');b = pluginStore.bind(b.id, parent, b.revision);
  for (const [event,turn] of [['SubagentStart','turn-1'],['SubagentStop','turn-1'],['PreModelRequest','turn-2'],['SubagentStop','turn-2']]) {
    const command = process.platform === 'win32' ? 'pwsh' : process.execPath;
    const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', "& node (Join-Path $env:PLUGIN_ROOT 'src/native-hook.mjs')"] : ['src/native-hook.mjs'];
    const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: fileURLToPath(new URL('../', import.meta.url)), PLUGIN_DATA: pluginData, TEAM_WORKBENCH_DATA: '', TEAM_WORKBENCH_NATIVE_EVENTS: '' },
      input: JSON.stringify({ ...raw, hook_event_name: event, turn_id: turn }), timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);assert.equal(result.stdout, '{}\n');
  }
  // Test overrides that would hide normal PLUGIN_DATA fallback are absent in a plugin host.
  // This explicit reader path tests the same default location without modifying process-global env.
  pluginStore.nativeEventJournal = join(pluginData, 'team-workbench', 'native-events-probe.sqlite');
  const result = snapshot(pluginStore, b);
  assert.equal(result.nativeEvents.applied, 4);assert.equal(result.board.members[1].runtimeObservation.state, 'idle');
  assert.equal(result.board.members[1].runtimeObservation.turnId,'turn-2');
  assert.equal(snapshot(pluginStore,b).nativeEvents.applied,0);
});


test('resumed subagent model request revives running evidence after stop; root requests are ignored', t => {
 const {store,config,board}=fixture(t);
 recordEvent(config,raw);recordEvent(config,{...raw,hook_event_name:'SubagentStop'});snapshot(store,board);
 const event={...raw,hook_event_name:'PreModelRequest',turn_id:'resumed-turn'};
 recordEvent(config,event);let result=snapshot(store,board);assert.equal(result.board.members[1].runtimeObservation.state,'running');
 const at=result.board.members[1].observedAt;recordEvent(config,event,new Date(Date.parse(at)+1000).toISOString());result=snapshot(store,board);
 assert.equal(result.nativeEvents.applied,1);assert(result.board.members[1].observedAt>at);
 assert.equal(recordEvent(config,{...event,agent_id:undefined}).accepted,false);
});
