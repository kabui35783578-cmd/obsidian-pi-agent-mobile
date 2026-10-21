import {
  decodePairCode,
  remoteEndpoint,
  remoteId,
  remoteSecret,
  REMOTE_PATH,
  seal,
  unseal,
  type Envelope,
  type RemoteCredential,
} from "../shared/mobile-wire.ts";
export type RemoteTransport = (
  url: string,
  envelope: Envelope,
) => Promise<Envelope>;
export class MobileClient {
  credential?: RemoteCredential;
  description: any;
  connected = false;
  status = "尚未连接电脑";
  private listeners = new Set<(event: any) => void>();
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private cursor = 0;
  private streamId = "";
  private failures = 0;
  private paused = false;
  constructor(private transport: RemoteTransport) {}
  subscribe(listener: (event: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: any) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* Isolate view failures from the polling loop. */
      }
    }
  }
  private async exchange(
    secret: string,
    header: Pick<Envelope, "identity" | "requestId" | "kind">,
    endpoint: string,
    method: string,
    params: any,
  ) {
    const request = await seal(
      secret,
      header,
      { issuedAt: Date.now(), method, params },
      "request",
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      this.transport(endpoint + REMOTE_PATH, request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("电脑连接超时，请检查同一网络、VPN 和防火墙")),
          30_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (
      response?.identity !== header.identity ||
      response.requestId !== header.requestId ||
      response.kind !== header.kind
    )
      throw Error("电脑响应与请求不匹配，连接已拒绝");
    const body = await unseal<{ ok: boolean; result?: any; error?: string }>(
      secret,
      response,
      "response",
    );
    if (!body.ok) throw Error(body.error || "电脑操作未完成");
    return body.result;
  }
  async pair(
    input: string,
    name: string,
    endpoint?: string,
  ): Promise<RemoteCredential> {
    const code = decodePairCode(input);
    endpoint = remoteEndpoint(endpoint || code.endpoint);
    const secret = remoteSecret();
    const result = await this.exchange(
      code.secret,
      { identity: code.pairId, requestId: remoteId(), kind: "pair" },
      endpoint || code.endpoint,
      "pair",
      { clientId: remoteId(), secret, name },
    );
    if (result.hostId !== code.hostId) throw Error("配对电脑身份不匹配");
    return {
      endpoint,
      deviceId: result.deviceId,
      secret,
      hostId: result.hostId,
      vaultName: result.vaultName,
    };
  }
  async connect(credential: RemoteCredential) {
    this.pause();
    this.credential = credential;
    this.status = "正在连接电脑…";
    this.emit({ type: "connection" });
    try {
      const description = await this.call("host.describe");
      if (description.hostId !== credential.hostId)
        throw Error("电脑身份已变化，请重新配对");
      this.description = description;
      this.connected = true;
      this.status = "已连接 · " + description.vaultName;
      this.failures = 0;
      this.cursor = 0;
      this.streamId = "";
      this.emit({ type: "connection" });
      this.resume();
      return description;
    } catch (error) {
      this.connected = false;
      this.status = error instanceof Error ? error.message : String(error);
      this.emit({ type: "connection" });
      throw error;
    }
  }
  async call<T = any>(method: string, params: any = {}): Promise<T> {
    const credential = this.credential;
    if (!credential) throw Error("请先与电脑配对");
    return this.exchange(
      credential.secret,
      { identity: credential.deviceId, requestId: remoteId(), kind: "rpc" },
      credential.endpoint,
      method,
      params,
    );
  }
  mutation<T = any>(
    method: string,
    params: any = {},
    operationId: string = remoteId(),
  ): Promise<T> {
    return this.call(method, { ...params, operationId });
  }
  pause() {
    this.paused = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  resume() {
    if (!this.credential || !this.paused) return;
    this.paused = false;
    const generation = ++this.generation;
    void this.poll(generation);
  }
  close() {
    this.pause();
    this.connected = false;
    this.listeners.clear();
  }
  private async poll(generation: number) {
    try {
      const batch = await this.call("events.poll", {
        after: this.cursor,
        streamId: this.streamId,
      });
      if (generation !== this.generation) return;
      this.cursor = batch.cursor;
      this.streamId = batch.streamId;
      this.connected = true;
      this.failures = 0;
      this.status =
        "已连接 · " +
        (this.description?.vaultName || this.credential?.vaultName);
      if (batch.reset)
        this.emit({ type: "remote.reset", streams: batch.streams });
      for (const item of batch.events)
        this.emit({ ...item.event, remoteSequence: item.seq });
    } catch (error) {
      if (generation !== this.generation) return;
      this.connected = false;
      this.failures++;
      this.status =
        "连接中断，将重试：" +
        (error instanceof Error ? error.message : String(error));
    }
    if (generation !== this.generation || this.paused) return;
    this.emit({ type: "connection" });
    this.timer = setTimeout(
      () => void this.poll(generation),
      this.failures
        ? Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5))
        : 30,
    );
  }
}
