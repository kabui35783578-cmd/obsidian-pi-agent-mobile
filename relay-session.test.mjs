import test from 'node:test';
import assert from 'node:assert/strict';
import { SequentialSession } from './src/shared/sequential-session.ts';

test('reuses a channel for sequential polls and reconnects after failure', async () => {
 let opens=0, onMessage, onFail, closes=0;
 const session=new SequentialSession(async (message,fail)=>{opens++;onMessage=message;onFail=fail;return {send:async()=>{},close:()=>{closes++}}});
 let pending=session.request('first'); await new Promise(r=>setTimeout(r,0)); onMessage('one'); assert.equal(await pending,'one');
 pending=session.request('second'); await new Promise(r=>setTimeout(r,0)); onMessage('two'); assert.equal(await pending,'two');assert.equal(opens,1);
 pending=session.request('third'); await new Promise(r=>setTimeout(r,0)); onFail(Error('disconnected'));await assert.rejects(pending,/disconnected/);
 pending=session.request('fourth'); await new Promise(r=>setTimeout(r,0)); onMessage('four'); assert.equal(await pending,'four');assert.equal(opens,2);session.close();assert.equal(closes,2);
});
test('close during connection rejects rather than resurrecting a paused session', async ()=>{
 let open; let closed=0;
 const session=new SequentialSession(()=>new Promise(resolve=>{open=resolve}));
 const pending=session.request('poll');session.close();open({send:async()=>{},close:()=>closed++});
 await assert.rejects(pending,/已关闭/);assert.equal(closed,1);
});
