/**
 * @shadowduel/boxing-mechanics — camera shadowboxing mechanics.
 *
 * Pipeline (client side, per camera frame):
 *   raw pose landmarks
 *     → normalizeLandmarks()   body-relative anatomical frame
 *     → smoothPose()           EMA jitter filter
 *     → extractFeatures()      velocities, angles, reach, depth
 *     → PunchDetector / BlockDetector / DodgeDetector
 *     → DetectedAction events  (semantic — never damage numbers)
 *
 * Resolution (server side, authoritative):
 *   resolvePunch() / drainBlock() / regenerateBlock() / decideWinner()
 *   plus the shared GAME_RULES / PUNCH_STATS constants.
 */

export * from "./types";
export * from "./geometry";
export * from "./rules";
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
  DEFAULT_DODGE_OPTIONS,
  DodgeDetector,
  type DodgeDetectorOptions,
} from "./dodge-detector";
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
