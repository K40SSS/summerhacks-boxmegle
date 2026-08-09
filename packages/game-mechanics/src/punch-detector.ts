/**
 * Punch detector — one state machine per hand (TDD §12.4–§12.6).
 *
 *   GUARD → EXTENDING → PEAK → RETRACTING → COOLDOWN → GUARD
 *
 * A punch is emitted exactly once at PEAK. Classification favours consistent
 * recognition over strict boxing accuracy (TDD §12.6): when confidence is
 * insufficient the detector falls back to a generic jab-strength punch.
 */

import { GAME_RULES } from "./rules";
import type { Hand, PunchType } from "./types";
import type { DetectedAction, FrameFeatures } from "./types";

type Phase = "GUARD" | "EXTENDING" | "PEAK" | "RETRACTING" | "COOLDOWN";

interface HandState {
  phase: Phase;
  /** Max reach seen during the current extension. */
  peakReach: number;
  /** Baseline (guard) reach — EMA while in GUARD. */
  guardReach: number;
  extensionStart: number;
  cooldownUntil: number;
  // Trajectory accumulators for classification
  sumVelX: number;
  sumVelY: number;
  sumVelZ: number;
  maxSpeed: number;
  minElbowAngle: number;
  samples: number;
  startY: number;
  startTorsoRotation: number;
  maxTorsoDelta: number;
}

export interface PunchDetectorOptions {
  /** Wrist speed (shoulder-widths/s) needed to leave guard. */
  minStartSpeed: number;
  /** Reach increase beyond guard baseline required for a valid punch. */
  minExtension: number;
  perHandCooldownMs: number;
  maxExtensionMs: number;
  minConfidence: number;
}

export const DEFAULT_PUNCH_OPTIONS: PunchDetectorOptions = {
  minStartSpeed: 1.4,
  minExtension: 0.28,
  perHandCooldownMs: GAME_RULES.perHandCooldownMs,
  maxExtensionMs: 900,
  minConfidence: GAME_RULES.minPunchConfidence,
};

function initialHandState(): HandState {
  return {
    phase: "GUARD",
    peakReach: 0,
    guardReach: 0.8,
    extensionStart: 0,
    cooldownUntil: 0,
    sumVelX: 0,
    sumVelY: 0,
    sumVelZ: 0,
    maxSpeed: 0,
    minElbowAngle: 180,
    samples: 0,
    startY: 0,
    startTorsoRotation: 0,
    maxTorsoDelta: 0,
  };
}

export class PunchDetector {
  private left = initialHandState();
  private right = initialHandState();
  private lastAnyPunchAt = 0;

  constructor(private options: PunchDetectorOptions = DEFAULT_PUNCH_OPTIONS) {}

  reset(): void {
    this.left = initialHandState();
    this.right = initialHandState();
    this.lastAnyPunchAt = 0;
  }

  update(frame: FrameFeatures): DetectedAction[] {
    const actions: DetectedAction[] = [];
    if (frame.confidence < this.options.minConfidence) return actions;

    const left = this.updateHand("LEFT", this.left, frame);
    if (left) actions.push(left);
    const right = this.updateHand("RIGHT", this.right, frame);
    if (right) actions.push(right);
    return actions;
  }

