import {
  ItemView,
  Modal,
  Notice,
  MarkdownRenderer,
  Component,
  setIcon,
  Menu,
  type WorkspaceLeaf,
} from "obsidian";
import type MobilePlugin from "./main.ts";
import { PairPhoneModal } from "./main.ts";
import {
  iconButton,
  renderAvatar as baseAvatar,
  toolLabel,
} from "../plugin/ui-elements.ts";
import { MOBILE_AVATARS } from "./avatar-data.ts";
import { remoteId } from "../shared/mobile-wire.ts";
import { latestByAgent, toolSteps } from "../shared/conversation-ui.ts";
import { MarkdownCache } from "../plugin/markdown-cache.ts";
import { SlashMenu } from "../plugin/slash-menu.ts";
import { handleSlashUI } from "../plugin/command-ui.ts";
import { CommandDraft } from "../plugin/command-draft.ts";
import { parseSlash } from "../shared/slash-commands.ts";
import { errorText } from "../shared/types.ts";
import type {
  AgentRecord,
  Conversation,
  ConversationSummary,
  DelegationRecord,
  ToolEvent,
} from "../shared/types.ts";
import {
  connectionCopy,
  describePreview,
  fileChipLabel,
  greeting,
  isSameDay,
  presentMessage,
  shortStatus,
  type Artifact,
  type ExpenseArtifact,
  type FileArtifact,
} from "./artifacts.ts";

export const MOBILE_VIEW = "pi-agent-mobile-chat";
// BRAT installs three release files, so phone avatars cannot rely on an assets folder.
const renderAvatar = (
  parent: HTMLElement,
  app: MobilePlugin["app"],
  agent: AgentRecord,
) => baseAvatar(parent, app, agent, "", MOBILE_AVATARS);
const sourceName = (source: string) =>
  ({ mobile: "手机", desktop: "电脑", weixin: "微信", delegation: "助手任务" })[
    source
  ] ?? source;
const safeMarkdown = (text: string) =>
  text.replace(/!\[\[([^\]]+)\]\]/g, "[[$1]]");
interface Outbox {
  command?: boolean;
  operationId: string;
  id: string;
  text: string;
  attachment?: { path: string; text: string };
}

