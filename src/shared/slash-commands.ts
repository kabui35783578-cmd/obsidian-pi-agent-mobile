/** Portable command catalogue shared by desktop, phone and the runner. */
export const SLASH_COMMANDS = [
  { name: "new", label: "新聊天", description: "开始一段独立对话" },
  { name: "resume", label: "聊天历史", description: "打开已有对话" },
  {
    name: "model",
    label: "切换模型",
    description: "仅用于当前对话；inherit 恢复跟随设置",
  },
  {
    name: "thinking",
    label: "思考程度",
    description: "选择当前模型支持的思考级别",
  },
  {
    name: "compact",
    label: "压缩上下文",
    description: "由 Pi 总结上下文，保留可见聊天记录",
  },
  {
    name: "skills",
    label: "使用技能",
    description: "选择此助手已获授权的技能",
  },
  {
    name: "session",
    label: "对话信息",
    description: "查看当前模型、思考级别与对话状态",
  },
  { name: "name", label: "重命名对话", description: "输入 /name 新名称" },
  { name: "copy", label: "复制回答", description: "复制最后一条助手回复" },
  {
    name: "stop",
    label: "停止任务",
    description: "停止当前对话正在执行的任务",
  },
  { name: "settings", label: "设置", description: "打开插件设置与账号连接" },
  { name: "help", label: "命令帮助", description: "查看可用命令和使用方法" },
] as const;
export type SlashName = (typeof SLASH_COMMANDS)[number]["name"];
export interface SlashCommand {
  name: string;
  args: string;
}
export function parseSlash(text: string): SlashCommand | undefined {
  if (text.trim() === "/") return { name: "help", args: "" };
  const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  return match
    ? { name: match[1].toLowerCase(), args: match[2]?.trim() ?? "" }
    : undefined;
}
export function commandMatches(text: string) {
  if (!/^\/[\w-]*$/.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(query));
}
export const commandHelp = () =>
  SLASH_COMMANDS.map((c) => `/${c.name} — ${c.label}：${c.description}`).join(
    "\n",
  ) +
  "\n/skill:技能名 任务内容 — 指定已授权技能。命令不经过模型猜测执行；未接入的命令会明确提示。";
export interface CommandOptions {
  current?: string;
  models?: { id: string; name: string }[];
  levels?: string[];
  skills?: { name: string; description: string }[];
}
