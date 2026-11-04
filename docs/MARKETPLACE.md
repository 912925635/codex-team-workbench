# GitHub marketplace and updates

Repository: <https://github.com/912925635/codex-team-workbench>

This repository is already a standard Codex marketplace. Its discovery manifest
is `.agents/plugins/marketplace.json`, with one plugin at `source.path: "./"`.
Paths are relative to the repository root, not the manifest directory.
The marketplace name is `codex-team-workbench`; the plugin name is
`team-workbench`. Preserve both when updating. Portable `plugin.json` and native
`.codex-plugin/plugin.json` declare the same version, currently `0.5.4`.

## Add or update the source

Use the GitHub marketplace entry supported by the current desktop client. If
this repository was already added, update that existing source rather than
creating a private ZIP plugin or a second marketplace with a different name.
Track branch `main` to receive later commits. A source pinned to an immutable
commit intentionally stays at that commit.

For workspace administrators, the documented route is **Admin > Plugins >
Add > Import marketplace**. Enter the repository URL above, leave **Path** empty
and choose branch **main**. Inspect import results and existing-plugin identity
before installing. This admin route is not assumed to exist in a personal-only
account. The personal desktop client's exact update button has not been
visually verified by this project; no alternative Codex CLI is required or used.

## What the host updates

There are three distinct steps:

1. **Marketplace sync** reads the latest repository and discovers its plugin.
2. **Plugin update** installs the selected source version under the existing
   plugin identity, according to the host's policy and user approval.
3. **Connection reload** starts a backend using that installed version.
   Reopening a panel alone is not verified to replace an old live MCP process.

The workspace documentation describes a daily automatic marketplace sync and
branch tracking. This does not prove that a personal desktop client offers
the same schedule, one-click update control, unattended plugin upgrade or live
MCP hot reload. These are host capabilities, not a marketplace-manifest setting.
This project installs no separate updater, edits no host cache and does not
restart the client. Use the actual supported source-sync/update controls and
verify the resulting panel reports **插件协议已连接 · 0.5.4**.

## Preserve history

The data resolver is unchanged: `TEAM_WORKBENCH_DATA`, otherwise
`PLUGIN_DATA/team-workbench`, otherwise `.team-workbench` in the server cwd.
The workbench database and Hook journal are outside the public source allowlist.
Source publication never reads, resets or uploads them.

Keeping the same marketplace/plugin names is necessary for the existing local
identity. The host still owns its identity and `PLUGIN_DATA` assignment; verify
the actual data root and a consistent backup before an installation update.
A new private ZIP instance is not presumed to share a GitHub instance's data.
Do not uninstall the existing instance or silently copy databases to compensate.

After updating, review changed Hooks through the normal host review. The
packaged handlers cover only roots explicitly bound to active workbenches;
automatic visible-history synchronization remains a separate per-board opt-in.
Keep unrelated Hooks unchanged and avoid enabling a duplicate development probe
for the same scope. See [installation and data retention](INSTALL.md).

## Verified and pending

Source tests validate the marketplace root path, identity, manifests and bundled
Hook resources. Public source is privacy-scanned before publication. Native API
tests and their limits are recorded in [validation](VALIDATION.md).
The actual desktop marketplace update, full panel UI and iframe navigation
remain unverified; a successful source push is not their acceptance result.

Official references: [package and local marketplace format](https://developers.openai.com/plugins/build/plugins),
[workspace GitHub sync](https://learn.chatgpt.com/docs/enterprise/plugin-management).