export class MobileChatView extends ItemView {
  private agent?: AgentRecord;
  private conversation?: Conversation;
  private unsubscribe?: () => void;
  private header!: HTMLElement;
  private statusEl!: HTMLElement;
  private timeline!: HTMLElement;
  private footer!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private slashMenu?: SlashMenu;
  private commandPending = false;
  private attachmentEl!: HTMLElement;
  private attachment?: { path: string; text: string };
  private generation = 0;
  private refreshVersion = 0;
  private closed = false;
  private sending = false;
  private limit = 60;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private streamTimer?: ReturnType<typeof setTimeout>;
  private streams = new Map<string, { text: string; seq: number }>();
  private streamNodes = new Map<string, Text>();
  private messagesComponent?: Component;
  private describing?: Promise<void>;
  private error = "";
  private home!: HTMLElement;
  private homeList!: HTMLElement;
  private homeSearch!: HTMLInputElement;
  private homeDock!: HTMLElement;
  private homeInput!: HTMLTextAreaElement;
  private homeSend!: HTMLButtonElement;
  private homeMode = true;
  private summaries: ConversationSummary[] = [];
  private homeRevision = 0;
  private markdownCache: MarkdownCache;
  private previousRunning?: boolean;
  private shownAttachment?: string;
  constructor(
    leaf: WorkspaceLeaf,
    readonly plugin: MobilePlugin,
  ) {
    super(leaf);
    this.markdownCache = this.addChild(new MarkdownCache(this.app));
  }
  getViewType() {
    return MOBILE_VIEW;
  }
  getDisplayText() {
    return this.agent?.name ?? "Pi Agent";
  }
  getIcon() {
    return "messages-square";
  }
  async onOpen() {
    this.closed = false;
    this.previousRunning = undefined;
    this.shownAttachment = undefined;
    const el = this.contentEl;
    el.empty();
    el.addClass("pi-agent-view", "pi-phone-view");
    this.header = el.createDiv({ cls: "pi-chat-header pi-phone-header" });
    this.statusEl = el.createDiv({
      cls: "pi-phone-connection",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.home = el.createDiv({ cls: "pi-phone-home" });
    const search = this.home.createDiv({
      cls: "pi-phone-home-search",
      attr: { hidden: "" },
    });
    this.homeSearch = search.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索助手或聊天", "aria-label": "搜索助手或聊天" },
    });
    this.homeSearch.addEventListener("input", () => this.renderHome());
    this.homeList = this.home.createDiv({ cls: "pi-phone-home-list" });
    this.homeDock = this.home.createDiv({ cls: "pi-phone-home-dock" });
    const homeComposer = this.homeDock.createDiv({
      cls: "pi-chat-composer pi-home-composer",
    });
    const homeLine = homeComposer.createDiv({ cls: "pi-composer-line" });
    this.homeInput = homeLine.createEl("textarea", {
      attr: {
        rows: "1",
        placeholder: "给助手发送消息",
        "aria-label": "给常用助手发送消息",
      },
    });
    this.homeInput.addEventListener("input", () => {
      this.resizeHomeInput();
      this.controls();
    });
    this.homeSend = iconButton(
      homeLine,
      "arrow-up",
      "发送给常用助手",
      () => void this.sendFromHome(),
      "pi-send-button",
    );
    this.timeline = el.createDiv({
      cls: "pi-chat-messages pi-phone-messages",
      attr: { "aria-label": "电脑助手聊天" },
    });
    this.timeline.addEventListener(
      "click",
      (event) => {
        const target = (event.target as HTMLElement).closest<HTMLAnchorElement>(
          "a.internal-link",
        );
        if (target) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const path =
            target.getAttribute("data-href") || target.getAttribute("href");
          if (path) void this.readNote(path);
        }
      },
      true,
    );
    this.footer = el.createDiv({ cls: "pi-composer-dock" });
    const composer = this.footer.createDiv({ cls: "pi-chat-composer" });
    this.attachmentEl = composer.createDiv({ cls: "pi-attachment-list" });
    const line = composer.createDiv({ cls: "pi-composer-line" });
    this.input = line.createEl("textarea", {
      attr: {
        rows: "1",
        placeholder: "发消息给电脑助手…",
        "aria-label": "聊天消息",
      },
    });
    this.input.addEventListener("input", () => {
      this.saveDraft();
      this.resizeInput();
      this.controls();
    });
    if (this.slashMenu) this.removeChild(this.slashMenu);
    this.slashMenu = this.addChild(
      new SlashMenu(composer, this.input, (text) => {
        this.input.value = text;
        void this.runSlash(text);
      }),
    );
    // Mobile Return inserts a newline; sending uses the explicit touch button.
    this.sendButton = iconButton(
      line,
      "arrow-up",
      "发送给电脑",
      () => void this.sendOrStop(),
      "pi-send-button",
    );
    this.unsubscribe = this.plugin.client.subscribe((event) =>
      this.onEvent(event),
    );
    this.renderHeader();
    this.controls();
    if (this.plugin.client.description) await this.showHome();
    else this.welcome();
  }
  async onClose() {
    this.slashMenu?.close();
    this.markdownCache.clear();
    this.closed = true;
    this.generation++;
    this.homeRevision++;
    this.saveDraft();
    this.unsubscribe?.();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.streamTimer);
    this.messagesComponent?.unload();
  }
  private welcome() {
    this.setScreen(true);
    this.homeList.empty();
    this.timeline.empty();
    const welcome = this.homeList.createDiv({ cls: "pi-phone-welcome" });
    const manager = {
      avatar: "builtin:coordinator",
      name: "总管",
    } as AgentRecord;
    renderAvatar(welcome, this.app, manager);
    welcome.createEl("h2", { text: "你的助手，随时聊" });
    welcome.createEl("p", {
      cls: "pi-muted",
      text: "连接电脑，就能在这里聊天、处理笔记。",
    });
    welcome
      .createEl("button", { text: "连接我的电脑", cls: "mod-cta" })
      .addEventListener("click", () => new PairPhoneModal(this.plugin).open());
    if (this.plugin.client.credential)
      welcome
        .createEl("button", { text: "重新连接" })
        .addEventListener("click", () => {
          void this.plugin.client
            .connect(this.plugin.client.credential!)
            .catch((e) => this.fail(e));
        });
  }
  private fail(error: unknown) {
    if (this.closed) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.controls();
    new Notice(this.error);
  }
  private async chooseInitial() {
    await this.showHome();
  }
  private renderHeader() {
    if (!this.header) return;
    this.header.empty();
    if (this.homeMode) {
      iconButton(
        this.header,
        "user-round",
        "设置与返回笔记",
        (event) => this.homeMenu(event),
        "pi-phone-round pi-phone-account",
      );
      this.header.createDiv({ cls: "pi-phone-header-space" });
      iconButton(
        this.header,
        "search",
        "搜索助手或聊天",
        () => {
          const search = this.homeSearch.parentElement!;
          search.hidden = !search.hidden;
          if (!search.hidden) this.homeSearch.focus();
          else {
            this.homeSearch.value = "";
            this.renderHome();
          }
        },
        "pi-phone-round",
      );
      iconButton(
        this.header,
        "plus",
        "开始新聊天",
        () => this.startChat(),
        "pi-phone-round",
      );
      return;
    }
    iconButton(
      this.header,
      "chevron-left",
      "返回助手列表",
      () => void this.showHome(),
      "pi-phone-round",
    );
    const identity = this.header.createEl("button", {
      cls: "pi-phone-identity",
      attr: { "aria-label": (this.agent?.name ?? "助手") + "，资料与聊天操作" },
    });
    if (this.agent) renderAvatar(identity, this.app, this.agent);
    const copy = identity.createSpan({ cls: "pi-phone-identity-copy" });
    copy.createEl("strong", { text: this.agent?.name ?? "Pi Agent" });
    const link = copy.createEl("em", { cls: "pi-phone-identity-status" });
    link.createSpan({ cls: "pi-status-dot" });
    link.createSpan({ cls: "pi-phone-link-text", text: "电脑状态" });
    identity.addEventListener("click", (event) => this.chatMenu(event));
    this.header.createDiv({ cls: "pi-phone-header-space" });
    iconButton(
      this.header,
      "ellipsis",
      "聊天操作",
      (event) => this.chatMenu(event),
      "pi-phone-round",
    );
  }
  private controls() {
    if (!this.statusEl) return;
    const client = this.plugin.client;
    const status = this.error || client.status;
    if (this.statusEl.textContent !== status) this.statusEl.setText(status);
    this.statusEl.hidden =
      !this.error &&
      (client.connected || (this.homeMode && !client.credential));
    const link = connectionCopy(
      {
        connected: client.connected,
        status: client.status,
        endpoint: client.credential?.endpoint,
        hasCredential: Boolean(client.credential),
      },
      "chat",
    );
    const identityStatus = this.header.querySelector<HTMLElement>(
      ".pi-phone-identity-status",
    );
    identityStatus?.classList.toggle("is-on", link.online);
    const identityText = identityStatus?.querySelector(".pi-phone-link-text");
    if (identityText) identityText.textContent = link.text;
    identityStatus
      ?.querySelector(".pi-status-dot")
      ?.classList.toggle("is-on", link.online);
    const homeLink = this.home?.querySelector<HTMLElement>(".pi-home-link");
    if (homeLink) {
      const home = connectionCopy(
        {
          connected: client.connected,
          status: client.status,
          endpoint: client.credential?.endpoint,
          hasCredential: Boolean(client.credential),
        },
        "home",
      );
      homeLink.classList.toggle("is-on", home.online);
      const homeText = homeLink.querySelector(".pi-phone-link-text");
      if (homeText) homeText.textContent = home.text;
      homeLink
        .querySelector(".pi-status-dot")
        ?.classList.toggle("is-on", home.online);
    }
    this.statusEl.toggleClass(
      "is-error",
      Boolean(this.error) || !client.connected,
    );
    const running = this.conversation?.status === "running";
    if (running !== this.previousRunning) {
      setIcon(this.sendButton, running ? "square" : "arrow-up");
      this.previousRunning = running;
    }
    this.sendButton.setAttribute(
      "aria-label",
      running ? "停止电脑任务" : "发送给电脑",
    );
    this.sendButton.disabled =
      !client.connected ||
      this.sending ||
      !this.conversation ||
      Boolean(this.conversation.archive) ||
      (!running && !this.input.value.trim() && !this.outbox());
    this.input.disabled = this.sending;
    this.input.placeholder = this.conversation?.archive
      ? "已归档，点助手名开始新聊天"
      : "向" + (this.agent?.name ?? "助手") + "发送消息";
    if (this.homeDock)
      this.homeDock.hidden = !this.plugin.client.description || !this.homeMode;
    if (this.homeInput && this.homeSend) {
      const agent = this.composerAgent();
      const homePlaceholder = agent
        ? "给" + agent.name + "发送消息"
        : "连接电脑后即可发送";
      if (this.homeInput.placeholder !== homePlaceholder)
        this.homeInput.placeholder = homePlaceholder;
      this.homeInput.disabled = !client.connected || this.sending;
      this.homeSend.disabled =
        !client.connected || this.sending || !agent || !this.homeInput.value.trim();
      this.homeSend.setAttribute(
        "aria-label",
        agent ? "发送给" + agent.name : "发送",
      );
    }
    if (this.shownAttachment === (this.attachment?.path ?? "")) return;
    this.shownAttachment = this.attachment?.path ?? "";
    this.attachmentEl.empty();
    if (this.attachment) {
      const button = this.attachmentEl.createEl("button", {
        text: "手机笔记副本 · " + this.attachment.path + " ×",
        cls: "pi-text-button",
      });
      button.addEventListener("click", () => {
        this.attachment = undefined;
        this.saveDraft();
        this.controls();
      });
    }
  }
  private draftKey(id = this.conversation?.id) {
    return this.plugin.localKey("draft:" + id);
  }
  private saveDraft() {
    if (this.conversation && this.input)
      this.app.saveLocalStorage(this.draftKey(), {
        text: this.input.value,
        attachment: this.attachment,
      });
  }
  private outbox(): Outbox | undefined {
    return this.conversation
      ? (this.app.loadLocalStorage(
          this.plugin.localKey("outbox:" + this.conversation.id),
        ) ?? undefined)
      : undefined;
  }
  private async selectAgent(agent: AgentRecord, fresh = false) {
    this.saveDraft();
    this.agent = agent;
    this.setScreen(false);
    this.conversation = undefined;
    this.input.value = "";
    this.attachment = undefined;
    this.error = "";
    this.limit = 60;
    const generation = ++this.generation;
    this.app.saveLocalStorage(this.plugin.localKey("selected-agent"), agent.id);
    this.renderHeader();
    this.controls();
    this.timeline.setText("正在读取电脑上的对话…");
    try {
      if (fresh) {
        await this.newConversation();
        return;
      }
      const list = await this.plugin.client.call<ConversationSummary[]>(
        "conversation.list",
        { agentId: agent.id },
      );
      if (generation !== this.generation || this.closed) return;
      const selected = this.app.loadLocalStorage(
        this.plugin.localKey("selected:" + agent.id),
      );
      const item = list.find((c) => c.id === selected) ?? list[0];
      if (item) await this.openConversation(item.id);
      else {
        await this.newConversation();
      }
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
  }
  async openConversation(id: string) {
    this.slashMenu?.close();
    this.saveDraft();
    const generation = ++this.generation;
    try {
      const conversation = await this.plugin.client.call<Conversation>(
        "conversation.get",
        { id, limit: 60 },
      );
      if (this.closed || generation !== this.generation) return;
      this.conversation = conversation;
      this.agent = this.plugin.client.description.agents.find(
        (a: AgentRecord) => a.id === conversation.agentId,
      );
      this.setScreen(false);
      this.app.saveLocalStorage(
        this.plugin.localKey("selected:" + conversation.agentId),
        id,
      );
      const draft = this.app.loadLocalStorage(this.draftKey(id));
      this.input.value = draft?.text ?? "";
      this.resizeInput();
      this.attachment = draft?.attachment;
      this.error = "";
      this.limit = 60;
      this.renderHeader();
      this.renderMessages();
      this.controls();
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
  }
  private async newConversation() {
    if (!this.agent || this.sending) return;
    const generation = this.generation,
      agentId = this.agent.id;
    const carry = this.conversation?.archive
      ? { text: this.input.value, attachment: this.attachment }
      : undefined;
    try {
      const item = await this.plugin.client.mutation<Conversation>(
        "conversation.create",
        { agentId: this.agent.id },
      );
      if (
        this.closed ||
        this.homeMode ||
        generation !== this.generation ||
        this.agent?.id !== agentId
      )
        return;
      await this.openConversation(item.id);
      if (carry) {
        this.input.value = carry.text;
        this.attachment = carry.attachment;
        this.saveDraft();
        this.controls();
      }
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
  }
  private async refreshConversation() {
    const revision = ++this.refreshVersion;
    const id = this.conversation?.id,
      generation = this.generation;
    if (!id || this.closed) return;
    try {
      const value = await this.plugin.client.call<Conversation>(
        "conversation.get",
        { id, limit: this.limit },
      );
      if (
        revision !== this.refreshVersion ||
        this.closed ||
        generation !== this.generation ||
        this.conversation?.id !== id
      )
        return;
      this.conversation = value;
      if (value.status !== "running") this.streams.delete(id);
      this.renderMessages();
      this.controls();
    } catch (e) {
      this.fail(e);
    }
  }
  private queueRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshConversation();
    }, 90);
  }
  private async loadOlder() {
    const c = this.conversation,
      generation = this.generation;
    if (!c) return;
    try {
      const older = await this.plugin.client.call<
        Conversation & { messageOffset: number }
      >("conversation.get", {
        id: c.id,
        limit: 60,
        before: (c as any).messageOffset ?? 0,
      });
      if (
        generation !== this.generation ||
        this.conversation !== c ||
        this.closed
      )
        return;
      const end = (c as any).messageOffset ?? 0;
      // A page contains its own events. Keep already loaded turns and replace
      // the older range, including legacy unscoped events only at the beginning.
      c.events = [
        ...older.events.filter((event) =>
          event.messageIndex === undefined
            ? older.messageOffset === 0
            : event.messageIndex >= older.messageOffset &&
              event.messageIndex < end,
        ),
        ...c.events.filter((event) =>
          event.messageIndex === undefined
            ? older.messageOffset !== 0
            : event.messageIndex >= end,
        ),
      ];
      c.messages.unshift(...older.messages);
      (c as any).messageOffset = older.messageOffset;
      c.delegations = [...(older.delegations ?? []), ...(c.delegations ?? [])];
      this.limit = c.messages.length;
      this.renderMessages();
    } catch (e) {
      this.fail(e);
    }
  }
  private onEvent(event: any) {
    if (this.closed) return;
    if (event.type === "connection") {
      this.controls();
      if (
        this.homeMode &&
        this.plugin.client.connected &&
        this.plugin.client.description
      )
        void this.refreshHome();
      if (
        this.plugin.client.connected &&
        (!this.plugin.client.description || !this.agent) &&
        !this.describing
      ) {
        this.describing = this.plugin
          .refreshDescription()
          .then(() => this.chooseInitial())
          .catch((e) => this.fail(e))
          .finally(() => {
            this.describing = undefined;
          });
      }
    } else if (event.type === "remote.reset") {
      this.streams.clear();
      for (const stream of event.streams ?? [])
        this.streams.set(stream.conversationId, stream);
      this.queueRefresh();
      if (!this.describing)
        this.describing = this.plugin
          .refreshDescription()
          .then(() => {
            if (this.agent)
              this.agent = this.plugin.client.description.agents.find(
                (a: AgentRecord) => a.id === this.agent!.id,
              );
            this.renderHeader();
            if (this.homeMode) void this.refreshHome();
          })
          .catch((e) => this.fail(e))
          .finally(() => {
            this.describing = undefined;
          });
    } else if (event.type === "chat.delta") {
      const before = this.streams.get(event.conversationId);
      if (before && event.remoteSequence <= before.seq) return;
      this.streams.set(event.conversationId, {
        text: (before?.text ?? "") + event.delta,
        seq: event.remoteSequence,
      });
      if (
        !this.homeMode &&
        this.streamNodes.has(event.conversationId) &&
        !this.streamTimer
      )
        this.streamTimer = setTimeout(() => {
          this.streamTimer = undefined;
          this.flushStreams();
        }, 32);
    } else if (event.type === "conversation.changed") {
      if (event.status !== "running") this.streams.delete(event.id);
      if (event.id === this.conversation?.id) this.queueRefresh();
      if (this.homeMode) void this.refreshHome();
    } else if (event.type === "delegation.updated") {
      if (
        this.conversation &&
        event.parentConversationId === this.conversation.id
      ) {
        const records = (this.conversation.delegations ??= []);
        const index = records.findIndex(
          (r) => r.conversationId === event.conversationId,
        );
        if (index >= 0) records[index] = event;
        else records.push(event);
        this.queueRefresh();
      }
    } else if (
      event.type === "tool.event" &&
      event.conversationId === this.conversation?.id
    ) {
      this.conversation?.events.push(event);
      this.queueRefresh();
    } else if (
      event.type === "remote.operation" &&
      event.operation.conversationId === this.conversation?.id
    ) {
      if (
        event.operation.status === "failed" ||
        event.operation.status === "uncertain"
      )
        this.fail(event.operation.error);
      this.queueRefresh();
    } else if (event.type === "agents" || event.type === "model.status") {
      void this.plugin
        .refreshDescription()
        .then(() => {
          if (this.homeMode) this.renderHome();
        })
        .catch((e) => this.fail(e));
    }
  }
  private renderMessages() {
    const c = this.conversation;
    if (!c) return;
    this.markdownCache.reset(c.id);
    const retained = new Set<string>();
    const follow =
      this.timeline.scrollHeight -
        this.timeline.scrollTop -
        this.timeline.clientHeight <
      100;
    const previousHeight = this.timeline.scrollHeight,
      previousTop = this.timeline.scrollTop;
    const opened = new Set(
      [
        ...this.timeline.querySelectorAll<HTMLDetailsElement>(
          ".pi-activity[open]",
        ),
      ].map((element) => element.dataset.activityKey),
    );
    const offset = (c as any).messageOffset ?? 0;
    const start = Math.max(0, c.messages.length - this.limit);
    const activeIndex =
      offset + c.messages.findLastIndex((message) => message.role === "user");
    const eventGroups = new Map<number | undefined, ToolEvent[]>();
    const delegated = new Set(
      c.delegations?.map((record) => record.messageIndex),
    );
    for (const event of c.events) {
      if (
        delegated.has(event.messageIndex!) &&
        (event.name === "delegate_task" || event.name.startsWith("delegate:"))
      )
        continue;
      const index =
        Number.isSafeInteger(event.messageIndex) && event.messageIndex! >= 0
          ? event.messageIndex
          : undefined;
      const group = eventGroups.get(index);
      if (group) group.push(event);
      else eventGroups.set(index, [event]);
    }
    this.messagesComponent?.unload();
    this.messagesComponent = new Component();
    this.messagesComponent.load();
    this.timeline.empty();
    this.streamNodes.clear();
    if (c.parent)
      this.timeline
        .createEl("button", { cls: "pi-text-button", text: "← 返回总管对话" })
        .addEventListener(
          "click",
          () => void this.openConversation(c.parent!.conversationId),
        );
    if (c.archive) {
      const banner = this.timeline.createDiv({ cls: "pi-source-banner" });
      banner.createSpan({ text: "已归档到电脑 · " + c.archive.path });
      banner
        .createEl("button", { text: "阅读归档", cls: "pi-text-button" })
        .addEventListener("click", () => void this.readNote(c.archive!.path));
    }
    const pending = this.outbox();
    if (pending) {
      const warning = this.timeline.createDiv({ cls: "pi-source-banner" });
      warning.createSpan({
        text: "上一条发送结果待确认；重试使用同一个任务编号，避免重复执行。",
      });
      warning
        .createEl("button", { text: "检查接收状态", cls: "pi-text-button" })
        .addEventListener("click", () => void this.checkOutbox());
    }
    if ((c as any).messageOffset > 0 || c.messages.length > this.limit)
      this.timeline
        .createEl("button", { text: "加载更早消息", cls: "pi-text-button" })
        .addEventListener("click", () => void this.loadOlder());
    if (offset + start === 0 && eventGroups.has(undefined))
      this.renderActivity(
        eventGroups.get(undefined)!,
        undefined,
        opened,
        activeIndex,
      );
    for (let index = start; index < c.messages.length; index++) {
      const message = c.messages[index];
      const previous = c.messages[index - 1];
      if (
        !previous ||
        new Date(message.at).getTime() - new Date(previous.at).getTime() >
          15 * 60_000
      ) {
        this.timeline.createDiv({
          cls: "pi-phone-date",
          text: this.messageStamp(new Date(message.at)),
        });
      }
      const row = this.timeline.createDiv({
        cls:
          "pi-message pi-message-" +
          message.role +
          (message.kind === "command" ? " pi-message-command" : ""),
      });
      if (message.role === "user" && (message.origin ?? c.source) !== "mobile")
        row.createDiv({
          cls: "pi-message-origin",
          text: sourceName(message.origin ?? c.source),
        });
      // User text is a literal instruction; assistant Markdown links open the
      // remote read-only note viewer rather than a same-named local note.
      const events = eventGroups.get(offset + index);
      if (message.role === "user")
        row.createDiv({
          cls: "pi-message-bubble markdown-rendered",
          text: message.text,
        });
      else
        this.renderRichText(
          row,
          String(index + ((c as any).messageOffset ?? 0)),
          message.text,
          events ?? [],
          retained,
          message.at,
        );
      if (events?.length)
        this.renderActivity(events, offset + index, opened, activeIndex);
      for (const record of c.delegations ?? [])
        if (record.messageIndex === index + ((c as any).messageOffset ?? 0))
          this.delegation(record, retained);
    }
    if (!c.messages.length)
      this.timeline.createDiv({
        cls: "pi-phone-welcome",
        text:
          "你好，我是" +
          (this.agent?.name ?? "你的助手") +
          "。想让电脑帮你处理什么？",
      });
    if (c.status === "running") {
      const running = this.timeline.createDiv({
        cls: "pi-message pi-message-assistant",
      });
      const bubble = running.createDiv({
        cls: "pi-message-bubble pi-phone-stream",
      });
      const node = document.createTextNode(
        this.streams.get(c.id)?.text ?? "正在电脑处理…",
      );
      bubble.appendChild(node);
      this.streamNodes.set(c.id, node);
    }
    this.timeline.createDiv({
      cls: "pi-phone-result-status",
      text: {
        idle: "",
        running: "任务正在电脑执行",
        failed: "本次任务未完成，请查看错误消息",
        cancelled: "任务已停止，已完成的修改保留",
      }[c.status],
    });
    this.markdownCache.retain(retained);
    if (follow) this.timeline.scrollTop = this.timeline.scrollHeight;
    else
      this.timeline.scrollTop = Math.max(
        0,
        previousTop + this.timeline.scrollHeight - previousHeight,
      );
  }
  private renderActivity(
    events: ToolEvent[],
    index: number | undefined,
    opened: Set<string | undefined>,
    activeIndex: number,
  ) {
    const c = this.conversation!;
    const key = c.id + ":" + (index ?? "legacy");
    const active =
      index !== undefined && index === activeIndex && c.status === "running";
    const steps = toolSteps(events);
    const running =
      active && [...steps].reverse().find((step) => step.status === "running");
    const incomplete = steps.some(
      (step) =>
        step.status === "failed" || (!active && step.status === "running"),
    );
    const records = this.timeline.createEl("details", { cls: "pi-activity" });
    records.dataset.activityKey = key;
    if (index !== undefined) records.dataset.messageIndex = String(index);
    records.open = opened.has(key);
    records.createEl("summary", {
      text:
        index === undefined
          ? "更早的工作过程 · 未关联消息"
          : running
            ? toolLabel(running.name) + "…"
            : incomplete
              ? "工作过程 · 有步骤未完成"
              : "工作过程 · " + steps.length + " 步",
    });
    const list = records.createDiv({ cls: "pi-activity-list" });
    for (const step of steps) {
      const state =
        step.status === "running" && !active ? "incomplete" : step.status;
      const label =
        state === "failed"
          ? "失败"
          : state === "running"
            ? "执行中"
            : state === "incomplete"
              ? "未完成"
              : "完成";
      const row = list.createDiv({
        cls: "pi-tool-event",
        attr: { "data-status": state },
      });
      const status = row.createSpan({
        cls: "pi-step-status " + state,
        attr: { "aria-label": label },
      });
      setIcon(
        status,
        state === "failed"
          ? "circle-alert"
          : state === "running"
            ? "loader-circle"
            : state === "incomplete"
              ? "circle-minus"
              : "check",
      );
      const text = row.createDiv({ cls: "pi-step-content" });
      text.createSpan({ text: toolLabel(step.name) });
      if (step.detail) text.createDiv({ cls: "pi-muted", text: step.detail });
    }
  }
  private markdown(text: string, el: HTMLElement) {
    // Intercept internal links above; don't render file embeds from the phone's
    // unrelated local vault when displaying a remote computer conversation.
    void MarkdownRenderer.render(
      this.app,
      safeMarkdown(text),
      el,
      "",
      this.messagesComponent!,
    ).catch(() => el.setText(text));
  }
  private delegation(record: DelegationRecord, retained: Set<string>) {
    const el = this.timeline.createDiv({ cls: "pi-delegation" });
    el.dataset.conversationId = record.conversationId;
    const agents = this.plugin.client.description.agents as AgentRecord[];
    const from = agents.find((a) => a.id === record.fromAgentId),
      target = agents.find((a) => a.id === record.toAgentId);
    const route = el.createDiv({ cls: "pi-delegation-route" });
    route.createSpan({ text: (from?.name ?? "总管") + " 已发消息给 " });
    if (target) renderAvatar(route, this.app, target);
    route
      .createEl("button", {
        text: target?.name ?? "助手",
        cls: "pi-text-button",
      })
      .addEventListener(
        "click",
        () => void this.openConversation(record.conversationId),
      );
    el.createDiv({ cls: "pi-delegation-task", text: record.task });
    el.createDiv({
      cls: "pi-delegation-status",
      text:
        {
          queued: "排队中",
          running: "正在处理",
          completed: "已回复",
          cancelled: "已停止",
          failed: "未完成",
        }[record.status] +
        (record.progress && record.status === "running"
          ? " · " + toolLabel(record.progress)
          : ""),
    });
    const reply = el.createDiv({ cls: "pi-delegation-reply" });
    if (record.status === "running") {
      const node = document.createTextNode(
        this.streams.get(record.conversationId)?.text ?? "",
      );
      reply.appendChild(node);
      this.streamNodes.set(record.conversationId, node);
    } else if (
      record.status === "completed" &&
      record.result &&
      presentMessage(record.result).some((segment) => segment.type === "artifact")
    )
      this.renderRichText(
        reply,
        "deleg:" + record.conversationId,
        record.result,
        [],
        retained,
      );
    else {
      reply.addClass("markdown-rendered");
      this.markdown(record.result || record.error || "", reply);
    }
  }
  private renderRichText(
    parent: HTMLElement,
    key: string,
    text: string,
    events: ToolEvent[],
    retained: Set<string>,
    at?: string,
  ) {
    const segments = presentMessage(
      text,
      events.map((event) => ({
        name: event.name,
        status: event.status,
        detail: event.detail,
      })),
    );
    if (!segments.some((segment) => segment.type === "artifact")) {
      retained.add(key);
      void this.markdownCache.render(
        key,
        safeMarkdown(text),
        "",
        parent,
        "pi-message-bubble markdown-rendered",
      ).ready;
      return;
    }
    let part = 0;
    for (const segment of segments) {
      if (segment.type === "text") {
        const partKey = key + ":" + part++;
        retained.add(partKey);
        void this.markdownCache.render(
          partKey,
          safeMarkdown(segment.text),
          "",
          parent,
          "pi-message-bubble markdown-rendered",
        ).ready;
      } else this.renderArtifact(parent, segment.artifact, at);
    }
  }
  private renderArtifact(parent: HTMLElement, artifact: Artifact, at?: string) {
    const card = parent.createDiv({
      cls: "pi-artifact pi-artifact-" + artifact.kind,
    });
    if (artifact.kind === "expense") {
      const head = card.createDiv({ cls: "pi-artifact-hd" });
      head.createSpan({ cls: "pi-artifact-kicker", text: "记账" });
      head.createSpan({ cls: "pi-artifact-badge", text: artifact.badge });
      const body = card.createDiv({ cls: "pi-artifact-bd" });
      body.createDiv({ cls: "pi-artifact-title", text: artifact.category });
      const when = this.expenseWhen(artifact, at);
      if (when) body.createDiv({ cls: "pi-artifact-sub", text: when });
      this.renderExpenseMini(body, artifact);
      if (artifact.path && artifact.action)
        this.artifactAction(card, artifact.action, artifact.path);
      return;
    }
    const file = card.createDiv({ cls: "pi-artifact-file" });
    const icon = file.createDiv({ cls: "pi-artifact-file-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "file-text");
    const meta = file.createDiv({ cls: "pi-artifact-file-meta" });
    meta.createEl("strong", { text: artifact.name });
    meta.createSpan({ text: artifact.subtitle });
    this.artifactAction(card, artifact.action, artifact.path);
  }
  private artifactAction(card: HTMLElement, label: string, path: string) {
    card
      .createEl("button", {
        cls: "pi-artifact-action",
        text: label,
        attr: { type: "button" },
      })
      .addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.readNote(path);
      });
  }
  private renderExpenseMini(parent: HTMLElement, expense: ExpenseArtifact) {
    const box = parent.createDiv({ cls: "pi-mini-ledger" });
    const row = box.createDiv({ cls: "pi-ledger-row" });
    row.createSpan({ text: expense.item || "金额" });
    row.createSpan({ cls: "pi-ledger-amt", text: expense.amount });
    if (expense.total && expense.totalLabel) {
      const total = box.createDiv({ cls: "pi-ledger-row is-total" });
      total.createSpan({ text: expense.totalLabel });
      total.createSpan({ cls: "pi-ledger-amt", text: expense.total });
    }
  }
  private renderFileChip(parent: HTMLElement, file: FileArtifact) {
    const chip = parent.createDiv({ cls: "pi-file-chip" });
    const icon = chip.createSpan({ cls: "pi-file-chip-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "file");
    chip.createSpan({ text: fileChipLabel(file.path) });
  }
  private expenseWhen(expense: ExpenseArtifact, at?: string) {
    const date = at ? new Date(at) : undefined;
    const day = date && !Number.isNaN(date.getTime()) ? this.dayLabel(date) : "";
    if (expense.time) return (day ? day + " " : "") + expense.time;
    if (!date || Number.isNaN(date.getTime())) return "";
    return (
      day +
      " " +
      date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    ).trim();
  }
  private dayLabel(date: Date) {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "今天";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "昨天";
    return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }
  private messageStamp(date: Date) {
    const day = this.dayLabel(date);
    if (day === "昨天") return day;
    return (
      day +
      " " +
      date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    );
  }
  private flushStreams() {
    const follow =
      this.timeline.scrollHeight -
        this.timeline.scrollTop -
        this.timeline.clientHeight <
      100;
    for (const [id, node] of this.streamNodes) {
      const text = this.streams.get(id)?.text;
      if (text === undefined || !node.isConnected) continue;
      if (text.startsWith(node.data)) node.appendData(text.slice(node.length));
      else node.data = text;
    }
    if (follow) this.timeline.scrollTop = this.timeline.scrollHeight;
  }
  private async runSlash(text: string) {
    const command = parseSlash(text);
    if (!command || command.name.startsWith("skill:")) return false;
    if ((this.commandPending && command.name !== "stop") || !this.slashMenu)
      return true;
    if (this.outbox()) {
      this.fail("请先确认上一条消息的发送结果，再使用命令");
      return true;
    }
    this.commandPending = true;
    const id = this.conversation?.id,
      generation = this.generation,
      agentId = this.agent?.id;
    const current = () =>
      this.generation === generation &&
      this.conversation?.id === id &&
      !this.closed;
    const draft = new CommandDraft(this.input, text, () => {
      this.saveDraft();
      this.controls();
      this.resizeInput();
    });
    try {
      this.slashMenu.close();
      await handleSlashUI(text, {
        menu: this.slashMenu,
        current,
        consume: (value) => draft.consume(value),
        feedback: (value) => new Notice(value),
        options: (kind) =>
          this.plugin.client.call("command.options", { id, kind }),
        history: async () => {
          const rows = await this.plugin.client.call<ConversationSummary[]>(
            "conversation.list",
            { agentId, includeArchived: true },
          );
          return rows.map((c) => ({
            label: c.title,
            description:
              (c.archive ? "已归档 · " : "") +
              describePreview(c.preview).preview,
            value: c.id,
            current: c.id === id,
          }));
        },
        resume: async (value) => {
          if (current() && this.input.value.trim() === text) {
            this.input.value = "";
            this.saveDraft();
          }
          if (current()) await this.openConversation(value);
        },
        input: (value) => {
          if (current()) {
            this.input.value = value;
            this.input.focus();
            this.saveDraft();
            this.controls();
            this.resizeInput();
          }
        },
        local: async (name) => {
          if (current() && this.input.value.trim() === text) {
            this.input.value = "";
            this.saveDraft();
          }
          if (name === "new") await this.newConversation();
          else if (name === "settings") this.plugin.openSettings();
          else if (name === "stop") {
            await this.plugin.client.mutation("chat.cancel", { id });
            this.queueRefresh();
          } else if (name === "copy") {
            const last = this.conversation
              ? [...this.conversation.messages]
                  .reverse()
                  .find((m) => m.role === "assistant")
              : undefined;
            if (!last)
              throw Error("当前已加载的消息里没有助手回复，请先加载更早消息");
            await navigator.clipboard.writeText(last.text);
            new Notice("已复制最后一条回答");
          }
        },
        execute: async (value) => {
          if (!current()) return;
          if (/^\/session(?:\s|$)/i.test(value))
            return this.plugin.client.call<string>("command.inspect", {
              id,
              text: value,
            });
          await this.sendOrStop(true, value);
        },
      });
    } catch (error) {
      if (current()) {
        draft.restore();
        this.slashMenu.info(
          "命令未完成",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      draft.dispose();
      this.commandPending = false;
      this.controls();
      this.resizeInput();
    }
    return true;
  }
  private async sendOrStop(skipCommand = false, commandText?: string) {
    if (!this.conversation || this.sending) return;
    const id = this.conversation.id;
    if (this.conversation.status === "running" && !skipCommand) {
      try {
        await this.plugin.client.mutation("chat.cancel", { id });
        this.queueRefresh();
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    if (!skipCommand && (await this.runSlash(this.input.value.trim()))) return;
    if (this.conversation.archive) return;
    const pending = this.outbox();
    if (!pending && !(commandText ?? this.input.value.trim())) return;
    const operation: Outbox = pending ?? {
      operationId: remoteId(),
      id,
      text: commandText ?? this.input.value.trim(),
      attachment: commandText ? undefined : this.attachment,
      command: Boolean(commandText),
    };
    if (
      operation.text.length + (operation.attachment?.text.length ?? 0) >
      99_000
    ) {
      this.fail("消息与笔记过长，请精简后重试");
      return;
    }
    this.saveDraft();
    this.app.saveLocalStorage(this.plugin.localKey("outbox:" + id), operation);
    this.sending = true;
    this.error = "";
    this.controls();
    try {
      const result = await this.plugin.client.mutation(
        "chat.submit",
        { id, text: operation.text, attachment: operation.attachment },
        operation.operationId,
      );
      if (result.status === "failed" || result.status === "uncertain")
        throw Error(result.error || "任务结果待确认，请查看历史");
      this.accepted(operation);
      await this.refreshConversation();
    } catch (e) {
      this.fail(e);
      this.renderMessages();
      if (skipCommand) throw e;
    } finally {
      this.sending = false;
      this.controls();
    }
  }
  private accepted(operation: Outbox, clearDraft = true) {
    if (
      clearDraft &&
      this.conversation?.id === operation.id &&
      this.input.value.trim() === operation.text
    ) {
      this.input.value = "";
      this.resizeInput();
      if (!operation.command) this.attachment = undefined;
      this.saveDraft();
    }
    // Save the draft first. A crash between these writes retains the stable
    // operation ID, so recovering an acknowledgement cannot replay the task.
    this.app.saveLocalStorage(
      this.plugin.localKey("outbox:" + operation.id),
      null,
    );
  }
  private async checkOutbox() {
    const operation = this.outbox();
    if (!operation) return;
    try {
      const state = await this.plugin.client.call("operation.get", {
        id: operation.operationId,
      });
      if (state.status === "failed" || state.status === "uncertain") {
        this.accepted(operation, false);
        this.fail(state.error || "请查看对话确认结果");
      } else {
        this.accepted(operation);
        this.error =
          "电脑已接收 · " +
          (state.status === "completed" ? "任务完成" : "正在处理");
      }
      await this.refreshConversation();
    } catch (e) {
      this.fail(e);
    }
    this.controls();
  }
  private resizeInput() {
    if (!this.input) return;
    this.input.style.height = "auto";
    this.input.style.height =
      Math.min(128, Math.max(36, this.input.scrollHeight)) + "px";
  }
  private setScreen(home: boolean) {
    this.slashMenu?.close();
    this.homeMode = home;
    this.home.hidden = !home;
    this.timeline.hidden = home;
    this.footer.hidden = home;
    this.contentEl.toggleClass("is-home", home);
    this.renderHeader();
    this.controls();
  }
  private async showHome() {
    this.saveDraft();
    // Invalidate pending agent/conversation fetches when returning to the list.
    this.generation++;
    this.setScreen(true);
    if (!this.plugin.client.description) {
      this.welcome();
      return;
    }
    this.renderHome();
    await this.refreshHome();
  }
  private async refreshHome() {
    const revision = ++this.homeRevision;
    try {
      const list =
        await this.plugin.client.call<ConversationSummary[]>(
          "conversation.list",
        );
      if (this.closed || revision !== this.homeRevision) return;
      this.summaries = list;
      if (this.homeMode) this.renderHome();
    } catch (error) {
      if (revision === this.homeRevision && this.homeMode) this.fail(error);
    }
  }
  private renderHome() {
    if (!this.homeList) return;
    this.homeList.empty();
    const query = this.homeSearch.value.trim().toLocaleLowerCase();
    const latestMap = latestByAgent(this.summaries);
    const latest = (id: string) => latestMap.get(id);
    const agents = [
      ...(this.plugin.client.description?.agents ?? []),
    ] as AgentRecord[];
    agents.sort(
      (a, b) =>
        Number(b.role === "manager") - Number(a.role === "manager") ||
        (latest(b.id)?.updatedAt ?? "").localeCompare(
          latest(a.id)?.updatedAt ?? "",
        ) ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
    const pinned = this.pinnedAgents(agents);
    if (!query) {
      const hello = this.homeList.createDiv({ cls: "pi-phone-hello" });
      hello.createEl("h2", { text: greeting() });
      const sub = hello.createDiv({ cls: "pi-home-link" });
      sub.createSpan({ cls: "pi-status-dot" });
      sub.createSpan({ cls: "pi-phone-link-text", text: "电脑状态" });
      const today = agents
        .map((agent) => {
          const summary = latest(agent.id);
          if (!summary || !isSameDay(summary.updatedAt)) return;
          const brief = describePreview(
            summary.preview,
            summary.status === "running",
          );
          if (!brief.structured || summary.status === "running") return;
          return { agent, summary, brief };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) =>
          b.summary.updatedAt.localeCompare(a.summary.updatedAt),
        )
        .slice(0, 3);
      if (today.length) this.renderToday(today);
      if (pinned.length) this.renderPins(pinned, latest);
    }
    const rows = this.homeList.createDiv({
      cls: "pi-phone-recent",
      attr: { "aria-label": "助手聊天" },
    });
    const matches = agents.filter(
      (agent) =>
        !query ||
        [agent.name, agent.description, agent.scope, latest(agent.id)?.preview ?? ""]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
    );
    const recent = matches
      .filter((agent) => latest(agent.id))
      .sort((a, b) =>
        latest(b.id)!.updatedAt.localeCompare(latest(a.id)!.updatedAt),
      );
    const others = matches.filter((agent) => !latest(agent.id));
    for (const [label, group] of [
      ["最近", recent],
      ["其他助手", others],
    ] as const) {
      if (!group.length) continue;
      if (!query) rows.createDiv({ cls: "pi-phone-block-title", text: label });
      for (const agent of group) this.renderContact(rows, agent, latest(agent.id), pinned);
    }
    if (query && !matches.length)
      rows.createDiv({
        cls: "pi-phone-empty",
        text: "没有找到，试试助手名字或聊天内容。",
      });
    if (!agents.length)
      rows.createDiv({
        cls: "pi-phone-empty",
        text: "还没有助手，请先在电脑打开 Pi Agent。",
      });
    this.controls();
  }
  private renderToday(
    items: {
      agent: AgentRecord;
      summary: ConversationSummary;
      brief: ReturnType<typeof describePreview>;
    }[],
  ) {
    const block = this.homeList.createDiv({ cls: "pi-phone-block" });
    block.createDiv({ cls: "pi-phone-block-title", text: "今日" });
    const card = block.createDiv({ cls: "pi-today-card" });
    for (const item of items) {
      const button = card.createEl("button", {
        cls: "pi-today-item",
        attr: {
          type: "button",
          "aria-label": item.agent.name + "，" + item.brief.title,
        },
      });
      renderAvatar(button, this.app, item.agent);
      const copy = button.createDiv({ cls: "pi-today-copy" });
      const kicker = copy.createDiv({ cls: "pi-today-kicker" });
      kicker.createEl("strong", { text: item.agent.name });
      kicker.createEl("time", {
        text: this.relativeTime(item.summary.updatedAt),
        attr: { datetime: item.summary.updatedAt },
      });
      copy.createDiv({ cls: "pi-today-title", text: item.brief.title });
      if (item.brief.expense) this.renderExpenseMini(copy, item.brief.expense);
      else if (item.brief.file) this.renderFileChip(copy, item.brief.file);
      button.addEventListener("click", () => void this.selectAgent(item.agent));
    }
  }
  private renderPins(
    featured: AgentRecord[],
    latest: (id: string) => ConversationSummary | undefined,
  ) {
    const block = this.homeList.createDiv({ cls: "pi-phone-block" });
    block.createDiv({ cls: "pi-phone-block-title", text: "常用助手" });
    const grid = block.createDiv({
      cls: "pi-pin-grid",
      attr: { "aria-label": "固定助手，长按调整" },
    });
    for (const agent of featured) {
      const summary = latest(agent.id);
      const brief = summary
        ? describePreview(summary.preview, summary.status === "running")
        : undefined;
      const status =
        brief?.statusLine ||
        shortStatus(
          agent.description ||
            (agent.scope ? "负责 " + agent.scope : "随时聊聊"),
        );
      const button = grid.createEl("button", {
        cls: "pi-pin-card",
        attr: {
          type: "button",
          "aria-label": "与" + agent.name + "聊天，长按调整固定。" + status,
        },
      });
      renderAvatar(button, this.app, agent);
      button.createSpan({ cls: "pi-pin-name", text: agent.name });
      button.createSpan({ cls: "pi-pin-status", text: status });
      this.pinGesture(button, agent, featured);
      button.addEventListener("click", () => void this.selectAgent(agent));
    }
  }
  private renderContact(
    parent: HTMLElement,
    agent: AgentRecord,
    summary: ConversationSummary | undefined,
    pinned: AgentRecord[],
  ) {
    const brief = summary
      ? describePreview(summary.preview, summary.status === "running")
      : undefined;
    const preview = summary
      ? summary.status === "running"
        ? "正在处理…"
        : brief?.preview || summary.preview
      : agent.description ||
        (agent.scope ? "负责 " + agent.scope : "帮你处理笔记与日常任务");
    const button = parent.createEl("button", {
      cls: "pi-phone-contact",
      attr: { type: "button", "aria-label": "与" + agent.name + "聊天" },
    });
    button.dataset.agentId = agent.id;
    renderAvatar(button, this.app, agent);
    const body = button.createDiv({ cls: "pi-phone-contact-body" });
    const title = body.createDiv({ cls: "pi-phone-contact-title" });
    title.createEl("strong", { text: agent.name });
    if (summary)
      title.createEl("time", {
        text: this.relativeTime(summary.updatedAt),
        attr: { datetime: summary.updatedAt },
      });
    body.createDiv({ cls: "pi-phone-contact-preview", text: preview });
    if (brief && summary?.status !== "running" && brief.chips.length) {
      const chips = body.createDiv({ cls: "pi-chip-row" });
      for (const chip of brief.chips) {
        chips.createSpan({
          cls: "pi-chip" + (chip.tone ? " is-" + chip.tone : ""),
          text: chip.text,
        });
      }
    }
    this.pinGesture(button, agent, pinned);
    button.addEventListener("click", () => void this.selectAgent(agent));
  }
  private composerAgent() {
    const agents = (this.plugin.client.description?.agents ?? []) as AgentRecord[];
    const last = this.app.loadLocalStorage(this.plugin.localKey("selected-agent"));
    return (
      agents.find((agent) => agent.id === last) ||
      this.pinnedAgents(agents)[0] ||
      agents[0]
    );
  }
  private resizeHomeInput() {
    if (!this.homeInput) return;
    this.homeInput.style.height = "auto";
    this.homeInput.style.height =
      Math.min(128, Math.max(36, this.homeInput.scrollHeight)) + "px";
  }
  private async sendFromHome() {
    const text = this.homeInput?.value.trim() ?? "";
    const agent = this.composerAgent();
    if (!text || !agent || this.sending || !this.plugin.client.connected) return;
    this.homeInput.value = "";
    this.resizeHomeInput();
    this.controls();
    await this.selectAgent(agent);
    if (!this.conversation || this.homeMode) {
      if (this.homeMode && this.homeInput) this.homeInput.value = text;
      else if (this.input) {
        this.input.value = text;
        this.resizeInput();
        this.saveDraft();
        this.controls();
      }
      return;
    }
    if (
      this.conversation.archive ||
      this.conversation.status === "running" ||
      this.outbox()
    ) {
      this.input.value = text;
      this.resizeInput();
      this.saveDraft();
      this.controls();
      return;
    }
    this.input.value = text;
    this.resizeInput();
    this.saveDraft();
    await this.sendOrStop();
  }
  private pinnedAgents(agents: AgentRecord[]) {
    const stored = this.app.loadLocalStorage(
      this.plugin.localKey("pinned-agents"),
    );
    const ids = Array.isArray(stored)
      ? [
          ...new Set(
            stored.filter((id): id is string => typeof id === "string"),
          ),
        ].slice(0, 3)
      : [...agents]
          .sort(
            (a, b) =>
              Number(b.role === "manager") - Number(a.role === "manager") ||
              a.name.localeCompare(b.name, "zh-CN"),
          )
          .slice(0, 3)
          .map((a) => a.id);
    return ids
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is AgentRecord => Boolean(a));
  }
  private savePins(ids: string[]) {
    try {
      const value = [...new Set(ids)].slice(0, 3);
      this.app.saveLocalStorage(this.plugin.localKey("pinned-agents"), value);
      this.renderHome();
    } catch (error) {
      new Notice("固定助手未保存：" + errorText(error));
    }
  }
  private pinMenu(
    agent: AgentRecord,
    featured: AgentRecord[],
    event: MouseEvent,
  ) {
    const menu = new Menu();
    const ids = featured.map((a) => a.id);
    if (ids.includes(agent.id))
      menu.addItem((item) =>
        item
          .setTitle("取消固定到顶部")
          .setIcon("pin-off")
          .onClick(() => this.savePins(ids.filter((id) => id !== agent.id))),
      );
    else if (ids.length < 3)
      menu.addItem((item) =>
        item
          .setTitle("固定到顶部")
          .setIcon("pin")
          .onClick(() => this.savePins([...ids, agent.id])),
      );
    else {
      menu.addItem((item) =>
        item.setTitle("替换一位顶部助手").setDisabled(true),
      );
      featured.forEach((current, index) =>
        menu.addItem((item) =>
          item
            .setTitle("替换「" + current.name + "」")
            .setIcon("pin")
            .onClick(() =>
              this.savePins(ids.map((id, i) => (i === index ? agent.id : id))),
            ),
        ),
      );
    }
    menu.showAtMouseEvent(event);
  }
  private pinGesture(
    button: HTMLButtonElement,
    agent: AgentRecord,
    featured: AgentRecord[],
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined,
      suppressClick = false,
      x = 0,
      y = 0;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const open = (event: MouseEvent) => {
      cancel();
      suppressClick = true;
      if (button.isConnected && !this.closed)
        this.pinMenu(agent, featured, event);
    };
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!suppressClick) open(event);
    });
    button.addEventListener("pointerdown", (event) => {
      cancel();
      suppressClick = false;
      if (event.pointerType === "mouse" || event.button !== 0) return;
      x = event.clientX;
      y = event.clientY;
      timer = setTimeout(() => open(event), 500);
    });
    button.addEventListener("pointermove", (event) => {
      if (Math.hypot(event.clientX - x, event.clientY - y) > 10) cancel();
    });
    for (const name of ["pointerup", "pointercancel", "pointerleave"])
      button.addEventListener(name, cancel);
    button.addEventListener(
      "click",
      (event) => {
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  }
  private relativeTime(value: string) {
    const date = new Date(value),
      now = new Date();
    if (date.toDateString() === now.toDateString())
      return date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "昨天";
    return date.toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  }
  private chatMenu(event: MouseEvent) {
    new Menu()
      .addItem((item) =>
        item
          .setTitle("新聊天")
          .setIcon("square-pen")
          .onClick(() => void this.newConversation()),
      )
      .addItem((item) =>
        item
          .setTitle("聊天历史与归档")
          .setIcon("history")
          .onClick(() => this.history()),
      )
      .addItem((item) =>
        item
          .setTitle("助手资料")
          .setIcon("contact-round")
          .onClick(() => this.profile()),
      )
      .addItem((item) =>
        item
          .setTitle("设置与电脑连接")
          .setIcon("settings")
          .onClick(() => this.plugin.openSettings()),
      )
      .showAtMouseEvent(event);
  }
  private homeMenu(event: MouseEvent) {
    new Menu()
      .addItem((item) =>
        item
          .setTitle("设置与电脑连接")
          .setIcon("settings")
          .onClick(() => this.plugin.openSettings()),
      )
      .addItem((item) =>
        item
          .setTitle("返回 Obsidian 笔记")
          .setIcon("notebook")
          .onClick(() => void this.plugin.leaveChat()),
      )
      .showAtMouseEvent(event);
  }
  private connectionInfo() {
    const modal = new Modal(this.app);
    modal.modalEl.addClass("pi-phone-modal");
    modal.titleEl.setText("我的电脑");
    modal.contentEl.createEl("p", {
      text: this.plugin.client.description?.vaultName ?? "尚未连接",
    });
    modal.contentEl.createEl("p", {
      cls: "pi-muted",
      text: this.plugin.client.status,
    });
    modal.contentEl.createEl("p", {
      cls: "pi-muted",
      text: "任务在电脑执行。电脑上的 Obsidian 需要保持打开。",
    });
    const button = modal.contentEl.createEl("button", { text: "连接设置" });
    button.addEventListener("click", () => {
      modal.close();
      this.plugin.openSettings();
    });
    modal.open();
  }
  private startChat() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("与谁开始新聊天？");
    modal.modalEl.addClass("pi-phone-modal", "pi-phone-picker");
    modal.contentEl.addClass("pi-phone-contacts");
    const search = modal.contentEl.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索助手", "aria-label": "搜索助手" },
    });
    const list = modal.contentEl.createDiv({ cls: "pi-phone-picker-list" });
    const render = () => {
      list.empty();
      for (const agent of (this.plugin.client.description?.agents ??
        []) as AgentRecord[]) {
        if (
          !(agent.name + agent.description + agent.scope).includes(
            search.value.trim(),
          )
        )
          continue;
        const row = list.createEl("button", {
          cls: "pi-phone-contact",
          attr: { "aria-label": "与" + agent.name + "聊天" },
        });
        row.toggleClass("is-active", agent.id === this.agent?.id);
        renderAvatar(row, this.app, agent);
        const identity = row.createDiv({ cls: "pi-phone-contact-body" });
        identity.createEl("strong", {
          cls: "pi-phone-picker-name",
          text: agent.name,
        });
        identity.createDiv({
          cls: "pi-muted pi-phone-contact-preview",
          text: agent.description || agent.scope || "总管",
        });
        row.addEventListener("click", () => {
          modal.close();
          void this.selectAgent(agent, true);
        });
      }
    };
    search.addEventListener("input", render);
    render();
    modal.open();
    return modal;
  }
  private profile() {
    if (!this.agent) return;
    const agent = this.agent as any;
    const modal = new Modal(this.app);
    modal.modalEl.addClass("pi-phone-modal");
    modal.titleEl.setText(agent.name);
    renderAvatar(modal.contentEl, this.app, agent);
    modal.contentEl.createEl("p", { text: agent.description });
    modal.contentEl.createEl("p", {
      text:
        "负责目录：" +
        (agent.scope || "总管") +
        " · 模型：" +
        (agent.model || this.plugin.client.description.model || "未选择"),
    });
    modal.contentEl.createEl("p", {
      text:
        "Skills：" +
        (agent.skills.join("、") || "未授权") +
        " · MCP 工具：" +
        agent.mcpTools.length,
    });
    const permissions = agent.permissions;
    if (permissions)
      modal.contentEl.createEl("p", {
        text:
          "文件范围：" +
          (
            {
              folder: "助手目录",
              vault: "电脑知识库",
              computer: "电脑文件",
            } as any
          )[permissions.files] +
          " · " +
          (permissions.write ? "可修改" : "只读") +
          " · " +
          (permissions.commands ? "可执行命令" : "命令未开放"),
      });
    const prompt = modal.contentEl.createEl("details");
    prompt.createEl("summary", { text: "提示词" });
    prompt.createEl("p", { text: agent.prompt || "默认提示词" });
    modal.contentEl.createEl("p", {
      cls: "pi-muted",
      text: "以上能力在电脑执行，权限与连接配置请在电脑管理。",
    });
    modal.open();
  }
  private history() {
    if (this.agent) new PhoneHistory(this, this.agent).open();
  }
  async readNote(path: string) {
    const agent = this.plugin.client.description?.agents.find(
      (a: AgentRecord) => a.path === path,
    );
    if (agent) {
      await this.selectAgent(agent);
      return;
    }
    const modal = new Modal(this.app);
    modal.titleEl.setText("电脑笔记 · 只读");
    const body = modal.contentEl.createDiv({
      cls: "markdown-rendered pi-phone-note",
    });
    body.setText("正在从电脑读取…");
    const component = new Component();
    component.load();
    modal.onClose = () => component.unload();
    body.addEventListener(
      "click",
      (event) => {
        const target = (event.target as HTMLElement).closest<HTMLAnchorElement>(
          "a.internal-link",
        );
        if (target) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void this.readNote(
            target.dataset.href || target.getAttribute("href") || "",
          );
        }
      },
      true,
    );
    modal.open();
    try {
      const value = await this.plugin.client.call("note.read", {
        path,
        agentId: this.agent?.id,
      });
      body.empty();
      modal.titleEl.setText("电脑笔记 · " + value.path);
      await MarkdownRenderer.render(
        this.app,
        safeMarkdown(value.content),
        body,
        "",
        component,
      );
    } catch (e) {
      body.setText(String(e));
    }
  }
}

