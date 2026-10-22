import {
  parseSlash,
  commandHelp,
  type CommandOptions,
} from "../shared/slash-commands.ts";
import { type CommandChoice, SlashMenu } from "./slash-menu.ts";

interface CommandUI {
  menu: SlashMenu;
  current(): boolean;
  consume(execution: string): void;
  options(kind: string): Promise<CommandOptions>;
  history(): Promise<CommandChoice[]>;
  resume(id: string): Promise<void>;
  execute(text: string): Promise<string | void>;
  feedback(text: string): void;
  local(name: string): Promise<void> | void;
  input(text: string): void;
}
/** Selection applies controls immediately. Only skills/text arguments enter the draft. */
export async function handleSlashUI(
  text: string,
  ui: CommandUI,
): Promise<boolean> {
  const command = parseSlash(text);
  if (!command || command.name.startsWith("skill:")) return false;
  const { name, args } = command;
  if (name === "help") {
    ui.consume(text);
    ui.menu.info("聊天命令", commandHelp());
    return true;
  }
  if (name === "resume" && !args) {
    const id = await ui.menu.choose("继续聊天", ui.history);
    if (id && ui.current()) {
      ui.consume(text);
      await ui.resume(id);
    }
    return true;
  }
  if (["new", "settings", "copy", "stop"].includes(name)) {
    if (args) throw Error("用法：/" + name);
    ui.consume(text);
    await ui.local(name);
    return true;
  }
  if (name === "skills" && !args) {
    const value = await ui.menu.choose("使用技能", async () => {
      const { skills = [] } = await ui.options("skills");
      return skills.map((s) => ({
        label: s.name,
        description: s.description,
        value: s.name,
      }));
    });
    if (value && ui.current()) ui.input("/skill:" + value + " ");
    return true;
  }
  let execution = text;
  if ((name === "model" || name === "thinking") && !args) {
    const value = await ui.menu.choose(
      name === "model" ? "切换模型" : "思考程度",
      async () => {
        const options = await ui.options(name);
        const rows =
          name === "model"
            ? [
                {
                  label: "跟随助手设置",
                  value: "inherit",
                  description: "当前对话使用助手及全局设置的模型",
                },
                ...(options.models ?? []).map((m) => ({
                  label: m.name,
                  description: m.id === m.name ? undefined : m.id,
                  value: m.id,
                })),
              ]
            : (options.levels ?? []).map((level) => ({
                label:
                  (
                    {
                      off: "关闭",
                      minimal: "最少",
                      low: "较少",
                      medium: "标准",
                      high: "深入",
                      xhigh: "更深入",
                      max: "最高",
                    } as Record<string, string>
                  )[level] ?? level,
                description: level,
                value: level,
              }));
        return rows.map((row) => ({
          ...row,
          current: row.value === options.current,
        }));
      },
    );
    if (!value || !ui.current()) return true;
    execution = "/" + name + " " + value;
  }
  if (name === "name" && !args) {
    ui.input("/name ");
    ui.menu.hint("重命名对话", "输入新名称，按 Enter 或发送保存。");
    return true;
  }
  if (!["model", "thinking", "compact", "name", "session"].includes(name))
    throw Error(
      "未接入的命令：/" + name + "。输入 /help 查看可用命令；没有发送给模型。",
    );
  if (name === "session" && args) throw Error("用法：/session");
  if (!ui.current()) return true;
  ui.consume(execution);
  const result = await ui.execute(execution);
  if (!ui.current()) return true;
  if (name === "session" && result) ui.menu.info("当前对话", result);
  else {
    ui.menu.close();
    ui.feedback(result || "已提交到电脑，执行结果会显示在对话中。");
  }
  return true;
}
