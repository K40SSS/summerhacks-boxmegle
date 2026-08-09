/**
 * Block detector (TDD §13).
 *
 * Block is active when both wrists are near the head/upper torso and both
 * elbows are bent. Wrist depth must also stay near the head plane so arms
 * extended toward the camera at face height don't read as a guard.
 * Temporal hysteresis prevents flicker:
 *   enter after conditions hold for 150ms, exit after 100ms invalid.
 */

import { GAME_RULES } from "./rules";
import type { BodyPoint, DetectedAction, FrameFeatures } from "./types";

export interface BlockDetectorOptions {
  /** Horizontal wrist distance from nose, in shoulder widths. */
  maxHorizontalFromNose: number;
  /** Vertical wrist distance from nose, in shoulder widths. */
  maxVerticalFromNose: number;
  /**
   * Depth (z) wrist distance from the nose plane, in shoulder widths.
   * Deliberately generous: monocular z is noisy and normalization amplifies
   * it (raw z is divided by the image shoulder width), so a real guard can
   * sit around 0.5–1 sw in front of the nose while a full reach toward the
   * camera lands well past 2. Tune against the debug overlay's "wrist depth"
   * rows (?debug=true) on a live camera.
   */
  maxDepthFromNose: number;
  /** Both elbow angles must be below this (degrees). */
  maxElbowAngle: number;
  enterMs: number;
  exitMs: number;
  minConfidence: number;
}

export const DEFAULT_BLOCK_OPTIONS: BlockDetectorOptions = {
  maxHorizontalFromNose: 0.9,
  maxVerticalFromNose: 1.1,
  maxDepthFromNose: 1.5,
  maxElbowAngle: 125,
  enterMs: GAME_RULES.blockEnterMs,
  exitMs: GAME_RULES.blockExitMs,
  minConfidence: GAME_RULES.minPunchConfidence,
};

export class BlockDetector {
  private blocking = false;
  private validSince: number | null = null;
  private invalidSince: number | null = null;

  constructor(private options: BlockDetectorOptions = DEFAULT_BLOCK_OPTIONS) {}

  reset(): void {
    this.blocking = false;
    this.validSince = null;
    this.invalidSince = null;
  }

  isBlocking(): boolean {
    return this.blocking;
  }

  /** Nose is the reference point at the body-relative origin's head region. */
  private wristNearHead(wrist: BodyPoint, nose: BodyPoint, depthFromNose: number): boolean {
    return (
      Math.abs(wrist.x - nose.x) < this.options.maxHorizontalFromNose &&
      Math.abs(wrist.y - nose.y) < this.options.maxVerticalFromNose &&
      Math.abs(depthFromNose) < this.options.maxDepthFromNose
    );
  }

  update(frame: FrameFeatures, nose: BodyPoint): DetectedAction[] {
    const actions: DetectedAction[] = [];
    const now = frame.timestamp;

    const conditionsValid =
      frame.confidence >= this.options.minConfidence &&
      this.wristNearHead(frame.leftWrist, nose, frame.leftWristDepthFromNose) &&
      this.wristNearHead(frame.rightWrist, nose, frame.rightWristDepthFromNose) &&
      frame.leftElbowAngle < this.options.maxElbowAngle &&
      frame.rightElbowAngle < this.options.maxElbowAngle;

    if (!this.blocking) {
      this.invalidSince = null;
      if (conditionsValid) {
        if (this.validSince === null) this.validSince = now;
        if (now - this.validSince >= this.options.enterMs) {
          this.blocking = true;
          this.validSince = null;
          actions.push({ type: "BLOCK_START", timestamp: now });
        }
      } else {
        this.validSince = null;
      }
    } else {
      this.validSince = null;
      if (!conditionsValid) {
        if (this.invalidSince === null) this.invalidSince = now;
        if (now - this.invalidSince >= this.options.exitMs) {
          this.blocking = false;
          this.invalidSince = null;
          actions.push({ type: "BLOCK_END", timestamp: now });
        }
      } else {
        this.invalidSince = null;
      }
    }

    return actions;
  }

  /** Force-block end e.g. when pose tracking is lost (TDD §22.4). */
  forceEnd(timestamp: number): DetectedAction[] {
    if (!this.blocking) return [];
    this.blocking = false;
    this.validSince = null;
    this.invalidSince = null;
    return [{ type: "BLOCK_END", timestamp }];
  }
}
