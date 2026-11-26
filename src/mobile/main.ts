import {
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
  Notice,
  requestUrl,
  TFile,
  Platform,
  type WorkspaceLeaf,
} from "obsidian";
import { PhoneSheet } from "./sheet.ts";
import { MobileClient } from "./client.ts";
import { MobileChatView, MOBILE_VIEW } from "./view.ts";
import { installSwipeNavigation } from "./swipe-navigation.ts";
import {
  decodePairCode,
  from64,
  remoteEndpoint,
  validateRelay,
  type RemoteCredential,
} from "../shared/mobile-wire.ts";

const SECRET_KEY = "pi-agent-mobile-connection";
const AUTO_OPEN_KEY = "pi-agent-mobile-auto-open";
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
  autoOpen() {
    return this.app.loadLocalStorage(AUTO_OPEN_KEY) === true;
  }
  setAutoOpen(value: boolean) {
    this.app.saveLocalStorage(AUTO_OPEN_KEY, value);
  }
  syncMobileChrome() {
    const active =
      (Platform.isMobile || document.body.classList.contains("is-mobile")) &&
      this.app.workspace.activeLeaf?.view.getViewType() === MOBILE_VIEW;
    document.body.classList.toggle("pi-phone-active", active);
    if (active) {
      for (const drawer of [this.app.workspace.leftSplit, this.app.workspace.rightSplit])
        if (!drawer.collapsed) drawer.collapse();
    }
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
    this.register(installSwipeNavigation(
      window,
      () => (Platform.isMobile || document.body.classList.contains("is-mobile")) &&
        this.app.workspace.activeLeaf?.view.getViewType() === MOBILE_VIEW,
      () => {
        const view = this.app.workspace.activeLeaf?.view;
        if (view instanceof MobileChatView) view.navigateBack();
      },
    ));
    this.addRibbonIcon(
      "messages-square",
      "Obot · 电脑助手",
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
      // Obsidian may restore the chat as the active tab from its saved layout.
      if ((Platform.isMobile || document.body.classList.contains("is-mobile")) && this.autoOpen())
        void this.openChat();
      else if (this.app.workspace.activeLeaf?.view.getViewType() === MOBILE_VIEW)
        void this.leaveChat();
      void this.restore().catch((error) => new Notice(String(error)));
    });
  }
  private async restore() {
    const raw = this.app.secretStorage?.getSecret(SECRET_KEY);
    if (raw) {
      const value = JSON.parse(raw) as RemoteCredential;
      value.endpoint = remoteEndpoint(value.endpoint);
      validateRelay(value.relay, value.endpoint);
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
    const credential = this.client.credential;
    const description = await this.client.call("host.describe");
    if (credential !== this.client.credential || description.hostId !== credential?.hostId)
      throw Error("电脑身份已变化，请重新配对");
    this.client.description = description;
    for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_VIEW)) {
      if (leaf.view instanceof MobileChatView) leaf.view.refreshAvatars();
    }
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

