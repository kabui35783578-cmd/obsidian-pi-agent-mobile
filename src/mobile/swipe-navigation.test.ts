import test from "node:test";
import assert from "node:assert/strict";
import { installSwipeNavigation } from "./swipe-navigation.ts";

function event(type: string, x: number, y: number, count = 1) {
  const e = new Event(type, { cancelable: true });
  Object.defineProperty(e, "touches", { value: Array.from({ length: count }, (_, i) => ({ clientX: x, clientY: y, identifier: i })) });
  return e;
}

test("horizontal swipes are intercepted and navigate inside the plugin", () => {
  const target = new EventTarget();
  let backs = 0, hostMoves = 0;
  const remove = installSwipeNavigation(target as unknown as Window, () => true, () => backs++);
  target.addEventListener("touchmove", () => hostMoves++);
  for (const [start, end] of [[180, 80], [20, 120]]) {
    target.dispatchEvent(event("touchstart", start, 50));
    const move = event("touchmove", end, 52);
    target.dispatchEvent(move);
    assert.equal(move.defaultPrevented, true);
    target.dispatchEvent(event("touchend", end, 52, 0));
  }
  assert.equal(backs, 2);
  assert.equal(hostMoves, 0);
  remove();
  target.dispatchEvent(event("touchmove", 80, 50));
  assert.equal(hostMoves, 1);
});

test("vertical scroll, taps, multitouch, and other views are untouched", () => {
  const target = new EventTarget();
  let active = true, backs = 0, hostMoves = 0;
  installSwipeNavigation(target as unknown as Window, () => active, () => backs++);
  target.addEventListener("touchmove", () => hostMoves++);
  target.dispatchEvent(event("touchstart", 20, 20));
  const vertical = event("touchmove", 24, 100);
  target.dispatchEvent(vertical);
  target.dispatchEvent(event("touchend", 24, 100, 0));
  assert.equal(vertical.defaultPrevented, false);
  target.dispatchEvent(event("touchstart", 20, 20));
  target.dispatchEvent(event("touchend", 20, 20, 0));
  target.dispatchEvent(event("touchstart", 20, 20, 2));
  target.dispatchEvent(event("touchmove", 120, 20, 2));
  active = false;
  target.dispatchEvent(event("touchstart", 20, 20));
  target.dispatchEvent(event("touchmove", 120, 20));
  target.dispatchEvent(event("touchend", 120, 20, 0));
  assert.equal(backs, 0);
  assert.equal(hostMoves, 3);
});

test("small horizontal motion cannot reach the host drawer", () => {
  const target = new EventTarget(); let hostMoves = 0, backs = 0;
  installSwipeNavigation(target as unknown as Window, () => true, () => backs++);
  target.addEventListener("touchmove", () => hostMoves++);
  target.dispatchEvent(event("touchstart", 100, 100));
  const ambiguous = event("touchmove", 98, 99);
  target.dispatchEvent(ambiguous);
  assert.equal(hostMoves, 0);
  assert.equal(ambiguous.defaultPrevented, false);
  const horizontal = event("touchmove", 94, 99);
  target.dispatchEvent(horizontal);
  assert.equal(horizontal.defaultPrevented, true);
  assert.equal(hostMoves, 0);
  target.dispatchEvent(event("touchend", 94, 99, 0));
  assert.equal(backs, 0);
});

test("a gesture captured in chat remains intercepted if active leaf changes mid-swipe", () => {
  const target = new EventTarget(); let active = true, hostMoves = 0, backs = 0;
  installSwipeNavigation(target as unknown as Window, () => active, () => backs++);
  target.addEventListener("touchmove", () => hostMoves++);
  target.dispatchEvent(event("touchstart", 150, 50));
  active = false;
  const move = event("touchmove", 70, 52);
  target.dispatchEvent(move);
  target.dispatchEvent(event("touchend", 70, 52, 0));
  assert.equal(move.defaultPrevented, true);
  assert.equal(hostMoves, 0);
  assert.equal(backs, 1);
});
