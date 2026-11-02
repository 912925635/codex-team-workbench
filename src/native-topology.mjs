import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isThreadId } from './history-sync.mjs';
// Keep helper source with the live MCP connection, just like the self-contained UI.
// A native plugin update may prune old cache files before that connection reloads.
let metadataScript = null;
try { metadataScript = readFileSync(new URL('./read-native-metadata.ps1', import.meta.url), 'utf8'); } catch {}

export function readNativeMetadata(threadIds) {
  if (!threadIds.length || threadIds.length > 100 || !threadIds.every(isThreadId)) throw new Error('Invalid metadata scope');
  if (!metadataScript) throw new Error('Public metadata helper was unavailable at startup');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(metadataScript, 'utf16le').toString('base64')], {
    input: JSON.stringify({ threadIds }), encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 1048576
  });
  if (result.status !== 0) throw new Error('Public metadata connection unavailable');
  const data = JSON.parse(result.stdout);
  if (!data.connected || !Array.isArray(data.threads)) throw new Error('Public metadata response unavailable');
  return data.threads.filter(row => threadIds.includes(row.id));
}

export function topologyPlan(rootId, members, metadata) {
  const rows = new Map(metadata.filter(row => isThreadId(row.id)).map(row => [row.id, row]));
  const plans = [];
  for (const member of members.filter(m => !m.historyOnly && m.nativeId !== rootId && isThreadId(m.nativeId))) {
    let id = member.nativeId, visited = new Set(), parentId = null, reason = null;
    while (id !== rootId) {
      if (visited.has(id) || visited.size >= 100) { reason = 'cyclic-or-too-deep'; break; }
      visited.add(id);
      const row = rows.get(id), declared = row?.source?.subAgent?.thread_spawn?.parent_thread_id;
      if (!row || !isThreadId(row.parentThreadId)) { reason = 'parent-metadata-unavailable'; break; }
      if (declared && declared !== row.parentThreadId) { reason = 'conflicting-parent-metadata'; break; }
      if (id === member.nativeId) parentId = row.parentThreadId;
      id = row.parentThreadId;
    }
    if (reason || id !== rootId) { plans.push({ memberId: member.id, verified: false, reason: reason ?? 'outside-bound-root' }); continue; }
    const parent = parentId === rootId ? members.find(m => m.id === 'lead') : members.find(m => !m.historyOnly && m.nativeId === parentId);
    if (!parent) { plans.push({ memberId: member.id, verified: false, reason: 'parent-not-recorded' }); continue; }
    const path = rows.get(member.nativeId)?.source?.subAgent?.thread_spawn?.agent_path;
    if (member.runtimeRef && path && member.runtimeRef !== path) { plans.push({ memberId: member.id, verified: false, reason: 'runtime-path-conflict' }); continue; }
    plans.push({ memberId: member.id, verified: true, parentId: parent.id, parentThreadId: parentId,
      runtimeRef: typeof path === 'string' && /^\/root(?:\/[a-z0-9_]+)+$/.test(path) ? path : null });
  }
  return plans;
}

export function syncNativeTopology(store, boardId) {
  if (!store.nativeMetadataReader) return { state: 'not-connected' };
  const b = store.read(boardId);
  if (b.archivedAt || !isThreadId(b.rootSessionId)) return { state: 'unbound-or-archived' };
  const members = b.members.filter(m => !m.historyOnly && m.id !== 'lead' && isThreadId(m.nativeId));
  if (!members.length || members.every(m => m.nativeTopology?.rootThreadId === b.rootSessionId)) return { state: 'up-to-date' };
  const key = `${boardId}:${members.map(m => m.nativeId).join(',')}`;
  store.metadataAttempts ??= new Map();
  if (Date.now() - (store.metadataAttempts.get(key) ?? 0) < 30000) return { state: 'retry-pending' };
  store.metadataAttempts.set(key, Date.now());
  let rows;
  try { rows = store.nativeMetadataReader(members.map(m => m.nativeId)); }
  catch { return { state: 'public-metadata-unavailable' }; }
  const plans = topologyPlan(b.rootSessionId, b.members, rows), verified = plans.filter(p => p.verified);
  if (!verified.length) return { state: 'unverified', reasons: [...new Set(plans.map(p => p.reason))] };
  let applied = 0;
  store.transact(boardId, current => {
    if (current.rootSessionId !== b.rootSessionId || current.archivedAt) return false;
    for (const plan of verified) {
      const m = current.members.find(m => m.id === plan.memberId && !m.historyOnly);
      if (!m || m.nativeTopology?.rootThreadId === current.rootSessionId) continue;
      m.previousReportedParent ??= { parentId: m.parentId, relation: m.relation ?? null };
      m.parentId = plan.parentId; m.relation = 'public-native-parent';
      if (plan.runtimeRef) m.runtimeRef ??= plan.runtimeRef;
      if (m.workflowId && !current.workflows?.some(w => w.id === m.workflowId && w.parentMemberId === m.parentId)) {
        m.previousWorkflowId = m.workflowId; m.workflowId = null;
      }
      m.nativeTopology = { rootThreadId: current.rootSessionId, parentThreadId: plan.parentThreadId,
        source: 'app-server.thread/read metadata', observedAt: new Date().toISOString() };
      store.event(current, 'native_parent_verified', `${m.id}: ${plan.parentThreadId}`); applied++;
    }
    if (!applied) return false;
  });
  return { state: 'verified-public-parent-chain', applied, unresolved: plans.filter(p => !p.verified).length };
}
