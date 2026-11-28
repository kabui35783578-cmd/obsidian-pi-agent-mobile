import { Component, MarkdownRenderer, Notice, setIcon, type App } from "obsidian";
import { iconButton, toolLabel } from "../plugin/ui-elements.ts";
import type { Conversation, ConversationSummary } from "../shared/types.ts";
import { safeRemoteMarkdown } from "./artifacts.ts";
import type { MobileClient } from "./client.ts";
import { TodayActivityIndex, type TodayActivity, type TodayResult, type TodayTodo, type TodayTodos } from "./today-data.ts";

import { renderTodayTimeline, todayTimelineIcon, type TodayTimelineItem, type TodayTimelineSelection } from "./today-timeline.ts";

const formatTimelineTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export class PhoneToday {
  private index = new TodayActivityIndex();
  private device?: string;
  private todos?: TodayTodos;
  private activity?: TodayActivity;
  private todosError = "";
  private activityError = "";
  private writeError = "";
  private lastTasksRequest = 0;
  private previousDay = new Date().toDateString();
  private taskRevision = 0;
  private activityRevision = 0;
  private activityTimer?: ReturnType<typeof setTimeout>;
  private pending = new Set<string>();
  private entryLabel?: HTMLElement;
  private entryButton?: HTMLButtonElement;
  private screen?: HTMLElement;
  private body?: HTMLElement;
  private back?: HTMLButtonElement;
  private title?: HTMLElement;
  private detail?: Component;
  private lastListTop = 0;
  private animateHero = false;
  private heroMotion?: IntersectionObserver;
  private timeline?: ReturnType<typeof renderTodayTimeline>;

  constructor(
    private root: HTMLElement,
    private app: App,
    private client: MobileClient,
    private openChat: (id: string) => void,
    private openNote: (path: string, agentId: string) => void,
  ) {}

  entry(parent: HTMLElement) {
    const button = parent.createEl("button", {
      cls: "pi-phone-contact pi-phone-today-entry",
      attr: { type: "button" },
    });
    const avatar = button.createSpan({ cls: "pi-agent-avatar pi-phone-today-avatar", attr: { "aria-hidden": "true" } });
    setIcon(avatar.createSpan(), "calendar-days");
    const body = button.createDiv({ cls: "pi-phone-contact-body" });
    body.createDiv({ cls: "pi-phone-contact-title" }).createEl("strong", { text: "今天" });
    this.entryLabel = body.createDiv({ cls: "pi-phone-contact-preview" }).createSpan();
    button.addEventListener("click", () => this.open());
    this.entryButton = button;
    this.renderEntry();
    return button;
  }

  refresh() {
    this.updateDevice();
    this.render();
    if (!this.client.connected) {
      this.clearActivityTimer();
      return;
    }
    if (!this.activityTimer) this.activityTimer = setTimeout(() => {
      this.activityTimer = undefined;
      void this.refreshActivity();
    }, 180);
    if (Date.now() - this.lastTasksRequest >= 60_000) void this.refreshTodos();
  }

  open() {
    if (this.screen) return;
    this.updateDevice();
    const page = this.root.createDiv({ cls: "pi-phone-today-screen" });
    this.screen = page;
    const header = page.createDiv({ cls: "pi-phone-today-header" });
    this.back = iconButton(header, "chevron-left", "返回", () => this.navigateBack(), "pi-phone-round");
    this.title = header.createEl("h1", { text: "今天" });
    iconButton(header, "refresh-cw", "刷新今天", () => {
      this.updateDevice();
      void this.refreshTodos();
      this.clearActivityTimer();
      void this.refreshActivity();
    }, "pi-phone-round");
    this.body = page.createDiv({ cls: "pi-phone-today-body" });
    this.root.addClass("is-today-open");
    this.lastListTop = 0;
    this.animateHero = true;
    this.render();
    this.back.focus({ preventScroll: true });
    void this.refreshTodos();
    this.clearActivityTimer();
    void this.refreshActivity();
  }

  get isOpen() {
    return Boolean(this.screen);
  }

  navigateBack() {
    if (!this.screen) return false;
    if (this.detail) {
      this.clearDetail();
      this.render();
      this.body!.scrollTop = this.lastListTop;
      this.back?.focus({ preventScroll: true });
    } else this.close();
    return true;
  }

  close(restoreFocus = true) {
    this.clearDetail();
    this.clearHero();
    this.screen?.remove();
    this.screen = this.body = this.title = this.back = undefined;
    this.root.removeClass("is-today-open");
    if (restoreFocus) this.entryButton?.focus({ preventScroll: true });
  }

  dispose() {
    this.close(false);
    this.clearActivityTimer();
    this.taskRevision++;
    this.activityRevision++;
  }

  private clearActivityTimer() {
    clearTimeout(this.activityTimer);
    this.activityTimer = undefined;
  }

  private clearDetail() {
    this.detail?.unload();
    this.detail = undefined;
  }

  private updateDevice() {
    const device = this.client.credential?.deviceId;
    const day = new Date().toDateString();
    if (device === this.device && day === this.previousDay) return;
    this.device = device;
    this.previousDay = day;
    this.taskRevision++;
    this.activityRevision++;
    this.index = new TodayActivityIndex();
    this.lastTasksRequest = 0;
    this.todos = this.activity = undefined;
    this.todosError = this.activityError = this.writeError = "";
    this.pending.clear();
    this.clearHero();
    this.clearDetail();
  }

  private async refreshTodos() {
    if (!this.client.connected || !this.client.description?.mobileTodayTodos) {
      this.render();
      return;
    }
    const revision = ++this.taskRevision;
    this.lastTasksRequest = Date.now();
    this.todosError = "";
    try {
      const data = await this.client.call<TodayTodos>("today.todos");
      if (revision !== this.taskRevision) return;
      this.todos = data;
    } catch (error) {
      if (revision !== this.taskRevision) return;
      this.todosError = errorMessage(error);
    }
    this.render();
  }

  private async refreshActivity() {
    if (!this.client.connected) {
      this.render();
      return;
    }
    const revision = ++this.activityRevision;
    const current = () => revision === this.activityRevision;
    const now = new Date();
    this.activityError = "";
    try {
      const ids = new Set(this.client.description.agents.map((agent: { id: string }) => agent.id));
      const list = await this.client.call<ConversationSummary[]>("conversation.list", { includeBackground: true });
      if (!current()) return;
      const activity = await this.index.list(list.filter((item) => ids.has(item.agentId)),
        (id, before) => this.client.call<Conversation>("conversation.get", { id, before, limit: 60 }),
        now, current);
      if (!current()) return;
      this.activity = activity;
    } catch (error) {
      if (!current()) return;
      this.activityError = errorMessage(error);
    }
    this.render();
  }

  private async complete(todo: TodayTodo) {
    if (!this.client.connected || !this.todos?.canComplete || this.pending.has(todo.id)) return;
    const device = this.device;
    const day = this.previousDay;
    ++this.taskRevision;
    this.pending.add(todo.id);
    this.writeError = "";
    this.render();
    try {
      await this.client.mutation("today.todo.complete", { id: todo.id });
      if (device !== this.device || day !== this.previousDay) return;
      const current = this.todos;
      if (current?.items.some((item) => item.id === todo.id)) {
        this.todos = { ...current, total: current.total - 1, items: current.items.filter((item) => item.id !== todo.id) };
      }
    } catch (error) {
      if (device !== this.device || day !== this.previousDay) return;
      this.writeError = "未确认勾选：" + errorMessage(error);
    } finally {
      if (device === this.device && day === this.previousDay) {
        this.pending.delete(todo.id);
        this.render();
        void this.refreshTodos();
      }
    }
  }

  private renderEntry() {
    const label = this.entryLabel;
    if (!label) return;
    const parts = [
      this.todos?.total ? this.todos.total + " 项待办" : "",
      this.activity?.results.length ? this.activity.results.length + " 条结果" : "",
      this.activity?.running.length ? this.activity.running.length + " 项进行中" : "",
    ].filter(Boolean);
    const text = parts.slice(0, 2).join(" · ") || (!this.client.connected ? "电脑未连接" :
      this.todos && this.activity && !this.todosError && !this.todos.warnings && !this.activityError && !this.activity.partial ? "暂无新事项" : "查看待办和进展");
    if (label.textContent !== text) label.setText(text);
  }

  private clearHero() {
    this.heroMotion?.disconnect();
    this.heroMotion = undefined;
    this.timeline?.dispose();
    this.timeline = undefined;
  }

  private render() {
    this.renderEntry();
    const body = this.body;
    if (!body) return;
    if (this.detail) {
      const chat = body.querySelector<HTMLButtonElement>(".pi-phone-today-open-chat");
      if (chat) chat.disabled = !this.client.connected;
      return;
    }
    const active = body.ownerDocument.activeElement;
    const focus = active && body.contains(active) ? active.getAttribute("data-today-focus") : undefined;
    const scrollTop = body.scrollTop;
    const timelineSelection = this.timeline?.selection();
    this.clearHero();
    body.empty();
    this.title?.setText("今天");
    this.renderHero(body, timelineSelection);
    const notice = (text: string) => body.createEl("p", { cls: "pi-phone-today-notice", text, attr: { role: "status" } });
    if (!this.client.connected)
      notice(this.todos || this.activity ? "电脑离线 · 显示上次读取的内容" : "连接电脑后查看今天的待办和进展");
    if (this.writeError) notice(this.writeError);
    const section = (label: string, kind: string) => {
      const area = body.createEl("section", { cls: "pi-phone-today-group", attr: { "data-kind": kind } });
      const heading = area.createEl("h2", { text: label, attr: { "data-today-focus": kind + ":heading" } });
      if (kind === "tasks" && this.todos) heading.createSpan({ cls: "pi-phone-today-task-count", text: String(this.todos.total) });
      return area;
    };
    const empty = (area: HTMLElement, text: string) => area.createEl("p", { cls: "pi-phone-today-empty", text });
    const tasks = section("待你处理", "tasks");
    if (this.todosError) empty(tasks, "待办未能更新：" + this.todosError);
    if (this.todos?.warnings) empty(tasks, "有些笔记未能读取，可刷新重试。");
    if (this.todos && !this.todos.canComplete) empty(tasks, "电脑端写入权限已关闭，可查看待办。");
    if (this.todos?.items.length) {
      const list = tasks.createDiv({ cls: "pi-today-card" });
      for (const item of this.todos.items) {
        const waiting = this.pending.has(item.id);
        const row = list.createEl("button", { cls: "pi-today-item pi-phone-today-task", attr: { type: "button" } });
        row.dataset.todayFocus = item.id;
        row.disabled = waiting || !this.client.connected || !this.todos.canComplete;
        setIcon(row.createSpan({ cls: "pi-phone-today-check", attr: { "aria-hidden": "true" } }), waiting ? "loader-circle" : todayTimelineIcon(item.text) === "video" ? "video" : "file-text");
        const copy = row.createSpan({ cls: "pi-today-copy" });
        copy.createSpan({ cls: "pi-phone-today-label", text: item.text });
        copy.createSpan({ cls: "pi-phone-today-meta", text: waiting ? "正在保存…" : item.note });
        setIcon(row.createSpan({ cls: "pi-phone-today-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
        row.setAttribute("aria-label", (waiting ? "正在保存：" : "完成待办：") + item.text);
        row.addEventListener("click", () => void this.complete(item));
      }
      if (this.todos.items.length < this.todos.total)
        empty(tasks, "已显示前 " + this.todos.items.length + " 项 · 共 " + this.todos.total + " 项待办");
    } else if (!this.todosError && !this.todos?.warnings) {
      empty(tasks, this.todos ? "今天暂无待办" : !this.client.connected ? "待连接" :
        this.client.description?.mobileTodayTodos ? "正在读取电脑笔记…" : "更新电脑端 Obot 后可查看待办");
    }

    const results = section("新结果", "results");
    if (this.activityError || this.activity?.partial) empty(results, "部分结果未能读取，可刷新重试。");
    if (this.activity?.results.length) {
      const list = results.createDiv({ cls: "pi-today-card" });
      for (const item of this.activity.results) {
        const time = new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        this.row(list, item.title, this.agentName(item.agentId) + " · " + time,
          item.note ? "file-text" : "message-square-text", item.conversationId + ":" + item.at, () => {
            if (item.note) this.openNote(item.note, item.agentId);
            else this.showResult(item);
          }, !item.note || this.client.connected);
      }
    } else if (!this.activityError && !this.activity?.partial)
      empty(results, this.activity ? "今天暂无新结果" : this.client.connected ? "正在读取助手结果…" : "待连接");

    const running = section("进行中", "running");
    if (this.activity?.running.length) {
      const list = running.createDiv({ cls: "pi-today-card" });
      for (const item of this.activity.running) {
        const status = item.step?.status === "completed" ? "刚完成" : item.step?.status === "failed" ? "上一步未完成：" : "正在";
        const progress = item.step ? status + toolLabel(item.step.name) : "正在处理";
        this.row(list, item.title, this.agentName(item.agentId) + " · " + progress, "clock-3",
          item.conversationId, () => this.openChat(item.conversationId), this.client.connected);
      }
    } else empty(running, this.activity && !this.activity.partial ? "当前没有进行中的任务" :
      this.activityError || this.activity?.partial ? "未能确认任务状态" : this.client.connected ? "正在读取任务状态…" : "待连接");
    body.scrollTop = scrollTop;
    if (focus) {
      const current = [...body.querySelectorAll<HTMLElement | SVGElement>("[data-today-focus]")]
        .find((button) => button.dataset.todayFocus === focus && !button.matches(":disabled"));
      if (current && current.tagName === "H2") current.tabIndex = -1;
      (current ?? this.back)?.focus({ preventScroll: true });
    }
  }

  private renderHero(body: HTMLElement, timelineSelection?: TodayTimelineSelection) {
    const now = new Date();
    const day = this.todos?.date ? new Date(this.todos.date + "T12:00:00") : now;
    const hero = body.createDiv({ cls: "pi-phone-today-hero" });
    if (this.animateHero) {
      hero.addClass("is-entering");
      this.animateHero = false;
    }
    const top = hero.createDiv({ cls: "pi-phone-today-hero-top" });
    const date = top.createEl("time", { cls: "pi-phone-today-date" });
    date.dateTime = this.todos?.date ?? [
      day.getFullYear(), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"),
    ].join("-");
    const week = day.toLocaleDateString("zh-CN", { weekday: "long" });
    date.createSpan({ cls: "pi-phone-today-day-label", text: (day.getMonth() + 1) + "月 · " + week });
    date.createSpan({ cls: "pi-phone-today-day-number", text: String(day.getDate()).padStart(2, "0") });
    const art = top.createDiv({ cls: "pi-phone-today-hero-art", attr: { "aria-hidden": "true" } });
    const face = art.createDiv({ cls: "pi-phone-today-hero-face" });
    const Observer = body.ownerDocument.defaultView?.IntersectionObserver;
    if (Observer) {
      this.heroMotion = new Observer(([entry]) => face.classList.toggle("is-visible", entry.isIntersecting), { root: body });
      this.heroMotion.observe(face);
    } else face.classList.add("is-visible");
    const stats = hero.createDiv({ cls: "pi-phone-today-stats" });
    const groups = [
      { kind: "results", label: "已完成", count: this.activity?.results.length },
      { kind: "tasks", label: "待办", count: this.todos?.total },
      { kind: "running", label: "进行中", count: this.activity?.running.length },
    ];
    for (const { kind, label, count } of groups) {
      const metric = stats.createEl("button", { attr: { type: "button" } });
      metric.dataset.todayFocus = kind;
      metric.dataset.kind = kind;
      metric.createSpan({ cls: "pi-phone-today-stat-number", text: count === undefined ? "–" : String(count) });
      metric.createSpan({ cls: "pi-phone-today-stat-label", text: label });
      metric.setAttribute("aria-label", (kind === "results" ? "已完成的助手结果" : label) + "，" + (count === undefined ? "等待读取" : count));
      metric.addEventListener("click", () => {
        const target = body.querySelector<HTMLElement>('[data-kind="' + kind + '"] h2');
        if (!target) return;
        target.scrollIntoView({ block: "start" });
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      });
    }
    const items: TodayTimelineItem[] = [];
    for (const item of [...(this.activity?.results ?? [])].reverse()) {
      const date = new Date(item.at);
      items.push({
        key: "result:" + item.conversationId + ":" + item.at, title: item.title,
        status: "done", time: Number.isNaN(date.getTime()) ? undefined : formatTimelineTime.format(date),
        icon: todayTimelineIcon(item.title),
      });
    }
    for (const item of this.activity?.running ?? []) {
      items.push({ key: "running:" + item.conversationId, title: item.title, status: "running", icon: "clock", detail: this.agentName(item.agentId) });
    }
    for (const item of this.todos?.items ?? []) {
      items.push({ key: "pending:" + item.id, title: item.text, status: "pending", icon: todayTimelineIcon(item.text), detail: item.note });
    }
    const emptyText = !this.client.connected ? "连接电脑后查看时间线" :
      this.todosError || this.activityError || this.todos?.warnings || this.activity?.partial ? "部分事项未能读取" :
      !this.activity || (this.client.description?.mobileTodayTodos && !this.todos) ? "正在读取今天的事项…" : "今天暂无事项";
    this.timeline = renderTodayTimeline(hero, items, timelineSelection, emptyText);
  }

  private row(parent: HTMLElement, title: string, detail: string, icon: string, key: string, open: () => void, enabled = true) {
    const row = parent.createEl("button", { cls: "pi-today-item", attr: { type: "button" } });
    row.dataset.todayFocus = key;
    row.disabled = !enabled;
    setIcon(row.createSpan({ cls: "pi-phone-today-icon", attr: { "aria-hidden": "true" } }), icon);
    const copy = row.createSpan({ cls: "pi-today-copy" });
    copy.createSpan({ cls: "pi-phone-today-label", text: title });
    copy.createSpan({ cls: "pi-phone-today-meta", text: detail });
    setIcon(row.createSpan({ cls: "pi-phone-today-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
    row.addEventListener("click", open);
  }

  private agentName(id: string) {
    return this.client.description?.agents.find((agent: { id: string }) => agent.id === id)?.name ?? "助手";
  }

  private showResult(result: TodayResult) {
    const body = this.body;
    if (!body) return;
    this.lastListTop = body.scrollTop;
    this.clearHero();
    body.empty();
    body.scrollTop = 0;
    this.title?.setText("结果");
    const meta = body.createEl("p", { cls: "pi-phone-today-notice", text: this.agentName(result.agentId) });
    meta.createEl("time", { text: " · " + new Date(result.at).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit",
    }), attr: { datetime: result.at } });
    const content = body.createDiv({ cls: "markdown-rendered pi-phone-today-result" });
    const component = new Component();
    this.detail = component;
    component.load();
    content.addEventListener("click", (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      const path = link?.dataset.href || link?.getAttribute("href");
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      if (!this.client.connected) {
        new Notice("连接电脑后可打开原笔记");
        return;
      }
      this.openNote(path, result.agentId);
    }, true);
    void MarkdownRenderer.render(this.app, safeRemoteMarkdown(result.text), content, "", component)
      .catch(() => content.setText(result.text));
    const chat = body.createEl("button", { cls: "pi-phone-today-open-chat", text: "打开对应聊天", attr: { type: "button" } });
    chat.disabled = !this.client.connected;
    chat.addEventListener("click", () => this.openChat(result.conversationId));
    this.back?.focus({ preventScroll: true });
  }
}
