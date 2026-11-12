import { Component, setIcon, type App } from "obsidian";
import {
  errorText,
  type AgentRecord,
  type Conversation,
  type DelegationRecord,
} from "../shared/types.ts";
import { toolLabel } from "./ui-elements.ts";

export type CollaborationPage = Conversation & {
  messageOffset?: number;
  totalMessages?: number;
};
export interface CollaborationServices {
  app: App;
  viewerAgentId?: string;
  agents(): AgentRecord[];
  avatar(parent: HTMLElement, agent: AgentRecord): void;
  load(id: string, before?: number): Promise<CollaborationPage>;
  subscribe(listener: (event: any) => void): () => void;
  render(
    text: string,
    parent: HTMLElement,
    owner: Component,
    agent?: AgentRecord,
  ): Promise<unknown>;
}
const active = (record: DelegationRecord) =>
  ["queued", "running"].includes(record.status);
const stateText = (record: DelegationRecord) =>
  record.status === "queued"
    ? "排队中"
    : record.status === "running"
      ? record.progress
        ? toolLabel(record.progress) + "…"
        : "正在处理…"
      : record.status === "failed"
        ? "未完成"
        : record.status === "cancelled"
          ? "已停止"
          : record.outcome?.verification === "needs-review"
            ? "有操作未通过核验"
            : "";

