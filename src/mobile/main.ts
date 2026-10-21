import {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  requestUrl,
  TFile,
} from "obsidian";
import { MobileClient } from "./client.ts";
import { MobileChatView, MOBILE_VIEW } from "./view.ts";
import {
  decodePairCode,
  from64,
  remoteEndpoint,
  type RemoteCredential,
} from "../shared/mobile-wire.ts";

const SECRET_KEY = "pi-agent-mobile-connection";
export default class MobilePlugin extends Plugin {
  client = new MobileClient(async (url, envelope) => {
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(envelope),
      throw: false,
    });
    if (response.status !== 200)
      throw Error(
        response.status === 401
          ? "设备未授权或已撤销，请在电脑重新配对"
          : "电脑连接失败（HTTP " + response.status + "）",
      );
    return response.json;
  });
  lastNote?: TFile;
  async onload() {
    this.registerView(MOBILE_VIEW, (leaf) => new MobileChatView(leaf, this));
    this.addRibbonIcon(
      "messages-square",
      "Pi Agent · 电脑助手",
      () => void this.openChat(),
    );
    this.addCommand({
      id: "open-mobile-chat",
      name: "打开电脑助手",
      callback: () => void this.openChat(),
    });
    this.addCommand({
      id: "pair-mobile",
      name: "与电脑配对",
      callback: () => new PairPhoneModal(this).open(),
    });
    this.addSettingTab(new PhoneSettings(this.app, this));
    this.registerObsidianProtocolHandler("pi-agent-pair", (params) => {
      if (params.code) new PairPhoneModal(this, params.code).open();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.extension === "md") this.lastNote = file;
      }),
    );
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) this.client.pause();
      else if (this.client.credential) {
        this.client.resume();
        void this.refreshDescription().catch(() => {});
      }
    });
    this.registerDomEvent(window, "online", () => {
      this.client.resume();
    });
    this.registerDomEvent(window, "offline", () => {
      this.client.pause();
    });
    this.register(() => this.client.close());
    this.app.workspace.onLayoutReady(() => {
      void this.restore().catch((error) => new Notice(String(error)));
    });
  }
  private async restore() {
    const raw = this.app.secretStorage?.getSecret(SECRET_KEY);
    if (raw) {
      const value = JSON.parse(raw) as RemoteCredential;
      value.endpoint = remoteEndpoint(value.endpoint);
      if (
        from64(value.secret).length !== 32 ||
        !/^[a-f0-9-]{36}$/.test(value.deviceId) ||
        !/^[a-f0-9-]{36}$/.test(value.hostId)
      )
        throw Error("手机连接资料损坏，请重新配对");
      this.client.credential = value;
      try {
        await this.client.connect(value);
      } catch {
        this.client.resume();
      }
    }
    await this.openChat();
  }
  async pair(code: string, name: string) {
    if (!this.app.secretStorage)
      throw Error("请升级到 Obsidian 1.11.4 或更新版本");
    // Validate before making any network request. A successful pairing never
    // writes the device key to synced plugin data.json.
    decodePairCode(code);
    const credential = await this.client.pair(code, name);
    this.app.secretStorage.setSecret(SECRET_KEY, JSON.stringify(credential));
    for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_VIEW))
      leaf.detach();
    await this.client.connect(credential);
    await this.openChat();
  }
  async refreshDescription() {
    const description = await this.client.call("host.describe");
    if (description.hostId !== this.client.credential?.hostId)
      throw Error("电脑身份已变化，请重新配对");
    this.client.description = description;
    return description;
  }
  forget() {
    this.client.close();
    this.app.secretStorage.setSecret(SECRET_KEY, "");
    this.client.credential = undefined;
    this.client.description = undefined;
    this.client.status = "尚未连接电脑";
    // close clears view subscriptions; reopen views to subscribe again.
    for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_VIEW))
      leaf.detach();
    void this.openChat();
  }
  async openChat() {
    const file = this.app.workspace.getActiveFile();
    if (file?.extension === "md") this.lastNote = file;
    let leaf = this.app.workspace.getLeavesOfType(MOBILE_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: MOBILE_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  localKey(key: string) {
    return (
      "pi-agent-phone:" +
      (this.client.credential?.hostId ?? "unpaired") +
      ":" +
      key
    );
  }
}

export class PairPhoneModal extends Modal {
  constructor(
    private plugin: MobilePlugin,
    private initial = "",
  ) {
    super(plugin.app);
  }
  onOpen() {
    this.titleEl.setText("连接电脑上的 Pi Agent");
    this.contentEl.createEl("p", {
      text: "在电脑「设置 → Pi Agent → 手机连接」启用并生成配对码。手机与电脑需在同一局域网，或通过已有 VPN 连通。",
    });
    let code = this.initial,
      name = "我的手机";
    new Setting(this.contentEl).setName("设备名称").addText((text) =>
      text.setValue(name).onChange((value) => {
        name = value;
      }),
    );
    new Setting(this.contentEl).setName("一次性配对码").addTextArea((text) =>
      text
        .setValue(code)
        .setPlaceholder("pi-agent:…")
        .onChange((value) => {
          code = value;
        }),
    );
    this.contentEl.createEl("p", {
      cls: "pi-muted",
      text: "配对后可使用此电脑所有助手的现有权限，包括总管获准的文件和终端操作。密钥保存在此手机库的 SecretStorage 中，账号仍留在电脑。请只连接自己的电脑。",
    });
    const status = this.contentEl.createDiv({
      attr: { role: "status", "aria-live": "polite" },
    });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("配对并连接")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          status.setText("正在与电脑配对…");
          try {
            await this.plugin.pair(code, name);
            new Notice("已连接电脑");
            this.close();
          } catch (error) {
            status.setText(
              String(error) + "。若配对已被电脑接收，请重新生成配对码。",
            );
          } finally {
            button.setDisabled(false);
          }
        }),
    );
  }
}
class PhoneSettings extends PluginSettingTab {
  constructor(
    app: any,
    private plugin: MobilePlugin,
  ) {
    super(app, plugin);
  }
  display() {
    const el = this.containerEl;
    el.empty();
    el.addClass("pi-settings");
    el.createEl("h2", { text: "Pi Agent · 手机" });
    el.createEl("p", { text: this.plugin.client.status });
    el.createEl("p", {
      cls: "pi-muted",
      text: "手机负责交互，电脑负责模型、Skills、MCP、文件和命令。电脑关闭或休眠时无法执行任务。手机锁屏后暂停接收，回到前台后刷新；已提交任务继续在电脑执行。",
    });
    new Setting(el)
      .setName("电脑连接")
      .setDesc(this.plugin.client.credential?.endpoint ?? "尚未配对")
      .addButton((button) =>
        button
          .setButtonText("扫码后粘贴配对码")
          .onClick(() => new PairPhoneModal(this.plugin).open()),
      );
    new Setting(el).setName("重新连接").addButton((button) =>
      button.setButtonText("连接电脑").onClick(async () => {
        try {
          if (!this.plugin.client.credential) throw Error("请先配对电脑");
          await this.plugin.client.connect(this.plugin.client.credential);
          this.display();
        } catch (error) {
          new Notice(String(error));
        }
      }),
    );
    new Setting(el)
      .setName("移除此手机的连接")
      .setDesc("清除此库本机密钥；在电脑端撤销设备才会使所有旧密钥失效。")
      .addButton((button) =>
        button.setButtonText("移除本机连接").onClick(() => {
          this.plugin.forget();
          this.display();
        }),
      );
    new Setting(el)
      .setName("电脑配置")
      .setDesc(
        "模型账号、助手权限、Skills 与 MCP 在电脑设置。聊天与归档从电脑读取，不要求两个设备使用同一份同步库。",
      );
  }
}
