import type { RunProgress } from "../types.ts";
import { EB_RINGS, type EmotionShapeKey } from "./rings.ts";

export type EmotionColorKey =
  | "white"
  | "brown"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink"
  | "gray";

export interface EmotionColorSwatch {
  readonly key: EmotionColorKey;
  readonly label: string;
  readonly swatch: string;
  readonly body?: string;
  readonly eyeColor: string;
}

export const EMOTION_COLORS: readonly EmotionColorSwatch[] = [
  { key: "white", label: "奶白", swatch: "#F3F0EA", eyeColor: "#1A1A1A" },
  { key: "brown", label: "暖棕", swatch: "#9C6B3B", body: "#9C6B3B", eyeColor: "#1A1A1A" },
  { key: "red", label: "绯红", swatch: "#EE3848", body: "#EE3848", eyeColor: "#1A1A1A" },
  { key: "orange", label: "活力橙", swatch: "#F06814", body: "#F06814", eyeColor: "#1A1A1A" },
  { key: "amber", label: "琥珀黄", swatch: "#F5A30A", body: "#F5A30A", eyeColor: "#1A1A1A" },
  { key: "green", label: "翠绿", swatch: "#3BC46B", body: "#3BC46B", eyeColor: "#1A1A1A" },
  { key: "teal", label: "青绿", swatch: "#38BFA0", body: "#38BFA0", eyeColor: "#1A1A1A" },
  { key: "blue", label: "蔚蓝", swatch: "#3B82F6", body: "#3B82F6", eyeColor: "#1A1A1A" },
  { key: "purple", label: "紫罗兰", swatch: "#9560F7", body: "#9560F7", eyeColor: "#1A1A1A" },
  { key: "pink", label: "玫粉", swatch: "#ED2E92", body: "#ED2E92", eyeColor: "#1A1A1A" },
  { key: "gray", label: "中性灰", swatch: "#7B7B7B", body: "#7B7B7B", eyeColor: "#1A1A1A" },
];

const COLOR_MAP = new Map<EmotionColorKey, EmotionColorSwatch>(
  EMOTION_COLORS.map((item) => [item.key, item]),
);

export interface EmotionAvatarPreset {
  readonly shape: EmotionShapeKey;
  readonly colorKey: EmotionColorKey;
  readonly color?: string;
  readonly eyeColor?: string;
  readonly emotion: string;
}

/** Legacy 18 built-in presets kept 100% compatible with existing .agent files and mobile sync. */
export const EMOTION_AVATAR_PRESETS: Readonly<Record<string, EmotionAvatarPreset>> = {
  coordinator: { shape: "blob", colorKey: "white", eyeColor: "#1A1A1A", emotion: "35" },
  reader: { shape: "blob", colorKey: "white", eyeColor: "#1A1A1A", emotion: "31" },
  writer: { shape: "gem", colorKey: "white", eyeColor: "#1A1A1A", emotion: "10" },
  researcher: { shape: "wedge", colorKey: "white", eyeColor: "#1A1A1A", emotion: "03" },
  organizer: { shape: "gem", colorKey: "white", eyeColor: "#1A1A1A", emotion: "35" },
  general: { shape: "blob", colorKey: "white", eyeColor: "#1A1A1A", emotion: "02" },
  moon: { shape: "blob", colorKey: "white", eyeColor: "#1A1A1A", emotion: "02" },
  sand: { shape: "wedge", colorKey: "white", eyeColor: "#1A1A1A", emotion: "35" },
  ice: { shape: "gem", colorKey: "white", eyeColor: "#1A1A1A", emotion: "31" },
  sunny: { shape: "blob", colorKey: "white", eyeColor: "#1A1A1A", emotion: "10" },
  mint: { shape: "blob", colorKey: "teal", color: "#38BFA0", eyeColor: "#1A1A1A", emotion: "35" },
  peach: { shape: "blob", colorKey: "orange", color: "#F06814", eyeColor: "#1A1A1A", emotion: "31" },
  ocean: { shape: "blob", colorKey: "blue", color: "#3B82F6", eyeColor: "#1A1A1A", emotion: "03" },
  lilac: { shape: "blob", colorKey: "purple", color: "#9560F7", eyeColor: "#1A1A1A", emotion: "35" },
  coral: { shape: "blob", colorKey: "amber", color: "#F5A30A", eyeColor: "#1A1A1A", emotion: "10" },
  forest: { shape: "wedge", colorKey: "green", color: "#3BC46B", eyeColor: "#1A1A1A", emotion: "35" },
  berry: { shape: "gem", colorKey: "pink", color: "#ED2E92", eyeColor: "#1A1A1A", emotion: "03" },
  rose: { shape: "blob", colorKey: "red", color: "#EE3848", eyeColor: "#1A1A1A", emotion: "31" },
};

