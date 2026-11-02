# Resource lifecycle and binding behavior

An older connected MCP process can keep tool code in memory while an installer
removes its version's UI files. Loading those files lazily can then fail even
while task tools still return data. Current versions retain the complete HTML
at startup and return missing-resource errors with the original JSON-RPC ID.
Versioned UI URIs distinguish fresh resources; the unversioned alias is retained.

A real host reconnect is still needed to use new server code. No update script
kills a host process or rewrites the installed cache. Check the actual host's
connection and UI version rather than assuming on-disk installation is active.

Binding edits require a full UUID and explicit old/new confirmation. Old members,
executions and pages retain their sources and cannot silently become the new
conversation. Archive/restore only changes board visibility, not project files.
