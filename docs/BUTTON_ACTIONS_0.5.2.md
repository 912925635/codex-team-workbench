# Button paths and acceptance: local 0.5.2 source

This is a development source snapshot. Its publication does not install or update
the user's active plugin. No production board/history, installed plugin, Hook
definition or host setting is changed by developing or testing it.

## Every control and its data path

“0 messages” below means no `ui/message` or model-context update call in that
control's implementation. Normal host auditing of MCP calls is host-owned.

| Controls | Actual path | Main-chat messages |
| --- | --- | --- |
| Create workbench / welcome create | `team_create_board` | 0 |
| Workbench selector | `team_panel` with exact board ID | 0 |
| Global refresh | `team_snapshot`, then `team_read_records` if a node is open | 0 |
| Owner/status filters, task row, tree fold, node row | Local render; opening a node reads `team_read_records` | 0 |
| New task, save task | `team_create_task` | 0 |
| Claim, release, complete, reopen | `team_update_task` with revision and action | 0 |
| Edit, dependencies, reassign | `team_update_task` with confirmed form values | 0 |
| Record member | `team_report_member`; does not start an agent | 0 |
| Bind/change conversation | Full UUID validation and explicit old/new confirmation, then `team_bind_session` | 0 |
| Archive/restore | Explicit confirmed `team_archive_board`; records preserved | 0 |
| Close/cancel form/detail, saved execution selector, view saved content | Local UI | 0 |
| Refresh records / load more records | `team_read_records`, local pagination | 0 |
| Refresh runtime records | `team_snapshot` ingests already-received Hook events and reads source-labeled state, then refreshes the open node | 0 |
| Enable/disable automatic visible-history sync | Exact-root confirmed `team_set_history_sync`; backend watches only its existing journal and queues bounded public reads on native stop | 0; no lead polling |
| Sync visible conversation | `team_sync_native_history` for the exact member, directly through the public existing app-server socket | 0 |
| Read an older direct page | Same tool; cursor obtained only from that member's stored direct page ID | 0 |
| Open corresponding child conversation | Negotiated `openLinks` → `ui/open-link` → exact `codex://threads/{UUID}`; persist host acknowledgment/refusal | 0 |
| Cancel workbench wait | `team_record_host_action`, source `panel-user-confirmation`; does not stop or retract a native operation | 0 |
| Request execution / resend execution | Save/reuse exact execution request, then one explicit `ui/message`; lead reads only `team_get_request` | 1 per explicit click; concurrent clicks guarded |
| Request continuation | Save exact pending host action; one explicit `ui/message`; lead verifies original parent/agent and uses supported collaboration | 1 per confirmed submission |
| Request main-chat open | Explicit optional navigation relay inside “需要主会话的操作” | 1 |
| Request main-chat association/history/older relay page | Explicit optional relay inside that same labeled section | 1 |

The direct path never silently falls back to messaging, OS URL launching, private
IPC, a replacement worker or another thread. Lead-only operations are labeled
before the user clicks. Execution and continuation messages contain request IDs;
stored instructions and unrelated board records are not copied into them.

## Direct history evidence and limits

The real existing public control socket returned the previously authorized
native timer child's own message page: one turn, one visible assistant result,
with its expected test-result marker. Parent metadata matched the exact test
root before history access. Repeating the direct MCP operation reused the saved
record. No model started and no main-chat message was sent.

Implementation: `native-history.mjs` → cached `read-native-metadata.ps1` →
`thread/read` metadata for the recorded ancestor chain → `thread/turns/list`.
The helper refuses a missing/conflicting parent or a conflicting runtime path
before requesting history. The save transaction rejects a changed root, generation, ancestor chain
or target. A zero-turn response stays empty and never causes a parent-history
substitution. Read failures retain the prior successful page and show a dated
error. Re-reading unchanged content updates the last-read time without duplicating
immutable work records.

