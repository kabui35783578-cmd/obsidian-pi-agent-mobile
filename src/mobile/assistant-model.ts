import type { MobileClient } from "./client.ts";
import { errorText } from "../shared/types.ts";
import type { AgentRecord } from "../shared/types.ts";

interface ModelSelection {
  model: string;
  current: string;
  currentLabel: string;
  defaultLabel: string;
}
interface ModelOptions extends ModelSelection {
  models: { id: string; name: string }[];
}

export function renderAssistantModel(
  section: HTMLElement,
  client: MobileClient,
  agent: AgentRecord,
  chat?: { separateModel: boolean; openPicker: () => void },
) {
  const label = section.createEl("label", { text: "助手默认模型" });
  const select = label.createEl("select", { cls: "dropdown" });
  select.disabled = true;
  select.createEl("option", { text: "正在读取…" });
  const status = section.createEl("p", {
    attr: { role: "status", "aria-live": "polite" },
  });
  const actions = section.createDiv({ cls: "pi-phone-model-actions" });
  const reload = actions.createEl("button", { text: "刷新列表", attr: { type: "button" } });
  const save = actions.createEl("button", {
    cls: "mod-cta", text: "保存模型", attr: { type: "button" },
  });
  save.disabled = true;
  if (chat) {
    const chatRow = section.createDiv({ cls: "pi-phone-model-chat" });
    chatRow.createEl("p", {
      text: chat.separateModel ? "当前聊天已单独指定模型" : "当前聊天跟随助手",
    });
    chatRow.createEl("button", { text: "更改当前聊天模型", attr: { type: "button" } })
      .addEventListener("click", chat.openPicker);
  }

  const pairing = client.credential;
  const active = () => section.isConnected && client.credential === pairing;
  const displayName = (id: string) => id.replace(/^connection:/, "")
    .replace(/^chatgpt-subscription\//, "ChatGPT / ")
    .replace(/^codebuddy\//, "CodeBuddy / ");
  let lastKnown = agent.model && agent.model !== "inherit"
    ? displayName(agent.model)
    : "跟随默认模型";
  if (!client.description?.assistantModelEditing || agent.paused) {
    select.options[0].text = lastKnown;
    actions.hidden = true;
    status.setText(agent.paused
      ? "这位助手已暂停，请先在电脑处理。"
      : "升级电脑端 Obot 后可在这里保存助手模型。");
    return;
  }

  let loaded: ModelOptions | undefined;
  let busy = false;
  const controls = () => {
    select.disabled = busy || !loaded;
    save.disabled = busy || !loaded || select.value === loaded.current;
    reload.disabled = busy;
  };
  const show = (options: ModelOptions) => {
    select.empty();
    select.createEl("option", {
      value: "inherit",
      text: options.defaultLabel ? "跟随默认模型 · " + options.defaultLabel : "跟随默认模型",
    });
    const seen = new Set(["inherit"]);
    for (const model of options.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      select.createEl("option", { value: model.id, text: model.name });
    }
    if (!seen.has(options.current)) {
      const missing = select.createEl("option", {
        value: options.current, text: options.currentLabel + "（未列出）",
      });
      missing.disabled = true;
    }
    select.value = options.current;
  };
  const load = async (refresh = false) => {
    if (busy || !active()) return;
    busy = true;
    controls();
    status.setText("正在从电脑读取模型…");
    try {
      const options = await client.call<ModelOptions>("agent.model.options", { agentId: agent.id, refresh });
      if (!active()) return;
      loaded = options;
      lastKnown = options.current === "inherit" ? "跟随默认模型" : options.currentLabel;
      show(options);
      status.setText(options.models.length
        ? "影响跟随助手的聊天，下条消息起生效。"
        : "电脑未返回可选模型。可以恢复跟随默认模型，或稍后刷新。");
    } catch (error) {
      if (!active()) return;
      loaded = undefined;
      select.empty();
      select.createEl("option", { text: lastKnown });
      status.setText("读取失败，连接电脑后可刷新。 " + errorText(error));
    } finally {
      busy = false;
      controls();
    }
  };

  select.addEventListener("change", controls);
  reload.addEventListener("click", () => void load(true));
  save.addEventListener("click", async () => {
    if (busy || !loaded || !active() || select.value === loaded.current) return;
    const selected = select.value;
    busy = true;
    controls();
    status.setText("正在保存到电脑…");
    try {
      const result = await client.mutation<ModelSelection>("agent.model.set", {
        agentId: agent.id, selected, expected: loaded.model,
      });
      if (!active()) return;
      loaded = { ...loaded, ...result };
      lastKnown = result.current === "inherit" ? "跟随默认模型" : result.currentLabel;
      show(loaded);
      status.setText(chat?.separateModel
        ? "已保存。当前聊天仍使用单独指定的模型，可在下方更改。"
        : "已保存。下条跟随助手的消息将使用这个设置。");
    } catch (error) {
      if (active()) status.setText("保存未确认。 " + errorText(error) + " 可刷新列表核对。");
    } finally {
      busy = false;
      controls();
    }
  });
  void load();
}
