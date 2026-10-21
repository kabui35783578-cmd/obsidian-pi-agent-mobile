/** Browser-compatible authenticated envelopes. No Node/Electron imports. */
export interface RemoteCredential {
  endpoint: string;
  deviceId: string;
  secret: string;
  hostId: string;
  vaultName: string;
}
export interface PairCode {
  v: 1;
  endpoint: string;
  pairId: string;
  secret: string;
  hostId: string;
  vaultName: string;
  expiresAt: number;
}
export interface Envelope {
  v: 1;
  identity: string;
  requestId: string;
  kind: "pair" | "rpc";
  iv: string;
  data: string;
}
export interface RemoteRequest {
  issuedAt: number;
  method: string;
  params: any;
}
export const REMOTE_PATH = "/pi-mobile/v1";
export function bytes64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function from64(text: string) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text))
    throw Error("连接数据格式无效");
  return Uint8Array.from(
    atob(text.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export const remoteId = () => globalThis.crypto.randomUUID();
export const remoteSecret = () =>
  bytes64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
const context = (
  envelope: Pick<Envelope, "identity" | "requestId" | "kind">,
  direction: "request" | "response",
) =>
  new TextEncoder().encode(
    JSON.stringify([
      "pi-mobile-v1",
      envelope.kind,
      envelope.identity,
      envelope.requestId,
      direction,
    ]),
  );
export async function seal(
  secret: string,
  header: Pick<Envelope, "identity" | "requestId" | "kind">,
  value: unknown,
  direction: "request" | "response",
): Promise<Envelope> {
  if (!globalThis.crypto?.subtle)
    throw Error("当前设备缺少 Web Crypto，请升级 Obsidian 与系统 WebView");
  const raw = from64(secret);
  if (raw.length !== 32) throw Error("连接密钥长度无效");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: context(header, direction),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return {
    v: 1,
    ...header,
    iv: bytes64(iv),
    data: bytes64(new Uint8Array(data)),
  };
}
export async function unseal<T = any>(
  secret: string,
  envelope: Envelope,
  direction: "request" | "response",
): Promise<T> {
  if (
    envelope?.v !== 1 ||
    !/^[a-f0-9-]{36}$/.test(envelope.identity) ||
    !/^[a-f0-9-]{36}$/.test(envelope.requestId) ||
    !["pair", "rpc"].includes(envelope.kind)
  )
    throw Error("连接消息格式无效");
  const raw = from64(secret),
    iv = from64(envelope.iv);
  if (raw.length !== 32 || iv.length !== 12)
    throw Error("连接密钥或随机数无效");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "decrypt",
  ]);
  const value = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: context(envelope, direction),
      tagLength: 128,
    },
    key,
    from64(envelope.data),
  );
  return JSON.parse(new TextDecoder().decode(value)) as T;
}
export function remoteEndpoint(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw Error("请填写电脑连接的 http(s) 地址，不含路径、账号或参数");
  return url.origin;
}
export function encodePairCode(value: PairCode) {
  return "pi-agent:" + bytes64(new TextEncoder().encode(JSON.stringify(value)));
}
export function decodePairCode(input: string): PairCode {
  let value = input.trim();
  if (value.startsWith("obsidian://"))
    value = new URL(value).searchParams.get("code") ?? "";
  if (!value.startsWith("pi-agent:"))
    throw Error("请粘贴电脑生成的 Pi Agent 配对码");
  const code = JSON.parse(
    new TextDecoder().decode(from64(value.slice(9))),
  ) as PairCode;
  code.endpoint = remoteEndpoint(code.endpoint);
  if (
    code.v !== 1 ||
    !/^[a-f0-9-]{36}$/.test(code.pairId) ||
    !/^[a-f0-9-]{36}$/.test(code.hostId) ||
    from64(code.secret).length !== 32 ||
    !Number.isFinite(code.expiresAt) ||
    code.expiresAt <= Date.now()
  )
    throw Error("配对码已过期或格式无效，请在电脑重新生成");
  return code;
}
