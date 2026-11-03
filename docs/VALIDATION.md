# Validation

The current source is the 0.5.2 development snapshot. Run:

```powershell
npm run check
npm test
npm run review:public
```

Checks cover JavaScript syntax, JSON and manifest consistency, declared reviewable
Hook definitions, skill structure, relative GitHub marketplace paths, isolated
MCP/SQLite behavior, DOM event handlers and the public-file privacy allowlist.
Tests use temporary synthetic data and do not invoke a model or another Codex CLI.

Real native start/stop, same-child continuation, direct/grandchild topology and a
135-second task were separately verified in an explicitly authorized test scope.
Those summaries and their limits are recorded in [acceptance status](ACCEPTANCE_0.5.1.md).
Private receipts and thread identifiers are not public test fixtures.

The 0.5.2 baseline has 118 isolated tests. A fresh authorized native child and
one continuation of that same child also produced real stop callbacks and two
automatic direct-history saves, without a model synchronization request.
Measured stop-to-save times were 1158 and 1021 milliseconds. See the
[button matrix](BUTTON_ACTIONS_0.5.2.md) and [data flow](DATA_FLOW_0.5.2.md).
Those callbacks used the existing scoped development probe; they do not verify
deployment or trust of the packaged plugin's Hooks.

No GitHub-imported desktop instance has passed full UI activation, visual tree,
navigation or continuation-button acceptance. Current source publication does not
claim installation, automatic cross-identity data migration or verified MCP hot reload.