class PhoneHistory extends Modal {
  private archived = false;
  private list: ConversationSummary[] = [];
  private limit = 100;
  private search = "";
  private closed = false;
  constructor(
    private view: MobileChatView,
    private agent: AgentRecord,
  ) {
    super(view.app);
  }
  onOpen() {
    this.modalEl.addClass("pi-phone-modal");
    this.titleEl.setText("聊天历史");
    void this.refresh();
  }
  onClose() {
    this.closed = true;
  }
  private async refresh() {
    try {
      this.list = await this.view.plugin.client.call("conversation.list", {
        agentId: this.agent.id,
        includeArchived: true,
      });
      if (!this.closed) this.render();
    } catch (e) {
      if (!this.closed) this.contentEl.setText(String(e));
    }
  }
  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("pi-history-modal");
    el.createEl("p", {
      cls: "pi-muted",
      text:
        "归档为 Markdown，保存在电脑「" +
        (this.agent.scope ? this.agent.scope + "/" : "") +
        "聊天归档」。",
    });
    const tabs = el.createDiv({ cls: "pi-history-tabs" });
    for (const archived of [false, true]) {
      const button = tabs.createEl("button", {
        text: archived ? "已归档" : "未归档",
        attr: { "aria-pressed": String(archived === this.archived) },
      });
      button.addEventListener("click", () => {
        this.archived = archived;
        this.limit = 100;
        this.render();
      });
    }
    const search = el.createEl("input", {
      type: "search",
      attr: { "aria-label": "搜索聊天历史", placeholder: "搜索聊天" },
    });
    search.value = this.search;
    const rows = el.createDiv({ cls: "pi-history-list" });
    const renderRows = () => {
      rows.empty();
      const filtered = this.list.filter(
        (c) =>
          Boolean(c.archive) === this.archived &&
          (c.title + c.preview + sourceName(c.source)).includes(this.search),
      );
      if (!filtered.length)
        rows.createEl("p", { cls: "pi-muted", text: "没有匹配的对话" });
      for (const item of filtered.slice(0, this.limit)) {
        const row = rows.createDiv({ cls: "pi-history-row" });
        const open = row.createEl("button", { cls: "pi-history-open" });
        open.createSpan({ cls: "pi-history-title", text: item.title });
        open.createSpan({
          cls: "pi-history-meta",
          text:
            sourceName(item.source) +
            " · " +
            item.messageCount +
            " 条 · " +
            new Date(item.updatedAt).toLocaleString(),
        });
        open.createSpan({
          cls: "pi-history-preview",
          text: describePreview(item.preview).preview || item.preview,
        });
        open.addEventListener("click", () => {
          this.close();
          void this.view.openConversation(item.id);
        });
        const archive = row.createEl("button", {
          cls: "pi-history-archive",
          text: item.archive ? "阅读笔记" : "归档",
        });
        archive.disabled = item.status === "running";
        archive.addEventListener("click", () => {
          if (item.archive) {
            this.close();
            void this.view.readNote(item.archive.path);
            return;
          }
          archive.disabled = true;
          const key = this.view.plugin.localKey("archive-operation:" + item.id);
          const operationId = this.app.loadLocalStorage(key) || remoteId();
          this.app.saveLocalStorage(key, operationId);
          void this.view.plugin.client
            .mutation("conversation.archive", { id: item.id }, operationId)
            .then(async () => {
              this.app.saveLocalStorage(key, null);
              await this.refresh();
            })
            .catch((error) => {
              if (!this.closed) new Notice(String(error));
            })
            .finally(() => {
              archive.disabled = item.status === "running";
            });
        });
      }
      if (filtered.length > this.limit)
        rows
          .createEl("button", { text: "加载更多" })
          .addEventListener("click", () => {
            this.limit += 100;
            renderRows();
          });
    };
    search.addEventListener("input", () => {
      this.search = search.value;
      this.limit = 100;
      renderRows();
    });
    renderRows();
  }
}
