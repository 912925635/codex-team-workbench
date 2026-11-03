(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const button = (label, action, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = action; return b; };
  const names = { unknown: '状态未知', working: '上报：工作中', idle: '上报：空闲', completed: '上报：已完成', blocked: '上报：受阻', running: '上报：运行中', failed: '上报：失败', cancelled: '上报：已取消' };
  const sources = { reported: '代理上报', manual: '手动记录', hook: '生命周期观察' };
  const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供';
  class WorkbenchBrowser {
    constructor({ bridge, getBoard, openTask, runNames, onSnapshot = () => {} }) {
      Object.assign(this, { bridge, getBoard, openTask, runNames, onSnapshot }); this.folded = new Set(); this.serial = 0;
      $('close-node').onclick = () => this.close();
      $('node-detail').addEventListener('cancel', () => { this.serial++; this.active = null; });
    }
    close() { this.serial++; this.active = null; $('node-detail').close(); }
    canRequestContinuation(node) {
      if (!node.runtimeRef || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.nativeId ?? '') || node.historyOnly || !this.bridge.canMessageLead?.()) return false;
      const age=Date.now()-Date.parse(node.runtimeObservation?.observedAt ?? '');
      const board=this.getBoard(), parent=board?.members?.find(m=>m.id===node.parentId && !m.historyOnly);
      const fresh=parent?.nativeId && node.runtimeObservation?.sourceThreadId===parent.nativeId && node.runtimeFresh && node.runtimeObservation?.resumeAvailable && age>=-30000 && age<=120000;
      const topology=node.nativeTopology;
      return Boolean(fresh || (parent?.nativeId && topology?.source==='app-server.thread/read metadata' &&
        topology.rootThreadId===board.rootSessionId && topology.parentThreadId===parent.nativeId));
    }

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
        role.append(el('span', '', node.kind === 'workflow' ? '工作流 / WORKFLOW' : entity.role === 'lead' ? '协调者 / LEAD' : entity.relation==='session_association' ? '会话关联 / 上级待确认' : `成员 / LEVEL ${level}`), el('span', 'source', sources[node.source] ?? node.source));
        top.append(role, el('span', 'member-name', node.label));
        if (entity.historyOnly) top.append(el('span','member-task',`历史成员 · 原绑定 ${entity.historyBinding?.sessionId ?? '未明确'}`));
        const description = node.kind === 'workflow' ? `${children.length} 个成员 · 显示分组` : entity.runtimeRef ?? entity.nativeId ?? entity.id;
        top.append(el('span', 'member-id', description));
        top.append(el('span', 'member-task', `记录于 ${time(entity.observedAt)}`));
        const assigned = node.kind === 'member' ? board.tasks.filter(t => t.ownerId === entity.id && t.status !== 'completed') : [];
        if (assigned.length) top.append(el('span', 'member-task', assigned.map(t => `${t.id} · ${t.title}`).join('\n')));
        const bottom = el('span', 'member-bottom'); bottom.append(el('span', '', entity.runtimeObservation?.source==='native-command-hook' && entity.runtimeStatus
          ? entity.runtimeStatus.label : `${names[entity.status] ?? entity.status}${entity.stale ? ' · 需重新确认' : ''}`), el('span', '', '查看节点 ›'));
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
      if (node.runtimeStatus && node.runtimeObservation?.source==='native-command-hook') fields.push(['生命周期含义', node.runtimeStatus.label]);
      if (nodeKind === 'member') {
        if (node.runtimeObservation) fields.push([node.runtimeObservation.source==='native-command-hook' ? '原生生命周期（自动接收）' : '实际协作状态（主代理转报）', `${node.runtimeObservation.state} · ${time(node.runtimeObservation.observedAt)}${node.runtimeFresh ? '' : ' · 已过期'}\n${node.runtimeObservation.source} · ${node.runtimeObservation.evidence}`]);
        fields.push([node.relation === 'session_association' ? 'Hook 会话关联（非父子确认）' : '代理上级（登记）', node.parentId ?? '无'], ['运行引用', node.runtimeRef ?? '未登记'], ['原生线程标识', node.nativeId ?? '未提供'], ['续接能力', node.runtimeFresh && node.runtimeObservation?.resumeAvailable ? '已由主代理检查' : '未核验或已过期']);
        if (node.workflowId) fields.push(['所属工作流', node.workflowId]);
        if (node.nativeIdentity) fields.push(['线程标识来源', node.nativeIdentity.source==='public-subagent-activity'
          ? `公开子代理活动中继 · 非服务端认证\n来源线程：${node.nativeIdentity.sourceThreadId}\n活动项：${node.nativeIdentity.activityItemIds.join('、')}`
          : node.nativeIdentity.source==='native-command-hook'
            ? `原生生命周期 Hook 输入 · 本地接收\n${node.nativeIdentity.evidence}`
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
      for (const action of (page.hostActions ?? []).slice(0, 5)) fields.push([
        action.kind === 'navigate' ? '原生导航回执' : '原生续接回执',
        `${({requested:action.source==='ui/open-link'?'等待客户端响应':'等待处理',sent:'请求已发送，尚无执行确认',accepted:'客户端已接受链接请求，目标画面尚未确认',succeeded:action.kind==='navigate'?'宿主已确认导航请求':'主代理已确认续接回执',failed:'执行失败',cancelled:'已取消等待（未停止宿主操作）'})[action.status] ?? action.status}\n${action.result ?? ''}\n${action.nativeId}`
      ]);
      for (const [label, value] of fields) { const cell = el('div'); cell.append(el('span', 'detail-field', label), el('p', 'muted', value)); grid.append(cell); }
      if (node.historyOnly) body.append(el('p','notice',`历史会话成员 · 原绑定：${node.historyBinding?.sessionId ?? '未明确'}。记录保留，不参与当前绑定的同步。`));
      const visibleCount=(page.latestHostPage?.turns ?? []).flatMap(t=>t.items ?? []).filter(i=>i.type==='userMessage'||i.type==='agentMessage').length;
      const recordSummary=page.latestHostPage
        ? `此节点已同步 ${visibleCount} 条可见消息 · 最近同步 ${time(page.latestHostPage.readAt)}。${page.latestHostPage.source==='public-app-server-page'?'插件通过公开接口直接读取，未发送主对话消息。':'内容由主代理从公开宿主读取并转报。'}${page.latestHostPage.truncated?'本页已截断。':''}可能分页，省略工具输出与推理。`
        : nodeKind==='workflow' ? '此工作流显示已登记的成员和执行记录。' : node.nativeId ? '此节点已绑定原生会话，尚未同步可见对话；下方可查看已记录的执行结果。' : '此节点尚未绑定原生会话；下方可查看已记录的执行结果。';
      body.append(grid, el('p', 'notice', recordSummary));
      if(page.automaticHistory?.enabled && ['queued','reading'].includes(page.automaticHistory.state))body.append(el('p','muted',page.automaticHistory.state==='reading'?'后台正在直接读取此节点的可见消息，无主代理往返。':'此节点已进入后台同步队列，无需向主对话发送指令。'));
      if(node.identityResolution && node.identityResolution.status!=='mapped')body.append(el('p','notice',`最近同步/关联未成功：${node.identityResolution.reason ?? node.identityResolution.status} · ${time(node.identityResolution.attemptedAt)}${page.latestHostPage ? '。下方仍保留上次成功同步的内容。' : ''}`));
      if(node.nativeHistoryRead?.status==='failed')body.append(el('p','error',`最近直读失败：${node.nativeHistoryRead.reason} · ${time(node.nativeHistoryRead.attemptedAt)}${page.latestHostPage?'。保留上次已保存内容。':''}`));
      const actions = el('div', 'browse-reader-actions');
      const read = button(page.latestHostPage ? '查看已同步对话' : '查看已保存记录', () => (this.latestConversation ?? this.entries).scrollIntoView?.({ block: 'start' }));
      const refresh = button('刷新记录', () => this.refreshSavedRecords()); actions.append(read, refresh); body.append(actions);
      for (const action of (page.hostActions ?? []).filter(a=>['requested','sent'].includes(a.status))) {
        const cancel=button('取消等待（不停止代理）',async()=>{
          cancel.disabled=true;
          try {await this.bridge.call('team_record_host_action',{boardId:page.boardId,actionId:action.id,expectedRevision:action.revision,nativeId:action.nativeId,status:'cancelled',source:'panel-user-confirmation',confirmed:true,result:'用户取消工作台等待；未停止宿主操作或代理，宿主仍可能继续执行。'});await this.load(false);}
          catch(e){body.append(el('p','error',String(e?.message || '取消等待失败')));cancel.disabled=false;}
        });
        cancel.title='只结束这个工作台请求的等待，不中断、撤回或停止宿主操作。';actions.append(cancel);
      }
      if (nodeKind === 'member') {
        const plan = page.historySync ?? {mode:'unavailable'};
        if (plan.mode==='unavailable' && plan.reason) body.append(el('small','',plan.reason));
        const sync = button('同步可见对话', () => this.requestHostPage(page, false));
        sync.disabled = plan.mode!=='read' || !page.directHistoryAvailable;
        sync.title = plan.mode!=='read' ? '需先通过真实记录关联准确线程 UUID。' : !page.directHistoryAvailable ? '当前后端未连接公开历史读取接口。' : '插件直接读取准确线程的一页可见消息，不发送主对话消息、不调用模型。';
        actions.append(sync);
        const leadActions=el('details','activity');leadActions.append(el('summary','','需要主会话的操作（会发送一条请求）'));
        const relaySync=button(plan.mode==='resolve-and-read'?'请求主会话关联并同步':'请求主会话同步',()=>this.requestLeadPage(page,false));
        relaySync.disabled=plan.mode==='unavailable' || !this.bridge.canMessageLead?.();leadActions.append(relaySync);
        actions.append(leadActions);
        if (node.id !== 'lead') {
          const openNative=button('打开对应子代理会话',()=>this.requestNativeNavigation(page));
          openNative.disabled=plan.mode!=='read' || !this.bridge.canOpenLinks?.();
          openNative.title=plan.mode!=='read' ? '请先关联准确的原生线程 UUID。' : '直接请求客户端打开，不向主对话发消息；是否允许 codex 链接由宿主决定。';
          actions.append(openNative);
          const refreshRuntime=button('刷新运行记录',()=>this.requestRuntimeRefresh(page));
          refreshRuntime.title='直接读取已接收的生命周期事件，不发消息、不调用模型，也不推断续接能力。';actions.append(refreshRuntime);
          const relayOpen=button('请求主会话打开',()=>this.requestLeadNavigation(page));
          relayOpen.disabled=plan.mode!=='read' || !this.bridge.canMessageLead?.();leadActions.append(relayOpen);
          const resume=button('请求续接代理',()=>this.resumeForm(page));
          resume.disabled=!this.canRequestContinuation(node);
          resume.title='向当前主会话发一条请求；它必须核对自己是准确父会话并检查原代理续接能力，不创建替代代理。';leadActions.append(resume);
        }
        if (page.latestHostPage?.nextCursor) {
          const direct=page.latestHostPage.source==='public-app-server-page';
          const older = button(direct?'读取更早一页':'请求主会话读取更早页', () => direct?this.requestHostPage(page,true):this.requestLeadPage(page,true));
          older.disabled = direct?sync.disabled:relaySync.disabled;(direct?actions:leadActions).append(older);
        }
        body.append(el('small', '', plan.mode==='resolve-and-read'
          ? '无需手工猜线程 ID：主代理先读取实际发起会话的子代理活动并关联，再同步可见历史；宿主未返回活动时会显示原因。请求可能使用对话额度。'
          : plan.mode==='read' ? '同步可见对话、刷新记录和直接打开链接均不发送主对话消息。只有明确标注的主会话操作会发送请求。' : '尚无实际运行引用或明确线程 ID，不能发起会话读取。'));
      }
      this.latestConversation=null;
      this.latestRecordId=page.latestHostPage?.recordId;
      if (page.latestHostPage) {
        body.append(el('h3','','最近同步的可见对话'));
        this.latestConversation=this.hostEntry({source:page.latestHostPage.source,hostPage:page.latestHostPage,observedAt:page.latestHostPage.readAt,evidence:page.latestHostPage.evidence ?? '公开宿主页；部分可见条目。'});
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
        if (run.instructions) section.append(el('h4','','初始分派指令（请求时保存）'), el('p','browse-result',run.instructions));
        if (run.result) section.append(el('h4','','回传结果（执行回执，非完整转录）'), el('p', 'browse-result', run.result));
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
        if (record.historicalBinding) { const label=el('p','notice',`历史绑定记录 · 原来源：${record.originSessionId ?? '旧绑定，原记录未提供'}`); if(record.hostPage){const host=this.hostEntry(record);host.append(label);this.entries.append(host);continue;}entry.append(label); }
        if (record.hostPage) {
          this.entries.append(this.hostEntry(record)); continue;
        }
        entry.append(el('strong', '', roles[record.role]), el('p', 'muted', `代理上报 · ${record.nodeId}\n收录于 ${time(record.receivedAt)}${record.observedAt ? ` · 事件时间（上报）${time(record.observedAt)}` : ''}`), el('p', 'browse-result', record.text));
        const evidence = el('details', 'activity'); evidence.append(el('summary', '', '记录来源'), el('p', 'muted', record.evidence)); entry.append(evidence); this.entries.append(entry);
      }
    }
    hostEntry(record) {
      const entry=el('article','browse-entry');
      const direct=record.source==='public-app-server-page';
      entry.append(el('strong','',direct?'公开接口会话页（插件直读）':'公开宿主会话快照（主代理中继）'),el('p','muted',`线程 ${record.hostPage.threadId}\n读取于 ${time(record.observedAt)} · 部分可见条目${record.hostPage.truncated?'，已截断':''}${direct?'；已核对公开父子元数据':'，可能截断；非服务端认证'}`));
      if(!record.hostPage.turns.length)entry.append(el('p','muted','公开接口返回零个 turn；未改读主会话或推断子代理不存在。'));
      for (const turn of record.hostPage.turns) {
        entry.append(el('p','muted',`Turn ${turn.id} · ${turn.status}`));
        for (const item of turn.items) entry.append(el('p','browse-result',`${item.type}\n${item.text}`));
      }
      const evidence=el('details','activity');evidence.append(el('summary','','快照来源与范围'),el('p','muted',record.evidence));entry.append(evidence);return entry;
    }
    async requestRuntimeRefresh(page) {
      if(this.sending || !this.active)return;
      const selection=this.active;this.sending=true;
      const before=JSON.stringify(page.node.runtimeObservation ?? null);
      const feedback=el('p','muted','正在刷新已接收的运行事件…');$('node-body').append(feedback);
      try {
        const result=await this.bridge.call('team_snapshot',{boardId:page.boardId});
        if(this.getBoard()?.id===page.boardId)this.onSnapshot(result);
        if(result.nativeEvents?.state==='error-reading-local-hook-journal')throw new Error('原生事件日志读取失败；保留已保存状态。');
        if(this.active!==selection)return;
        const read=await this.load(false);if(read?.error)throw read.error;
        if(this.active===selection && $('node-detail').open) {
          const current=this.getBoard()?.members?.find(m=>m.id===page.node.id);
          const changed=before!==JSON.stringify(current?.runtimeObservation ?? null);
          $('node-body').append(el('p','muted',`已刷新运行记录 · ${changed?'数据已更新':'无新事件'}。未向主对话发送消息，续接能力仍需实际执行前核对。`));
        }
      }catch(e){feedback.textContent='运行记录刷新失败。';if(this.active===selection)$('node-body').append(el('p','error',String(e?.message || '运行记录读取失败')));}
      finally{this.sending=false;}
    }
    async refreshSavedRecords() {
      if(this.sending || !this.active)return;
      this.sending=true;const selection=this.active;
      const feedback=el('p','muted','正在刷新已保存记录…');$('node-body').append(feedback);
      try {
        const result=await this.load(false);
        if(result?.error)feedback.textContent='已保存记录刷新失败。';
        if(this.active===selection && $('node-detail').open && result && !result.error)
          $('node-body').append(el('p','muted',`已刷新记录 · ${result.changed?'数据已更新':'数据未变化'}。未读取新的原生消息。`));
      }finally{this.sending=false;}
    }
    resumeForm(page) {
      const body=$('node-body'), form=el('form','browse-resume-form'), input=el('textarea');
      input.required=true;input.maxLength=4000;input.placeholder='输入要交给该代理的续接任务';
      const submit=button('确认请求主会话续接',()=>{});submit.type='submit';
      form.append(input,submit);body.append(form);
      form.onsubmit=async e=>{
        e.preventDefault();const text=input.value?.trim();if(!text||this.sending)return;
        if(!this.bridge.canMessageLead?.()){body.append(el('p','error','当前宿主未提供向主会话发送请求的能力。'));return;}
        const selection=this.active,node=page.node, current=this.getBoard()?.members?.find(m=>m.id===node.id) ?? node;
        if(current.runtimeRef!==node.runtimeRef || current.nativeId!==node.nativeId || !this.canRequestContinuation(current)) {body.append(el('p','error','目标、父会话或能力信息已变化，请刷新节点后重试。'));return;}
        this.sending=true;submit.disabled=true;let action;
        try {
          const receipt=await this.bridge.call('team_request_host_action',{boardId:page.boardId,memberId:node.id,kind:'resume',instructions:text,expectedNativeId:current.nativeId});
          action=receipt.action;
          await this.bridge.messageLead(`Team Workbench: execute the user's exact pending continuation. Read only team_get_request(kind=host-action, requestId=actionId) for stored instructions and target. Verify the actual spawning parent and live original agent, record fresh capability before/after the supported operation, and persist the actual host-action receipt. Follow the Skill; never use direct app-server input or spawn a substitute. Request: ${JSON.stringify({protocolVersion:3,boardId:page.boardId,actionId:action.id,nativeId:action.nativeId})}`);
          if(this.active===selection && $('node-detail').open)body.append(el('p','muted','已请求主代理续接；请等待实际执行回执。'));
        }catch(err){
          const message=String(err?.message || '宿主续接请求发送失败');
          if(action)try{await this.bridge.call('team_record_host_action',{boardId:page.boardId,actionId:action.id,expectedRevision:action.revision,nativeId:current.nativeId,status:'failed',source:'ui/message',result:message.slice(0,2000)});}catch{}
          if(this.active===selection)body.append(el('p','error',message));
        }
        finally{this.sending=false;submit.disabled=false;}
      };
    }
    async requestNativeNavigation(page) {
      if(this.sending || !this.active)return;
      const plan=page.historySync,selection=this.active;
      if(plan?.mode!=='read' || !this.bridge.canOpenLinks?.()) {
        $('node-body').append(el('p','error','当前宿主未提供直接打开链接的能力，或节点尚无准确线程 ID。未发送主对话消息。'));return;
      }
      this.sending=true;let action,acknowledged=false;
      const feedback=el('p','muted','正在请求客户端打开准确会话链接…');$('node-body').append(feedback);
      try {
        const receipt=await this.bridge.call('team_request_host_action',{boardId:page.boardId,memberId:page.node.id,kind:'navigate',expectedNativeId:plan.threadId});
        action=receipt.action;
        if(action.nativeId!==plan.threadId)throw new Error('线程关联已变化，请刷新节点。');
        await this.bridge.openNativeThread(action.nativeId);acknowledged=true;
        await this.bridge.call('team_record_host_action',{boardId:page.boardId,actionId:action.id,expectedRevision:action.revision,nativeId:action.nativeId,status:'accepted',source:'ui/open-link',confirmed:true,result:'客户端接受了该准确线程的链接请求；未确认目标画面。没有向主对话发送消息。'});
        if(this.active===selection){await this.load(false);if($('node-detail').open)$('node-body').append(el('p','muted','客户端已接受打开请求；未验证目标画面。'));}
      }catch(e){
        feedback.textContent=acknowledged?'客户端已接受链接；回执保存失败。':'客户端打开请求失败。';
        const message=String(e?.message || '宿主链接请求失败');
        if(action && !acknowledged)try{await this.bridge.call('team_record_host_action',{boardId:page.boardId,actionId:action.id,expectedRevision:action.revision,nativeId:action.nativeId,status:'failed',source:'ui/open-link',result:message.slice(0,2000)});}catch{}
        if(this.active===selection)$('node-body').append(el('p','error',acknowledged?`客户端已接受请求，但回执保存失败：${message}`:`${message}。未自动向主对话发送消息，也未使用其他启动方式。`));
      }finally{this.sending=false;}
    }
    async requestLeadNavigation(page) {
      if (this.sending || !this.active) return;
      if(!this.bridge.canMessageLead?.()){$('node-body').append(el('p','error','当前宿主未提供向主会话发送导航请求的能力。'));return;}
      const plan=page.historySync, selection=this.active;
      if (plan?.mode!=='read' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(plan.threadId ?? '')) return;
      this.sending=true;
      let action;
      try {
        const receipt=await this.bridge.call('team_request_host_action',{boardId:page.boardId,memberId:page.node.id,kind:'navigate',expectedNativeId:plan.threadId});
        action=receipt.action;
        const request={protocolVersion:2,boardId:page.boardId,memberId:page.node.id,threadId:plan.threadId,nativeId:plan.threadId,actionId:receipt.action.id,expectedRevision:receipt.action.revision};
        await this.bridge.messageLead(`Team Workbench: the user explicitly requests native navigation. Discover the actual available navigate_to_codex_page tool, verify this exact bound UUID and use it once; record its real receipt. Never infer another target. Follow the Skill; message delivery is not proof of navigation. Request: ${JSON.stringify(request)}`);
        if(this.active===selection && $('node-detail').open)$('node-body').append(el('p','muted','已请求主会话打开对应子代理；请等待宿主导航结果。'));
      } catch(e) {
        const message=String(e?.message || '宿主导航请求发送失败');
        if(action)try{await this.bridge.call('team_record_host_action',{boardId:page.boardId,actionId:action.id,expectedRevision:action.revision,nativeId:plan.threadId,status:'failed',source:'ui/message',result:message.slice(0,2000)});}catch{}
        if(this.active===selection)$('node-body').append(el('p','error',message));
      }
      finally {this.sending=false;}
    }
    async requestHostPage(page, older) {
      if(this.sending || !this.active)return;
      if(page.historySync?.mode!=='read' || !page.directHistoryAvailable){$('node-body').append(el('p','error','当前节点没有可用的直接读取通路。未发送主对话消息。'));return;}
      this.sending=true;const selection=this.active;
      const feedback=el('p','muted','正在通过公开接口读取可见对话…');$('node-body').append(feedback);
      try {
        const result=await this.bridge.call('team_sync_native_history',{boardId:page.boardId,memberId:page.node.id,expectedNativeId:page.historySync.threadId,
          ...(older?{beforeRecordId:page.latestHostPage.recordId}:{})});
        if(this.active!==selection || !$('node-detail').open)return;
        this.renderPage(result);this.renderRecords(result.records,false);this.cursor=result.nextCursor;
        this.more.hidden=this.cursor===null;
        $('node-body').append(el('p','muted',`已直接读取 · ${result.sync?.duplicate?'内容未变化，读取时间已更新':result.sync?.empty?'公开接口返回空页':'可见记录已更新'}。未发送主对话消息。`));
      }catch(e){feedback.textContent='本次直读未成功确认。';if(this.active===selection && $('node-detail').open)$('node-body').append(el('p','error',`${e.message}。已保存内容仍保留；未自动转发给主会话。`));}
      finally{this.sending=false;}
    }
    async requestLeadPage(page, older) {
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
        await this.bridge.messageLead(`Team Workbench: explicit lead-assisted history request. Follow the Skill's identity/history protocol using actual available host read tools, team_bind_agent_activity and team_import_thread_page. Read only the recorded spawning parent to resolve an exact subAgentActivity path/UUID, then only the exact child. If unavailable, record that once and stop; do not substitute a development/executor thread or start a model. One turn, selected visible text, omit reasoning, mark partial coverage. Request: ${JSON.stringify(request)}`);
        if (this.active === selection && $('node-detail').open) $('node-body').append(el('p','muted','已向主代理请求只读快照；导入后点击“刷新记录”。发送成功不代表快照已读取。'));
      } catch(e) { if (this.active === selection) $('node-body').append(el('p','error',e.message)); }
      finally { this.sending = false; }
    }
  }
  globalThis.WorkbenchBrowser = WorkbenchBrowser;
})();
