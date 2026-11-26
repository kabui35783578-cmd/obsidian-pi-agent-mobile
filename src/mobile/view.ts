import { streamFrame } from "./stream-frame.ts";
import { WorkActivity } from "../plugin/work-activity.ts";
import { safeRemoteMarkdown } from "./artifacts.ts";
import { receiptOwner, receiptPositions } from "./collaboration-timeline.ts";
import { delegationAnchor, isDelegationMessage } from "../shared/delegation.ts";
import {
  ItemView,
  addIcon,
  Notice,
  MarkdownRenderer,
  Component,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import type MobilePlugin from "./main.ts";
import { PairPhoneModal, renderPhoneSettings } from "./main.ts";
import { PhoneSheet } from "./sheet.ts";
import {
  iconButton,
  toolLabel,
} from "../plugin/ui-elements.ts";
import { PhoneAvatars } from "./avatar-sync.ts";
import { remoteId } from "../shared/mobile-wire.ts";
import { latestByAgent, toolSteps } from "../shared/conversation-ui.ts";
import { MarkdownCache } from "../plugin/markdown-cache.ts";
import { ConversationCache } from "./conversation-cache.ts";
import { DelegationFlow } from "../plugin/delegation-flow.ts";
import { readPhoneFile } from "./local-file.ts";
import { installContactEdgeFeedback } from "./contact-edge-feedback.ts";
import { SlashMenu } from "../plugin/slash-menu.ts";
import { handleSlashUI } from "../plugin/command-ui.ts";
import { CommandDraft } from "../plugin/command-draft.ts";
import { parseSlash } from "../shared/slash-commands.ts";
import { errorText } from "../shared/types.ts";
import { renderAssistantModel } from "./assistant-model.ts";
import { PhoneToday } from "./today-view.ts";
import type { AgentPermissions } from "../shared/permissions.ts";
import type {
  AgentRecord,
  Conversation,
  ConversationSummary,
  DelegationRecord,
  ToolEvent,
} from "../shared/types.ts";
import {
  describePreview,
  presentMessage,
  type Artifact,
  type ExpenseArtifact,
} from "./artifacts.ts";

export const MOBILE_VIEW = "pi-agent-mobile-chat";
const ATTACHMENT_TYPES = [
  ".md", ".canvas", ".base", ".txt", ".json", ".csv", ".tsv", ".yaml", ".yml",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  "image/png", "image/jpeg", "image/webp", "image/gif",
].join(",");
const sourceName = (source: string) =>
  ({ mobile: "手机", desktop: "电脑", weixin: "微信", delegation: "助手任务" })[
    source
  ] ?? source;
const safeMarkdown = safeRemoteMarkdown;
interface Outbox {
  command?: boolean;
  operationId: string;
  id: string;
  text: string;
  attachment?: { path: string; text: string; local?: boolean };
  image?: { name: string; data: string };
}

interface PendingSend {
  operation: Outbox;
  after: number;
  finished?: boolean;
  failed?: boolean;
}

export class MobileChatView extends ItemView {
  private agent?: AgentRecord;
  private conversation?: Conversation;
  private unsubscribe?: () => void;
  private header!: HTMLElement;
  private statusEl!: HTMLElement;
  private statusTitle!: HTMLElement;
  private statusText!: HTMLElement;
  private retryButton!: HTMLButtonElement;
  private scrollButton!: HTMLButtonElement;
  private settings?: HTMLElement;
  private disposeSettings?: () => void;
  private timeline!: HTMLElement;
  private footer!: HTMLElement;
  private responseStatus!: HTMLElement;
  private responseAvatar!: HTMLElement;
  private responseText!: HTMLElement;
  private responseAgentId?: string;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private slashMenu?: SlashMenu;
  private commandPending = false;
  private attachmentEl!: HTMLElement;
  private attachment?: { path: string; text: string; local?: boolean };
  private imageAttachment?: { name: string; data: string };
  private imageDrafts = new Map<string, { name: string; data: string }>();
  private homeFileInput!: HTMLInputElement;
  private fileSelectionVersion = 0;
  private generation = 0;
  private refreshVersion = 0;
  private closed = false;
  private sending = false;
  private limit = 60;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private streamTimer?: ReturnType<typeof setTimeout>;
  private streams = new Map<string, { text: string; seq: number; finished?: boolean }>();
  private streamNodes = new Map<string, Text>();
  private pendingSends = new Map<string, PendingSend>();
  private delegationViews = new Map<string, DelegationFlow>();
  private activityViews = new Map<string, WorkActivity>();
  private incoming: DelegationRecord[] = [];
  private incomingAgentId?: string;
  private incomingRevision = 0;
  private messagesComponent?: Component;
  private describing?: Promise<void>;
  private error = "";
  private home!: HTMLElement;
  private homeList!: HTMLElement;
  private homeContacts!: HTMLElement;
  private resetContactFeedback?: () => void;
  private homeSearch!: HTMLInputElement;
  private settingsTrigger?: HTMLElement;
  private homeDock!: HTMLElement;
  private homeInput!: HTMLTextAreaElement;
  private homeSend!: HTMLButtonElement;
  private homeSlash?: SlashMenu;
  private submittingFromHome = false;
  private homeMode = true;
  private summaries: ConversationSummary[] = [];
  private summariesLoaded = false;
  private prefetchRevision = 0;
  private conversationCache = new ConversationCache((id) =>
    this.plugin.client.call<Conversation>("conversation.get", { id, limit: 60 }),
  );
  private homeRevision = 0;
  private markdownCache: MarkdownCache;
  private avatars: PhoneAvatars;
  private today?: PhoneToday;
  private previousRunning?: boolean;
  private shownAttachment?: string;
  constructor(
    leaf: WorkspaceLeaf,
    readonly plugin: MobilePlugin,
  ) {
    super(leaf);
    this.markdownCache = this.addChild(new MarkdownCache(this.app));
    this.avatars = new PhoneAvatars(this.app, (agentId, version) =>
      this.plugin.client.call("agent.avatar", { agentId, version }),
    );
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
    addIcon(
      "pi-phone-obsidian",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 2.5 6.8 6.4 4.5 14.3 10.5 21.5l7.2-2.4 1.8-8.1zM13.5 2.5 11 11l-6.5 3.3M11 11l6.7 8.1M11 11l8.5 0"/></svg>',
    );
    this.closed = false;
    this.previousRunning = undefined;
    this.shownAttachment = undefined;
    const el = this.contentEl;
    el.empty();
    el.addClass("pi-agent-view", "pi-phone-view");
    this.today = new PhoneToday(el, this.app, this.plugin.client, (id) => {
      this.today?.close(false);
      void this.openConversation(id);
    }, (path, agentId) => void this.readNote(path, agentId), (parent) => {
      const manager = (this.plugin.client.description?.agents as AgentRecord[] | undefined)
        ?.find((agent) => agent.role === "manager");
      if (manager) this.avatars.render(parent, manager);
    });
    this.header = el.createDiv({ cls: "pi-chat-header pi-phone-header" });
    this.statusEl = el.createDiv({
      cls: "pi-phone-connection",
      attr: { role: "status", "aria-live": "polite" },
    });
    setIcon(this.statusEl.createSpan({ cls: "pi-phone-connection-icon", attr: { "aria-hidden": "true" } }), "circle-alert");
    const statusCopy = this.statusEl.createDiv({ cls: "pi-phone-connection-copy" });
    this.statusTitle = statusCopy.createEl("strong");
    this.statusText = statusCopy.createSpan();
    this.retryButton = this.statusEl.createEl("button", { text: "重试" });
    this.retryButton.addEventListener("click", () => void this.reconnect());
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
    this.homeContacts = this.homeList.createDiv({ cls: "pi-phone-home-contacts" });
    this.resetContactFeedback = installContactEdgeFeedback(this.homeList, this.homeContacts);
    this.homeDock = this.home.createDiv({ cls: "pi-phone-home-dock" });
    iconButton(
      this.homeDock,
      "pi-phone-obsidian",
      "返回 Obsidian 笔记",
      () => void this.plugin.leaveChat(),
      "pi-phone-round pi-phone-return",
    );
    const homeComposer = this.homeDock.createDiv({
      cls: "pi-chat-composer",
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
    if (this.homeSlash) this.removeChild(this.homeSlash);
    this.homeSlash = this.addChild(new SlashMenu(homeComposer, this.homeInput, (text) => {
      this.homeInput.value = text;
      void this.sendFromHome();
    }));
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
    this.responseStatus = el.createDiv({ cls: "pi-phone-response-status", attr: { role: "status", "aria-live": "polite" } });
    this.responseAvatar = this.responseStatus.createDiv({ cls: "pi-phone-response-avatar", attr: { "aria-hidden": "true" } });
    this.responseText = this.responseStatus.createSpan({ cls: "pi-phone-response-text" });
    this.responseStatus.hidden = true;
    this.footer = el.createDiv({ cls: "pi-composer-dock" });
    this.scrollButton = iconButton(
      this.footer, "arrow-down", "回到最新消息",
      () => { this.timeline.scrollTop = this.timeline.scrollHeight; },
      "pi-phone-round pi-phone-latest",
    );
    this.scrollButton.hidden = true;
    this.timeline.addEventListener("scroll", () => this.updateScrollButton());
    const composer = this.footer.createDiv({ cls: "pi-chat-composer" });
    this.attachmentEl = composer.createDiv({ cls: "pi-attachment-list" });
    const line = composer.createDiv({ cls: "pi-composer-line" });
    this.homeFileInput = this.createAttachmentInput(el);
    this.homeFileInput.hidden = true;
    const attachment = line.createDiv({ cls: "pi-phone-add-file" });
    setIcon(attachment.createSpan({ attr: { "aria-hidden": "true" } }), "plus");
    const picker = this.createAttachmentInput(attachment);
    // WebKit can anchor its native menu to this rendered input. Preserve the
    // editor's focus on press and let the input's normal click open the picker.
    const preserveEditor = (event: MouseEvent) => {
      if (event.button === 0 && el.ownerDocument.activeElement === this.input)
        event.preventDefault();
    };
    picker.addEventListener("pointerdown", preserveEditor);
    picker.addEventListener("mousedown", preserveEditor);
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
    this.today?.dispose();
    this.today = undefined;
    this.slashMenu?.close();
    this.homeSlash?.close();
    this.closeSettings();
    this.markdownCache.clear();
    this.closed = true;
    this.generation++;
    this.homeRevision++;
    this.prefetchRevision++;
    this.conversationCache.clear();
    this.clearCollaboration();
    this.saveDraft();
    this.unsubscribe?.();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.streamTimer);
    this.messagesComponent?.unload();
  }
  private welcome() {
    this.today?.close(false);
    this.setScreen(true);
    this.resetContactFeedback?.();
    this.homeContacts.empty();
    this.homeList.empty();
    this.timeline.empty();
    this.homeSearch.value = "";
    this.homeSearch.parentElement!.hidden = true;
    const welcome = this.homeList.createDiv({ cls: "pi-phone-welcome" });
    const manager = {
      avatar: "builtin:coordinator",
      name: "总管",
    } as AgentRecord;
    this.avatars.render(welcome, manager);
    welcome.createEl("h2", { text: "你的助手，随时聊" });
    welcome.createEl("p", {
      cls: "pi-muted",
      text: "连接电脑后，即可在手机上与你的知识库助手对话、跟进任务与阅读笔记。",
    });
    const actions = welcome.createDiv({ cls: "pi-phone-welcome-actions" });
    actions
      .createEl("button", { text: "连接我的电脑", cls: "mod-cta" })
      .addEventListener("click", () => new PairPhoneModal(this.plugin).open());
    if (!this.plugin.client.credential) {
      actions.createEl("button", { text: "返回 Obsidian" })
        .addEventListener("click", () => void this.plugin.leaveChat());
    }
  }
  private async reconnect() {
    const { client } = this.plugin;
    this.error = "";
    this.controls();
    if (!client.connected && client.credential) {
      this.retryButton.disabled = true;
      try {
        await client.connect(client.credential);
      } catch (error) {
        this.fail(error);
      } finally {
        this.retryButton.disabled = false;
      }
    }
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
    this.header.empty();
    this.header.hidden = this.homeMode && !this.plugin.client.description;
    if (this.header.hidden) return;
    if (this.homeMode) {
      const account = iconButton(
        this.header,
        "user-round",
        "设置与电脑连接",
        () => this.homeMenu(),
        "pi-phone-round pi-phone-account pi-phone-host",
      );
      const icon = account.firstElementChild;
      if (icon) account.createSpan({ cls: "pi-phone-account-disc" }).append(icon);
      iconButton(
        this.header,
        "plus",
        "查找助手或开始新聊天",
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
    if (this.agent) this.avatars.render(identity, this.agent);
    const copy = identity.createSpan({ cls: "pi-phone-identity-copy" });
    copy.createEl("strong", { text: this.agent?.name ?? "Obot" });
    const status = copy.createSpan({ cls: "pi-phone-identity-status" });
    status.createSpan({ cls: "pi-phone-live-dot", attr: { "aria-hidden": "true" } });
    status.createSpan({ text: "正在处理…" });
    setIcon(identity.createSpan({ cls: "pi-phone-identity-chevron" }), "chevron-down");
    identity.addEventListener("click", () => this.chatMenu());
    iconButton(
      this.header,
      "monitor",
      "电脑连接与状态",
      () => this.connectionInfo(),
      "pi-phone-round pi-phone-host",
    );
  }
  private controls() {
    if (!this.statusEl) return;
    const client = this.plugin.client;
    const offline = !client.connected && Boolean(client.credential);
    this.statusTitle.setText(offline ? "电脑连接已断开" : "操作未完成");
    const status = this.error || client.status;
    if (this.statusText.textContent !== status) this.statusText.setText(status);
    this.statusText.hidden = status === this.statusTitle.textContent;
    this.statusEl.hidden =
      !this.error &&
      (client.connected || (this.homeMode && !client.credential));
    this.retryButton.hidden = client.connected || !client.credential;
    const host = this.header.querySelector(".pi-phone-host");
    host?.classList.toggle("is-connected", client.connected);
    host?.setAttribute("title", client.status);
    const identityStatus = this.header.querySelector<HTMLElement>(".pi-phone-identity-status");
    if (identityStatus) identityStatus.hidden = this.conversation?.status !== "running";
    const running = this.conversation?.status === "running";
    this.updateResponseStatus();
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
      (!running && this.pendingSends.has(this.conversation.id) && !this.outbox()) ||
      Boolean(this.conversation.archive) ||
      (!running && !this.input.value.trim() && !this.attachment && !this.imageAttachment && !this.outbox());
    this.input.disabled = this.sending;
    this.input.placeholder = this.conversation?.archive
      ? "已归档，点助手名开始新聊天"
      : "问问" + (this.agent?.name ?? "助手") + "…";
    if (this.homeDock)
      this.homeDock.hidden = !this.plugin.client.description || !this.homeMode;
    if (this.homeInput && this.homeSend) {
      const agent = this.composerAgent();
      const homePlaceholder = agent
        ? "问问" + agent.name + "…"
        : "连接电脑后即可发送";
      if (this.homeInput.placeholder !== homePlaceholder)
        this.homeInput.placeholder = homePlaceholder;
      this.homeInput.disabled = this.submittingFromHome;
      this.homeSend.disabled =
        !client.connected || this.sending || this.submittingFromHome || !agent || !this.homeInput.value.trim();
      this.homeSend.setAttribute(
        "aria-label",
        agent ? "发送给" + agent.name : "发送",
      );
    }
    const attachmentName = this.imageAttachment?.name ?? this.attachment?.path ?? "";
    if (this.shownAttachment === attachmentName) return;
    this.shownAttachment = attachmentName;
    this.attachmentEl.empty();
    if (attachmentName) {
      const button = this.attachmentEl.createEl("button", {
        text: "本地文件 · " + attachmentName + " ×",
        cls: "pi-text-button",
      });
      button.addEventListener("click", () => {
        this.attachment = undefined;
        this.imageAttachment = undefined;
        this.saveDraft();
        this.controls();
      });
    }
  }
  private draftKey(id = this.conversation?.id) {
    return this.plugin.localKey("draft:" + id);
  }
  private saveDraft() {
    if (this.conversation && this.input) {
      if (this.imageAttachment) this.imageDrafts.set(this.conversation.id, this.imageAttachment);
      else this.imageDrafts.delete(this.conversation.id);
      this.app.saveLocalStorage(this.draftKey(), {
        text: this.input.value,
        attachment: this.attachment,
      });
    }
  }
  private outbox(): Outbox | undefined {
    return this.conversation
      ? (this.app.loadLocalStorage(
          this.plugin.localKey("outbox:" + this.conversation.id),
        ) ?? undefined)
      : undefined;
  }
  private createAttachmentInput(parent: HTMLElement) {
    const input = parent.createEl("input", {
      type: "file",
      attr: { accept: ATTACHMENT_TYPES, "aria-label": "添加附件" },
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.attachLocalFile(file);
    });
    return input;
  }
  private async attachLocalFile(file: File) {
    const selection = ++this.fileSelectionVersion;
    const generation = this.generation;
    const wasHome = this.homeMode;
    const homeText = wasHome ? this.homeInput.value : "";
    try {
      const value = await readPhoneFile(file);
      if (value.kind === "text" && value.text.endsWith("[附件内容过长，已截断；不能将片段当作完整文件。]"))
        new Notice("文件较长，本次只发送前 80000 个字符。");
      if (this.closed || selection !== this.fileSelectionVersion || generation !== this.generation || this.homeMode !== wasHome) return;
      if (value.kind === "image" && !this.plugin.client.description?.mobileImageUpload)
        throw Error("请先更新电脑端 Obot，才能发送手机图片");
      if (wasHome) {
        const agent = this.composerAgent();
        if (!agent || !this.plugin.client.connected) throw Error("请先连接电脑并选择助手");
        await this.selectAgent(agent);
        if (selection !== this.fileSelectionVersion || !this.conversation || this.homeMode || this.agent?.id !== agent.id) return;
        if (homeText && this.homeInput.value === homeText) {
          this.input.value = [this.input.value, homeText].filter(Boolean).join("\n");
          this.homeInput.value = "";
          this.resizeHomeInput();
          this.resizeInput();
        }
      }
      if (!this.conversation) throw Error("请先打开聊天");
      this.attachment = value.kind === "text" ? { path: value.name, text: value.text, local: true } : undefined;
      this.imageAttachment = value.kind === "image" ? { name: value.name, data: value.data } : undefined;
      this.saveDraft();
      this.controls();
    } catch (error) {
      if (selection === this.fileSelectionVersion) this.fail("无法添加文件：" + errorText(error));
    }
  }
  private async selectAgent(agent: AgentRecord, fresh = false) {
    this.saveDraft();
    this.agent = agent;
    this.setScreen(false);
    this.conversation = undefined;
    this.input.value = "";
    this.attachment = undefined;
    this.imageAttachment = undefined;
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
      const list = this.summariesLoaded
        ? this.summaries.filter((item) => item.agentId === agent.id && !item.archive)
        : await this.plugin.client.call<ConversationSummary[]>(
            "conversation.list", { agentId: agent.id },
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
    this.imageAttachment = undefined;
    const generation = ++this.generation;
    try {
      const cached = this.conversationCache.get(id);
      const conversation = cached ?? await this.conversationCache.load(id);
      if (this.closed || generation !== this.generation) return;
      const previousId = this.conversation?.id;
      this.conversation = conversation;
      if(previousId !== id || this.incomingAgentId !== conversation.agentId){this.clearCollaboration();this.incomingAgentId=conversation.agentId;}
      this.imageAttachment = this.imageDrafts.get(id);
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
      void this.refreshIncoming(conversation.agentId,generation);
      if (cached) void this.refreshConversation();
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
      if (carry && this.conversation?.id === item.id && !this.homeMode) {
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
    const stream = this.streams.get(id);
    const pending = this.pendingSends.get(id);
    const pendingFinished = pending?.finished;
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
      if (this.limit <= 60) this.conversationCache.put(value);
      if (stream?.finished && this.streams.get(id) === stream && value.status !== "running")
        this.streams.delete(id);
      if (pending && pendingFinished && this.pendingSends.get(id) === pending) {
        this.pendingSends.delete(id);
        if (pending.failed && !this.confirmedPendingSend(value, pending) && !this.input.value.trim()) {
          this.input.value = pending.operation.text;
          this.attachment = pending.operation.attachment;
          this.imageAttachment = pending.operation.image;
          this.resizeInput();
          this.saveDraft();
        }
      }
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
  refreshAvatars() {
    const agents = this.plugin.client.description?.agents;
    if (this.closed || !agents) return;
    if (this.agent) {
      const current = agents.find((agent: AgentRecord) => agent.id === this.agent?.id);
      if (current) this.agent = current;
    }
    this.avatars.refresh(this.contentEl, agents);
  }
  private onEvent(event: any) {
    if (this.closed) return;
    if (event.type === "tool.event" && this.today?.isOpen) this.today.refresh();
    if (event.type === "connection") {
      this.today?.refresh();
      if (this.plugin.client.connected) this.refreshAvatars();
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
      this.conversationCache.clear();
      this.summariesLoaded = false;
      this.streams.clear();
      for (const stream of event.streams ?? [])
        this.streams.set(stream.conversationId, stream);
      const id = this.conversation?.id;
      if (id && !this.homeMode && this.streams.get(id)?.text) {
        this.ensureStreamNode(id);
        this.flushStreams();
        this.scheduleStream();
      }
      const pending = id && this.pendingSends.get(id);
      if (pending && !pending.finished)
        void this.plugin.client.call("operation.get", { id: pending.operation.operationId })
          .then((operation) => this.onEvent({ type: "remote.operation", operation }))
          .catch(() => {});
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
      const previousText = before?.finished ? "" : before?.text ?? "";
      this.streams.set(event.conversationId, {
        text: previousText + event.delta,
        seq: event.remoteSequence,
      });
      if (!this.homeMode && event.conversationId === this.conversation?.id &&
          !previousText.trim() && event.delta.trim()) {
        this.ensureStreamNode(event.conversationId);
        this.flushStreams();
      }
      if (event.conversationId === this.conversation?.id) this.updateResponseStatus();
      if (
        !this.homeMode &&
        (this.streamNodes.has(event.conversationId) || this.delegationViews.has(event.conversationId)) &&
        !this.streamTimer
      )
        this.scheduleStream();
    } else if (event.type === "conversation.changed") {
      if(event.agentId===this.agent?.id && event.source==="delegation") void this.refreshIncoming(event.agentId,this.generation);
      this.conversationCache.invalidate(event.id);
      // Keep the current stream visible until its final conversation is fetched.
      const stream = this.streams.get(event.id);
      if (stream && event.status !== "running") {
        if (event.id !== this.conversation?.id) this.streams.delete(event.id);
        else this.streams.set(event.id, { ...stream, finished: true });
      }
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
      const conversation = this.conversation!;
      const follow = this.timeline.scrollHeight - this.timeline.scrollTop - this.timeline.clientHeight < 100;
      conversation.events.push(event);
      this.updateResponseStatus();
      const key = conversation.id + ":" + (event.messageIndex ?? "legacy");
      const view = this.activityViews.get(key);
      if (view?.el.isConnected) {
        const index = event.messageIndex;
        const steps = toolSteps(conversation.events.filter(item => item.messageIndex === index &&
          !(conversation.delegations?.some(record => record.messageIndex === index) &&
            (item.name === "delegate_task" || item.name.startsWith("delegate:")))));
        this.updateActivity(view, steps, index,
          ((conversation as any).messageOffset ?? 0) + conversation.messages.findLastIndex(message => message.role === "user"));
        if (follow) this.timeline.scrollTop = this.timeline.scrollHeight;
      } else this.queueRefresh();
    } else if (
      event.type === "remote.operation"
    ) {
      const pending = this.pendingSends.get(event.operation.conversationId);
      if (pending && pending.operation.operationId === event.operation.id &&
          event.operation.status !== "accepted") {
        pending.finished = true;
        pending.failed = event.operation.status === "failed";
      }
      if (event.operation.conversationId !== this.conversation?.id) return;
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
          if (this.closed) return;
          this.refreshAvatars();
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
    const wanted=new Set([...(c.delegations??[]).map(r=>r.conversationId),...this.incoming.map(r=>r.conversationId)]);
    for(const [id,view] of this.delegationViews)if(!wanted.has(id)){view.dispose();this.delegationViews.delete(id);}
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
    const shownStream = this.streamNodes.get(c.id)?.data;
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
    if (pending && !this.sending) {
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
    if (!c.messages.length && !this.incoming.length && !c.parent && !c.archive && c.status !== "running" && this.agent) {
      const empty = this.timeline.createDiv({ cls: "pi-phone-chat-empty" });
      this.avatars.render(empty, this.agent);
      empty.createEl("h3", { text: "和" + this.agent.name + "聊聊" });
      if (this.agent.description) empty.createEl("p", { text: this.agent.description });
    }
    if (offset + start === 0 && eventGroups.has(undefined))
      this.renderActivity(
        eventGroups.get(undefined)!,
        undefined,
        activeIndex,
      );
    const incoming = !c.background && !c.execution ? receiptPositions(c.messages, this.incoming) : [];
    for (let index = start; index < c.messages.length; index++) {
      for (const item of incoming) if (item.index === index || (index === start && item.index < start)) this.delegation(item.record, retained, true);
      const message = c.messages[index];
      if (isDelegationMessage(message, c, offset + index)) continue;
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
      else {
        this.renderRichText(
          row,
          String(index + ((c as any).messageOffset ?? 0)),
          message.text,
          events ?? [],
          retained,
          message.at,
        );
        if (message.text.trim()) {
          const copy = iconButton(row, "copy", "复制回复", async () => {
            try {
              await navigator.clipboard.writeText(message.text);
              new Notice("已复制回复");
            } catch (error) {
              new Notice("无法复制回复：" + errorText(error));
            }
          }, "pi-phone-copy");
          copy.createSpan({ text: "复制", attr: { "aria-hidden": "true" } });
        }
      }
      if (message.role === "user" && message.localAttachmentName)
        row.createDiv({ cls: "pi-muted", text: "本地文件 · " + message.localAttachmentName });
      if (message.role === "user" && message.imageCount)
        row.createDiv({ cls: "pi-muted", text: "图片 · " + message.imageCount + " 张" });
      if (events?.length)
        this.renderActivity(events, offset + index, activeIndex);
      for (const record of c.delegations ?? [])
        if (delegationAnchor({ ...record, messageIndex: record.messageIndex - offset }, c.messages) === index)
          this.delegation(record, retained);
    }
    for (const item of incoming) if (item.index === c.messages.length) this.delegation(item.record, retained, true);
    this.renderPendingSend();
    if (c.status === "running" || this.streams.get(c.id)?.text) {
      const stream = this.streams.get(c.id)?.text;
      const node = this.ensureStreamNode(c.id, stream?.startsWith(shownStream ?? "") ? shownStream : undefined);
      if (stream && !node.data.trim()) this.flushStreams();
      if (stream) this.scheduleStream();
    }
    this.timeline.createDiv({
      cls: "pi-phone-result-status",
      text: {
        idle: "",
        running: "",
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
    this.updateScrollButton();
  }
  private updateScrollButton() {
    this.scrollButton.hidden = this.homeMode ||
      this.timeline.scrollHeight - this.timeline.scrollTop - this.timeline.clientHeight <= 100;
  }
  private renderActivity(events: ToolEvent[], index: number | undefined, activeIndex: number) {
    const conversation = this.conversation!;
    const key = conversation.id + ":" + (index ?? "legacy");
    let view = this.activityViews.get(key);
    if (!view) {
      view = new WorkActivity(this.timeline);
      this.activityViews.set(key, view);
    } else this.timeline.appendChild(view.el);
    this.updateActivity(view, toolSteps(events), index, activeIndex);
  }
  private updateActivity(view: WorkActivity, steps: ToolEvent[], index: number | undefined, activeIndex: number) {
    const conversation = this.conversation!;
    const active = index !== undefined && index === activeIndex && conversation.status === "running";
    view.update(steps, {
      activeTask: active ? steps.at(-1)?.taskId : undefined,
      cancelled: conversation.status === "cancelled",
      legacy: index === undefined,
      openFile: path => /\.(md|markdown|canvas|base)$/i.test(path) ? () => void this.readNote(path) : undefined,
    });
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
  private clearCollaboration() {
    for(const view of this.delegationViews.values())view.dispose();
    this.delegationViews.clear();this.activityViews.clear();this.incoming=[];this.incomingAgentId=undefined;this.incomingRevision++;
  }
  private async refreshIncoming(agentId:string,generation:number) {
    const revision = ++this.incomingRevision;
    const conversation = this.conversation;
    if (!conversation || conversation.background || conversation.execution) return;
    try {
      const list=await this.plugin.client.call<ConversationSummary[]>("conversation.list",{agentId,includeBackground:true});
      if(this.closed||generation!==this.generation||revision!==this.incomingRevision||this.agent?.id!==agentId)return;
      const startKey = this.plugin.localKey("collaboration-start:" + conversation.id);
      const storedStart = this.app.loadLocalStorage(startKey);
      const startedAt = storedStart || conversation.messages[0]?.at || conversation.updatedAt;
      if (!storedStart) this.app.saveLocalStorage(startKey, startedAt);
      this.incoming=list.filter(c=>c.source==="delegation"&&c.parent&&c.parent.agentId!==agentId&&!c.archive)
        .filter(c => {
          const key = this.plugin.localKey("collaboration-owner:" + c.id);
          const owner = this.app.loadLocalStorage(key);
          const chosen = receiptOwner(owner?.conversationId, conversation.id, startedAt, owner?.at ?? c.updatedAt);
          if (!owner && chosen) this.app.saveLocalStorage(key, { conversationId: chosen, at: c.updatedAt });
          return chosen === conversation.id;
        })
        .slice(0,30).reverse().map(c=>({conversationId:c.id,parentConversationId:c.parent!.conversationId,messageIndex:c.parent!.messageIndex,
          fromAgentId:c.parent!.agentId,toAgentId:agentId,task:"",summary:c.title,messageCount:c.messageCount,
          status:c.status==="running"?"running":c.status==="failed"?"failed":c.status==="cancelled"?"cancelled":c.messageCount===0?"queued":"completed",updatedAt:this.app.loadLocalStorage(this.plugin.localKey("collaboration-owner:" + c.id))?.at ?? c.updatedAt}));
      this.renderMessages();
    } catch { /* Older desktop versions may not expose background records. */ }
  }
  private delegation(record: DelegationRecord, _retained: Set<string>, receiver=false) {
    let view=this.delegationViews.get(record.conversationId);
    if(!view){
      view=new DelegationFlow(this.timeline,this,{
        app:this.app,viewerAgentId:receiver?this.agent?.id:undefined,
        agents:()=>this.plugin.client.description.agents as AgentRecord[],
        avatar:(el,agent)=>{this.avatars.render(el, agent);},
        load:(id,before)=>this.plugin.client.call("conversation.get",{id,limit:60,...(before===undefined?{}:{before})}),
        subscribe:(listener)=>this.plugin.client.subscribe(listener),
        render:(text,el,owner)=>MarkdownRenderer.render(this.app,safeMarkdown(text),el,"",owner).catch(()=>el.setText(text)),
      },record);
      this.delegationViews.set(record.conversationId,view);
      if(receiver){const date=new Date(record.updatedAt);if(!Number.isNaN(date.getTime()))view.el.prepend(view.el.createDiv({cls:"pi-phone-date",text:this.messageStamp(date)}));}
    } else {this.timeline.appendChild(view.el);view.update(record);}
    const text=this.streams.get(record.conversationId)?.text;if(text)view.stream(text);
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
  private updateResponseStatus() {
    if (!this.responseStatus) return;
    const c = this.conversation;
    const visible = !this.homeMode && c?.status === "running" && !!this.agent;
    this.responseStatus.hidden = !visible;
    if (!visible || !c || !this.agent) return;
    if (this.responseAgentId !== this.agent.id) {
      this.responseAvatar.empty();
      this.avatars.render(this.responseAvatar, this.agent);
      this.responseAgentId = this.agent.id;
    }
    const live = toolSteps(c.events).reverse().find(event => event.status === "running" &&
      (event.messageIndex === undefined || event.messageIndex === ((c as any).messageOffset ?? 0) + c.messages.findLastIndex(message => message.role === "user")));
    const label = live ? "正在" + toolLabel(live.name) + "…" : this.streams.get(c.id)?.text ? "正在回复…" : "正在处理…";
    if (this.responseText.textContent !== label) this.responseText.setText(label);
  }
  private scheduleStream() {
    if (this.streamTimer || this.closed) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined;
      if (this.flushStreams()) this.scheduleStream();
    }, 16);
  }
  private flushStreams() {
    const follow = this.timeline.scrollHeight - this.timeline.scrollTop - this.timeline.clientHeight < 100;
    let pending = false, changed = false;
    for (const [id, node] of this.streamNodes) {
      const text = this.streams.get(id)?.text;
      if (text === undefined || !node.isConnected) continue;
      const frame = streamFrame(text, node.data);
      if (frame.value !== node.data) {
        if (frame.value && node.parentElement?.parentElement) node.parentElement.parentElement.hidden = false;
        if (frame.value.startsWith(node.data)) node.appendData(frame.value.slice(node.length));
        else node.data = frame.value;
        changed = true;
      }
      pending ||= frame.pending;
    }
    for (const [id, view] of this.delegationViews) {
      const text = this.streams.get(id)?.text;
      if (text) view.stream(text);
    }
    if (changed && follow) this.timeline.scrollTop = this.timeline.scrollHeight;
    if (changed) this.updateScrollButton();
    return pending;
  }
  private ensureStreamNode(id: string, text = "") {
    const existing = this.streamNodes.get(id);
    if (existing?.isConnected) return existing;
    const row = this.timeline.createDiv({ cls: "pi-message pi-message-assistant" });
    row.hidden = !text;
    this.timeline.querySelector(".pi-phone-result-status")?.before(row);
    const bubble = row.createDiv({ cls: "pi-message-bubble pi-phone-stream" });
    const node = this.timeline.ownerDocument.createTextNode(text);
    bubble.appendChild(node);
    this.streamNodes.set(id, node);
    return node;
  }
  private confirmedPendingSend(c: Conversation, pending: PendingSend) {
    const { operation, after } = pending;
    const offset = (c as Conversation & { messageOffset?: number }).messageOffset ?? 0;
    return c.messages.some((message, index) =>
      message.role === "user" &&
      (message.mobileOperationId === operation.operationId ||
        (!this.plugin.client.description?.mobileOperationIds &&
          !message.mobileOperationId && offset + index >= after &&
          message.origin === "mobile" &&
          (message.text === operation.text ||
            (!!operation.attachment && message.text.startsWith(operation.text + "\n\n"))))),
    );
  }
  private renderPendingSend(follow = false) {
    const c = this.conversation;
    if (!c) return;
    const pending = this.pendingSends.get(c.id);
    if (!pending) return;
    if (this.confirmedPendingSend(c, pending)) {
      this.pendingSends.delete(c.id);
      return;
    }
    const row = this.timeline.createDiv({ cls: "pi-message pi-message-user" });
    row.createDiv({ cls: "pi-message-bubble markdown-rendered", text: pending.operation.text });
    const streamRow = this.streamNodes.get(c.id)?.parentElement?.parentElement;
    const status = this.timeline.querySelector(".pi-phone-result-status");
    (streamRow ?? status)?.before(row);
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
    if (!this.conversation || this.sending || this.homeMode) return;
    const id = this.conversation.id, generation = this.generation;
    if (this.conversation.status === "running" && !skipCommand) {
      try {
        await this.plugin.client.mutation("chat.cancel", { id });
        this.queueRefresh();
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    const command = parseSlash(this.input.value.trim());
    if (!skipCommand && command && !command.name.startsWith("skill:") &&
        (await this.runSlash(this.input.value.trim()))) return;
    if (this.sending || this.closed || this.generation !== generation || this.conversation?.id !== id)
      return;
    if (this.conversation.archive) return;
    const pending = this.outbox();
    if (!pending && this.pendingSends.has(id)) return;
    if (!pending && !(commandText ?? this.input.value.trim()) && !this.attachment && !this.imageAttachment) return;
    const operation: Outbox = pending ?? {
      operationId: remoteId(),
      id,
      text: commandText ?? (this.input.value.trim() || "请查看附件。"),
      attachment: commandText ? undefined : this.attachment,
      image: commandText ? undefined : this.imageAttachment,
      command: Boolean(commandText),
    };
    if (
      operation.text.length + (operation.attachment?.text.length ?? 0) >
      99_000
    ) {
      this.fail("消息与笔记过长，请精简后重试");
      return;
    }
    try {
      this.saveDraft();
      this.app.saveLocalStorage(this.plugin.localKey("outbox:" + id), operation);
    } catch (error) {
      this.fail("未能保存待发送内容，请检查手机存储空间：" + errorText(error));
      return;
    }
    this.sending = true;
    this.error = "";
    if (!operation.command && !this.pendingSends.has(id)) {
      const offset = (this.conversation as Conversation & { messageOffset?: number }).messageOffset ?? 0;
      this.pendingSends.set(id, { operation, after: offset + this.conversation.messages.length });
      this.renderPendingSend(true);
    }
    this.controls();
    try {
      const result = await this.plugin.client.mutation(
        "chat.submit",
        { id, text: operation.text, attachment: operation.attachment, image: operation.image },
        operation.operationId,
      );
      if (result.status === "failed" || result.status === "uncertain")
        throw Error(result.error || "任务结果待确认，请查看历史");
      this.accepted(operation);
      if (result.status === "completed") {
        const local = this.pendingSends.get(id);
        if (local?.operation.operationId === operation.operationId) local.finished = true;
      }
      if (!this.closed && this.conversation?.id === id && !this.homeMode)
        await this.refreshConversation();
    } catch (e) {
      this.pendingSends.delete(id);
      this.sending = false;
      if (!this.closed && this.conversation?.id === id) {
        this.fail(e);
        this.renderMessages();
      }
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
      (this.input.value.trim() === operation.text ||
        (!this.input.value.trim() && operation.text === "请查看附件。"))
    ) {
      this.input.value = "";
      this.resizeInput();
      if (!operation.command) this.attachment = undefined;
      if (!operation.command) this.imageAttachment = undefined;
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
      Math.min(120, Math.max(38, this.input.scrollHeight)) + "px";
  }
  private setScreen(home: boolean) {
    this.slashMenu?.close();
    this.homeSlash?.close();
    if(home)for(const view of this.delegationViews.values())view.closeDetail(true);
    this.homeMode = home;
    if (!home) {
      this.resetContactFeedback?.();
      this.today?.close(false);
    }
    this.updateResponseStatus();
    this.home.hidden = !home;
    this.timeline.hidden = home;
    this.footer.hidden = home;
    this.contentEl.toggleClass("is-home", home);
    this.updateScrollButton();
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
  navigateBack() {
    for(const view of this.delegationViews.values())if(view.closeDetail())return;
    // Overlays are above the chat and must close before navigating the page.
    const modal = Array.from(document.querySelectorAll<HTMLElement>(".modal-container"))
      .filter((el) => el.isConnected && !el.hidden).pop();
    if (modal) {
      modal.querySelector<HTMLElement>(".modal-close-button, .modal-header-button")?.click();
      return;
    }
    if (this.settings) {
      this.closeSettings();
      return;
    }
    if (this.today?.navigateBack()) return;
    const menu = document.querySelector<HTMLElement>(".menu");
    if (menu) {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return;
    }
    if (this.contentEl.querySelector(".pi-slash-menu:not([hidden])")) {
      this.slashMenu?.close();
      this.homeSlash?.close();
      return;
    }
    if (!this.homeMode) {
      void this.showHome();
      return;
    }
    if (!this.homeSearch.parentElement?.hidden) {
      this.homeSearch.value = "";
      this.homeSearch.parentElement!.hidden = true;
      this.renderHome();
    }
  }
  private async refreshHome() {
    this.today?.refresh();
    const revision = ++this.homeRevision;
    try {
      const list =
        await this.plugin.client.call<ConversationSummary[]>(
          "conversation.list",
        );
      if (this.closed || revision !== this.homeRevision) return;
      this.summaries = list;
      this.summariesLoaded = true;
      if (this.homeMode) this.renderHome();
      this.prefetchRecent(list);
    } catch (error) {
      if (revision === this.homeRevision && this.homeMode) this.fail(error);
    }
  }
  private prefetchRecent(list: ConversationSummary[]) {
    const revision = ++this.prefetchRevision;
    const latest = [...latestByAgent(list).values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const ids = latest.map((item) => {
      const selected = this.app.loadLocalStorage(this.plugin.localKey("selected:" + item.agentId));
      return list.find((entry) => entry.id === selected && entry.agentId === item.agentId && !entry.archive)?.id ?? item.id;
    }).slice(0, 12);
    let index = 0;
    const worker = async () => {
      while (!this.closed && revision === this.prefetchRevision && index < ids.length) {
        const id = ids[index++];
        try { await this.conversationCache.load(id); } catch { /* A tap will retry. */ }
      }
    };
    for (let n = 0; n < Math.min(3, ids.length); n++) void worker();
  }
  private renderHome() {
    if (!this.homeList) return;
    if (this.homeContacts.parentElement !== this.homeList) {
      this.homeList.empty();
      this.homeList.append(this.homeContacts);
    }
    this.homeContacts.empty();
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
    if (!query && pinned.length) this.renderPins(pinned, latest);
    const featuredIds = new Set(query ? [] : pinned.map((agent) => agent.id));
    const rows = this.homeContacts.createDiv({
      cls: "pi-phone-recent",
      attr: { "aria-label": "通讯录" },
    });
    if (!query) this.today?.entry(rows);
    const matches = agents.filter(
      (agent) =>
        !featuredIds.has(agent.id) && (!query ||
        [agent.name, agent.description, agent.scope, latest(agent.id)?.preview ?? ""]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
    );
    const recent = matches
      .filter((agent) => latest(agent.id))
      .sort((a, b) =>
        latest(b.id)!.updatedAt.localeCompare(latest(a.id)!.updatedAt),
      );
    const others = matches.filter((agent) => !latest(agent.id));
    for (const agent of [...recent, ...others])
      this.renderContact(rows, agent, latest(agent.id), pinned);
    if (query && !matches.length)
      rows.createDiv({
        cls: "pi-phone-empty",
        text: "没有找到，试试助手名字或聊天内容。",
      });
    if (!agents.length)
      rows.createDiv({
        cls: "pi-phone-empty",
        text: "还没有助手，请先在电脑打开 Obot。",
      });
    this.controls();
  }
  private renderPins(
    featured: AgentRecord[],
    latest: (id: string) => ConversationSummary | undefined,
  ) {
    const grid = this.homeContacts.createDiv({
      cls: "pi-phone-favorites",
      attr: { "aria-label": "固定助手，长按调整", "data-count": String(featured.length) },
    });
    for (const [index, agent] of featured.entries()) {
      const running = latest(agent.id)?.status === "running";
      const button = grid.createEl("button", {
        cls: "pi-phone-favorite",
        attr: {
          type: "button",
          "aria-label": "与" + agent.name + "聊天，长按调整固定" + (running ? "，正在处理" : ""),
        },
      });
      const avatar = button.createSpan({ cls: "pi-phone-pin-avatar" });
      this.avatars.render(avatar, agent);
      if (index === 0)
        setIcon(avatar.createSpan({ cls: "pi-phone-pin-star", attr: { "aria-hidden": "true" } }), "star");
      avatar.classList.toggle("is-running", running);
      button.createSpan({ cls: "pi-pin-name", text: agent.name });
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
    const running = summary?.status === "running";
    const preview = running
      ? "正在处理…"
      : brief?.preview || agent.description ||
        (agent.scope ? "负责 " + agent.scope : "帮你处理笔记与日常任务");
    const button = parent.createEl("button", {
      cls: "pi-phone-contact",
      attr: { type: "button", "aria-label": "与" + agent.name + "聊天" },
    });
    button.dataset.agentId = agent.id;
    this.avatars.render(button, agent);
    const body = button.createDiv({ cls: "pi-phone-contact-body" });
    const title = body.createDiv({ cls: "pi-phone-contact-title" });
    title.createEl("strong", { text: agent.name });
    if (summary)
      title.createEl("time", {
        text: this.relativeTime(summary.updatedAt),
        attr: { datetime: summary.updatedAt },
      });
    const detail = body.createDiv({ cls: "pi-phone-contact-preview" });
    if (running) {
      detail.addClass("is-running");
      detail.createSpan({ cls: "pi-phone-live-dot", attr: { "aria-hidden": "true" } });
    }
    detail.createSpan({ text: preview });
    this.pinGesture(button, agent, pinned);
    button.addEventListener("click", () => void this.selectAgent(agent));
  }
  private composerAgent() {
    const agents = (this.plugin.client.description?.agents ?? []) as AgentRecord[];
    return this.pinnedAgents(agents)[0] ?? agents.find((agent) => agent.role === "manager") ?? agents[0];
  }
  private resizeHomeInput() {
    if (!this.homeInput) return;
    this.homeInput.style.height = "auto";
    this.homeInput.style.height =
      Math.min(120, Math.max(38, this.homeInput.scrollHeight)) + "px";
  }
  private async sendFromHome() {
    const text = this.homeInput.value.trim();
    const agent = this.composerAgent();
    if (!text || !agent || this.sending || this.submittingFromHome || !this.plugin.client.connected) return;
    this.submittingFromHome = true;
    this.homeSlash?.close();
    this.controls();
    try {
      await this.selectAgent(agent);
      const conversation = this.conversation;
      if (this.closed || this.homeMode || !conversation || conversation.agentId !== agent.id) return;
      const existingDraft = this.input.value.trim();
      this.input.value = [this.input.value, text].filter(Boolean).join("\n");
      this.saveDraft();
      this.homeInput.value = "";
      this.resizeInput();
      if (!existingDraft && !conversation.archive && conversation.status !== "running" && !this.outbox())
        await this.sendOrStop();
    } finally {
      this.submittingFromHome = false;
      this.resizeHomeInput();
      this.controls();
    }
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
          .slice(0, 1)
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
  private pinMenu(agent: AgentRecord, featured: AgentRecord[]) {
    const sheet = new PhoneSheet(this.app, agent.name);
    const ids = featured.map((item) => item.id);
    if (ids.includes(agent.id)) {
      sheet.action("pin-off", "取消固定到顶部", () => this.savePins(ids.filter((id) => id !== agent.id)));
    } else if (ids.length < 3) {
      sheet.action("pin", "固定到顶部", () => this.savePins([...ids, agent.id]));
    } else {
      featured.forEach((current, index) => {
        sheet.action("pin", "替换「" + current.name + "」", () =>
          this.savePins(ids.map((id, i) => i === index ? agent.id : id)));
      });
    }
    sheet.open();
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
    const open = () => {
      cancel();
      suppressClick = true;
      if (button.isConnected && !this.closed)
        this.pinMenu(agent, featured);
    };
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!suppressClick) open();
    });
    button.addEventListener("pointerdown", (event) => {
      cancel();
      suppressClick = false;
      if (event.pointerType === "mouse" || event.button !== 0) return;
      x = event.clientX;
      y = event.clientY;
      timer = setTimeout(open, 500);
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
  private chatMenu() {
    const sheet = new PhoneSheet(this.app, this.agent?.name ?? "聊天操作");
    sheet.action("square-pen", "新聊天", () => void this.newConversation());
    sheet.action("history", "聊天历史与归档", () => this.history());
    sheet.action("contact-round", "助手资料", () => this.profile());
    sheet.action("settings", "设置与电脑连接", () => this.openSettings());
    sheet.open();
  }
  private homeMenu() {
    const sheet = new PhoneSheet(this.app, "Obot");
    sheet.action("settings", "设置与电脑连接", () => this.openSettings());
    sheet.action("search", "搜索助手或聊天", () => {
      this.homeSearch.parentElement!.hidden = false;
      this.homeSearch.focus();
    });
    sheet.action("paperclip", "添加本地文件", () => this.homeFileInput.click());
    sheet.open();
  }
  private openSettings() {
    if (this.settings) return;
    this.settingsTrigger = this.header.querySelector<HTMLElement>(
      this.homeMode ? ".pi-phone-account" : ".pi-phone-identity",
    ) ?? undefined;
    this.settings = this.contentEl.createDiv({ cls: "pi-phone-settings-screen" });
    const header = this.settings.createDiv({ cls: "pi-phone-settings-header" });
    iconButton(header, "chevron-left", "返回", () => this.closeSettings(), "pi-phone-round");
    const page = this.settings.createDiv();
    this.disposeSettings = renderPhoneSettings(page, this.plugin, () => {
      this.closeSettings();
      void this.showHome();
    });
    this.contentEl.addClass("is-settings");
    header.querySelector("button")?.focus();
  }
  private closeSettings() {
    this.disposeSettings?.();
    this.disposeSettings = undefined;
    this.settings?.remove();
    this.settings = undefined;
    this.contentEl.removeClass("is-settings");
    this.settingsTrigger?.focus();
    this.settingsTrigger = undefined;
  }
  private connectionInfo() {
    const modal = new PhoneSheet(this.app, "我的电脑");
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
      this.openSettings();
    });
    modal.open();
  }
  private startChat() {
    const modal = new PhoneSheet(this.app, "开始新聊天");
    modal.modalEl.addClass("pi-phone-picker");
    modal.contentEl.addClass("pi-phone-contacts");
    const searchWrap = modal.contentEl.createDiv({ cls: "pi-phone-picker-search" });
    setIcon(searchWrap.createSpan(), "search");
    const search = searchWrap.createEl("input", {
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
        this.avatars.render(row, agent);
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
    const agent = this.agent as AgentRecord & { permissions?: AgentPermissions };
    const conversation = this.conversation;
    const modal = new PhoneSheet(this.app, "助手资料");
    modal.contentEl.addClass("pi-phone-profile");
    this.avatars.render(modal.contentEl, agent);
    modal.contentEl.createEl("h3", { text: agent.name });
    modal.contentEl.createEl("p", { text: agent.description, cls: "pi-phone-profile-description" });
    modal.contentEl.createEl("p", { text: "负责目录：" + (agent.scope || "总管") });
    const modelSection = modal.contentEl.createDiv({ cls: "pi-phone-model-setting" });
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
    renderAssistantModel(
      modelSection, this.plugin.client, agent,
      conversation && !conversation.archive && conversation.agentId === agent.id
        ? {
            separateModel: Boolean(conversation.modelOverride && conversation.modelOverride !== "inherit"),
            openPicker: () => {
              if (this.closed || this.conversation?.id !== conversation.id) return;
              if (this.conversation.status === "running" || this.sending) {
                new Notice("请等当前消息处理完，再更改这条聊天的模型");
                return;
              }
              modal.close();
              void this.runSlash("/model");
            },
          }
        : undefined,
    );
  }
  private history() {
    if (this.agent) new PhoneHistory(this, this.agent).open();
  }
  async readNote(path: string, resultAgentId?: string) {
    const agent = resultAgentId ? undefined : this.plugin.client.description?.agents.find(
      (a: AgentRecord) => a.path === path,
    );
    if (agent) {
      await this.selectAgent(agent);
      return;
    }
    const modal = new PhoneSheet(this.app, "电脑笔记 · 只读");
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
            resultAgentId,
          );
        }
      },
      true,
    );
    modal.open();
    try {
      const value = await this.plugin.client.call("note.read", {
        path,
        agentId: resultAgentId ?? this.agent?.id,
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

class PhoneHistory extends PhoneSheet {
  private archived = false;
  private list: ConversationSummary[] = [];
  private limit = 100;
  private search = "";
  private closed = false;
  constructor(
    private view: MobileChatView,
    private agent: AgentRecord,
  ) {
    super(view.app, "聊天历史");
  }
  onOpen() {
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
