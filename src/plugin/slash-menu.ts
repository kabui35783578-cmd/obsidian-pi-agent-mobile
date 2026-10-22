import { Component } from "obsidian";
import { commandMatches } from "../shared/slash-commands.ts";

export interface CommandChoice {
  value: string;
  label: string;
  description?: string;
  current?: boolean;
}
/** One composer-anchored palette for commands, parameters and read-only output. */
export class SlashMenu extends Component {
  private el: HTMLElement;
  private list!: HTMLElement;
  private selected = 0;
  private rows: CommandChoice[] = [];
  private mode: "commands" | "choices" | "info" | "hint" | "loading" =
    "commands";
  private dismissed = "";
  private revision = 0;
  private resolveChoice?: (value: string | undefined) => void;
  private rejectChoice?: (error: unknown) => void;
  private search?: HTMLInputElement;
  private pickRow?: (value: string) => void;
  constructor(
    parent: HTMLElement,
    private input: HTMLTextAreaElement,
    choose: (text: string) => void,
  ) {
    super();
    this.el = parent.createDiv({
      cls: "pi-slash-menu",
      attr: { hidden: "", "aria-label": "聊天命令" },
    });
    this.el.id = "pi-slash-" + globalThis.crypto.randomUUID();
    input.setAttribute("aria-controls", this.el.id);
    input.setAttribute("aria-autocomplete", "list");
    this.registerDomEvent(input, "input", () => this.update());
    this.registerDomEvent(
      input,
      "keydown",
      (event: KeyboardEvent) => {
        if (this.mode !== "commands") {
          if (!this.el.hidden && event.key === "Escape" && !event.isComposing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.back();
          }
          return;
        }
        this.key(event, choose);
      },
      { capture: true },
    );
    this.registerDomEvent(this.el, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.back();
      } else if (this.mode === "choices") this.key(event, choose);
    });
    // Keep the keyboard and composer focus on row touches, but let the search
    // field focus normally. Do not cancel touch scrolling of a long result list.
    this.registerDomEvent(this.el, "mousedown", (event: MouseEvent) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    });
    this.registerDomEvent(this.el, "click", (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-command-back]")) {
        this.back();
        return;
      }
      const row = target.closest<HTMLElement>("[data-command-index]");
      if (row) this.pick(Number(row.dataset.commandIndex), choose);
    });
    this.registerDomEvent(
      input.ownerDocument,
      "pointerdown",
      (event: PointerEvent) => {
        const target = event.target as Node;
        if (!this.el.hidden && target !== input && !this.el.contains(target))
          this.close();
      },
    );
    const position = () => {
      if (!this.el.hidden) this.position();
    };
    this.registerDomEvent(window, "resize", position);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    this.register(() => {
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    });
  }
  private key(event: KeyboardEvent, choose: (text: string) => void) {
    if (
      this.el.hidden ||
      event.isComposing ||
      (event.key === "Enter" && event.shiftKey)
    )
      return;
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key))
      return;
    if (event.key === "Tab" && (this.mode !== "commands" || event.shiftKey))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      this.dismissed = this.input.value;
      this.close();
      return;
    }
    if (!this.rows.length) return;
    if (event.key === "Tab") {
      const text = this.rows[this.selected].value + " ";
      this.close();
      this.input.value = text;
      this.input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (event.key === "Enter") this.pick(this.selected, choose);
    else {
      this.selected =
        (this.selected +
          (event.key === "ArrowDown" ? 1 : this.rows.length - 1)) %
        this.rows.length;
      this.paintSelection();
      this.list.children[this.selected]?.scrollIntoView({ block: "nearest" });
    }
  }
  private pick(index: number, choose: (text: string) => void) {
    const row = this.rows[index];
    if (!row) return;
    if (this.mode === "commands") {
      this.close();
      choose(row.value);
    } else this.pickRow?.(row.value);
  }
  update() {
    this.close();
    if (this.input.value !== this.dismissed) this.dismissed = "";
    if (this.input.value === this.dismissed) return;
    const matches = commandMatches(this.input.value);
    if (!matches.length) return;
    this.mode = "commands";
    this.selected = 0;
    this.rows = matches.map((c) => ({
      value: "/" + c.name,
      label: "/" + c.name,
      description: c.label,
    }));
    this.shell("命令", false);
    this.renderRows();
    this.footer("↑↓ 选择 · Enter 执行 · Tab 补全");
  }
  private shell(title: string, back = true) {
    this.el.empty();
    this.search = undefined;
    this.el.hidden = false;
    this.el.dataset.mode = this.mode;
    this.input.setAttribute("aria-expanded", "true");
    const header = this.el.createDiv({ cls: "pi-slash-header" });
    if (back)
      header.createEl("button", {
        cls: "pi-slash-back",
        text: "‹",
        attr: {
          type: "button",
          "aria-label": "返回命令",
          "data-command-back": "",
        },
      });
    header.createSpan({ text: title });
    this.list = this.el.createDiv({
      cls: "pi-slash-list",
      attr: { role: "listbox", "aria-label": title },
    });
    this.position();
  }
  private position() {
    const view = this.input.closest<HTMLElement>(".pi-agent-view");
    const top = Math.max(
      view?.querySelector(".pi-chat-header")?.getBoundingClientRect().bottom ??
        0,
      window.visualViewport?.offsetTop ?? 0,
    );
    const space = this.el.parentElement!.getBoundingClientRect().top - top - 16;
    this.el.style.maxHeight = Math.max(0, Math.min(380, space)) + "px";
  }
  private footer(text: string) {
    this.el.createDiv({ cls: "pi-slash-footer", text });
  }
  private paintSelection() {
    [...this.list.children].forEach((row, index) =>
      row.setAttribute("aria-selected", String(index === this.selected)),
    );
    const row = this.list.children[this.selected];
    if (row)
      (this.search ?? this.input).setAttribute("aria-activedescendant", row.id);
    else (this.search ?? this.input).removeAttribute("aria-activedescendant");
  }
  private renderRows() {
    this.list.empty();
    if (!this.rows.length)
      this.list.createDiv({ cls: "pi-slash-empty", text: "没有匹配项" });
    for (const [index, value] of this.rows.entries()) {
      const row = this.list.createEl("button", {
        cls: "pi-slash-row",
        attr: {
          type: "button",
          role: "option",
          "data-command-index": String(index),
          "aria-selected": String(index === this.selected),
          id: this.el.id + "-" + index,
        },
      });
      const text = row.createSpan({ cls: "pi-slash-text" });
      text.createSpan({ cls: "pi-slash-name", text: value.label });
      if (value.description)
        text.createSpan({ cls: "pi-slash-label", text: value.description });
      if (value.current)
        row.createSpan({
          cls: "pi-slash-current",
          text: "✓",
          attr: { "aria-label": "当前选择" },
        });
    }
    this.paintSelection();
  }
  /** Cancelling the palette resolves immediately; late network results are ignored. */
  async choose(
    title: string,
    load: () => Promise<CommandChoice[]>,
  ): Promise<string | undefined> {
    this.close();
    const revision = this.revision;
    this.mode = "loading";
    this.rows = [];
    this.shell(title);
    this.list.createDiv({
      cls: "pi-slash-empty",
      text: "正在读取…",
      attr: { role: "status" },
    });
    const result = new Promise<string | undefined>((resolve, reject) => {
      this.resolveChoice = resolve;
      this.rejectChoice = reject;
    });
    void Promise.resolve()
      .then(load)
      .then((values) => {
        if (revision !== this.revision) return;
        this.mode = "choices";
        this.shell(title);
        this.el.dataset.mode = "choices";
        const search = this.el.createEl("input", {
          cls: "pi-slash-search",
          type: "search",
          attr: {
            placeholder: "搜索",
            "aria-label": "搜索" + title,
            "aria-controls": this.el.id + "-options",
            "aria-autocomplete": "list",
          },
        });
        this.el.insertBefore(search, this.list);
        this.search = search;
        this.list.id = this.el.id + "-options";
        const render = () => {
          const query = search.value.toLocaleLowerCase();
          this.rows = values.filter((v) =>
            (v.label + " " + (v.description ?? "") + " " + v.value)
              .toLocaleLowerCase()
              .includes(query),
          );
          this.selected = Math.max(
            0,
            this.rows.findIndex((v) => v.current),
          );
          this.renderRows();
        };
        search.addEventListener("input", render);
        // Capture the resolver before close() settles cancellation.
        const resolve = this.resolveChoice;
        this.pickRow = (value) => {
          this.resolveChoice = undefined;
          this.close();
          resolve?.(value);
          this.input.focus({ preventScroll: true });
        };
        render();
        this.footer("↑↓ 选择 · Enter 应用 · Esc 返回");
        search.focus({ preventScroll: true });
        this.list.children[this.selected]?.scrollIntoView({ block: "nearest" });
      })
      .catch((error) => {
        if (revision !== this.revision) return;
        const reject = this.rejectChoice;
        this.resolveChoice = undefined;
        this.rejectChoice = undefined;
        this.close();
        reject?.(error);
      });
    return result;
  }
  info(title: string, text: string) {
    this.close();
    this.mode = "info";
    this.rows = [];
    this.shell(title);
    this.list.createEl("pre", { cls: "pi-command-info", text });
  }
  hint(title: string, text: string) {
    this.close();
    this.mode = "hint";
    this.rows = [];
    this.shell(title);
    this.list.createDiv({ cls: "pi-slash-empty", text });
  }
  private back() {
    this.close();
    this.input.value = "/";
    this.input.dispatchEvent(new Event("input", { bubbles: true }));
    this.input.focus({ preventScroll: true });
  }
  close() {
    this.revision++;
    this.resolveChoice?.(undefined);
    this.resolveChoice = undefined;
    this.rejectChoice = undefined;
    this.pickRow = undefined;
    this.el.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
  }
  onunload() {
    this.close();
    this.el.remove();
    this.input.removeAttribute("aria-controls");
  }
}
