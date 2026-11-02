# Validation

Version 0.4.6 was checked with Node.js 24 on Windows: npm run check and npm test
passed with **53 tests**, no failures or skips. Targeted tests from an extracted
release archive also passed (11 tests). Other desktop hosts are not certified.

Tests use isolated temporary stores and synthetic identities. They cover task
transitions, dependency/revision conflicts, persistence, archive/restore, binding
changes and historical-source isolation, exact activity mapping, runtime freshness,
strict schemas, real stdio MCP discovery/resource/tool calls and loopback preview.

The actual HTML returned by resources/read is executed in a deterministic DOM
fixture with its bridge and real isolated MCP process. Refresh coverage includes
pending requests, changed and unchanged data, injected host errors, duplicate
clicks and repainting an open node. This is not real desktop GUI automation.

Complete native-agent discovery, visual animation in every desktop, all native
navigation routes and continuation in every host remain unverified. A stored
fixture or tool response is not proof that a user saw a native screen. No paid
model task is needed to run this test suite.
