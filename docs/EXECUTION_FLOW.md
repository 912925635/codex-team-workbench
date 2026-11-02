# Native execution flow

A task assignment is stored responsibility, not a model launch. An authorized
panel execution request is relayed to the current lead through advertised host
messaging. The MCP process does not invoke a model or create an app-server.

1. Read the exact board and requested execution; honor dependencies and revisions.
2. The actual lead invokes its supported native collaboration spawn tool once.
3. Only after the real tool result, record the exact runtime reference and dispatch
   receipt with team_record_execution. A path is not a native thread UUID.
4. Resolve identity from exact public parent activity when available. The normal
   Hook/public-metadata path may independently discover the same exact UUID;
   deterministic consolidation preserves ownership and immutable work records.
5. Collect useful work, validation and the actual child result. A worker report
   alone does not mark a task succeeded; the lead confirms the observed result.
6. Lifecycle callbacks independently update running/idle evidence. The lead does
   not poll a model to keep a status light active. A stop event is not task success.

For nested authorized spawns, record the actual direct parent and keep workflow
membership separate. Unknown ancestry stays unverified. Do not default a grandchild
to the root or copy an inherited parent thread ID into the child's identity.

Explicit navigation and continuation use team_request_host_action. The panel
sends its exact action/member/native target to the lead. A sent message is pending,
not succeeded. Missing tools, missing original agents and rejected routes must
record failed. Navigation success requires an actual host navigation acknowledgment;
continuation success requires the supported exact-agent operation and a fresh
actual spawning-parent capability observation. Do not send direct V2 app-server
input or silently spawn a replacement. Cancelling the workbench wait does not
cancel an already delivered native operation.

The real scoped tests verified actual native execution, same-child continuation,
automatic callbacks and public parent/grandchild metadata. Installed UI button
acceptance remains uncompleted; see [acceptance](ACCEPTANCE_0.5.1.md).
No private real receipt or task data is distributed in this document.
