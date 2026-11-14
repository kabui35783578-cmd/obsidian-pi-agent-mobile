import { Unzip, UnzipInflate } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_ARCHIVE = 10 * 1024 * 1024;
const MAX_EXPANDED = 30 * 1024 * 1024;
const MAX_ENTRY = 12 * 1024 * 1024;
const MAX_ENTRIES = 3000;
export const isOfficeFile = (name: string) => /\.(docx|xlsx|pptx)$/i.test(name);
type Node = Record<string, any>;
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
});
const children = (nodes: Node[], name: string): Node[] =>
  nodes.flatMap((n) => (Array.isArray(n[name]) ? [n] : []));
function descendants(nodes: Node[], name: string): Node[] {
  const result: Node[] = [];
  for (const node of nodes)
    for (const [key, value] of Object.entries(node)) {
      if (!Array.isArray(value)) continue;
      if (key === name) result.push(node);
      result.push(...descendants(value, name));
    }
  return result;
}
function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (original, entity: string) => {
      if (entity[0] === "#") {
        const n =
          entity[1]?.toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : original;
      }
      return (
        (
          { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<
            string,
            string
          >
        )[entity] ?? original
      );
    },
  );
}
const attr = (node: Node, name: string) =>
  decodeXml(String(node[":@"]?.["@_" + name] ?? ""));
function textOf(nodes: Node[]): string {
  return nodes
    .map((n) =>
      Object.entries(n)
        .map(([k, v]) =>
          k === "#text"
            ? decodeXml(String(v))
            : k === "rPh"
              ? ""
              : Array.isArray(v)
                ? textOf(v)
                : "",
        )
        .join(""),
    )
    .join("");
}
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!bytes.length || bytes.length > MAX_ARCHIVE)
    throw Error("办公文件为空或超过 10 MiB 限制");
  const files = new Map<string, Uint8Array>();
  let total = 0,
    count = 0;
  const unzip = new Unzip((file) => {
    if (++count > MAX_ENTRIES) throw Error("文件内部项目过多");
    if (file.name.endsWith("/")) return;
    if (files.has(file.name)) throw Error("办公文件内部存在重复项目");
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (err) throw err;
      size += data.length;
      total += data.length;
      if (size > MAX_ENTRY || total > MAX_EXPANDED)
        throw Error("办公文件解压后过大");
      chunks.push(data);
      if (final) {
        const all = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          all.set(chunk, offset);
          offset += chunk.length;
        }
        files.set(file.name, all);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
  } catch (e) {
    throw Error(
      "无法读取办公文件：" + (e instanceof Error ? e.message : "文件损坏"),
    );
  }
  if (!files.has("[Content_Types].xml"))
    throw Error("文件损坏或不是有效的 Office 文件");
  return files;
}
function xml(
  files: Map<string, Uint8Array>,
  name: string,
  required = false,
): Node[] {
  const data = files.get(name);
  if (!data) {
    if (required) throw Error("文件缺少必要内容：" + name);
    return [];
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (
    /<!DOCTYPE|<!ENTITY/i.test(source) ||
    XMLValidator.validate(source) !== true
  )
    throw Error("办公文件内部 XML 无效");
  return parser.parse(source) as Node[];
}
function paragraphs(nodes: Node[]): string[] {
  return descendants(nodes, "p")
    .map((p) => textOf(p.p))
    .filter(Boolean);
}
function word(files: Map<string, Uint8Array>): string {
  const main = xml(files, "word/document.xml", true);
  const out = paragraphs(main);
  for (const name of [...files.keys()]
    .filter((n) => /^word\/(header|footer)\d+\.xml$/.test(n))
    .sort())
    out.push(
      `\n[${name.includes("header") ? "页眉" : "页脚"}]`,
      ...paragraphs(xml(files, name)),
    );
  return out.join("\n");
}
function excel(files: Map<string, Uint8Array>): string {
  const workbook = xml(files, "xl/workbook.xml", true);
  const rels = xml(files, "xl/_rels/workbook.xml.rels", true);
  const relationships = new Map(
    descendants(rels, "Relationship").map((n) => [
      attr(n, "Id"),
      attr(n, "Target"),
    ]),
  );
  const strings = descendants(xml(files, "xl/sharedStrings.xml"), "si").map(
    (n) => textOf(n.si),
  );
  const sheets = descendants(workbook, "sheet");
  if (!sheets.length) throw Error("工作簿没有可读取的工作表");
  const out: string[] = [];
  for (const sheet of sheets) {
    const target = relationships.get(attr(sheet, "id"));
    if (
      !target ||
      target.includes("..") ||
      target.includes(":") ||
      target.includes("\\")
    )
      throw Error("工作表引用无效");
    const path = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    const tree = xml(files, path, true);
    out.push(`\n[工作表: ${attr(sheet, "name")}]`);
    const rows = descendants(tree, "row");
    for (const row of rows.slice(0, 5000)) {
      const cells = children(row.row, "c")
        .slice(0, 256)
        .map((c) => {
          const type = attr(c, "t"),
            value = textOf(descendants(c.c, "v")[0]?.v ?? []);
          const formula = textOf(descendants(c.c, "f")[0]?.f ?? []);
          let val =
            type === "s"
              ? (strings[Number(value)] ?? "[共享字符串无效]")
              : type === "inlineStr"
                ? textOf(descendants(c.c, "is")[0]?.is ?? [])
                : value;
          if (type === "b") val = value === "1" ? "TRUE" : "FALSE";
          if (formula && !value) val = "[无缓存结果]";
          return `${attr(c, "r") || "单元格"}: ${val}${formula ? ` (公式: =${formula}；值为文件中缓存的结果，可能未更新)` : ""}`;
        });
      if (cells.length) out.push(cells.join(" | "));
      if (children(row.row, "c").length > 256)
        out.push("[本行超过 256 个单元格，已截断]");
    }
    if (rows.length > 5000) out.push("[工作表超过 5000 行，已截断]");
  }
  return out.join("\n");
}
function presentation(files: Map<string, Uint8Array>): string {
  const deck = xml(files, "ppt/presentation.xml", true);
  const rels = xml(files, "ppt/_rels/presentation.xml.rels", true);
  const relationships = new Map(
    descendants(rels, "Relationship").map((n) => [
      attr(n, "Id"),
      attr(n, "Target"),
    ]),
  );
  const slides = descendants(deck, "sldId");
  if (!slides.length) throw Error("演示文稿没有可读取的幻灯片");
  return slides
    .map((slide, i) => {
      const target = relationships.get(attr(slide, "id"));
      if (
        !target ||
        target.includes("..") ||
        target.includes(":") ||
        target.includes("\\")
      )
        throw Error("幻灯片引用无效");
      const path = target.startsWith("/") ? target.slice(1) : "ppt/" + target;
      return `[幻灯片 ${i + 1}]\n${paragraphs(xml(files, path, true)).join("\n")}`;
    })
    .join("\n\n");
}
export function extractOffice(name: string, bytes: Uint8Array): string {
  if (!isOfficeFile(name)) throw Error("不支持此办公文件格式");
  const files = readZip(bytes),
    ext = name.split(".").pop()!.toLowerCase();
  const content =
    ext === "docx"
      ? word(files)
      : ext === "xlsx"
        ? excel(files)
        : presentation(files);
  if (!content.trim())
    throw Error("未提取到文字；文件可能只有图片或不受支持的内容");
  return (
    "以下是办公文件的文字提取结果，图片、图表、排版及部分对象可能未包含；表格数值按文件保存时的内容读取。\n\n" +
    content
  );
}
