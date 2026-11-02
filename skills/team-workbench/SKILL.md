---
name: team-workbench
description: Use when the user wants Team Workbench to execute a task through real native subagents and synchronize task ownership, parent-child references, execution receipts and results, or manage its shared task board.
---

Use the plugin's MCP tools to keep a persistent shared task board. Opening or
using this skill alone does not authorize additional subagents or changes to host
configuration. Follow the user's task scope and host delegation rules.

1. Call `team_snapshot` to list boards. Select the board explicitly associated
   with the current task; do not silently pick the latest board belonging to
   another conversation. Create an empty board with `team_create_board` if needed.
2. Open `team_panel` with the chosen `boardId` when the host supports the view.
   Without a view, all task tools remain usable and return structured data.
3. Create tasks with concise titles and dependency IDs. A blocked task cannot be
   claimed or completed. Assignment records responsibility; it does not dispatch
   work or establish native agent identity.
4. If a real, authorized collaborator already exists, use its explicitly known
   identifier with `team_report_member`. This is a **reported** record, not native
   discovery. Do not invent a worker, agent ID, thread ID, running state, thread
   URL, or resumability. Record `unknown` when the state is unknown.
5. Read a fresh snapshot before updating. Include `expectedRevision`, the task's
   revision, and `actorId`, the declared workflow member. On `STALE_REVISION`, read
   again, assess the new state and retry only if the intended action still fits.
   Roles are caller-declared conventions, not authenticated host permissions.
6. After work completes, mark the task complete and report the outcome in the
   conversation. Member reports and task completion are separate facts.

## Execute a requested task through the native lead

When the user asks to execute a task, or the panel posts `Execute Team Workbench
run ...`, complete this chain in the CURRENT conversation. A recorded assignment
alone is never a trigger to spawn work.

1. Read `team_snapshot` for the explicitly selected board. Locate the task and
   requested run. If no request exists, call `team_request_execution` with the
   current task revision and the user's bounded instructions. Check dependencies.
   Spawn only if the run is still `requested`. For an existing dispatched,
   running or reported run, collect/continue that actual worker as supported by
   the host; do not create another worker because a panel message was resent.
   A terminal run is not a new execution request.
2. Check that your host actually exposes native collaboration tools such as
   `spawn_agent`. If not, report the precise missing capability; leave the run
   requested or record failure. Do not start a separate Codex CLI/app-server as a
   fallback. Do not fabricate a child or tool receipt.
3. Use the host's real native spawn tool to delegate the bounded task. Preserve
   user model/sandbox/tool constraints. The child must share the same workbench
   MCP server/data root, receive boardId/runId, and write only its assigned scope.
4. Only AFTER the host returns, call `team_record_execution` with action
   `dispatched`, its exact returned `runtimeRef`, a descriptive member name and
   evidence identifying the successful call. A canonical collaboration task path
   is a runtime reference, NOT a verified Desktop thread ID. Do not populate a
   guessed thread identifier. Parent-child relation and member state are reports.
   If the host exposes public history tools, run the automatic identity protocol
   below now. A missing history capability must not prevent the authorized work
   itself or be replaced with guessed identities.
5. The real child reads a fresh snapshot, records `running`, performs the work,
   validates it, then records `report_result` with the result, workspace-relative
   artifact references and actual command/outcome evidence. It returns its real
   final result to the lead. It MUST NOT confirm itself. Before `dispatched`, it
   waits for the lead instead of inventing the spawn receipt.
6. The lead collects the actual host result, reads/verifies the actual artifacts
   and relevant checks, then records `confirm`. Only this step marks the run
   succeeded and task completed. A worker report alone leaves it in progress.
   Synchronize that actual child's visible history using the protocol below before
   ending the normal execution turn. If its mapping was not yet published at
   dispatch, this natural completion is one appropriate retry point; do not poll
   the model or create another agent. Record a precise blocker if still unavailable.
7. On spawn/execution/result failures, record `fail` with the observed reason.
   An assigned failed run releases its task for explicit retry. Never report
   success because a send operation was merely accepted. Refresh on revision
   conflicts; do not blindly retry a possibly executed spawn.

