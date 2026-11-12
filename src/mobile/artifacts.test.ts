import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionCopy,
  describePreview,
  greeting,
  isPrivateHost,
  isSameDay,
  plainPreview,
  presentMessage,
  safeRemoteMarkdown,
} from "./artifacts.ts";

test("expense ledger becomes a card and leaves the spoken sentence", () => {
  const segments = presentMessage(
    "好的，已记到今日餐饮。\n已记：13:14 ｜ 餐饮 ｜ 可乐 ¥2.80，今日合计 ¥2.80",
  );
  assert.equal(segments[0].type, "text");
  if (segments[0].type === "text")
    assert.match(segments[0].text, /已记到今日餐饮/);
  const card = segments.find((segment) => segment.type === "artifact");
  assert.ok(card && card.type === "artifact");
  if (card?.type === "artifact" && card.artifact.kind === "expense") {
    assert.equal(card.artifact.category, "餐饮");
    assert.equal(card.artifact.item, "可乐");
    assert.equal(card.artifact.amount, "¥2.80");
    assert.equal(card.artifact.time, "13:14");
    assert.equal(card.artifact.totalLabel, "今日合计");
    assert.equal(card.artifact.total, "¥2.80");
    assert.equal(card.artifact.badge, "已记");
    assert.equal(card.artifact.action, undefined);
  }
});

test("a single note next to an expense opens the record", () => {
  const segments = presentMessage(
    "已记：13:14 ｜ 餐饮 ｜ 可乐 ¥2.80，今日合计 ¥2.80\n[[账本/今日.md]]",
  );
  const cards = segments.filter((segment) => segment.type === "artifact");
  assert.equal(cards.length, 1);
  const card = cards[0];
  if (card.type === "artifact" && card.artifact.kind === "expense") {
    assert.equal(card.artifact.path, "账本/今日.md");
    assert.equal(card.artifact.action, "打开记录");
  }
});

