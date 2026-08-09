/**
 * Core data types for the boxing mechanics pipeline.
 *
 * Everything is pure data: the detectors are unit-testable against recorded
 * fixtures without a camera or any framework.
 *
 * Coordinate convention (body frame): +x = the player's anatomical RIGHT,
 * +y = DOWN (head at negative y), z = depth relative to the shoulder plane
 * (negative = toward the camera). Units are shoulder widths. The frame
 * assumes the player faces the camera and the feed is UNMIRRORED — see
 * normalize.ts for why this frame is a reflection of image space.
 */

export type PunchType = "JAB" | "CROSS" | "HOOK" | "UPPERCUT";

export type Hand = "LEFT" | "RIGHT";

/** MediaPipe Pose produces 33 landmarks; this library uses the upper-body set. */
export interface RawLandmark {
  x: number; // image-normalized [0..1], y grows downward
  y: number;
  z: number; // relative depth (roughly hip-centred)
  visibility: number;
}

/** MediaPipe Pose landmark indices used by the pipeline. */
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

export const UPPER_BODY_INDICES = [
  LM.NOSE,
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
] as const;

/** A point in body-relative units (shoulder widths from the shoulder midpoint). */
export interface BodyPoint {
  x: number;
  y: number;
  z: number;
}

export interface NormalizedPose {
  timestamp: number;
  nose: BodyPoint;
  leftShoulder: BodyPoint;
  rightShoulder: BodyPoint;
  leftElbow: BodyPoint;
  rightElbow: BodyPoint;
  leftWrist: BodyPoint;
  rightWrist: BodyPoint;
  leftHip: BodyPoint;
  rightHip: BodyPoint;
  /** Mean visibility across the upper-body set. */
  confidence: number;
  /** Shoulder width in image-normalized units — used for camera-distance checks. */
  shoulderWidthImage: number;
}

/** Derived per-frame features after smoothing. */
export interface FrameFeatures {
  timestamp: number;

  leftWrist: BodyPoint;
  rightWrist: BodyPoint;
  leftElbow: BodyPoint;
  rightElbow: BodyPoint;

  leftWristVelocity: BodyPoint; // shoulder-widths per second
  rightWristVelocity: BodyPoint;
  leftWristSpeed: number;
  rightWristSpeed: number;

  leftElbowAngle: number; // degrees, 180 = straight
  rightElbowAngle: number;
  leftShoulderAngle: number; // hip–shoulder–elbow
  rightShoulderAngle: number;

  /** Shoulder-to-wrist reach in shoulder widths — used by the punch FSM. */
  leftReach: number;
  rightReach: number;

  /**
   * Signed wrist depth relative to the nose plane, in shoulder widths
   * (negative = closer to the camera than the nose). Drives the block
   * detector's depth gate.
   */
  leftWristDepthFromNose: number;
  rightWristDepthFromNose: number;

  torsoRotation: number; // positive when the left shoulder comes forward
  torsoLean: number;

  motionEnergy: number;
  confidence: number;
}

/**
 * Semantic combat actions emitted by the detectors — never damage numbers.
 * The detectors are pure and run wherever the pose stream is consumed.
 *
 * Note there is no dodge action: evasion is not a claim anyone emits, it is
 * geometry the punch resolver computes from the defender's pose. See hitbox.ts.
 */
export type DetectedAction =
  | {
      type: "PUNCH";
      punchType: PunchType;
      hand: Hand;
      confidence: number;
      /**
       * Predicted impact point in the DEFENDER's body frame (shoulder
       * widths). x is mirrored from the attacker's frame because the players
       * virtually face each other.
       */
      impactX: number;
      impactY: number;
      timestamp: number;
    }
  | { type: "BLOCK_START"; timestamp: number }
  | { type: "BLOCK_END"; timestamp: number };
