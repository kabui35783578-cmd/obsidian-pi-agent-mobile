// Ported from https://github.com/jackyrx/NX_emotion-ball (commit b4f97df96c022e08e24afad266dddf5f62cfb5fd)
import { createBall, type BallBodyPose, type BallEyePose, type BallPose, type BallRenderer } from "./ball.ts";
import {
  EMOTION_GROUPS,
  EMOTION_SEED,
  type BodyPoseSpec,
  type EmotionAnim,
  type EmotionGroupDef,
  type EmotionGroupKey,
  type EmotionSeedDef,
  type EmotionSettle,
  type EyePoseSpec,
} from "./emotions.ts";
import { EB_RINGS, type EmotionShapeKey, type Ring } from "./rings.ts";

const EXPR = EB_RINGS.EXPRESSIONS;
const TAU = Math.PI * 2;
const FALLBACK_ID = "02";

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface SpringState {
  x: number;
  v: number;
  t: number;
}

function spring(v0: number): SpringState {
  return { x: v0, v: 0, t: v0 };
}

function springStep(s: SpringState, w: number, z: number, dt: number) {
  s.v += (-2 * z * w * s.v - w * w * (s.x - s.t)) * dt;
  s.x += s.v * dt;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = s.t;
    s.v = 0;
  }
}

function lerpRing(a: Ring, b: Ring, t: number): [number, number][] {
  const out = new Array<[number, number]>(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = [a[i][0] + (b[i][0] - a[i][0]) * t, a[i][1] + (b[i][1] - a[i][1]) * t];
  }
  return out;
}

const BOUNCE_SEGS = [
  { h: 48, d: 0.5 },
  { h: 28, d: 0.382 },
  { h: 14, d: 0.27 },
  { h: 6, d: 0.177 },
] as const;
const BOUNCE_TOTAL = BOUNCE_SEGS.reduce((s, q) => s + q.d, 0);

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function lerpColor(a: string, b: string, t: number): string {
  if (a === b) return b;
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}

const DEFAULT_BODY: BallBodyPose = {
  x: 0,
  y: 0,
  scale: 1,
  rotate: 0,
  color: "#F3F0EA",
  breathe: 0.01,
  ribbons: 0,
  confetti: 0,
  sketch: 0,
  zzz: 0,
  orbit: 0,
};

const DEFAULT_EYE: BallEyePose = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  open: 1,
  color: "#1A1A1A",
  lookX: 0,
  lookY: 0,
};

function defaultPose(): BallPose {
  return {
    body: { ...DEFAULT_BODY },
    left: { ...DEFAULT_EYE },
    right: { ...DEFAULT_EYE },
  };
}

function clonePose(p: BallPose): BallPose {
  return {
    body: { ...p.body },
    left: { ...p.left },
    right: { ...p.right },
  };
}

interface PoseSpec {
  body?: BodyPoseSpec;
  eyes?: {
    both?: EyePoseSpec;
    left?: EyePoseSpec;
    right?: EyePoseSpec;
  };
}

function applySpec(pose: BallPose, spec?: PoseSpec): BallPose {
  if (!spec) return pose;
  if (spec.body) Object.assign(pose.body, spec.body);
  const e = spec.eyes;
  if (e) {
    if (e.both) {
      Object.assign(pose.left, e.both);
      Object.assign(pose.right, e.both);
    }
    if (e.left) Object.assign(pose.left, e.left);
    if (e.right) Object.assign(pose.right, e.right);
  }
  return pose;
}

function lerpPose(a: BallPose, b: BallPose, t: number): BallPose {
  const out = defaultPose();
  (["body", "left", "right"] as const).forEach((part) => {
    const pa = a[part] as unknown as Record<string, unknown>;
    const pb = b[part] as unknown as Record<string, unknown>;
    const po = out[part] as unknown as Record<string, unknown>;
    for (const k in pb) {
      const vb = pb[k];
      const va = pa[k];
      if (typeof vb === "number") {
        po[k] = lerp(typeof va === "number" ? va : vb, vb, t);
      } else if (k === "color" && typeof vb === "string") {
        po[k] = lerpColor(typeof va === "string" ? va : vb, vb, t);
      } else {
        po[k] = vb;
      }
    }
  });
  return out;
}

type AnimFn = (a: EmotionAnim, t: number, eng: EmotionBallEngine) => number;