/** A running exchange becomes a single receipt after it finishes. */
export class DelegationFlow {
  readonly el: HTMLElement;
  private live: HTMLElement;
  private folded: HTMLButtonElement;
  private status: HTMLElement;
  private problem: HTMLElement;
  private incoming: HTMLElement;
  private reply: HTMLElement;
  private count: HTMLElement;
  private streamNode?: Text;
  private life: Component;
  private modal?: DelegationChatModal;
  private disposed = false;
  constructor(
    parent: HTMLElement,
    private owner: Component,
    private services: CollaborationServices,
    private record: DelegationRecord,
  ) {
    this.life = owner.addChild(new Component());
    this.el = parent.createDiv({ cls: "pi-delegation pi-collaboration-flow" });
    this.el.dataset.conversationId = record.conversationId;
    this.live = this.el.createDiv({ cls: "pi-collaboration-live" });
    const sent = this.live.createDiv({ cls: "pi-collaboration-receipt" });
    sent.createSpan({
      text:
        services.viewerAgentId === record.toAgentId ? "消息来自" : "已发消息给",
    });
    this.identity(sent, this.otherAgent(record));
    this.status = this.live.createDiv({
      cls: "pi-collaboration-progress",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.incoming = this.live.createDiv({ cls: "pi-collaboration-incoming" });
    const source = this.incoming.createDiv({ cls: "pi-collaboration-receipt" });
    source.createSpan({ text: "消息来自" });
    this.identity(source, this.otherAgent(record));
    this.reply = this.incoming.createDiv({
      cls: "pi-collaboration-bubble markdown-rendered",
    });
    this.folded = this.el.createEl("button", {
      cls: "pi-collaboration-folded",
      attr: { type: "button", "aria-expanded": "false" },
    });
    this.count = this.folded.createSpan();
    const target = services
      .agents()
      .find((a) => a.id === this.otherAgent(record));
    if (target) services.avatar(this.folded, target);
    this.folded.createSpan({ text: target?.name ?? "助手" });
    this.life.registerDomEvent(this.folded, "click", () => this.open());
    this.problem = this.el.createDiv({
      cls: "pi-collaboration-problem",
      attr: { role: "status" },
    });
    this.life.register(() => {
      this.disposed = true;
      this.modal?.close();
    });
    this.update(record);
  }
  private otherAgent(record: DelegationRecord) {
    return this.services.viewerAgentId === record.toAgentId
      ? record.fromAgentId
      : record.toAgentId;
  }
  private identity(parent: HTMLElement, id: string) {
    const agent = this.services.agents().find((a) => a.id === id);
    if (agent) this.services.avatar(parent, agent);
    const button = parent.createEl("button", {
      cls: "pi-collaboration-name",
      text: agent?.name ?? "助手",
      attr: { type: "button", "aria-expanded": "false" },
    });
    this.life.registerDomEvent(button, "click", () => this.open());
  }
  private open() {
    if (this.modal) {
      const wasVisible = this.modal.connected;
      this.modal.close();
      if (wasVisible) return;
    }
    this.folded.setAttribute("aria-expanded", "true");
    this.modal = new DelegationChatModal(
      this.el,
      this.services,
      this.record,
      (count) => {
        if (!this.disposed) {
          this.record = { ...this.record, messageCount: count };
          this.update(this.record);
        }
      },
      () => {
        this.modal = undefined;
        this.folded.setAttribute("aria-expanded", "false");
      },
    );
    this.modal.open();
  }
  update(record: DelegationRecord) {
    this.record = record;
    this.el.dataset.status = record.status;
    this.live.hidden = !active(record);
    this.folded.hidden = active(record);
    this.status.setText(stateText(record));
    this.count.setText(
      Number.isSafeInteger(record.messageCount) && record.messageCount! >= 0
        ? `${record.messageCount} 条消息${this.services.viewerAgentId === record.toAgentId ? "往来" : "来自"}：`
        : this.services.viewerAgentId === record.toAgentId
          ? "消息往来："
          : "消息来自：",
    );
    const problem = active(record) ? "" : record.error || stateText(record);
    this.problem.hidden = !problem;
    this.problem.setText(problem);
    this.incoming.hidden = !this.streamNode?.length;
  }
  stream(text: string) {
    if (!active(this.record) || this.disposed) return;
    this.incoming.hidden = !text;
    if (!this.streamNode?.isConnected) {
      this.reply.empty();
      this.streamNode = this.reply.ownerDocument.createTextNode("");
      this.reply.appendChild(this.streamNode);
    }
    this.streamNode.data = text;
  }
  closeDetail() { if(!this.modal?.connected)return false;this.modal.close();return true; }
  dispose() {
    this.owner.removeChild(this.life);
    this.el.remove();
  }
}

/** Explicit drill-in to the actual transcript, including follow-up corrections. */
export class DelegationChatModal {
  private contentEl!: HTMLElement;
  private modalEl!: HTMLElement;
  private inertSiblings = new Map<HTMLElement, boolean>();
  get connected() {
    return !!this.modalEl?.isConnected;
  }
  private life = new Component();
  private body!: HTMLElement;
  private status!: HTMLElement;
  private data?: CollaborationPage;
  private closed = false;
  private revision = 0;
  private pending?: Promise<void>;
  private refreshAgain = false;
  private olderLoading = false;
  private stream?: Text;
  private streamText = "";
  private rendering?: Component;
  constructor(
    private anchor: HTMLElement,
    private services: CollaborationServices,
    private record: DelegationRecord,
    private counted: (count: number) => void,
    private finished: () => void,
  ) {}
  open() {
    const host =
      this.anchor.closest<HTMLElement>(".pi-agent-view") ?? this.anchor;
    for (const child of Array.from(host.children)) {
      if (!(child instanceof HTMLElement)) continue;
      this.inertSiblings.set(child, child.hasAttribute("inert"));
      child.setAttribute("inert", "");
    }
    this.modalEl = host.createDiv({
      cls: "pi-collaboration-inline",
      attr: { role: "region" },
    });
    this.contentEl = this.modalEl.createDiv({ cls: "pi-collaboration-chat" });
    this.onOpen();
  }
  close() {
    if (!this.closed) this.onClose();
  }
  onOpen() {
    this.life.load();
    const header = this.contentEl.createDiv({ cls: "pi-collaboration-header" });
    const pair = header.createDiv({ cls: "pi-collaboration-pair" });
    for (const [index, id] of [
      this.record.fromAgentId,
      this.record.toAgentId,
    ].entries()) {
      if (index)
        setIcon(
          pair.createSpan({ cls: "pi-collaboration-direction" }),
          "arrow-left-right",
        );
      const agent = this.services.agents().find((a) => a.id === id);
      if (agent) this.services.avatar(pair, agent);
      pair.createSpan({ cls: "pi-collaboration-pair-name", text: agent?.name ?? "助手" });
    }
    this.modalEl.setAttribute("aria-label", pair.textContent + "的协作对话");
    this.body = this.contentEl.createDiv({
      cls: "pi-collaboration-transcript",
    });
    this.status = this.contentEl.createDiv({
      cls: "pi-collaboration-modal-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    const footer = this.contentEl.createDiv({ cls: "pi-collaboration-footer" });
    this.life.registerDomEvent(
      footer.createEl("button", {
        cls: "pi-collaboration-close",
        text: "关闭聊天",
        attr: { type: "button" },
      }),
      "click",
      () => this.close(),
    );
    this.life.register(
      this.services.subscribe((event) => {
        if (
          event.type === "chat.delta" &&
          event.conversationId === this.record.conversationId
        )
          this.append(event.delta ?? "");
        else if (
          (event.type === "conversation.changed" &&
            event.id === this.record.conversationId) ||
          (event.type === "delegation.updated" &&
            event.conversationId === this.record.conversationId)
        ) {
          if (event.type === "delegation.updated") this.record = event;
          void this.refresh();
        }
      }),
    );
    void this.refresh();
  }
  private checked(page: CollaborationPage) {
    if (
      page.id !== this.record.conversationId ||
      page.agentId !== this.record.toAgentId ||
      page.parent?.conversationId !== this.record.parentConversationId ||
      page.parent.agentId !== this.record.fromAgentId
    )
      throw Error("无法核对这段协作消息的来源");
    return page;
  }
  private refresh() {
    if (this.pending) {
      this.refreshAgain = true;
      return this.pending;
    }
    return (this.pending ??= (async () => {
      try {
        this.status.setText("正在读取消息…");
        const page = this.checked(
          await this.services.load(this.record.conversationId),
        );
        if (this.closed) return;
        const offset = page.messageOffset ?? 0;
        if (this.data && (this.data.messageOffset ?? 0) < offset) {
          const oldStart = this.data.messageOffset ?? 0;
          page.messages = [
            ...this.data.messages.slice(0, offset - oldStart),
            ...page.messages,
          ];
          page.messageOffset = oldStart;
        }
        this.data = page;
        if (page.status !== "running") this.streamText = "";
        this.counted(page.totalMessages ?? page.messages.length);
        await this.render();
        if (!this.closed)
          this.status.setText(
            page.status === "running"
              ? "正在处理…"
              : page.status === "cancelled"
                ? "已停止"
                : page.status === "failed"
                  ? "未完成"
                  : stateText(this.record),
          );
      } catch (error) {
        if (!this.closed) this.failure(error);
      } finally {
        this.pending = undefined;
        if (this.refreshAgain && !this.closed) {
          this.refreshAgain = false;
          void this.refresh();
        }
      }
    })());
  }
  private failure(error: unknown) {
    this.status.empty();
    this.status.createSpan({ text: "消息读取失败：" + errorText(error) });
    const retry = this.status.createEl("button", {
      text: "重试",
      cls: "pi-text-button",
    });
    this.life.registerDomEvent(retry, "click", () => void this.refresh());
  }
  private async older() {
    if (!this.data || !this.data.messageOffset || this.olderLoading) return;
    this.olderLoading = true;
    const before = this.data.messageOffset,
      revision = this.revision;
    const height = this.body.scrollHeight,
      top = this.body.scrollTop;
    try {
      const page = this.checked(
        await this.services.load(this.record.conversationId, before),
      );
      if (this.closed || revision !== this.revision) return;
      this.data = {
        ...this.data,
        messages: [...page.messages, ...this.data.messages],
        messageOffset: page.messageOffset ?? 0,
      };
      await this.render(false);
      if (!this.closed)
        this.body.scrollTop = top + this.body.scrollHeight - height;
    } catch (error) {
      if (!this.closed) this.failure(error);
    } finally {
      this.olderLoading = false;
    }
  }
  private async render(follow = true) {
    const revision = ++this.revision;
    const bottom =
      this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight <
      80;
    const top = this.body.scrollTop;
    this.body.empty();
    this.stream = undefined;
    const rendering = this.life.addChild(new Component());
    if (this.rendering) this.life.removeChild(this.rendering);
    this.rendering = rendering;
    if (this.data!.messageOffset) {
      const older = this.body.createEl("button", {
        cls: "pi-collaboration-earlier",
        text: "加载更早消息",
      });
      rendering.registerDomEvent(older, "click", () => void this.older());
    }
    const ready: Promise<unknown>[] = [];
    for (const [index, message] of this.data!.messages.entries()) {
      const previous = this.data!.messages[index - 1];
      if (
        !previous ||
        new Date(message.at).getTime() - new Date(previous.at).getTime() >
          5 * 60_000
      ) {
        const date = new Date(message.at),
          today = date.toDateString() === new Date().toDateString();
        this.body.createEl("time", {
          cls: "pi-collaboration-date",
          text:
            (today
              ? "今天"
              : date.toLocaleDateString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                })) +
            " " +
            date.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
        });
      }
      const sender = this.services
        .agents()
        .find(
          (a) =>
            a.id ===
            (message.role === "user"
              ? this.record.fromAgentId
              : this.record.toAgentId),
        );
      const row = this.body.createDiv({ cls: "pi-collaboration-message" });
      const label = row.createDiv({
        cls: "pi-collaboration-sender",
        text: message.role === "system" ? "系统" : (sender?.name ?? "助手"),
      });
      if (sender) label.dataset.role = sender.role;
      const line = row.createDiv({ cls: "pi-collaboration-message-line" });
      if (sender) this.services.avatar(line, sender);
      const bubble = line.createDiv({
        cls: "pi-collaboration-bubble markdown-rendered",
      });
      ready.push(this.services.render(message.text, bubble, rendering, sender));
    }
    if (!this.data!.messages.length)
      this.body.createDiv({
        cls: "pi-collaboration-progress",
        text: "暂无消息",
      });
    await Promise.allSettled(ready);
    if (!this.closed && revision === this.revision) {
      if (this.streamText && this.data!.status === "running") this.append("");
      this.body.scrollTop = follow && bottom ? this.body.scrollHeight : top;
    }
  }
  private append(delta: string) {
    if (this.closed || (!delta && !this.streamText)) return;
    const follow =
      this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight <
      80;
    this.streamText += delta;
    if (!this.stream?.isConnected) {
      const row = this.body.createDiv({ cls: "pi-collaboration-message" });
      const sender = this.services
        .agents()
        .find((a) => a.id === this.record.toAgentId);
      row.createDiv({
        cls: "pi-collaboration-sender",
        text: sender?.name ?? "助手",
      });
      const line = row.createDiv({ cls: "pi-collaboration-message-line" });
      if (sender) this.services.avatar(line, sender);
      const bubble = line.createDiv({ cls: "pi-collaboration-bubble" });
      this.stream = bubble.ownerDocument.createTextNode("");
      bubble.appendChild(this.stream);
    }
    this.stream.data = this.streamText;
    if (follow) this.body.scrollTop = this.body.scrollHeight;
  }
  onClose() {
    this.closed = true;
    ++this.revision;
    this.life.unload();
    for (const [child, wasInert] of this.inertSiblings)
      if (!wasInert) child.removeAttribute("inert");
    this.inertSiblings.clear();
    this.finished();
    this.modalEl.remove();
  }
}
