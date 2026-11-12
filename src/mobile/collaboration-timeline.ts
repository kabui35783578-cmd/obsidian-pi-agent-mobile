import type { ChatMessage, DelegationRecord } from '../shared/types.ts';

/** Merge receipt positions with visible chat timestamps, preserving equal-time order. */
export function receiptPositions(messages: ChatMessage[], records: DelegationRecord[]) {
  const sorted = [...records].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.conversationId.localeCompare(b.conversationId));
  return sorted.map(record => {
    const time = Date.parse(record.updatedAt);
    const index = Number.isFinite(time) ? messages.findIndex(message => {
      const at = Date.parse(message.at);
      return Number.isFinite(at) && at > time;
    }) : -1;
    return { record, index: index < 0 ? messages.length : index };
  });
}

/** Do not infer ownership for a receipt older than this chat. Existing bindings win. */
export function receiptOwner(existing: string | undefined, conversationId: string, startedAt: string, receiptAt: string) {
  if (existing) return existing;
  const start = Date.parse(startedAt), at = Date.parse(receiptAt);
  return Number.isFinite(start) && Number.isFinite(at) && at >= start ? conversationId : undefined;
}
