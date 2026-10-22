import type { ConversationSummary, ToolEvent } from "./types.ts";

export function latestByAgent(items: ConversationSummary[]) {
  const latest = new Map<string, ConversationSummary>();
  for (const item of items) {
    if (item.archive || !item.messageCount) continue;
    const previous = latest.get(item.agentId);
    if (!previous || item.updatedAt > previous.updatedAt)
      latest.set(item.agentId, item);
  }
  return latest;
}

/** Pair terminal events with the most recent pending call, including nested same-name calls. */
export function toolSteps(events: ToolEvent[]) {
  const steps: ToolEvent[] = [];
  const pending = new Map<string, number[]>();
  for (const event of events) {
    const key = JSON.stringify([event.taskId, event.name]);
    const stack = pending.get(key);
    if (event.status !== "running" && stack?.length)
      steps[stack.pop()!] = event;
    else {
      if (event.status === "running") {
        if (stack) stack.push(steps.length);
        else pending.set(key, [steps.length]);
      }
      steps.push(event);
    }
  }
  return steps;
}
