import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withClient } from '../src/mcp-client.mjs';

// Read request JSON from stdin or --request FILE; no shell-interpolated JSON.
const argv = process.argv.slice(2), directoryIndex = argv.indexOf('--data'), requestIndex = argv.indexOf('--request');
if (directoryIndex < 0 || !argv[directoryIndex + 1]) {
  console.error('Usage: node scripts/workbench.mjs --data EXPLICIT_DATA_DIRECTORY [--request request.json]'); process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(readFileSync(requestIndex >= 0 ? resolve(argv[requestIndex + 1]) : 0, 'utf8').replace(/^\uFEFF/, ''));
    const result = await withClient(resolve(argv[directoryIndex + 1]), c => c.call(input.name, input.arguments ?? {}));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (e) { console.error(JSON.stringify({ error: { code: e.code ?? 'CLIENT_ERROR', message: e.message } })); process.exitCode = 1; }
}
