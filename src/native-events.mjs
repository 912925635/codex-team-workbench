import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isThreadId } from './history-sync.mjs';

// Explicit plugin-owned journal only. Never opens a host session store.
export function syncNativeEvents(store, boardId) {
  const path = store.nativeEventJournal;
  if (!path) return { enabled: false, state: 'disabled', applied: 0 };
  if (!existsSync(path)) return { enabled: true, state: 'waiting-for-callback', applied: 0 };
  const board = store.read(boardId);
  if (!isThreadId(board.rootSessionId) || board.archivedAt) return { enabled: true, state: 'unbound-or-archived', applied: 0 };
  const source = createHash('sha256').update(resolve(path)).digest('hex');
  const db = new DatabaseSync(path, { readOnly: true });
  let applied = 0;
  try {
    const last = store.db.prepare('SELECT MAX(seq) AS seq FROM native_event_receipts WHERE board_id=? AND source=?').get(boardId, source).seq ?? 0;
    const rows = db.prepare("SELECT seq,payload,observed_at FROM events WHERE seq>? AND json_extract(payload,'$.sessionId')=? ORDER BY seq LIMIT 1000").all(last, board.rootSessionId);
    for (const row of rows) {
      const event = JSON.parse(row.payload);
      if (event.sessionId !== board.rootSessionId || !['SubagentStart', 'SubagentStop', 'PreModelRequest'].includes(event.event) ||
          !isThreadId(event.agentId) || event.agentId === board.rootSessionId || !Number.isFinite(Date.parse(row.observed_at))) continue;
      const seen = store.db.prepare('SELECT 1 FROM native_event_receipts WHERE board_id=? AND source=? AND seq=?').get(boardId, source, row.seq);
      if (seen) continue;
      let inserted = false;
      store.transact(boardId, b => {
        // Repeat identity checks inside the same write transaction as the projection.
        if (b.rootSessionId !== event.sessionId || b.archivedAt) return false;
        const receipt = store.db.prepare('INSERT OR IGNORE INTO native_event_receipts(board_id,source,seq) VALUES (?,?,?)').run(boardId, source, row.seq);
        if (!receipt.changes) return false;
        let member = b.members.find(m => !m.historyOnly && m.nativeId === event.agentId);
        if (!member) {
          if (b.members.length >= 100) throw new Error('Native member limit reached');
          member = { id: `native:${event.agentId}${b.bindingGeneration ? `:binding-${b.bindingGeneration}` : ''}`, name: event.agentType || 'subagent', role: 'member',
            parentId: 'lead', relation: 'session_association', source: 'hook', nativeId: event.agentId,
            nativeIdentity: { source: 'native-command-hook', observedAt: row.observed_at,
              verification: 'local-input-not-attested', evidence: 'Documented Subagent lifecycle agent_id; exact public activity can independently verify this UUID.' } };
          b.members.push(member);
        }
        // Late earlier-turn callbacks cannot regress a newer observation.
        if (!member.runtimeObservation || Date.parse(row.observed_at) >= Date.parse(member.runtimeObservation.observedAt)) {
          const start = event.event !== 'SubagentStop';
          member.status = start ? 'start_observed' : 'stop_observed';
          member.observedAt = row.observed_at;
          member.runtimeObservation = { state: start ? 'running' : 'idle', observedAt: row.observed_at,
            source: 'native-command-hook', sourceThreadId: event.sessionId, resumeAvailable: false,
            verification: 'local-input-not-attested', evidence: event.event,
            turnId: event.turnId, terminalSuccess: null };
          member.nativeLifecycle = { event: event.event, observedAt: row.observed_at, turnId: event.turnId };
        }
        store.event(b, 'native_lifecycle', `${member.id}: ${event.event}`);
        b.events.at(-1).at = row.observed_at;
        inserted = true;
      });
      if (inserted) applied++;
    }
    return { enabled: true, state: 'connected-to-local-hook-journal', applied };
  } finally { db.close(); }
}
