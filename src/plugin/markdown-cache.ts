import { Component, MarkdownRenderer, type App } from "obsidian";

/** Retain only visible Markdown bodies and their render components, never complete histories. */
export class MarkdownCache extends Component {
  private scope = "";
  private entries = new Map<
    string,
    {
      text: string;
      source: string;
      el: HTMLElement;
      component: Component;
      ready: Promise<void>;
    }
  >();
  constructor(private app: App) {
    super();
  }
  reset(scope = "") {
    if (scope === this.scope) return;
    this.clear();
    this.scope = scope;
  }
  clear() {
    for (const entry of this.entries.values())
      this.removeChild(entry.component);
    this.entries.clear();
  }
  render(
    key: string,
    text: string,
    source: string,
    parent: HTMLElement,
    className: string,
  ) {
    const previous = this.entries.get(key);
    if (previous?.text === text && previous.source === source) {
      parent.appendChild(previous.el);
      return previous;
    }
    if (previous) this.removeChild(previous.component);
    const el = document.createElement("div");
    el.className = className;
    parent.appendChild(el);
    const component = this.addChild(new Component());
    const ready = MarkdownRenderer.render(
      this.app,
      text,
      el,
      source,
      component,
    ).catch(() => el.setText(text));
    const entry = { text, source, el, component, ready };
    this.entries.set(key, entry);
    return entry;
  }
  retain(keys: Set<string>) {
    for (const [key, entry] of this.entries) {
      if (keys.has(key)) continue;
      this.removeChild(entry.component);
      this.entries.delete(key);
    }
  }
  onunload() {
    this.clear();
  }
}
