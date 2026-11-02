import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { callTool } from './tools.mjs';
import { appHtml } from './ui-resource.mjs';

// The preview is a real local board, NOT a substitute for host integration testing.
export async function startPreview({ port = 0, directory } = {}) {
  const store = new Store(directory);
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'" };
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { ...headers, 'Content-Type': `${type}; charset=utf-8` });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    // Keep browser access loopback-only, same-origin and token-bound; no CORS grants.
    if (req.headers.host !== `127.0.0.1:${address.port}` || (req.headers.origin && req.headers.origin !== origin))
      return send(403, { error: 'Origin denied' });
    if (req.method === 'GET' && req.url === '/')
      return send(200, appHtml(true).replace('/* PREVIEW_TOKEN */', token), 'text/html');
    if (req.method !== 'POST' || req.url !== '/api/tool') return send(404, { error: 'Not found' });
    if (req.headers['x-workbench-token'] !== token || !req.headers['content-type']?.startsWith('application/json'))
      return send(403, { error: 'Preview token required' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 65536) return send(413, { error: 'Request too large' });
      }
      const input = JSON.parse(body);
      return send(200, callTool(store, input.name, input.arguments));
    } catch { return send(400, { error: 'Invalid request' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, store, server,
    close: () => new Promise((resolve, reject) => server.close(e => { store.close(); e ? reject(e) : resolve(); })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.TEAM_WORKBENCH_PORT ?? 0);
  const preview = await startPreview({ port });
  console.log(`Team Workbench local preview: ${preview.url}`);
  console.log('Real persistent board; native agent connection is unavailable. Ctrl+C stops this preview only.');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (closing) return; closing = true; void preview.close().then(() => process.exit(0));
  });
}
