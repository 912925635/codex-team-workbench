# 0.5.1 acceptance status

This is a published development source snapshot, not a completed desktop release.
Private real-run receipts are excluded; source regressions use synthetic fixtures.

| Requirement | Actual evidence | Remaining |
| --- | --- | --- |
| Automatic native lifecycle | Trusted host callbacks reached a local journal and ordinary MCP snapshots without manual status reports | GitHub-installed plugin-owned callback/UI acceptance |
| Same-child continuation | One actual child UUID produced running / idle / resumed running / idle; resumed running came from PreModelRequest | Installed continuation button-to-host-to-receipt interaction |
| Exact topology | Actual direct child/grandchild activities and public parent metadata agreed | Installed tree visual acceptance |
| Long task expiry | Native command ran 135.169 seconds; at observation age 120.544 seconds state stayed running/unconfirmed/nonterminal; actual stop changed it to idle | Installed long-task animation visual acceptance |
| Navigation | Supported native navigation returned navigated=true and an exact-target receipt was persisted in isolation | Actual selected conversation visual rendering |
| Instructions/results | Immutable dispatch instructions, source-labeled reported results and partial visible-history pages remain separate | Full native transcript coverage is not claimed |
| Request errors | Actual UI handlers and MCP contracts cover unsupported messaging, exact targets, failure, duplicate requests and closing a wait | Installed host error-path interaction |
| Data compatibility | Actual previous account-source Store and dependencies preserved 28 synthetic tasks, three members, records and selection through candidate and old-version read-back | Production backup and installed-data checks before switching identity |
| GitHub structure | Marketplace root, relative source path, Hook resources and privacy allowlist are regression checked | Actual GitHub import and desktop activation |

A metadata Hook cannot establish resumability. Exact public parent/path nodes may
request check-and-continue; the actual spawning parent must verify its live agent
directory and supported collaboration operation before success. An old agent absent
from the restored directory was not resumed. A new agent was not claimed to be that
historical agent. Historical restoration is unproven.

The source declares the three handlers for normal host review. Publishing this
repository did not update the installed plugin, expand the scoped development probe,
change trust records or restart the client. The normal handler's active-bound-board
metadata scope needs explicit review and approval before use.

The real native task creation metadata reported 0.164.0-alpha.11.1; a separate
existing control process reported 0.166.0. Those observations do not establish a
minimum desktop build or interchangeability of the two runtime processes.

Run `npm run check`, `npm test` and `npm run review:public` for reproducible source
validation. See [installation and data retention](INSTALL.md) for remaining host
steps. A source test count, saved release or candidate archive is not a substitute
for the uncompleted installed-client checks above.
