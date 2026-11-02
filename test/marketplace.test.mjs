import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {reviewPublicFiles} from '../scripts/review-public.mjs';
const root=resolve(import.meta.dirname,'..');
const read=path=>JSON.parse(readFileSync(join(root,path),'utf8'));

test('GitHub marketplace resolves the root plugin and its reviewed hook resources without private IDs',()=>{
  const market=read('.agents/plugins/marketplace.json'),plugin=read('plugin.json');
  assert.equal(market.name,'codex-team-workbench');assert.equal(market.plugins.length,1);
  const entry=market.plugins[0];assert.equal(entry.name,plugin.name);
  assert.equal(entry.source.source,'local');assert.equal(entry.source.path,'./');
  assert.equal(resolve(root,entry.source.path),root);assert(!entry.pluginId);
  const hooks=plugin.extensions['com.openai'].hooks;assert(hooks.startsWith('./'));
  assert(existsSync(resolve(root,hooks)));assert.equal(read('.codex-plugin/plugin.json').hooks,hooks);
  assert.deepEqual(Object.keys(read(hooks).hooks).sort(),['PreModelRequest','SubagentStart','SubagentStop'].sort());
});

test('public source allowlist excludes runtime evidence and includes all install and license files',()=>{
  const review=reviewPublicFiles(root);assert.deepEqual(review.findings,[]);
  const names=review.files.map(f=>f.path);
  for(const path of ['.agents/plugins/marketplace.json','src/native-hook.mjs','src/read-native-metadata.ps1','LICENSE','LICENSES/DeepSeek-Harness-MIT.txt','CHANGELOG.md'])assert(names.includes(path));
  assert(!names.some(path=>/^(artifacts|\.team-workbench|\.git)\//.test(path)));
});
