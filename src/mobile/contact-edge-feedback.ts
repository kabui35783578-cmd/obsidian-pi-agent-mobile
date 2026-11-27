/** Retain a pull hint for short lists and let long lists scroll natively. */
export function installContactEdgeFeedback(list: HTMLElement, contacts: HTMLElement) {
  let gesture: { id: number; x: number; y: number; vertical: boolean } | undefined;
  const win = list.ownerDocument.defaultView;
  const listeners = new AbortController();
  const passive = { passive: true, signal: listeners.signal };

  const reset = () => {
    gesture = undefined;
    delete list.dataset.edgePull;
    contacts.style.removeProperty("--pi-phone-edge-pull");
  };
  const measure = () => {
    const short = contacts.parentElement === list && list.scrollHeight <= list.clientHeight + 1;
    list.toggleAttribute("data-contact-short", short);
    if (!short) reset();
  };
  const observer = win?.ResizeObserver && new win.ResizeObserver(measure);
  observer?.observe(list);
  observer?.observe(contacts);
  measure();

  list.addEventListener("touchstart", (event) => {
    if (!list.hasAttribute("data-contact-short") || event.touches.length !== 1) return;
    reset();
    const { identifier, clientX, clientY } = event.touches[0];
    gesture = { id: identifier, x: clientX, y: clientY, vertical: false };
  }, passive);

  list.addEventListener("touchmove", (event) => {
    if (!gesture) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch.identifier !== gesture.id) {
      reset();
      return;
    }
    const dy = touch.clientY - gesture.y;
    if (!gesture.vertical) {
      const dx = Math.abs(touch.clientX - gesture.x);
      if (dx >= 6 && dx >= Math.abs(dy)) return reset();
      if (Math.abs(dy) < 6) return;
      gesture.vertical = true;
    }
    const pull = Math.max(-180, Math.min(180, dy));
    if (!pull) return reset();
    const offset = 48 * pull / (72 + Math.abs(pull));
    list.dataset.edgePull = pull > 0 ? "top" : "bottom";
    contacts.style.setProperty("--pi-phone-edge-pull", offset + "px");
  }, passive);

  list.addEventListener("touchend", reset, passive);
  list.addEventListener("touchcancel", reset, passive);
  return {
    reset,
    dispose() {
      listeners.abort();
      observer?.disconnect();
      reset();
      list.removeAttribute("data-contact-short");
    },
  };
}