  private updateHand(
    hand: Hand,
    s: HandState,
    f: FrameFeatures,
  ): DetectedAction | null {
    const isLeft = hand === "LEFT";
    const reach = isLeft ? f.leftReach : f.rightReach;
    const speed = isLeft ? f.leftWristSpeed : f.rightWristSpeed;
    const vel = isLeft ? f.leftWristVelocity : f.rightWristVelocity;
    const wristY = isLeft ? f.leftWrist.y : f.rightWrist.y;
    const elbowAngle = isLeft ? f.leftElbowAngle : f.rightElbowAngle;
    const now = f.timestamp;

    switch (s.phase) {
      case "GUARD": {
        // Track resting reach so extension is measured relative to the guard.
        s.guardReach = s.guardReach * 0.92 + reach * 0.08;
        const extending = reach > s.guardReach + 0.06 && reach - s.peakReach > -0.05;
        if (
          speed > this.options.minStartSpeed &&
          extending &&
          now >= s.cooldownUntil &&
          now - this.lastAnyPunchAt >= GAME_RULES.globalAttackCooldownMs
        ) {
          s.phase = "EXTENDING";
          s.extensionStart = now;
          s.peakReach = reach;
          s.sumVelX = 0;
          s.sumVelY = 0;
          s.sumVelZ = 0;
          s.maxSpeed = speed;
          s.minElbowAngle = elbowAngle;
          s.samples = 0;
          s.startY = wristY;
          s.startTorsoRotation = f.torsoRotation;
          s.maxTorsoDelta = 0;
        }
        return null;
      }

      case "EXTENDING": {
        s.samples += 1;
        s.sumVelX += vel.x;
        s.sumVelY += vel.y;
        s.sumVelZ += vel.z;
        s.maxSpeed = Math.max(s.maxSpeed, speed);
        s.minElbowAngle = Math.min(s.minElbowAngle, elbowAngle);
        s.maxTorsoDelta = Math.max(
          s.maxTorsoDelta,
          Math.abs(f.torsoRotation - s.startTorsoRotation),
        );

        if (reach > s.peakReach) {
          s.peakReach = reach;
          return null;
        }

        // Reach stopped increasing → PEAK.
        const extension = s.peakReach - s.guardReach;
        if (extension >= this.options.minExtension) {
          s.phase = "RETRACTING";
          s.cooldownUntil = now + this.options.perHandCooldownMs;
          this.lastAnyPunchAt = now;
          const punchType = this.classify(s);
          const wrist = isLeft ? f.leftWrist : f.rightWrist;
          return {
            type: "PUNCH",
            punchType,
            hand,
            confidence: Math.min(1, f.confidence * Math.min(1, s.maxSpeed / 3)),
            // The fist's endpoint, mirrored into the opponent's frame — the
            // players virtually face each other, so attacker-left arrives at
            // defender-right (TDD §32 pseudo-targeting extension).
            impactX: -wrist.x,
            impactY: wrist.y,
            timestamp: now,
          };
        }

        // Arm drifted without a real extension — treat as noise.
        s.phase = "GUARD";
        return null;
      }

      case "RETRACTING": {
        if (reach <= s.guardReach + 0.08 || now - s.extensionStart > this.options.maxExtensionMs) {
          s.phase = "COOLDOWN";
        }
        return null;
      }

      case "COOLDOWN": {
        if (now >= s.cooldownUntil) {
          s.phase = "GUARD";
          s.peakReach = 0;
        }
        return null;
      }

      case "PEAK":
        s.phase = "RETRACTING";
        return null;
    }
  }

  /**
   * Classification (TDD §12.6). Depth from a single webcam is imperfect, so
   * the order of checks favours the most distinctive signatures first; the
   * fallback is JAB rather than discarding the movement.
   *
   * The z (depth) velocity separates straight punches from lateral ones:
   * jabs and crosses drive toward the camera (negative z in the normalized
   * frame), while a hook's travel is dominantly lateral.
   */
  private classify(s: HandState): PunchType {
    const n = Math.max(1, s.samples);
    const meanVx = s.sumVelX / n;
    const meanVy = s.sumVelY / n;
    const meanVz = s.sumVelZ / n;
    const horizontal = Math.abs(meanVx);
    const vertical = Math.abs(meanVy);
    // Toward the camera = z decreasing. Backward drift never counts as drive.
    const forward = Math.max(0, -meanVz);

    // Uppercut: starts low (below chest), dominant upward travel, bent elbow.
    if (s.startY > 0.35 && meanVy < -1.0 && vertical > horizontal * 1.15) {
      return "UPPERCUT";
    }

    // Hook: curved horizontal path, elbow stays moderately bent, and the
    // travel is genuinely lateral — a straight punch that drifts sideways
    // has far more forward drive than sideways sweep.
    if (
      horizontal > vertical * 1.3 &&
      horizontal > forward * 0.75 &&
      s.minElbowAngle < 135
    ) {
      return "HOOK";
    }

    // Cross: strong torso rotation with the rear hand driving through.
    if (s.maxTorsoDelta > 0.35) {
      return "CROSS";
    }

    return "JAB";
  }
}
