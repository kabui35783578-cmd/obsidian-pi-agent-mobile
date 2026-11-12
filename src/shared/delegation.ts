import type { ChatMessage, Conversation, DelegationRecord } from "./types.ts";

/** Finished receipts follow the visible answer of their own turn. */
export function delegationAnchor(
  record: DelegationRecord,
  messages: ChatMessage[],
) {
  let anchor = record.messageIndex;
  if(!Number.isSafeInteger(anchor)||anchor<0||anchor>=messages.length)return anchor;
  if (["queued", "running"].includes(record.status)) return anchor;
  for (
    let i = anchor + 1;
    i < messages.length && messages[i].role !== "user";
    i++
  )
    if (messages[i].role === "assistant") anchor = i;
  return anchor;
}

/** Public task names are supplied separately; never derive them from a prompt. */
export function delegationTitle(summary?: string) {
  return summary?.replace(/\s+/g, " ").trim().slice(0, 80) || "处理协作任务";
}

export function isDelegationMessage(
  message: ChatMessage,
  conversation: Pick<Conversation, "source" | "parent">,
  index: number,
) {
  return (
    message.kind === "delegation" ||
    (index === 0 &&
      conversation.source === "delegation" &&
      !!conversation.parent &&
      message.role === "user")
  );
}
