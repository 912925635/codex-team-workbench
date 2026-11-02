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
        data.error ? pending.reject(new Error(data.error.message ?? 'Host request failed')) : pending.resolve(data.result);
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
  request(method, params) {
    const id = `tw-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('宿主未响应，请刷新后重试')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  async connect() {
    if (this.preview) { this.ready = true; return; }
    if (window.parent === window) throw new Error('请在插件面板中打开；本地预览请使用 npm run preview');
    const result = await this.request('ui/initialize', {
      protocolVersion: '2026-01-26', appInfo: { name: 'team-workbench', version: '0.4.6' },
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
      result = await this.request('tools/call', { name, arguments: args });
    }
    if (result.isError) throw new Error(`${result.structuredContent?.error?.code ?? 'ERROR'}: ${result.structuredContent?.error?.message ?? result.content?.[0]?.text ?? '操作失败'}`);
    return result.structuredContent ?? JSON.parse(result.content?.find(c => c.type === 'text')?.text ?? '{}');
  }
  canMessageLead() {
    return this.ready && !this.preview && !!this.capabilities.message?.text
      && !!this.capabilities.experimental?.['openai/message'];
  }
  async messageLead(message) {
    if (!this.canMessageLead()) throw new Error('Host does not advertise active-conversation messaging; copy the request into the current conversation.');
    const result = await this.request('ui/message', { role: 'user', content: [{ type: 'text', text: message }],
      _meta: { 'openai/message': { target: 'active', send: true } } });
    if (result?.isError) throw new Error('Host declined the execution request');
    return result;
  }
}
