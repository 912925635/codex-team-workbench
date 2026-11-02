import {test}from'node:test';import assert from'node:assert/strict';
import{planDevelopmentHookRetirement}from'../scripts/hook-migration-plan.mjs';
const group={hooks:[{type:'command',command:'fixture-native-probe',timeout:3}]};
const expected={hooks:{SubagentStart:[group],SubagentStop:[group],PreModelRequest:[group]}};
const installed=['subagentStart','subagentStop','preModelRequest'].map(eventName=>({eventName,pluginId:'fixture-plugin',enabled:true,trustStatus:'trusted'}));
test('migration plan requires actual plugin source identity and all trusted enabled handlers',()=>{
 for(const hooks of [[],installed.slice(0,2),installed.map(h=>({...h,trustStatus:'untrusted'}))])
  assert.equal(planDevelopmentHookRetirement(expected,expected,hooks,'fixture-plugin').allowed,false);
 assert.equal(planDevelopmentHookRetirement(expected,expected,installed,'another-plugin').allowed,false);
});
test('isolated plan retires exact development groups without touching unrelated configuration or input',()=>{
 const original={description:'fixture',hooks:{PreToolUse:[{hooks:[{type:'command',command:'unrelated'}]}],...expected.hooks},other:{preserve:true}};
 const before=JSON.stringify(original),plan=planDevelopmentHookRetirement(original,expected,installed,'fixture-plugin');
 assert.equal(plan.allowed,true);assert.equal(plan.removed.length,3);assert.equal(plan.applied,false);assert.equal(plan.trustModified,false);
 assert.deepEqual(plan.proposedConfiguration.hooks.PreToolUse,original.hooks.PreToolUse);assert.deepEqual(plan.proposedConfiguration.other,original.other);assert.equal(JSON.stringify(original),before);
});
test('ambiguous, changed or position-shifting definitions block instead of uninstalling another hook',()=>{
 const shifted={hooks:{SubagentStart:[group,{hooks:[{command:'other'}]}],SubagentStop:[group]}};
 assert.equal(planDevelopmentHookRetirement(shifted,expected,installed,'fixture-plugin').reason,'POSITIONAL_TRUST_RISK');
 assert.equal(planDevelopmentHookRetirement({hooks:{}},expected,installed,'fixture-plugin').reason,'DEVELOPMENT_DEFINITION_CHANGED');
});
