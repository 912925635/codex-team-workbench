# Third-party notices

Task transition and optimistic revision semantics in `src/store.mjs` were
adapted from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
commit `ce7073d51254c26cd63b22a60835b8f948deb447`:

- `packages/experimental/agent-team/src/task-board.ts`
- Copyright (c) 2026 DeepSeek; MIT License.
- The full original notice is retained in `LICENSES/DeepSeek-Harness-MIT.txt`.

This adaptation replaces DSH's Cordis agent/session services and lead journal
with a local SQLite store and caller-declared workflow roles. It does not retain
DSH's runtime identity guarantees. There are no advisory file scopes or file locks.
UI and transport code are new implementations; no DSH branding assets are used.

MCP and MCP Apps protocol implementations follow their published specifications.
No third-party runtime packages or SDK code are bundled in this prototype.
The screenshot supplied for design reference, raw research downloads, personal
paths, runtime data, credentials, and chat content are excluded from the package.
