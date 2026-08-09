/**
 * Dodge detector — whole-body evasion from raw image-space displacement.
 *
 * Body-relative normalization (TDD §11.3) recenters every frame at the
 * shoulder midpoint, which erases slips and ducks. So dodging is measured
 * BEFORE normalization: the raw shoulder midpoint is compared against a
 * slow-moving anchor (EMA), and the offset is expressed in shoulder widths
 * so it is camera-distance invariant. Repositioning in the room re-anchors
 * within a couple of seconds and never reads as a permanent dodge.
 *
 * Offsets are reported in the BODY frame the rest of the pipeline uses:
 * +x = the player's anatomical right, +y = down (a duck is positive y).
 * The raw feed is unmirrored, so image-right is the player's anatomical
 * LEFT — the x sign is flipped when the offset is computed.
 *
 * While a dodge is held, the offset is re-emitted (heartbeat + on change)
 * so the server resolves punches against the live position instead of a
 * stale snapshot from the moment the dodge began.
 */

import { GAME_RULES } from "./rules";
import type { DetectedAction } from "./types";

export interface DodgeDetectorOptions {
  /** Displacement (sw) that starts a dodge. */
  enterDisplacement: number;
  /** Displacement (sw) below which the dodge ends. */
  exitDisplacement: number;
  /** Conditions must hold this long before entering (ms). */
  enterMs: number;
  /**
   * A dodge cannot be held longer than this (ms) — after it the anchor snaps
   * to the current position, so leaning permanently grants no evasion.
   */
  maxDodgeMs: number;
  /** Tracking must stay bad this long before the dodge is force-ended (ms). */
  badTrackingGraceMs: number;
  /** Re-report the offset at least this often while dodging (ms). */
  heartbeatMs: number;
  /** Re-report immediately when the offset moved this far (sw). */
  reportDeltaSw: number;
  /** Per-frame EMA factor for the anchor (≈2s adaption at 24fps). */
  anchorAlpha: number;
  minConfidence: number;
}

export const DEFAULT_DODGE_OPTIONS: DodgeDetectorOptions = {
  enterDisplacement: 0.5,
  exitDisplacement: 0.3,
  enterMs: 80,
  maxDodgeMs: GAME_RULES.dodgeMaxHoldMs,
  badTrackingGraceMs: 250,
  heartbeatMs: 300,
  reportDeltaSw: 0.15,
  anchorAlpha: 0.02,
  minConfidence: GAME_RULES.minPunchConfidence,
};

export class DodgeDetector {
  private anchorX: number | null = null;
  private anchorY: number | null = null;
  private dodging = false;
  private dodgeStartedAt = 0;
  private candidateSince: number | null = null;
  private badTrackingSince: number | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private lastReportedX = 0;
  private lastReportedY = 0;
  private lastReportAt = 0;

  constructor(private options: DodgeDetectorOptions = DEFAULT_DODGE_OPTIONS) {}

  reset(): void {
    this.anchorX = null;
    this.anchorY = null;
    this.dodging = false;
    this.candidateSince = null;
    this.badTrackingSince = null;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  isDodging(): boolean {
    return this.dodging;
  }

  /** Latest displacement from the anchor, in body-frame shoulder widths. */
  currentOffset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }

  /**
   * Feed the raw image-space shoulder midpoint each frame.
   * Coordinates are image-normalized (0..1); scale is the image-space
   * shoulder width used to express the offset in shoulder widths.
   */
  update(
    shoulderMidX: number,
    shoulderMidY: number,
    shoulderWidthImage: number,
    timestamp: number,
    confidence: number,
  ): DetectedAction[] {
    if (shoulderWidthImage <= 1e-4 || confidence < this.options.minConfidence) {
      // A single blurry frame (fast slips cause exactly that) must not end
      // the dodge — force-end only after sustained bad tracking (§22.4).
      if (this.badTrackingSince === null) this.badTrackingSince = timestamp;
      if (this.dodging && timestamp - this.badTrackingSince >= this.options.badTrackingGraceMs) {
        return this.forceEnd(timestamp);
      }
      return [];
    }
    this.badTrackingSince = null;

    if (this.anchorX === null || this.anchorY === null) {
      this.anchorX = shoulderMidX;
      this.anchorY = shoulderMidY;
      return [];
    }

    // Body frame: image-right is the (camera-facing) player's anatomical
    // left, so x flips; image-down stays +y.
    this.offsetX = -((shoulderMidX - this.anchorX) / shoulderWidthImage);
    this.offsetY = (shoulderMidY - this.anchorY) / shoulderWidthImage;
    const displacement = Math.hypot(this.offsetX, this.offsetY);

    // The anchor only follows while the player is near it — a held dodge
    // must not drift the anchor under the player mid-evasion.
    if (!this.dodging && displacement < this.options.enterDisplacement) {
      const a = this.options.anchorAlpha;
      this.anchorX = this.anchorX * (1 - a) + shoulderMidX * a;
      this.anchorY = this.anchorY * (1 - a) + shoulderMidY * a;
    }

    const actions: DetectedAction[] = [];
    if (!this.dodging) {
      if (displacement >= this.options.enterDisplacement) {
        if (this.candidateSince === null) this.candidateSince = timestamp;
        if (timestamp - this.candidateSince >= this.options.enterMs) {
          this.dodging = true;
          this.dodgeStartedAt = timestamp;
          this.candidateSince = null;
          actions.push(this.report(timestamp));
        }
      } else {
        this.candidateSince = null;
      }
    } else if (displacement <= this.options.exitDisplacement) {
      this.dodging = false;
      actions.push({ type: "DODGE_END", timestamp });
    } else if (timestamp - this.dodgeStartedAt > this.options.maxDodgeMs) {
      // Held too long — the new position becomes the neutral stance.
      this.dodging = false;
      this.anchorX = shoulderMidX;
      this.anchorY = shoulderMidY;
      this.offsetX = 0;
      this.offsetY = 0;
      actions.push({ type: "DODGE_END", timestamp });
    } else {
      // Still dodging: keep the server's picture of the offset current.
      const moved = Math.hypot(
        this.offsetX - this.lastReportedX,
        this.offsetY - this.lastReportedY,
      );
      if (
        moved >= this.options.reportDeltaSw ||
        timestamp - this.lastReportAt >= this.options.heartbeatMs
      ) {
        actions.push(this.report(timestamp));
      }
    }

    return actions;
  }

  private report(timestamp: number): DetectedAction {
    this.lastReportedX = this.offsetX;
    this.lastReportedY = this.offsetY;
    this.lastReportAt = timestamp;
    return {
      type: "DODGE_START",
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      timestamp,
    };
  }

  /** End the dodge when tracking is lost (TDD §22.4 pattern). */
  forceEnd(timestamp: number): DetectedAction[] {
    this.candidateSince = null;
    this.badTrackingSince = null;
    // Drop the anchor too: after a tracking gap the player may reappear
    // anywhere, and a stale anchor would mint a phantom dodge on the first
    // confident frames.
    this.anchorX = null;
    this.anchorY = null;
    if (!this.dodging) return [];
    this.dodging = false;
    return [{ type: "DODGE_END", timestamp }];
  }
}
