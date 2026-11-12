/** Present structured assistant results as cards. Parsing only; no invented facts. */

export interface ExpenseArtifact {
  kind: "expense";
  category: string;
  item?: string;
  amount: string;
  time?: string;
  totalLabel?: string;
  total?: string;
  path?: string;
  badge: "已记";
  action?: "打开记录";
}

export interface FileArtifact {
  kind: "file";
  name: string;
  path: string;
  subtitle: string;
  missing?: boolean;
  action: "打开笔记";
}

export type Artifact = ExpenseArtifact | FileArtifact;

export type Segment =
  | { type: "text"; text: string }
  | { type: "artifact"; artifact: Artifact };

export interface ToolHint {
  name: string;
  status: string;
  detail?: string;
}

export interface PreviewChip {
  text: string;
  tone?: "ok" | "warn";
}

export interface PreviewBrief {
  title: string;
  preview: string;
  chips: PreviewChip[];
  expense?: ExpenseArtifact;
  file?: FileArtifact;
  statusLine: string;
  /** A recognized result that can lead the home “今日” section. */
  structured: boolean;
}

const FILE_TOOL =
  /^(read|write|edit|vault_read|vault_write|vault_create|vault_rename)$/;
const AMOUNT =
  /(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|块)/g;

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5 || hour >= 23) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function isPrivateHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".home")
  )
    return true;
  if (
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  )
    return true;
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || (a === 192 && b === 168)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function connectionCopy(
  input: {
    connected: boolean;
    status: string;
    endpoint?: string;
    hasCredential: boolean;
  },
  place: "home" | "chat",
) {
  if (input.connected) {
    let lan = false;
    try {
      lan = Boolean(input.endpoint) && isPrivateHost(new URL(input.endpoint!).hostname);
    } catch {
      lan = false;
    }
    return {
      online: true,
      text: place === "home" && lan ? "电脑在线 · 局域网" : "电脑在线",
    };
  }
  if (!input.hasCredential)
    return { online: false, text: place === "home" ? "尚未连接电脑" : "未连接" };
  if (input.status.includes("正在连接"))
    return { online: false, text: "正在连接电脑" };
  return { online: false, text: "电脑离线" };
}

export function isSameDay(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === now.toDateString();
}

export function plainPreview(text: string) {
  let value = text.replace(/\r/g, "");
  value = value.replace(
    /!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]]+))?\]\]/g,
    (_, path: string, label?: string) => label?.trim() || fileBase(path),
  );
  value = value.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  value = value.replace(/(\*\*|__)([\s\S]*?)\1/g, "$2");
  value = value.replace(/(\*|_)([^*\n_]+)\1/g, "$2");
  value = value.replace(/`([^`]+)`/g, "$1");
  value = value.replace(/^#{1,6}\s+/gm, "");
  value = value.replace(/^>\s?/gm, "");
  value = value.replace(/(^|\n)\s*[-*+]\s+/g, "$1");
  value = value.replace(/(^|\n)\s*\d+[.)]\s+/g, "$1");
  value = value.replace(/[✓✔]\s*/g, "");
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

export function fileChipLabel(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return parts[0] || path;
  return parts.slice(0, -1).join(" / ") + " / " + parts[parts.length - 1];
}

export function shortenPath(path: string, max = 18) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  const file = parts.pop() || path;
  const dir = parts.pop();
  if (!dir) return file.length <= max ? file : file.slice(0, max - 1) + "…";
  const shown = dir + "/" + file;
  if (shown.length <= max) return shown;
  return dir.length > 12 ? dir.slice(0, 10) + "…" : dir + "/…";
}

/** Preserve wiki aliases inside Markdown table cells; prevent remote embeds. */
export function safeRemoteMarkdown(text: string) {
  let fenced = false;
  return text.split("\n").map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    let value = line.replace(/!\[\[([^\]]+)\]\]/g, "[[$1]]");
    if (/^\s*\|/.test(value))
      value = value.replace(/(\[\[[^\]\n|]+)(?<!\\)\|([^\]\n]+\]\])/g, "$1\\|$2");
    return value;
  }).join("\n");
}

export function presentMessage(text: string, tools: ToolHint[] = []): Segment[] {
  const expense = findExpense(text);
  // A report with multiple links or a Markdown table must remain one document.
  // Turning individual cells into cards destroys the table and its context.
  const wikiLinks = text.match(/!?\[\[[^\]\n]+\]\]/g) ?? [];
  const hasTable = /^\s*\|.*\|\s*$/m.test(text);
  if (!expense && (wikiLinks.length > 1 || hasTable || /^\s*```/m.test(text)))
    return [{ type: "text", text }];
  const files = collectFiles(text, tools);
  if (expense && files.length === 1) {
    expense.artifact.path = files[0].path;
    expense.artifact.action = "打开记录";
  }
  const spans: Span[] = [];
  if (expense) spans.push(expense);
  for (const file of files) {
    const inside =
      expense &&
      file.start >= expense.start &&
      file.end <= expense.end &&
      file.start !== file.end;
    const suppressed = (expense && files.length === 1) || inside;
    spans.push({
      start: file.start,
      end: file.end,
      replacement: file.inline ? "这份笔记" : "",
      absorb: file.absorb,
      artifact: suppressed ? undefined : file.artifact,
    });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const segments = stitch(text, spans);
  if (!segments.some((segment) => segment.type === "artifact"))
    return [{ type: "text", text }];
  return segments;
}

