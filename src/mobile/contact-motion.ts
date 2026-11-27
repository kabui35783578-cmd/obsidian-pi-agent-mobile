/** Keep small avatar animations in CSS and let native scrolling run first. */
export function installContactMotion(list: HTMLElement, onSettled: () => void) {
  const win = list.ownerDocument.defaultView;
  const tracked = new Set<HTMLElement>();
  let timer: number | undefined;
  const observer = win?.IntersectionObserver && new win.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const avatar = entry.target as HTMLElement;
      if (tracked.has(avatar)) avatar.toggleAttribute("data-contact-visible", entry.isIntersecting);
    }
  }, { root: list });

  const reset = () => {
    win?.clearTimeout(timer);
    timer = undefined;
    delete list.dataset.contactScrolling;
  };
  const scroll = () => {
    if (!win) return;
    if (timer === undefined) list.dataset.contactScrolling = "";
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      reset();
      onSettled();
    }, 140);
  };
  list.addEventListener("scroll", scroll, { passive: true });

  return {
    get scrolling() { return timer !== undefined; },
    sync() {
      const avatars = new Set(list.querySelectorAll<HTMLElement>(
        ":is(.pi-phone-favorite, .pi-phone-contact) .pi-eb-avatar",
      ));
      for (const avatar of tracked) {
        if (avatars.has(avatar)) continue;
        observer?.unobserve(avatar);
        avatar.removeAttribute("data-contact-visible");
        tracked.delete(avatar);
      }
      for (const avatar of avatars) {
        if (tracked.has(avatar)) continue;
        tracked.add(avatar);
        const id = avatar.dataset.phoneAvatar ?? "";
        const offset = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 60;
        avatar.style.setProperty("--pi-phone-contact-motion-delay", -offset / 10 + "s");
        const eyes = avatar.querySelectorAll(".pi-eb-eye-left, .pi-eb-eye-right");
        for (const eye of eyes) {
          if (eye.parentElement?.classList.contains("pi-phone-contact-eye")) continue;
          const lid = eye.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
          lid.setAttribute("class", "pi-phone-contact-eye");
          eye.before(lid);
          lid.append(eye);
        }
        observer?.observe(avatar);
        if (!observer) avatar.setAttribute("data-contact-visible", "");
      }
    },
    reset,
    dispose() {
      reset();
      observer?.disconnect();
      for (const avatar of tracked) avatar.removeAttribute("data-contact-visible");
      tracked.clear();
      list.removeEventListener("scroll", scroll);
    },
  };
}
