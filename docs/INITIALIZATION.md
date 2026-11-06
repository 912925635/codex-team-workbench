# Workbench synchronization initialization

New workbenches have an explicit automatic-history choice. In the panel, select
that choice when creating the board. An exact originating UUID can be supplied
immediately; otherwise the board displays a pending association until its main
agent registers the real identity. Uncheck the choice for manual-only creation.

For a main agent with a trusted, exact native UUID and user-approved sync scope:

```json
{
  "title": "Research workbench",
  "sessionId": "00000000-0000-4000-8000-000000000001",
  "nativeIdSource": "host-env",
  "evidence": "Exact UUID from this originating main conversation",
  "automaticHistory": true,
  "confirmed": true
}
```

The UUID above is synthetic; substitute the actual originating identity. An
inherited worker environment, a runtime path, an anonymous plugin session or a
nearby conversation is not a substitute. When identity is unavailable, omit
`sessionId` and register the correctly sourced lead identity before dispatching
children. This completes a previously confirmed pending choice automatically.

An explicitly sourced lead report establishes the first unbound association;
it alone never authorizes visible-text collection. Child reports cannot bind
the workbench. Existing bindings still require explicit old/new confirmation to
change, and pending consent never transfers to a different root. An explicit
disable or cancellation is not undone by later identity reports.

The automatic-sync button also provides one-step initialization for an existing
unbound board. Its recorded lead UUID is offered for confirmation. Pending setup
can be cancelled before a UUID is known; an unavailable reader remains visibly
pending rather than being reported as enabled.

Title-only legacy tool calls still create manual boards. No new model, agent,
CLI, Hook trust change, private-session scan or data migration is performed by
initialization. New visible pages still require a real stop and exact public
parent-chain verification; historical work records are preserved.
