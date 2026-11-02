(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const button = (label, action, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = action; return b; };
  const names = { unknown: '状态未知', working: '上报：工作中', idle: '上报：空闲', completed: '上报：已完成', blocked: '上报：受阻', running: '上报：运行中', failed: '上报：失败', cancelled: '上报：已取消' };
  const sources = { reported: '代理上报', manual: '手动记录', hook: '生命周期观察' };
  const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供';
  class WorkbenchBrowser {
    constructor({ bridge, getBoard, openTask, runNames }) {
      Object.assign(this, { bridge, getBoard, openTask, runNames }); this.folded = new Set(); this.serial = 0;
      $('close-node').onclick = () => this.close();
      $('node-detail').addEventListener('cancel', () => { this.serial++; this.active = null; });
    }
    close() { this.serial++; this.active = null; $('node-detail').close(); }
    renderMap() {
      const board = this.getBoard(), nodes = board.sessionTree ?? [];
      const tree = el('div', 'map-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', '已登记会话与工作流');
      const branch = (node, level) => {
        const entity = (node.kind === 'member' ? board.members : board.workflows).find(n => n.id === node.entityId);
        const children = nodes.filter(n => n.parentId === node.id);
        const key = `${board.id}/${node.id}`, folded = this.folded.has(key);
        const observedRunning = node.kind==='member' && !entity.historyOnly && entity.runtimeFresh && entity.runtimeObservation?.state==='running';
        const wrap = el('div', `tree-branch ${node.kind === 'workflow' ? 'browse-workflow' : entity.source === 'hook' ? 'hook' : ''}${observedRunning ? ' runtime-active' : ''}`);
        const head = el('div', 'browse-branch-head');
        if (children.length) {
          const toggle = button(folded ? '＋' : '−', () => { folded ? this.folded.delete(key) : this.folded.add(key); this.renderMap(); }, 'browse-disclosure');
          toggle.setAttribute('aria-label', `${folded ? '展开' : '折叠'} ${node.label}`); toggle.setAttribute('aria-expanded', String(!folded)); head.append(toggle);
        }
        const card = button('', () => this.open(node.kind, node.entityId), `member-card browse-card ${entity.role ?? 'workflow'}`);
        card.setAttribute('aria-label', `查看${node.kind === 'workflow' ? '工作流' : '成员'}：${node.label}`);
        const top = el('span', 'member-top'), role = el('span', 'member-role');
        role.append(el('span', '', node.kind === 'workflow' ? '工作流 / WORKFLOW' : entity.role === 'lead' ? '协调者 / LEAD' : `成员 / LEVEL ${level}`), el('span', 'source', sources[node.source] ?? node.source));
        top.append(role, el('span', 'member-name', node.label));
        if (entity.historyOnly) top.append(el('span','member-task',`历史成员 · 原绑定 ${entity.historyBinding?.sessionId ?? '未明确'}`));
        const description = node.kind === 'workflow' ? `${children.length} 个成员 · 显示分组` : entity.runtimeRef ?? entity.nativeId ?? entity.id;
        top.append(el('span', 'member-id', description));
        top.append(el('span', 'member-task', `记录于 ${time(entity.observedAt)}`));
        const assigned = node.kind === 'member' ? board.tasks.filter(t => t.ownerId === entity.id && t.status !== 'completed') : [];
        if (assigned.length) top.append(el('span', 'member-task', assigned.map(t => `${t.id} · ${t.title}`).join('\n')));
        const bottom = el('span', 'member-bottom'); bottom.append(el('span', '', `${names[entity.status] ?? entity.status}${entity.stale ? ' · 需重新确认' : ''}`), el('span', '', '查看节点 ›'));
        card.append(top, bottom); head.append(card); wrap.append(head);
        if (children.length && !folded) { const list = el('div', 'tree-children'); list.append(...children.map(n => branch(n, level + (n.kind === 'member' ? 1 : 0)))); wrap.append(list); }
        return wrap;
      };
      tree.append(...nodes.filter(n => !n.parentId).map(n => branch(n, 0)));
      $('team-map').replaceChildren(tree);
    }
    async open(kind, id) {
      $('task-detail').close();
      this.active = { boardId: this.getBoard().id, nodeKind: kind, nodeId: id };
      $('node-title').textContent = kind === 'workflow' ? '工作流详情' : '成员详情';
      $('node-body').replaceChildren(el('p', 'muted', '正在读取已登记记录…'));
      if (!$('node-detail').open) $('node-detail').showModal();
      await this.load(false);
    }
    async load(append) {
      if (!this.active) return;
      const serial = ++this.serial, selection = { ...this.active };
      if (this.more) this.more.disabled = true;
      try {
        const page = await this.bridge.call('team_read_records', { ...selection, limit: 25, ...(append && this.cursor ? { after: this.cursor } : {}) });
        if (serial !== this.serial || !$('node-detail').open) return;
        const fingerprint=JSON.stringify(page,(key,value)=>['stale','runtimeFresh'].includes(key)?undefined:value), changed=fingerprint!==this.lastReadFingerprint;
        this.lastReadFingerprint=fingerprint;
        if (!append) this.renderPage(page);
        this.renderRecords(page.records, append);
        this.cursor = page.nextCursor;
        this.more.hidden = this.cursor === null; this.more.disabled = false;
        return {changed};
      } catch (e) {
        if (serial !== this.serial) return;
        $('node-body').append(el('p', 'error', e.message));
        if (this.more) this.more.disabled = false;
        return {error:e};
      }
    }
    renderPage(page) {
      const { node, nodeKind } = page, body = $('node-body'); body.replaceChildren();
      $('node-title').textContent = node.name ?? node.title;
      const fields = [['记录标识', node.id], ['状态来源', `${sources[node.source] ?? node.source} · ${names[node.status] ?? node.status}${node.stale ? ' · 需重新确认' : ''}`], ['最近状态记录', time(node.observedAt)]];
      if (nodeKind === 'member') {
        if (node.runtimeObservation) fields.push(['实际协作状态（主代理转报）', `${node.runtimeObservation.state} · ${time(node.runtimeObservation.observedAt)}${node.runtimeFresh ? '' : ' · 已过期'}\n${node.runtimeObservation.source} · ${node.runtimeObservation.evidence}`]);
        fields.push([node.relation === 'session_association' ? 'Hook 会话关联（非父子确认）' : '代理上级（登记）', node.parentId ?? '无'], ['运行引用', node.runtimeRef ?? '未登记'], ['原生线程标识', node.nativeId ?? '未提供'], ['续接能力', node.runtimeFresh && node.runtimeObservation?.resumeAvailable ? '已由主代理检查' : '未核验或已过期']);
        if (node.workflowId) fields.push(['所属工作流', node.workflowId]);
        if (node.nativeIdentity) fields.push(['线程标识来源', node.nativeIdentity.source==='public-subagent-activity'
          ? `公开子代理活动中继 · 非服务端认证\n来源线程：${node.nativeIdentity.sourceThreadId}\n活动项：${node.nativeIdentity.activityItemIds.join('、')}`
          : `${node.nativeIdentity.source} · 代理上报，未通过原生读取核验\n${node.nativeIdentity.evidence}`]);
        if (node.identityResolution) fields.push(['最近会话关联', `${node.identityResolution.status} · ${time(node.identityResolution.attemptedAt)}${node.identityResolution.reason ? `\n${node.identityResolution.reason}` : ''}`]);
        else if (node.nativeId) fields.push(['线程标识来源', '历史或手动绑定，未核验']);
        if (node.metrics) {
          if (node.metrics.tokenTotal !== undefined) fields.push(['Token（上报）', String(node.metrics.tokenTotal)]);
          if (node.metrics.durationMs !== undefined) fields.push(['耗时（上报）', `${node.metrics.durationMs} ms`]);
          fields.push(['指标来源', `${time(node.metrics.observedAt)}\n${node.metrics.evidence}`]);
        }
      } else fields.push(['工作流所属代理', node.parentMemberId], ['分组证据', node.evidence], ['关系说明', '工作流是显示分组，不替代成员实际代理父子关系。']);
      const grid = el('div', 'detail-grid');
      for (const [label, value] of fields) { const cell = el('div'); cell.append(el('span', 'detail-field', label), el('p', 'muted', value)); grid.append(cell); }
      if (node.historyOnly) body.append(el('p','notice',`历史会话成员 · 原绑定：${node.historyBinding?.sessionId ?? '未明确'}。记录保留，不参与当前绑定的同步。`));
      const visibleCount=(page.latestHostPage?.turns ?? []).flatMap(t=>t.items ?? []).filter(i=>i.type==='userMessage'||i.type==='agentMessage').length;
      const recordSummary=page.latestHostPage
        ? `此节点已同步 ${visibleCount} 条可见消息 · 最近同步 ${time(page.latestHostPage.readAt)}。内容由主代理从公开宿主读取并转报，可能分页、截断或省略工具输出与推理。`
        : nodeKind==='workflow' ? '此工作流显示已登记的成员和执行记录。' : node.nativeId ? '此节点已绑定原生会话，尚未同步可见对话；下方可查看已记录的执行结果。' : '此节点尚未绑定原生会话；下方可查看已记录的执行结果。';
      body.append(grid, el('p', 'notice', recordSummary));
      if(node.identityResolution && node.identityResolution.status!=='mapped')body.append(el('p','notice',`最近同步/关联未成功：${node.identityResolution.reason ?? node.identityResolution.status} · ${time(node.identityResolution.attemptedAt)}${page.latestHostPage ? '。下方仍保留上次成功同步的内容。' : ''}`));
      const actions = el('div', 'browse-reader-actions');
      const read = button(page.latestHostPage ? '查看已同步对话' : '查看已保存记录', () => (this.latestConversation ?? this.entries).scrollIntoView?.({ block: 'start' }));
      const refresh = button('刷新记录', () => this.load(false)); actions.append(read, refresh); body.append(actions);
      if (nodeKind === 'member') {
        const plan = page.historySync ?? {mode:'unavailable'};
        if (plan.mode==='unavailable' && plan.reason) body.append(el('small','',plan.reason));
        const sync = button(plan.mode==='resolve-and-read' ? '关联并同步子代理记录' : '请求同步会话快照', () => this.requestHostPage(page, false));
        sync.disabled = plan.mode==='unavailable' || !this.bridge.canMessageLead?.();
        sync.title = plan.mode==='resolve-and-read' ? '由主代理读取实际发起会话的公开活动，匹配线程 ID 后再读取子代理；可能使用对话额度。' : '向当前主代理请求公开只读页；可能使用对话额度，不启动子代理。';
        actions.append(sync);
        if (node.id !== 'lead') {
          const openNative=button('打开对应子代理会话',()=>this.requestNativeNavigation(page));
          openNative.disabled=plan.mode!=='read' || !this.bridge.canMessageLead?.();
          openNative.title=plan.mode!=='read' ? '请先关联该成员的准确原生会话 UUID。' : !this.bridge.canMessageLead?.() ? '当前宿主未提供向主会话发送导航请求的能力。' : '向主会话发送导航请求，最终结果由主会话反馈。';
          actions.append(openNative);
          const refreshRuntime=button('更新运行状态',()=>this.requestRuntimeRefresh(page));
          refreshRuntime.disabled=!node.runtimeRef || node.historyOnly || !this.bridge.canMessageLead?.();actions.append(refreshRuntime);
          const resume=button('续接代理',()=>this.resumeForm(page));
          resume.disabled=!node.runtimeRef || node.historyOnly || !node.runtimeFresh || !node.runtimeObservation?.resumeAvailable || !this.bridge.canMessageLead?.();
          resume.title='需要主代理近期确认该代理仍存在且支持协作续接。';actions.append(resume);
        }
        if (page.latestHostPage?.nextCursor) { const older = button('请求更早一页', () => this.requestHostPage(page, true)); older.disabled = sync.disabled; actions.append(older); }
        body.append(el('small', '', plan.mode==='resolve-and-read'
          ? '无需手工猜线程 ID：主代理先读取实际发起会话的子代理活动并关联，再同步可见历史；宿主未返回活动时会显示原因。请求可能使用对话额度。'
          : plan.mode==='read' ? '同步快照会向当前主代理发请求，可能使用对话额度；浏览已保存内容不启动模型。' : '尚无实际运行引用或明确线程 ID，不能发起会话读取。'));
      }
      this.latestConversation=null;
      this.latestRecordId=page.latestHostPage?.recordId;
      if (page.latestHostPage) {
        body.append(el('h3','','最近同步的可见对话'));
        this.latestConversation=this.hostEntry({hostPage:page.latestHostPage,observedAt:page.latestHostPage.readAt,evidence:page.latestHostPage.evidence ?? '公开宿主页中继；部分可见条目。'});
        body.append(this.latestConversation);
      }
      body.append(el('h3', '', '工作记录与历史会话页'));
      this.entries = el('div', 'browse-records'); body.append(this.entries);
      this.more = button('加载更多记录', () => this.load(true)); this.more.hidden = true; body.append(this.more);
      body.append(el('h3', '', `关联执行 · ${page.executionCount} 次${page.executionCount > 50 ? '（展示最近 50 次）' : ''}`));
      if (!page.executions.length) body.append(el('p', 'muted', '尚无关联执行。'));
      for (const run of page.executions) {
        const section = el('details', 'activity browse-execution');
        section.append(el('summary', '', `${run.taskId} · ${this.runNames[run.status]} · ${time(run.createdAt)}`), el('p', 'muted', `${run.id}\n运行引用：${run.runtimeRef ?? '未登记'}`));
        if (run.originBinding) section.append(el('p','notice',`历史执行原来源：${run.originBinding.sessionId}`));
        if (run.result) section.append(el('p', 'browse-result', run.result));
        if (run.artifacts?.length) section.append(el('p', 'muted', `产物：${run.artifacts.join('、')}`));
        for (const e of run.evidence) section.append(el('p', 'muted', `${e.kind} · ${time(e.at)}\n${e.detail}`));
        section.append(button('查看任务与执行历史', () => { this.close(); this.openTask(run.taskId, run.id); })); body.append(section);
      }
    }
    renderRecords(records, append) {
      if (!append) this.entries.replaceChildren();
      if (!records.length && !append) this.entries.append(el('p', 'muted', '尚无主动上报的工作记录；关联执行回执见下方。'));
      const roles = { user: '上报的用户消息', assistant: '上报的代理消息', tool: '上报的工具记录', note: '工作备注' };
      for (const record of records) {
        if (this.latestRecordId && record.recordId===this.latestRecordId) continue;
        const entry = el('article', 'browse-entry');
        if (record.historicalBinding) { const label=el('p','notice',`历史绑定记录 · 原来源：${record.originSessionId ?? '旧绑定，原记录未提供'}`); if(record.source==='public-host-page-relayed'){const host=this.hostEntry(record);host.append(label);this.entries.append(host);continue;}entry.append(label); }
        if (record.source === 'public-host-page-relayed') {
          this.entries.append(this.hostEntry(record)); continue;
        }
        entry.append(el('strong', '', roles[record.role]), el('p', 'muted', `代理上报 · ${record.nodeId}\n收录于 ${time(record.receivedAt)}${record.observedAt ? ` · 事件时间（上报）${time(record.observedAt)}` : ''}`), el('p', 'browse-result', record.text));
        const evidence = el('details', 'activity'); evidence.append(el('summary', '', '记录来源'), el('p', 'muted', record.evidence)); entry.append(evidence); this.entries.append(entry);
      }
    }
    hostEntry(record) {
      const entry=el('article','browse-entry');
      entry.append(el('strong','','公开宿主会话快照（主代理中继）'),el('p','muted',`线程 ${record.hostPage.threadId}\n读取于 ${time(record.observedAt)} · 部分可见条目，可能截断；非服务端认证`));
      for (const turn of record.hostPage.turns) {
        entry.append(el('p','muted',`Turn ${turn.id} · ${turn.status}`));
        for (const item of turn.items) entry.append(el('p','browse-result',`${item.type}\n${item.text}`));
      }
      const evidence=el('details','activity');evidence.append(el('summary','','快照来源与范围'),el('p','muted',record.evidence));entry.append(evidence);return entry;
    }
    async requestRuntimeRefresh(page) {
      if(this.sending || !this.active || !page.node.runtimeRef || page.node.historyOnly)return;
      const selection=this.active;this.sending=true;
      try {
        const request={protocolVersion:1,boardId:page.boardId,memberId:page.node.id,runtimeRef:page.node.runtimeRef};
        await this.bridge.messageLead(`Check the current native collaboration state for this exact Team Workbench member. Establish that this is the actual spawning parent conversation and its native UUID matches the recorded parent; use supported collaboration.list_agents, verify the exact runtimeRef, and record its real status, parent UUID as sourceThreadId, current time, source and whether supported followup_task is available using team_observe_runtime with a fresh board revision. If the parent identity cannot be verified, stop without recording a state. If unavailable or missing, report unknown and no resume capability; never invent a state or start an agent. Request: ${JSON.stringify(request)}`);
        if(this.active===selection && $('node-detail').open)$('node-body').append(el('p','muted','已请求主代理检查真实状态；完成后点击刷新记录。'));
      }catch(e){if(this.active===selection)$('node-body').append(el('p','error',e.message));}
      finally{this.sending=false;}
    }
    resumeForm(page) {
      const body=$('node-body'), form=el('form','browse-resume-form'), input=el('textarea');
      input.required=true;input.maxLength=4000;input.placeholder='输入要交给该代理的续接任务';
      const submit=button('确认发送续接',()=>{});submit.type='submit';
      form.append(input,submit);body.append(form);
      form.onsubmit=async e=>{
        e.preventDefault();const text=input.value?.trim();if(!text||this.sending)return;
        const selection=this.active,node=page.node, current=this.getBoard()?.members?.find(m=>m.id===node.id) ?? node;
        const age=Date.now()-Date.parse(current.runtimeObservation?.observedAt ?? '');
        if(current.historyOnly || current.runtimeRef!==node.runtimeRef || !current.runtimeObservation?.resumeAvailable || !Number.isFinite(age) || age>120000 || age < -30000) {body.append(el('p','error','续接条件已过期或发生变化，请先更新运行状态。'));return;}
        this.sending=true;submit.disabled=true;
        try {
          const request={protocolVersion:1,boardId:page.boardId,memberId:node.id,runtimeRef:node.runtimeRef,instructions:text};
          await this.bridge.messageLead(`Resume this exact Team Workbench agent only because the user explicitly submitted this request. Refresh the board, establish that this is the actual spawning parent conversation with the exact recorded parent UUID, verify member runtimeRef and parent, check collaboration.list_agents for the exact agent and supported collaboration.followup_task or send_message. Send only to that exact agent through the supported native collaboration tool; never use direct app-server input, infer another ID, or spawn a substitute. Record actual observation and outcome using team_observe_runtime; if unavailable, say why and do not report success. Request: ${JSON.stringify(request)}`);
          if(this.active===selection && $('node-detail').open)body.append(el('p','muted','已请求主代理续接；请等待实际执行回执。'));
        }catch(err){if(this.active===selection)body.append(el('p','error',err.message));}
        finally{this.sending=false;submit.disabled=false;}
      };
    }
    async requestNativeNavigation(page) {
      if (this.sending || !this.active) return;
      const plan=page.historySync, selection=this.active;
      if (plan?.mode!=='read' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(plan.threadId ?? '')) return;
      this.sending=true;
      try {
        const request={protocolVersion:1,boardId:page.boardId,memberId:page.node.id,threadId:plan.threadId};
        await this.bridge.messageLead(`Open the explicitly selected Team Workbench child conversation. The user clicked the open button. Check that this exact UUID is still bound to this member. If available, call codex-app-tools.navigate_to_codex_page once with the exact threadId. Do not guess another ID, send a message to the child, or create/resume an agent. If the navigation tool or child route is unavailable, report the exact limitation. The request being sent is not proof the conversation opened. Request: ${JSON.stringify(request)}`);
        if(this.active===selection && $('node-detail').open)$('node-body').append(el('p','muted','已请求主会话打开对应子代理；请等待宿主导航结果。'));
      } catch(e) {if(this.active===selection)$('node-body').append(el('p','error',e.message));}
      finally {this.sending=false;}
    }
    async requestHostPage(page, older) {
      if (this.sending || !this.active) return;
      this.sending = true; const selection = this.active;
      try {
        const plan=page.historySync;
        if (!plan || plan.mode==='unavailable') throw new Error('该节点尚无可关联的实际运行记录。');
        const request = {protocolVersion:1,action:plan.mode,boardId:page.boardId,memberId:page.node.id,
          ...(plan.threadId ? {threadId:plan.threadId} : {}),
          ...(plan.runtimeRef ? {runtimeRef:plan.runtimeRef,parentMemberId:plan.parentMemberId,parentThreadId:plan.parentThreadId} : {}),
          ...(plan.hostId ? {hostId:plan.hostId} : {}),
          ...(older && page.latestHostPage?.nextCursor ? {cursor:page.latestHostPage.nextCursor} : {}) };
        await this.bridge.messageLead(`Synchronize Team Workbench member history v1. Follow the team-workbench Skill's automatic identity and history-sync protocol. Required lead tools: team_snapshot, team_report_member, team_bind_agent_activity, team_import_thread_page and public codex-app-tools.read_thread. Do not assume unavailable tools exist. For resolve-and-read, read ONLY the actual recorded spawning parent's public history, match subAgentActivity.agentPath exactly, and let team_bind_agent_activity select/register the unique UUID and return nextRead. If the parent ID is missing, only the actual spawning conversation may establish its own exact context identity; do not substitute a development/executor thread, anonymous session ID, or another parent's child. If identity/tools/history are unavailable, record that once with team_bind_agent_activity.unavailableReason or its zero-match result and stop; do not loop or spawn/resume a model. Then read ONLY the resolved/bound child, at most one turn, includeOutputs=false/maxOutputCharsPerItem=1000; verify thread.id and import selected visible items through team_import_thread_page. Omit reasoning. Mark partial/truncated coverage. A sent request is not completion. Request: ${JSON.stringify(request)}`);
        if (this.active === selection && $('node-detail').open) $('node-body').append(el('p','muted','已向主代理请求只读快照；导入后点击“刷新记录”。发送成功不代表快照已读取。'));
      } catch(e) { if (this.active === selection) $('node-body').append(el('p','error',e.message)); }
      finally { this.sending = false; }
    }
  }
  globalThis.WorkbenchBrowser = WorkbenchBrowser;
})();
