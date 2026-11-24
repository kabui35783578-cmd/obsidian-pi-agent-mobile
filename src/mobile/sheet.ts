import { Modal, setIcon, type App } from "obsidian";

/** Reuse Obsidian's dialog focus and dismissal behavior for mobile sheets. */
export class PhoneSheet extends Modal {
  constructor(app: App, title: string) {
    super(app);
    this.containerEl.addClass("pi-phone-sheet-container");
    this.modalEl.addClass("pi-phone-modal");
    this.titleEl.setText(title);
  }

  action(icon: string, label: string, run: () => void) {
    const button = this.contentEl.createEl("button", { cls: "pi-phone-sheet-action" });
    setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      this.close();
      run();
    });
  }
}
