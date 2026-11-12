import type { ToolEvent } from "./types.ts";

export type ActivityState = ToolEvent["status"] | "stopped" | "incomplete";
export function activityState(
  step: ToolEvent,
  activeTask?: string,
  cancelled = false,
): ActivityState {
  if (step.status !== "running") return step.status;
  if (step.taskId === activeTask) return "running";
  return cancelled ? "stopped" : "incomplete";
}
export function activitySummary(
  steps: ToolEvent[],
  activeTask?: string,
  cancelled = false,
) {
  const counts = { read: 0, search: 0, command: 0, write: 0, other: 0 };
  for (const step of steps) {
    if (step.status !== "completed") continue;
    if (["read", "vault_read", "graph_read", "read_skill"].includes(step.name))
      counts.read++;
    else if (
      [
        "find",
        "grep",
        "ls",
        "vault_list",
        "vault_search",
        "note_find",
        "graph_query",
        "tool_search",
        "list_skills",
      ].includes(step.name)
    )
      counts.search++;
    else if (["bash", "powershell"].includes(step.name)) counts.command++;
    else if (
      [
        "write",
        "edit",
        "vault_create",
        "vault_write",
        "vault_rename",
        "markdown_write",
        "canvas_draw",
      ].includes(step.name)
    )
      counts.write++;
    else counts.other++;
  }
  const parts: string[] = [];
  if (counts.read) parts.push(`已读取 ${counts.read} 项资料`);
  if (counts.search) parts.push(`已检索 ${counts.search} 次`);
  if (counts.command) parts.push(`已运行 ${counts.command} 个命令`);
  if (counts.write) parts.push(`已写入 ${counts.write} 次文件`);
  if (counts.other) parts.push(`已完成 ${counts.other} 项操作`);
  const states = steps.map((step) =>
    activityState(step, activeTask, cancelled),
  );
  if (states.includes("failed")) parts.push("有操作失败");
  if (states.includes("stopped")) parts.push("已停止");
  else if (states.includes("incomplete")) parts.push("有操作未完成");
  if (states.includes("running")) parts.push("正在执行");
  return parts.join("，") || "执行记录";
}
