/** One in-flight request per encrypted event channel. Never retry a request silently. */
export class SequentialSession<T, R> {
  private generation = 0;
  private current?: { send(value: T): Promise<void>; close(): void };
  private pending?: { resolve(value: R): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  private open: (message: (value: R) => void, fail: (error: Error) => void) => Promise<{send(value: T): Promise<void>; close(): void}>;
  private timeoutMs: number;
  constructor(open: (message: (value: R) => void, fail: (error: Error) => void) => Promise<{send(value: T): Promise<void>; close(): void}>, timeoutMs = 25000) { this.open = open; this.timeoutMs = timeoutMs; }
  async request(value: T): Promise<R> {
    if (this.pending) throw Error("事件连接正忙");
    const generation = this.generation;
    if (!this.current) {
      const channel = await this.open(v => this.receive(v), e => this.failed(e));
      if (generation !== this.generation) { channel.close(); throw Error("事件连接已关闭"); }
      this.current = channel;
    }
    const channel = this.current;
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => this.failed(Error("远程连接超时")), this.timeoutMs);
      this.pending = {resolve,reject,timer};
      void channel.send(value).catch(error => this.failed(error instanceof Error ? error : Error(String(error))));
    });
  }
  private receive(value: R) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(value);
  }
  private failed(error: Error) {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    this.generation++;
    const channel = this.current; this.current = undefined; channel?.close();
  }
  close() { this.failed(Error("事件连接已关闭")); }
}
