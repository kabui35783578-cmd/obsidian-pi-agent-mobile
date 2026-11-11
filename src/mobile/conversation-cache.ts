import type { Conversation } from "../shared/types.ts";

/** A bounded, memory-only cache. Invalidating a request also fences late replies. */
export class ConversationCache {
  private values = new Map<string, Conversation>();
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
    return value ? structuredClone(value) : undefined;
  }
  put(value: Conversation) {
    this.values.delete(value.id);
    this.values.set(value.id, structuredClone(value));
    while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!);
  }
  invalidate(id: string) {
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
