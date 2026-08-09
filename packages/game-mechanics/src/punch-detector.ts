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
  /**
   * Arm-lowering veto: an "extension" whose mean wrist travel is downward
   * faster than this (sw/s) with almost no forward drive is a guard being
   * DROPPED, not a punch. Lowering the arms is reach-increasing and fast —
   * the same signature the FSM triggers on — and without the veto every
   * block release fired a phantom punch (both hands, at the cooldown
   * ceiling). The veto also requires the downward rate to dominate lateral
   * travel, because no real punch is vertical-dominant downward: jabs and
   * crosses drive toward the camera, hooks sweep sideways (even when arcing
   * down at the body), uppercuts rise.
   */
  dropVetoMinDownward: number;
  /** Forward drive below this fraction of the downward rate confirms a drop. */
  dropVetoForwardRatio: number;
}

export const DEFAULT_PUNCH_OPTIONS: PunchDetectorOptions = {
  minStartSpeed: 1.4,
  minExtension: 0.28,
  perHandCooldownMs: GAME_RULES.perHandCooldownMs,
  maxExtensionMs: 900,
  minConfidence: GAME_RULES.minPunchConfidence,
  dropVetoMinDownward: 0.8,
  dropVetoForwardRatio: 0.25,
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
          // Seed the trajectory with the trigger frame — it's the frame that
          // passed minStartSpeed, and it guarantees samples >= 1 at PEAK so
          // the mean-velocity reads (classification, arm-lowering veto) can
          // never divide an empty accumulator into all-zero means.
          s.sumVelX = vel.x;
          s.sumVelY = vel.y;
          s.sumVelZ = vel.z;
          s.maxSpeed = speed;
          s.minElbowAngle = elbowAngle;
          s.samples = 1;
          s.startY = wristY;
          s.startTorsoRotation = f.torsoRotation;
          s.maxTorsoDelta = 0;
        }
        return null;
      }

      case "EXTENDING": {
        if (reach > s.peakReach) {
          // Still extending — this frame is part of the punch trajectory.
          s.peakReach = reach;
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
          return null;
        }
        // Reach stopped increasing → this frame is the REVERSAL, the first
        // frame of whatever comes next. Keep it out of the accumulators: its
        // velocity points against the extension and would smear every mean
        // the classifier (and the arm-lowering veto) reads.

        const extension = s.peakReach - s.guardReach;
        if (extension >= this.options.minExtension) {
          // Arm-lowering veto (see the option docs): downward-dominant travel
          // with no forward drive is a guard coming down, not a punch. Put
          // the hand through RETRACTING/COOLDOWN as usual — the motion is
          // real, it's just not an attack — but leave the global punch clock
          // alone so it cannot delay the other hand's genuine punch.
          const n = Math.max(1, s.samples);
          const meanVy = s.sumVelY / n;
          const forwardDrive = Math.max(0, -s.sumVelZ / n);
          // Downward must dominate LATERAL travel too: a body hook arcs down
          // while sweeping sideways, and only the drop is vertical-dominant.
          if (
            meanVy > this.options.dropVetoMinDownward &&
            meanVy > Math.abs(s.sumVelX / n) &&
            forwardDrive < this.options.dropVetoForwardRatio * meanVy
          ) {
            s.phase = "RETRACTING";
            s.cooldownUntil = now + this.options.perHandCooldownMs;
            return null;
          }

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
