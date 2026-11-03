(() => {
  const $ = id => document.getElementById(id);
  const bridge = new WorkbenchBridge();
  const state = { boards: [], archivedBoards: [], board: null, owner: 'all', status: 'all', busy: false, refreshing: false, activeTask: null, detailRunId: null };
  const statusNames = { pending: '待领取', in_progress: '进行中', completed: '已完成', blocked: '等待依赖' };
  const runNames = { requested: '等待主代理接单', dispatched: '已登记真实启动回执', running: '执行中（代理上报）', reported: '结果已回传，待主代理核验', succeeded: '主代理已核验完成', failed: '执行失败' };
  const memberStates = { unknown: '状态未知', working: '上报：工作中', idle: '上报：空闲', completed: '上报：已完成', blocked: '上报：受阻', start_observed: '最近观察：开始', stop_observed: '最近观察：停止', end_observed: '最近观察：会话结束', interrupt_observed: '最近观察：中断', session_observed: '最近观察：会话打开' };
  const sourceNames = { manual: '手动记录', reported: '成员上报', hook: '生命周期观察' };
  const el = (tag, className, value) => {
    const node = document.createElement(tag); if (className) node.className = className;
    if (value !== undefined) node.textContent = value; return node;
  };
  const btn = (label, action, className = '') => { const b = el('button', className, label); b.type = 'button'; b.onclick = action; return b; };
  const browser = new WorkbenchBrowser({ bridge, getBoard: () => state.board, openTask: (id, runId) => openDetail(id, runId), runNames, onSnapshot: apply });
  const time = stamp => new Date(stamp).toLocaleString('zh-CN', { hour12: false });
  function showError(error) { $('error').hidden = false; $('error').textContent = error.message; }
  function clearError() { $('error').hidden = true; }
  function apply(result) {
    if(result.nativeAutoHistory)state.nativeAutoHistory=result.nativeAutoHistory;
    if (result.nativeEvents) {
      state.nativeEvents = result.nativeEvents;
      if (result.nativeEvents.enabled) $('notice').textContent = ({
        'connected-to-local-hook-journal': '原生生命周期已接入：自动接收开始和停止事件；停止不等于任务成功，续接能力需另行确认。',
        'waiting-for-callback': '正在等待指定会话的原生子代理回调。',
        'error-reading-local-hook-journal': '原生事件读取失败；保留已保存记录。',
        'unbound-or-archived': '请先关联当前原生会话，再接收生命周期事件。'
      })[result.nativeEvents.state] ?? '原生生命周期状态待确认。';
    }
    state.boards = result.boards ?? state.boards;
    state.archivedBoards = result.archivedBoards ?? state.archivedBoards;
    state.board = result.board ?? null;
    render();
  }
  async function call(name, args) {
    clearError();
    const result = await bridge.call(name, args);
    apply(result); return result;
  }
  const savedFingerprint = () => JSON.stringify({boards:state.boards,archivedBoards:state.archivedBoards,board:state.board},(key,value)=>['stale','runtimeFresh'].includes(key)?undefined:value);
  async function refresh({manual=false}={}) {
    if (state.refreshing) return;
    if (state.busy || !bridge.ready) { if(manual)$('refresh-status').textContent=state.busy?'正在保存，请稍后刷新':'未连接，无法刷新'; return; }
    state.refreshing=true; $('refresh').disabled=true;
    if(manual)$('refresh-status').textContent='正在刷新已保存数据…';
    const before=savedFingerprint();
    try {
      await call('team_snapshot', state.board ? {boardId:state.board.id}:{});
      const node=$('node-detail').open ? await browser.load(false) : null;
      if(node?.error)throw node.error;
      if(manual)$('refresh-status').textContent=`${before!==savedFingerprint() || node?.changed ? '已刷新 · 数据已更新' : '已刷新 · 数据未变化'} · ${new Date().toLocaleTimeString('zh-CN',{hour12:false})}`;
    } catch(e) { showError(e); if(manual)$('refresh-status').textContent=`刷新失败：${e.message}`; }
    finally {state.refreshing=false; $('refresh').disabled=false;}
  }
  bridge.onResult = result => {
    if (!result.isError && result.structuredContent?.boards) apply(result.structuredContent);
  };
  let context = {};
  bridge.onContext = next => {
    context = { ...context, ...next };
    document.documentElement.dataset.theme = context.theme ?? 'light';
    for (const [key, value] of Object.entries(context.styles?.variables ?? {}))
      if (key.startsWith('--') && typeof value === 'string') document.documentElement.style.setProperty(key, value);
    for (const [side, value] of Object.entries(context.safeAreaInsets ?? {}))
      if (['top', 'right', 'bottom', 'left'].includes(side) && Number.isFinite(value)) document.documentElement.style.setProperty(`--safe-${side}`, `${value}px`);
  };
  function render() {
    const b = state.board;
    const selected = b?.id ?? '';
    $('board-select').replaceChildren(new Option('选择工作台', ''));
    for (const board of state.boards) $('board-select').append(new Option(board.title, board.id));
    $('board-select').value = selected;
    $('archived-boards').textContent = `已归档工作台（${state.archivedBoards.length}）`;
    $('welcome').hidden = !!b;
    $('workspace').hidden = !b;
    $('welcome-create').textContent = state.boards.length ? '创建新工作台 ↗' : '创建第一个工作台 ↗';
    if (!b) return;
    $('board-title').textContent = b.title;
    const identity=b.members.find(m=>m.id==='lead')?.nativeIdentity;
    const identitySource=({'user-supplied':'用户提供','public-thread-read':'公开会话读取转报','public-subagent-activity':'公开代理活动转报','host-env':'宿主环境标识','host-spawn-receipt':'宿主启动回执'})[identity?.source] ?? '历史或手动记录';
    $('board-meta').textContent = b.rootSessionId ? `已关联：${b.rootSessionId} · 来源：${identitySource}（未独立认证）` : '尚未关联原生会话 · 成员与任务可独立记录';
    $('bind-session').textContent = b.rootSessionId ? '修改会话绑定' : '关联会话标识';
    const automatic=b.nativeHistorySync?.enabled && b.nativeHistorySync.rootThreadId===b.rootSessionId;
    $('auto-history').textContent=`自动同步对话：${automatic?(state.nativeAutoHistory?.available?'开':'已启用·不可用'):'关'}`;
    $('auto-history').disabled=!b.rootSessionId || (!state.nativeAutoHistory?.available && !automatic);
    $('auto-history').title=state.nativeAutoHistory?.available?'启用后由插件后台按回合停止事件直接同步，无需主代理回读。':'当前后端缺少原生 Hook 日志或公开历史直读接口。';
    $('stat-total').textContent = b.tasks.length;
    $('stat-active').textContent = b.tasks.filter(t => t.status === 'in_progress').length;
    $('stat-done').textContent = b.tasks.filter(t => t.status === 'completed').length;
    $('stat-blocked').textContent = b.tasks.filter(t => !t.ready && t.status !== 'completed').length;
    $('task-count').textContent = `${b.tasks.length} 项`;
    $('member-count').textContent = `${b.members.length} 位 · ${(b.workflows ?? []).length} 个工作流`;
    $('sync-state').textContent = `本地持久化 · 修订 ${b.revision} · ${time(b.updatedAt)}`;
    const filters = [btn('全部', () => { state.owner = 'all'; render(); }, `chip ${state.owner === 'all' ? 'selected' : ''}`)];
    for (const m of b.members) filters.push(btn(m.name, () => { state.owner = m.id; render(); }, `chip ${state.owner === m.id ? 'selected' : ''}`));
    filters.push(btn('未分配', () => { state.owner = 'unassigned'; render(); }, `chip ${state.owner === 'unassigned' ? 'selected' : ''}`));
    $('owner-filters').replaceChildren(...filters);
    renderTasks(); renderMap();
    $('activity-count').textContent = `· ${b.events.length}`;
    $('activity-list').replaceChildren(...b.events.slice(-15).reverse().map(e => {
      const row = el('li'); row.append(el('time', '', time(e.at)), el('span', '', e.detail)); return row;
    }));
    if ($('task-detail').open && state.activeTask) renderDetail(state.activeTask);
  }
  function renderTasks() {
    const b = state.board;
    const tasks = b.tasks.filter(t => (state.owner === 'all' || (state.owner === 'unassigned' ? !t.ownerId : t.ownerId === state.owner))
      && (state.status === 'all' || (state.status === 'blocked' ? !t.ready && t.status !== 'completed' : t.status === state.status)));
    if (!tasks.length) { $('task-list').replaceChildren(el('div', 'empty-list', b.tasks.length ? '没有符合筛选条件的任务' : '还没有任务。添加第一项，让分工有迹可循。')); return; }
    $('task-list').replaceChildren(...tasks.map(t => {
      const row = btn('', () => openDetail(t.id), 'task-row');
      row.setAttribute('aria-label', `${t.title}，${!t.ready && t.status !== 'completed' ? '等待依赖' : statusNames[t.status]}`);
      const info = el('div', 'task-info'); info.append(el('span', 'task-title', t.title));
      const latestRun = (b.runs ?? []).filter(r => r.taskId === t.id).at(-1);
      info.append(el('span', 'task-subtitle', `${t.id}　${t.blockedBy.length ? `依赖 ${t.blockedBy.join('、')}` : '无前置依赖'}　·　r${t.revision}${latestRun ? ` · ${runNames[latestRun.status]}` : ''}`));
      row.append(el('span', `task-indicator ${t.status}`, t.status === 'completed' ? '✓' : ''), info,
        el('span', 'task-owner', b.members.find(m => m.id === t.ownerId)?.name ?? '未分配'),
        el('span', `badge ${!t.ready && t.status !== 'completed' ? 'blocked' : t.status}`, !t.ready && t.status !== 'completed' ? '等待依赖' : statusNames[t.status]), el('span', 'row-arrow', '›'));
      return row;
    }));
  }
  function renderMap() {
    browser.renderMap();
  }
  function inputField(form, label, name, { value = '', type = 'input', required = false, hint, options, maxLength = 200 } = {}) {
    const id = `field-${name}`;
    const title = el('label', '', label); title.htmlFor = id;
    const field = el(type); field.name = name; field.id = id; field.required = required;
    if (type === 'select') for (const [v, title] of options) field.append(new Option(title, v));
    else { field.maxLength = maxLength; if (type === 'input') field.type = 'text'; }
    field.value = type === 'select' && value === '' && !options.some(([v]) => v === '') ? options[0]?.[0] ?? '' : value;
    form.append(title, field); if (hint) form.append(el('small', '', hint));
    return field;
  }
  function dependenciesField(container, excludeId, current = []) {
    container.append(el('label', '', '前置依赖（可多选）'));
    const list = el('div', 'checklist');
    const tasks = state.board.tasks.filter(t => t.id !== excludeId);
    if (!tasks.length) list.append(el('small', '', '暂无其他任务'));
    for (const t of tasks) {
      const label = el('label'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.name = 'dependencies'; checkbox.value = t.id; checkbox.checked = current.includes(t.id);
      label.append(checkbox, el('span', '', `${t.id} · ${t.title}`)); list.append(label);
    }
    container.append(list);
  }
  function editor(title, build, save) {
    $('task-detail').close();
    $('editor-title').textContent = title; $('editor-fields').replaceChildren(); $('form-error').hidden = true;
    build($('editor-fields'));
    $('editor-form').onsubmit = async e => {
      e.preventDefault(); if (state.busy) return;
      state.busy = true; $('submit-editor').disabled = true; $('form-error').hidden = true;
      try { if (await save(new FormData($('editor-form'))) !== false) $('editor').close(); }
      catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
      finally { state.busy = false; $('submit-editor').disabled = false; }
    };
    $('editor').showModal();
  }
  function newBoard() {
    editor('创建工作台', form => {
      inputField(form, '工作台名称', 'title', { required: true, hint: '这里创建任务空间，不会启动新的代理或会话。' });
    }, async data => { state.owner = 'all'; state.status = 'all'; $('status-filter').value = 'all'; await call('team_create_board', { title: data.get('title') }); });
  }
  function newTask() {
    const boardId = state.board.id;
    editor('新建任务', form => {
      inputField(form, '任务标题', 'title', { required: true });
      inputField(form, '说明', 'description', { type: 'textarea', maxLength: 16384 }); dependenciesField(form);
    }, data => call('team_create_task', { boardId, title: data.get('title'), description: data.get('description'), blockedBy: data.getAll('dependencies') }));
  }
  function newMember() {
    const b = state.board;
    editor('记录协作成员', form => {
      form.append(el('small', '', '记录成员用于任务分工，不会生成或唤醒代理。状态显示为“成员上报”。'));
      inputField(form, '成员标识', 'memberId', { required: true, hint: '例如 reviewer；分工时用此标识。' });
      inputField(form, '显示名称', 'name', { required: true, maxLength: 100 });
      inputField(form, '上级成员', 'parentId', { type: 'select', options: b.members.map(m => [m.id, m.name]) });
      inputField(form, '上报状态', 'status', { type: 'select', options: ['unknown', 'working', 'idle', 'completed', 'blocked'].map(s => [s, memberStates[s]]) });
      inputField(form, '原生代理标识（可选）', 'nativeId', { hint: '仅记录你明确提供的标识，不验证原生关联。' });
    }, data => {
      const args = { boardId: b.id, memberId: data.get('memberId'), name: data.get('name'), parentId: data.get('parentId'), status: data.get('status') };
      if (data.get('nativeId')) args.nativeId = data.get('nativeId');
      return call('team_report_member', args);
    });
  }
  function confirmField(form, label) {
    const row = el('label'), field = el('input'); field.type='checkbox'; field.name='confirmed'; field.required=true;
    row.append(field, el('span','',label)); form.append(row);
  }
  function bindSession() {
    const b = state.board;
    editor(b.rootSessionId ? '修改会话绑定' : '关联会话标识', form => {
      const field = inputField(form, '完整会话 UUID（36 位）', 'sessionId', { required: true, value: b.rootSessionId ?? '', hint: '绑定错误可以修改。请从原聊天明确取得完整 UUID，不能根据短编号猜测。下一步会显示旧、新绑定及影响。' });
      field.pattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'; field.minLength=36; field.maxLength=36;
    }, data => {
      const sessionId=String(data.get('sessionId') ?? '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('请填写完整的 36 位 UUID，不能使用短编号。');
      if (sessionId===b.rootSessionId) return;
      editor('确认修改会话绑定', form => {
        form.append(el('p','',`旧绑定：${b.rootSessionId ?? '未绑定'}\n新绑定：${sessionId}`),el('p','notice',`保留 ${b.tasks.length} 项任务和全部执行记录。旧成员、执行和快照仍标记原来源，不能作为新会话的成员或同步记录；不会启动或停止代理。`));
        confirmField(form,'我已核对新、旧会话 ID，并确认以上影响');
      }, confirmation => {
        if (confirmation.get('confirmed')!=='on') throw new Error('请先确认绑定变更及历史隔离范围。');
        return call('team_bind_session',{boardId:b.id,sessionId,expectedRevision:b.revision,...(b.rootSessionId?{previousSessionId:b.rootSessionId,confirmRebind:true}:{}),nativeIdSource:'user-supplied',evidence:'User confirmed the displayed old/new conversation UUID and preservation/isolation of previous execution history in the panel'});
      });
      return false;
    });
  }
  function archiveBoard() {
    const b=state.board;
    editor('归档工作台（可恢复）',form=>{
      form.append(el('p','',`工作台：${b.title}\n${b.id}`),el('p','notice',`归档后从活动列表隐藏。${b.tasks.length} 项任务、${b.members.length} 位成员及全部历史仍保留；不会删除项目文件、停止代理或删除聊天。可从“已归档工作台”恢复。`));
      confirmField(form,'确认归档此工作台并保留所有数据');
    },data=>{if(data.get('confirmed')!=='on')throw new Error('请先确认归档范围。');return call('team_archive_board',{boardId:b.id,expectedRevision:b.revision,action:'archive',confirmed:true});});
  }
  function archivedBoards() {
    if (!state.archivedBoards.length) { showError(new Error('暂无已归档工作台。')); return; }
    editor('恢复已归档工作台',form=>{
      inputField(form,'工作台','boardId',{type:'select',options:state.archivedBoards.map(b=>[b.id,b.title])});
      form.append(el('p','notice','恢复仅重新显示工作台，保留原任务、成员、会话绑定与执行历史。'));
      confirmField(form,'确认恢复所选工作台');
    },data=>{if(data.get('confirmed')!=='on')throw new Error('请先确认恢复。');const b=state.archivedBoards.find(b=>b.id===data.get('boardId'));if(!b)throw new Error('工作台已变化，请刷新。');return call('team_archive_board',{boardId:b.id,expectedRevision:b.revision,action:'restore',confirmed:true});});
  }
  function automaticHistory() {
    const b=state.board;if(!b || !b.rootSessionId)return;
    const enabled=!(b.nativeHistorySync?.enabled && b.nativeHistorySync.rootThreadId===b.rootSessionId);
    editor(enabled?'启用后台自动同步可见对话':'关闭后台自动同步可见对话',form=>{
      form.append(el('p','muted',`范围：仅此工作台当前主会话 ${b.rootSessionId} 下，经公开父子关系核对的子代理。`));
      form.append(el('p','muted',enabled?'回合停止后，后台直接保存一页用户/代理可见文本，按事件去重；不保存推理或工具正文，不向主对话发消息。现有 Hooks 的范围和信任设置不会改变。':'停止自动读取新页面，保留已保存记录。'));
      confirmField(form,enabled?'确认对上述范围启用自动同步':'确认关闭自动同步并保留记录');
    },data=>{if(data.get('confirmed')!=='on')throw new Error('请先确认自动同步范围。');return call('team_set_history_sync',{boardId:b.id,expectedRevision:b.revision,expectedRootSessionId:b.rootSessionId,enabled,confirmed:true});});
  }
  function openDetail(id, runId = null) { state.activeTask = id; state.detailRunId = runId; renderDetail(id); $('task-detail').showModal(); }
  function renderDetail(id) {
    const b = state.board, t = b.tasks.find(t => t.id === id);
    if (!t) { $('task-detail').close(); return; }
    $('detail-id').textContent = `${t.id} / REVISION ${t.revision}`; $('detail-title').textContent = t.title;
    const body = $('detail-body'); body.replaceChildren();
    body.append(el('p', 'muted', t.description || '暂无说明'));
    const grid = el('div', 'detail-grid');
    for (const [label, value] of [['负责人', b.members.find(m => m.id === t.ownerId)?.name ?? '未分配'], ['任务状态', statusNames[t.status]], ['前置依赖', t.blockedBy.join('、') || '无'], ['依赖就绪', t.ready ? '已就绪' : `等待 ${t.unresolved.join('、')}`]]) {
      const div = el('div'); div.append(el('span', 'detail-field', label), el('p', 'muted', value)); grid.append(div);
    }
    body.append(grid);
    const history = (b.runs ?? []).filter(r => r.taskId === t.id);
    const run = history.find(r => r.id === state.detailRunId) ?? history.at(-1);
    if (history.length > 1) {
      const label = el('label', 'detail-field', '执行历史'), select = el('select', 'browse-history');
      label.htmlFor = 'execution-history'; select.id = 'execution-history';
      for (const r of [...history].reverse()) select.append(new Option(`${time(r.createdAt)} · ${runNames[r.status]} · ${r.id}`, r.id));
      select.value = run.id; select.onchange = () => { state.detailRunId = select.value; renderDetail(id); };
      body.append(label, select);
    }
    if (run) {
      body.append(el('span', 'detail-field', '执行记录（主代理编排／代理上报）'), el('p', 'muted', `${run.id}\n${runNames[run.status]}\n运行引用：${run.runtimeRef ?? '尚无启动回执'}`));
      if (run.result) body.append(el('p', '', run.result));
      if (run.artifacts?.length) body.append(el('p', 'muted', `产物：${run.artifacts.join('、')}`));
      const receipts = el('details', 'activity'); receipts.append(el('summary', '', '执行证据'));
      for (const e of run.evidence) receipts.append(el('p', 'muted', `${e.kind} · ${time(e.at)}\n${e.detail}`));
      body.append(receipts);
    }
    const actions = el('div', 'detail-actions');
    const update = async (action, extra = {}) => {
      if (state.busy) return;
      state.busy = true;
      try { await call('team_update_task', { boardId: b.id, taskId: t.id, expectedRevision: t.revision, actorId: 'lead', action, ...extra }); }
      catch (e) { const error = el('div', 'error', e.message); body.append(error); }
      finally { state.busy = false; }
    };
    const activeRun = history.find(r => !['succeeded', 'failed'].includes(r.status));
    if (t.status === 'pending' && !activeRun) { const claim = btn('由协调者领取', () => update('claim')); claim.disabled = !t.ready; actions.append(claim); }
    if (t.status === 'in_progress' && !activeRun) { const complete = btn('标记完成', () => update('complete'), 'primary'); complete.disabled = !t.ready; actions.append(complete, btn('释放任务', () => update('release'))); }
    if ((t.status === 'pending' && !activeRun) || activeRun?.status === 'requested') {
      const execute = btn(activeRun?.status === 'requested' ? '重发执行请求（主会话）' : '请求执行（主会话）', async () => {
        if (state.busy) return; state.busy = true; execute.disabled = true;
        try {
          if(!bridge.canMessageLead())throw new Error('当前宿主未提供主会话执行请求能力；尚未创建执行请求。');
          let requested = activeRun?.status === 'requested' ? activeRun : null;
          if (!requested) {
            const created = await bridge.call('team_request_execution', { boardId: b.id, taskId: t.id, expectedTaskRevision: t.revision });
            requested = created.board.runs.filter(r => r.taskId === t.id).at(-1); apply(created);
          }
          const prompt = `Team Workbench: execute this explicit native run. Read only team_get_request(kind=execution, requestId=runId) for stored instructions and revisions, then follow the Skill's dispatch/result/confirmation protocol. Do not start a separate app-server or substitute agent. Request: ${JSON.stringify({protocolVersion:3,boardId:b.id,runId:requested.id})}`;
          await bridge.messageLead(prompt);
          body.append(el('small', '', '执行请求已交给当前主对话；这不代表代理已经启动，请查看执行回执。'));
        } catch (e) { body.append(el('div', 'error', e.message)); }
        finally { state.busy = false; execute.disabled = false; }
      }, 'primary');
      execute.disabled = !t.ready || !bridge.canMessageLead(); actions.prepend(execute);
      body.append(el('small','','执行会向当前主会话发送一条请求，由其原生协作工具启动代理；任务内容保存在后端，消息只携带请求标识。'));
      if (!bridge.canMessageLead()) body.append(el('small', '', '此宿主未提供当前对话消息能力；请在主对话中要求使用 Team Workbench 执行本任务。分配任务本身不会启动代理。'));
    }
    if (t.status === 'completed') actions.append(btn('重新打开', () => update('reopen')));
    if (t.status !== 'completed') actions.append(btn('转派', () => editor('转派任务', form => {
      inputField(form, '负责人', 'ownerId', { type: 'select', value: t.ownerId ?? '', options: [['', '暂不分配'], ...b.members.map(m => [m.id, m.name])] });
      form.append(el('small', '', '转派仅更新任务归属；请在对话中向对应成员交代工作。'));
    }, data => call('team_update_task', { boardId: b.id, taskId: t.id, expectedRevision: t.revision, actorId: 'lead', action: 'reassign', ownerId: data.get('ownerId') }))));
    actions.append(btn('编辑', () => editor('编辑任务', form => {
      inputField(form, '任务标题', 'title', { required: true, value: t.title });
      inputField(form, '说明', 'description', { type: 'textarea', value: t.description, maxLength: 16384 });
    }, data => call('team_update_task', { boardId: b.id, taskId: t.id, expectedRevision: t.revision, actorId: 'lead', action: 'edit', title: data.get('title'), description: data.get('description') }))));
    if (t.status !== 'completed') actions.append(btn('编辑依赖', () => editor('编辑前置依赖', form => dependenciesField(form, t.id, t.blockedBy), data => call('team_update_task', { boardId: b.id, taskId: t.id, expectedRevision: t.revision, actorId: 'lead', action: 'set_dependencies', blockedBy: data.getAll('dependencies') }))));
    body.append(actions, el('small', '', '任务板当前以协调者角色操作。该角色由调用方声明，不代表宿主认证的身份。'));
  }
  $('new-board').onclick = newBoard; $('welcome-create').onclick = newBoard;
  $('new-task').onclick = newTask; $('new-member').onclick = newMember; $('bind-session').onclick = bindSession; $('archive-board').onclick = archiveBoard; $('archived-boards').onclick = archivedBoards;
  $('auto-history').onclick=automaticHistory;
  $('refresh').onclick = () => refresh({manual:true});
  $('board-select').onchange = async e => {
    state.owner = 'all'; state.status = 'all'; $('status-filter').value = 'all';
    try { await call('team_panel', e.target.value ? { boardId: e.target.value } : {}); } catch (error) { showError(error); }
  };
  $('status-filter').onchange = e => { state.status = e.target.value; renderTasks(); };
  for (const id of ['close-editor', 'cancel-editor']) $(id).onclick = () => $('editor').close();
  $('close-detail').onclick = () => { state.activeTask = null; $('task-detail').close(); };
  // Stop background reads while editing. Revisions protect concurrent writers.
  let nextRefresh = 0;
  const poll = setInterval(() => {
    const editing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    if (document.hidden || $('editor').open || $('task-detail').open || editing || browser.sending || Date.now() < nextRefresh) return;
    if ($('node-detail').open && !state.nativeEvents?.enabled) return;
    nextRefresh = Date.now() + (state.nativeEvents?.enabled ? 1000 : 5000);
    void refresh();
  }, 1000);
  window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
  (async () => {
    try {
      await bridge.connect();
      $('connection').textContent = bridge.preview ? '本地预览 · 0.5.2 · 未连接宿主' : '插件协议已连接 · 0.5.2';
      $('notice').textContent = bridge.preview
        ? '本地可用版本：任务会真实保存。原生代理尚未连接；成员状态显示记录来源。'
        : '点击团队节点查看会话绑定、已同步内容、实际状态来源及可用操作。工作流与层级以登记记录为准。';
      await refresh();
      if (!bridge.preview && /chatgpt|codex/i.test(bridge.hostInfo?.name ?? '')) {
        const parts = (bridge.hostInfo.version ?? '').split('.').map(Number), minimum = [26, 928, 20710];
        if (parts.length >= 3 && parts.every(Number.isFinite)) {
          let older = false;
          for (let i = 0; i < 3; i++) { if (parts[i] !== minimum[i]) { older = parts[i] < minimum[i]; break; } }
          if (older) showError(new Error('此桌面版本低于 Extensions 建议版本 26.928.20710，请更新后验证会话面板功能。'));
        }
      }
    } catch (e) { $('connection').textContent = '尚未连接'; $('notice').textContent = '连接未完成。工作台不会显示模拟团队。'; showError(e); }
  })();
})();
