# Interface evidence matrix: 0.5.1

| Path | Evidence and current behavior | Boundary |
| --- | --- | --- |
| Conversation panel | MCP App resource and thread entrypoint are implemented; previous installed panels rendered | New GitHub-installed UI activation remains unaccepted |
| Current native root identity | Explicit full UUID binding from an authorized source | Anonymous openai/session correlation is not a native thread ID; the thread entrypoint does not supply one |
| Native execution | Lead uses actual host collaboration tools, then records dispatch/result/confirmation | MCP assignment alone does not spawn; no separate model/app-server team is substituted |
| Automatic lifecycle | Real SubagentStart/Stop and PreModelRequest callbacks reached journal and MCP snapshots | Source publication is not plugin-owned installation/trust verification |
| Same-child continuation | Actual followup_task reused the same child UUID; PreModelRequest restored running state | Exact live parent and supported collaboration capability required; direct V2 app-server input is not a fallback |
| Long work | Real 135-second timer stayed running/unconfirmed after freshness expired, then idle after actual stop | Freshness is confidence, not successful task completion |
| Native topology | Public thread/read parent metadata verified actual children and grandchild | A shared root association cannot invent parent edges; this is not unrestricted thread enumeration |
| Runtime status | Hook event and observation timestamps drive state labels | A separate control process's notLoaded is not desktop liveness or inability to resume |
| Navigation | Native navigate_to_codex_page returned navigated=true; isolated exact-target receipt persisted | Navigation acknowledgment is not a visual UI check |
| Visible history | Lead-mediated public read_thread pages for exactly bound nodes; bounded, paginated and source-labeled | Not full tool/reasoning transcript coverage |
| Workflows | Workbench-owned grouping preserves actual agent parents separately | Not a claim of a native host workflow object |
| GitHub import | Root Codex marketplace and portable/compatibility manifests | Verified automatic workspace sync requires an admin; personal-client import is not presumed |
| Data update | Actual previous account-source isolated migration and old read-back preserved synthetic data | A different source identity may have a different PLUGIN_DATA root |

Native task metadata and control-process handshake reported different versions;
no interchangeable-runtime or minimum desktop-build claim is made.

Primary references: [Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md),
[Hooks and normal review](https://learn.chatgpt.com/docs/hooks),
[plugin package structure](https://developers.openai.com/plugins/build/plugins),
[GitHub workspace source import](https://learn.chatgpt.com/docs/enterprise/plugin-management).

See [acceptance status](ACCEPTANCE_0.5.1.md) for actual versus uncompleted checks.
No private host session directory, database, transcript or credential is used.
