# Validation

The 0.5.7 Windows run passed 153 tests and skipped two Linux-only tests. It covers persistent sync consent, session binding and card reopening.

The 0.5.6 isolated Node 24 Linux suite had 145
tests: 143 pass, two Windows-only checks skip, and zero fail. Release validation
uses standard bundled-Hook manifests. Windows-only Hook-launch checks are
skipped on Linux; these are not claimed as Windows acceptance. UI checks cover
completion values, new-event-only activity effects, canvas controls, fit stability,
view retention and actual stdio resource/handler behavior.

Run:

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


For this repair, an authorized Linux installation separately produced real native
start, pre-model-request and stop metadata, followed by backend bounded visible
history saves. The repaired initialization interface and served panel resource
were also checked through that installation's actual MCP connection. These are
local-installation observations, not a claim that publishing this source installs
or trusts the standard package. Private receipts, identities and workbench data
are excluded from the public source and archive.


## 0.5.6 UI evidence and limits

The same UI implementation was separately checked with real Chromium in eight
light/dark viewport cases from 320 to 1440 pixels, including fit idempotence,
node details, collapse, reset and view retention. Task completion values and
new-event-only motion were checked against an isolated local preview store.
A repaired Linux installation's exact current-thread UI response was compared
against its built assets after a normal supported plugin refresh. That verifies
its served resource, not the pixels of every already-mounted desktop card.
Private IDs, runtime receipts and workbench data are not included in this source.
