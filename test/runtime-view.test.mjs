import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeView } from '../src/runtime-view.mjs';
test('native running state remains nonterminal after TTL, restart and clock skew', () => {
  const member={runtimeObservation:{state:'running',source:'native-command-hook',observedAt:'2026-01-01T00:00:00Z'}};
  for(const when of ['2026-01-01T00:01:00Z','2026-01-01T00:03:00Z','2026-01-02T00:00:00Z','2025-12-31T23:59:00Z']) {
    const result=runtimeView(JSON.parse(JSON.stringify(member)),Date.parse(when));
    assert.equal(result.state,'running');assert.equal(result.terminalObserved,false);assert.equal(result.outcome,'unknown');
  }
  assert.equal(runtimeView(member,Date.parse('2026-01-01T00:03:00Z')).liveness,'unconfirmed');
});
test('native turn stop is distinct from task success and never implies resumability', () => {
  const result=runtimeView({runtimeObservation:{state:'idle',source:'native-command-hook',observedAt:'2026-01-01T00:00:00Z'}},Date.parse('2026-01-02T00:00:00Z'));
  assert.equal(result.terminalObserved,true);assert.equal(result.state,'idle');assert.equal(result.outcome,'unknown');assert(!result.resumeAvailable);
});
