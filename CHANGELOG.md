# Changelog

## 0.5.1 — development source snapshot

- Native metadata-only lifecycle journal ingestion and automatic local MCP refresh.
- PreModelRequest observations restore running state for same-agent continuation.
- Exact public parent metadata projection, grandchildren and source-labeled workflow groups.
- Exact-target navigation/continuation requests, actual-result receipts and visible failures.
- Check-and-continue requests avoid a separate manual capability-refresh step;
  successful receipts still require actual supported parent capability and operation evidence.
- Long running observations remain nonterminal when freshness expires.
- Exact UUID consolidation preserves task ownership and immutable work records.
- Metadata-reader compatibility when an old live connection's helper file is pruned.
- GitHub marketplace discovery at the repository root; portable and compatibility manifests
  declare three handlers for normal host review. Publishing does not enable them locally.
- Appearance, complete default prompt, upstream licenses and stable history retained.

Real native start/stop, same-child continuation, parent/grandchild relationships and a
135-second timer task were verified in one explicitly authorized scope. Source tests
use isolated synthetic data. The GitHub-installed desktop UI and its complete button flow
have **not** been accepted. This snapshot is not a completed stable release.
No private callbacks, thread IDs, transcripts or machine-specific evidence are published.

## 0.4.6 — previous public baseline

Persistent shared tasks, lead-mediated execution, reported session browsing,
partial visible-history relay and refresh feedback. Source baseline:
`3a66a9accb0a8ae9fb6dc54fefad1b45d5424d29`.
