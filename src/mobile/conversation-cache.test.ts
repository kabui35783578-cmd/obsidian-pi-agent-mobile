import test from "node:test";
import assert from "node:assert/strict";
import { ConversationCache } from "./conversation-cache.ts";

const value = (id: string, text: string) => ({ id, messages: [{ text }], events: [] } as any);

test("shares prefetch with a tap and isolates cached data from mutations", async () => {
  let calls = 0;
  const cache = new ConversationCache(async (id) => { calls++; return value(id, "hello"); });
  await Promise.all([cache.load("a"), cache.load("a")]);
  assert.equal(calls, 1);
  cache.get("a")!.messages[0].text = "changed";
  assert.equal(cache.get("a")!.messages[0].text, "hello");
});

test("invalidated or cleared requests cannot overwrite newer cached messages", async () => {
  const requests: ((v: any) => void)[] = [];
  const cache = new ConversationCache(() => new Promise((resolve) => requests.push(resolve)));
  const old = cache.load("a");
  cache.invalidate("a");
  const fresh = cache.load("a");
  requests[0](value("a", "old"));
  requests[1](value("a", "new"));
  await Promise.all([old, fresh]);
  assert.equal(cache.get("a")!.messages[0].text, "new");
  const pending = cache.load("b");
  cache.clear();
  requests[2](value("b", "old"));
  await assert.rejects(pending);
  assert.equal(cache.get("b"), undefined);
});

test("keeps only the configured number of conversations", () => {
  const cache = new ConversationCache(async (id) => value(id, id), 2);
  cache.put(value("a", "a")); cache.put(value("b", "b")); cache.put(value("c", "c"));
  assert.equal(cache.get("a"), undefined);
  assert.ok(cache.get("b")); assert.ok(cache.get("c"));
});