Each page requests one turn. The helper emits at most 20 user/assistant text
items, 1000 characters each, 8000 text characters total. Tool/reasoning bodies
are not emitted to Node, stored or rendered. Truncation, omitted-item counts and
older-turn cursors remain explicit. The socket receive limit is 1 MiB; exceeding
it produces an error instead of silently importing an incomplete payload.

The default direct reader uses Windows PowerShell 7 and the existing public
control socket in a plugin-data environment. It starts no Codex CLI/server.
Other environments report unavailable; the optional lead route remains explicit.
This read-only control process does not supply desktop live running state;
lifecycle observations still come from the source-labeled Hook journal.

After explicit per-workbench confirmation, the backend also watches that existing
journal and reads new visible pages on stopped-turn events without waiting for a
panel click or a model response. Event keys and pending-job dedupe prevent repeated
reads; only one helper runs at a time. Rebinding/archiving/disabling rejects late
saves. See [data flow and measured timings](DATA_FLOW_0.5.2.md).

The resource endpoint also accepts older versioned URIs in the same panel family
and returns this connection's cached complete HTML. This handles stale tool
metadata after a new server connects; it does not replace an already-running old
MCP process or pretend that reopening a panel performs an update.

## DSH comparison from actual code

Pinned DeepSeek Harness source:
`ce7073d51254c26cd63b22a60835b8f948deb447`.

- [`client/mount.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/experimental/client-ui-agent-team/src/client/mount.ts)
  implements `openTeammate` using `ctx.uiWorkspace.openSession`, passing the
  real parent/child session IDs and `mode: continuable`.
- [`TeamAction.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx)
  reads live `useSessionStatus` and session projections; a member click invokes
  that injected function directly.

Those are DSH host services, rather than chat prompts. The equivalent here is
direct MCP for plugin-owned operations, a public read-only backend for stored
history, and negotiated host link requests for navigation. MCP's UI protocol
does not itself expose the model's internal `collaboration` tool namespace.
This implementation keeps original native workers under their actual spawning
lead rather than replacing them with app-server-managed workers.

## Acceptance and the remaining real-host gate

- Deterministic tests execute actual bridge/browser handlers and actual bundled
  `resources/read` HTML with a real isolated stdio MCP backend. They cover CRUD,
  refresh changed/unchanged/error, double clicks, exact IDs, direct history,
  optional lead routes and host-refusal feedback. These are protocol/DOM tests,
  not a desktop visual test.
- Real public read acceptance covers the exact previously authorized child and
  repeated-read deduplication. It does not create a new agent or modify its turn.
- Replaying an already recorded real stop into an isolated journal triggered the
  actual file watcher and that real child's public page in 1815 ms, with one read
  and no main-chat/model call. A new native callback was not emitted in this test.
- A fresh real native worker and one continuation of the same UUID passed the
  actual event-to-history path through the existing trusted development probe.
  Two stop-to-saved-page timings were 1158 ms and 1021 ms. The isolated task/run
  and actual parent-reported action receipts were saved; no manual history-sync
  message was sent. This is not a packaged-Hook/UI deployment acceptance.
- The changed source is not loaded by the installed host. No available non-GUI
  tool exposes `ui/open-link` for an uninstalled source frame. Actual ChatGPT
  `openLinks` capability and acceptance/refusal of the `codex` scheme therefore
  remain **unverified**. A fixture response is never reported as that result.

After approval to load this source into a test plugin connection, the one needed
host check is to open an exactly bound test child and click “打开对应子代理会话”.
Record the advertised capability and actual host response. A refusal must retain
its RPC code/message with zero automatic `ui/message` calls; an acknowledgment
must remain `accepted` until the destination is visibly confirmed. No whole-app
restart, production migration, Hook expansion or new model task is required by
this code change. The supported host update/reload procedure must be verified
when that step is authorized; merely closing the panel is not claimed sufficient.

Official contracts:
[MCP Apps stable protocol](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
[OpenAI Extensions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md),
[public thread history pagination](https://learn.chatgpt.com/docs/app-server),
[Codex native thread URL source](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app/history_ui.rs).
