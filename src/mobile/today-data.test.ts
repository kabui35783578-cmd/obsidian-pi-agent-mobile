import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, Conversation, ConversationSummary } from "../shared/types.ts";
import { TodayActivityIndex } from "./today-data.ts";

const now = new Date(2026, 10, 25, 22, 15);
const at = now.toISOString();
const yesterday = new Date(2026, 10, 24, 16).toISOString();
const report = "📊 今日消费日报 2026-11-25\n今天共支出 20 元。";
const message = (text: string, time = at, role: ChatMessage["role"] = "assistant"): ChatMessage => ({ text, at: time, role });

function page(id: string, messages: ChatMessage[], status: Conversation["status"] = "idle"): Conversation {
  return { id, title: "店铺事项", agentId: "assistant", status, updatedAt: at, source: "desktop", events: [], messages };
}
function summary(value: Conversation): ConversationSummary {
  const { messages, events: _events, ...info } = value;
  return { ...info, messageCount: messages.length, preview: "更晚的一条聊天消息" };
}

test("Today reads exact same-day result messages even when a newer reply changed the conversation preview", async () => {
  const old = page("a", [message("# 昨日简报\n昨日内容", yesterday), message(report)]);
  const latest = { ...page("a", [message("谢谢，已经了解", at)]), messageOffset: 2 };
  const task = page("b", [message("整理店铺资料", at, "user")], "running");
  task.events.push({ name: "vault_read", status: "completed", taskId: "1", messageIndex: 0 });
  const loadCalls: string[] = [];
  const index = new TodayActivityIndex();
  const load = async (id: string, before?: number) => {
    loadCalls.push(id + ":" + before);
    return id === "b" ? task : before === undefined ? latest : old;
  };
  const result = await index.list([summary(latest), summary(task)], load, now, () => true);
  assert.deepEqual(result.results.map(({ text, conversationId }) => ({ text, conversationId })), [
    { text: report, conversationId: "a" },
  ]);
  assert.equal(result.running[0].title, "整理店铺资料");
  assert.deepEqual(result.running[0].step, { name: "vault_read", status: "completed" });
  assert.equal(result.partial, false);
  await index.list([summary(latest), summary(task)], load, now, () => true);
  assert.deepEqual(loadCalls.sort(), ["a:2", "a:undefined", "b:undefined", "b:undefined"]);
});

test("Today preserves known running conversations and marks missing data when a page fails", async () => {
  const running = page("b", [], "running");
  const result = await new TodayActivityIndex().list([summary(running)], async () => { throw Error("lost"); }, now, () => true);
  assert.ok(result.partial);
  assert.equal(result.results.length, 0);
  assert.equal(result.running[0].conversationId, "b");
});
