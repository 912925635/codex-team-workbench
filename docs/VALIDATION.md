# Validation

The current source is 0.5.1, published as a development snapshot. Run:

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

No GitHub-imported desktop instance has passed full UI activation, visual tree,
navigation or continuation-button acceptance. Current source publication does not
claim installation, automatic cross-identity data migration or verified MCP hot reload.
