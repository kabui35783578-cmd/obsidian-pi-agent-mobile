import type { AgentRecord, PluginSettings } from "./types.ts";
export interface AgentPermissions {
  files: "folder" | "vault" | "computer";
  read: boolean;
  write: boolean;
  delete: boolean;
  commands: boolean;
  skills: boolean;
  mcp: boolean;
  delegate: boolean;
}
export function defaultPermissions(
  role: AgentRecord["role"],
): AgentPermissions {
  return {
    files: role === "manager" ? "computer" : "folder",
    read: true,
    write: true,
    delete: true,
    commands: role === "manager",
    skills: true,
    mcp: true,
    delegate: role === "manager",
  };
}
export function permissionsFor(
  agent: AgentRecord,
  settings: Pick<PluginSettings, "agentPermissions">,
): AgentPermissions {
  const defaults = defaultPermissions(agent.role);
  const configured = settings.agentPermissions?.[agent.id];
  const value = { ...defaults };
  if (configured && typeof configured === "object") {
    if (["folder", "vault", "computer"].includes(configured.files))
      value.files = configured.files;
    for (const key of [
      "read",
      "write",
      "delete",
      "commands",
      "skills",
      "mcp",
      "delegate",
    ] as const)
      if (typeof configured[key] === "boolean") value[key] = configured[key];
  }
  if (agent.role === "manager" && value.files === "folder")
    value.files = "vault";
  if (agent.role !== "manager") value.delegate = false;
  if (
    value.files !== "computer" ||
    !value.read ||
    !value.write ||
    !value.delete
  )
    value.commands = false;
  return value;
}
export function checkFilePermission(p: AgentPermissions, operation: string) {
  const action = ["list", "search", "read"].includes(operation)
    ? "read"
    : operation === "trash"
      ? "delete"
      : "write";
  if (!p[action])
    throw new Error(
      `此助手的${{ read: "读取", write: "写入", delete: "删除" }[action]}权限已关闭`,
    );
}
export function nativePermission(p: AgentPermissions, name: string) {
  if (p.files !== "computer")
    throw new Error("Pi 原生工具需要电脑文件访问权限");
  if (["bash", "powershell"].includes(name)) {
    if (!p.commands || !p.read || !p.write || !p.delete)
      throw new Error("此助手未获终端命令权限");
  } else if (["write", "edit", "mkdir"].includes(name)) {
    if (!p.write) throw new Error("此助手的写入权限已关闭");
    if (name === "edit" && !p.read) throw new Error("编辑文件需要读取权限");
  } else if (["read", "access", "ls", "find", "grep"].includes(name)) {
    if (!p.read) throw new Error("此助手的读取权限已关闭");
  } else throw new Error("未知 Pi 原生操作");
}
