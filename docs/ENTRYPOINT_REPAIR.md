# MCP entrypoint and update compatibility

The panel tool advertises an MCP App resource URI. resources/read returns a
self-contained HTML resource with script/style content. Returning board data or
a plain webpage link does not prove that the native panel activated.

UI content and the Windows public-metadata helper are retained by a live MCP
process after startup. This reduces failures when an update prunes old static
helper files while an old connection is still alive. Protocol/resource versions
remain visible; a retained old process is still an old version.

The actual GitHub-installed activation and hot reload remain unverified. Check
which MCP version is connected and which resource URI it advertises before
claiming an update took effect. Closing and reopening a panel does not by itself
prove that the native host replaced its MCP connection. Do not overwrite installed
caches, terminate unrelated processes or restart the client without authorization.

The stdio protocol/resource tests verify advertised metadata, resources/read,
self-contained dependencies and persistence. They cannot replace installed UI
acceptance. Supported connection refresh guidance is documented by OpenAI, but
an available control on a remote-MCP connection is not presumed to exist on every
local plugin installation. Preserve data and source identity during updates.