const ANIM_TYPES: Record<EmotionAnim["type"], AnimFn> = {
  sine(a, t) {
    return (a.amp ?? 0) * Math.sin((TAU * t) / (a.period || 2000) + (a.phase || 0));
  },
  pulse(a, t) {
    return (a.amp ?? 0) * 0.5 * (1 - Math.cos((TAU * t) / (a.period || 1000) + (a.phase || 0)));
  },
  jitter(a, t, eng) {
    const s = (t / 1000) * (a.speed || 8);
    let v =
      ((Math.sin(s * 3.1 + eng._seed) +
        Math.sin(s * 5.7 + eng._seed * 2.3) +
        Math.sin(s * 9.3 + eng._seed * 4.1)) /
        3) *
      (a.amp ?? 0);
    if (a.decay) v *= clamp(1 - t / a.decay, 0, 1);
    return v;
  },
  scan(a, t) {
    const per = a.period || 800;
    const p = ((t + (a.phaseMs || 0)) % per) / per;
    const tri = p < 0.5 ? p * 4 - 1 : 3 - p * 4;
    return (a.amp ?? 0) * tri;
  },
  glance(a, t) {
    const per = a.period || 3600;
    const ph = TAU * (((t + (a.phaseMs || 0)) % per) / per) + (a.phase || 0);
    return (a.amp ?? 0) * Math.tanh(2.8 * Math.sin(ph));
  },
  blink(a, t, eng) {
    const interval = a.interval || 3800;
    const dur = a.dur || 200;
    const p = (t + (a.phaseMs || 0) + eng._seed * 97) % interval;
    if (p >= dur) return 0;
    return -(a.depth == null ? 1 : a.depth) * Math.sin(Math.PI * (p / dur));
  },
};

function applyAnim(pose: BallPose, a: EmotionAnim, t: number, eng: EmotionBallEngine) {
  const fn = ANIM_TYPES[a.type];
  if (!fn) return;
  const v = fn(a, t, eng);
  const targets: (BallBodyPose | BallEyePose)[] =
    a.target === "eyes"
      ? [pose.left, pose.right]
      : a.target === "body"
        ? [pose.body]
        : a.target === "left"
          ? [pose.left]
          : a.target === "right"
            ? [pose.right]
            : [];
  for (let i = 0; i < targets.length; i++) {
    const tg = targets[i];
    if (a.prop === "scale") {
      if (tg === pose.body) tg.scale += v;
      else {
        const eye = tg as BallEyePose;
        eye.scaleX += v;
        eye.scaleY += v;
      }
    } else if (a.prop in tg) {
      const record = tg as unknown as Record<string, unknown>;
      const cur = record[a.prop];
      if (typeof cur === "number") record[a.prop] = cur + v;
    }
  }
}

export interface NormalizedEmotion {
  id: string;
  name: string;
  group: EmotionGroupKey;
  desc: string;
  en: { name: string; desc: string } | null;
  gaze: boolean;
  transition: number;
  pool: number[];
  poolMs: [number, number];
  poolSpeed: number;
  blinkMs: [number, number] | null;
  openness: number;
  antics: boolean;
  base: BallPose;
  anims: EmotionAnim[];
  sequence: {
    frames: { at: number; pose: BallPose }[];
    settle: EmotionSettle;
  } | null;
  raw: EmotionSeedDef;
}

const GROUPS: EmotionGroupDef[] = EMOTION_GROUPS.map((g) => ({ ...g }));
const registry = new Map<string, NormalizedEmotion>();
const order: string[] = [];

function knownGroup(g: unknown): g is EmotionGroupKey {
  return GROUPS.some((x) => x.key === g);
}

function validate(raw: EmotionSeedDef): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") {
    errs.push("配置必须是对象");
    return errs;
  }
  if (typeof raw.id !== "string" || !raw.id.trim()) errs.push("缺少合法的字符串 id");
  if (typeof raw.name !== "string" || !raw.name.trim()) errs.push("缺少 name");
  if (!knownGroup(raw.group)) errs.push(`group 不合法：${String(raw.group)}`);
  if (raw.anims != null) {
    if (!Array.isArray(raw.anims)) errs.push("anims 必须是数组");
    else {
      raw.anims.forEach((a, i) => {
        if (!a || !ANIM_TYPES[a.type]) errs.push(`anims[${i}] 未知动画类型：${a?.type}`);
      });
    }
  }
  if (raw.sequence != null && !Array.isArray(raw.sequence.frames)) {
    errs.push("sequence.frames 必须是数组");
  }
  return errs;
}