The panel requests execution through advertised `ui/message` support targeting
the active main conversation. It cannot call native spawn tools itself. If the
host lacks messaging, the user can ask the main conversation to execute the task.
If this conversation lacks the plugin's MCP tools but an explicitly authorized
shared data directory is known, the packaged `scripts/workbench.mjs` can call this
server over real stdio. Pass `--data` explicitly and a JSON request via `--request`
or stdin. This is a tool transport, not a new model process. Never guess a data
directory or open private Codex session stores to find one.

Native thread enumeration, member-session jumping and native resume are not
implemented. The lead can use its actually available native messaging/continuation
tools within user authorization, then report the observed result; the MCP server
does not obtain those powers by recording them.

## Multilevel sessions, workflows and readable work records

For EVERY real authorized spawn, including a worker's own child, preserve the
actual direct parent. The spawning agent uses its recorded member ID as
`parentMemberId` on `team_request_execution`; it must not default a grandchild to
`lead`. Pass the board/run IDs and this rule to the child. The returned execution
member ID identifies that child in the board. Existing real collaborators can
also be recorded through `team_report_member` with their exact `parentId` and
`runtimeRef`. Register the parent first. Do not create placeholder workers to
make a deeper tree appear populated.

`runtimeRef` is the exact host collaboration reference. Supply `nativeId` only
when an authorized source supplies the actual UUID for THAT agent, with
`nativeIdSource` and factual `evidence`. A canonical task path is not that UUID.
An inherited environment variable can refer to the outer task rather than the
child: never copy the parent's `CODEX_THREAD_ID` into a child's native identity,
and never equate anonymous plugin-session metadata with a native thread ID.
These bindings stay source-labeled reports until verified by a connected reader.

For an actual orchestrated workflow or user-authorized task group, use
`team_record_workflow` with its stable workflowId, actual owning parentMemberId,
status and evidence. New groups use expectedRevision=0; updates use the current
workflow revision. Workbench-owned grouping is not a claim that the host created
a native workflow. Pass workflowId when requesting its children, or associate
existing members through `team_report_member`. The group must belong to their
actual parent. Grouping never replaces their real parent relationship.

At useful milestones, `team_append_record` can persist a concise user-visible
work record for the exact member/workflow. Include unique recordId, role, actual
text and evidence; identical retry is idempotent. Record observed facts such as
work started, a relevant command/check outcome, or a result. Never persist hidden
reasoning, credentials, copied private session files or invented tool output.
This is an explicitly reported work log, NOT a complete native transcript.
`team_read_records` pages it without starting a model and also returns the node's
related execution receipts/results. Token and duration fields on member reports
require real observed values and evidence; omit them when unknown. Never infer
resumability from a successful task, a past observation or a running status.

The local app-server probe returned `thread not loaded` for the known task ID.
The separate public host `codex-app-tools.read_thread` tool did read that known
task. Its bounded pages can be relayed below; this does not establish a native ID
for a child whose only identity is a canonical runtime path. Do not resume/start
threads, scan private session directories/databases or use hidden APIs to fill
that identity gap. Complete native transcript access is not claimed.

## Synchronize a public host page when explicitly requested