export function formatEmotionAvatarId(
  shape: EmotionShapeKey,
  colorKey: EmotionColorKey,
): string {
  return `${shape}:${colorKey}`;
}

export function parseEmotionAvatarId(
  raw: string,
): { shape: EmotionShapeKey; colorKey: EmotionColorKey } | null {
  const id = raw.trim().replace(/^builtin:/, "");
  if (!id) return null;
  if (Object.hasOwn(EMOTION_AVATAR_PRESETS, id)) {
    const preset = EMOTION_AVATAR_PRESETS[id];
    return { shape: preset.shape, colorKey: preset.colorKey };
  }
  const parts = id.split(":");
  if (parts.length !== 2) return null;
  const [shapeRaw, colorRaw] = parts;
  if (!Object.hasOwn(EB_RINGS.SHAPES, shapeRaw)) return null;
  if (!COLOR_MAP.has(colorRaw as EmotionColorKey)) return null;
  return {
    shape: shapeRaw as EmotionShapeKey,
    colorKey: colorRaw as EmotionColorKey,
  };
}

export function isBuiltinAvatarId(raw: string): boolean {
  return parseEmotionAvatarId(raw) !== null;
}

export function resolveEmotionAvatar(raw: string): EmotionAvatarPreset | null {
  const id = raw.trim().replace(/^builtin:/, "");
  if (!id) return null;
  if (Object.hasOwn(EMOTION_AVATAR_PRESETS, id)) {
    return EMOTION_AVATAR_PRESETS[id];
  }
  const parsed = parseEmotionAvatarId(id);
  if (!parsed) return null;
  const swatch = COLOR_MAP.get(parsed.colorKey)!;
  return {
    shape: parsed.shape,
    colorKey: parsed.colorKey,
    color: swatch.body,
    eyeColor: swatch.eyeColor,
    emotion: "35",
  };
}

export type AvatarRuntimeState =
  | "idle"
  | "composing"
  | "working"
  | "waiting"
  | "complete"
  | "cancelled"
  | "paused"
  | "error";

const WAITING_INPUT_TOOL_PATTERN = /^(ask_user|ask_note_task_user|propose_plan|request_permission)$/i;
const MEMORY_TOOL_PATTERN = /^(recall|memory_.*)$/i;
const NETWORK_TOOL_PATTERN = /^(web_.*|feed_.*|call_mcp_tool|discover_mcp_tools|mcp_.*)$/i;
const SEARCH_READ_EXACT_PATTERN =
  /^(read|ls|find|grep|vault_list|vault_search|vault_read|vault_tasks|graph_.*|note_find|note_open|note_attention|list_agents|list_skills|read_skill|tool_search|task_list|task_channels|background_status|weixin_files|conversation_image)$/i;
const SEARCH_TOOL_PATTERN = /search|read|list|query|graph|find|lookup/i;

/** Map live task progress phases onto Emotion Ball expression IDs. */
export function emotionForProgress(
  progress?: Pick<RunProgress, "phase" | "toolName">,
  opts?: { waitingInput?: boolean },
): string {
  if (opts?.waitingInput) return "35";
  if (!progress) return "30";
  switch (progress.phase) {
    case "preparing":
      return "31";
    case "connecting":
      return "36";
    case "waiting":
    case "thinking":
      return "30";
    case "responding":
      return "39";
    case "tool": {
      const tool = (progress.toolName ?? "").trim();
      if (!tool) return "32";
      if (WAITING_INPUT_TOOL_PATTERN.test(tool)) return "35";
      if (MEMORY_TOOL_PATTERN.test(tool)) return "37";
      if (NETWORK_TOOL_PATTERN.test(tool)) return "36";
      if (SEARCH_READ_EXACT_PATTERN.test(tool) || SEARCH_TOOL_PATTERN.test(tool)) return "40";
      return "32";
    }
    default:
      return "30";
  }
}

/** Map unified runtime states onto Emotion Ball expression IDs. */
export function emotionForRuntimeState(
  state: AvatarRuntimeState,
  opts?: { progress?: Pick<RunProgress, "phase" | "toolName">; restEmotion?: string; waitingInput?: boolean },
): string {
  switch (state) {
    case "waiting":
    case "composing":
      return "35";
    case "working":
      return emotionForProgress(opts?.progress, { waitingInput: opts?.waitingInput });
    case "complete":
      return "33";
    case "cancelled":
      return "41";
    case "paused":
      return "38";
    case "error":
      return "34";
    case "idle":
    default:
      return opts?.restEmotion ?? "02";
  }
}
