import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPublicKey,createDaemonChannel} from '@getpaseo/relay/e2ee';
import {relayEventSession} from './src/shared/relay-wire.ts';

test('event session exchanges consecutive messages over one encrypted channel', async () => {
 const Original=globalThis.WebSocket; const keys=generateKeyPair(); let sockets=0, sent=0;
 class FakeSocket extends EventTarget {
   binaryType='arraybuffer'; readyState=1; daemon;
   constructor(){super();sockets++; const transport={onmessage:null,onclose:null,onerror:null,send:data=>{const binary=typeof data!=='string';const converted=binary?(data instanceof ArrayBuffer?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)):data;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:converted})));},close:()=>{}};this.daemon=transport;
    queueMicrotask(()=>{void (async()=>{let channel;channel=await createDaemonChannel(transport,keys,{onmessage: data=>{sent++;void channel.send(data)}})})();this.dispatchEvent(new Event('open'));});
   }
   send(data){const binary=typeof data!=='string';const converted=binary?(data instanceof ArrayBuffer?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)):data;queueMicrotask(()=>this.daemon.onmessage?.({data:converted,isBinary:binary}));}
   close(){this.readyState=3;queueMicrotask(()=>this.dispatchEvent(new Event('close')))}
 }
 globalThis.WebSocket=FakeSocket;
 try {const session=relayEventSession('https://relay.example',{route:'obot-00000000-0000-0000-0000-000000000000',key:exportPublicKey(keys.publicKey)});const a={identity:'a',requestId:'one',kind:'rpc'},b={identity:'a',requestId:'two',kind:'rpc'};assert.deepEqual(await session.request(a),a);assert.deepEqual(await session.request(b),b);assert.equal(sent,2);assert.equal(sockets,1);session.close();} finally {globalThis.WebSocket=Original;}
});
