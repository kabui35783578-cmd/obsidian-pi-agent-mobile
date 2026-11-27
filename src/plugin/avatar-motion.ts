import {
  createEmotionBall,
  resolveEmotionAvatar,
  type AvatarRuntimeState,
  type EmotionBallEngine,
  type EmotionBallOptions,
  type EmotionIdleOptions,
} from "../shared/emotion-ball/index.ts";

export interface AvatarRenderOptions {
  live?: boolean;
  emotion?: string;
  eyeScale?: number;
  lite?: boolean;
  idle?: EmotionBallOptions["idle"];
}

export type AvatarMotionState = AvatarRuntimeState;

export interface AvatarMotionOptions {
  state?: AvatarMotionState;
  emotion?: string;
  interactive?: boolean;
  extraGazeRoot?: HTMLElement;
}

export interface AvatarMotionController {
  readonly avatar: HTMLElement;
  setState(state: AvatarMotionState, emotion?: string): void;
  wake(style?: "gentle" | "shake"): void;
  noteActivity(): void;
  disconnect(): void;
}

export const DEFAULT_AVATAR_IDLE: Readonly<EmotionIdleOptions> = {
  standbyAfter: 45_000,
  drowsyAfter: 120_000,
  sleepAfter: 180_000,
  standbyId: "04",
  drowsyId: "06",
  sleepId: "00",
};

const engines = new WeakMap<HTMLElement, EmotionBallEngine>();