export function describePreview(text: string, running = false): PreviewBrief {
  const segments = presentMessage(text);
  const expense = segments.find(
    (segment): segment is { type: "artifact"; artifact: ExpenseArtifact } =>
      segment.type === "artifact" && segment.artifact.kind === "expense",
  )?.artifact;
  const file = segments.find(
    (segment): segment is { type: "artifact"; artifact: FileArtifact } =>
      segment.type === "artifact" && segment.artifact.kind === "file",
  )?.artifact;
  const prose = segments
    .filter((segment) => segment.type === "text")
    .map((segment) => plainPreview(segment.text))
    .filter(Boolean)
    .join(" ");
  let preview = prose;
  if (!preview && expense)
    preview =
      expense.category && expense.category !== "记账"
        ? "已记一笔" + expense.category
        : "已记 " + expense.amount;
  if (!preview && file)
    preview = file.missing
      ? "没有找到" + file.name.replace(/\.md$/i, "")
      : "已处理" + file.name.replace(/\.md$/i, "");
  if (!preview) preview = plainPreview(text);
  const title =
    expense || file ? resultTitle(text, expense, file) : firstClause(preview);
  const chips: PreviewChip[] = [];
  if (file?.missing || /没有找到|未找到|找不到/.test(plainPreview(text)))
    chips.push({ text: "未找到", tone: "warn" });
  else if (file) chips.push({ text: shortenPath(file.path) });
  else if (expense) chips.push({ text: expense.amount, tone: "ok" });
  return {
    title,
    preview,
    chips: running ? [] : chips.slice(0, 1),
    expense,
    file,
    statusLine: running
      ? "正在处理"
      : statusLine(text, preview, expense, file),
    structured: Boolean(expense || file),
  };
}

function resultTitle(
  text: string,
  expense?: ExpenseArtifact,
  file?: FileArtifact,
) {
  if (expense) {
    const category =
      expense.category && expense.category !== "记账" ? expense.category : "";
    return category ? "已记一笔" + category : "已记一笔";
  }
  const base = (file?.name || "").replace(/\.md$/i, "");
  if (file?.missing || /没有找到|未找到|找不到/.test(text))
    return "没有找到" + base;
  if (/待办/.test(base) && /更新|整理|写入|保存/.test(text))
    return "更新了" + base;
  if (/更新|整理/.test(text)) return "更新了" + base;
  if (/创建|新建/.test(text)) return "创建了" + base;
  if (/写入|保存/.test(text)) return "写入了" + base;
  if (/读取|打开/.test(text)) return "读取了" + base;
  return base;
}

function statusLine(
  text: string,
  preview: string,
  expense?: ExpenseArtifact,
  file?: FileArtifact,
) {
  if (expense) return "已记 " + expense.amount;
  if (file?.missing) return "未找到";
  if (file && /待办/.test(file.name) && /更新|写入|整理|创建|新建/.test(text))
    return "待办已更新";
  if (file) return shortStatus(file.name.replace(/\.md$/i, ""));
  return shortStatus(firstClause(preview));
}

function firstClause(text: string) {
  const clause = text.split(/[。！？]/)[0]?.trim() || text.trim();
  return clause;
}

export function shortStatus(text: string, max = 12) {
  const value = text.trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const pause = Math.max(
    cut.lastIndexOf("，"),
    cut.lastIndexOf("、"),
    cut.lastIndexOf(" "),
  );
  if (pause >= 4) return cut.slice(0, pause) + "…";
  return cut + "…";
}

