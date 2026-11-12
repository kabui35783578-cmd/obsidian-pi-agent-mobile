import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptOwner, receiptPositions} from './src/mobile/collaboration-timeline.ts';
const msg = at => ({role:'user',at});
const receipt = (id,at) => ({conversationId:id,updatedAt:at});
test('a new chat does not adopt an older incoming exchange',()=>{
 assert.equal(receiptOwner(undefined,'new','2026-11-12T15:49:00Z','2026-11-12T13:09:00Z'),undefined);
 assert.equal(receiptOwner('old','new','2026-11-12T15:49:00Z','2026-11-12T16:00:00Z'),'old');
 assert.equal(receiptOwner(undefined,'new','2026-11-12T15:49:00Z','2026-11-12T15:50:00Z'),'new');
 assert.equal(receiptOwner(undefined,'new','invalid','2026-11-12T15:50:00Z'),undefined);
});
test('receipts are inserted chronologically among messages, with stable ordering',()=>{
 const messages=[msg('2026-11-12T13:00:00Z'),msg('2026-11-12T15:00:00Z')];
 const positions=receiptPositions(messages,[receipt('late','2026-11-12T16:00:00Z'),receipt('middle','2026-11-12T14:00:00Z'),receipt('early','2026-11-12T12:00:00Z')]);
 assert.deepEqual(positions.map(({record,index})=>[record.conversationId,index]),[['early',0],['middle',1],['late',2]]);
});