function prefersReducedMotion(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView;
  return Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Only bundled Emotion Ball presets are rendered as interactive SVG; custom images and emoji stay untouched. */
export function renderAnimatedAvatar(
  el: HTMLElement,
  id: string,
  _seed: string,
  opts: AvatarRenderOptions = {},
): boolean {
  const preset = resolveEmotionAvatar(id);
  if (!preset) return false;

  const existing = engines.get(el);
  if (existing) {
    existing.destroy();
    engines.delete(el);
  }

  const live = opts.live ?? false;
  const eyeScale = opts.eyeScale ?? 1;
  const lite = opts.lite ?? !live;
  const emotion = opts.emotion ?? preset.emotion;

  const engine = createEmotionBall(el, {
    shape: preset.shape,
    color: preset.color,
    eyeColor: preset.eyeColor,
    emotion,
    eyeScale,
    lite,
    idle: opts.idle,
    autostart: false,
  });

  engines.set(el, engine);
  el.classList.add("pi-avatar-animated", "pi-eb-avatar");
  el.dataset.avatarId = id;
  el.dataset.avatarEmotion = engine.emotionId ?? emotion;
  engine.on("change", () => {
    if (engine.emotionId) el.dataset.avatarEmotion = engine.emotionId;
  });

  if (live && !prefersReducedMotion(el)) {
    engine.setActive(true);
  }
  return true;
}

export function getAvatarEngine(el: HTMLElement): EmotionBallEngine | undefined {
  return engines.get(el);
}

export function setAvatarEmotion(el: HTMLElement, emotionId: string): boolean {
  const engine = engines.get(el);
  if (!engine) return false;
  if (engine.emotionId === emotionId) return true;
  const ok = engine.setEmotion(emotionId);
  el.dataset.avatarEmotion = engine.emotionId ?? emotionId;
  return ok;
}

export function destroyAvatar(root: HTMLElement): void {
  const own = engines.get(root);
  if (own) {
    own.destroy();
    engines.delete(root);
  }
  for (const node of root.querySelectorAll<HTMLElement>(".pi-eb-avatar")) {
    const engine = engines.get(node);
    if (engine) {
      engine.destroy();
      engines.delete(node);
    }
  }
}

function attachVisibilityAndReducedMotion(
  avatar: HTMLElement,
  shouldRun: () => boolean,
  onReduced?: () => void,
): () => void {
  const doc = avatar.ownerDocument;
  const view = doc.defaultView;
  const preference = view?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let intersecting = true;

  const sync = () => {
    const engine = engines.get(avatar);
    const reduced = Boolean(preference?.matches);
    const active = !reduced && !doc.hidden && intersecting && shouldRun();
    avatar.classList.toggle("is-motion-paused", !active);
    if (engine) engine.setActive(active);
    if (reduced) onReduced?.();
  };

  let observer: IntersectionObserver | undefined;
  if (view?.IntersectionObserver) {
    observer = new view.IntersectionObserver(([entry]) => {
      intersecting = entry ? entry.isIntersecting : true;
      sync();
    });
    observer.observe(avatar);
  }

  const onVisibility = () => sync();
  const onPreference = () => sync();
  doc.addEventListener("visibilitychange", onVisibility);
  preference?.addEventListener("change", onPreference);
  sync();

  return () => {
    observer?.disconnect();
    doc.removeEventListener("visibilitychange", onVisibility);
    preference?.removeEventListener("change", onPreference);
  };
}

/** Hover preview for static avatar options in the editor picker. */
export function attachHoverPreview(trigger: HTMLElement, avatarEl: HTMLElement): () => void {
  let hovering = false;
  const presetId = avatarEl.dataset.avatarId ?? "";
  const presetEmotion = resolveEmotionAvatar(presetId)?.emotion ?? "02";

  const stop = attachVisibilityAndReducedMotion(avatarEl, () => hovering);

  const onEnter = () => {
    if (prefersReducedMotion(avatarEl)) return;
    hovering = true;
    const engine = engines.get(avatarEl);
    if (engine) {
      engine.setActive(true);
      engine.replay();
    }
  };
  const onLeave = () => {
    hovering = false;
    const engine = engines.get(avatarEl);
    if (engine) {
      engine.setActive(false);
      engine.setEmotion(presetEmotion, { auto: true });
      avatarEl.dataset.avatarEmotion = engine.emotionId ?? presetEmotion;
    }
  };

  trigger.addEventListener("pointerenter", onEnter);
  trigger.addEventListener("pointerleave", onLeave);

  return () => {
    hovering = false;
    trigger.removeEventListener("pointerenter", onEnter);
    trigger.removeEventListener("pointerleave", onLeave);
    stop();
    destroyAvatar(avatarEl);
  };
}

/** Lifecycle binding for a live working/preview avatar without pointer gaze. */
export function connectWorkingAvatar(avatar: HTMLElement): () => void {
  const stop = attachVisibilityAndReducedMotion(avatar, () => true);
  return () => {
    stop();
    destroyAvatar(avatar);
  };
}

/** Live state controller with optional pointer gaze, sleep/wake handling, and lifecycle guards. */
export function createAvatarMotionController(
  avatar: HTMLElement,
  region?: HTMLElement,
  opts: AvatarMotionOptions = {},
): AvatarMotionController {
  const interactive = opts.interactive ?? Boolean(region);
  if (interactive) avatar.classList.add("pi-avatar-interactive");

  const doc = avatar.ownerDocument;
  const view = doc.defaultView;
  const preference = view?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const reduced = () => Boolean(preference?.matches);
  const restEmotion = resolveEmotionAvatar(avatar.dataset.avatarId ?? "")?.emotion ?? "02";

  const clearGaze = () => {
    avatar.style.removeProperty("--pi-gaze-x");
    avatar.style.removeProperty("--pi-gaze-y");
    avatar.style.removeProperty("--pi-avatar-lean");
    engines.get(avatar)?.clearGaze();
  };

  const stopLifecycle = attachVisibilityAndReducedMotion(avatar, () => true, clearGaze);

  let currentState: AvatarMotionState = opts.state ?? "idle";
  let transientTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnected = false;

  const clearTimers = () => {
    if (transientTimer !== undefined) {
      clearTimeout(transientTimer);
      transientTimer = undefined;
    }
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer);
      settleTimer = undefined;
    }
  };

  const applyState = (nextState: AvatarMotionState, nextEmotion?: string) => {
    if (disconnected) return;
    clearTimers();
    currentState = nextState;
    avatar.dataset.avatarState = nextState;
    avatar.classList.toggle("is-working", nextState === "working" || nextState === "waiting");
    avatar.classList.toggle("is-complete", nextState === "complete");

    const engine = engines.get(avatar);
    if (!engine) return;

    switch (nextState) {
      case "working":
      case "waiting":
        engine.setIdleEnabled(false);
        setAvatarEmotion(avatar, nextEmotion ?? (nextState === "waiting" ? "35" : "30"));
        break;
      case "composing":
        engine.setIdleEnabled(false);
        if (engine.isSleeping()) engine.wake("gentle", "35");
        else setAvatarEmotion(avatar, nextEmotion ?? "35");
        break;
      case "complete":
        engine.setIdleEnabled(false);
        setAvatarEmotion(avatar, nextEmotion ?? "33");
        transientTimer = setTimeout(() => {
          transientTimer = undefined;
          if (disconnected || !avatar.isConnected || currentState !== "complete") return;
          avatar.classList.remove("is-complete");
          setAvatarEmotion(avatar, "19");
          settleTimer = setTimeout(() => {
            settleTimer = undefined;
            if (disconnected || !avatar.isConnected || currentState !== "complete") return;
            currentState = "idle";
            avatar.dataset.avatarState = "idle";
            setAvatarEmotion(avatar, restEmotion);
            engines.get(avatar)?.setIdleEnabled(true);
          }, 5000);
        }, 2600);
        break;
      case "cancelled":
        engine.setIdleEnabled(false);
        setAvatarEmotion(avatar, nextEmotion ?? "41");
        transientTimer = setTimeout(() => {
          transientTimer = undefined;
          if (disconnected || !avatar.isConnected || currentState !== "cancelled") return;
          currentState = "idle";
          avatar.dataset.avatarState = "idle";
          setAvatarEmotion(avatar, restEmotion);
          engines.get(avatar)?.setIdleEnabled(true);
        }, 2800);
        break;
      case "paused":
        engine.setIdleEnabled(false);
        setAvatarEmotion(avatar, nextEmotion ?? "38");
        break;
      case "error":
        engine.setIdleEnabled(false);
        setAvatarEmotion(avatar, nextEmotion ?? "34");
        break;
      case "idle":
      default:
        engine.setIdleEnabled(true);
        if (!(engine.isIdleStage() && nextEmotion === undefined)) {
          setAvatarEmotion(avatar, nextEmotion ?? restEmotion);
        }
        break;
    }
  };

  applyState(opts.state ?? "idle", opts.emotion);

  const move = (event: PointerEvent) => {
    if (reduced() || event.pointerType === "touch") return;
    const box = avatar.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const nx = Math.max(-1, Math.min(1, (event.clientX - box.left - box.width / 2) / 140));
    const ny = Math.max(-1, Math.min(1, (event.clientY - box.top - box.height / 2) / 140));
    avatar.style.setProperty("--pi-gaze-x", `${(nx * 2.7).toFixed(2)}px`);
    avatar.style.setProperty("--pi-gaze-y", `${(ny * 2).toFixed(2)}px`);
    engines.get(avatar)?.setGaze(nx, ny);
  };

  const onRegionEnter = () => {
    if (currentState !== "idle") return;
    const engine = engines.get(avatar);
    if (!engine) return;
    if (engine.isSleeping()) {
      engine.wake("gentle", restEmotion);
    } else if (engine.isIdleStage()) {
      engine.resetIdle();
      setAvatarEmotion(avatar, restEmotion);
    } else {
      engine.resetIdle();
    }
  };

  const button = interactive ? avatar.parentElement : null;
  const greet = () => {
    if (reduced()) return;
    const engine = engines.get(avatar);
    if (!engine) return;
    if (engine.isSleeping()) {
      engine.wake("shake", restEmotion);
      return;
    }
    if (currentState === "error") {
      applyState("idle", restEmotion);
      engine.spin(1);
      return;
    }
    engine.resetIdle();
    if (currentState === "idle" && engine.isIdleStage()) {
      setAvatarEmotion(avatar, restEmotion);
    }
    engine.spin(1);
  };

  const gazeRoots: HTMLElement[] = [];
  if (interactive && region) {
    gazeRoots.push(region);
    if (opts.extraGazeRoot && opts.extraGazeRoot !== region) {
      gazeRoots.push(opts.extraGazeRoot);
    }
    for (const root of gazeRoots) {
      root.addEventListener("pointermove", move, { passive: true });
      root.addEventListener("pointerleave", clearGaze);
    }
    region.addEventListener("pointerenter", onRegionEnter);
    button?.addEventListener("click", greet);
  }

  return {
    avatar,
    setState(state: AvatarMotionState, emotion?: string) {
      applyState(state, emotion);
    },
    wake(style: "gentle" | "shake" = "gentle") {
      const engine = engines.get(avatar);
      if (!engine || currentState !== "idle") return;
      engine.wake(style, restEmotion);
    },
    noteActivity() {
      engines.get(avatar)?.resetIdle();
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      clearTimers();
      stopLifecycle();
      for (const root of gazeRoots) {
        root.removeEventListener("pointermove", move);
        root.removeEventListener("pointerleave", clearGaze);
      }
      if (interactive && region) {
        region.removeEventListener("pointerenter", onRegionEnter);
        button?.removeEventListener("click", greet);
      }
      destroyAvatar(avatar);
    },
  };
}

/** Local pointer gaze, click spin, completion celebration, and lifecycle guards for the featured avatar. */
export function connectAvatarMotion(
  avatar: HTMLElement,
  region: HTMLElement,
  opts: AvatarMotionOptions = {},
): () => void {
  const controller = createAvatarMotionController(avatar, region, { ...opts, interactive: true });
  return () => controller.disconnect();
}