test("note wikilink becomes a file card and readable prose", () => {
  const segments = presentMessage(
    "已写入，并已重新读取 [[日程/近期待办.md]]。\n之后有新的待办，我会继续更新这一篇。",
  );
  const texts = segments
    .filter((segment) => segment.type === "text")
    .map((segment) => (segment.type === "text" ? segment.text : ""));
  assert.match(texts.join("\n"), /已写入，并已重新读取这份笔记/);
  assert.match(texts.join("\n"), /继续更新这一篇/);
  assert.doesNotMatch(texts.join("\n"), /\[\[/);
  const card = segments.find((segment) => segment.type === "artifact");
  assert.ok(card && card.type === "artifact" && card.artifact.kind === "file");
  if (card?.type === "artifact" && card.artifact.kind === "file") {
    assert.equal(card.artifact.name, "近期待办.md");
    assert.equal(card.artifact.path, "日程/近期待办.md");
    assert.equal(card.artifact.subtitle, "日程／近期待办");
    assert.equal(card.artifact.action, "打开笔记");
  }
});

test("code path and completed write tool agree on one file card", () => {
  const segments = presentMessage(
    "已创建并复核完成。 **文件路径**：`Survival/world.md`",
    [{ name: "vault_write", status: "completed", detail: "Survival/world.md" }],
  );
  const cards = segments.filter((segment) => segment.type === "artifact");
  assert.equal(cards.length, 1);
  const prose = segments
    .filter((segment) => segment.type === "text")
    .map((segment) => (segment.type === "text" ? segment.text : ""))
    .join("");
  assert.match(prose, /已创建并复核完成/);
  assert.doesNotMatch(prose, /`|文件路径|\*\*/);
});

test("ordinary chat stays prose", () => {
  const text = "明天的安排我先看一下，有结果再告诉你。";
  const segments = presentMessage(text);
  assert.deepEqual(segments, [{ type: "text", text }]);
});

test("previews drop markdown, wikilinks, and keep a short status", () => {
  const note = describePreview(
    "已写入，并已重新读取 [[日程/近期待办.md]]近期待办",
  );
  assert.equal(note.title, "更新了近期待办");
  assert.doesNotMatch(note.preview, /\[\[|\*\*|`/);
  assert.equal(note.statusLine, "待办已更新");
  assert.equal(note.structured, true);
  assert.equal(note.chips[0]?.text, "日程/近期待办.md");

  const expense = describePreview(
    "✓ 已记：13:14 ｜ 餐饮 ｜ 可乐 ¥2.80，今日合计 ¥2.80",
  );
  assert.equal(expense.title, "已记一笔餐饮");
  assert.equal(expense.statusLine, "已记 ¥2.80");
  assert.equal(expense.expense?.item, "可乐");
  assert.doesNotMatch(expense.preview, /✓|\[\[/);

  const missing = describePreview(
    "在「盒子」目录中没有找到标题为《靓壳花甲门店相关资料》的笔记。",
  );
  assert.equal(missing.chips[0]?.text, "未找到");
  assert.equal(missing.chips[0]?.tone, "warn");
  assert.equal(missing.structured, false);
  assert.doesNotMatch(missing.preview, /\[\[|\*\*/);

  const path = describePreview(
    "已创建并复核完成。 **文件路径**：`Survival/world.md`",
  );
  assert.equal(path.chips[0]?.text, "Survival/world.md");
  assert.match(path.preview, /已创建并复核完成/);
  assert.doesNotMatch(path.preview, /\*\*|`/);

  const running = describePreview("已记：13:14 ｜ 餐饮 ｜ 可乐 ¥2.80", true);
  assert.equal(running.statusLine, "正在处理");
  assert.deepEqual(running.chips, []);
});

test("plain preview strips emphasis and wiki targets", () => {
  assert.equal(
    plainPreview("整理了与「自媒体」相关的笔记清单。"),
    "整理了与「自媒体」相关的笔记清单。",
  );
  assert.equal(
    plainPreview("看一下 [[盒子/甲.md|甲]] 和 **重点**"),
    "看一下 甲 和 重点",
  );
});

test("greeting follows the clock", () => {
  assert.equal(greeting(new Date(2026, 10, 10, 13, 45)), "下午好");
  assert.equal(greeting(new Date(2026, 10, 10, 9, 0)), "早上好");
  assert.equal(greeting(new Date(2026, 10, 10, 12, 0)), "中午好");
  assert.equal(greeting(new Date(2026, 10, 10, 19, 0)), "晚上好");
  assert.equal(greeting(new Date(2026, 10, 10, 23, 30)), "夜深了");
});

test("connection copy only calls a private endpoint a LAN link", () => {
  assert.equal(isPrivateHost("192.168.1.8"), true);
  assert.equal(isPrivateHost("10.0.0.4"), true);
  assert.equal(isPrivateHost("8.8.8.8"), false);
  const home = connectionCopy(
    {
      connected: true,
      status: "已连接 · 库",
      endpoint: "http://192.168.1.8:31759",
      hasCredential: true,
    },
    "home",
  );
  assert.deepEqual(home, { online: true, text: "电脑在线 · 局域网" });
  const remote = connectionCopy(
    {
      connected: true,
      status: "已连接 · 库",
      endpoint: "https://agent.example.com",
      hasCredential: true,
    },
    "home",
  );
  assert.equal(remote.text, "电脑在线");
  const chat = connectionCopy(
    {
      connected: true,
      status: "已连接 · 库",
      endpoint: "http://192.168.1.8:31759",
      hasCredential: true,
    },
    "chat",
  );
  assert.equal(chat.text, "电脑在线");
  assert.equal(
    connectionCopy(
      { connected: false, status: "连接中断，将重试：x", hasCredential: true },
      "home",
    ).text,
    "电脑离线",
  );
});

test("today comparison uses the local calendar day", () => {
  const now = new Date(2026, 10, 10, 13, 45);
  assert.equal(isSameDay(new Date(2026, 10, 10, 8).toISOString(), now), true);
  assert.equal(isSameDay(new Date(2026, 10, 9, 23).toISOString(), now), false);
});

test("multi-note reports keep Markdown tables and links intact", () => {
  const text = "| 笔记 | 内容 |\n| --- | --- |\n| [[盒子/影调]] | 画面明暗 |\n| [[盒子/数据|数据]] | 收集分析 |";
  assert.deepEqual(presentMessage(text, [{name:"vault_read", status:"completed", detail:"盒子/影调.md"}]), [{type:"text",text}]);
});
test("a table containing one note remains intact", () => {
  const text = "| 标题 | 描述 |\n| --- | --- |\n| [[笔记]] | 说明 |";
  assert.deepEqual(presentMessage(text), [{type:"text",text}]);
});
test("a fenced example is not converted into a file card", () => {
  const text = "示例：\n```md\n[[盒子/笔记]]\n```";
  assert.deepEqual(presentMessage(text), [{type:"text",text}]);
});


test("table wiki aliases do not split the Markdown cells", () => {
  assert.equal(safeRemoteMarkdown("| [[笔记|别名]] | 说明 |"), "| [[笔记\\|别名]] | 说明 |");
  assert.equal(safeRemoteMarkdown("| [[笔记\\|别名]] | 说明 |"), "| [[笔记\\|别名]] | 说明 |");
  assert.equal(safeRemoteMarkdown("\`\`\`md\n| [[笔记|别名]] |\n\`\`\`"), "\`\`\`md\n| [[笔记|别名]] |\n\`\`\`");
});