function normalize(raw: EmotionSeedDef): NormalizedEmotion {
  const base = applySpec(defaultPose(), raw);
  let pool = (raw.pool || [0, 8]).filter((i) => i >= 0 && i < EXPR.length);
  if (!pool.length) pool = [0];
  const def: NormalizedEmotion = {
    id: raw.id,
    name: raw.name,
    group: raw.group,
    desc: raw.desc || "",
    en: raw.en || null,
    gaze: raw.gaze !== false,
    transition: raw.transition != null ? raw.transition : 500,
    pool,
    poolMs: raw.poolMs || [9000, 16000],
    poolSpeed: raw.poolSpeed || 6,
    blinkMs: raw.blinkMs !== undefined ? raw.blinkMs : [6000, 14000],
    openness: raw.openness != null ? raw.openness : 1,
    antics: !!raw.antics,
    base,
    anims: (raw.anims || []).map((a) => ({ ...a })),
    sequence: null,
    raw,
  };
  if (raw.sequence) {
    const frames = raw.sequence.frames
      .map((f) => ({ at: f.at || 0, pose: applySpec(clonePose(base), f) }))
      .sort((x, y) => x.at - y.at);
    def.sequence = { frames, settle: raw.sequence.settle || "base" };
  }
  return def;
}

function register(raw: EmotionSeedDef): { ok: boolean; id?: string; errors?: string[] } {
  const errs = validate(raw);
  if (errs.length) return { ok: false, id: raw?.id, errors: errs };
  const def = normalize(raw);
  if (!registry.has(def.id)) order.push(def.id);
  registry.set(def.id, def);
  return { ok: true, id: def.id };
}

for (const raw of EMOTION_SEED) {
  register(raw);
}

export const emotionConfig = {
  register,
  get(id: string): NormalizedEmotion | null {
    return registry.get(id) || null;
  },
  list(group?: EmotionGroupKey): NormalizedEmotion[] {
    return order
      .map((id) => registry.get(id)!)
      .filter((d) => !group || d.group === group);
  },
  groups(): EmotionGroupDef[] {
    return GROUPS.map((g) => ({ key: g.key, name: g.name, en: g.en || g.name }));
  },
  exportConfig(): string {
    return JSON.stringify(
      order.map((id) => registry.get(id)!.raw),
      null,
      2,
    );
  },
  importConfig(json: string | EmotionSeedDef | EmotionSeedDef[]) {
    let data: EmotionSeedDef | EmotionSeedDef[];
    try {
      data = typeof json === "string" ? (JSON.parse(json) as EmotionSeedDef | EmotionSeedDef[]) : json;
    } catch (e) {
      return {
        ok: false,
        added: 0,
        errors: [`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`],
      };
    }
    const arr = Array.isArray(data) ? data : [data];
    let added = 0;
    const errors: string[] = [];
    for (const raw of arr) {
      const r = register(raw);
      if (r.ok) added++;
      else errors.push(`[${raw?.id || "?"}] ${(r.errors || []).join("；")}`);
    }
    return { ok: errors.length === 0, added, errors };
  },
};

