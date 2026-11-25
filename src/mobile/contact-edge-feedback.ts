/** Give the contact list elastic feedback at its edges while leaving ordinary scrolling native. */
export function installContactEdgeFeedback(list: HTMLElement, contacts: HTMLElement) {
  let gesture: { id: number; x: number; y: number; lastY: number; vertical: boolean } | undefined;
  let pull = 0;

  const clearPull = () => {
    if (!pull) return;
    pull = 0;
    delete list.dataset.edgePull;
    contacts.style.removeProperty("--pi-phone-edge-pull");
  };
  const reset = () => {
    gesture = undefined;
    clearPull();
  };

  list.addEventListener("touchstart", (event) => {
    reset();
    if (event.touches.length !== 1 || contacts.parentElement !== list) return;
    const { identifier, clientX, clientY } = event.touches[0];
    gesture = { id: identifier, x: clientX, y: clientY, lastY: clientY, vertical: false };
  }, { passive: true });

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
      if (dx >= 6 && dx >= Math.abs(dy)) {
        reset();
        return;
      }
      if (Math.abs(dy) < 6) return;
      gesture.vertical = true;
    }

    const step = touch.clientY - gesture.lastY;
    gesture.lastY = touch.clientY;
    if (!step) return;

    let next: number;
    if (pull) {
      next = pull + step;
      if (Math.sign(next) !== Math.sign(pull)) {
        clearPull();
        return;
      }
    } else {
      const atEdge = step > 0
        ? list.scrollTop <= 1
        : list.scrollHeight - list.clientHeight - list.scrollTop <= 1;
      if (!atEdge) return;
      next = step;
    }

    if (event.cancelable) event.preventDefault();
    pull = Math.max(-180, Math.min(180, next));
    // Resistance increases with distance so a long drag cannot move the list far.
    const offset = 48 * pull / (72 + Math.abs(pull));
    list.dataset.edgePull = pull > 0 ? "top" : "bottom";
    contacts.style.setProperty("--pi-phone-edge-pull", offset + "px");
  }, { passive: false });

  list.addEventListener("touchend", reset, { passive: true });
  list.addEventListener("touchcancel", reset, { passive: true });
  return reset;
}