The panel's `Read and synchronize one bounded Team Workbench host conversation
page` request asks the CURRENT lead to do a read, not to start an agent.

1. Read the named board/member. Its explicitly recorded nativeId must equal the
   requested threadId. If missing or ambiguous, report the missing mapping and
   stop this read. Do not equate `/root/...` with a UUID or bind a panel's anonymous
   ID to an unrelated execution task. HostId/cursor, when supplied, are exact
   previously returned metadata, not things to invent.
2. If actually available, call the public `codex-app-tools.read_thread` tool for
   ONLY that authorized thread, at most one turn, includeOutputs=false and
   maxOutputCharsPerItem=1000. Preserve an explicitly requested cursor/hostId.
   This tool is available to the lead; the MCP server cannot call it internally.
   If unavailable, report that precise boundary. Do not substitute private files.
3. Verify the returned thread.id exactly matches. Select returned visible message
   text or concise factual status/tool summaries. Omit ALL reasoning items,
   credentials and unrelated content. Preserve original item/turn IDs. If a
   message or output is truncated or summarized, say so in the evidence; never
   label a selected page a complete conversation.
4. Call `team_import_thread_page` with boardId/memberId, matching threadId,
   actual readAt, a unique recordId, source evidence and the selected turns/items.
   Copy returned hostId and nextCursor when present. Supported item types are
   userMessage, agentMessage, commandExecution, fileChange, functionCallOutput and
   turnStatus. Maximum five turns, fifty items per turn, 8000 characters per item,
   48KB total. If needed select fewer visible items and clearly state coverage.
   Retry an identical import with the same recordId; do not overwrite its content.
5. Report that the bounded page was synchronized. The node reader shows its source
   as a public-host snapshot relayed by the agent, not server-authenticated native
   history. The user may request the next older page using its saved nextCursor.
   Browsing stored records starts no model; requesting synchronization can use the
   main conversation's quota. Do not spawn new agents for this operation.

## Automatic identity and history-sync protocol v1

Run this during normal dispatch/completion as above, or when the panel posts
`Synchronize Team Workbench member history v1`. The UI sends one request to the
active main conversation; no user needs to guess a child UUID.

Required lead tools: `team_snapshot`, `team_report_member`,
`team_bind_agent_activity`, `team_import_thread_page`, and public
`codex-app-tools.read_thread`. Check their actual availability. The MCP server
does not call host tools internally. Missing tools/history must be recorded as
an unavailableReason once, not retried indefinitely or replaced with a private
file/API. Sending another conversation a message is not part of this protocol.

1. Read the exact board/member. For a valid native UUID, proceed directly to
   its one-page read/import. Otherwise require the member's recorded runtimeRef
   and actual parentId; do not select another child to make the request succeed.
2. Establish the actual spawning parent's identity. Prefer its already recorded
   nativeId and source host. If missing, only that actual spawning conversation
   may record its own trusted context thread UUID through `team_report_member`,
   preserving its name/status/parent. Include actual source evidence and hostId
   when known. A same-thread Codex context ID may be used, but an inherited worker
   environment or a separate development/executor thread is NOT the ChatGPT
   main conversation's identity. If no trusted identity is available, call
   `team_bind_agent_activity` with expectedRuntimeRef/unavailableReason and stop.
   For nested children, use their recorded parent's UUID; never default to lead.
3. Read that exact parent's public history with `read_thread`, turnLimit=1,
   includeOutputs=false, maxOutputCharsPerItem=1000. Require returned thread.id
   to equal the recorded parent. In code mode, filter returned turn items by
   type===subAgentActivity and pass only id/type/agentPath/agentThreadId/kind;
   do not send reasoning or the whole transcript. Pass this array (including []
   for a real zero-result page), sourceThreadId and sourceHostId to
   `team_bind_agent_activity`, with the exact memberId/expectedRuntimeRef.
4. Let that tool perform matching and registration. Do NOT manually choose a
   candidate UUID: the code checks parent identity and exact path, rejects conflicts
   and requires a unique UUID. A previously recorded real spawnCallId can narrow
   ambiguous history; never invent one. The tool returns nextRead only on success.
   For not_found/ambiguous/blocked, report the saved reason and stop this sync.
   In particular, a zero-turn source must not be replaced with development-task
   history. A historical member may need an exact public parent activity match before it can be read.
5. Call the public read tool with the returned nextRead object. Verify the child
   response's thread.id exactly matches nextRead.threadId. Import its selected
   visible messages/status/tool summaries via `team_import_thread_page`, following
   the bounds/source rules above. Pass returned hostId and nextCursor. Exclude all
   reasoning and clearly note truncated or omitted outputs. Complete the user's
   requested node, not a different demo child.
6. The node displays the latest saved visible conversation above older records.
   Request-more pages use the same bound child and exact cursor; no parent read
   or identity substitution is needed. An actual host read failure can be saved
   through unavailableReason when the child has a recorded runtimeRef. Preserve
   an already known UUID; a read failure does not mean the identity is false.

For later real grandchildren, register the direct parent and its mapping first.
At normal completion, synchronize only this authorized run's actual recorded
descendants in parent-first order. Do not scan other boards, historical unrelated
agents or every thread in the app. This is lead-mediated automation, not a hidden
runtime monitor, direct model control, native navigation or a complete transcript.

Optional lifecycle observation exists as a local-only example. It requires
explicit installation and trust in a supported locally orchestrated host. It is
unsupported for cloud orchestration with local execution. Do not install or trust
hooks, modify global config, read private session databases/transcripts, launch
another CLI agent, or access credentials to work around this boundary.

Explicitly bind a board with `team_bind_session` only when a correct session ID
has been supplied through an authorized source. The binding is unverified. Hooks
only observe events for explicitly bound boards; they do not prove continuous
liveness, nested ancestry, task success or availability for resumption.


## Explicit binding changes and reversible archive (0.4.1)

A short label is never a usable native thread ID. Obtain a full UUID from the
actual originating conversation or an exact public result; never guess a suffix
or substitute the developer task. The user can correct or change a binding.
Before calling team_bind_session to change an existing binding, show old/new IDs
and explain that previous members, executions and snapshots keep their original
source and are isolated from new-origin sync. Require the user's confirmation;
then pass exact previousSessionId, confirmRebind=true, evidence and the latest
revision. Do not change the user's real binding merely to test this feature.
Old member IDs become history-only; register new members for new-origin runs.
Old stored records remain readable. A request to add this feature is not a request
to apply a binding change or archive a real board.

The UI offers 归档工作台, a reversible hide action, and 已归档工作台 to restore.
team_archive_board requires explicit user confirmation and expectedRevision.
It never deletes tasks, member/history records, chat threads or project files,
and never stops agents. Do not archive any real board during testing.


## Explicit native navigation request

When the user clicks 打开对应子代理会话, verify that the supplied full UUID is
still the selected member's binding. If codex-app-tools.navigate_to_codex_page
is available, call it once with that exact threadId and report the result. If it
is unavailable or returns an error, say so; never infer a different UUID, send a
message to the child, or claim a request proves the user saw the destination.


## Native runtime observations and explicit continuation

For an execution you actually started, use collaboration.list_agents to look up
the exact returned runtimeRef. If that native tool is available, record its
actual running/idle/completed/failed/cancelled state through team_observe_runtime,
using the current board revision, exact path, exact recorded spawning parent UUID as sourceThreadId, source, current observation time
and factual evidence. Only the actual spawning parent conversation can supply this observation; if its trusted UUID is missing or does not match, stop. Set resumeAvailable only if that exact agent is present
and the host actually exposes supported collaboration.followup_task or the
appropriate send_message for a running agent. Record unknown and false when
capabilities are unavailable; do not infer resumability from task completion.
While naturally waiting for this authorized execution, refresh the observation
at intervals no longer than one minute, and immediately report completion,
failure or cancellation. If you cannot refresh, stop: the panel expires the
observation after two minutes and will stop the animation automatically. The
MCP server cannot poll native tools; this is real lead-relayed observation, not
a continuously authenticated monitor. Do not spawn agents solely to animate it.

If the user explicitly submits a panel continuation, refresh the board and use
collaboration.list_agents to verify that this is the actual spawning parent with the exact recorded parent UUID, and verify the exact runtimeRef belongs to this run and
is still present. Use the supported collaboration.followup_task for an idle or
completed agent; use supported send_message only when appropriate for a running
agent. Do not send direct app-server input to V2 children, substitute another
thread, or report success before the tool result. Record the actual observed
outcome via team_observe_runtime, retaining evidence and time. If the tools or
agent are unavailable, report the specific limitation; do not create another
agent. The input text and exact runtimeRef are supplied by the panel request.
