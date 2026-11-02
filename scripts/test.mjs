import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const files = readdirSync(join(root, 'test')).filter(n => n.endsWith('.test.mjs')).sort().map(n => join(root, 'test', n));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
