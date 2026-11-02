export function runtimeView(member, now = Date.now()) {
  const observation = member.runtimeObservation;
  if (!observation) return null;
  const age = now - Date.parse(observation.observedAt);
  const fresh = Number.isFinite(age) && age >= -30000 && age <= 120000;
  const native = observation.source === 'native-command-hook';
  if (native && observation.state === 'running') return {
    state: 'running', fresh, terminalObserved: false,
    label: fresh ? '已收到原生运行证据 · 尚未收到停止' : '运行后未收到停止 · 当前活跃性待确认',
    // Expiry changes confidence, never manufactures a terminal event.
    liveness: fresh ? 'recent-start' : 'unconfirmed', outcome: 'unknown'
  };
  if (native && observation.state === 'idle') return { state: 'idle', fresh, terminalObserved: true,
    label: '已收到回合停止 · 任务结果另行核验', liveness: 'turn-stopped', outcome: 'unknown' };
  return { state: observation.state, fresh, terminalObserved: ['completed','failed','cancelled'].includes(observation.state),
    label: observation.state, liveness: fresh ? 'recent-report' : 'unconfirmed', outcome: 'reported' };
}
