import test from 'node:test';import assert from 'node:assert/strict';import {streamFrame} from './src/mobile/stream-frame.ts';
test('a burst appears in incremental frames and catches up without losing text',()=>{
 const text='流式输出'.repeat(50);let shown='',frames=0,last=0;
 while(shown!==text){const next=streamFrame(text,shown);assert.ok(next.value.length>last);shown=next.value;last=shown.length;frames++;assert.ok(frames<25);}
 assert.ok(frames>1);assert.equal(streamFrame(text,shown).pending,false);
});
test('emoji, replacement snapshots and tiny deltas remain whole',()=>{
 const text='👨‍👩‍👧‍👦你好🙂';let shown='';while(shown!==text){shown=streamFrame(text,shown).value;assert.ok(!shown.endsWith('\u200d'));}assert.equal(streamFrame('新的内容','正在电脑处理…').value,'新的');
});
