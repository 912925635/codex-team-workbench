import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const files = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.team-workbench', 'node_modules', 'artifacts', '.git'].includes(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path); else files.push(path);
  }
}
walk(root);
for (const path of files.filter(f => /\.(mjs|js)$/.test(f))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
for (const path of files.filter(f => f.endsWith('.json'))) JSON.parse(readFileSync(path, 'utf8'));
const portable = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
const legacy = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
const mcp = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8'));
const legacyMcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(portable.name));
assert(/^\d+\.\d+\.\d+$/.test(portable.version));
assert.equal(legacy.name, portable.name); assert.equal(legacy.version, portable.version);
const presentation = portable.extensions['com.openai'].interface;
assert(presentation.shortDescription.length <= 30);
assert.equal(presentation.category, 'Productivity');
for (const key of ['logo', 'composerIcon']) assert(files.includes(resolve(root, presentation[key])));
assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
assert.equal(mcp.mcpServers['team-workbench'].args[0], '${PLUGIN_ROOT}/src/server.mjs');
assert.equal(legacy.mcpServers, './.mcp.json');
assert.deepEqual(legacyMcp.mcpServers['team-workbench'].args, mcp.mcpServers['team-workbench'].args);
// Bundled definitions require normal host trust; checking them never enables hooks.
assert.equal(legacy.hooks, './examples/hooks/hooks.json');
assert.equal(portable.extensions['com.openai'].hooks, legacy.hooks);
const hooks = JSON.parse(readFileSync(resolve(root, legacy.hooks), 'utf8')).hooks;
assert.deepEqual(Object.keys(hooks).sort(), ['PreModelRequest','SubagentStart','SubagentStop'].sort());
for (const groups of Object.values(hooks)) for (const group of groups) for (const handler of group.hooks) {
  assert.equal(handler.type, 'command');
  assert.equal(handler.command, 'node \"${PLUGIN_ROOT}/src/native-hook.mjs\"');
}
const skill = readFileSync(join(root, 'skills/team-workbench/SKILL.md'), 'utf8');
assert(skill.startsWith('---\nname: team-workbench\ndescription:'));
for (const file of files) {
  if (!/\.(md|json|mjs|js|html|css|svg)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  assert(!/[A-Z]:\\Users\\[^\\\s]+\\/i.test(content), `Personal absolute path in ${relative(root, file)}`);
  assert(!/sk-[a-zA-Z0-9_-]{20,}/.test(content), `Potential secret in ${relative(root, file)}`);
}
console.log(`PASS: syntax, JSON, manifest consistency, skill structure, reviewable hook definitions, and path/secret checks (${files.length} files).`);
console.log('No TypeScript compiler or third-party lint dependency is required; these are JavaScript syntax and structural checks.');
