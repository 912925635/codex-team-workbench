# Codex Team Workbench / 团队工作台

A local MCP plugin for persistent tasks, recorded agent relationships and readable
work records in compatible ChatGPT/Codex hosts. Version **0.4.6**.

这是一个独立的本地插件：共享任务、依赖、成员树、工作流分组和已同步记录放在同一面板。
它不是 OpenAI 或 DeepSeek 官方产品，也没有完成所有桌面宿主的端到端验收。

## Features

- SQLite-backed tasks, owners and dependency checks with optimistic revisions.
- Expandable recorded parent/child relationships and workflow groups.
- Bounded visible conversation snapshots relayed by the lead through public host tools.
- Source-labeled runtime observations; only fresh observed running states animate.
- Lead-mediated navigation and continuation requests when host capabilities exist.
- Explicit binding-change confirmation with old-history isolation.
- Reversible board archive and restore; archiving does not delete project files.
- Refresh feedback for pending, changed, unchanged and failed reads.

## Requirements and quick start

Use an existing **Node.js 24+** installation with `node:sqlite`. No third-party npm
runtime dependencies or API keys are required for local preview and tests.

```sh
npm run check
npm test
npm run preview
```

Open the loopback URL printed by preview. The preview is a standalone local UI,
not proof that a host has activated a conversation panel or native agent tools.
It starts empty and saves real local data. Stop it with Ctrl+C.

For stdio MCP, the entrypoint is `node src/server.mjs`, with this directory as cwd.
It waits for JSON-RPC on stdin. See [installation](docs/INSTALL.md) for packaging,
data location, updates and removal. Use your target host's native plugin flow;
do not assume a separately installed Codex CLI manages the running desktop host.

```sh
npm run pack:local
```

This creates `artifacts/team-workbench-local-0.4.6.zip`. The archive contains this
plugin's code, manifests, tests and licenses, excluding runtime data and private
artifacts. No package/test script installs a plugin or changes host settings.

## What refresh and automation mean

The top refresh calls `team_snapshot` to read saved board data. If a node is open,
it also calls `team_read_records`. It **does not fetch new native chat messages**.
It reports success, unchanged data, or failure visibly and suppresses duplicate
pending requests. Snapshot notices show saved visible-message counts and time.

Native work is orchestrated by the **actual originating lead conversation**.
The MCP server cannot invoke the model's internal collaboration tools. The lead
must have the relevant public host tools and follow the bundled Skill to register
actual parent IDs, relay exact public activity mappings, observe state and import
selected visible history. These are lead-relayed observations, not authenticated
background telemetry. Without new observations, running animation expires after
two minutes. Navigation and continuation are requests to the lead, not proof that
a native conversation opened or resumed. Unsupported operations stay unavailable.

No private host session files, conversation databases or hidden host APIs are read.
Starting another app-server does not attach this plugin to the desktop's live agents.
Full native transcripts and universal desktop compatibility are not claimed.
See [interface matrix](docs/INTERFACE_MATRIX.md) and [validation](docs/VALIDATION.md).

## Data and privacy

The data directory is selected in this order: `TEAM_WORKBENCH_DATA`, then
`PLUGIN_DATA/team-workbench`, otherwise `.team-workbench` under cwd. Share one
explicit data directory only when intended. Back it up before changing hosts or
upgrading. It can contain tasks, supplied thread IDs and selected visible messages;
**do not commit or share it**. The repository and distribution exclude real data.
User-supplied roles, bindings and host observations are not authentication boundaries.

## License and attribution

[MIT](LICENSE). Task transition/revision semantics are adapted from
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), commit
`ce7073d51254c26cd63b22a60835b8f948deb447`. Its original MIT notice is retained in
[LICENSES](LICENSES/DeepSeek-Harness-MIT.txt); see [third-party notices](THIRD_PARTY_NOTICES.md).