export class PairPhoneModal extends PhoneSheet {
  constructor(
    private plugin: MobilePlugin,
    private initial = "",
  ) {
    super(plugin.app, "连接我的电脑");
  }
  onOpen() {
    this.contentEl.createEl("p", {
      text: "在电脑 Obot 设置中打开「连接 → 手机连接」，生成远程配对码，再粘贴到下方。远程配对支持手机流量，电脑需要保持运行。",
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
    this.unsubscribe = renderPhoneSettings(this.containerEl, this.plugin, () => {
      (this.app as any).setting.close();
      void this.plugin.openChat();
    });
  }
  hide() {
    this.unsubscribe?.();
  }
}

export function renderPhoneSettings(
  el: HTMLElement,
  plugin: MobilePlugin,
  openAssistants: () => void,
) {
  el.empty();
  el.addClass("pi-settings", "pi-phone-settings");
  el.createEl("h2", { text: "电脑连接" });
  const card = el.createDiv({ cls: "pi-phone-computer-card" });
  const head = card.createDiv({ cls: "pi-phone-computer-head" });
  setIcon(head.createSpan({ cls: "pi-phone-computer-icon", attr: { "aria-hidden": "true" } }), "monitor");
  const identity = head.createDiv();
  const title = identity.createEl("h3", {
    text: plugin.client.credential?.vaultName ?? "连接我的电脑",
  });
  const status = identity.createEl("p", {
    cls: "pi-phone-computer-status",
    attr: { role: "status", "aria-live": "polite" },
  });
  const update = () => {
    if (status.textContent !== plugin.client.status) status.setText(plugin.client.status);
    card.toggleClass("is-connected", plugin.client.connected);
    card.toggleClass("is-offline", Boolean(plugin.client.credential) && !plugin.client.connected);
    remove.disabled = !plugin.client.credential;
    const address = plugin.client.credential?.endpoint ?? "尚未配对电脑";
    if (endpoint.textContent !== address) endpoint.setText(address);
    const name = plugin.client.description?.vaultName ?? plugin.client.credential?.vaultName ?? "连接我的电脑";
    if (title.textContent !== name) title.setText(name);
    const action = plugin.client.connected ? "打开助手" : plugin.client.credential ? "重新连接" : "输入配对码";
    if (connect.textContent !== action) connect.setText(action);
  };
  const actions = card.createDiv({ cls: "pi-phone-setting-actions" });
  const connect = actions.createEl("button", {
    text: plugin.client.credential ? "重新连接" : "输入配对码",
    cls: "mod-cta",
  });
  connect.addEventListener("click", async () => {
    if (plugin.client.connected) {
      openAssistants();
      return;
    }
    if (!plugin.client.credential) {
      new PairPhoneModal(plugin).open();
      return;
    }
    connect.disabled = true;
    try {
      await plugin.client.connect(plugin.client.credential);
      update();
    } catch (error) {
      new Notice(String(error));
    } finally {
      connect.disabled = false;
    }
  });
  el.createEl("p", {
    cls: "pi-phone-settings-lead",
    text: "手机聊天，电脑执行。电脑上的 Obsidian 需要保持打开，模型、账号与助手权限在电脑端管理。",
  });
  const group = el.createDiv({ cls: "pi-phone-setting-group" });
  const help = group.createEl("details", { cls: "pi-phone-setting-details" });
  help.createEl("summary", { text: "连接不上？" });
  help.createEl("p", {
    text: "确认电脑未休眠、Obsidian 已打开。远程连接请检查两端网络；局域网连接请确认设备处于同一网络。",
  });
  const details = group.createEl("details", { cls: "pi-phone-setting-details" });
  details.createEl("summary", { text: "连接详情与移除" });
  const endpoint = details.createEl("p", { cls: "pi-phone-endpoint" });
  const detailActions = details.createDiv({ cls: "pi-phone-setting-actions" });
  detailActions.createEl("button", { text: "输入新配对码" })
    .addEventListener("click", () => new PairPhoneModal(plugin).open());
  const remove = detailActions.createEl("button", { text: "移除连接", cls: "mod-warning" });
  remove.addEventListener("click", () => {
    const modal = new PhoneSheet(plugin.app, "移除电脑连接？");
    modal.contentEl.createEl("p", {
      text: "聊天记录仍保留在电脑。下次使用需要重新配对。要撤销设备权限，请在电脑上操作。",
    });
    modal.action("x", "取消", () => {});
    modal.action("unlink", "移除连接", () => {
      plugin.forget();
      update();
    });
    modal.open();
  });
  const about = group.createEl("details", { cls: "pi-phone-setting-details" });
  about.createEl("summary", { text: "助手与数据说明" });
  about.createEl("p", {
    text: "模型、账号、助手权限和工具统一在电脑上设置。任务修改和聊天归档保存在电脑库，手机笔记可作为副本附加，不自动双向同步。锁屏后暂停接收，已提交任务继续执行，回到前台后刷新。",
  });
  new Setting(about)
    .setName("启动时打开 Obot")
    .setDesc("打开 Obsidian 时自动进入手机助手。")
    .addToggle((toggle) => toggle.setValue(plugin.autoOpen()).onChange((value) => {
      try { plugin.setAutoOpen(value); }
      catch (error) { toggle.setValue(!value); new Notice("设置未保存：" + String(error)); }
    }));
  update();
  return plugin.client.subscribe((event) => {
    if (event.type === "connection") update();
  });
}
