# Session browser

The map displays recorded direct-parent relationships. Workflow groups affect
presentation only; they never replace the actual parent edge. Clicking a node
reads its saved records, execution receipts and latest saved host page.

A node with no native UUID cannot read an arbitrary host conversation. The lead
can resolve an exact recorded runtime path using public subAgentActivity metadata
from the exact recorded spawning parent. Ambiguous or missing mappings are saved
as explicit blockers. The plugin never expands a short UUID by guessing.

Saved pages retain thread and item IDs, source, read time, pagination and truncation
scope. Hidden reasoning is excluded. Existing successful pages remain visible if
a later synchronization fails. Binding changes isolate old sources; only an exact
public match can revalidate a legacy short-parent record.

The top refresh reloads saved data and the currently open node. To fetch a new
native page, explicitly request the lead's sync protocol. Native open/continuation
buttons request actual host actions through the lead and require the relevant
capabilities and exact identity checks.
