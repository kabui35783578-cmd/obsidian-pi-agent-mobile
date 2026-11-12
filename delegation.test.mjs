import test from 'node:test';
import assert from 'node:assert/strict';
import { delegationAnchor, isDelegationMessage, delegationTitle } from './src/shared/delegation.ts';

test('completed handoff follows the answer in its own turn; running stays at the request', () => {
  const messages = [{role:'user'}, {role:'assistant'}, {role:'assistant'}, {role:'user'}, {role:'assistant'}];
  assert.equal(delegationAnchor({messageIndex:0,status:'running'}, messages), 0);
  assert.equal(delegationAnchor({messageIndex:0,status:'completed'}, messages), 2);
  assert.equal(delegationAnchor({messageIndex:-1,status:'completed'}, messages), -1);
});
test('internal handoff is hidden in normal chat but explicit delegation can be identified', () => {
  assert.equal(isDelegationMessage({role:'user'}, {source:'delegation',parent:{}}, 0), true);
  assert.equal(isDelegationMessage({role:'user'}, {source:'mobile'}, 0), false);
  assert.equal(isDelegationMessage({role:'user',kind:'delegation'}, {source:'mobile'}, 2), true);
  assert.equal(delegationTitle(undefined), '处理协作任务');
});
