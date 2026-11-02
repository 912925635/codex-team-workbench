# Execution flow

1. Record a requested task execution; this starts no model.
2. The authorized lead uses its host's actual native collaboration spawn tool.
3. Record the real spawn receipt and exact direct parent/runtime reference.
4. The child records work start and result; the lead collects and confirms the
   result before the task becomes completed.
5. Observe actual collaboration state for the exact member and parent identity,
   relay timestamped observations, and synchronize selected visible history.

If the host lacks the needed collaboration or history tools, the plugin cannot
supply them. It does not silently start an external worker app-server. A separately
launched app-server is a distinct execution environment, not the desktop team.

Task transition and revision semantics were adapted from DSH's task-board.ts.
DSH uses its own agent/session/projection services and routes; this plugin replaces
those with a local store and host-mediated requests. The DSH runtime integration
cannot be copied into another host unchanged. See THIRD_PARTY_NOTICES.md.
