# UI and canvas (0.5.7)

The interface is implemented in the existing plain JavaScript and CSS. It adds no
React runtime, package dependency or external resource request.

## Canvas

The zoom toolbar provides zoom in/out, fit and 100% reset. A bounded viewport
keeps repeated fit operations stable. Drag empty canvas space with a mouse or
scroll on touch devices. Refresh and collapse retain the current view.

Circle markers identify ordinary member records, square markers identify workflow
groups, and diamonds identify Hook-source observations. Shape and labels remain
usable without color. A workflow is a display group; it does not start an agent
or replace its actual recorded parent. Hook session associations with an unknown
parent remain root nodes. Lines show display hierarchy rather than a complete
native invocation tree. Only fresh runtime observations drive the runtime effect.

## Task overview and activity

Task completion is calculated from recorded completed tasks divided by recorded
total tasks. It does not measure native-agent liveness. Empty boards display 0%.
Activity cards use saved events and play an entry effect only for new records;
first load and unchanged refresh do not replay it. Reduced-motion settings disable
these effects. Long references remain available in tooltips and node details.

## Update and cache behavior

This release names the UI resource `ui://team-workbench/panel/0.5.7` and declares
`TEAM_WORKBENCH_UI_REVISION=0.5.7` in the plugin's MCP definitions. Older UI resource
aliases remain supported. The MCP process keeps its startup UI to survive cache
pruning, so an existing connection can retain an old interface after files change.
A normal host plugin refresh must reload its component definitions and MCP
connection before reopening a panel. Reading a fresh global connection alone is
not evidence that a particular existing conversation has switched.

The plugin identity, data-directory resolver, task data and Hook definitions are
unchanged. Do not uninstall an existing instance or create a separate identity to
refresh the UI. Hook review remains the host's supported review flow.

## Design references

Information hierarchy was informed by [shadcn Admin](https://github.com/satnaing/shadcn-admin),
node presentation by [React Flow](https://github.com/xyflow/xyflow), activity motion
by [Magic UI](https://github.com/magicuidesign/magicui), and overview composition by
[React Bits](https://github.com/DavidHDev/react-bits). These are visual references;
this plugin does not include their React component implementations.
