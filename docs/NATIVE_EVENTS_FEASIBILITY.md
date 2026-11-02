# Native lifecycle feasibility and evidence

The native desktop path was tested through an explicitly allowlisted test root:
actual collaboration agent -> trusted command Hook -> isolated local journal ->
ordinary MCP snapshot. No lead sync prompt, separate model/app-server team or
private host session store was used.

SubagentStart and SubagentStop captured a first turn. A real followup reused the
same child UUID but emitted no additional SubagentStart. PreModelRequest supplied
its resumed running observation. This three-event path then produced automatic
running / idle / resumed running / idle observations. Real public parent metadata
also verified direct children and a grandchild. A native 135-second timer confirmed
that expiration marks running evidence unconfirmed without manufacturing a stop.

The journal keeps only event, root/agent/turn identifiers, optional type and
receipt time. The packaged handler matches explicitly bound active workbenches;
the development probe uses a smaller explicit allowlist. Those are different
consent scopes. Normal review/trust is required before a new or changed definition
runs. Publishing the source does not register or trust a local handler.

A local command uses the native session shell. A quoted absolute executable path
requires the proper invocation operator in PowerShell. The packaged command uses
Node on PATH; synthetic entrypoint tests exercise the actual PowerShell/Node path
without starting a model. Fixture success is not host callback success; the real
callback observations are separately summarized in [acceptance](ACCEPTANCE_0.5.1.md).

An existing public control socket can read exact known parent metadata. A separate
control process's loaded status is not the native desktop process's liveness.
Never infer that shared history means shared runtime status or permission for
V2 direct input. No unrelated thread enumeration, hidden API, credential access
or private session database is part of this implementation.

Primary references: [Hooks](https://learn.chatgpt.com/docs/hooks),
[plugin Hook manifests/environment](https://developers.openai.com/plugins/build/plugins),
[Extensions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md).
The installed GitHub callback/UI path still needs normal host acceptance.
