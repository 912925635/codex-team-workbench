# Linux server synchronization (0.5.4)

## Adapter gap in 0.5.3

0.5.3 registered native metadata/history readers only with `PLUGIN_DATA` on
Windows. Linux readers were null even when lifecycle Hooks worked. The combined
tooltip incorrectly left these two conditions indistinguishable.

0.5.4 adds a dependency-free Node reader for Linux. Windows
keeps its PowerShell reader. This change is not deployed to the user's server.

## Runtime requirements

- Existing Node.js 24+ runs the MCP backend and Hook command. Linux does not
  need PowerShell or an additional Codex CLI.
- The backend receives the existing `PLUGIN_DATA` context. MCP and Hooks must
  resolve the same plugin-owned data directory; the resolver/schema are unchanged.
- The same user's existing native runtime exposes
  `<CODEX_HOME>/app-server-control/app-server-control.sock`. When `CODEX_HOME`
  is unset, Linux uses the backend user's home plus `.codex`. Only this standard
  path is used, including a host-created symlink; no session directories,
  databases or `/tmp` are enumerated.
- That runtime supports `initialize`, `thread/read` and `thread/turns/list`, and
  allows reads of the explicitly bound root/child IDs and their parent chain.
- Reviewed native lifecycle Hooks actually execute in that runtime. A different
  machine, container, service user or home can have a different socket namespace.

A runtime exposing only stdio cannot be attached through this Unix reader.
The plugin does not start a replacement app-server/team, change permissions,
expose a network listener or create a tunnel. Hook lifecycle state and saved
work records remain separate from automatic visible-history reads.

## Data path and diagnostics

The standalone helper upgrades an existing Unix connection to WebSocket and
uses only initialization and the two read-only methods. It never starts,
resumes or sends input to a native thread. The helper source is cached at MCP
startup and supports synchronous explicit reads plus asynchronous background jobs.

`SubagentStart`, `SubagentStop` and `PreModelRequest` definitions are unchanged.
Callbacks remain metadata-only, limited to roots bound to active workbenches.
The MCP filesystem watcher reads the plugin journal, and after board opt-in a
stop schedules one visible page. History is not fetched by the Hook command or
by model polling. A missing endpoint pauses scheduling; a later event or panel
snapshot can recover after the socket becomes available.

Automatic-sync status now separates `hookJournal` from `publicHistory`, and the
disabled button uses the actual reason. Socket presence permits an attempt;
it does not confirm live RPC support or a thread's permissions.

| Diagnostic | Meaning |
| --- | --- |
| `PUBLIC_PLUGIN_CONTEXT_MISSING` | The backend did not receive `PLUGIN_DATA`. |
| `PUBLIC_SOCKET_MISSING` | No socket resolves for this user/home, including a stale symlink. |
| `PUBLIC_SOCKET_PERMISSION` | OS access denied; no permission changes or bypass attempted. |
| `PUBLIC_SOCKET_NOT_SOCKET` | The control path resolves to a different file type. |
| `PUBLIC_RPC_ERROR` | Read rejected; failure keeps the method and numeric code, not the host error body. |
| `PUBLIC_PARENT_UNVERIFIED` | Exact parent/runtime metadata did not match; no history body was requested. |
| `PUBLIC_READ_TIMEOUT` | Read deadline reached; prior saved records remain. |

Raw messages have a 1 MiB limit. Each page contains at most one turn, 20 visible
text items, 1000 characters per item and 8000 total. Reasoning, tool bodies and
non-text input are discarded before JSON reaches the MCP process. Empty pages,
older cursors and truncation remain explicit.

## Verification

In this source directory, use the server's existing Node:

```sh
node scripts/check.mjs
node scripts/test.mjs
node scripts/review-public.mjs
```

Tests use synthetic data and their own local RPC server, never the user's
runtime/model. Windows transport tests use a named pipe; Linux uses a Unix
socket. The Linux-only integration additionally checks default readers, both
child-process modes and the packaged Hook-to-watch-to-record path. It is skipped
on Windows. Portable protocol tests also exercise fragmentation, handshake
refusal, RPC errors, parent mismatch, limits, cancellation and timeout.

Development/testing here runs on Windows. WSL distro enumeration returned
`E_ACCESSDENIED`; no permissions or software were changed. Native Linux execution
and the user's actual server/UI therefore remain unverified. Fixtures do not
prove a particular server has the socket, trusted Hooks or authorized history.

References: [Codex transports/read APIs](https://learn.chatgpt.com/docs/app-server),
[Node Unix HTTP socket support](https://nodejs.org/api/http.html).
