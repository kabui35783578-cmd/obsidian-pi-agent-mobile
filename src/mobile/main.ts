import {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  requestUrl,
  TFile,
  Platform,
  type WorkspaceLeaf,
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
  syncMobileChrome() {
    const active =
      (Platform.isMobile || document.body.classList.contains("is-mobile")) &&
      this.app.workspace.activeLeaf?.view.getViewType() === MOBILE_VIEW;
    document.body.classList.toggle("pi-phone-active", active);
  }
  async leaveChat() {
    let target: WorkspaceLeaf | undefined;
    this.app.workspace.iterateRootLeaves((leaf) => {
      if (leaf.view.getViewType() !== MOBILE_VIEW) target ??= leaf;
    });
    if (!target) {
      target = this.app.workspace.getLeaf("tab");
      if (this.lastNote) await target.openFile(this.lastNote);
      else await target.setViewState({ type: "empty", active: true });
    }
    await this.app.workspace.revealLeaf(target);
    this.app.workspace.setActiveLeaf(target, { focus: true });
    this.syncMobileChrome();
  }
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
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.syncMobileChrome(),
      ),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncMobileChrome()),
    );
    this.register(() => document.body.classList.remove("pi-phone-active"));
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
      this.syncMobileChrome();
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
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.syncMobileChrome();
  }
  localKey(key: string) {
    return (
      "pi-agent-phone:" +
      (this.client.credential?.hostId ?? "unpaired") +
      ":" +
      key
    );
  }
  openSettings() {
    (this.app as any).setting.open();
    (this.app as any).setting.openTabById(this.manifest.id);
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
    this.modalEl.addClass("pi-phone-modal");
    this.titleEl.setText("连接我的电脑");
    this.contentEl.createEl("p", {
      text: "在电脑 Pi Agent 设置中打开「连接 → 手机连接」，生成配对码，再粘贴到下方。两台设备需连接同一 Wi-Fi，或都打开 Tailscale。",
    });
    let code = this.initial,
      name = "我的手机";
    const advanced = this.contentEl.createEl("details", {
      cls: "pi-phone-setting-details",
    });
    advanced.createEl("summary", { text: "手机名称" });
    new Setting(advanced).setName("设备名称").addText((text) =>
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
    this.contentEl.appendChild(advanced);
    this.contentEl.createEl("p", {
      cls: "pi-muted",
      text: "只连接自己的电脑。配对后，手机可让助手按电脑上的现有权限处理文件、执行任务。",
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
export class PhoneSettings extends PluginSettingTab {
  private unsubscribe?: () => void;
  constructor(
    app: any,
    private plugin: MobilePlugin,
  ) {
    super(app, plugin);
  }
  display() {
    this.unsubscribe?.();
    const el = this.containerEl;
    el.empty();
    el.addClass("pi-settings", "pi-phone-settings");
    el.createEl("h2", { text: "设置" });
    const card = el.createDiv({ cls: "pi-phone-computer-card" });
    const title = card.createEl("h3", {
      text: this.plugin.client.credential?.vaultName ?? "连接我的电脑",
    });
    const status = card.createEl("p", {
      cls: "pi-phone-computer-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    const update = () => {
      status.setText(this.plugin.client.status);
      card.toggleClass("is-connected", this.plugin.client.connected);
      title.setText(
        this.plugin.client.description?.vaultName ??
          this.plugin.client.credential?.vaultName ??
          "连接我的电脑",
      );
      connect.setText(
        this.plugin.client.connected
          ? "打开助手"
          : this.plugin.client.credential
            ? "重新连接"
            : "输入配对码",
      );
    };
    const actions = card.createDiv({ cls: "pi-phone-setting-actions" });
    const connect = actions.createEl("button", {
      text: this.plugin.client.credential ? "重新连接" : "输入配对码",
      cls: "mod-cta",
    });
    connect.addEventListener("click", async () => {
      if (this.plugin.client.connected) {
        (this.app as any).setting.close();
        await this.plugin.openChat();
        return;
      }
      if (!this.plugin.client.credential) {
        new PairPhoneModal(this.plugin).open();
        return;
      }
      connect.disabled = true;
      try {
        await this.plugin.client.connect(this.plugin.client.credential);
        update();
      } catch (error) {
        new Notice(String(error));
      } finally {
        connect.disabled = false;
      }
    });
    update();
    this.unsubscribe = this.plugin.client.subscribe((event) => {
      if (event.type === "connection") update();
    });
    el.createEl("p", {
      cls: "pi-muted",
      text: "手机聊天，电脑执行。电脑上的 Obsidian 需要保持打开。",
    });
    const help = el.createEl("details", { cls: "pi-phone-setting-details" });
    help.createEl("summary", { text: "连接不上？" });
    help.createEl("p", {
      text: "确认电脑未休眠、Obsidian 已打开；手机和电脑连接同一 Wi-Fi，或都打开 Tailscale。使用 Tailscale 时，电脑配对地址选择 100. 开头的地址。",
    });
    const details = el.createEl("details", { cls: "pi-phone-setting-details" });
    details.createEl("summary", { text: "连接详情与移除" });
    details.createEl("p", {
      cls: "pi-phone-endpoint",
      text: this.plugin.client.credential?.endpoint ?? "尚未配对电脑",
    });
    new Setting(details)
      .setName("与电脑重新配对")
      .addButton((button) =>
        button
          .setButtonText("输入新配对码")
          .onClick(() => new PairPhoneModal(this.plugin).open()),
      );
    new Setting(details)
      .setName("移除这台电脑")
      .setDesc("清除此手机的连接。要撤销设备权限，请在电脑上操作。")
      .addButton((button) =>
        button
          .setButtonText("移除连接")
          .setDisabled(!this.plugin.client.credential)
          .onClick(() => {
            const modal = new Modal(this.app);
            modal.modalEl.addClass("pi-phone-modal");
            modal.titleEl.setText("移除电脑连接？");
            modal.contentEl.createEl("p", {
              text: "聊天记录仍保留在电脑。下次使用需要重新配对。",
            });
            new Setting(modal.contentEl)
              .addButton((b) =>
                b.setButtonText("取消").onClick(() => modal.close()),
              )
              .addButton((b) =>
                b
                  .setButtonText("移除连接")
                  .setWarning()
                  .onClick(() => {
                    this.plugin.forget();
                    modal.close();
                    this.display();
                  }),
              );
            modal.open();
          }),
      );
    const about = el.createEl("details", { cls: "pi-phone-setting-details" });
    about.createEl("summary", { text: "助手与数据" });
    about.createEl("p", {
      text: "模型、账号、助手权限和工具统一在电脑上设置。任务修改和聊天归档保存在电脑库，手机笔记可作为副本附加，不自动双向同步。锁屏后暂停接收，已提交任务继续执行，回到前台后刷新。",
    });
  }
  hide() {
    this.unsubscribe?.();
  }
}