interface TickerHost {
  requestAnimationFrame?: (cb: (now: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
}

interface TickerBucket {
  set: Set<EmotionBallEngine>;
  raf: number;
}

const tickerBuckets = new WeakMap<object, TickerBucket>();

function getTickerHost(svg: SVGSVGElement): object {
  return svg.ownerDocument?.defaultView ?? globalThis;
}

function getTickerBucket(host: object): TickerBucket {
  let bucket = tickerBuckets.get(host);
  if (!bucket) {
    bucket = { set: new Set(), raf: 0 };
    tickerBuckets.set(host, bucket);
  }
  return bucket;
}

function scheduleTicker(host: object, bucket: TickerBucket) {
  if (bucket.raf || bucket.set.size === 0) return;
  const rafFn =
    (host as TickerHost).requestAnimationFrame ??
    (typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame : undefined);
  if (!rafFn) return;
  bucket.raf = rafFn.call(host, (now: number) => {
    bucket.raf = 0;
    for (const engine of Array.from(bucket.set)) {
      if (!engine.ball.svg.isConnected) {
        engine.destroy();
        continue;
      }
      engine._tick(now);
    }
    if (bucket.set.size > 0) scheduleTicker(host, bucket);
  });
}

function addToTicker(engine: EmotionBallEngine) {
  const host = getTickerHost(engine.ball.svg);
  const bucket = getTickerBucket(host);
  bucket.set.add(engine);
  scheduleTicker(host, bucket);
}

function removeFromTicker(engine: EmotionBallEngine) {
  const host = getTickerHost(engine.ball.svg);
  const bucket = tickerBuckets.get(host);
  if (!bucket) return;
  bucket.set.delete(engine);
  if (bucket.set.size === 0 && bucket.raf) {
    const cancelFn =
      (host as TickerHost).cancelAnimationFrame ??
      (typeof globalThis.cancelAnimationFrame === "function" ? globalThis.cancelAnimationFrame : undefined);
    cancelFn?.call(host, bucket.raf);
    bucket.raf = 0;
  }
}

export interface EmotionIdleOptions {
  standbyAfter?: number;
  drowsyAfter?: number;
  sleepAfter?: number;
  standbyId?: string;
  drowsyId?: string;
  sleepId?: string;
}

export interface EmotionBallOptions {
  emotion?: string;
  shape?: EmotionShapeKey;
  color?: string;
  eyeColor?: string;
  eyeScale?: number;
  idle?: boolean | EmotionIdleOptions;
  autostart?: boolean;
  lite?: boolean;
  fallbackId?: string;
  label?: string;
}

interface IdleConfig {
  standbyAfter: number;
  drowsyAfter?: number;
  sleepAfter: number;
  standbyId: string;
  drowsyId: string;
  sleepId: string;
}

/** Stateful SVG expression driver for a single Emotion Ball avatar. */
export class EmotionBallEngine {
  readonly ball: BallRenderer;
  _seed: number;
  private _events: Record<string, ((payload: unknown) => void)[]> = {};
  private _gaze = { x: 0, y: 0, tx: 0, ty: 0 };
  private _style = { sketch: 0 };
  private _theme: { body: string; eyes: string } | null;
  private _eyeScale: number;
  private _lastTick = 0;
  private _dt = 1 / 60;
  private _spin: SpringState | null = null;

  private _ringSrc: [Ring, Ring] = [EXPR[0][0], EXPR[0][1]];
  private _ringDst: [Ring, Ring] = [EXPR[0][0], EXPR[0][1]];
  private _ringCur: [Ring, Ring] = this._ringDst;
  private _ringSpring = spring(1);
  private _ringSpeed = 7;
  private _exprIdx = 0;
  private _poolPos = 0;
  private _poolNext = 0;

  private _open = spring(1);
  private _blinkQ: { at: number; v: number }[] = [];
  private _blinkNext = Infinity;

  private _anticNext = 0;
  private _bounceAt = -1;

  private _def: NormalizedEmotion | null = null;
  private _lastPose: BallPose | null = null;
  private _prevPose: BallPose | null = null;
  private _transStart = 0;
  private _transDur = 0;
  private _emoStart = 0;
  private _seq: { frames: { at: number; pose: BallPose }[]; settle: EmotionSettle; done: boolean } | null = null;
  private _active = false;
  private _touring = false;
  private _tourTimer: ReturnType<typeof setInterval> | null = null;
  private _fallbackId: string;
  private _lastActivity: number;
  private _idle: IdleConfig | null;
  private _idleEnabled = true;
  private _wakeNext: string | null = null;
  private _destroyed = false;

  constructor(container: HTMLElement, opts: EmotionBallOptions = {}) {
    this.ball = createBall(container, {
      shape: opts.shape,
      lite: opts.lite != null ? opts.lite : opts.autostart === false,
      label: opts.label,
    });
    this._seed = Math.random() * 100;
    this._theme = opts.color ? { body: opts.color, eyes: opts.eyeColor || "#1A1A1A" } : null;
    this._eyeScale = opts.eyeScale || 1;
    this._fallbackId = opts.fallbackId || FALLBACK_ID;
    this._lastActivity = performance.now();

    if (opts.idle === true) {
      this._idle = {
        standbyAfter: 45000,
        drowsyAfter: 120000,
        sleepAfter: 180000,
        standbyId: "04",
        drowsyId: "06",
        sleepId: "00",
      };
    } else if (opts.idle) {
      this._idle = {
        standbyAfter: opts.idle.standbyAfter ?? 60000,
        drowsyAfter: opts.idle.drowsyAfter,
        sleepAfter: opts.idle.sleepAfter ?? 180000,
        standbyId: opts.idle.standbyId ?? "02",
        drowsyId: opts.idle.drowsyId ?? "06",
        sleepId: opts.idle.sleepId ?? "00",
      };
    } else {
      this._idle = null;
    }

    this.setEmotion(opts.emotion || this._fallbackId, { auto: true });
    if (opts.autostart !== false) this.setActive(true);
    else this.renderStatic();
  }

  on(evt: string, cb: (payload: unknown) => void): this {
    (this._events[evt] = this._events[evt] || []).push(cb);
    return this;
  }

  off(evt: string, cb: (payload: unknown) => void): this {
    const list = this._events[evt];
    if (list) {
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    }
    return this;
  }

  private _emit(evt: string, payload: unknown) {
    for (const cb of (this._events[evt] || []).slice()) {
      try {
        cb(payload);
      } catch (e) {
        console.error(e);
      }
    }
  }

  get emotionId(): string | null {
    return this._def ? this._def.id : null;
  }

  get active(): boolean {
    return this._active;
  }

  get touring(): boolean {
    return this._touring;
  }

  get gaze(): { tx: number; ty: number; x: number; y: number } {
    return { ...this._gaze };
  }

  setEmotion(id: string, o: { auto?: boolean; keepWakeNext?: boolean } = {}): boolean {
    if (this._destroyed) return false;
    let def = emotionConfig.get(id);
    if (!def) {
      this._emit("error", { message: `未知表情 ID "${id}"，已回退待机`, id });
      def = emotionConfig.get(this._fallbackId);
      if (!def) return false;
    }
    const now = performance.now();
    const prevId = this._def ? this._def.id : null;
    if (!o.keepWakeNext) this._wakeNext = null;
    this._prevPose = this._lastPose ? clonePose(this._lastPose) : null;
    this._def = def;
    this._emoStart = now;
    this._transStart = now;
    this._transDur = this._prevPose ? def.transition : 0;
    this._seq = def.sequence
      ? { frames: def.sequence.frames, settle: def.sequence.settle, done: false }
      : null;
    if (!o.auto) this._lastActivity = now;

    this._poolPos = 0;
    this._setExpr(def.pool[0], def.poolSpeed >= 10 ? 10 : 8);
    this._poolNext = now + rand(def.poolMs[0], def.poolMs[1]);
    if (prevId !== null && prevId !== def.id && def.blinkMs) this._blinkNow(now);
    this._blinkNext = def.blinkMs ? now + rand(def.blinkMs[0], def.blinkMs[1]) : Infinity;
    this._anticNext = now + rand(2500, 5000);

    this._emit("change", { id: def.id, def, auto: !!o.auto });
    if (this._active) {
      const fx = def.base.body;
      if (fx.ribbons > 0) this.spin(fx.ribbons >= 1 ? 2 : 1);
      if (fx.confetti > 0) this.burst(20);
    }
    if (!this._active) this.renderStatic();
    return true;
  }

  handleAIMessage(msg: unknown): boolean {
    let obj: unknown = msg;
    if (typeof msg === "string") {
      try {
        obj = JSON.parse(msg);
      } catch {
        this._emit("error", { message: "AI 消息 JSON 解析失败，已回退待机", raw: msg });
        this.setEmotion(this._fallbackId);
        return false;
      }
    }
    if (!obj || typeof obj !== "object" || typeof (obj as Record<string, unknown>).emotionId !== "string") {
      this._emit("error", { message: "AI 消息缺少 emotionId 字段，已回退待机", raw: msg });
      this.setEmotion(this._fallbackId);
      return false;
    }
    const record = obj as { emotionId: string; tips?: unknown };
    const ok = this.setEmotion(record.emotionId);
    if (record.tips) this._emit("tips", { text: String(record.tips) });
    return ok;
  }

  startTour(ids: string[], interval = 2500) {
    this.stopTour();
    if (!ids?.length) return;
    this._touring = true;
    let i = 0;
    this.setEmotion(ids[0], { auto: true });
    this._tourTimer = setInterval(() => {
      i = (i + 1) % ids.length;
      this.setEmotion(ids[i], { auto: true });
    }, interval);
  }

  stopTour() {
    if (this._tourTimer !== null) {
      clearInterval(this._tourTimer);
      this._tourTimer = null;
    }
    this._touring = false;
    this._lastActivity = performance.now();
  }

  resetIdle(now = performance.now()) {
    this._lastActivity = now;
  }

  setIdleEnabled(enabled: boolean, now = performance.now()) {
    this._idleEnabled = enabled;
    if (enabled) this._lastActivity = now;
  }

  isSleeping(): boolean {
    const id = this._def?.id;
    if (!id) return false;
    return (
      id === "00" ||
      id === "06" ||
      id === this._idle?.sleepId ||
      id === this._idle?.drowsyId
    );
  }

  isIdleStage(): boolean {
    const id = this._def?.id;
    if (!id) return false;
    return this.isSleeping() || id === "04" || id === this._idle?.standbyId;
  }

  wake(style: "gentle" | "shake" = "gentle", nextEmotion?: string): boolean {
    this.resetIdle();
    if (!this.isSleeping()) {
      if (nextEmotion && this.emotionId !== nextEmotion) {
        this.setEmotion(nextEmotion);
      }
      return false;
    }
    this._wakeNext = nextEmotion ?? null;
    this.setEmotion(style === "shake" ? "07" : "01", { keepWakeNext: true });
    return true;
  }

  setGaze(nx: number, ny: number): this {
    this._gaze.tx = clamp(nx, -1, 1) * 24;
    this._gaze.ty = clamp(ny, -1, 1) * 15;
    return this;
  }

  clearGaze(): this {
    this._gaze.tx = 0;
    this._gaze.ty = 0;
    return this;
  }

  setStyle(style: Partial<{ sketch: number }>): this {
    Object.assign(this._style, style || {});
    if (!this._active) this.renderStatic();
    return this;
  }

  spin(turns = 1, dir?: number): this {
    if (this._spin) return this;
    const d = dir || (Math.random() < 0.5 ? -1 : 1);
    this._spin = { x: 0, v: 0, t: Math.max(1, Math.round(turns || 1)) * TAU * d };
    return this;
  }

  burst(count?: number): this {
    this.ball.burst(count);
    return this;
  }

  bounce(): this {
    if (this._bounceAt < 0) this._bounceAt = performance.now();
    return this;
  }

  private _setExpr(idx: number, speed?: number) {
    if (idx === this._exprIdx && this._ringSpring.x >= 0.999) return;
    const s = clamp(this._ringSpring.x, 0, 1);
    this._ringSrc = [
      lerpRing(this._ringSrc[0], this._ringDst[0], s),
      lerpRing(this._ringSrc[1], this._ringDst[1], s),
    ];
    this._ringDst = [EXPR[idx][0], EXPR[idx][1]];
    this._ringSpring.x = 0;
    this._ringSpring.v = 0;
    this._ringSpring.t = 1;
    this._ringSpeed = speed || 7;
    this._exprIdx = idx;
  }

  private _blinkNow(t: number) {
    this._blinkQ.push(
      { at: t, v: 0.05 },
      { at: t + 70, v: 0.05 },
      { at: t + 150, v: 1.08 },
      { at: t + 300, v: 1 },
    );
    if (Math.random() < 0.14) {
      this._blinkQ.push({ at: t + 370, v: 0.05 }, { at: t + 480, v: 1 });
    }
  }

  registerEmotion(raw: EmotionSeedDef) {
    return emotionConfig.register(raw);
  }

  setActive(on: boolean) {
    if (this._destroyed && on) return;
    if (on === this._active) return;
    this._active = on;
    if (on) {
      this._lastTick = 0;
      addToTicker(this);
    } else {
      removeFromTicker(this);
    }
  }

  replay() {
    if (this._def) this.setEmotion(this._def.id, { auto: true });
  }

  renderStatic() {
    if (this._destroyed) return;
    this._transDur = 0;
    this._ringSpring.x = 1;
    this._ringSpring.v = 0;
    this._open.x = this._def ? this._def.openness : 1;
    this._open.v = 0;
    const seq = this._seq;
    this._seq = null;
    this._tick(performance.now());
    this._seq = seq;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stopTour();
    this.setActive(false);
    this._events = {};
    this.ball.destroy();
  }

  _tick(now: number) {
    if (this._destroyed) return;
    this._dt = this._lastTick ? clamp((now - this._lastTick) / 1000, 0.001, 0.05) : 1 / 60;
    this._lastTick = now;
    const waking = this._seq && (this._def?.id === "01" || this._def?.id === "07");
    if (this._idle && this._idleEnabled && !this._touring && !waking) this._checkIdle(now);
    const pose = this._compose(now, 0);
    this.ball.applyPose(pose);
    this._lastPose = pose;
  }

  private _checkIdle(now: number) {
    if (!this._idle) return;
    const elapsed = now - this._lastActivity;
    const cur = this.emotionId;
    if (elapsed >= this._idle.sleepAfter) {
      if (cur !== this._idle.sleepId) this.setEmotion(this._idle.sleepId, { auto: true });
    } else if (
      this._idle.drowsyAfter != null &&
      this._idle.drowsyAfter < this._idle.sleepAfter &&
      elapsed >= this._idle.drowsyAfter
    ) {
      if (cur !== this._idle.drowsyId && cur !== this._idle.sleepId) {
        this.setEmotion(this._idle.drowsyId, { auto: true });
      }
    } else if (elapsed >= this._idle.standbyAfter) {
      if (cur !== this._idle.standbyId && cur !== this._idle.drowsyId && cur !== this._idle.sleepId) {
        this.setEmotion(this._idle.standbyId, { auto: true });
      }
    }
  }

  private _compose(now: number, depth: number): BallPose {
    const def = this._def!;
    const t = now - this._emoStart;
    let pose: BallPose;

    if (this._seq) {
      const res = this._seqPose(t, now);
      if (res === "switch") {
        return depth < 4 ? this._compose(now, depth + 1) : clonePose(this._def!.base);
      }
      pose = res || clonePose(def.base);
    } else {
      pose = clonePose(def.base);
    }

    const br = pose.body.breathe || 0;
    if (br) {
      const ph = (TAU * now) / 3600;
      pose.body.scale += br * Math.sin(ph);
      pose.body.y += br * 55 * Math.sin(ph + 0.6);
    }

    for (let i = 0; i < def.anims.length; i++) applyAnim(pose, def.anims[i], t, this);

    pose.body.sketch = Math.max(pose.body.sketch || 0, this._style.sketch || 0);

    const dt = this._dt || 1 / 60;

    if (this._active && now >= this._poolNext) {
      if (def.pool.length > 1) {
        this._poolPos = (this._poolPos + 1 + Math.floor(rand(0, def.pool.length - 1))) % def.pool.length;
        this._setExpr(def.pool[this._poolPos], def.poolSpeed);
      }
      this._poolNext = now + rand(def.poolMs[0], def.poolMs[1]);
    }

    if (this._active && def.blinkMs && now >= this._blinkNext) {
      this._blinkNow(now);
      this._blinkNext = now + rand(def.blinkMs[0], def.blinkMs[1]);
    }
    let openKey: number | null = null;
    while (this._blinkQ.length && now >= this._blinkQ[0].at) {
      openKey = this._blinkQ[0].v;
      this._blinkQ.shift();
    }
    this._open.t = openKey != null ? openKey : this._blinkQ.length ? this._open.t : def.openness;

    if (this._active && def.antics && now >= this._anticNext) {
      if (!this._spin && this._bounceAt < 0) {
        const pick = Math.random();
        if (pick < 0.45) this.spin(1);
        else if (pick < 0.8) this.bounce();
        else this._blinkNow(now);
      }
      this._anticNext = now + rand(9000, 18000);
    }

    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const j = dt / steps;
    for (let si = 0; si < steps; si++) {
      springStep(this._ringSpring, this._ringSpeed, 1, j);
      springStep(this._open, 26, 1, j);
      if (this._spin) {
        springStep(this._spin, 6.2, 1, j);
        if (Math.abs(this._spin.t - this._spin.x) < 0.01 && Math.abs(this._spin.v) < 0.05) {
          this._spin = null;
        }
      }
    }
    pose.body.yaw = this._spin ? this._spin.x : 0;

    if (this._bounceAt >= 0) {
      const be = (now - this._bounceAt) / 1000;
      if (be >= BOUNCE_TOTAL) {
        this._bounceAt = -1;
      } else {
        let acc = 0;
        let bi = 0;
        while (bi < BOUNCE_SEGS.length && be >= acc + BOUNCE_SEGS[bi].d) {
          acc += BOUNCE_SEGS[bi].d;
          bi++;
        }
        const seg = BOUNCE_SEGS[Math.min(bi, BOUNCE_SEGS.length - 1)];
        const bn = (be - acc) / seg.d;
        pose.body.y += -4 * seg.h * bn * (1 - bn);
      }
    }

    if (this._ringSpring.x < 0.999 || this._ringSpring.v > 0.001 || this._ringSpring.v < -0.001) {
      const rs = clamp(this._ringSpring.x, 0, 1.35);
      this._ringCur = [
        lerpRing(this._ringSrc[0], this._ringDst[0], rs),
        lerpRing(this._ringSrc[1], this._ringDst[1], rs),
      ];
    } else if (this._ringCur !== this._ringDst) {
      this._ringCur = this._ringDst;
    }
    pose.left.ring = this._ringCur[0];
    pose.right.ring = this._ringCur[1];

    const k = 1 - Math.exp(-5.66 * dt);
    const gx = def.gaze !== false ? this._gaze.tx : 0;
    const gy = def.gaze !== false ? this._gaze.ty : 0;
    this._gaze.x += (gx - this._gaze.x) * k;
    this._gaze.y += (gy - this._gaze.y) * k;
    pose.left.lookX += this._gaze.x;
    pose.right.lookX += this._gaze.x;
    pose.left.lookY += this._gaze.y;
    pose.right.lookY += this._gaze.y;

    if (def.gaze !== false) {
      const w = now / 1000;
      pose.left.lookX += 1.4 * Math.sin(0.42 * w) + 0.5 * Math.sin(1.0 * w);
      pose.right.lookX += 1.4 * Math.sin(0.42 * w + 1) + 0.5 * Math.sin(1.0 * w + 2);
      pose.left.lookY += 0.9 * Math.sin(0.58 * w);
      pose.right.lookY += 0.9 * Math.sin(0.58 * w + 1);
    }

    if (this._eyeScale !== 1) {
      pose.left.scaleX *= this._eyeScale;
      pose.left.scaleY *= this._eyeScale;
      pose.right.scaleX *= this._eyeScale;
      pose.right.scaleY *= this._eyeScale;
    }

    if (this._theme) {
      pose.body.color = this._theme.body;
      if (pose.left.color === DEFAULT_EYE.color) pose.left.color = this._theme.eyes;
      if (pose.right.color === DEFAULT_EYE.color) pose.right.color = this._theme.eyes;
    }

    const openS = clamp(this._open.x, 0.02, 1.5);
    pose.left.open = clamp(pose.left.open, 0, 1.3) * openS;
    pose.right.open = clamp(pose.right.open, 0, 1.3) * openS;
    pose.left.scaleX = Math.max(pose.left.scaleX, 0.05);
    pose.left.scaleY = Math.max(pose.left.scaleY, 0.05);
    pose.right.scaleX = Math.max(pose.right.scaleX, 0.05);
    pose.right.scaleY = Math.max(pose.right.scaleY, 0.05);

    const tt = now - this._transStart;
    if (this._transDur > 0 && tt < this._transDur && this._prevPose) {
      pose = lerpPose(this._prevPose, pose, easeInOutCubic(tt / this._transDur));
    }
    return pose;
  }

  private _seqPose(t: number, now: number): BallPose | "switch" | null {
    const seq = this._seq!;
    const frames = seq.frames;
    const last = frames[frames.length - 1];

    if (t >= last.at) {
      if (!seq.done) {
        seq.done = true;
        const s = seq.settle;
        if (s === "base") {
          this._prevPose = this._lastPose ? clonePose(this._lastPose) : clonePose(last.pose);
          this._transStart = now;
          this._transDur = this._def?.transition || 500;
          this._seq = null;
          return null;
        }
        if (s && typeof s === "object" && s.next) {
          const nextId = this._wakeNext ?? s.next;
          this._wakeNext = null;
          this.setEmotion(nextId, { auto: true });
          return "switch";
        }
      }
      return clonePose(last.pose);
    }

    if (t <= frames[0].at) return clonePose(frames[0].pose);
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      if (t >= a.at && t < b.at) {
        const k = easeInOutCubic((t - a.at) / (b.at - a.at));
        return lerpPose(a.pose, b.pose, k);
      }
    }
    return clonePose(last.pose);
  }
}

export function createEmotionBall(
  target: HTMLElement,
  opts: EmotionBallOptions = {},
): EmotionBallEngine {
  return new EmotionBallEngine(target, opts);
}
