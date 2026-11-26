import type { Conversation } from "../shared/types.ts";

/** A bounded, memory-only cache. Invalidating a request also fences late replies. */
export class ConversationCache {
  private values = new Map<string, { conversation: Conversation; fresh: boolean }>();
  private pending = new Map<string, Promise<Conversation>>();
  private versions = new Map<string, number>();
  private epoch = 0;
  private fetch: (id: string) => Promise<Conversation>;
  private max: number;
  constructor(fetch: (id: string) => Promise<Conversation>, max = 12) {
    this.fetch = fetch;
    this.max = max;
  }
  get(id: string) {
    const value = this.values.get(id);
    return value ? structuredClone(value.conversation) : undefined;
  }
  put(value: Conversation) {
    const previous = this.values.get(value.id);
    const conversation = previous && sameConversationData(previous.conversation, value)
      ? previous.conversation
      : structuredClone(value);
    this.values.delete(value.id);
    this.values.set(value.id, { conversation, fresh: true });
    while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!);
  }
  async prefetch(id: string) {
    if (!this.values.get(id)?.fresh) await this.load(id);
  }
  invalidate(id: string) {
    const cached = this.values.get(id);
    if (cached) cached.fresh = false;
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    this.pending.delete(id);
  }
  clear() {
    this.epoch++;
    this.values.clear();
    this.pending.clear();
    this.versions.clear();
  }
  load(id: string): Promise<Conversation> {
    const existing = this.pending.get(id);
    if (existing) return existing;
    const version = this.versions.get(id) ?? 0, epoch = this.epoch;
    const request = this.fetch(id).then((value) => {
      if (epoch !== this.epoch) throw Error("缓存已重置");
      if (version !== (this.versions.get(id) ?? 0)) return this.load(id);
      this.put(value);
      return value;
    }).finally(() => {
      if (this.pending.get(id) === request) this.pending.delete(id);
    });
    this.pending.set(id, request);
    return request;
  }
}

/** Compare snapshots from the wire without creating copies of long message text. */
export function sameConversationData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameConversationData(value, right[index]));
  }
  if (Array.isArray(right)) return false;
  const before = left as Record<string, unknown>;
  const after = right as Record<string, unknown>;
  const keys = Object.keys(before);
  return keys.length === Object.keys(after).length &&
    keys.every(key => Object.hasOwn(after, key) && sameConversationData(before[key], after[key]));
}
