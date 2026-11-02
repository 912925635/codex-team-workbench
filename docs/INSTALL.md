# Installation, update and removal

Requires Node.js 24+ and a host supporting local stdio MCP; rendering also requires
MCP Apps UI support. This is a local-process plugin, not a hosted web service.
The portable manifest is plugin.json with mcp.json; compatibility manifests are
.codex-plugin/plugin.json and .mcp.json. The server command is node
${PLUGIN_ROOT}/src/server.mjs and cwd is ${PLUGIN_ROOT}.

Build with npm run check, npm test and npm run pack:local. Import the ZIP through
the target client's supported plugin workflow if it accepts local stdio plugins.
Do not assume ZIP upload on every web/mobile surface can run a local process.
If a host does not support local plugins, use the standalone preview or a supported
local MCP client. No external Codex CLI is required to run the Node server.

Before updating/removing, back up the explicit plugin-owned data directory.
Data priority: TEAM_WORKBENCH_DATA, PLUGIN_DATA/team-workbench, .team-workbench
under cwd. Keep source and runtime data separate. Do not search private host
session stores to discover this directory. No startup migration deletes tasks.

Installation on disk does not prove an existing host connection has reloaded.
Use the host's supported plugin reconnect/update flow and inspect the displayed
UI version and server initialization version. Closing only the panel may retain
an older connection. Do not stop unrelated tasks or restart the host automatically.
Each current server retains its complete UI in memory to survive cache pruning.

Archive hides a workbench reversibly; restore it from the archived-board list.
Archive is not uninstall. To uninstall the plugin, use the actual host's plugin
manager and verify its result; preserve data separately if it is still needed.
