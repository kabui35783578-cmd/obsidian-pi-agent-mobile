import { setIcon } from "obsidian";
import type { ToolEvent } from "../shared/types.ts";
import { activityState, activitySummary } from "../shared/work-activity.ts";
import { toolLabel } from "./ui-elements.ts";

export interface WorkActivityOptions {
  activeTask?: string;
  cancelled?: boolean;
  legacy?: boolean;
  openFile?: (path: string) => (() => void) | undefined;
}
/** One persistent DOM tree per turn: updates preserve disclosure, selection and scroll. */
export class WorkActivity {
  readonly el: HTMLDetailsElement;
  private title: HTMLElement;
  private list: HTMLElement;
  private touched = false;
  private rows = new Map<
    string,
    { el: HTMLDetailsElement; signature: string }
  >();
  constructor(parent: HTMLElement) {
    this.el = parent.createEl("details", {
      cls: "pi-work-details pi-work-activity",
    });
    const summary = this.el.createEl("summary", { cls: "pi-work-summary" });
    this.title = summary.createSpan();
    setIcon(summary.createSpan({ cls: "pi-work-chevron" }), "chevron-right");
    summary.addEventListener("click", () => {
      this.touched = true;
    });
    this.list = this.el.createDiv({ cls: "pi-activity-list" });
  }
  update(steps: ToolEvent[], options: WorkActivityOptions = {}) {
    const running = [...steps]
      .reverse()
      .find(
        (step) =>
          step.status === "running" && step.taskId === options.activeTask,
      );
    this.title.setText(
      (options.legacy ? "更早的执行记录 · " : "") +
        activitySummary(steps, options.activeTask, options.cancelled).replace(
          /正在执行$/,
          running ? "正在" + toolLabel(running.name) : "正在执行",
        ),
    );
    if (!this.touched) this.el.open = !!options.activeTask;
    const retained = new Set<string>();
    steps.forEach((step, index) => {
      const key = JSON.stringify([step.taskId, step.toolCallId ?? index]);
      retained.add(key);
      const state = activityState(step, options.activeTask, options.cancelled);
      const signature = JSON.stringify([step, state]);
      let cached = this.rows.get(key);
      if (cached?.signature === signature) return;
      const row =
        cached?.el ?? this.list.createEl("details", { cls: "pi-work-step" });
      const wasOpen = row.open;
      row.empty();
      row.open = wasOpen;
      row.classList.toggle("pi-work-step-plain", !step.detail);
      row.dataset.status = state;
      const head = row.createEl("summary", { cls: "pi-tool-event" });
      const label = {
        running: "进行中",
        completed: "完成",
        failed: "失败",
        stopped: "已停止",
        incomplete: "未完成",
      }[state];
      head.setAttribute("aria-label", toolLabel(step.name) + " · " + label);
      let title = toolLabel(step.name);
      if (["bash", "powershell"].includes(step.name))
        title =
          state === "completed"
            ? "已运行一个命令"
            : state === "running"
              ? "正在运行命令"
              : "运行命令";
      else if (state === "running") title = "正在" + title;
      head.createSpan({ cls: "pi-step-content", text: title });
      if (
        step.detail &&
        /(?:^|[/\\])[^/\\]+\.[a-z0-9]{1,12}$/i.test(step.detail) &&
        !["bash", "powershell"].includes(step.name)
      ) {
        const filename = step.detail.split(/[/\\]/).at(-1)!;
        const open = options.openFile?.(step.detail);
        if (open) {
          const link = head.createEl("button", {
            cls: "pi-text-button pi-work-file-label",
            text: filename,
          });
          link.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            open();
          });
        } else head.createSpan({ cls: "pi-work-file-label", text: filename });
      }
      if (["failed", "stopped", "incomplete"].includes(state))
        head.createSpan({ cls: "pi-work-step-state", text: label });
      if (step.detail) {
        setIcon(head.createSpan({ cls: "pi-work-chevron" }), "chevron-right");
        const body = row.createDiv({ cls: "pi-work-step-detail" });
        const open = options.openFile?.(step.detail);
        if (open)
          body
            .createEl("button", {
              cls: "pi-text-button pi-result-link",
              text: step.detail,
            })
            .addEventListener("click", open);
        else body.createEl("pre", { text: step.detail });
      } else {
        row.classList.add("pi-work-step-plain");
        head.addEventListener("click", (event) => event.preventDefault());
      }
      this.rows.set(key, { el: row, signature });
    });
    for (const [key, row] of this.rows)
      if (!retained.has(key)) {
        row.el.remove();
        this.rows.delete(key);
      }
  }
}
