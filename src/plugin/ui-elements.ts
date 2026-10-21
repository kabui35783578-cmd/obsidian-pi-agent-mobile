import { App, TFile, setIcon, setTooltip } from "obsidian";
import type { AgentRecord } from "../shared/types.ts";

export const DEFAULT_AVATARS = [
  { id: "coordinator", name: "总管" },
  { id: "reader", name: "阅读" },
  { id: "writer", name: "写作" },
  { id: "researcher", name: "研究" },
  { id: "organizer", name: "整理" },
  { id: "general", name: "通用" },
];
export function defaultAvatarId(agent: AgentRecord) {
  const configured = agent.avatar.replace(/^builtin:/, "");
  if (
    agent.avatar.startsWith("builtin:") &&
    DEFAULT_AVATARS.some((a) => a.id === configured)
  )
    return configured;
  if (agent.role === "manager") return "coordinator";
  if (/写作|文案|文章|创作/.test(agent.name)) return "writer";
  if (/阅读|读书|学习/.test(agent.name)) return "reader";
  if (/研究|调研|搜索|设计/.test(agent.name)) return "researcher";
  if (/整理|归档|项目|计划|管理/.test(agent.name)) return "organizer";
  const hash = [...agent.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return DEFAULT_AVATARS[1 + (hash % (DEFAULT_AVATARS.length - 1))].id;
}

export function iconButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  action: (event: MouseEvent) => void,
  cls = "",
) {
  const button = parent.createEl("button", {
    cls: "pi-icon-button " + cls,
    attr: { type: "button", "aria-label": label },
  });
  setIcon(button, icon);
  setTooltip(button, label);
  button.addEventListener("click", action);
  return button;
}

export function renderAvatar(
  parent: HTMLElement,
  app: App,
  agent: AgentRecord,
  cls = "",
  builtinImages?: Readonly<Record<string, string>>,
) {
  const el = parent.createSpan({
    cls: "pi-agent-avatar " + cls,
    attr: { "aria-hidden": "true" },
  });
  const builtin =
    !agent.avatar ||
    ["✳", "🤖"].includes(agent.avatar) ||
    agent.avatar.startsWith("builtin:");
  const image = app.vault.getAbstractFileByPath(agent.avatar);
  if (builtin) {
    el.addClass("pi-avatar-art");
    el.createEl("img", {
      attr: {
        src:
          builtinImages?.[defaultAvatarId(agent)] ??
          app.vault.adapter.getResourcePath(
            app.vault.configDir +
              "/plugins/pi-agent/assets/avatars/" +
              defaultAvatarId(agent) +
              ".svg",
          ),
        alt: "",
      },
    });
  } else if (
    image instanceof TFile &&
    /^(png|jpe?g|webp|gif|svg)$/i.test(image.extension)
  )
    el.createEl("img", {
      attr: { src: app.vault.getResourcePath(image), alt: "" },
    });
  else if (agent.avatar && !/[\\/]/.test(agent.avatar))
    el.setText(agent.avatar);
  else el.setText(agent.name.slice(0, 1));
  return el;
}

export const toolLabel = (name: string) =>
  ({
    read: "读取电脑文件",
    write: "写入电脑文件",
    edit: "编辑电脑文件",
    ls: "列举电脑目录",
    find: "查找电脑文件",
    grep: "搜索电脑内容",
    powershell: "执行 PowerShell",
    bash: "执行 Bash",
    vault_list: "查看资料",
    vault_search: "查找笔记",
    vault_read: "阅读笔记",
    vault_create: "新建笔记",
    vault_write: "修改笔记",
    vault_rename: "移动或重命名",
    vault_trash: "移入回收站",
    list_agents: "查看助手",
    delegate_task: "交给专属助手",
    read_skill: "使用技能",
  })[name] ??
  (name.startsWith("skill:")
    ? "使用技能 · " + name.slice(6)
    : name.startsWith("mcp_")
      ? "调用工具连接"
      : name);
