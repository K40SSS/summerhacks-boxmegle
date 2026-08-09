/**
 * Per-player ingestion pipeline: raw landmarks in, semantic actions out.
 *
 * Runs the four stages that must happen in order on every frame —
 *
 *   normalizeLandmarks() → smoothPose() → extractFeatures()
 *     → PunchDetector / BlockDetector
 *
 * — and owns the state those stages carry between frames: the smoothing
 * accumulator, the previous feature set (velocities are differences), and the
 * two detector FSMs with their cooldowns and hysteresis windows.
 *
 * That carried state is why this is a class rather than a function. Create
 * exactly ONE per tracked player and feed it that player's frames in arrival
 * order. Sharing an instance between two players, or interleaving two streams
 * into one, corrupts every velocity and every hysteresis window in it.
 *
 * Transport-free and pure, so the same class runs on the server
 * (authoritative) and in the browser (local prediction). It deliberately does
 * NOT choose the timestamp: who is trusted to keep time is a transport
 * question, not a mechanics one. The caller passes one in — see
 * apps/server/ws/poseIngest.ts for the server's answer.
 */

import { BlockDetector, type BlockDetectorOptions } from "./block-detector";
import { extractFeatures, poseFromNormalized, smoothPose, type SmoothedPose } from "./features";
import { normalizeLandmarks } from "./normalize";
import { PunchDetector, type PunchDetectorOptions } from "./punch-detector";
import type { DetectedAction, FrameFeatures, RawLandmark } from "./types";

export interface PosePipelineOptions {
  punch?: PunchDetectorOptions;
  block?: BlockDetectorOptions;
}

export interface PipelineFrame {
  /**
   * Body-relative pose after smoothing. Structurally a `NormalizedPose`, so
   * it can be handed straight to `hitboxTest` as the defender's pose — which
   * is exactly what the resolve step does with it.
   */
  pose: SmoothedPose;
  features: FrameFeatures;
  /** Empty on most frames; punches and block edges are rare events. */
  actions: DetectedAction[];
}

export class PosePipeline {
  private smoothed: SmoothedPose | null = null;
  private prevFeatures: FrameFeatures | null = null;
  private readonly punchDetector: PunchDetector;
  private readonly blockDetector: BlockDetector;

  constructor(options: PosePipelineOptions = {}) {
    this.punchDetector = new PunchDetector(options.punch);
    this.blockDetector = new BlockDetector(options.block);
  }

  /** Latest smoothed pose, or null before the first usable frame. */
  get pose(): SmoothedPose | null {
    return this.smoothed;
  }

  /** Detector-side view of the guard. The match state owns the real flag. */
  get blocking(): boolean {
    return this.blockDetector.isBlocking();
  }

  /**
   * Advance one frame. Returns null when the landmarks were unusable
   * (missing joints, degenerate shoulder width) — the caller should treat a
   * run of nulls as pose loss and force the block to end.
   */
  update(landmarks: RawLandmark[], timestamp: number): PipelineFrame | null {
    const normalized = normalizeLandmarks(landmarks, timestamp);
    if (!normalized) return null;

    // smoothPose returns a fresh object each frame, so a PipelineFrame handed
    // to the caller keeps the values it was given.
    this.smoothed = this.smoothed
      ? smoothPose(this.smoothed, normalized.pose)
      : poseFromNormalized(normalized.pose);

    const features = extractFeatures(this.smoothed, this.prevFeatures);
    this.prevFeatures = features;

    const actions = [
      ...this.punchDetector.update(features),
      ...this.blockDetector.update(features, this.smoothed.nose),
    ];

    return { pose: this.smoothed, features, actions };
  }

  /** End a held block when tracking is lost (TDD §22.4). */
  forceEndBlock(timestamp: number): DetectedAction[] {
    return this.blockDetector.forceEnd(timestamp);
  }

  /** Full reset — match restarts only. Drops smoothing and both FSMs. */
  reset(): void {
    this.smoothed = null;
    this.prevFeatures = null;
    this.punchDetector.reset();
    this.blockDetector.reset();
  }
}
