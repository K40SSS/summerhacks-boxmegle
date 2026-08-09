/**
 * game-mechanics — camera shadowboxing fight logic.
 *
 * Detection pipeline (per pose frame, wherever the stream is consumed):
 *   raw pose landmarks
 *     → normalizeLandmarks()   body-relative anatomical frame
 *     → smoothPose()           EMA jitter filter
 *     → extractFeatures()      velocities, angles, reach, depth
 *     → PunchDetector / BlockDetector
 *     → DetectedAction events  (semantic — never damage numbers)
 *
 * Resolution (server side, authoritative):
 *   hitboxTest() decides whether a punch connected, from the defender's own
 *   pose — there is no dodge action, because evasion is geometry rather than
 *   a claim. Then resolvePunch() / spendStamina() / drainBlock() /
 *   regenerateBlock() / regenerateStamina() / decideWinner() apply the rules,
 *   over PlayerState, plus the shared GAME_RULES / PUNCH_STATS /
 *   ZONE_MULTIPLIERS constants.
 */

export * from "./types";
export * from "./geometry";
export * from "./rules";
export * from "./playerState";
export {
  advanceMatch,
  advanceTo,
  applyGuardBreak,
  endBlock,
  startBlock,
  type AdvanceOutcome,
  type MatchAdvanceOutcome,
} from "./advance";
export { normalizeLandmarks, type NormalizeResult } from "./normalize";
export {
  SMOOTHING_ALPHA,
  extractFeatures,
  poseFromNormalized,
  smoothPose,
  type SmoothedPose,
} from "./features";
export {
  DEFAULT_PUNCH_OPTIONS,
  PunchDetector,
  type PunchDetectorOptions,
} from "./punch-detector";
export {
  DEFAULT_BLOCK_OPTIONS,
  BlockDetector,
  type BlockDetectorOptions,
} from "./block-detector";
export {
  DEFAULT_IMPACT,
  MAX_IMPACT_REACH,
  applyPunch,
  type PunchAction,
  type ResolvedPunch,
} from "./resolve";
export {
  PosePipeline,
  type PipelineFrame,
  type PosePipelineOptions,
} from "./pipeline";
export {
  DEFAULT_HITBOX_OPTIONS,
  hitboxTest,
  type HitZone,
  type HitboxOptions,
} from "./hitbox";
export {
  decideWinner,
  drainBlock,
  regenerateBlock,
  resolvePunch,
  type DecisionStats,
  type DefenderSnapshot,
  type DrainOutcome,
  type PunchOutcome,
  type PunchResult,
} from "./combat";
export {
  regenerateStamina,
  spendStamina,
  staminaRecoveryDelayMs,
  type SpendOutcome,
} from "./stamina";
