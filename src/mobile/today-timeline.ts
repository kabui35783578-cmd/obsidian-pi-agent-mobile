import { plainPreview } from "./artifacts.ts";
import { NATIVE_HORIZONTAL_SCROLL } from "./swipe-navigation.ts";

export interface TodayTimelineItem {
  key: string;
  title: string;
  status: "done" | "pending" | "running";
  time?: string;
  detail?: string;
  icon: "food" | "coffee" | "list" | "doc" | "video" | "clock";
}

const icons: Record<TodayTimelineItem["icon"], string> = {
  food: "M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2 1-3.5 3.5-3.5 7 0 2 1 3 3.5 3",
  coffee: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9zM16 10h2a2.5 2.5 0 0 1 0 5h-2M8 3v3M12 3v3",
  list: "M4 6l2 2 3-3M4 14l2 2 3-3M13 7h7M13 15h7",
  doc: "M6 3h9l4 4v14H6zM9 12h7M9 16h5",
  video: "M3 7h11v10H3zM14 11l7-4v10l-7-4",
  clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0",
};

export function todayTimelineIcon(title: string): TodayTimelineItem["icon"] {
  if (/拍摄|剪辑|视频/.test(title)) return "video";
  if (/咖啡|奶茶/.test(title)) return "coffee";
  if (/早餐|午餐|晚餐|餐饮/.test(title)) return "food";
  if (/近期待办|计划|清单/.test(title)) return "list";
  return "doc";
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh-CN") : undefined;

export function shortTodayTimelineTitle(title: string) {
  const plain = plainPreview(title).replace(/\s+/g, " ").trim();
  const parts = segmenter ? Array.from(segmenter.segment(plain), (part) => part.segment) : Array.from(plain);
  return parts.length > 5 ? parts.slice(0, 4).join("") + "…" : plain || "事项";
}

const HEIGHT = 162;
const PAD = 34;
const SEED = 20261127;
const GOLD = "#ffd479";

function random(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function draw<K extends keyof SVGElementTagNameMap>(
  parent: Element, tag: K, attrs: Record<string, string | number> = {}, text?: string,
) {
  const element = parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  parent.appendChild(element);
  return element;
}

function legend(parent: HTMLElement, label: string, color: string, dashed = false) {
  const item = parent.createSpan();
  const line = draw(item, "svg", { width: 22, height: 6, "aria-hidden": "true" });
  draw(line, "path", {
    d: "M2 3H20", stroke: color, "stroke-width": 1.5, "stroke-linecap": "round",
    ...(dashed ? { "stroke-dasharray": "2 5" } : {}),
  });
  item.append(label);
}

export interface TodayTimelineSelection {
  focusedKey?: string;
  detailKey?: string;
}

let nextTimelineId = 0;

export function renderTodayTimeline(
  parent: HTMLElement, items: TodayTimelineItem[], previous?: TodayTimelineSelection, emptyText = "暂无事项",
) {
  const panel = parent.createDiv({
    cls: "pi-phone-today-timeline", attr: { [NATIVE_HORIZONTAL_SCROLL]: "" },
  });
  const footer = panel.createDiv({ cls: "pi-phone-today-timeline-footer" });
  const labels = footer.createDiv({ cls: "pi-phone-today-timeline-legend" });
  legend(labels, "已完成", "#fff");
  legend(labels, "待办", GOLD, true);
  const hint = footer.createSpan({ text: "左右滑动 →" });
  hint.hidden = true;
  if (!items.length) {
    footer.before(panel.createDiv({ cls: "pi-phone-today-timeline-empty", text: emptyText }));
    return;
  }

  const scroller = panel.createDiv({
    cls: "pi-phone-today-timeline-scroll",
    attr: { role: "group", "aria-label": "今天的时间线", dir: "ltr" },
  });
  footer.before(scroller);
  const track = scroller.createDiv({ cls: "pi-phone-today-timeline-track" });
  const rand = random(SEED);
  let x = PAD;
  let high = rand() > .5;
  const points = items.map((item, index) => {
    if (index) x += 64 + rand() * 24;
    const y = high ? 50 + rand() * 12 : 76 + rand() * 22;
    high = !high;
    return { item, x: Math.round(x), y: Math.round(y), slope: 0, left: 0 };
  });
  const last = points[points.length - 1];
  const span = Math.max(1, last.x - PAD);
  const width = last.x + PAD;
  let latest = -1;
  items.forEach((item, index) => {
    if (item.status === "done") latest = index;
  });
  const initial = Math.max(0, latest);
  const latestPoint = points[initial];
  points.forEach((point, index) => {
    const before = points[index - 1] ?? point;
    const after = points[index + 1] ?? point;
    const slope = (after.y - before.y) / Math.max(1, after.x - before.x);
    point.slope = slope * (before === point || after === point ? .4 : 1) * (.6 + rand() * .8) + (rand() - .5) * .5;
  });

  track.style.width = width + "px";
  const svg = draw(track, "svg", { width, height: HEIGHT, viewBox: "0 0 " + width + " " + HEIGHT, fill: "#fff" });
  const id = "pi-today-timeline-" + ++nextTimelineId;
  const detailId = id + "-detail";
  const details = panel.createDiv({ cls: "pi-phone-today-timeline-detail", attr: { id: detailId, hidden: "" } });
  const copy = details.createDiv({ cls: "pi-phone-today-timeline-detail-copy", attr: { "aria-live": "polite" } });
  const detailTitle = copy.createEl("strong");
  const detailMeta = copy.createDiv();
  let detailIndex = -1;
  const closeDetail = details.createEl("button", { text: "关闭", attr: { type: "button", "aria-label": "关闭事项详情" } });
  closeDetail.addEventListener("click", () => {
    const trigger = nodes[detailIndex];
    setDetail(-1);
    trigger?.focus({ preventScroll: true });
  });
  const doneId = id + "-done";
  const pendingId = id + "-pending";
  const blurId = id + "-blur";
  const defs = draw(svg, "defs");
  const done = draw(defs, "linearGradient", { id: doneId, gradientUnits: "userSpaceOnUse", x1: PAD, x2: Math.max(PAD + 1, latestPoint.x) });
  draw(done, "stop", { offset: 0, "stop-color": "#fff", "stop-opacity": .12 });
  draw(done, "stop", { offset: .55, "stop-color": "#fff", "stop-opacity": .6 });
  draw(done, "stop", { offset: 1, "stop-color": "#fff" });
  const pending = draw(defs, "linearGradient", { id: pendingId, gradientUnits: "userSpaceOnUse", x1: latestPoint.x, x2: Math.max(latestPoint.x + 1, last.x) });
  draw(pending, "stop", { offset: 0, "stop-color": "#fff" });
  draw(pending, "stop", { offset: 1, "stop-color": GOLD });
  const blur = draw(defs, "filter", { id: blurId, x: "-5%", y: "-60%", width: "110%", height: "220%" });
  draw(blur, "feGaussianBlur", { stdDeviation: 3 });

  const stars = draw(svg, "g", { fill: "#fff", "aria-hidden": "true" });
  const starRand = random(SEED + 7);
  for (let star = 0; star < Math.floor(width / 34); star++) {
    draw(stars, "circle", { cx: starRand() * width, cy: 6 + starRand() * (HEIGHT - 60), r: .7 + starRand() * .5, opacity: .2 + starRand() * .3 });
  }
  const drawLines = draw(svg, "g", { fill: "none", "stroke-linecap": "round", "aria-hidden": "true" });
  let donePath = "M" + points[0].x + " " + points[0].y;
  let pendingPath = "M" + latestPoint.x + " " + latestPoint.y;
  const clampY = (value: number) => Math.max(12, Math.min(HEIGHT - 50, value)).toFixed(1);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, out = dx * (.28 + rand() * .24), into = dx * (.2 + rand() * .26);
    const curve = "C" + [
      (a.x + out).toFixed(1), clampY(a.y + a.slope * out),
      (b.x - into).toFixed(1), clampY(b.y - b.slope * into), b.x, b.y,
    ].join(" ");
    if (index <= latest) donePath += curve;
    else pendingPath += curve;
  }
  if (latest > 0) {
    draw(drawLines, "path", { d: donePath, stroke: "url(#" + doneId + ")", "stroke-width": 4, opacity: .55, filter: "url(#" + blurId + ")" });
    draw(drawLines, "path", { d: donePath, stroke: "url(#" + doneId + ")", "stroke-width": 1.3 });
  }
  if (initial < points.length - 1) {
    draw(drawLines, "path", { d: pendingPath, stroke: "url(#" + pendingId + ")", "stroke-width": 1.3, "stroke-dasharray": "2 6" });
  }

  const ripple = draw(svg, "g", { class: "pi-phone-today-ripple", "aria-hidden": "true" });
  const rings = draw(ripple, "g", { fill: "none", stroke: "#fff" });
  draw(rings, "circle", { r: 21, "stroke-opacity": .35 });
  draw(rings, "circle", { r: 28, "stroke-opacity": .16, fill: "#ffffff1a" });
  const stopMotion = parent.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)");
  const nodes = points.map(({ item, x, y }, index) => {
    const isPending = item.status === "pending";
    const status = item.status === "done" ? item.time || "已完成" : isPending ? "待办" : "进行中";
    const group = draw(svg, "g", {
      class: "pi-phone-today-node", role: "button", tabindex: 0,
      "data-today-focus": "timeline:" + item.key,
      ...(item.status === "done" ? {} : { "aria-expanded": "false", "aria-controls": detailId }),
      "aria-label": item.title + "，" + status + (index === latest ? "，最新完成" : ""),
    });
    draw(group, "title", {}, item.title);
    draw(group, "rect", { class: "pi-phone-today-node-hit", x: x - 32, y: y - 19, width: 64, height: 163 - y, fill: "transparent" });
    draw(group, "path", { d: "M" + x + " " + (y + 18) + "V122", fill: "none", stroke: "#fff", "stroke-opacity": .14, "stroke-dasharray": "1 3", "stroke-linecap": "round" });
    const badge = draw(group, "g", { class: "pi-phone-today-node-badge is-float-" + (index % 5) });
    const circle = { cx: x, cy: y, r: 15 };
    draw(badge, "circle", { ...circle, fill: "#2d36a6" });
    draw(badge, "circle", {
      ...circle, fill: isPending ? "#ffd4791a" : "#ffffff1f", stroke: isPending ? GOLD : "#ffffff99",
      ...(isPending ? { "stroke-dasharray": "2 2.5" } : {}),
    });
    const icon = {
      d: icons[item.icon], transform: "translate(" + x + " " + y + ") scale(.78) translate(-12 -12)",
      fill: "none", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round",
    };
    draw(badge, "path", { ...icon, stroke: isPending ? GOLD : "#fff" });
    const selected = draw(badge, "g", { class: "pi-phone-today-node-selected" });
    draw(selected, "circle", { ...circle, fill: isPending ? GOLD : "#fff" });
    draw(selected, "path", { ...icon, stroke: isPending ? "#3b2a00" : "#2a2f9c" });
    if (index === latest) {
      draw(group, "rect", { x: x - 15, y: y - 41, width: 30, height: 16, rx: 8, fill: "#ffffff38", stroke: "#ffffff59" });
      draw(group, "text", { x, y: y - 29.5, "font-size": 10, "font-weight": 700 }, "最新");
    }
    draw(group, "text", { x, y: 136, "font-size": 11, "font-weight": isPending ? 700 : 500, fill: isPending ? GOLD : "#ffffffc7" }, status);
    draw(group, "text", { x, y: 154, "font-size": 12.5, "font-weight": 600 }, shortTodayTimelineTitle(item.title));
    const activate = () => {
      if (item.status !== "done") {
        setDetail(detailIndex === index ? -1 : index);
        if (detailIndex !== -1) details.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      if (scroller.scrollWidth <= scroller.clientWidth) updateFocus(index, true);
      else scroller.scrollTo({ left: points[index].left, behavior: stopMotion?.matches ? "instant" : "smooth" });
    };
    group.addEventListener("click", activate);
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    return group;
  });

  const anchors = points.map(() => track.createSpan({ cls: "pi-phone-today-timeline-snap", attr: { "aria-hidden": "true" } }));
  let focused = items.findIndex((item) => item.key === previous?.focusedKey);
  if (focused === -1) focused = initial;
  let max = 0;
  let frame = 0;
  let viewport = 0;

  function setDetail(index: number) {
    nodes[detailIndex]?.setAttribute("aria-expanded", "false");
    detailIndex = index;
    const item = items[index];
    details.hidden = !item;
    if (!item) return;
    nodes[index].setAttribute("aria-expanded", "true");
    detailTitle.setText(item.title);
    const status = item.status === "pending" ? "待办" : "进行中";
    detailMeta.setText(item.detail ? status + " · " + item.detail : status);
  }

  function updateFocus(index: number, fits = false) {
    focused = index;
    const center = fits ? points[index].x : PAD + scroller.scrollLeft / max * span;
    nodes.forEach((node, position) => {
      const strength = Math.max(0, 1 - Math.abs(points[position].x - center) / (viewport * .5));
      node.style.opacity = (.3 + .7 * strength ** 2).toFixed(3);
      node.classList.toggle("is-focused", position === index);
      node.setAttribute("aria-pressed", String(position === index));
    });
    const selected = points[index];
    ripple.style.transform = "translate(" + selected.x + "px," + selected.y + "px)";
  }

  function resize() {
    const nextWidth = scroller.clientWidth;
    if (!nextWidth || viewport === nextWidth) return;
    viewport = nextWidth;
    max = Math.max(0, width - viewport);
    hint.hidden = max === 0;
    points.forEach((point, index) => {
      point.left = Math.round((point.x - PAD) / span * max);
      anchors[index].style.left = point.left + viewport / 2 + "px";
    });
    scroller.scrollLeft = points[focused].left;
    updateFocus(focused, !max);
  }

  scroller.addEventListener("scroll", () => {
    if (frame || !max) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!max) return;
      const left = scroller.scrollLeft;
      let closest = 0;
      for (let index = 1; index < points.length; index++) {
        if (Math.abs(points[index].left - left) < Math.abs(points[closest].left - left)) closest = index;
      }
      updateFocus(closest);
    });
  }, { passive: true });
  resize();
  const restored = items.findIndex((item) => item.status !== "done" && item.key === previous?.detailKey);
  if (restored !== -1) setDetail(restored);
  const observer = new ResizeObserver(resize);
  observer.observe(scroller);
  return {
    selection: (): TodayTimelineSelection => ({
      focusedKey: focused === initial ? undefined : items[focused].key,
      detailKey: items[detailIndex]?.key,
    }),
    dispose: () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
