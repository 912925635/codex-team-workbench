import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { reviewPublicFiles } from './review-public.mjs';
// Deterministic uncompressed ZIP, no external archive utility or dependency.
const root = resolve(import.meta.dirname, '..');
const check = spawnSync(process.execPath, [join(root, 'scripts/check.mjs')], { stdio: 'inherit', windowsHide: true });
assert.equal(check.status, 0, 'Package validation failed');
const review = reviewPublicFiles(root);
assert.deepEqual(review.findings, [], 'Public package privacy review failed');
const names = review.files.map(file => file.path).sort();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = []; let offset = 0;
for (const name of names) {
  const path = Buffer.from(`team-workbench/${name}`), data = readFileSync(join(root, name)), crc = crc32(data);
  const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6);
  h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(path.length, 26);
  local.push(h, path, data);
  const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
  c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(path.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, path); offset += h.length + path.length + data.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync(join(root, 'artifacts'), { recursive: true });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const target = join(root, `artifacts/team-workbench-local-${version}.zip`);
writeFileSync(target, Buffer.concat([...local, directory, end]));
console.log(`Local prototype package: ${target} (${names.length} files). Not installed or published.`);
