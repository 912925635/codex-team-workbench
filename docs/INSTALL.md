# Installation, GitHub source and data retention

## Repository import

The root `.agents/plugins/marketplace.json` lists `team-workbench` at `./`.
The marketplace root is the repository root, not `.agents/plugins`.

The verified workspace-admin route is **Admin > Plugins > Add > Import marketplace**:

- Source: `https://github.com/912925635/codex-team-workbench`
- Path: empty
- Branch: `main`, or pin a reviewed full commit instead

Then review import results, installation policy and the three plugin Hooks.
Workspace import requires an administrator and GitHub access to the repository.
It can synchronize future source changes; it is not a guarantee that an existing
MCP process hot reloads. See the [official GitHub guide](https://learn.chatgpt.com/docs/enterprise/plugin-management).

A GitHub connector connection alone does not install a plugin. The admin route
is not assumed to exist on a personal-only account. This project does not invoke
a separately installed Codex CLI or guess personal-client menu names.
The [local source documentation](https://developers.openai.com/plugins/build/plugins)
is a separate installation mechanism from workspace import.
See [marketplace updates](MARKETPLACE.md) for stable identities, branch tracking
and the difference between source sync, installation and a live MCP connection.

## Prerequisites

Node.js 24+ must already be available (`node:sqlite` is built in). There are no
npm dependencies or API keys. Windows public native-parent metadata reading uses
an existing PowerShell 7. The native host must expose the needed Hooks,
collaboration tools and MCP App messaging. A different Codex CLI version is not
a substitute for those capabilities. No minimum desktop-shell build is claimed.

The MCP command is `node ${PLUGIN_ROOT}/src/server.mjs`, using the plugin root
as cwd. Both manifests and the marketplace point to files in this repository.

## Existing private plugin versus GitHub source

A personal private plugin and a new workspace or marketplace installation can
have different host identities and PLUGIN_DATA roots even with the same name.
This public marketplace intentionally contains no personal backend plugin ID.
Do not assume it adopts the private plugin or copies its database.

Before changing the user's active installation:

1. Confirm the existing plugin identity and actual data root; create a consistent
   backup and record board/task/member IDs and records through the authorized plugin.
2. Preserve the existing default prompt, MCP settings and user appearance.
3. Import the reviewed source without uninstalling or deleting the old instance.
4. Verify the new actual protocol version and data root. If identity differs,
   perform an explicitly authorized data migration; do not silently copy, reset,
   merge or delete databases. Avoid enabling two active workbenches for the same scope.
5. Keep the old source and backup until the native UI and retained data pass checks.

The isolated actual-0.4.6-source migration preserved 28 synthetic tasks, three
members, immutable work records and panel selection, including old-version
read-back. That does not prove automatic data transfer between plugin identities.

Data root order is TEAM_WORKBENCH_DATA, otherwise PLUGIN_DATA/team-workbench,
otherwise .team-workbench in the server working directory. Never locate data by
reading private host session directories or transcript databases.

## Normal Hook review

The source declares SubagentStart, SubagentStop and PreModelRequest through
`./examples/hooks/hooks.json` in portable and compatibility manifests.
Installing the plugin does not bypass host review. Use **Settings > Hooks** or
**Review hooks** in the composer and inspect the actual plugin source.
Untrusted definitions do not execute. Changed bundled scripts may need review again.
See [official Hook review](https://learn.chatgpt.com/docs/hooks).

The handler keeps only lifecycle IDs, event/type and receipt time for roots
explicitly bound to active workbenches. No prompts, chat content, tool payloads,
credentials or token data are retained. Approve this scope before enabling it;
a development probe limited to one root grants no additional collection scope.

A development probe and plugin handler write separate journals. The UI consumes
one journal only. Verify plugin-owned source, trust, actual callbacks and MCP
projection before retiring only the exact development definitions. The migration
helper generates a plan and never edits config or trust. Preserve unrelated hooks.

## Verify before replacing the old instance

Confirm the actual panel protocol version, not just the repository or account
release. Closing a panel is not verified to reload an old MCP process. Follow
only an actual supported refresh route; a whole-client restart needs approval
when it would interrupt other work.

The GitHub-installed UI remains unaccepted in this snapshot. Manual checks are:
open the intended board; inspect native parent/child nodes and automatic state
changes; open the selected child; submit an explicit same-child continuation and
check its real receipt. Missing agents or capabilities must fail visibly and
must never spawn a substitute. Full native transcript coverage is not claimed.

## Develop, package or remove

Run `npm run check`, `npm test` and `npm run review:public`. `npm run preview`
is a loopback-only development view, not an installed-host test.
`npm run pack:local` uses the same source/privacy allowlist to build a ZIP under
artifacts. No script registers sources, installs software, trusts Hooks or starts models.

Disable or uninstall only the selected instance using supported native controls.
Keep its data backup. Do not delete host-wide sessions, other plugins or project
files, and do not use another Codex CLI to manage the desktop installation.
MIT and the DeepSeek Harness attribution must remain in redistributed source.
