import { createClientChannel, type Transport } from "@getpaseo/relay/e2ee";
import { relayEndpoint, type Envelope } from "./mobile-wire.ts";

export function relaySocket(endpoint: string, route: string, role: "server" | "client", connectionId?: string) {
  const url = new URL("/ws", relayEndpoint(endpoint));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("serverId", route);
  url.searchParams.set("role", role);
  url.searchParams.set("v", "2");
  if (connectionId) url.searchParams.set("connectionId", connectionId);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  return ws;
}

export function relayAdapter(ws: WebSocket): Transport {
  const transport: Transport = {
    send: data => ws.send(data), close: (code, reason) => ws.close(code, reason),
    onmessage: null, onclose: null, onerror: null,
  };
  ws.addEventListener("message", event => {
    if (typeof event.data !== "string" && !(event.data instanceof ArrayBuffer)) { ws.close(); return; }
    transport.onmessage?.({ data: event.data, isBinary: typeof event.data !== "string" });
  });
  ws.addEventListener("close", event => transport.onclose?.(event.code, event.reason));
  ws.addEventListener("error", () => transport.onerror?.(Error("远程连接失败")));
  return transport;
}

export function relayExchange(endpoint: string, relay: { route: string; key: string }, envelope: Envelope): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    const ws = relaySocket(endpoint, relay.route, "client"), transport = relayAdapter(ws);
    let finished = false;
    const finish = (error?: Error, value?: Envelope) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ws.close();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(Error("远程连接超时")), 25000);
    ws.addEventListener("close", () => finish(Error("远程连接已断开")));
    ws.addEventListener("error", () => finish(Error("远程连接失败")));
    ws.addEventListener("open", () => {
      void (async () => {
        let channel: Awaited<ReturnType<typeof createClientChannel>>;
        channel = await createClientChannel(transport, relay.key, {
          onopen: () => { void channel.send(JSON.stringify(envelope)).catch(error => finish(error)); },
          onmessage: data => {
            try { if (typeof data !== "string" || data.length > 6_000_000) throw Error("远程响应无效"); finish(undefined, JSON.parse(data)); }
            catch { finish(Error("远程响应无效")); }
          },
          onerror: error => finish(error),
        });
      })().catch(error => finish(error));
    });
  });
}
