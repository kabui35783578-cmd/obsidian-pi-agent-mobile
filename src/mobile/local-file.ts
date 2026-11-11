import { bytes64 } from "../shared/mobile-wire.ts";

export type PhoneFile =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; data: string };

export async function readPhoneFile(file: File): Promise<PhoneFile> {
  const name = file.name.slice(0, 255);
  if (!name || /[\\/\0]/.test(name)) throw Error("文件名无效，请重新选择");
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) {
    if (file.size > 1024 * 1024) throw Error("图片超过 1 MiB，请压缩后重试");
    if (!file.size) throw Error("图片为空，请重新选择");
    const encoded = bytes64(new Uint8Array(await file.arrayBuffer())).replace(/-/g, "+").replace(/_/g, "/");
    return { kind: "image", name, data: encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=") };
  }
  if (!/\.(md|canvas|base|txt|json|csv|tsv|yaml|yml)$/i.test(name))
    throw Error("暂支持图片和 MD、TXT、JSON、CSV 等文字文件");
  if (file.size > 2 * 1024 * 1024) throw Error("文字文件超过 2 MiB，请精简后重试");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  if (text.includes("\0")) throw Error("文件不是有效的 UTF-8 文字");
  if (text.length > 80_000) throw Error("文字文件超过 80000 字，请精简后重试");
  return { kind: "text", name, text };
}
