import {
  ItemView,
  Modal,
  Notice,
  MarkdownRenderer,
  Component,
  TFile,
  setIcon,
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
import type {
  AgentRecord,
  Conversation,
  ConversationSummary,
  DelegationRecord,
} from "../shared/types.ts";

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
  constructor(
    leaf: WorkspaceLeaf,
    readonly plugin: MobilePlugin,
  ) {
    super(leaf);
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
    const el = this.contentEl;
    el.empty();
    el.addClass("pi-agent-view", "pi-phone-view");
    this.header = el.createDiv({ cls: "pi-chat-header pi-phone-header" });
    this.statusEl = el.createDiv({
      cls: "pi-phone-connection",
      attr: { role: "status", "aria-live": "polite" },
    });
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
    iconButton(
      line,
      "paperclip",
      "附加手机当前笔记副本",
      () => void this.attach(),
    );
    this.input = line.createEl("textarea", {
      attr: {
        rows: "1",
        placeholder: "发消息给电脑助手…",
        "aria-label": "聊天消息",
      },
    });
    this.input.addEventListener("input", () => {
      this.saveDraft();
      this.controls();
    });
    // Mobile Return inserts a newline; sending uses the explicit touch button.
    this.sendButton = iconButton(
      line,
      "arrow-up",
      "发送给电脑",
      () => void this.sendOrStop(),
      "pi-send-button",
    );
    this.footer.createDiv({
      cls: "pi-chat-status",
      text: "任务与归档写入电脑库 · 不自动同步手机笔记",
    });
    this.unsubscribe = this.plugin.client.subscribe((event) =>
      this.onEvent(event),
    );
    this.renderHeader();
    this.controls();
    if (this.plugin.client.description) await this.chooseInitial();
    else this.welcome();
  }
  async onClose() {
    this.closed = true;
    this.generation++;
    this.saveDraft();
    this.unsubscribe?.();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.streamTimer);
    this.messagesComponent?.unload();
  }
  private welcome() {
    this.timeline.empty();
    const welcome = this.timeline.createDiv({ cls: "pi-phone-welcome" });
    welcome.createEl("h2", { text: "把电脑助手带在身边" });
    welcome.createEl("p", {
      cls: "pi-muted",
      text: "手机发起任务，电脑处理笔记、调用 Skills 和 MCP。已有微信聊天也能在历史中查看。",
    });
    welcome
      .createEl("button", { text: "与电脑配对" })
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
    const id = this.plugin.app.loadLocalStorage(
      this.plugin.localKey("selected-agent"),
    );
    const agents: AgentRecord[] = this.plugin.client.description?.agents ?? [];
    const agent =
      agents.find((a) => a.id === id) ??
      agents.find((a) => a.role === "manager") ??
      agents[0];
    if (agent && !this.closed) await this.selectAgent(agent);
  }
  private renderHeader() {
    if (!this.header) return;
    this.header.empty();
    iconButton(this.header, "panel-left", "通讯录", () => this.contacts());
    if (this.agent) renderAvatar(this.header, this.app, this.agent);
    const identity = this.header.createEl("button", {
      cls: "pi-phone-identity pi-text-button",
      text: this.agent?.name ?? "Pi Agent",
    });
    identity.addEventListener("click", () => this.profile());
    iconButton(this.header, "history", "聊天历史与归档", () => this.history());
    iconButton(
      this.header,
      "square-pen",
      "新建对话",
      () => void this.newConversation(),
    );
    iconButton(this.header, "settings", "手机连接设置", () => {
      (this.app as any).setting.open();
      (this.app as any).setting.openTabById(this.plugin.manifest.id);
    });
  }
  private controls() {
    if (!this.statusEl) return;
    const client = this.plugin.client;
    this.statusEl.setText(
      this.error || client.status + (client.description ? " · 由电脑执行" : ""),
    );
    this.statusEl.toggleClass(
      "is-error",
      Boolean(this.error) || !client.connected,
    );
    const running = this.conversation?.status === "running";
    setIcon(this.sendButton, running ? "square" : "arrow-up");
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
      ? "已归档，点右上角新建对话"
      : "发消息给 " + (this.agent?.name ?? "电脑助手") + "…";
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
  private async selectAgent(agent: AgentRecord) {
    this.saveDraft();
    this.agent = agent;
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
        this.timeline.setText("还没有对话，点右上角开始新对话。");
      }
    } catch (e) {
      this.fail(e);
    }
  }
  async openConversation(id: string) {
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
      this.app.saveLocalStorage(
        this.plugin.localKey("selected:" + conversation.agentId),
        id,
      );
      const draft = this.app.loadLocalStorage(this.draftKey(id));
      this.input.value = draft?.text ?? "";
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
    const carry = this.conversation?.archive
      ? { text: this.input.value, attachment: this.attachment }
      : undefined;
    try {
      const item = await this.plugin.client.mutation<Conversation>(
        "conversation.create",
        { agentId: this.agent.id },
      );
      await this.openConversation(item.id);
      if (carry) {
        this.input.value = carry.text;
        this.attachment = carry.attachment;
        this.saveDraft();
        this.controls();
      }
    } catch (e) {
      this.fail(e);
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
      if (!this.streamTimer)
        this.streamTimer = setTimeout(() => {
          this.streamTimer = undefined;
          this.flushStreams();
        }, 32);
    } else if (event.type === "conversation.changed") {
      if (event.status !== "running") this.streams.delete(event.id);
      if (event.id === this.conversation?.id) this.queueRefresh();
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
      void this.plugin.refreshDescription().catch((e) => this.fail(e));
    }
  }
  private renderMessages() {
    const c = this.conversation;
    if (!c) return;
    const follow =
      this.timeline.scrollHeight -
        this.timeline.scrollTop -
        this.timeline.clientHeight <
      100;
    const previousHeight = this.timeline.scrollHeight,
      previousTop = this.timeline.scrollTop;
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
    for (
      let index = Math.max(0, c.messages.length - this.limit);
      index < c.messages.length;
      index++
    ) {
      const message = c.messages[index];
      const row = this.timeline.createDiv({
        cls: "pi-message pi-message-" + message.role,
      });
      row.createDiv({
        cls: "pi-message-origin",
        text:
          sourceName(message.origin ?? c.source) +
          " · " +
          new Date(message.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
      });
      const bubble = row.createDiv({
        cls: "pi-message-bubble markdown-rendered",
      });
      // User text is a literal instruction; assistant Markdown links open the
      // remote read-only note viewer rather than a same-named local note.
      if (message.role === "user") bubble.setText(message.text);
      else this.markdown(message.text, bubble);
      for (const record of c.delegations ?? [])
        if (record.messageIndex === index + ((c as any).messageOffset ?? 0))
          this.delegation(record);
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
    if (c.events.length) {
      const records = this.timeline.createEl("details", { cls: "pi-activity" });
      records.createEl("summary", { text: "任务记录 · " + c.events.length });
      for (const e of c.events.slice(-100))
        records.createDiv({
          text:
            toolLabel(e.name) +
            " · " +
            { running: "执行中", completed: "完成", failed: "失败" }[e.status] +
            (e.detail ? " · " + e.detail : ""),
        });
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
    if (follow) this.timeline.scrollTop = this.timeline.scrollHeight;
    else
      this.timeline.scrollTop = Math.max(
        0,
        previousTop + this.timeline.scrollHeight - previousHeight,
      );
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
  private delegation(record: DelegationRecord) {
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
    const reply = el.createDiv({
      cls: "pi-delegation-reply markdown-rendered",
    });
    if (record.status === "running") {
      const node = document.createTextNode(
        this.streams.get(record.conversationId)?.text ?? "",
      );
      reply.appendChild(node);
      this.streamNodes.set(record.conversationId, node);
    } else this.markdown(record.result || record.error || "", reply);
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
  private async attach() {
    try {
      const file = this.plugin.lastNote;
      if (!(file instanceof TFile) || file.extension !== "md")
        throw Error("请先在手机打开一篇 Markdown 笔记，再回到聊天附加");
      if (file.stat.size > 200_000)
        throw Error("笔记较大，请先选取需要的内容粘贴到消息中");
      const text = await this.app.vault.read(file);
      if (text.length > 90_000)
        throw Error("笔记超过 90000 字符，请精简后附加");
      this.attachment = { path: file.path, text };
      this.saveDraft();
      this.controls();
    } catch (e) {
      this.fail(e);
    }
  }
  private async sendOrStop() {
    if (!this.conversation || this.sending) return;
    const id = this.conversation.id;
    if (this.conversation.status === "running") {
      try {
        await this.plugin.client.mutation("chat.cancel", { id });
        this.queueRefresh();
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    if (this.conversation.archive) return;
    const pending = this.outbox();
    if (!pending && !this.input.value.trim()) return;
    const operation: Outbox = pending ?? {
      operationId: remoteId(),
      id,
      text: this.input.value.trim(),
      attachment: this.attachment,
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
      this.attachment = undefined;
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
  private contacts() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("通讯录");
    modal.contentEl.addClass("pi-phone-contacts");
    const search = modal.contentEl.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索助手", "aria-label": "搜索助手" },
    });
    const list = modal.contentEl.createDiv();
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
        const identity = row.createDiv();
        identity.createEl("strong", { text: agent.name });
        identity.createDiv({
          cls: "pi-muted",
          text: agent.description || agent.scope || "总管",
        });
        row.addEventListener("click", () => {
          modal.close();
          void this.selectAgent(agent);
        });
      }
    };
    search.addEventListener("input", render);
    render();
    modal.open();
  }
  private profile() {
    if (!this.agent) return;
    const agent = this.agent as any;
    const modal = new Modal(this.app);
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
        open.createSpan({ cls: "pi-history-preview", text: item.preview });
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
