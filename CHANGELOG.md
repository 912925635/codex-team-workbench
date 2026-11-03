# Changelog

## 0.5.2 — development snapshot, installed-host acceptance pending

- Direct public app-server visible-history reads for explicitly bound members,
  verified against their complete recorded/public parent chain before body access.
- Explicit per-root opt-in background journal watcher and asynchronous visible
  history jobs on native stop, with persisted event dedupe and shared SQLite job leases, one history helper per backend at a time,
  bounded retries and cancellation/rebinding guards. Existing boards remain off.
- Paginated one-turn snapshots, text limits, explicit partial coverage, repeat-read
  deduplication and atomic rejection when a board binding changes during a read.
- Runtime-event refresh and saved-record refresh call MCP directly with visible
  changed/unchanged/failure feedback; neither sends main-chat messages.
- Native navigation first uses advertised `openLinks` and `ui/open-link` with the
  exact `codex://threads/{UUID}` link. Host acknowledgment remains `accepted`,
  never visual success. Refusal never triggers a hidden message or OS fallback.
- Explicit lead-assisted navigation/history and native continuation are labeled;
  execution/continuation prompts carry request IDs rather than repeated task text.
  `team_get_request` returns only the exact saved request and required revisions.
- Existing source data, plugin identity and user styles preserved. Source publication
  does not update a running local instance, enable Hooks or grant host permissions.
- Keep the existing GitHub marketplace and plugin names; document branch tracking,
  marketplace refresh, installation and live connection reload as separate steps.

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
