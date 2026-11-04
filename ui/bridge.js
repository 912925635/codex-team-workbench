// Minimal MCP Apps wire client, using the documented postMessage protocol.
// Kept dependency-free for the local prototype. It is NOT a native-agent API.
class WorkbenchBridge {
  constructor() {
    this.preview = document.documentElement.dataset.preview === 'true';
    this.pending = new Map(); this.nextId = 1; this.capabilities = {}; this.ready = false;
    this.onResult = () => {}; this.onContext = () => {};
    this.listener = event => {
      if (event.source !== window.parent || window.parent === window) return;
      const data = event.data;
      if (!data || data.jsonrpc !== '2.0') return;
      if (this.pending.has(data.id)) {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id); clearTimeout(pending.timer);
        if(data.error){const error=new Error(`${data.error.message ?? 'Host request failed'}${data.error.code!==undefined?` (RPC ${data.error.code})`:''}`);error.code=data.error.code;pending.reject(error);}
        else pending.resolve(data.result);
      } else if (data.method === 'ui/notifications/tool-result') this.onResult(data.params);
      else if (data.method === 'ui/notifications/host-context-changed') this.onContext(data.params);
      else if (data.method === 'ui/resource-teardown' && Object.hasOwn(data, 'id')) {
        this.ready = false;
        window.parent.postMessage({ jsonrpc: '2.0', id: data.id, result: {} }, '*');
      } else if (data.method === 'ping' && Object.hasOwn(data, 'id'))
        window.parent.postMessage({ jsonrpc: '2.0', id: data.id, result: {} }, '*');
    };
    window.addEventListener('message', this.listener);
  }
  request(method, params, timeoutMs = 10000) {
    const id = `tw-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('宿主响应超时，结果尚未确认；请刷新已保存记录后再决定是否重试')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  async connect() {
    if (this.preview) { this.ready = true; return; }
    if (window.parent === window) throw new Error('请在插件面板中打开；本地预览请使用 npm run preview');
    const result = await this.request('ui/initialize', {
      protocolVersion: '2026-01-26', appInfo: { name: 'team-workbench', version: '0.5.4' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }
    });
    this.capabilities = result.hostCapabilities ?? {};
    this.onContext(result.hostContext ?? {});
    this.hostInfo = result.hostInfo;
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
    this.ready = true;
  }
  async call(name, args = {}) {
    if (!this.ready) throw new Error('工作台尚未连接');
    let result;
    if (this.preview) {
      const response = await fetch('/api/tool', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': '/* PREVIEW_TOKEN */' },
        body: JSON.stringify({ name, arguments: args }) });
      if (!response.ok) throw new Error(`本地服务响应 ${response.status}`);
      result = await response.json();
    } else {
      if (!this.capabilities.serverTools) throw new Error('当前宿主没有提供面板工具调用能力');
      result = await this.request('tools/call', { name, arguments: args }, ['team_sync_native_history','team_snapshot','team_panel'].includes(name)?25000:10000);
    }
    if (result.isError) throw new Error(`${result.structuredContent?.error?.code ?? 'ERROR'}: ${result.structuredContent?.error?.message ?? result.content?.[0]?.text ?? '操作失败'}`);
    return result.structuredContent ?? JSON.parse(result.content?.find(c => c.type === 'text')?.text ?? '{}');
  }
  canMessageLead() {
    return this.ready && !this.preview && !!this.capabilities.message?.text
      && !!this.capabilities.experimental?.['openai/message'];
  }
  canOpenLinks() {
    return this.ready && !this.preview && !!this.capabilities.openLinks;
  }
  async openNativeThread(threadId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId ?? ''))
      throw new Error('需要准确的完整原生线程 UUID。');
    if (!this.canOpenLinks()) throw new Error('当前宿主未声明直接打开链接的能力；未向主对话发送消息。');
    // A documented host request, never an OS launch or access to the host DOM.
    const result = await this.request('ui/open-link', { url: `codex://threads/${threadId}` });
    if (result?.isError) throw new Error(result.message ?? '宿主拒绝打开此线程链接。');
    return { accepted: true, viewConfirmed: false };
  }
  async messageLead(message) {
    if (!this.canMessageLead()) throw new Error('Host does not advertise active-conversation messaging; copy the request into the current conversation.');
    const result = await this.request('ui/message', { role: 'user', content: [{ type: 'text', text: message }],
      _meta: { 'openai/message': { target: 'active', send: true } } });
    if (result?.isError) throw new Error('Host declined the execution request');
    return result;
  }
}
