import { describePreview, isSameDay, plainPreview } from "./artifacts.ts";
import type { Conversation, ConversationSummary, ToolEvent } from "../shared/types.ts";
import { isDelegationMessage } from "../shared/delegation.ts";

export interface TodayTodo {
  id: string;
  text: string;
  note: string;
}
export interface TodayTodos {
  date: string;
  items: TodayTodo[];
  total: number;
  canComplete: boolean;
  warnings: number;
}
export interface TodayResult {
  conversationId: string;
  agentId: string;
  at: string;
  title: string;
  text: string;
  note?: string;
}
export interface TodayRunning {
  conversationId: string;
  agentId: string;
  title: string;
  step?: Pick<ToolEvent, "name" | "status">;
}
export interface TodayActivity {
  results: TodayResult[];
  running: TodayRunning[];
  partial: boolean;
}

type Page = Conversation & { messageOffset?: number };
type TodaySlice = TodayActivity;
type LoadPage = (id: string, before?: number) => Promise<Page>;

const MAX_CONVERSATIONS = 40;
const MAX_PAGES = 6;

/** Reuse saved message bodies so recurring refreshes only read changed chats. */
export class TodayActivityIndex {
  private cache = new Map<string, { key: string; result: TodaySlice }>();

  async list(summaries: ConversationSummary[], load: LoadPage, now: Date, active: () => boolean): Promise<TodayActivity> {
    const candidates = summaries
      .filter((item) => item.status === "running" || isSameDay(item.updatedAt, now))
      .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") ||
        b.updatedAt.localeCompare(a.updatedAt));
    const selected = candidates.slice(0, MAX_CONVERSATIONS);
    const keep = new Set(selected.map((item) => item.id));
    const items: TodaySlice[] = [];
    let offset = 0;
    let partial = selected.length < candidates.length;
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (offset < selected.length && active()) {
        const item = selected[offset++];
        const key = JSON.stringify([now.toDateString(), item.updatedAt, item.messageCount, item.status]);
        const existing = this.cache.get(item.id);
        try {
          const result = existing?.key === key && item.status !== "running"
            ? existing.result : await readConversation(item, load, now, active);
          if (!active()) return;
          if (!result.partial) this.cache.set(item.id, { key, result });
          items.push(result);
        } catch {
          partial = true;
          if (item.status === "running") items.push({
            results: [], partial: true, running: [{
              conversationId: item.id, agentId: item.agentId, title: item.title,
            }],
          });
        }
      }
    }));
    if (active()) for (const id of this.cache.keys()) if (!keep.has(id)) this.cache.delete(id);
    return {
      results: items.flatMap((item) => item.results).sort((a, b) => b.at.localeCompare(a.at)),
      running: items.flatMap((item) => item.running),
      partial: partial || items.some((item) => item.partial),
    };
  }
}

async function readConversation(item: ConversationSummary, load: LoadPage, now: Date, active: () => boolean): Promise<TodaySlice> {
  const results: TodayResult[] = [];
  const running: TodayRunning[] = [];
  let before: number | undefined;
  let partial = false;
  for (let pageIndex = 0; pageIndex < MAX_PAGES && active(); pageIndex++) {
    const page = await load(item.id, before);
    const offset = page.messageOffset ?? 0;
    if (pageIndex === 0 && page.status === "running") {
      const userIndex = page.messages.findLastIndex((message) => message.role === "user");
      const userMessage = page.messages[userIndex];
      const step = [...page.events].reverse().find((event) =>
        event.messageIndex === undefined || userIndex === -1 || event.messageIndex >= offset + userIndex,
      );
      running.push({
        conversationId: item.id, agentId: item.agentId,
        title: plainPreview(userMessage?.text ?? item.title).slice(0, 100) || item.title,
        ...(step ? { step: { name: step.name, status: step.status } } : {}),
      });
    }
    for (let index = 0; index < page.messages.length; index++) {
      const message = page.messages[index];
      if (message.role !== "assistant" || message.kind === "command" ||
          isDelegationMessage(message, page, offset + index) || !isSameDay(message.at, now)) continue;
      const result = describeResult(message.text);
      if (result) results.push({
        ...result, text: message.text, at: message.at, agentId: item.agentId, conversationId: item.id,
      });
    }
    const oldest = page.messages[0];
    if (!offset || !oldest || (!isSameDay(oldest.at, now) && new Date(oldest.at) < now)) break;
    if (pageIndex === MAX_PAGES - 1 || (before !== undefined && offset >= before)) {
      partial = true;
      break;
    }
    before = offset;
  }
  return { results, running, partial };
}

function describeResult(text: string): { title: string; note?: string } | undefined {
  const heading = plainPreview(text.trimStart().split(/\r?\n/, 1)[0]);
  const brief = describePreview(text);
  // Reports can be plain Markdown. Match a real heading or a report title,
  // rather than every chat message that mentions a report in passing.
  if (heading && heading.length <= 90 &&
      /^(?:[\p{Extended_Pictographic}\uFE0F\s]+)?(?:今日|每日|本日|本周|本月|\d{4}-\d{2}-\d{2}\s*)?[\p{L}\p{N}、·\s-]{0,24}(?:日报|周报|月报|报告|复盘|简报)(?:\s|[：:（(·]|$)/u.test(heading) &&
      (text.includes("\n") || /^\s*(?:#{1,6}\s|\*\*)/.test(text))) return { title: heading };
  if (brief.file?.missing || !brief.structured) return;
  const note = brief.file?.path;
  return { title: brief.title || "助手结果", ...(note ? { note } : {}) };
}
