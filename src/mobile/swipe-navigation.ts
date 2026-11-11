/** Prevent Obsidian's horizontal drawer gesture while the phone view is active. */
export function installSwipeNavigation(
  target: Window,
  active: () => boolean,
  back: () => void,
) {
  let start: { x: number; y: number; id: number } | undefined;
  let direction: "horizontal" | "vertical" | undefined;
  let distance = 0;
  const reset = () => { start = undefined; direction = undefined; distance = 0; };
  const begin = (event: TouchEvent) => {
    reset();
    if (!active() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
  };
  const move = (event: TouchEvent) => {
    if (!start || !active() || event.touches.length !== 1) { reset(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== start.id) { reset(); return; }
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (!direction && Math.max(Math.abs(dx), Math.abs(dy)) >= 8)
      direction = Math.abs(dx) > Math.abs(dy) * 1.2 ? "horizontal" : "vertical";
    if (direction === "horizontal") {
      distance = dx;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const end = (event: TouchEvent) => {
    if (start && active() && direction === "horizontal") {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      if (Math.abs(distance) >= 60) back();
    }
    reset();
  };
  target.addEventListener("touchstart", begin, { capture: true, passive: true });
  target.addEventListener("touchmove", move, { capture: true, passive: false });
  target.addEventListener("touchend", end, { capture: true, passive: false });
  target.addEventListener("touchcancel", reset, true);
  return () => {
    target.removeEventListener("touchstart", begin, true);
    target.removeEventListener("touchmove", move, true);
    target.removeEventListener("touchend", end, true);
    target.removeEventListener("touchcancel", reset, true);
    reset();
  };
}
