export { createBall, ringPath } from "./ball.ts";
export type { BallBodyPose, BallEyePose, BallOptions, BallPose, BallRenderer } from "./ball.ts";
export { EMOTION_GROUPS, EMOTION_SEED } from "./emotions.ts";
export type {
  BodyPoseSpec,
  EmotionAnim,
  EmotionAnimProp,
  EmotionAnimTarget,
  EmotionAnimType,
  EmotionGroupDef,
  EmotionGroupKey,
  EmotionSeedDef,
  EmotionSequence,
  EmotionSequenceFrame,
  EmotionSettle,
  EyePoseSpec,
  EyesSpec,
} from "./emotions.ts";
export { createEmotionBall, EmotionBallEngine, emotionConfig } from "./engine.ts";
export type { EmotionBallOptions, EmotionIdleOptions, NormalizedEmotion } from "./engine.ts";
export {
  EMOTION_AVATAR_PRESETS,
  EMOTION_COLORS,
  emotionForProgress,
  emotionForRuntimeState,
  formatEmotionAvatarId,
  isBuiltinAvatarId,
  parseEmotionAvatarId,
  resolveEmotionAvatar,
} from "./presets.ts";
export type {
  AvatarRuntimeState,
  EmotionAvatarPreset,
  EmotionColorKey,
  EmotionColorSwatch,
} from "./presets.ts";
export { EB_RINGS, EMOTION_SHAPE_ORDER } from "./rings.ts";
export type { EmotionShapeDef, EmotionShapeKey, EyeRingPair, Ring, RingPoint, ShapeFaceFit } from "./rings.ts";
