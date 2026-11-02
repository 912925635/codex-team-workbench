// Pure plan only: no filesystem, installation, trust mutation or process control.
export function planDevelopmentHookRetirement(current, expected, pluginHooks, pluginId) {
  const normalize = name => String(name).replaceAll('_','').replaceAll('-','').toLowerCase();
  const required = ['SubagentStart','SubagentStop','PreModelRequest'];
  if (!pluginId || !required.every(event => pluginHooks.some(h => h.pluginId === pluginId &&
      h.enabled === true && h.trustStatus === 'trusted' && normalize(h.eventName) === normalize(event)))) {
    return { allowed: false, reason: 'PLUGIN_HOOKS_NOT_VERIFIED' };
  }
  const next = JSON.parse(JSON.stringify(current));
  const removed = [];
  for (const [event, groups] of Object.entries(expected.hooks ?? {})) {
    for (const group of groups) {
      const entries = next.hooks?.[event];
      if (!Array.isArray(entries)) return { allowed: false, reason: 'DEVELOPMENT_DEFINITION_CHANGED' };
      const matches = entries.map((entry,index) => JSON.stringify(entry) === JSON.stringify(group) ? index : -1).filter(i=>i>=0);
      if (matches.length !== 1) return { allowed: false, reason: 'DEVELOPMENT_DEFINITION_CHANGED' };
      const index = matches[0];
      // Removing a non-last group shifts other hooks' positional trust keys.
      if (index !== entries.length - 1) return { allowed: false, reason: 'POSITIONAL_TRUST_RISK' };
      entries.splice(index,1);if (!entries.length) delete next.hooks[event];
      removed.push({event,index});
    }
  }
  return { allowed: true, proposedConfiguration: next, removed, trustModified: false, applied: false };
}
