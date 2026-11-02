# Interface matrix

| Capability | Implementation and limit |
| --- | --- |
| Persistent tasks and DAG | Local SQLite, atomic revision-checked changes |
| Workbench panel | MCP tool metadata and self-contained HTML resource; host UI support required |
| Parent/child tree | Explicit recorded direct-parent edges and workflow grouping |
| Native child identity | Exact public parent activity path/UUID matching relayed by the lead |
| Visible history | Bounded selected public host pages, not complete native transcripts |
| Refresh | Saved board and open-node data reads, not native chat synchronization |
| Runtime state | Actual collaboration observations relayed by the originating lead, timestamped and expiring |
| Navigation | Lead requests public host navigation to the exact bound UUID; user-visible success requires host verification |
| Continuation | Explicit user request through the actual parent's supported collaboration tools; no direct V2 app-server input |
| Automatic discovery | No independent background discovery or model control in MCP |
| Authentication | Workflow roles and supplied IDs are caller-declared, not authenticated identities |

Published references: [MCP Apps](https://github.com/modelcontextprotocol/ext-apps),
[OpenAI plugin UI](https://developers.openai.com/plugins/build/chatgpt-ui),
[Codex app-server](https://learn.chatgpt.com/docs/app-server).
Public-source schemas and a host's installed capabilities may differ; check the
actual target host before enabling a dependent operation.
