# Exact identity and bounded history synchronization

The UI can request the active lead to read a precisely associated node's public
visible history. It cannot enumerate arbitrary native chats or treat a canonical
agent path as a native thread UUID.

The identity protocol is implemented by team_bind_agent_activity:

1. Obtain the full actual spawning-parent UUID from an authorized source.
2. Use the host's public thread reader only for that parent; locate exact
   subAgentActivity.agentPath matches for the recorded runtimeRef.
3. Submit the observed activity to deterministic MCP matching. Zero or conflicting
   matches remain blocked; never guess a suffix or use the development thread.
4. Follow the returned exact child nextRead target. Independently verify thread.id
   before importing one bounded visible-history page through team_import_thread_page.
5. Retain source thread, read time, cursor, truncation/partial coverage and failure
   evidence. Keep an earlier successful snapshot visible after a later failure.

Public parent metadata can also verify exact native ancestry and path for a known
UUID. Sharing the same session association alone establishes no parent edge.
Normal native Hook ingestion is automatic lifecycle observation, not automatic
full transcript retrieval. History reads remain explicit, lead-mediated and bounded.

Use only actually available host read tools. If unavailable, record that concrete
blocker and stop; do not read private session files, invent messages, launch another
model, or retry indefinitely. Omit reasoning and unrequested tool payloads.

The panel distinguishes reported work records, original dispatch instructions,
reported outcomes and relayed visible conversation pages. None is called a full
native transcript. Fresh snapshots and older-page cursors preserve exact identity.
The Skill documents the concrete current request protocol.
