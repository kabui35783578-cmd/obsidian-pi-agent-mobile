/** Consume only the submitted command; never overwrite a newer draft on failure. */
export class CommandDraft {
  private original: string;
  private consumed = false;
  private edited = false;
  private retry = "";
  private onInput = () => {
    this.edited = true;
  };
  constructor(
    private input: HTMLTextAreaElement,
    private command: string,
    private changed: () => void,
  ) {
    this.original = input.value;
  }
  consume(execution: string) {
    if (
      this.consumed ||
      this.original.trim() !== this.command.trim() ||
      this.input.value !== this.original
    )
      return;
    this.consumed = true;
    this.retry =
      execution.trim() === this.original.trim() ? this.original : execution;
    this.input.addEventListener("input", this.onInput);
    this.input.value = "";
    this.changed();
  }
  restore() {
    if (!this.consumed || this.edited || this.input.value !== "") return;
    this.input.value = this.retry;
    this.changed();
  }
  dispose() {
    this.input.removeEventListener("input", this.onInput);
  }
}
