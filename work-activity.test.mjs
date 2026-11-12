import test from 'node:test';
import assert from 'node:assert/strict';
import { activityState, activitySummary } from './src/shared/work-activity.ts';
const step=(name,status='completed',taskId='task')=>({name,status,taskId});
test('summarizes graph searches and note reads like the desktop view',()=>{
 assert.equal(activitySummary([step('graph_query'),step('graph_query'),step('graph_read'),step('vault_write')]),'已读取 1 项资料，已检索 2 次，已写入 1 次文件');
});
test('distinguishes live, interrupted, stopped, and failed operations',()=>{
 assert.equal(activityState(step('graph_read','running'),'task'),'running');
 assert.equal(activityState(step('graph_read','running')),'incomplete');
 assert.equal(activityState(step('graph_read','running'),undefined,true),'stopped');
 assert.match(activitySummary([step('graph_query','failed')]),/有操作失败/);
});