interface Span {
  start: number;
  end: number;
  replacement: string;
  artifact?: Artifact;
  /** Basename to drop when the source repeats it immediately after the link. */
  absorb?: string;
}

interface FileHit {
  start: number;
  end: number;
  path: string;
  inline: boolean;
  absorb: string;
  artifact: FileArtifact;
}

function collectFiles(text: string, tools: ToolHint[]): FileHit[] {
  const hits: FileHit[] = [];
  const seen = new Set<string>();
  const push = (
    start: number,
    end: number,
    path: string,
    alias?: string,
    inline = true,
  ) => {
    const cleaned = path.trim().replace(/\\/g, "/");
    if (!cleaned || seen.has(cleaned) || !isNotePath(cleaned)) return;
    seen.add(cleaned);
    hits.push({
      start,
      end,
      path: cleaned,
      inline,
      absorb: fileBase(cleaned).replace(/\.md$/i, ""),
      artifact: fileArtifact(cleaned, alias, text),
    });
  };
  const wiki =
    /!?\[\[([^\]|#\n]{1,180})(?:#[^\]|\n]{0,80})?(?:\|([^\]]{0,80}))?\]\]/g;
  for (const match of text.matchAll(wiki))
    push(match.index, match.index + match[0].length, match[1], match[2], true);
  const code = /`([^`\n]{1,180}\.md)`/gi;
  for (const match of text.matchAll(code))
    push(match.index, match.index + match[0].length, match[1], undefined, true);
  for (const tool of tools) {
    // Incidental reads stay in the collapsed work log. A card is for a
    // completed write/create, or a path the reply itself names.
    if (tool.status !== "completed") continue;
    if (!FILE_TOOL.test(tool.name)) continue;
    const path = pathFromTool(tool);
    if (!path) continue;
    const named = fileBase(path).replace(/\.md$/i, "");
    const mentioned = text.includes(path) || (named.length > 1 && text.includes(named));
    const mutation = /^(write|edit|vault_write|vault_create|vault_rename)$/.test(
      tool.name,
    );
    if (!mutation && !mentioned) continue;
    push(text.length, text.length, path, undefined, false);
  }
  return hits;
}

function isNotePath(path: string) {
  if (/\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|zip)$/i.test(path)) return false;
  return /\.(md|markdown|canvas)$/i.test(path) || !/\.[a-z0-9]+$/i.test(path);
}

function pathFromTool(tool: ToolHint) {
  const detail = tool.detail?.trim();
  if (!detail) return;
  const wiki = detail.match(/\[\[([^\]|#\n]+)/);
  if (wiki) return wiki[1].trim();
  const md = detail.match(/(?:^|[\s"'`：:])([^\s"'`：:，,。]+\.md)\b/i);
  if (md) return md[1];
  if (
    detail.length <= 120 &&
    /^[\w\u4e00-\u9fff./\\-]+$/.test(detail) &&
    /[/\\.]/.test(detail)
  )
    return detail;
  return;
}

function fileArtifact(path: string, alias: string | undefined, context: string): FileArtifact {
  const missing = /没有找到|未找到|找不到|不存在/.test(context);
  return {
    kind: "file",
    name: alias?.trim() || noteName(path),
    path,
    subtitle: missing ? "未找到" : noteSubtitle(path),
    missing,
    action: "打开笔记",
  };
}

function noteName(path: string) {
  const base = fileBase(path);
  if (/\.[a-z0-9]+$/i.test(base)) return base;
  return base + ".md";
}

function fileBase(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function noteSubtitle(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return "笔记";
  const name = parts[parts.length - 1].replace(/\.md$/i, "");
  return parts.slice(0, -1).join("／") + "／" + name;
}

function findExpense(text: string): Span & { artifact: ExpenseArtifact } | undefined {
    const pattern =
      /[✓✔]?\s*(?:已记(?!录)|记账|记了一笔|记一笔)[^。\n]{0,160}/g;
  for (const match of text.matchAll(pattern)) {
    const artifact = parseExpense(match[0]);
    if (!artifact) continue;
    return {
      start: match.index,
      end: match.index + match[0].length,
      replacement: "",
      artifact,
    };
  }
  return;
}

function parseExpense(clause: string): ExpenseArtifact | undefined {
  const amounts = [...clause.matchAll(AMOUNT)];
  if (!amounts.length) return;
  const time = clause.match(/(\d{1,2}:\d{2})/)?.[1];
  const parts = clause
    .split(/\s*[|｜]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  let category = "记账";
  let item: string | undefined;
  if (parts.length >= 3) {
    category = cleanLabel(parts[1]) || category;
    item = cleanItem(parts[2]);
  } else if (parts.length === 2) {
    const head = parts[0].replace(/^[✓✔]?\s*(?:已记|记账|记了一笔|记一笔)\s*[：:]?\s*/, "");
    category = cleanLabel(head) || cleanLabel(parts[1]) || category;
    item = cleanItem(parts[1]);
    if (item === category) item = undefined;
  } else {
    const named = clause.match(
      /(?:餐饮|交通|购物|日用|娱乐|医疗|住房|工资|收入|转账)/,
    );
    if (named) category = named[0];
    item = cleanItem(clause.replace(/^[✓✔]?\s*(?:已记|记账|记了一笔|记一笔)\s*[：:]?\s*/, ""));
    if (item === category) item = undefined;
  }
  const totalMatch = clause.match(
    /(今日合计|本日合计|本月合计|合计|累计)\s*(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)?/,
  );
  let total: string | undefined;
  let totalLabel: string | undefined;
  if (totalMatch && amounts.length > 1) {
    totalLabel = totalMatch[1];
    total = formatMoney(amounts[amounts.length - 1][1] || amounts[amounts.length - 1][2]);
  } else if (totalMatch?.[2] && amounts.length === 1 && !item) {
    totalLabel = totalMatch[1];
    total = formatMoney(totalMatch[2]);
  }
  const amount = formatMoney(amounts[0][1] || amounts[0][2]);
  return {
    kind: "expense",
    category,
    item,
    amount: total && !item ? total : amount,
    time,
    totalLabel,
    total,
    badge: "已记",
  };
}

function cleanLabel(value: string) {
  return value
    .replace(/[✓✔]/g, "")
    .replace(/(?:已记|记账|记了一笔|记一笔)\s*[：:]?/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .replace(/(?:¥|￥)\s*\d+(?:\.\d{1,2})?/g, "")
    .replace(/\d+(?:\.\d{1,2})?\s*(?:元|块钱|块)/g, "")
    .replace(/[，,。].*$/, "")
    .trim();
}

function cleanItem(value: string) {
  const item = cleanLabel(value.replace(/[，,].*$/, ""));
  if (!item || /合计|累计/.test(item)) return;
  return item;
}

function formatMoney(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return "¥" + raw;
  return "¥" + value.toFixed(2);
}

function stitch(text: string, spans: Span[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  let buffer = "";
  const flush = () => {
    const prose = polishProse(buffer);
    if (prose && keepProse(prose)) segments.push({ type: "text", text: prose });
    buffer = "";
  };
  for (const span of spans) {
    if (span.end < cursor || span.start < cursor) continue;
    buffer += text.slice(cursor, span.start);
    if (span.replacement) buffer = buffer.replace(/[ \t]+$/, "") + span.replacement;
    cursor = span.end;
    if (span.absorb) {
      const repeated = text
        .slice(cursor)
        .match(new RegExp("^\\s*" + escapeRegExp(span.absorb)));
      if (repeated) cursor += repeated[0].length;
    }
    if (span.artifact || span.replacement) {
      const punct = text.slice(cursor).match(/^\s*[。！？]/);
      if (punct) {
        buffer += punct[0].trim();
        cursor += punct[0].length;
      }
    }
    if (span.artifact) {
      flush();
      segments.push({ type: "artifact", artifact: span.artifact });
    }
  }
  buffer += text.slice(cursor);
  flush();
  return segments;
}

function polishProse(text: string) {
  let value = text.replace(/\r/g, "");
  value = value.replace(/(?:\*\*|__)?(?:文件路径|路径)(?:\*\*|__)?\s*[：:]\s*/g, "");
  value = value.replace(/(?<=[。！？\n])\s*这份笔记[。．.]?\s*$/g, "");
  value = value.replace(/^\s*这份笔记[。．.]?\s*$/g, "");
  value = value.replace(/[ \t]+\n/g, "\n");
  value = value.replace(/\n{3,}/g, "\n\n");
  value = value.replace(/[ \t]{2,}/g, " ");
  value = value.replace(/\s+([。！？，、])/g, "$1");
  value = value.replace(/([。！？]){2,}/g, "$1");
  return value.trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keepProse(text: string) {
  const plain = plainPreview(text)
    .replace(/这份笔记/g, "")
    .replace(/[。．.，,：:\s]/g, "");
  return plain.length > 0;
}
